// Classes of a jar read only to resolve names (an outline's member and local classes, the module
// descriptor), kept within a byte budget: an archive of small classes padded to megabytes cannot
// make one outline unpack and hold gigabytes.

import { type ClassFile, parseClass } from '../classfile/classfile'
import type { Zip, ZipEntry } from '../zip/zip'

/** Larger classes are not read to resolve names. */
export const RESOLVE_LIMIT = 4 * 1024 * 1024
/** Bytes of parsed classes held at most; past it the cache starts again. */
export const CACHE_BUDGET = 64 * 1024 * 1024
const MAX_CLASSES = 2000

export class ClassCache {
  private readonly zip: Zip
  private readonly budget: number
  private readonly limit: number
  private readonly classes = new Map<string, ClassFile | null>()
  private held = 0

  constructor(zip: Zip, budget = CACHE_BUDGET, limit = RESOLVE_LIMIT) {
    this.zip = zip
    this.budget = budget
    this.limit = limit
  }

  /** The class in `entry`, parsed once; undefined when it is missing, too large or damaged. */
  get(key: string, entry: ZipEntry | undefined): ClassFile | undefined {
    if (this.classes.has(key)) return this.classes.get(key) ?? undefined
    let cls: ClassFile | null = null
    let size = 0
    if (entry && entry.size <= this.limit) {
      try {
        const read = this.zip.read(entry, this.limit)
        if (!read.truncated) {
          cls = parseClass(read.bytes)
          size = read.bytes.length
        }
      } catch {
        cls = null
      }
    }
    if (this.classes.size >= MAX_CLASSES || this.held + size > this.budget) {
      this.classes.clear()
      this.held = 0
    }
    this.classes.set(key, cls)
    this.held += size
    return cls ?? undefined
  }

  /** Bytes of the classes held now. */
  get bytes(): number {
    return this.held
  }
}
