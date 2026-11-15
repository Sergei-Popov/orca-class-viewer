// A bounds-checked big-endian reader for class files, and the modified UTF-8 that class files
// store their strings in (JVMS 4.4.7): NUL as C0 80, characters outside the BMP as two
// three-byte surrogates.

export type FormatErrorCode = 'empty' | 'magic' | 'truncated' | 'malformed'

/** A class file the parser cannot read past `offset`. */
export class ClassFormatError extends Error {
  readonly code: FormatErrorCode
  readonly offset: number

  constructor(code: FormatErrorCode, offset: number, message: string) {
    super(message)
    this.name = 'ClassFormatError'
    this.code = code
    this.offset = offset
  }
}

export class Reader {
  readonly bytes: Uint8Array
  pos: number
  readonly end: number

  constructor(bytes: Uint8Array, pos = 0, end = bytes.length) {
    this.bytes = bytes
    this.pos = pos
    this.end = Math.min(end, bytes.length)
  }

  get remaining(): number {
    return this.end - this.pos
  }

  need(count: number, what = 'data'): void {
    if (count < 0 || this.pos + count > this.end) {
      throw new ClassFormatError('truncated', this.pos, `the file ends inside ${what}`)
    }
  }

  u1(): number {
    this.need(1)
    return this.bytes[this.pos++]
  }

  s1(): number {
    return (this.u1() << 24) >> 24
  }

  u2(): number {
    this.need(2)
    const b = this.bytes
    const v = (b[this.pos] << 8) | b[this.pos + 1]
    this.pos += 2
    return v
  }

  s2(): number {
    return (this.u2() << 16) >> 16
  }

  u4(): number {
    return this.s4() >>> 0
  }

  s4(): number {
    this.need(4)
    const b = this.bytes
    const p = this.pos
    this.pos += 4
    return (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]
  }

  take(count: number, what?: string): Uint8Array {
    this.need(count, what)
    const out = this.bytes.subarray(this.pos, this.pos + count)
    this.pos += count
    return out
  }

  /** A reader over the next `count` bytes; this one skips past them. */
  sub(count: number, what?: string): Reader {
    this.need(count, what)
    const r = new Reader(this.bytes, this.pos, this.pos + count)
    this.pos += count
    return r
  }
}

/**
 * Decodes modified UTF-8. Bytes that do not form a valid sequence become U+FFFD and set
 * `damaged`; obfuscators sometimes write such names on purpose.
 */
export function decodeModifiedUtf8(bytes: Uint8Array): { text: string; damaged: boolean } {
  let ascii = true
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0 || bytes[i] >= 0x80) {
      ascii = false
      break
    }
  }
  if (ascii) {
    let text = ''
    for (let i = 0; i < bytes.length; i += 4096) {
      text += String.fromCharCode(...bytes.subarray(i, i + 4096))
    }
    return { text, damaged: false }
  }
  const units: number[] = []
  let damaged = false
  for (let i = 0; i < bytes.length; ) {
    const a = bytes[i]
    if (a !== 0 && a < 0x80) {
      units.push(a)
      i += 1
    } else if ((a & 0xe0) === 0xc0 && i + 1 < bytes.length && (bytes[i + 1] & 0xc0) === 0x80) {
      units.push(((a & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    } else if (
      (a & 0xf0) === 0xe0 &&
      i + 2 < bytes.length &&
      (bytes[i + 1] & 0xc0) === 0x80 &&
      (bytes[i + 2] & 0xc0) === 0x80
    ) {
      units.push(((a & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      units.push(0xfffd)
      damaged = true
      i += 1
    }
  }
  let text = ''
  for (let i = 0; i < units.length; i += 4096) {
    text += String.fromCharCode(...units.slice(i, i + 4096))
  }
  return { text, damaged }
}

/** Encodes text as modified UTF-8 (used by tests to build class files). */
export function encodeModifiedUtf8(text: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 0 && c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return Uint8Array.from(out)
}

export const hex = (value: number, width = 2): string => value.toString(16).padStart(width, '0')
