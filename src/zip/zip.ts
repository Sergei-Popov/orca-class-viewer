// ZIP reading for .jar, .war, .ear, .jmod and .aar files, adapted from Archive Viewer's reader
// (same author, MIT): the central directory, found from the end record, lists every entry; an
// entry is unpacked only when it is needed. Handles ZIP64, data descriptors and data before the
// archive (a .jmod's "JM" header, a launcher script in front of an executable jar).

import { crc32 } from './crc32'
import { InflateError, inflateRaw } from './inflate'

const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const SIG_END64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50

export type ZipEntry = {
  index: number
  /** Normalized path: forward slashes, no leading slash, no `.` segments. */
  path: string
  dir: boolean
  size: number
  packed: number
  method: number
  crc: number
  encrypted: boolean
  /** Modification time in milliseconds, local time. */
  mtime?: number
}

export type ZipErrorCode = 'not-zip' | 'damaged' | 'encrypted' | 'method' | 'too-large'

export class ZipError extends Error {
  readonly code: ZipErrorCode
  constructor(code: ZipErrorCode, message: string) {
    super(message)
    this.name = 'ZipError'
    this.code = code
  }
}

export type ReadResult = { bytes: Uint8Array; truncated: boolean }

export type Zip = {
  entries: ZipEntry[]
  size: number
  /** The central directory ends early; `entries` holds what could be read. */
  damaged: boolean
  comment?: string
  /** Unpacks an entry, at most `limit` bytes; checks the CRC when it unpacks all of it. */
  read(entry: ZipEntry, limit?: number): ReadResult
}

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0
const u64 = (b: Uint8Array, at: number) => u32(b, at) + u32(b, at + 4) * 0x100000000

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin = new TextDecoder('windows-1252')

function decodeName(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes)
  } catch {
    // Jar tools write UTF-8; an old zip tool may not have.
    return latin.decode(bytes)
  }
}

export function normalizePath(name: string): string {
  const parts: string[] = []
  for (const part of name.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** The end of central directory record, searched from the end past a comment of up to 64 KB. */
export function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const last = bytes.length - 22
  if (last < 0) return -1
  const stop = Math.max(0, last - 0xffff)
  let loose = -1
  for (let i = last; i >= stop; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 5 && bytes[i + 3] === 6) {
      const commentLength = u16(bytes, i + 20)
      if (i + 22 + commentLength === bytes.length) return i
      if (loose < 0 && i + 22 + commentLength <= bytes.length) loose = i
    }
  }
  return loose
}

type Raw = ZipEntry & { localOffset: number; flags: number }

