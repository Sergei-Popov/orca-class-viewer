// How much one view may write. A crafted class packs millions of annotations, table rows or
// attributes into a few kilobytes of a jar, and a view that wrote them all would run the frame
// out of memory. Each view takes its rows from one budget, a long line taking several, and says
// what it left out once the budget is spent.

/** The most rows the Outline or the Bytecode tab writes. */
export const MAX_LISTED_ROWS = 1_000_000

/** The Structure tab builds real elements, so it writes fewer. */
export const MAX_STRUCTURE_ROWS = 50_000

/** A line takes one row for every this many characters. */
export const ROW_CHARS = 120

/** The rows a line of `chars` characters takes. */
export const rowsOf = (chars: number): number => (chars <= ROW_CHARS ? 1 : Math.ceil(chars / ROW_CHARS))

/** The rows a view may still write. Once something did not fit, nothing more does. */
export class RowBudget {
  left: number
  /** True once something did not fit. */
  cut = false

  constructor(limit: number = MAX_LISTED_ROWS) {
    this.left = limit
  }

  /** Takes `rows` when they fit. */
  take(rows: number): boolean {
    if (this.cut || rows > this.left) {
      this.cut = true
      return false
    }
    this.left -= rows
    return true
  }

  /** Takes the rows of a line of `chars` characters. */
  line(chars: number): boolean {
    return this.take(rowsOf(chars))
  }
}

/**
 * A member's annotations past this many are counted, not written: real code has a handful, and a
 * crafted method gives each of 255 parameters 65,535.
 */
export const MAX_MEMBER_ANNOTATIONS = 100

/** A list written into one line stops with "…" past this many characters: it may name 65,535 classes. */
export const MAX_LINE_CHARS = 100_000

/** The texts of `items` while they stay within `max` characters, then "…" for the rest. */
export function listWithin<T>(items: readonly T[], text: (item: T, index: number) => string, max = MAX_LINE_CHARS): string[] {
  const out: string[] = []
  let chars = 0
  for (let i = 0; i < items.length; i++) {
    if (i && chars > max) {
      out.push('…')
      break
    }
    const s = text(items[i], i)
    out.push(s)
    chars += s.length + 2
  }
  return out
}

/** `listWithin` joined into one line. */
export function joinWithin<T>(items: readonly T[], text: (item: T, index: number) => string, separator = ', ', max = MAX_LINE_CHARS): string {
  return listWithin(items, text, max).join(separator)
}
