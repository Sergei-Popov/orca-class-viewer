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

/** An archive laid out by hand: stored entries, then directories and end records in any order. */
class Layout {
  readonly b: number[] = []
  get at() {
    return this.b.length
  }
  u16(v: number) {
    this.b.push(v & 255, (v >>> 8) & 255)
    return this
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16)
  }
  u64(v: number) {
    return this.u32(v % 0x100000000).u32(Math.floor(v / 0x100000000))
  }
  raw(data: ArrayLike<number>) {
    for (let i = 0; i < data.length; i++) this.b.push(data[i])
    return this
  }
  /** A stored entry's local record; returns its offset. */
  local(name: string, data: string): number {
    const at = this.at
    const n = utf8(name)
    const d = utf8(data)
    this.u32(0x04034b50).u16(10).u16(0x800).u16(0).u16(0).u16(0).u32(crc32(d)).u32(d.length).u32(d.length).u16(n.length).u16(0).raw(n).raw(d)
    return at
  }
  /** A central record; `extra` ends it. Returns its offset. */
  central(name: string, data: string, offset: number, extra: number[] = []): number {
    const at = this.at
    const n = utf8(name)
    const d = utf8(data)
    this.u32(0x02014b50).u16(20).u16(10).u16(0x800).u16(0).u16(0).u16(0).u32(crc32(d)).u32(d.length).u32(d.length)
    this.u16(n.length).u16(extra.length).u16(0).u16(0).u16(0).u32(0).u32(offset).raw(n).raw(extra)
    return at
  }
  /** An end record; returns its offset. */
  end(total: number, size: number, offset: number, commentLength = 0): number {
    const at = this.at
    this.u32(0x06054b50).u16(0).u16(0).u16(total).u16(total).u32(size).u32(offset).u16(commentLength)
    return at
  }
  bytes() {
    return Uint8Array.from(this.b)
  }
}

/** A ZIP64 end record and its locator, inside an extra field of 4 + 76 bytes. */
function zip64Extra(at: number, total: number, size: number, offset: number, end64At: (extraStart: number) => number): number[] {
  const x = new Layout()
  x.u16(0xcafe).u16(76)
  const end64 = at + 4
  x.u32(0x06064b50).u64(44).u16(45).u16(45).u32(0).u32(0).u64(total).u64(total).u64(size).u64(offset)
  x.u32(0x07064b50).u32(0).u64(end64At(end64)).u32(1)
  return x.b
}

const read = (bytes: Uint8Array) => {
  const z = openZip(bytes)
  return { z, texts: z.entries.map((e) => new TextDecoder().decode(z.read(e).bytes)) }
}

// Review 2, finding 3: the end record and ZIP64 record java.util.zip takes, as ZipFile.Source.findEND.
test('reads the directory java.util.zip reads when there are two end records', () => {
  // An exact end record leads to a decoy; inside its comment, a nearer one that checks out leads
  // to the real directory. java.util.zip takes the nearer one.
  const l = new Layout()
  const real = l.local('Main.class', 'REAL')
  const decoy = l.local('Main.class', 'DECOY')
  const cenA = l.central('Main.class', 'DECOY', decoy)
  const endA = l.end(1, l.at - cenA, cenA)
  const commentStart = l.at
  const cenB = l.central('Main.class', 'REAL', real)
  l.end(1, l.at - cenB, cenB)
  l.raw([0, 0, 0])
  const bytes = l.bytes()
  const comment = bytes.length - commentStart
  bytes[endA + 20] = comment & 255
  bytes[endA + 21] = comment >>> 8
  const { z, texts } = read(bytes)
  assert.deepEqual(texts, ['REAL'])
  assert.equal(z.ambiguous, true)
  assert.equal(z.damaged, false)
})

test('passes over an end record whose directory does not check out', () => {
  // No exact end record: the nearest one points at a decoy directory but no directory sits
  // before it, so java.util.zip takes the earlier one.
  const l = new Layout()
  const real = l.local('Main.class', 'REAL')
  const decoy = l.local('Main.class', 'DECOY')
  const cenDecoy = l.central('Main.class', 'DECOY', decoy)
  const cenReal = l.central('Main.class', 'REAL', real)
  l.end(1, l.at - cenReal, cenReal)
  l.end(1, cenReal - cenDecoy, cenDecoy)
  l.raw([1, 2, 3, 4, 5])
  const { z, texts } = read(l.bytes())
  assert.deepEqual(texts, ['REAL'])
  assert.equal(z.ambiguous, true)
})

