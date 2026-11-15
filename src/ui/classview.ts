// One class: a header with its name and a "Java N" badge, notices for damaged, newer or
// obfuscated files, and four tabs — Outline, Bytecode, Structure and Constant pool — each built
// the first time it is shown. A file that is not a class at all gets a message and its first bytes.

import { ClassFormatError } from '../classfile/bytes'
import { type ClassFile, parseClass } from '../classfile/classfile'
import { makeNamer, methodParts, sourceSimpleName } from '../classfile/declarations'
import { type LanguageInfo, detectLanguage } from '../classfile/language'
import { binaryName, displayName, hasHiddenCharacters } from '../classfile/names'
import { buildOutline } from '../classfile/outline'
import { NEWEST_KNOWN_MAJOR, javaRelease } from '../classfile/versions'
import { type Seg, classListing } from '../bytecode/listing'
import { CodeView, type LinkData, type Span, type ViewLine } from './codeview'
import { copyText, h, storageGet, storageSet, svg } from './dom'
import { type Env, fill, hexDump, reasonText, saveFile, sizeText } from './env'
import { icon } from './icons'
import { type JavaState, type TokenKind, tokenizeJava } from './java'
import { PoolTable } from './pooltable'
import { buildStructure } from './structure'

export type ClassContext = {
  /** Other classes of the same archive, for member classes in the outline. */
  resolve?: (name: string) => ClassFile | undefined
  /** Opens another class of the same archive. */
  openClass?: (name: string) => void
  hasClass?: (name: string) => boolean
  /** Shown under the header, such as the version switch of a multi-release jar. */
  extra?: HTMLElement
}

type TabName = 'outline' | 'bytecode' | 'structure' | 'pool'

const TABS: TabName[] = ['outline', 'bytecode', 'structure', 'pool']
const TAB_KEY = 'class-viewer.tab'
const ZIP = [0x50, 0x4b, 0x03, 0x04]

const SEG_CLASS: Record<Seg['kind'], string | undefined> = {
  plain: undefined,
  java: undefined,
  op: 't-op',
  offset: 't-offset',
  label: 't-label',
  num: 't-num',
  comment: 't-com',
  key: 't-key',
  cp: 't-cp',
  jump: 't-label',
  bad: 't-bad'
}

const TOKEN_CLASS: Record<TokenKind, string | undefined> = {
  kw: 't-kw',
  type: 't-type',
  str: 't-str',
  num: 't-num',
  com: 't-com',
  ann: 't-ann',
  plain: undefined
}

function javaSpans(text: string, state: JavaState): Span[] {
  return tokenizeJava(text, state).map((tok) => ({ text: tok.text, cls: TOKEN_CLASS[tok.kind] }))
}

/** Splits spans so that [start, end) is a span of its own, and gives it `link`. */
function linkRange(spans: Span[], start: number, end: number, link: LinkData, title: string): Span[] {
  const out: Span[] = []
  let pos = 0
  for (const s of spans) {
    const a = pos
    const b = pos + s.text.length
    pos = b
    if (b <= start || a >= end) {
      out.push(s)
      continue
    }
    if (start > a) out.push({ ...s, text: s.text.slice(0, start - a) })
    out.push({ ...s, text: s.text.slice(Math.max(start, a) - a, Math.min(end, b) - a), link, title })
    if (end < b) out.push({ ...s, text: s.text.slice(end - a) })
  }
  return out
}

export class ClassView {
  readonly root: HTMLElement
  private readonly env: Env
  private cls: ClassFile | undefined
  private lang: LanguageInfo | undefined
  private ctx: ClassContext = {}
  private tab: TabName
  private readonly header: HTMLElement
  private readonly notices: HTMLElement
  private readonly tabBar: HTMLElement
  private readonly tools: HTMLElement
  private readonly panes: HTMLElement
  private readonly findInput: HTMLInputElement
  private readonly findCount: HTMLElement
  private readonly findBox: HTMLElement
  private readonly methodSelect: HTMLSelectElement
  private readonly copyButton: HTMLButtonElement
  private readonly saveButton: HTMLButtonElement
  private built = new Map<TabName, { el: HTMLElement; code?: CodeView; pool?: PoolTable }>()
  private tabButtons = new Map<TabName, HTMLButtonElement>()

