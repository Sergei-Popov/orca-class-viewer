// A read-only code view that renders only the lines in sight, so a class with 60 000 lines of
// bytecode scrolls as fast as a small one. Lines are coloured spans; spans can link to the
// constant pool, a jump target or a method. Find marks every match and steps through them.

import { h } from './dom'

export type LinkData =
  | { kind: 'cp'; index: number }
  | { kind: 'jump'; method: number; offset: number }
  | { kind: 'method'; index: number }
  | { kind: 'class'; name: string }

export type Span = { text: string; cls?: string; link?: LinkData; title?: string }

export type ViewLine = { text: string; spans: Span[]; anchor?: string }

const LINE = 18
const PAD = 8
const OVERSCAN = 20
/** Longer lines are cut on screen (Copy and Save keep them whole). */
const MAX_RENDER = 4000
const MAX_MATCHES = 50_000

type Match = { line: number; start: number; end: number }

export function plainLine(text: string, cls?: string): ViewLine {
  return { text, spans: [{ text, cls }] }
}

export class CodeView {
  readonly root: HTMLElement
  private readonly sizer: HTMLElement
  private readonly rows: HTMLElement
  private readonly gutter: boolean
  private lines: ViewLine[] = []
  private anchors = new Map<string, number>()
  private matches: Match[] = []
  private byLine = new Map<number, number[]>()
  private current = -1
  private rendered = new Map<number, HTMLElement>()
  private frame = 0
  private flashLine = -1
  private flashTimer: ReturnType<typeof setTimeout> | undefined
  private charWidth = 0
  private digits = 1
  onLink?: (link: LinkData, event: MouseEvent) => void

