// DEFLATE (RFC 1951) decoder for the entries of .jar, .war and .ear files. Huffman codes up to
// nine bits decode from a lookup table; longer, rarer codes walk the canonical code one bit at a
// time (as zlib's puff does). Output stops at the caller's limit and never grows past the size
// the archive declares, so a damaged or crafted entry cannot make it allocate more.

export class InflateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InflateError'
  }
}

const FAST_BITS = 9
const MAX_BITS = 15

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193,
  12289, 16385, 24577
]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
/** Order of the code length code lengths in a dynamic block header. */
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/** A canonical Huffman code: a fast table for short codes, counts and symbols for the rest. */
type Huffman = { fast: Uint16Array; count: Uint16Array; symbol: Uint16Array }

function buildHuffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(MAX_BITS + 1)
  for (let i = 0; i < n; i++) count[lengths[i]]++
  count[0] = 0
  let left = 1
  for (let len = 1; len <= MAX_BITS; len++) {
    left = (left << 1) - count[len]
    if (left < 0) throw new InflateError('over-subscribed Huffman code')
  }
  const offs = new Uint16Array(MAX_BITS + 2)
  for (let len = 1; len <= MAX_BITS; len++) offs[len + 1] = offs[len] + count[len]
  const symbol = new Uint16Array(n)
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i
  // Fast table: canonical codes, bit-reversed because DEFLATE packs them from the top bit.
  const fast = new Uint16Array(1 << FAST_BITS)
  let code = 0
  const next = new Uint16Array(MAX_BITS + 1)
  for (let len = 1; len <= MAX_BITS; len++) {
    code = (code + count[len - 1]) << 1
    next[len] = code
  }
  for (let i = 0; i < n; i++) {
    const len = lengths[i]
    if (!len) continue
    const c = next[len]++
    if (len > FAST_BITS) continue
    let rev = 0
    for (let b = 0; b < len; b++) rev |= ((c >> b) & 1) << (len - 1 - b)
    for (let k = rev; k < 1 << FAST_BITS; k += 1 << len) fast[k] = (i << 4) | len
  }
  return { fast, count, symbol }
}

let fixedLit: Huffman | null = null
let fixedDist: Huffman | null = null

function fixedTables(): [Huffman, Huffman] {
  if (!fixedLit || !fixedDist) {
    const lit = new Uint8Array(288)
    lit.fill(8, 0, 144)
    lit.fill(9, 144, 256)
    lit.fill(7, 256, 280)
    lit.fill(8, 280, 288)
    fixedLit = buildHuffman(lit, 288)
    fixedDist = buildHuffman(new Uint8Array(30).fill(5), 30)
  }
  return [fixedLit, fixedDist]
}

class Bits {
  private readonly data: Uint8Array
  pos = 0
  private buf = 0
  private cnt = 0
  /** Zero bits added past the end of the data, at the top of `buf`. */
  private phantom = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  private fill(n: number): void {
    while (this.cnt < n) {
      if (this.pos < this.data.length) this.buf |= this.data[this.pos++] << this.cnt
      else this.phantom += 8
      this.cnt += 8
    }
  }

  peek(n: number): number {
    this.fill(n)
    return this.buf & ((1 << n) - 1)
  }

  drop(n: number): void {
    this.buf >>>= n
    this.cnt -= n
    if (this.phantom > this.cnt) throw new InflateError('the compressed data ends early')
  }

  bits(n: number): number {
    if (n === 0) return 0
    const v = this.peek(n)
    this.drop(n)
    return v
  }

  /** Skips to the next byte boundary and hands back whole bytes still in the buffer. */
  align(): void {
    this.drop(this.cnt & 7)
    const whole = (this.cnt - this.phantom) >> 3
    this.pos -= whole
    this.buf = 0
    this.cnt = 0
    this.phantom = 0
  }

  decode(h: Huffman): number {
    const entry = h.fast[this.peek(FAST_BITS)]
    if (entry) {
      this.drop(entry & 15)
      return entry >> 4
    }
    // A code longer than the fast table: walk it bit by bit.
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1)
      const count = h.count[len]
      if (code - first < count) return h.symbol[index + code - first]
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    throw new InflateError('invalid Huffman code')
  }
}

export type InflateResult = { bytes: Uint8Array; truncated: boolean }