export function openZip(bytes: Uint8Array): Zip {
  const end = findEndOfCentralDirectory(bytes)
  if (end < 0) throw new ZipError('not-zip', 'no ZIP end record')
  let total = u16(bytes, end + 10)
  let cdSize = u32(bytes, end + 12)
  let cdOffset = u32(bytes, end + 16)
  const commentLength = u16(bytes, end + 20)
  let cdEnd = end

  const locator = end - 20
  if (locator >= 0 && u32(bytes, locator) === SIG_LOCATOR64) {
    let end64 = u64(bytes, locator + 8)
    if (end64 + 56 > bytes.length || u32(bytes, end64) !== SIG_END64) end64 = locator - 56
    if (end64 >= 0 && u32(bytes, end64) === SIG_END64) {
      total = u64(bytes, end64 + 32)
      cdSize = u64(bytes, end64 + 40)
      cdOffset = u64(bytes, end64 + 48)
      cdEnd = end64
    }
  }

  // Data before the archive shifts every stored offset.
  let shift = 0
  const actualStart = cdEnd - cdSize
  if (actualStart >= 0 && actualStart !== cdOffset && u32(bytes, actualStart) === SIG_CENTRAL) {
    shift = actualStart - cdOffset
  }

  const raws: Raw[] = []
  let at = cdOffset + shift
  let damaged = false
  for (;;) {
    if (at + 46 > bytes.length || u32(bytes, at) !== SIG_CENTRAL) {
      damaged = raws.length < total && total !== 0xffff
      break
    }
    const flags = u16(bytes, at + 8)
    const method = u16(bytes, at + 10)
    const time = u16(bytes, at + 12)
    const date = u16(bytes, at + 14)
    const crc = u32(bytes, at + 16)
    let packed = u32(bytes, at + 20)
    let size = u32(bytes, at + 24)
    const nameLength = u16(bytes, at + 28)
    const extraLength = u16(bytes, at + 30)
    const entryCommentLength = u16(bytes, at + 32)
    const external = u32(bytes, at + 38)
    let localOffset = u32(bytes, at + 42)
    const nameEnd = at + 46 + nameLength
    if (nameEnd > bytes.length) {
      damaged = true
      break
    }
    const name = decodeName(bytes.subarray(at + 46, nameEnd))
    const extraEnd = Math.min(bytes.length, nameEnd + extraLength)
    let mtime = dosTime(date, time)
    for (let x = nameEnd; x + 4 <= extraEnd; ) {
      const id = u16(bytes, x)
      const length = u16(bytes, x + 2)
      const data = x + 4
      if (id === 0x0001) {
        let p = data
        if (size === 0xffffffff && p + 8 <= data + length) (size = u64(bytes, p)), (p += 8)
        if (packed === 0xffffffff && p + 8 <= data + length) (packed = u64(bytes, p)), (p += 8)
        if (localOffset === 0xffffffff && p + 8 <= data + length) localOffset = u64(bytes, p)
      } else if (id === 0x5455 && length >= 5 && bytes[data] & 1) {
        mtime = u32(bytes, data + 1) * 1000
      }
      x = data + length
    }
    raws.push({
      index: raws.length,
      path: normalizePath(name),
      dir: /[/\\]$/.test(name) || ((external & 0x10) !== 0 && size === 0),
      size,
      packed,
      method,
      crc,
      encrypted: (flags & 1) !== 0,
      mtime,
      localOffset,
      flags
    })
    at = nameEnd + extraLength + entryCommentLength
  }

  const comment = commentLength ? decodeName(bytes.subarray(end + 22, Math.min(bytes.length, end + 22 + commentLength))) : undefined
  const entries: ZipEntry[] = raws.map(({ localOffset: _l, flags: _f, ...entry }) => entry)

  return {
    entries,
    size: bytes.length,
    damaged,
    comment,
    read(entry, limit = Infinity) {
      const raw = raws[entry.index]
      if (!raw) throw new ZipError('damaged', 'no such entry')
      return readRaw(bytes, raw, shift, limit)
    }
  }
}

function readRaw(bytes: Uint8Array, raw: Raw, shift: number, limit: number): ReadResult {
  if (raw.encrypted) throw new ZipError('encrypted', 'the entry is encrypted')
  const local = raw.localOffset + shift
  if (local + 30 > bytes.length || u32(bytes, local) !== SIG_LOCAL) {
    throw new ZipError('damaged', 'local header not found')
  }
  const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
  const end = start + raw.packed
  if (end > bytes.length) throw new ZipError('damaged', 'the entry ends after the file')
  const data = bytes.subarray(start, end)
  let result: ReadResult
  if (raw.method === 0) {
    if (raw.packed !== raw.size) throw new ZipError('damaged', 'stored sizes differ')
    result = { bytes: data.subarray(0, Math.min(data.length, limit)), truncated: data.length > limit }
  } else if (raw.method === 8) {
    try {
      result = inflateRaw(data, raw.size, limit)
    } catch (error) {
      if (error instanceof InflateError) throw new ZipError('damaged', error.message)
      throw error
    }
  } else {
    throw new ZipError('method', `compression method ${raw.method}`)
  }
  if (!result.truncated) {
    if (result.bytes.length !== raw.size) throw new ZipError('damaged', 'the entry is shorter than the archive says')
    if (crc32(result.bytes) !== raw.crc) throw new ZipError('damaged', 'CRC-32 check failed')
  }
  return result
}

/** MS-DOS date and time fields as local time; undefined when unset. */
export function dosTime(date: number, time: number): number | undefined {
  if (date === 0) return undefined
  const year = 1980 + (date >> 9)
  const month = ((date >> 5) & 15) - 1
  const day = date & 31
  if (month < 0 || month > 11 || day < 1) return undefined
  return new Date(year, month, day, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime()
}
