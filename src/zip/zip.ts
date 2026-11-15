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
  /** The name exactly as the central directory stores it. The JVM looks entries up by it. */
  name: string
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
  /**
   * The archive holds another directory a tool could take for its own: a second end record that
   * checks out, or a ZIP64 record java.util.zip does not use. `entries` is what java.util.zip reads.
   */
  ambiguous: boolean
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

const sigAt = (b: Uint8Array, at: number, sig: number) => at >= 0 && at + 4 <= b.length && u32(b, at) === sig

/** An end record that java.util.zip accepts: its comment ends the file, or the directory and the
 *  first local header sit where it says (ZipFile.Source.findEND). */
function acceptedEnd(bytes: Uint8Array, at: number): boolean {
  if (at + 22 + u16(bytes, at + 20) === bytes.length) return true
  const cenpos = at - u32(bytes, at + 12)
  return sigAt(bytes, cenpos, SIG_CENTRAL) && sigAt(bytes, cenpos - u32(bytes, at + 16), SIG_LOCAL)
}

const isEnd = (b: Uint8Array, i: number) => b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6

/**
 * The end record java.util.zip reads, and whether another one could pass for it: a record nearer
 * the end of the file that java.util.zip passes over (a tool that takes the last one reads that),
 * or one further back whose comment reaches the end of the file (a tool that wants an exact
 * comment reads that). A nested jar's own end record inside an entry is neither.
 */
function scanEnds(bytes: Uint8Array): { end: number; other: boolean } {
  const last = bytes.length - 22
  let end = -1
  let other = false
  for (let i = last, stop = Math.max(0, last - 0xffff); i >= stop; i--) {
    if (!isEnd(bytes, i)) continue
    if (end < 0) {
      if (acceptedEnd(bytes, i)) end = i
      else other = true
    } else if (i + 22 + u16(bytes, i + 20) === bytes.length) {
      other = true
      break
    }
  }
  return { end, other }
}

/**
 * The end of central directory record java.util.zip reads: the one nearest the end of the file
 * whose comment reaches the end, or whose directory and first local header check out. Searched
 * past a comment of up to 64 KB; -1 when there is none.
 */
export function findEndOfCentralDirectory(bytes: Uint8Array): number {
  return scanEnds(bytes).end
}

/** Where the directory is, as java.util.zip takes it from an end record and its ZIP64 record. */
type Directory = { total: number; size: number; offset: number; end: number; zip64Ignored: boolean }

function directoryOf(bytes: Uint8Array, end: number): Directory {
  const d: Directory = { total: u16(bytes, end + 10), size: u32(bytes, end + 12), offset: u32(bytes, end + 16), end, zip64Ignored: false }
  // A ZIP64 record is used only when each of its values matches the end record's or the end
  // record holds the "see ZIP64" value there; the locator's offset is not guessed at.
  const locator = end - 20
  if (!sigAt(bytes, locator, SIG_LOCATOR64)) return d
  const end64 = u64(bytes, locator + 8)
  const found = end64 + 56 <= bytes.length && sigAt(bytes, end64, SIG_END64)
  // A ZIP64 end record right before the locator, where some tools look when the offset is off.
  const near = locator - 56
  if (!found) {
    d.zip64Ignored = sigAt(bytes, near, SIG_END64) && u64(bytes, near + 48) !== d.offset
    return d
  }
  const total = u64(bytes, end64 + 32)
  const size = u64(bytes, end64 + 40)
  const offset = u64(bytes, end64 + 48)
  const agrees =
    (size === d.size || d.size === 0xffffffff) && (offset === d.offset || d.offset === 0xffffffff) && (total === d.total || d.total === 0xffff)
  if (!agrees) {
    d.zip64Ignored = true
    return d
  }
  return { total, size, offset, end: end64, zip64Ignored: false }
}

type Raw = ZipEntry & { localOffset: number; flags: number }

export function openZip(bytes: Uint8Array): Zip {
  const scan = scanEnds(bytes)
  const end = scan.end
  if (end < 0) throw new ZipError('not-zip', 'no ZIP end record')
  const dir = directoryOf(bytes, end)
  const commentLength = u16(bytes, end + 20)
  // The directory sits right before its end record, whatever offset is stored; the difference
  // is data before the archive (a launcher script, a jmod's header), which shifts every offset.
  let cdStart = dir.end - dir.size
  let shift = cdStart - dir.offset
  let damaged = false
  if (cdStart < 0 || shift < 0 || (dir.size > 0 && !sigAt(bytes, cdStart, SIG_CENTRAL))) {
    // java.util.zip refuses such an archive; show what the stored offset leads to.
    damaged = true
    cdStart = dir.offset
    shift = 0
  }
  const cdEnd = damaged ? bytes.length : dir.end
  // Another end record or a ZIP64 record java.util.zip passes over: other tools may list other entries.
  const ambiguous = scan.other || dir.zip64Ignored

  const raws: Raw[] = []
  let at = cdStart
  const total = dir.total
  for (;;) {
    if (at + 46 > cdEnd || u32(bytes, at) !== SIG_CENTRAL) {
      damaged ||= (raws.length < total && total !== 0xffff) || (!damaged && at !== cdEnd)
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
    if (nameEnd > cdEnd) {
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
      name,
      path: normalizePath(name),
      // A folder holds nothing: an entry named like one that has data is a file to the JVM,
      // which finds it under the name without the slash.
      dir: size === 0 && (/[/\\]$/.test(name) || (external & 0x10) !== 0),
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
    ambiguous,
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
