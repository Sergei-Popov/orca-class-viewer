// Classes of a jar read only to resolve names (an outline's member and local classes, the module
// descriptor). Two limits keep a crafted archive of small classes padded to megabytes in check:
// the classes held stay within a budget of their parsed size, oldest dropped first, and one view
// unpacks at most a read budget of classes it does not find held.

import { type ClassFile, parseClass } from '../classfile/classfile'
import type { Zip, ZipEntry } from '../zip/zip'

/** Larger classes are not read to resolve names; member classes are rarely past 100 KiB. */
export const RESOLVE_LIMIT = 1024 * 1024
/**
 * A parsed class takes up to about this many times its bytes in memory: a crafted one whose 65,535
 * empty attributes a member each become an object does, in the frame's V8; real classes take less.
 */
export const MODEL_FACTOR = 20
/** The parsed size, `MODEL_FACTOR` times the bytes, of the classes held at most; past it the
 *  oldest are dropped. An outline holds only the members it is writing, so this bounds it too. */
export const CACHE_BUDGET = 128 * 1024 * 1024
/** Bytes one view (one class's outline) may unpack to resolve names. */
export const READ_BUDGET = 64 * 1024 * 1024
const MAX_CLASSES = 2000

/** What is left of a view's read budget, shared by its lookups. */
export type ReadBudget = { left: number }

export const readBudget = (bytes = READ_BUDGET): ReadBudget => ({ left: bytes })

type Held = { cls: ClassFile | null; size: number }

export class ClassCache {
  private readonly zip: Zip
  private readonly budget: number
  private readonly limit: number
  private readonly classes = new Map<string, Held>()
  private held = 0

  constructor(zip: Zip, budget = CACHE_BUDGET, limit = RESOLVE_LIMIT) {
    this.zip = zip
    this.budget = budget
    this.limit = limit
  }

  /**
   * The class in `entry`, parsed once; undefined when it is missing, too large or damaged, or
   * when reading it would pass `reads`. A class left unread for the budget is not remembered,
   * so a later view with a budget of its own can read it.
   */
  get(key: string, entry: ZipEntry | undefined, reads?: ReadBudget): ClassFile | undefined {
    const known = this.classes.get(key)
    if (known) return known.cls ?? undefined
    let cls: ClassFile | null = null
    let size = 0
    if (entry && entry.size <= this.limit) {
      if (reads) {
        if (entry.size > reads.left) return undefined
        reads.left -= entry.size
      }
      try {
        const read = this.zip.read(entry, this.limit)
        if (!read.truncated) {
          cls = parseClass(read.bytes)
          size = read.bytes.length * MODEL_FACTOR
        }
      } catch {
        cls = null
      }
    }
    if (this.classes.size >= MAX_CLASSES) this.drop(1)
    if (this.held + size > this.budget) this.drop(this.held + size - this.budget)
    this.classes.set(key, { cls, size })
    this.held += size
    return cls ?? undefined
  }

  /** Drops the oldest classes until `bytes` are freed, or one class when `bytes` is 1. */
  private drop(bytes: number): void {
    let freed = 0
    for (const [key, h] of this.classes) {
      if (freed >= bytes) break
      this.classes.delete(key)
      this.held -= h.size
      freed += Math.max(h.size, 1)
    }
  }

  /** The parsed size of the classes held now, `MODEL_FACTOR` times their bytes. */
  get bytes(): number {
    return this.held
  }
}
