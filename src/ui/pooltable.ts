// The Constant pool tab: every entry with its type, the entries it points at (as links), its
// value, and how often the class uses it. Selecting an entry lists what refers to it: other
// entries, instructions in the bytecode and parts of the class such as its name or attributes.

import type { ClassFile } from '../classfile/classfile'
import { displayName } from '../classfile/names'
import { TAG_NAMES } from '../classfile/pool'
import { MAX_LISTED_ROWS } from '../bytecode/listing'
import { type PoolUsage, type UseSite, poolUsage } from '../classfile/usage'
import { clamp, h, svg } from './dom'
import { icon } from './icons'
import { type Env, fill } from './env'

const ROW = 24
const OVERSCAN = 10
const LIST_LIMIT = 300

export type PoolActions = {
  showCode: (method: number, offset: number) => void
}

/** A use site in the reader's language: "method add · Code · exception table". */
export function useSiteText(t: Env['t'], site: UseSite): string {
  const name = displayName(site.name ?? '')
  const owner =
    site.owner === 'class' ? t.useClass : fill(site.owner === 'field' ? t.useField : site.owner === 'method' ? t.useMethod : t.useComponent, { name })
  const parts = { name: t.useName, descriptor: t.useDescriptor, attributeName: t.useAttributeName, exceptionTable: t.useExceptionTable, argument: t.useArgument }
  // Steps name attributes as the file does: an unknown attribute's name may hold anything.
  return [owner, ...site.path.map((step) => (typeof step === 'string' ? displayName(step) : parts[step.part]))].join(' · ')
}

type Row = { index: number; tag: string; refs: number[]; value: string; uses: number; state: 'entry' | 'slot' | 'missing' }

export class PoolTable {
  readonly root: HTMLElement
  private readonly scroll: HTMLElement
  private readonly body: HTMLElement
  private readonly detail: HTMLElement
  private readonly filterInput: HTMLInputElement
  private readonly typeSelect: HTMLSelectElement
  private readonly countEl: HTMLElement
  private readonly all: Row[]
  private rows: Row[]
  private readonly usage: PoolUsage
  private selected = -1
  private flash = -1
  private frame = 0
  private query = ''