  constructor(env: Env) {
    this.env = env
    const t = env.t
    const stored = storageGet(TAB_KEY) as TabName | null
    this.tab = stored && TABS.includes(stored) ? stored : 'outline'
    this.header = h('div', { className: 'cv-bar' })
    this.notices = h('div', { className: 'cv-notices' })
    this.tabBar = h('div', { className: 'cv-tabs', role: 'tablist', 'aria-label': t.tabsLabel })
    this.findInput = h('input', { type: 'search', placeholder: t.find, 'aria-label': t.find, title: t.findHint, spellcheck: 'false' })
    this.findCount = h('span', { className: 'cv-find-count', 'aria-live': 'polite' })
    const prev = this.iconButton('up', t.prevMatch, () => this.stepFind(-1))
    const next = this.iconButton('down', t.nextMatch, () => this.stepFind(1))
    this.findBox = h('div', { className: 'cv-tools' }, h('label', { className: 'cv-search' }, svg(icon('search')), this.findInput), this.findCount, prev, next)
    this.methodSelect = h('select', { className: 'cv-select', 'aria-label': t.goToMethod })
    this.copyButton = this.iconButton('copy', t.copyAll, () => void this.copy())
    this.saveButton = h('button', { className: 'cv-btn', type: 'button' }, svg(icon('save')), t.save)
    this.saveButton.addEventListener('click', () => this.save())
    this.tools = h('div', { className: 'cv-tools' }, this.methodSelect, this.findBox, this.copyButton, this.saveButton)
    this.tabBar.append(this.tools)
    this.panes = h('div', { className: 'cv-panes' })
    this.root = h('div', { className: 'cv-app' }, this.header, this.notices, this.tabBar, this.panes)

    for (const name of TABS) {
      const button = h('button', { className: 'cv-tab', role: 'tab', type: 'button', 'aria-selected': 'false' })
      button.addEventListener('click', () => this.setTab(name))
      this.tabButtons.set(name, button)
      this.tabBar.insertBefore(button, this.tools)
    }
    this.tabBar.addEventListener('keydown', (event) => {
      if (!(event.target instanceof HTMLElement) || !event.target.classList.contains('cv-tab')) return
      const at = TABS.indexOf(this.tab)
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const next = TABS[(at + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
        this.setTab(next)
        this.tabButtons.get(next)?.focus()
        event.preventDefault()
      }
    })
    this.findInput.addEventListener('input', () => this.runFind())
    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.stepFind(event.shiftKey ? -1 : 1)
        event.preventDefault()
      } else if (event.key === 'Escape') {
        if (this.findInput.value) {
          this.findInput.value = ''
          this.runFind()
        } else this.current()?.code?.root.focus()
        event.preventDefault()
      }
    })
    this.methodSelect.addEventListener('change', () => {
      const index = Number(this.methodSelect.value)
      if (Number.isInteger(index) && index >= 0) this.showMethod(index)
      this.methodSelect.value = ''
    })
  }

  /** Cmd/Ctrl+F: the find box, or the pool's filter. */
  focusFind(): void {
    if (this.tab === 'pool') this.built.get('pool')?.pool?.focusFilter()
    else if (this.tab !== 'structure') {
      this.findInput.focus()
      this.findInput.select()
    }
  }

  /** Cmd/Ctrl+G and F3. */
  stepFind(direction: 1 | -1): void {
    const code = this.current()?.code
    if (!code || !this.findInput.value) return
    this.showCount(code.step(direction))
  }

  /** Shows a class file; returns the parsed class, or undefined when it is not one. */
  show(bytes: Uint8Array, ctx: ClassContext = {}): ClassFile | undefined {
    this.ctx = ctx
    this.built.clear()
    this.panes.replaceChildren()
    this.notices.replaceChildren()
    this.header.replaceChildren()
    let cls: ClassFile
    try {
      cls = parseClass(bytes)
    } catch (error) {
      this.cls = undefined
      this.showNotClass(bytes, error)
      return undefined
    }
    this.cls = cls
    this.lang = detectLanguage(cls)
    this.renderHeader(cls, this.lang)
    this.renderNotices(cls)
    if (ctx.extra) this.notices.prepend(ctx.extra)
    this.tabBar.hidden = false
    const t = this.env.t
    const labels: Record<TabName, string> = { outline: t.tabOutline, bytecode: t.tabBytecode, structure: t.tabStructure, pool: t.tabPool }
    for (const [name, button] of this.tabButtons) {
      button.replaceChildren(labels[name])
      if (name === 'pool') button.append(h('span', { className: 'cv-count' }, Math.max(0, cls.pool.count - 1).toLocaleString(this.env.locale)))
      if (name === 'bytecode') button.append(h('span', { className: 'cv-count' }, cls.methods.length.toLocaleString(this.env.locale)))
    }
    // Damage before the members leaves the outline empty: start where there is something.
    const early = cls.error && !cls.name
    this.setTab(early ? 'structure' : this.tab, false)
    return cls
  }

  private current() {
    return this.built.get(this.tab)
  }

  private setTab(name: TabName, remember = true): void {
    if (!this.cls) return
    this.tab = name
    if (remember) storageSet(TAB_KEY, name)
    for (const [n, button] of this.tabButtons) {
      button.setAttribute('aria-selected', String(n === name))
      button.tabIndex = n === name ? 0 : -1
    }
    let pane = this.built.get(name)
    if (!pane) {
      pane = this.build(name, this.cls)
      this.built.set(name, pane)
      this.panes.append(pane.el)
    }
    for (const [n, p] of this.built) p.el.hidden = n !== name
    const code = name === 'outline' || name === 'bytecode'
    this.findBox.hidden = !code
    this.methodSelect.hidden = name !== 'bytecode' || this.cls.methods.length === 0
    this.copyButton.hidden = name === 'structure'
    this.saveButton.hidden = !code || !this.env.saveAs
    this.saveButton.title = name === 'outline' ? this.env.t.saveOutline : this.env.t.saveListing
    if (code) this.runFind()
  }

  private build(name: TabName, cls: ClassFile): { el: HTMLElement; code?: CodeView; pool?: PoolTable } {
    const t = this.env.t
    if (name === 'outline') {
      const view = new CodeView({ label: t.tabOutline })
      view.setLines(this.outlineLines(cls))
      view.onLink = (link) => this.follow(link)
      return { el: h('div', { className: 'cv-pane' }, view.root), code: view }
    }
    if (name === 'bytecode') {
      const view = new CodeView({ label: t.tabBytecode, gutter: false })
      view.setLines(this.listingLines(cls))
      view.onLink = (link) => this.follow(link)
      this.fillMethodSelect(cls)
      return { el: h('div', { className: 'cv-pane' }, view.root), code: view }
    }
    if (name === 'structure') {
      const doc = buildStructure(cls, this.lang ?? { language: 'java' }, this.env, {
        showPool: (i) => this.showPool(i),
        showMethod: (i) => this.showMethod(i),
        openClass: this.ctx.openClass,
        hasClass: this.ctx.hasClass
      })
      return { el: h('div', { className: 'cv-pane' }, doc) }
    }
    const pool = new PoolTable(cls, this.env, { showCode: (m, offset) => this.showCode(m, offset) })
    return { el: pool.root, pool }
  }

  private outlineLines(cls: ClassFile): ViewLine[] {
    const outline = buildOutline(cls, { resolve: this.ctx.resolve, comments: this.env.t.comments })
    const state: JavaState = { comment: false }
    return outline.lines.map((line) => {
      let spans = javaSpans(line.text, state)
      const target = line.target
      if (target?.kind === 'method' && target.owner === cls.name) {
        const paren = line.text.indexOf('(')
        let start = paren
        while (start > 0 && /[\p{L}\p{N}_$\\]/u.test(line.text[start - 1])) start--
        if (paren > start) spans = linkRange(spans, start, paren, { kind: 'method', index: target.index }, this.env.t.showBytecode)
      } else if (target?.kind === 'class' && this.ctx.hasClass?.(target.name) && this.ctx.openClass) {
        const m = /\{ \/\* .* \*\/ \}$/.exec(line.text)
        if (m) spans = linkRange(spans, m.index + 5, line.text.length - 5, { kind: 'class', name: target.name }, fill(this.env.t.openClass, { name: displayName(binaryName(target.name)) }))
      }
      return { text: line.text, spans }
    })
  }

  private listingLines(cls: ClassFile): ViewLine[] {
    const t = this.env.t
    return classListing(cls).map((line) => {
      const spans: Span[] = []
      for (const seg of line.segs) {
        if (seg.kind === 'java') {
          spans.push(...javaSpans(seg.text, { comment: false }))
        } else if (seg.kind === 'cp' && seg.ref !== undefined) {
          spans.push({ text: seg.text, cls: 't-cp', link: { kind: 'cp', index: seg.ref }, title: fill(t.showPool, { n: seg.ref }) })
        } else if (seg.kind === 'jump' && seg.ref !== undefined && line.method !== undefined) {
          spans.push({ text: seg.text, cls: 't-label', link: { kind: 'jump', method: line.method, offset: seg.ref }, title: fill(t.goToOffset, { n: seg.ref }) })
        } else {
          spans.push({ text: seg.text, cls: SEG_CLASS[seg.kind] })
        }
      }
      return { text: line.segs.map((s) => s.text).join(''), spans, anchor: line.anchor }
    })
  }

  private fillMethodSelect(cls: ClassFile): void {
    const namer = makeNamer(cls, false)
    this.methodSelect.replaceChildren(h('option', { value: '' }, this.env.t.goToMethod))
    cls.methods.forEach((m, k) => {
      let label: string
      try {
        const parts = methodParts(cls, m, namer)
        label = `${parts.name}(${parts.paramTypes.join(', ')})`
      } catch {
        label = `${displayName(m.name)}${displayName(m.descriptor)}`
      }
      this.methodSelect.append(h('option', { value: String(k) }, label))
    })
    this.methodSelect.value = ''
  }

  private follow(link: LinkData): void {
    if (link.kind === 'cp') this.showPool(link.index)
    else if (link.kind === 'jump') this.showCode(link.method, link.offset)
    else if (link.kind === 'method') this.showMethod(link.index)
    else if (link.kind === 'class') this.ctx.openClass?.(link.name)
  }

  private showPool(index: number): void {
    this.setTab('pool')
    this.built.get('pool')?.pool?.select(index, true)
  }

  private showMethod(index: number): void {
    this.setTab('bytecode')
    const code = this.built.get('bytecode')?.code
    const line = code?.lineOf(`m${index}`)
    if (code && line !== undefined) code.reveal(line, { top: true, flash: true })
  }

  private showCode(method: number, offset: number): void {
    this.setTab('bytecode')
    const code = this.built.get('bytecode')?.code
    const line = code?.lineOf(`m${method}@${offset}`) ?? code?.lineOf(`m${method}`)
    if (code && line !== undefined) code.reveal(line, { flash: true })
  }

  private runFind(): void {
    const code = this.current()?.code
    if (!code) return
    const q = this.findInput.value
    this.showCount(code.find(q))
  }

  private showCount(result: { count: number; index: number }): void {
    const t = this.env.t
    if (!this.findInput.value) this.findCount.textContent = ''
    else if (!result.count) this.findCount.textContent = t.noMatches
    else this.findCount.textContent = fill(t.matchOf, { i: (result.index + 1).toLocaleString(this.env.locale), n: result.count.toLocaleString(this.env.locale) })
  }

  private async copy(): Promise<void> {
    const pane = this.current()
    const text = pane?.code?.text() ?? pane?.pool?.copyText()
    if (text === undefined) return
    this.env.toast((await copyText(text)) ? this.env.t.copied : this.env.t.copyFailed)
  }

  private save(): void {
    const cls = this.cls
    const code = this.current()?.code
    if (!cls || !code) return
    const simple = (sourceSimpleName(cls) || 'Class').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    if (this.tab === 'outline') saveFile(this.env, `${simple}.java`, `${code.text()}\n`, 'text/x-java')
    else saveFile(this.env, `${simple}.javap.txt`, `${code.text()}\n`, 'text/plain')
  }

  private iconButton(name: Parameters<typeof icon>[0], title: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', { className: 'cv-btn cv-square', type: 'button', title, 'aria-label': title }, svg(icon(name)))
    button.addEventListener('click', onClick)
    return button
  }

  private renderHeader(cls: ClassFile, lang: LanguageInfo): void {
    const t = this.env.t
    const full = cls.name ? displayName(binaryName(cls.name)) : '?'
    const dot = full.lastIndexOf('.')
    const title = h('h1', { title: full })
    if (dot > 0) title.append(h('span', { className: 'cv-pkg' }, full.slice(0, dot + 1)))
    title.append(dot > 0 ? full.slice(dot + 1) : full)
    const kindIcon = cls.name.endsWith('module-info') ? 'module' : 'classfile'
    this.header.append(h('div', { className: 'cv-title' }, svg(icon(kindIcon)), title))
    const release = javaRelease(cls.major, cls.minor)
    const label = release.unknown ? fill(t.javaUnknown, { n: cls.major }) : fill(release.preview ? t.javaPreview : t.java, { n: release.release })
    const versionTitle = fill(t.versionTitle, { release: label, major: cls.major, minor: cls.minor }) + (release.preview ? `\n${t.previewTitle}` : '')
    this.header.append(h('span', { className: release.newer || release.unknown ? 'cv-badge cv-warn' : 'cv-badge cv-java', title: versionTitle }, label))
    if (lang.language !== 'java' && lang.language !== 'other') {
      const name = { kotlin: t.languageKotlin, scala: t.languageScala, groovy: t.languageGroovy, clojure: t.languageClojure }[lang.language]
      const tip = lang.kotlin?.version ? fill(t.kotlinTitle, { version: lang.kotlin.version }) : fill(t.languageTitle, { language: name })
      this.header.append(h('span', { className: 'cv-badge', title: tip }, name))
    }
    if (cls.error) this.header.append(h('span', { className: 'cv-badge cv-bad', title: cls.error.message }, t.damagedBadge))
    this.header.append(h('span', { className: 'cv-spacer' }), h('span', { className: 'cv-summary' }, sizeText(this.env, cls.size)))
  }

  private renderNotices(cls: ClassFile): void {
    const t = this.env.t
    const notice = (tone: string, iconName: 'warning' | 'info', title: string | undefined, text: string, detail?: string) => {
      const body = h('span', { title: detail })
      if (title) body.append(h('strong', {}, title))
      body.append(text)
      this.notices.append(h('div', { className: `cv-notice ${tone}` }, svg(icon(iconName)), body))
    }
    const release = javaRelease(cls.major, cls.minor)
    if (release.unknown) notice('', 'warning', undefined, fill(t.unknownMajor, { major: cls.major }))
    else if (release.newer) {
      notice('', 'warning', t.newerTitle, fill(t.newerText, { major: cls.major, known: NEWEST_KNOWN_MAJOR, release: fill(t.java, { n: NEWEST_KNOWN_MAJOR - 44 }) }))
    }
    if (cls.error) {
      notice('cv-bad', 'warning', t.damagedTitle, fill(t.damagedText, { offset: cls.error.offset.toLocaleString(this.env.locale), reason: reasonText(this.env, cls.error) }), cls.error.message)
    }
    if (cls.trailing > 0) notice('cv-info', 'info', undefined, fill(t.trailingText, { n: t.bytes(cls.trailing) }))
    if (hasObfuscatedNames(cls)) notice('cv-info', 'info', undefined, t.hiddenText)
  }

  private showNotClass(bytes: Uint8Array, error: unknown): void {
    const t = this.env.t
    this.tabBar.hidden = true
    this.header.append(h('div', { className: 'cv-title' }, svg(icon('classfile')), h('h1', {}, t.appName)))
    const empty = error instanceof ClassFormatError && error.code === 'empty'
    const head = Array.from(bytes.subarray(0, 4), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    const box = h('div', { className: 'cv-center' }, svg(icon('warning')), h('h2', {}, empty ? t.emptyTitle : t.notClassTitle), h('p', {}, empty ? t.emptyText : fill(t.notClassText, { bytes: head || '—' })))
    if (!empty && ZIP.every((b, i) => bytes[i] === b)) box.append(h('p', {}, t.notClassZip))
    if (!empty) {
      const n = Math.min(bytes.length, 256)
      box.append(h('p', {}, fill(t.firstBytes, { n: t.bytes(n) })), h('pre', { className: 'cv-hex' }, hexDump(bytes, n)))
      box.append(h('p', { className: 'cv-hint' }, sizeText(this.env, bytes.length)))
    }
    if (!(error instanceof ClassFormatError)) console.warn('[class-viewer] cannot read the class', error)
    this.panes.append(h('div', { className: 'cv-pane' }, box))
  }
}

function hasObfuscatedNames(cls: ClassFile): boolean {
  if (hasHiddenCharacters(cls.name)) return true
  for (const m of cls.fields) if (hasHiddenCharacters(m.name)) return true
  for (const m of cls.methods) if (hasHiddenCharacters(m.name)) return true
  return false
}