/**
 * Inflates raw DEFLATE `data`. `expected` is the size the archive declares: unpacking more is
 * an error. At most `limit` bytes come back, with `truncated` set when there was more.
 */
export function inflateRaw(data: Uint8Array, expected: number, limit: number): InflateResult {
  const want = Math.min(expected, limit)
  // DEFLATE expands at most 1032 times; a larger declared size is a lie we do not allocate for.
  const cap = Math.min(want, data.length * 1032 + 64)
  const out = new Uint8Array(cap)
  let n = 0
  const bits = new Bits(data)
  const full = (): InflateResult | null => {
    if (want < expected && n >= want) return { bytes: out, truncated: true }
    return null
  }
  let last = 0
  while (!last) {
    last = bits.bits(1)
    const type = bits.bits(2)
    if (type === 0) {
      bits.align()
      const p = bits.pos
      if (p + 4 > data.length) throw new InflateError('the compressed data ends early')
      const len = data[p] | (data[p + 1] << 8)
      const nlen = data[p + 2] | (data[p + 3] << 8)
      if ((len ^ 0xffff) !== nlen) throw new InflateError('stored block length check failed')
      if (p + 4 + len > data.length) throw new InflateError('the compressed data ends early')
      const take = Math.min(len, cap - n)
      out.set(data.subarray(p + 4, p + 4 + take), n)
      n += take
      bits.pos = p + 4 + len
      if (take < len) {
        const done = full()
        if (done) return done
        throw new InflateError('the data is longer than the archive says')
      }
      continue
    }
    let lit: Huffman
    let dist: Huffman
    if (type === 1) {
      ;[lit, dist] = fixedTables()
    } else if (type === 2) {
      const nlen = bits.bits(5) + 257
      const ndist = bits.bits(5) + 1
      const ncode = bits.bits(4) + 4
      if (nlen > 286 || ndist > 30) throw new InflateError('bad dynamic block header')
      const clen = new Uint8Array(19)
      for (let i = 0; i < ncode; i++) clen[CLEN_ORDER[i]] = bits.bits(3)
      const lencode = buildHuffman(clen, 19)
      const lengths = new Uint8Array(nlen + ndist)
      for (let i = 0; i < nlen + ndist; ) {
        const sym = bits.decode(lencode)
        if (sym < 16) {
          lengths[i++] = sym
          continue
        }
        let repeat: number
        let value = 0
        if (sym === 16) {
          if (i === 0) throw new InflateError('repeat with no previous length')
          value = lengths[i - 1]
          repeat = 3 + bits.bits(2)
        } else if (sym === 17) repeat = 3 + bits.bits(3)
        else repeat = 11 + bits.bits(7)
        if (i + repeat > nlen + ndist) throw new InflateError('too many code lengths')
        lengths.fill(value, i, i + repeat)
        i += repeat
      }
      if (lengths[256] === 0) throw new InflateError('no end-of-block code')
      lit = buildHuffman(lengths.subarray(0, nlen), nlen)
      dist = buildHuffman(lengths.subarray(nlen), ndist)
    } else {
      throw new InflateError('invalid block type')
    }
    for (;;) {
      const sym = bits.decode(lit)
      if (sym < 256) {
        if (n >= cap) {
          const done = full()
          if (done) return done
          throw new InflateError('the data is longer than the archive says')
        }
        out[n++] = sym
      } else if (sym === 256) {
        break
      } else {
        const li = sym - 257
        if (li >= 29) throw new InflateError('invalid length code')
        const length = LENGTH_BASE[li] + bits.bits(LENGTH_EXTRA[li])
        const di = bits.decode(dist)
        if (di >= 30) throw new InflateError('invalid distance code')
        const distance = DIST_BASE[di] + bits.bits(DIST_EXTRA[di])
        if (distance > n) throw new InflateError('distance reaches before the start')
        const room = cap - n
        const copy = Math.min(length, room)
        for (let from = n - distance, end = n + copy; n < end; ) out[n++] = out[from++]
        if (copy < length) {
          const done = full()
          if (done) return done
          throw new InflateError('the data is longer than the archive says')
        }
      }
    }
  }
  // Shorter than declared: the caller's size and CRC checks report it.
  return { bytes: n === cap ? out : out.subarray(0, n), truncated: false }
}