  constructor(
    private readonly cls: ClassFile,
    private readonly env: Env,
    private readonly actions: PoolActions
  ) {
    const t = env.t
    const pool = cls.pool
    this.usage = poolUsage(cls)
    this.all = []
    for (let i = 1; i < pool.count; i++) {
      const e = pool.get(i)
      if (e) {
        const u = this.usage[i]
        this.all.push({ index: i, tag: TAG_NAMES[e.tag], refs: pool.refs(i), value: displayValue(pool.text(i), e.tag), uses: u.referredBy.length + u.code.length + u.sites.length, state: 'entry' })
      } else {
        const prev = pool.get(i - 1)
        const slot = prev?.tag === 5 || prev?.tag === 6
        this.all.push({ index: i, tag: '', refs: [], value: slot ? t.poolEmptySlot : t.poolMissing, uses: 0, state: slot ? 'slot' : 'missing' })
      }
    }
    this.rows = this.all

    this.filterInput = h('input', { type: 'search', placeholder: t.poolFilter, 'aria-label': t.poolFilter, spellcheck: 'false' })
    this.typeSelect = h('select', { className: 'cv-select', 'aria-label': t.poolType }, h('option', { value: '' }, t.poolAllTypes))
    const tags = [...new Set(this.all.filter((r) => r.state === 'entry').map((r) => r.tag))].sort()
    for (const tag of tags) this.typeSelect.append(h('option', { value: tag }, tag))
    this.countEl = h('span', { className: 'cv-find-count' })
    const search = h('label', { className: 'cv-search' }, svg(icon('search')), this.filterInput)
    const bar = h('div', { className: 'cv-bar' }, search, this.typeSelect, h('span', { className: 'cv-spacer' }), this.countEl)

    this.body = h('div', { className: 'cv-tbody', role: 'rowgroup' })
    const head = h(
      'div',
      { className: 'cv-thead', role: 'row' },
      h('span', { style: 'text-align:right' }, t.poolIndex),
      h('span', {}, t.poolType),
      h('span', {}, t.poolRefs),
      h('span', {}, t.poolValue),
      h('span', { style: 'text-align:right' }, t.poolUses)
    )
    this.scroll = h('div', { className: 'cv-table-scroll', tabindex: 0, role: 'grid', 'aria-label': t.tabPool }, head, this.body)
    this.detail = h('div', { className: 'cv-detail' }, h('span', { className: 'cv-hint' }, t.poolPick))
    this.root = h('div', { className: 'cv-pane' }, bar, h('div', { className: 'cv-pool' }, this.scroll, this.detail))

    this.scroll.addEventListener('scroll', () => this.schedule())
    new ResizeObserver(() => this.schedule()).observe(this.scroll)
    this.filterInput.addEventListener('input', () => this.applyFilter())
    this.filterInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.filterInput.value) {
        this.filterInput.value = ''
        this.applyFilter()
        event.preventDefault()
      } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        if (this.rows.length && !this.rows.some((r) => r.index === this.selected)) this.select(this.rows[0].index)
        this.scroll.focus({ preventScroll: true })
        event.preventDefault()
      }
    })
    this.typeSelect.addEventListener('change', () => this.applyFilter())
    this.body.addEventListener('mousedown', (event) => {
      if (event.button === 0 && !(event.target instanceof Element && event.target.closest('.cv-a'))) {
        event.preventDefault()
        this.scroll.focus({ preventScroll: true })
      }
    })
    this.body.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      const link = target?.closest<HTMLElement>('[data-ref]')
      if (link) {
        this.select(Number(link.dataset.ref), true)
        return
      }
      const row = target?.closest<HTMLElement>('.cv-trow')
      if (row) this.select(Number(row.dataset.index))
    })
    this.detail.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      const ref = target?.closest<HTMLElement>('[data-ref]')
      if (ref) this.select(Number(ref.dataset.ref), true)
      const code = target?.closest<HTMLElement>('[data-method]')
      if (code) this.actions.showCode(Number(code.dataset.method), Number(code.dataset.offset))
    })
    this.scroll.addEventListener('keydown', (event) => this.onKey(event))
    this.updateCount()
    this.schedule()
  }

  focusFilter(): void {
    this.filterInput.focus()
    this.filterInput.select()
  }

  /** Selects entry `index`, clearing a filter that hides it; `flash` marks it for a moment. */
  select(index: number, flash = false): void {
    if (!this.all.some((r) => r.index === index)) return
    if (!this.rows.some((r) => r.index === index)) {
      this.filterInput.value = ''
      this.typeSelect.value = ''
      this.applyFilter()
    }
    this.selected = index
    const at = this.rows.findIndex((r) => r.index === index)
    const y = at * ROW
    const head = 26
    const view = this.scroll.clientHeight - head
    if (y < this.scroll.scrollTop || y + ROW > this.scroll.scrollTop + view) this.scroll.scrollTop = Math.max(0, y - Math.round(view / 3))
    if (flash) {
      this.flash = index
      setTimeout(() => {
        if (this.flash === index) this.flash = -1
        this.redraw()
      }, 1200)
    }
    this.renderDetail()
    this.redraw()
  }

  copyText(): string {
    const pool = this.cls.pool
    const lines: string[] = []
    for (const r of this.rows) {
      if (r.state !== 'entry') continue
      const refs = r.refs.map((x) => `#${x}`).join(r.tag === 'NameAndType' || r.refs.length === 2 ? '.' : ', ')
      const head = `${`#${r.index}`.padStart(6)} = ${r.tag.padEnd(18)} ${refs}`
      lines.push(refs ? `${head.padEnd(46)} // ${pool.text(r.index)}` : `${head}${displayValue(pool.text(r.index), pool.get(r.index)?.tag ?? 0)}`)
    }
    return lines.join('\n')
  }

  private applyFilter(): void {
    const q = this.filterInput.value.trim().toLowerCase()
    const type = this.typeSelect.value
    this.query = q
    const byIndex = /^#?(\d+)$/.exec(q)
    this.rows = this.all.filter((r) => {
      if (type && r.tag !== type) return false
      if (!q) return true
      if (byIndex && r.index === Number(byIndex[1])) return true
      return r.value.toLowerCase().includes(q) || r.tag.toLowerCase() === q
    })
    this.scroll.scrollTop = 0
    this.updateCount()
    this.redraw()
  }

  private updateCount(): void {
    const t = this.env.t
    const total = this.all.filter((r) => r.state === 'entry').length
    const shown = this.rows.filter((r) => r.state === 'entry').length
    this.countEl.textContent = shown === total ? t.poolEntries(total) : fill(t.poolShown, { n: shown.toLocaleString(this.env.locale), total: total.toLocaleString(this.env.locale) })
  }

  private onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const at = this.rows.findIndex((r) => r.index === this.selected)
    const page = Math.max(1, Math.floor(this.scroll.clientHeight / ROW) - 2)
    const move = (to: number) => {
      if (this.rows.length) this.select(this.rows[clamp(to, 0, this.rows.length - 1)].index)
    }
    switch (event.key) {
      case 'ArrowDown':
        move(at + 1)
        break
      case 'ArrowUp':
        move(at < 0 ? this.rows.length - 1 : at - 1)
        break
      case 'PageDown':
        move(at + page)
        break
      case 'PageUp':
        move(at - page)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(this.rows.length - 1)
        break
      default:
        return
    }
    event.preventDefault()
  }

  private redraw(): void {
    this.body.replaceChildren()
    this.schedule()
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private render(): void {
    this.body.style.height = `${this.rows.length * ROW}px`
    const top = Math.max(0, this.scroll.scrollTop - 26)
    const height = this.scroll.clientHeight || 600
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN)
    const last = Math.min(this.rows.length, Math.ceil((top + height) / ROW) + OVERSCAN)
    const keep = new Map<number, Element>()
    for (const el of Array.from(this.body.children)) keep.set(Number((el as HTMLElement).dataset.pos), el)
    for (const [pos, el] of keep) if (pos < first || pos >= last) el.remove()
    for (let pos = first; pos < last; pos++) {
      if (keep.has(pos) && pos >= first && pos < last) continue
      this.body.append(this.rowElement(pos))
    }
  }

  private rowElement(pos: number): HTMLElement {
    const r = this.rows[pos]
    const cls = ['cv-trow']
    if (r.index === this.flash) cls.push('cv-flash')
    const row = h('div', { className: cls.join(' '), role: 'row', 'data-index': r.index, 'data-pos': pos, 'aria-selected': r.index === this.selected ? 'true' : 'false' })
    row.style.top = `${pos * ROW}px`
    row.append(h('span', { className: 'cv-idx' }, `#${r.index}`))
    if (r.state !== 'entry') {
      row.append(h('span', {}), h('span', {}), h('span', { className: 'cv-empty-slot' }, r.value), h('span', {}))
      return row
    }
    row.append(h('span', { className: 'cv-tag' }, r.tag))
    const refs = h('span', {})
    r.refs.forEach((x, k) => {
      if (k) refs.append(r.refs.length === 2 ? '.' : ', ')
      refs.append(h('button', { className: 'cv-a t-cp', 'data-ref': x, title: fill(this.env.t.showPool, { n: x }) }, `#${x}`))
    })
    row.append(refs)
    const value = h('span', { title: r.value.length > 80 ? r.value.slice(0, 2000) : undefined })
    value.append(markText(r.value.length > 600 ? `${r.value.slice(0, 600)}…` : r.value, this.query))
    row.append(value, h('span', { className: 'cv-uses' }, r.uses ? String(r.uses) : '—'))
    return row
  }

  private renderDetail(): void {
    const t = this.env.t
    const i = this.selected
    const pool = this.cls.pool
    const e = pool.get(i)
    this.detail.replaceChildren()
    if (!e) {
      this.detail.append(h('span', { className: 'cv-hint' }, t.poolPick))
      return
    }
    const u = this.usage[i]
    this.detail.append(h('h3', {}, `#${i} · ${TAG_NAMES[e.tag]}`), h('div', { className: 'cv-dvalue' }, displayValue(pool.text(i), e.tag)))
    // Elements only for the items shown: a constant may be used a million times.
    const list = <T>(title: string, items: readonly T[], make: (item: T) => HTMLElement) => {
      if (!items.length) return
      const ul = h('ul', {})
      for (let k = 0; k < Math.min(items.length, LIST_LIMIT); k++) ul.append(h('li', {}, make(items[k])))
      if (items.length > LIST_LIMIT) ul.append(h('li', { className: 'cv-hint' }, fill(t.poolMore, { n: items.length - LIST_LIMIT })))
      this.detail.append(h('h3', {}, title), ul)
    }
    const chip = (x: number) => h('button', { className: 'cv-chip t-cp', 'data-ref': x, title: pool.text(x).slice(0, 300) }, `#${x} ${TAG_NAMES[pool.get(x)?.tag ?? 0] ?? '?'}`)
    list(t.poolRefs, pool.refs(i), chip)
    list(t.poolReferredBy, u.referredBy, chip)
    list(t.poolUsedInCode, u.code, (c) =>
      h('button', { className: 'cv-chip', 'data-method': c.method, 'data-offset': c.offset, title: fill(t.goToOffset, { n: c.offset }) }, `${displayName(this.cls.methods[c.method]?.name ?? '?')} @${c.offset}`)
    )
    if (this.usage.codeCut) this.detail.append(h('p', { className: 'cv-hint' }, fill(t.poolCodeCut, { n: MAX_LISTED_ROWS.toLocaleString(this.env.locale) })))
    list(t.poolUsedByClass, [...new Set(u.sites.map((s) => useSiteText(t, s)))], (w) => h('span', { className: 'cv-hint' }, w))
    if (!u.referredBy.length && !u.code.length && !u.sites.length) this.detail.append(h('p', { className: 'cv-hint' }, t.poolNotUsed))
  }
}

/** Utf8 and String values as they are, everything else as javap writes it. */
function displayValue(text: string, _tag: number): string {
  return text
}

function markText(text: string, q: string): DocumentFragment {
  const f = document.createDocumentFragment()
  if (!q) {
    f.append(text)
    return f
  }
  const lower = text.toLowerCase()
  let at = 0
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
    if (i > at) f.append(text.slice(at, i))
    f.append(h('mark', {}, text.slice(i, i + q.length)))
    at = i + q.length
  }
  if (at < text.length) f.append(text.slice(at))
  return f
}