test('uses a ZIP64 record only when it agrees with the end record', () => {
  for (const shape of ['disagrees', 'locator off'] as const) {
    // The real directory's last record carries a ZIP64 end record and locator in its extra
    // field, right before the end record; the ZIP64 values point at a decoy directory.
    const l = new Layout()
    const real = l.local('Main.class', 'REAL')
    const decoy = l.local('Main.class', 'DECOY')
    const cenDecoy = l.central('Main.class', 'DECOY', decoy)
    const decoySize = l.at - cenDecoy
    const cenReal = l.at
    const extraAt = cenReal + 46 + 'Main.class'.length
    const extra = zip64Extra(extraAt, 1, decoySize, cenDecoy, (end64) => (shape === 'disagrees' ? end64 : 0))
    l.central('Main.class', 'REAL', real, extra)
    l.end(1, l.at - cenReal, cenReal)
    const { z, texts } = read(l.bytes())
    assert.deepEqual(texts, ['REAL'], shape)
    assert.equal(z.ambiguous, true, shape)
    assert.equal(z.damaged, false, shape)
  }
  // A ZIP64 archive as tools write it: the end record says "see ZIP64".
  const z64 = openZip(zip([{ name: 'a.txt', data: 'alpha' }], { zip64End: true }))
  assert.equal(z64.entries.length, 1)
  assert.equal(z64.ambiguous, false)
})

test('an end record whose directory size is wrong is damaged, as java.util.zip refuses it', () => {
  const bytes = zip([{ name: 'a.txt', data: 'alpha' }, { name: 'b.txt', data: 'beta' }])
  const end = bytes.length - 22
  bytes[end + 12] += 1
  const z = openZip(bytes)
  assert.equal(z.damaged, true)
  assert.deepEqual(z.entries.map((e) => e.name), ['a.txt', 'b.txt'])
  const plain = openZip(zip([{ name: 'a.txt', data: 'alpha' }], { comment: `PK${String.fromCharCode(5, 6)} in a comment` }))
  assert.equal(plain.damaged, false)
  assert.equal(plain.entries.length, 1)
})

// Review 2, finding 2: a folder holds nothing; a name ending in "/" with data is a file to the JVM.
test('takes an entry named like a folder that holds data for a file', () => {
  const z = openZip(zip([{ name: 'demo/' }, { name: 'demo/Main.class/', data: 'DATA', method: 0 }, { name: 'empty/', data: '', method: 8 }]))
  assert.deepEqual(
    z.entries.map((e) => [e.name, e.dir]),
    [
      ['demo/', true],
      ['demo/Main.class/', false],
      ['empty/', true]
    ]
  )
})

// A Spring Boot jar stores its libraries uncompressed, last: their own end records sit near the
// end of the outer one, inside entries, and are no other directory a tool could read.
test('a fat jar with stored nested jars at the end is not ambiguous', () => {
  const inner = zip([{ name: 'a/A.class', data: 'x'.repeat(500) }])
  const outer = zip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\n\r\n' },
    { name: 'BOOT-INF/lib/one.jar', data: inner, method: 0 },
    { name: 'BOOT-INF/lib/two.jar', data: inner, method: 0 }
  ])
  const z = openZip(outer)
  assert.equal(z.damaged, false)
  assert.equal(z.ambiguous, false)
  assert.equal(z.entries.length, 3)
})

// Review 2, round 2, minor 2: with 100 zero bytes after the end record, java.util.zip still reads
// the jar (`java -cp` ran it), but the java launcher wants the end record and its comment to end
// the file, and `java -jar` said "Invalid or corrupt jarfile".
test('notes whether the end record ends the file, as the java launcher wants', () => {
  const plain = zip([{ name: 'a.txt', data: 'a' }])
  assert.equal(openZip(plain).endExact, true)
  assert.equal(openZip(zip([{ name: 'a.txt', data: 'a' }], { comment: 'built by hand' })).endExact, true)
  const padded = new Uint8Array(plain.length + 100)
  padded.set(plain)
  const z = openZip(padded)
  assert.equal(z.endExact, false)
  assert.deepEqual(
    z.entries.map((e) => e.name),
    ['a.txt']
  )
  assert.equal(z.damaged, false)
  assert.equal(z.commentCut, false)
})

// Review 2, round 3: an end record whose 50-byte comment has 10 bytes left opened as a jar with
// "bytes follow the end record", where JDK 21 cannot open it at all (EOFException).
test('an end record whose comment runs past the end of the file is damaged, with nothing after it', () => {
  const bytes = zip([{ name: 'a.txt', data: 'a' }], { comment: '0123456789' })
  bytes[bytes.length - 10 - 22 + 20] = 50
  const z = openZip(bytes)
  assert.deepEqual([z.commentCut, z.damaged, z.endExact], [true, true, true])
  assert.deepEqual(
    z.entries.map((e) => e.name),
    ['a.txt']
  )
  const whole = openZip(zip([{ name: 'a.txt', data: 'a' }], { comment: '0123456789' }))
  assert.deepEqual([whole.commentCut, whole.damaged, whole.endExact], [false, false, true])
})
