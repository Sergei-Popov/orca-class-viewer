// A minimal ZIP writer for tests, after Archive Viewer's: it writes exactly the fields a case
// needs, compressing with Node's zlib.

import { deflateRawSync } from 'node:zlib'
import { crc32 } from '../zip/crc32'
import { Bytes } from './classwriter'

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Little-endian writer on top of the class writer's big-endian `Bytes`. */
class LE {
  readonly b = new Bytes()
  u16(v: number) {
    this.b.u1(v).u1(v >>> 8)
  }
  u32(v: number) {
    this.u16(v & 0xffff)
    this.u16(v >>> 16)
  }
  u64(v: number) {
    this.u32(v % 0x100000000)
    this.u32(Math.floor(v / 0x100000000))
  }
  raw(data: ArrayLike<number>) {
    this.b.raw(data)
  }
  get length() {
    return this.b.length
  }
}

export type ZipItem = {
  name: string
  data?: Uint8Array | string
  /** 0 stored, 8 deflated (default for files). */
  method?: number
  /** zlib options for method 8. */
  level?: number
  strategy?: number
  flags?: number
  crc?: number
  /** Store this size instead of the real one. */
  size?: number
  zip64?: boolean
}

export function zip(items: ZipItem[], options: { prefix?: Uint8Array; comment?: string; zip64End?: boolean } = {}): Uint8Array {
  const w = new LE()
  if (options.prefix) w.raw(options.prefix)
  const base = options.prefix?.length ?? 0
  const central: LE[] = []
  for (const item of items) {
    const name = utf8(item.name)
    const data = typeof item.data === 'string' ? utf8(item.data) : (item.data ?? new Uint8Array(0))
    const method = item.method ?? (item.name.endsWith('/') ? 0 : 8)
    const packed = method === 8 ? deflateRawSync(data, { level: item.level ?? 6, strategy: item.strategy }) : data
    const crc = item.crc ?? crc32(data)
    const size = item.size ?? data.length
    const offset = w.length - base
    w.u32(0x04034b50)
    w.u16(20)
    w.u16(item.flags ?? 0x800)
    w.u16(method)
    w.u16(0)
    w.u16(0x5b6f)
    w.u32(crc)
    w.u32(packed.length)
    w.u32(size)
    w.u16(name.length)
    w.u16(0)
    w.raw(name)
    w.raw(packed)
    const c = new LE()
    const extra = new LE()
    if (item.zip64) {
      extra.u16(1)
      extra.u16(24)
      extra.u64(size)
      extra.u64(packed.length)
      extra.u64(offset)
    }
    c.u32(0x02014b50)
    c.u16((3 << 8) | 20)
    c.u16(20)
    c.u16(item.flags ?? 0x800)
    c.u16(method)
    c.u16(0)
    c.u16(0x5b6f)
    c.u32(crc)
    c.u32(item.zip64 ? 0xffffffff : packed.length)
    c.u32(item.zip64 ? 0xffffffff : size)
    c.u16(name.length)
    c.u16(extra.length)
    c.u16(0)
    c.u16(0)
    c.u16(0)
    c.u32(0)
    c.u32(item.zip64 ? 0xffffffff : offset)
    c.raw(name)
    c.raw(extra.b.out)
    central.push(c)
  }
  const cdOffset = w.length - base
  for (const c of central) w.raw(c.b.out)
  const cdSize = w.length - base - cdOffset
  if (options.zip64End) {
    const end64 = w.length - base
    w.u32(0x06064b50)
    w.u64(44)
    w.u16(45)
    w.u16(45)
    w.u32(0)
    w.u32(0)
    w.u64(items.length)
    w.u64(items.length)
    w.u64(cdSize)
    w.u64(cdOffset)
    w.u32(0x07064b50)
    w.u32(0)
    w.u64(end64)
    w.u32(1)
  }
  const comment = utf8(options.comment ?? '')
  w.u32(0x06054b50)
  w.u16(0)
  w.u16(0)
  w.u16(options.zip64End ? 0xffff : items.length)
  w.u16(options.zip64End ? 0xffff : items.length)
  w.u32(options.zip64End ? 0xffffffff : cdSize)
  w.u32(options.zip64End ? 0xffffffff : cdOffset)
  w.u16(comment.length)
  w.raw(comment)
  return w.b.done()
}
