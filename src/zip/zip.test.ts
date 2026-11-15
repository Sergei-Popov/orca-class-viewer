import { assert, test } from 'orca/testing'
import { constants, deflateRawSync } from 'node:zlib'
import { utf8, zip } from '../testing/zipwriter'
import { crc32 } from './crc32'
import { InflateError, inflateRaw } from './inflate'
import { ZipError, normalizePath, openZip } from './zip'

/** Deterministic test data: xorshift noise, or text made of a small vocabulary. */
function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed
  for (let i = 0; i < length; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out[i] = x & 0xff
  }
  return out
}

function prose(length: number): Uint8Array {
  const words = ['class', 'field', 'method', 'constant', 'pool', 'bytecode', 'stack', 'frame', 'java', 'lang', 'Object', '{', '}', ';']
  const r = noise(length)
  let text = ''
  for (let i = 0; text.length < length; i++) text += words[r[i % r.length] % words.length] + (r[(i * 7) % r.length] & 1 ? ' ' : '\n')
  return utf8(text.slice(0, length))
}

/** Bytes whose frequencies follow the Fibonacci numbers, so Huffman codes grow to 15 bits. */
function skewed(): Uint8Array {
  const out: number[] = []
  let a = 1
  let b = 1
  for (let symbol = 0; symbol < 22; symbol++) {
    for (let k = 0; k < a; k++) out.push(symbol)
    ;[a, b] = [b, a + b]
  }
  // Interleave so runs do not turn into matches.
  const r = noise(out.length, 7)
  for (let i = out.length - 1; i > 0; i--) {
    const j = (r[i] | (r[(i * 3) % r.length] << 8)) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return Uint8Array.from(out)
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

test('inflates what zlib deflates, block type by block type', () => {
  const cases: [string, Uint8Array, { level?: number; strategy?: number }][] = [
    ['empty', new Uint8Array(0), {}],
    ['stored, several blocks', noise(200_000), { level: 0 }],
    ['fixed Huffman', prose(5000), { strategy: constants.Z_FIXED }],
    ['dynamic, fast', prose(80_000), { level: 1 }],
    ['dynamic, best', prose(80_000), { level: 9 }],
    ['run-length', new Uint8Array(70_000).fill(65), { strategy: constants.Z_RLE }],
    ['long codes', skewed(), { strategy: constants.Z_HUFFMAN_ONLY }],
    ['incompressible', noise(40_000, 99), { level: 6 }]
  ]
  for (const [name, data, options] of cases) {
    const packed = deflateRawSync(data, options)
    const result = inflateRaw(packed, data.length, Infinity)
    assert.equal(result.truncated, false, name)
    assert.ok(same(result.bytes, data), name)
  }
})

test('stops at the limit and refuses more than the declared size', () => {
  const data = prose(50_000)
  const packed = deflateRawSync(data)
  const head = inflateRaw(packed, data.length, 1000)
  assert.equal(head.truncated, true)
  assert.equal(head.bytes.length, 1000)
  assert.ok(same(head.bytes, data.subarray(0, 1000)))
  assert.throws(() => inflateRaw(packed, 10_000, Infinity), (e) => e instanceof InflateError && /longer/.test(e.message))
  // Shorter than declared is left to the caller's size check.
  assert.equal(inflateRaw(packed, 60_000, Infinity).bytes.length, 50_000)
  // A declared size far beyond what the data could expand to allocates no more than that.
  assert.equal(inflateRaw(deflateRawSync(new Uint8Array(10)), 2 ** 31, Infinity).bytes.length, 10)
})

/** Writes DEFLATE bits by hand: header fields from the low bit, Huffman codes from the top. */
class BitWriter {
  private bytes: number[] = []
  private bit = 0
  bits(value: number, n: number): this {
    for (let i = 0; i < n; i++) this.push((value >> i) & 1)
    return this
  }
  code(value: number, n: number): this {
    for (let i = n - 1; i >= 0; i--) this.push((value >> i) & 1)
    return this
  }
  private push(b: number) {
    if (this.bit === 0) this.bytes.push(0)
    this.bytes[this.bytes.length - 1] |= b << this.bit
    this.bit = (this.bit + 1) & 7
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

test('reports damaged DEFLATE data instead of guessing', () => {
  const damaged = (data: Uint8Array, pattern: RegExp, expected = 1000) =>
    assert.throws(() => inflateRaw(data, expected, Infinity), (e) => e instanceof InflateError && pattern.test(e.message))
  // Block type 3 does not exist.
  damaged(new BitWriter().bits(1, 1).bits(3, 2).done(), /block type/)
  // A fixed block that copies from before the start: length code 257, distance code 0.
  damaged(new BitWriter().bits(1, 1).bits(1, 2).code(1, 7).code(0, 5).done(), /before the start/)
  // A stored block whose length check fails.
  damaged(Uint8Array.from([1, 5, 0, 5, 0]), /length check/)
  // Cut short.
  const packed = deflateRawSync(prose(5000))
  damaged(packed.subarray(0, packed.length >> 1), /ends early/, 5000)
  damaged(new Uint8Array(0), /ends early/)
  // Code lengths that over-subscribe the code: every one of 19 code length codes at length 1.
  const over = new BitWriter().bits(1, 1).bits(2, 2).bits(0, 5).bits(0, 5).bits(15, 4)
  for (let i = 0; i < 19; i++) over.bits(1, 3)
  damaged(over.done(), /over-subscribed/)
})

test('lists a jar: stored and deflated entries, folders, UTF-8 names', () => {
  const manifest = 'Manifest-Version: 1.0\r\nMain-Class: demo.Main\r\n\r\n'
  const bytes = zip([
    { name: 'META-INF/' },
    { name: 'META-INF/MANIFEST.MF', data: manifest },
    { name: 'demo/Main.class', data: noise(3000), method: 0 },
    { name: 'demo/Звезда.txt', data: prose(4000) }
  ], { comment: 'built in a test' })
  const z = openZip(bytes)
  assert.equal(z.damaged, false)
  assert.equal(z.comment, 'built in a test')
  assert.deepEqual(z.entries.map((e) => [e.path, e.dir, e.method]), [
    ['META-INF', true, 0],
    ['META-INF/MANIFEST.MF', false, 8],
    ['demo/Main.class', false, 0],
    ['demo/Звезда.txt', false, 8]
  ])
  assert.equal(new TextDecoder().decode(z.read(z.entries[1]).bytes), manifest)
  assert.ok(same(z.read(z.entries[2]).bytes, noise(3000)))
  assert.ok(same(z.read(z.entries[3]).bytes, prose(4000)))
  assert.ok(typeof z.entries[1].mtime === 'number')
  const head = z.read(z.entries[3], 10)
  assert.equal(head.truncated, true)
  assert.equal(head.bytes.length, 10)
})

test('reads archives with data in front and ZIP64 records', () => {
  const items = [{ name: 'a.txt', data: 'alpha' }, { name: 'b.txt', data: 'beta', zip64: true }]
  // A .jmod starts with "JM", 1, 0; an executable jar may start with a launcher script.
  for (const prefix of [Uint8Array.from([0x4a, 0x4d, 1, 0]), utf8('#!/bin/sh\nexec java -jar "${0}" "${@}"\n')]) {
    const z = openZip(zip(items, { prefix }))
    assert.equal(new TextDecoder().decode(z.read(z.entries[1]).bytes), 'beta')
  }
  const z64 = openZip(zip(items, { zip64End: true }))
  assert.equal(z64.entries.length, 2)
  assert.equal(z64.entries[1].size, 4)
  assert.equal(new TextDecoder().decode(z64.read(z64.entries[0]).bytes), 'alpha')
})

test('damaged, encrypted and unsupported entries fail one by one', () => {
  const bytes = zip([
    { name: 'good.txt', data: 'fine' },
    { name: 'crc.txt', data: 'wrong crc', crc: 1234 },
    { name: 'size.txt', data: 'short', size: 99 },
    { name: 'secret.txt', data: 'x', flags: 0x801 },
    { name: 'bzip2.txt', data: 'x', method: 12 }
  ])
  const z = openZip(bytes)
  const code = (i: number) => {
    try {
      z.read(z.entries[i])
      return 'ok'
    } catch (e) {
      return e instanceof ZipError ? e.code : String(e)
    }
  }
  assert.deepEqual([0, 1, 2, 3, 4].map(code), ['ok', 'damaged', 'damaged', 'encrypted', 'method'])
  assert.equal(z.entries[3].encrypted, true)
  assert.equal(crc32(utf8('fine')), z.entries[0].crc)
})

test('a cut central directory keeps the entries before the cut', () => {
  const bytes = zip([{ name: 'one.txt', data: '1' }, { name: 'two.txt', data: '2' }, { name: 'three.txt', data: '3' }])
  // Overwrite the signature of the third central record.
  const copy = bytes.slice()
  const text = new TextDecoder('latin1').decode(copy)
  const third = text.lastIndexOf('PK\u0001\u0002')
  copy[third] = 0
  const z = openZip(copy)
  assert.equal(z.damaged, true)
  assert.deepEqual(z.entries.map((e) => e.path), ['one.txt', 'two.txt'])
  assert.throws(() => openZip(prose(100)), (e) => e instanceof ZipError && e.code === 'not-zip')
  assert.throws(() => openZip(new Uint8Array(0)), (e) => e instanceof ZipError && e.code === 'not-zip')
})

test('normalizes entry paths', () => {
  assert.equal(normalizePath('/a//b/./c'), 'a/b/c')
  assert.equal(normalizePath('a\\b\\c.class'), 'a/b/c.class')
  assert.equal(normalizePath('../../etc/x'), 'etc/x')
  assert.equal(normalizePath('a/b/../c'), 'a/c')
})