  constructor(options: { gutter?: boolean; label: string }) {
    this.gutter = options.gutter ?? true
    this.rows = h('div', { className: 'cv-rows' })
    this.sizer = h('div', { className: 'cv-sizer' }, this.rows)
    this.root = h('div', { className: 'cv-code', tabindex: 0, role: 'document', 'aria-label': options.label }, this.sizer)
    this.root.addEventListener('scroll', () => this.schedule())
    new ResizeObserver(() => this.schedule()).observe(this.root)
    this.rows.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.cv-link') : null
      if (!target || !this.onLink) return
      const row = target.closest<HTMLElement>('.cv-line')
      const line = this.lines[Number(row?.dataset.i)]
      const link = line?.spans[Number(target.dataset.s)]?.link
      if (link) this.onLink(link, event)
    })
  }

  setLines(lines: ViewLine[]): void {
    this.lines = lines
    this.anchors.clear()
    let longest = 0
    lines.forEach((l, i) => {
      if (l.anchor) this.anchors.set(l.anchor, i)
      if (l.text.length > longest) longest = l.text.length
    })
    this.digits = String(lines.length).length
    this.root.style.setProperty('--digits', String(this.digits))
    this.sizer.style.height = `${lines.length * LINE + PAD * 2}px`
    this.sizer.style.width = `calc(${Math.min(longest, MAX_RENDER + 2)}ch + ${this.gutter ? this.digits + 3 : 0}ch + 32px)`
    this.root.classList.toggle('cv-no-gutter', !this.gutter)
    this.matches = []
    this.byLine.clear()
    this.current = -1
    this.clearRendered()
    this.schedule()
  }

  get lineCount(): number {
    return this.lines.length
  }

  text(): string {
    return this.lines.map((l) => l.text).join('\n')
  }

  lineOf(anchor: string): number | undefined {
    return this.anchors.get(anchor)
  }

  /** Scrolls line `index` into view; `flash` marks it for a moment. */
  reveal(index: number, options: { flash?: boolean; top?: boolean; column?: number } = {}): void {
    if (index < 0 || index >= this.lines.length) return
    const view = this.root.clientHeight
    const y = PAD + index * LINE
    if (options.top) this.root.scrollTop = Math.max(0, y - LINE * 2)
    else if (y < this.root.scrollTop + LINE || y + LINE > this.root.scrollTop + view - LINE) {
      this.root.scrollTop = Math.max(0, y - Math.round(view / 3))
    }
    if (options.column !== undefined) {
      const x = (options.column + (this.gutter ? this.digits + 3 : 0)) * this.measureChar()
      const width = this.root.clientWidth
      if (x < this.root.scrollLeft + 40 || x > this.root.scrollLeft + width - 80) this.root.scrollLeft = Math.max(0, x - width / 3)
    }
    if (options.flash) {
      this.flashLine = index
      clearTimeout(this.flashTimer)
      this.flashTimer = setTimeout(() => {
        this.flashLine = -1
        this.clearRendered()
        this.schedule()
      }, 1400)
      this.clearRendered()
    }
    this.schedule()
  }

  /** Marks every case-insensitive match of `query`; returns how many there are. */
  find(query: string): { count: number; index: number } {
    this.matches = []
    this.byLine.clear()
    this.current = -1
    const q = query.toLowerCase()
    if (q) {
      for (let i = 0; i < this.lines.length && this.matches.length < MAX_MATCHES; i++) {
        const text = this.lines[i].text.toLowerCase()
        for (let at = text.indexOf(q); at >= 0 && this.matches.length < MAX_MATCHES; at = text.indexOf(q, at + q.length)) {
          const list = this.byLine.get(i)
          if (list) list.push(this.matches.length)
          else this.byLine.set(i, [this.matches.length])
          this.matches.push({ line: i, start: at, end: at + q.length })
        }
      }
      // Start from the first match at or below the top of the view.
      const top = Math.floor(Math.max(0, this.root.scrollTop - PAD) / LINE)
      const first = this.matches.findIndex((m) => m.line >= top)
      if (this.matches.length) this.go(first < 0 ? 0 : first)
    }
    this.clearRendered()
    this.schedule()
    return { count: this.matches.length, index: this.current }
  }

  step(direction: 1 | -1): { count: number; index: number } {
    const n = this.matches.length
    if (n) this.go((this.current + direction + n) % n)
    return { count: n, index: this.current }
  }

  private go(index: number): void {
    this.current = index
    const m = this.matches[index]
    this.clearRendered()
    this.reveal(m.line, { column: m.start })
  }

  private measureChar(): number {
    if (!this.charWidth) {
      const probe = h('span', { className: 'cv-probe' }, '0'.repeat(20))
      this.root.append(probe)
      this.charWidth = probe.getBoundingClientRect().width / 20 || 7.2
      probe.remove()
    }
    return this.charWidth
  }

  private clearRendered(): void {
    this.rendered.clear()
    this.rows.replaceChildren()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private render(): void {
    const top = this.root.scrollTop
    const height = this.root.clientHeight || 600
    const first = Math.max(0, Math.floor((top - PAD) / LINE) - OVERSCAN)
    const last = Math.min(this.lines.length, Math.ceil((top + height - PAD) / LINE) + OVERSCAN)
    for (const [i, el] of this.rendered) {
      if (i < first || i >= last) {
        el.remove()
        this.rendered.delete(i)
      }
    }
    for (let i = first; i < last; i++) {
      if (this.rendered.has(i)) continue
      const el = this.renderLine(i)
      this.rendered.set(i, el)
      this.rows.append(el)
    }
  }

  private renderLine(i: number): HTMLElement {
    const line = this.lines[i]
    const row = h('div', { className: i === this.flashLine ? 'cv-line cv-flash' : 'cv-line', 'data-i': i })
    row.style.top = `${PAD + i * LINE}px`
    if (this.gutter) row.append(h('span', { className: 'cv-ln', 'aria-hidden': 'true' }, String(i + 1)))
    const code = h('span', { className: 'cv-text' })
    const marks = (this.byLine.get(i) ?? []).map((k) => ({ ...this.matches[k], current: k === this.current }))
    let pos = 0
    line.spans.forEach((span, s) => {
      if (pos >= MAX_RENDER) return
      const text = span.text.length + pos > MAX_RENDER ? span.text.slice(0, MAX_RENDER - pos) : span.text
      const start = pos
      pos += text.length
      if (!text) return
      const hit = marks.filter((m) => m.end > start && m.start < start + text.length)
      if (!span.cls && !span.link && !span.title && !hit.length) {
        code.append(text)
        return
      }
      const el = h('span', { className: span.link ? `${span.cls ?? ''} cv-link` : (span.cls ?? ''), 'data-s': s, title: span.title })
      let at = 0
      for (const m of hit) {
        const a = Math.max(m.start - start, at)
        const b = Math.min(m.end - start, text.length)
        if (b <= a) continue
        if (a > at) el.append(text.slice(at, a))
        el.append(h('mark', { className: m.current ? 'cv-cur' : '' }, text.slice(a, b)))
        at = b
      }
      if (at < text.length) el.append(text.slice(at))
      code.append(el)
    })
    if (line.text.length > MAX_RENDER) code.append(h('span', { className: 'cv-more' }, ` … +${line.text.length - MAX_RENDER}`))
    row.append(code)
    return row
  }
}
