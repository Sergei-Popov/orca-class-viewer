// A jar, war, ear, jmod or aar: packages and classes on the left, the selected class (with all
// its tabs), resource or archive on the right, and an overview of the archive when nothing is
// selected — what it was compiled for, its manifest, its main class and the archives inside.
// Archives inside open in place, with a breadcrumb back.

import type { ClassFile } from '../classfile/classfile'
import { parseClass, peekVersion } from '../classfile/classfile'
import { binaryName, displayName } from '../classfile/names'
import { javaRelease } from '../classfile/versions'
import { type ClassRef, type JarKind, type JarModel, type JarNode, buildJar, findClass, jarKind, walk } from '../jar/jar'
import { KEY_ATTRIBUTES } from '../jar/manifest'
import { type ZipEntry, ZipError, openZip } from '../zip/zip'
import { ClassView } from './classview'
import { CodeView, type ViewLine, plainLine } from './codeview'
import { clamp, copyText, h, highlight, storageGet, storageSet, svg } from './dom'
import { type Env, fill, hexDump, saveFile, sizeText } from './env'
import { type IconName, icon } from './icons'
import { tokenizeJava } from './java'

const ROW = 24
const OVERSCAN = 10
const MAX_DEPTH = 4
const NESTED_LIMIT = 64 * 1024 * 1024
const TEXT_LIMIT = 2 * 1024 * 1024
const IMAGE_LIMIT = 16 * 1024 * 1024
const HEX_LIMIT = 4096
const CLASS_LIMIT = 64 * 1024 * 1024
const SCAN_CHUNK = 400
const TREE_KEY = 'class-viewer.tree'

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}
const TEXT_TYPES = new Set(
  'mf sf txt md properties xml json yml yaml html htm css js mjs ts kt kts java scala groovy gradle sql csv tsv conf cfg ini toml list factories imports idx policy jsp tld xsd dtd wsdl xsl xslt pom license notice'.split(' ')
)

const ext = (path: string) => {
  const leaf = path.slice(path.lastIndexOf('/') + 1)
  const dot = leaf.lastIndexOf('.')
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : leaf.toLowerCase()
}

type Level = {
  model: JarModel
  label: string
  open: Set<string>
  selected: string | null
  scrollTop: number
  filter: string
  parents: Map<string, JarNode | null>
  byId: Map<string, JarNode>
  versions?: Map<number, number>
  scanned: number
  parsed: Map<string, ClassFile | null>
  /** The release a multi-release class is shown for, by class name. */
  release: Map<string, number>
}

type Row = { node: JarNode; depth: number; nested: number }

export class JarView {
  readonly root: HTMLElement
  private readonly env: Env
  private levels: Level[] = []
  private rows: Row[] = []
  private readonly crumbs: HTMLElement
  private readonly summary: HTMLElement
  private readonly main: HTMLElement
  private readonly split: HTMLElement
  private readonly tree: HTMLElement
  private readonly scroll: HTMLElement
  private readonly rowsEl: HTMLElement
  private readonly filterInput: HTMLInputElement
  private readonly detail: HTMLElement
  private readonly notice: HTMLElement
  private classView: ClassView | undefined
  private frame = 0
  private detailToken = 0
  private scanTimer: ReturnType<typeof setTimeout> | undefined
  private blobUrl: string | undefined

  constructor(env: Env) {
    this.env = env
    const t = env.t
    this.crumbs = h('nav', { className: 'cv-crumbs', 'aria-label': t.path })
    this.summary = h('span', { className: 'cv-summary' })
    const expand = this.iconButton('expand', t.expandAll, () => this.setAll(true))
    const collapse = this.iconButton('collapse', t.collapseAll, () => this.setAll(false))
    const bar = h('div', { className: 'cv-bar' }, this.crumbs, this.summary, h('span', { className: 'cv-spacer' }), expand, collapse)
    this.notice = h('div', { className: 'cv-notice', hidden: true })
    this.filterInput = h('input', { type: 'search', placeholder: t.treeFilter, 'aria-label': t.treeFilter, title: t.treeFilterHint, spellcheck: 'false' })
    this.rowsEl = h('div', { className: 'cv-trows', role: 'presentation' })
    this.scroll = h('div', { className: 'cv-scroll', tabindex: 0, role: 'tree', 'aria-label': t.treeLabel }, this.rowsEl)
    this.tree = h('div', { className: 'cv-tree' }, h('div', { className: 'cv-tree-bar' }, h('label', { className: 'cv-search' }, svg(icon('search')), this.filterInput)), this.scroll)
    this.split = h('div', { className: 'cv-split', role: 'separator', 'aria-orientation': 'vertical' })
    this.detail = h('div', { className: 'cv-detailpane' })
    this.main = h('div', { className: 'cv-main' }, this.tree, this.split, this.detail)
    const width = Number(storageGet(TREE_KEY))
    if (width > 0) this.main.style.setProperty('--tree', `${width}px`)
    this.root = h('div', { className: 'cv-app' }, bar, this.notice, this.main)
    this.wire()
  }

  get level(): Level | undefined {
    return this.levels[this.levels.length - 1]
  }

  show(bytes: Uint8Array, kind: JarKind): void {
    const previous = this.levels[0]
    let model: JarModel
    try {
      model = buildJar(openZip(bytes), kind)
    } catch (error) {
      this.levels = []
      this.rows = []
      this.renderRows()
      this.crumbs.replaceChildren(h('span', { className: 'cv-crumb', 'aria-current': 'true' }, this.env.t[kind]))
      this.summary.textContent = sizeText(this.env, bytes.length)
      if (error instanceof ZipError && error.code === 'not-zip') {
        const t = this.env.t
        const head = Array.from(bytes.subarray(0, 4), (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
        const extra = head === 'CA FE BA BE' ? [t.notZipClass] : []
        this.root.classList.add('cv-alone')
        this.showMessage(t.notZipTitle, fill(t.notZipText, { bytes: head || '—' }), hexDump(bytes, Math.min(256, bytes.length)), extra)
      } else {
        throw error
      }
      return
    }
    this.root.classList.remove('cv-alone')
    const level = this.newLevel(model, this.env.t[kind])
    // A reload after an outside write keeps what was open and selected.
    if (previous) {
      for (const id of previous.open) if (level.byId.has(id)) level.open.add(id)
      if (previous.selected && level.byId.has(previous.selected)) level.selected = previous.selected
      level.scrollTop = previous.scrollTop
      level.filter = previous.filter
    }
    this.levels = [level]
    this.renderLevel(false)
  }

  focusFind(): void {
    if (this.classView && this.detail.contains(document.activeElement)) this.classView.focusFind()
    else {
      this.filterInput.focus()
      this.filterInput.select()
    }
  }

  stepFind(direction: 1 | -1): void {
    this.classView?.stepFind(direction)
  }

  private newLevel(model: JarModel, label: string): Level {
    const parents = new Map<string, JarNode | null>()
    const byId = new Map<string, JarNode>()
    const visit = (nodes: JarNode[], parent: JarNode | null) => {
      for (const n of nodes) {
        parents.set(n.id, parent)
        byId.set(n.id, n)
        visit(n.children, n)
      }
    }
    visit(model.tree, null)
    const open = new Set<string>()
    for (const n of model.tree) if (n.kind === 'root') open.add(n.id)
    const packages = model.tree.filter((n) => n.kind === 'package' || n.kind === 'root')
    if (packages.length === 1) open.add(packages[0].id)
    return { model, label, open, selected: null, scrollTop: 0, filter: '', parents, byId, scanned: 0, parsed: new Map(), release: new Map() }
  }

  private renderLevel(focus: boolean): void {
    const level = this.level
    if (!level) return
    const t = this.env.t
    this.filterInput.value = level.filter
    this.crumbs.replaceChildren()
    this.levels.forEach((l, i) => {
      if (i) this.crumbs.append(h('span', { className: 'cv-crumb-sep', 'aria-hidden': 'true' }, svg(icon('chevron'))))
      const current = i === this.levels.length - 1
      const crumb = h('button', { className: 'cv-crumb', type: 'button', 'aria-current': current ? 'true' : 'false', title: l.label }, l.label)
      if (!current) crumb.addEventListener('click', () => this.goTo(i))
      this.crumbs.append(crumb)
    })
    const m = level.model
    const packages = [...walk(m.tree)].filter((n) => n.kind === 'package').length
    this.summary.textContent = [t.classes(m.classCount), t.packages(packages), t.resources(m.resourceCount), m.nested.length ? t.archives(m.nested.length) : '', sizeText(this.env, m.zip.size)]
      .filter(Boolean)
      .join(' · ')
    this.notice.hidden = !m.zip.damaged
    if (m.zip.damaged) this.notice.replaceChildren(svg(icon('warning')), h('span', {}, t.zipDamaged))
    this.refreshRows()
    this.scroll.scrollTop = level.scrollTop
    this.renderDetail()
    this.startScan(level)
    if (focus) this.scroll.focus({ preventScroll: true })
  }

  private goTo(index: number): void {
    this.levels = this.levels.slice(0, index + 1)
    this.renderLevel(true)
  }

  // Tree

  private refreshRows(): void {
    const level = this.level
    if (!level) return
    const q = level.filter.trim().toLowerCase()
    const rows: Row[] = []
    if (!q) {
      const add = (nodes: JarNode[], depth: number, nested: number) => {
        for (const n of nodes) {
          rows.push({ node: n, depth, nested })
          if (n.children.length && level.open.has(n.id)) add(n.children, depth + 1, n.kind === 'class' ? nested + 1 : nested)
        }
      }
      add(level.model.tree, 0, 0)
    } else {
      // Matches and the folders above them, all open.
      const keep = (n: JarNode): boolean => {
        const self = n.label.toLowerCase().includes(q) || (n.className !== undefined && binaryName(n.className).toLowerCase().includes(q))
        let child = false
        for (const c of n.children) if (keep(c)) child = true
        if (self || child) marked.add(n.id)
        return self || child
      }
      const marked = new Set<string>()
      for (const n of level.model.tree) keep(n)
      const add = (nodes: JarNode[], depth: number, nested: number) => {
        for (const n of nodes) {
          if (!marked.has(n.id)) continue
          rows.push({ node: n, depth, nested })
          add(n.children, depth + 1, n.kind === 'class' ? nested + 1 : nested)
        }
      }
      add(level.model.tree, 0, 0)
    }
    this.rows = rows
    this.renderRows()
  }

  private scheduleRows(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.drawRows()
    })
  }

  private renderRows(): void {
    this.rowsEl.replaceChildren()
    this.scheduleRows()
  }

  private drawRows(): void {
    const level = this.level
    this.rowsEl.style.height = `${this.rows.length * ROW}px`
    if (!level) return
    if (!this.rows.length) {
      const t = this.env.t
      this.rowsEl.replaceChildren(h('div', { className: 'cv-center' }, h('p', {}, level.filter ? fill(t.treeNoMatches, { q: level.filter }) : t.treeEmpty)))
      return
    }
    const top = this.scroll.scrollTop
    const height = this.scroll.clientHeight || 600
    const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN)
    const last = Math.min(this.rows.length, Math.ceil((top + height) / ROW) + OVERSCAN)
    const existing = new Map<number, HTMLElement>()
    for (const el of Array.from(this.rowsEl.children) as HTMLElement[]) {
      const i = Number(el.dataset.row)
      if (!Number.isInteger(i) || i < first || i >= last) el.remove()
      else existing.set(i, el)
    }
    for (let i = first; i < last; i++) if (!existing.has(i)) this.rowsEl.append(this.rowElement(i, level))
  }

  private kindIcon(node: JarNode, nested: number): [IconName, string] {
    switch (node.kind) {
      case 'package':
        return ['package', 'k-package']
      case 'root':
        return ['root', 'k-root']
      case 'folder':
        return ['folder', 'k-folder']
      case 'archive':
        return ['archive', 'k-archive']
      case 'class':
        if (node.label === 'module-info' || node.label === 'package-info') return ['module', 'k-class']
        return nested > 0 ? ['inner', 'k-inner'] : ['classfile', 'k-class']
      default: {
        const e = ext(node.path)
        if (node.path.toUpperCase().endsWith('MANIFEST.MF')) return ['manifest', '']
        if (IMAGE_TYPES[e]) return ['image', '']
        return [TEXT_TYPES.has(e) ? 'text' : 'file', '']
      }
    }
  }

  private rowElement(index: number, level: Level): HTMLElement {
    const { node, depth, nested } = this.rows[index]
    const t = this.env.t
    const open = level.filter.trim() !== '' || level.open.has(node.id)
    const row = h('div', {
      className: 'cv-node',
      role: 'treeitem',
      'data-row': index,
      'aria-level': depth + 1,
      'aria-selected': String(node.id === level.selected),
      'aria-expanded': node.children.length ? String(open) : undefined
    })
    row.style.top = `${index * ROW}px`
    row.style.paddingLeft = `${6 + depth * 14}px`
    const twisty = h('span', { className: 'cv-twisty', 'data-open': String(open) })
    if (node.children.length) twisty.append(svg(icon('chevron')))
    const [name, cls] = this.kindIcon(node, nested)
    row.append(twisty, h('span', { className: `cv-kind ${cls}` }, svg(icon(name))))
    const label = h('span', { className: 'cv-label', title: node.path })
    label.append(highlight(displayName(node.label), level.filter))
    row.append(label)
    if (node.versions?.length) {
      row.append(h('span', { className: 'cv-mr', title: t.versionsLabel }, node.versions.map((v) => v.release).join(', ')))
    }
    if ((node.kind === 'package' || node.kind === 'root') && node.classCount) row.append(h('span', { className: 'cv-note' }, node.classCount.toLocaleString(this.env.locale)))
    else if ((node.kind === 'file' || node.kind === 'archive') && node.entry) row.append(h('span', { className: 'cv-note' }, sizeText(this.env, node.entry.size)))
    return row
  }

  private rowAt(event: Event): Row | undefined {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('.cv-node') : null
    return el ? this.rows[Number(el.dataset.row)] : undefined
  }

  private select(id: string | null, reveal = true): void {
    const level = this.level
    if (!level) return
    level.selected = id
    if (id && reveal) this.reveal(id)
    this.renderRows()
    this.renderDetail()
  }

  private reveal(id: string): void {
    const level = this.level
    if (!level) return
    for (let p = level.parents.get(id); p; p = level.parents.get(p.id)) level.open.add(p.id)
    this.refreshRows()
    const index = this.rows.findIndex((r) => r.node.id === id)
    if (index < 0) return
    const y = index * ROW
    if (y < this.scroll.scrollTop || y + ROW > this.scroll.scrollTop + this.scroll.clientHeight) {
      this.scroll.scrollTop = Math.max(0, y - Math.round(this.scroll.clientHeight / 3))
    }
  }

  private toggle(node: JarNode, open?: boolean): void {
    const level = this.level
    if (!level || !node.children.length || level.filter.trim()) return
    const now = open ?? !level.open.has(node.id)
    if (now) level.open.add(node.id)
    else level.open.delete(node.id)
    this.refreshRows()
  }

  private setAll(open: boolean): void {
    const level = this.level
    if (!level) return
    level.open.clear()
    if (open) for (const n of walk(level.model.tree)) if (n.children.length && n.kind !== 'class') level.open.add(n.id)
    this.refreshRows()
  }

  private wire(): void {
    this.scroll.addEventListener('scroll', () => {
      const level = this.level
      if (level) level.scrollTop = this.scroll.scrollTop
      this.scheduleRows()
    })
    new ResizeObserver(() => this.scheduleRows()).observe(this.scroll)
    this.rowsEl.addEventListener('mousedown', (event) => {
      if (event.button === 0) event.preventDefault()
      this.scroll.focus({ preventScroll: true })
    })
    this.rowsEl.addEventListener('click', (event) => {
      const row = this.rowAt(event)
      if (!row) return
      const onTwisty = event.target instanceof Element && event.target.closest('.cv-twisty')
      if (onTwisty) this.toggle(row.node)
      this.select(row.node.id, false)
    })
    this.rowsEl.addEventListener('dblclick', (event) => {
      const row = this.rowAt(event)
      if (!row || (event.target instanceof Element && event.target.closest('.cv-twisty'))) return
      if (row.node.kind === 'archive') void this.openNested(row.node)
      else this.toggle(row.node)
    })
    this.scroll.addEventListener('keydown', (event) => this.onTreeKey(event))
    this.filterInput.addEventListener('input', () => {
      const level = this.level
      if (!level) return
      level.filter = this.filterInput.value
      this.scroll.scrollTop = 0
      this.refreshRows()
    })
    this.filterInput.addEventListener('keydown', (event) => {
      const level = this.level
      if (!level) return
      if (event.key === 'Escape') {
        if (this.filterInput.value) {
          this.filterInput.value = ''
          level.filter = ''
          this.refreshRows()
        } else this.scroll.focus({ preventScroll: true })
        event.preventDefault()
      } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        const shown = this.rows.some((r) => r.node.id === level.selected)
        const firstClass = this.rows.find((r) => r.node.kind === 'class') ?? this.rows[0]
        if (!shown && firstClass) this.select(firstClass.node.id)
        this.scroll.focus({ preventScroll: true })
        event.preventDefault()
      }
    })
    this.split.addEventListener('pointerdown', (event) => {
      if (getComputedStyle(this.split).cursor !== 'col-resize') return
      event.preventDefault()
      this.split.setPointerCapture(event.pointerId)
      this.split.classList.add('cv-dragging')
      const box = this.main.getBoundingClientRect()
      let width = 0
      const move = (e: PointerEvent) => {
        width = Math.round(clamp(e.clientX - box.left, 220, Math.max(220, box.width - 320)))
        this.main.style.setProperty('--tree', `${width}px`)
      }
      const end = () => {
        this.split.classList.remove('cv-dragging')
        this.split.removeEventListener('pointermove', move)
        if (width) storageSet(TREE_KEY, String(width))
      }
      this.split.addEventListener('pointermove', move)
      this.split.addEventListener('pointerup', end, { once: true })
      this.split.addEventListener('pointercancel', end, { once: true })
    })
    this.split.addEventListener('dblclick', () => {
      this.main.style.removeProperty('--tree')
      storageSet(TREE_KEY, null)
    })
  }

  private onTreeKey(event: KeyboardEvent): void {
    const level = this.level
    if (!level || event.metaKey || event.ctrlKey || event.altKey) return
    const rows = this.rows
    const index = rows.findIndex((r) => r.node.id === level.selected)
    const row = index >= 0 ? rows[index] : undefined
    const page = Math.max(1, Math.floor(this.scroll.clientHeight / ROW) - 1)
    const move = (to: number) => {
      if (rows.length) this.select(rows[clamp(to, 0, rows.length - 1)].node.id)
    }
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1)
        break
      case 'ArrowUp':
        move(index < 0 ? rows.length - 1 : index - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(rows.length - 1)
        break
      case 'PageDown':
        move(index + page)
        break
      case 'PageUp':
        move(index - page)
        break
      case 'ArrowRight':
        if (row?.node.children.length) {
          if (!level.open.has(row.node.id) && !level.filter.trim()) this.toggle(row.node, true)
          else move(index + 1)
        }
        break
      case 'ArrowLeft': {
        if (!row) break
        if (row.node.children.length && level.open.has(row.node.id) && !level.filter.trim()) this.toggle(row.node, false)
        else {
          const parent = level.parents.get(row.node.id)
          if (parent) this.select(parent.id)
        }
        break
      }
      case 'Enter':
        if (!row) break
        if (row.node.kind === 'archive') void this.openNested(row.node)
        else this.toggle(row.node)
        break
      case 'Escape':
        if (level.filter) {
          level.filter = ''
          this.filterInput.value = ''
          this.refreshRows()
        } else if (this.levels.length > 1) this.goTo(this.levels.length - 2)
        else if (level.selected !== null) this.select(null)
        else return
        break
      case 'Backspace':
        if (this.levels.length < 2) return
        this.goTo(this.levels.length - 2)
        break
      default:
        return
    }
    event.preventDefault()
  }

  // Detail

  private clearDetail(): void {
    this.detailToken++
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = undefined
    }
    this.detail.replaceChildren()
  }

  private renderDetail(): void {
    const level = this.level
    this.clearDetail()
    if (!level) return
    const node = level.selected ? level.byId.get(level.selected) : undefined
    if (!node || node.kind === 'package' || node.kind === 'root' || node.kind === 'folder') {
      this.classView = undefined
      this.detail.append(node ? this.folderView(node, level) : this.overview(level))
      return
    }
    if (node.kind === 'class') this.classDetail(node, level)
    else if (node.kind === 'archive') this.archiveDetail(node, level)
    else this.fileDetail(node, level)
  }

  private classDetail(node: JarNode, level: Level): void {
    const t = this.env.t
    const name = node.className ?? node.label
    const release = level.release.get(name)
    const version = node.versions?.find((v) => v.release === release)
    const entry = version?.entry ?? node.entry
    if (!entry) return
    let bytes: Uint8Array
    try {
      const read = level.model.zip.read(entry, CLASS_LIMIT)
      if (read.truncated) throw new ZipError('too-large', 'too large')
      bytes = read.bytes
    } catch (error) {
      this.classView = undefined
      this.detail.append(this.entryError(error, entry))
      return
    }
    const extra = h('div', { className: 'cv-subbar' }, h('span', { className: 'cv-path', title: entry.path }, entry.path))
    if (node.versions?.length) {
      const seg = h('div', { className: 'cv-seg', role: 'group', 'aria-label': t.versionsLabel })
      const choices = [{ label: t.baseVersion, release: undefined as number | undefined }, ...node.versions.map((v) => ({ label: fill(t.releaseVersion, { n: v.release }), release: v.release as number | undefined }))]
      for (const c of choices) {
        const b = h('button', { type: 'button', 'aria-pressed': String(c.release === release) }, c.label)
        b.addEventListener('click', () => {
          if (c.release === undefined) level.release.delete(name)
          else level.release.set(name, c.release)
          this.renderDetail()
        })
        seg.append(b)
      }
      extra.append(h('span', { className: 'cv-spacer' }), seg)
    }
    const view = new ClassView(this.env)
    view.root.style.flex = '1'
    view.root.style.minHeight = '0'
    this.classView = view
    this.detail.append(view.root)
    const ref = findClass(level.model, name)
    view.show(bytes, {
      extra,
      resolve: (n) => this.parsed(level, n, ref),
      hasClass: (n) => findClass(level.model, n, ref) !== undefined,
      openClass: (n) => {
        const target = findClass(level.model, n, ref)
        if (target) this.select(target.node.id)
      }
    })
  }

  private parsed(level: Level, name: string, from?: ClassRef): ClassFile | undefined {
    if (level.parsed.has(name)) return level.parsed.get(name) ?? undefined
    const ref = findClass(level.model, name, from)
    let cls: ClassFile | null = null
    if (ref) {
      try {
        cls = parseClass(level.model.zip.read(ref.entry, CLASS_LIMIT).bytes)
      } catch {
        cls = null
      }
    }
    if (level.parsed.size > 2000) level.parsed.clear()
    level.parsed.set(name, cls)
    return cls ?? undefined
  }

  private head(node: JarNode, entry: ZipEntry | undefined, actions: HTMLElement[]): HTMLElement {
    const t = this.env.t
    const [name, cls] = this.kindIcon(node, 0)
    const bar = h('div', { className: 'cv-bar' }, h('div', { className: 'cv-title' }, h('span', { className: `cv-kind ${cls}` }, svg(icon(name))), h('h1', { title: node.path }, displayName(node.label))))
    if (entry) {
      const method = entry.method === 0 ? t.stored : entry.method === 8 ? t.deflated : String(entry.method)
      const parts = [sizeText(this.env, entry.size), `${t.packed} ${sizeText(this.env, entry.packed)}`, method]
      if (entry.mtime) parts.push(new Date(entry.mtime).toLocaleString(this.env.locale, { dateStyle: 'medium', timeStyle: 'short' }))
      bar.append(h('span', { className: 'cv-summary', title: `${t.crc} ${entry.crc.toString(16).padStart(8, '0')}` }, parts.join(' · ')))
    }
    bar.append(h('span', { className: 'cv-spacer' }), ...actions)
    return bar
  }

  private saveButton(node: JarNode, entry: ZipEntry, level: Level): HTMLButtonElement | null {
    if (!this.env.saveAs) return null
    const t = this.env.t
    const b = h('button', { className: 'cv-btn', type: 'button', title: t.saveFile }, svg(icon('save')), t.save)
    b.addEventListener('click', () => {
      try {
        const read = level.model.zip.read(entry, NESTED_LIMIT)
        if (read.truncated) throw new ZipError('too-large', 'too large')
        saveFile(this.env, node.label, read.bytes, IMAGE_TYPES[ext(node.path)])
      } catch (error) {
        console.warn('[class-viewer] cannot unpack for saving', entry.path, error)
        this.env.toast(t.saveFailed)
      }
    })
    return b
  }

  private fileDetail(node: JarNode, level: Level): void {
    const t = this.env.t
    const entry = node.entry
    this.classView = undefined
    if (!entry) return
    const save = this.saveButton(node, entry, level)
    const e = ext(node.path)
    const image = IMAGE_TYPES[e]
    const limit = image ? IMAGE_LIMIT : TEXT_LIMIT
    let bytes: Uint8Array
    let truncated = false
    try {
      const read = level.model.zip.read(entry, Math.max(limit, HEX_LIMIT))
      bytes = read.bytes
      truncated = read.truncated
    } catch (error) {
      this.detail.append(this.head(node, entry, save ? [save] : []), this.entryError(error, entry))
      return
    }
    const copyButton = this.iconButton('copy', t.copyAll, () => undefined)
    const actions: HTMLElement[] = []
    if (image && !truncated) {
      this.blobUrl = URL.createObjectURL(new Blob([bytes.slice()], { type: image }))
      if (save) actions.push(save)
      this.detail.append(this.head(node, entry, actions), h('div', { className: 'cv-image' }, h('img', { src: this.blobUrl, alt: node.label })))
      return
    }
    const text = truncated ? undefined : decodeText(bytes, e)
    if (text !== undefined) {
      const view = new CodeView({ label: node.label })
      view.setLines(textLines(text, e))
      copyButton.addEventListener('click', async () => this.env.toast((await copyText(text)) ? t.copied : t.copyFailed))
      actions.push(copyButton)
      if (save) actions.push(save)
      this.detail.append(this.head(node, entry, actions), view.root)
      return
    }
    if (save) actions.push(save)
    const n = Math.min(bytes.length, HEX_LIMIT)
    const body = h('div', { className: 'cv-doc' })
    if (truncated && (image || TEXT_TYPES.has(e))) body.append(h('p', { className: 'cv-hint' }, fill(t.previewTooBig, { size: sizeText(this.env, entry.size) })))
    body.append(h('p', { className: 'cv-hint' }, fill(t.binaryHead, { n: t.bytes(n) })), h('pre', { className: 'cv-hex' }, hexDump(bytes, n)))
    this.detail.append(this.head(node, entry, actions), body)
  }

  private archiveDetail(node: JarNode, level: Level): void {
    const t = this.env.t
    this.classView = undefined
    const entry = node.entry
    if (!entry) return
    const openButton = h('button', { className: 'cv-btn cv-primary', type: 'button', title: t.openHint }, svg(icon('open')), t.open)
    openButton.addEventListener('click', () => void this.openNested(node))
    const save = this.saveButton(node, entry, level)
    const actions: HTMLElement[] = [openButton]
    if (save) actions.push(save)
    const body = h('div', { className: 'cv-center' }, svg(icon('archive')), h('h2', {}, displayName(node.label)), h('p', {}, sizeText(this.env, entry.size)))
    if (this.levels.length >= MAX_DEPTH) {
      openButton.disabled = true
      body.append(h('p', {}, t.nestedTooDeep))
    } else if (entry.size > NESTED_LIMIT) {
      openButton.disabled = true
      body.append(h('p', {}, fill(t.nestedTooBig, { size: sizeText(this.env, entry.size) })))
    } else body.append(h('p', { className: 'cv-hint' }, t.openHint))
    this.detail.append(this.head(node, entry, actions), body)
  }

  private async openNested(node: JarNode): Promise<void> {
    const level = this.level
    const entry = node.entry
    if (!level || !entry || this.levels.length >= MAX_DEPTH || entry.size > NESTED_LIMIT) return
    const t = this.env.t
    try {
      const read = level.model.zip.read(entry, NESTED_LIMIT)
      if (read.truncated) throw new ZipError('too-large', 'too large')
      const model = buildJar(openZip(read.bytes), jarKind(ext(node.path)))
      this.levels.push(this.newLevel(model, node.label))
      this.renderLevel(true)
    } catch (error) {
      console.warn('[class-viewer] cannot open the archive inside', entry.path, error)
      this.clearDetail()
      const notZip = error instanceof ZipError && error.code === 'not-zip'
      const message = notZip
        ? t.nestedNotZip
        : error instanceof ZipError && error.code === 'too-large'
          ? fill(t.nestedTooBig, { size: sizeText(this.env, entry.size) })
          : fill(t.entryDamaged, { reason: this.reason(error) })
      const title = notZip ? t.notZipTitle : t.nestedErrorTitle
      this.detail.append(this.head(node, entry, []), h('div', { className: 'cv-center' }, svg(icon('warning')), h('h2', {}, title), h('p', {}, message)))
    }
  }

  private reason(error: unknown): string {
    if (this.env.t.ownReasons === 'yes') return error instanceof Error ? error.message : String(error)
    return this.env.t.reasonDamaged
  }

  private entryError(error: unknown, entry: ZipEntry): HTMLElement {
    const t = this.env.t
    let text: string
    if (error instanceof ZipError && error.code === 'encrypted') text = t.entryEncrypted
    else if (error instanceof ZipError && error.code === 'method') text = fill(t.entryMethod, { method: String(entry.method) })
    else if (error instanceof ZipError && error.code === 'too-large') text = fill(t.previewTooBig, { size: sizeText(this.env, entry.size) })
    else text = fill(t.entryDamaged, { reason: this.reason(error) })
    return h('div', { className: 'cv-center' }, svg(icon('warning')), h('p', { title: error instanceof Error ? error.message : undefined }, text), h('p', { className: 'cv-path' }, entry.path))
  }

  private folderView(node: JarNode, level: Level): HTMLElement {
    const t = this.env.t
    const [name, cls] = this.kindIcon(node, 0)
    const label = node.kind === 'package' ? displayName(node.path.replace(/^(WEB-INF|BOOT-INF)\/classes\//, '').replace(/^classes\//, level.model.kind === 'jmod' ? '' : 'classes/').replace(/\//g, '.')) : node.path
    const box = h('div', { className: 'cv-overview' }, h('h2', {}, h('span', { className: `cv-kind ${cls}` }, svg(icon(name))), label))
    const classes = node.classCount
    const files = [...walk(node.children)].filter((n) => n.kind === 'file' || n.kind === 'archive').length
    box.append(h('div', { className: 'cv-stats' }, this.stat(classes, t.classes), this.stat(files, t.resources)))
    box.append(h('p', {}, t.overviewHint))
    return box
  }

  private stat(n: number, plural: (n: number) => string): HTMLElement {
    const text = plural(n)
    const space = text.indexOf(' ')
    return h('div', { className: 'cv-stat' }, h('b', {}, text.slice(0, space)), h('span', {}, text.slice(space + 1)))
  }

  private overview(level: Level): HTMLElement {
    const t = this.env.t
    const m = level.model
    const box = h('div', { className: 'cv-overview' })
    box.append(h('h2', {}, svg(icon('archive')), level.label), h('p', {}, sizeText(this.env, m.zip.size)))
    const packages = [...walk(m.tree)].filter((n) => n.kind === 'package').length
    const stats = h('div', { className: 'cv-stats' }, this.stat(m.classCount, t.classes), this.stat(packages, t.packages), this.stat(m.resourceCount, t.resources))
    if (m.nested.length) stats.append(this.stat(m.nested.length, t.archives))
    box.append(stats)

    // An Android library keeps its compiled classes in classes.jar.
    const inner = m.classCount ? undefined : level.byId.get('f:classes.jar')
    if (inner) {
      const b = h('button', { className: 'cv-btn', type: 'button' }, svg(icon('open')), fill(t.openClass, { name: inner.label }))
      b.addEventListener('click', () => void this.openNested(inner))
      box.append(h('p', {}, fill(t.classesInside, { name: inner.label })), h('div', {}, b))
    }

    // Java versions of the classes, filled in as they are read.
    if (m.classCount) {
      const versions = h('div', { className: 'cv-bars', 'data-versions': 'true' })
      box.append(h('div', {}, h('h3', { style: 'margin:0 0 6px;font-size:12px' }, t.javaVersions), versions))
      this.fillVersions(versions, level)
    }

    const info: [string, Node | string][] = []
    const main = m.manifest?.main
    const classLink = (dotted: string) => {
      const ref = findClass(m, dotted.trim().replace(/\./g, '/'))
      if (!ref) return h('span', { className: 'cv-mono' }, dotted)
      const b = h('button', { className: 'cv-a cv-mono', type: 'button', title: fill(t.openClass, { name: dotted }) }, dotted)
      b.addEventListener('click', () => this.select(ref.node.id))
      return b
    }
    const moduleInfo = findClass(m, 'module-info')
    if (moduleInfo) {
      const cls = this.parsed(level, 'module-info')
      const mod = cls?.attributes.find((a) => a.value.kind === 'Module')
      const name = mod?.value.kind === 'Module' ? cls?.pool.text(mod.value.module.nameIndex) : undefined
      const b = h('button', { className: 'cv-a cv-mono', type: 'button' }, name ?? 'module-info')
      b.addEventListener('click', () => this.select(moduleInfo.node.id))
      info.push([t.moduleName, b])
    }
    if (main) {
      for (const key of KEY_ATTRIBUTES) {
        const value = main.get(key)
        if (value === undefined || key === 'Multi-Release') continue
        const label = key === 'Main-Class' ? t.mainClass : key === 'Start-Class' ? t.startClass : key === 'Automatic-Module-Name' ? t.automaticModule : key
        info.push([label, key === 'Main-Class' || key === 'Start-Class' || key.endsWith('Agent-Class') || key === 'Premain-Class' ? classLink(value) : h('span', { className: 'cv-mono' }, value)])
      }
    }
    if (m.multiRelease || m.versions.length) info.push([t.multiRelease, fill(t.multiReleaseValue, { list: m.versions.map((v) => `Java ${v}`).join(', ') || '—' })])
    if (m.manifestEntry) {
      const node = level.byId.get(`f:${m.manifestEntry.path}`)
      if (node) {
        const b = h('button', { className: 'cv-a cv-mono', type: 'button' }, m.manifestEntry.path)
        b.addEventListener('click', () => this.select(node.id))
        info.push([t.manifest, b])
      }
    }
    if (info.length) {
      const dl = h('dl', { className: 'cv-kv' })
      for (const [k, v] of info) dl.append(h('dt', {}, k), h('dd', {}, v))
      box.append(dl)
    }
    if (m.nested.length) {
      const list = h('div', { className: 'cv-bars' })
      for (const e of m.nested.slice(0, 40)) {
        const node = level.byId.get(`f:${e.path}`)
        const b = h('button', { className: 'cv-a cv-mono', type: 'button', style: 'text-align:left' }, e.path)
        if (node) b.addEventListener('click', () => this.select(node.id))
        list.append(h('div', {}, b, h('span', { className: 'cv-hint' }, `  ${sizeText(this.env, e.size)}`)))
      }
      if (m.nested.length > 40) list.append(h('span', { className: 'cv-hint' }, fill(t.poolMore, { n: m.nested.length - 40 })))
      box.append(h('div', {}, h('h3', { style: 'margin:0 0 6px;font-size:12px' }, t.nested), list))
    }
    box.append(h('p', {}, t.overviewHint))
    return box
  }

  private fillVersions(el: HTMLElement, level: Level): void {
    const t = this.env.t
    el.replaceChildren()
    const counts = level.versions ?? new Map<number, number>()
    const total = level.model.classCount
    const sorted = [...counts].sort((a, b) => b[0] - a[0])
    const max = Math.max(1, ...counts.values())
    for (const [major, n] of sorted) {
      const r = javaRelease(major >> 16 ? major & 0xffff : major, major >> 16 ? 0xffff : 0)
      const label = r.unknown ? fill(t.javaUnknown, { n: major }) : fill(r.preview ? t.javaPreview : t.java, { n: r.release })
      const fillBar = h('div', { className: 'cv-barfill' })
      fillBar.style.width = `${Math.max(2, (n / max) * 100)}%`
      el.append(h('div', { className: 'cv-barrow' }, h('span', {}, label), h('div', { className: 'cv-bartrack' }, fillBar), h('span', { className: 'cv-n' }, t.classes(n))))
    }
    if (level.scanned < total) el.append(h('span', { className: 'cv-hint' }, fill(t.javaVersionsCounting, { done: level.scanned.toLocaleString(this.env.locale), total: total.toLocaleString(this.env.locale) })))
  }

  /** Reads the version of every class, a chunk at a time, for the overview. */
  private startScan(level: Level): void {
    clearTimeout(this.scanTimer)
    if (level.versions && level.scanned >= level.model.classCount) return
    const refs: ClassRef[] = []
    for (const list of level.model.classes.values()) refs.push(...list)
    level.versions ??= new Map()
    const step = () => {
      if (this.level !== level) return
      const end = Math.min(refs.length, level.scanned + SCAN_CHUNK)
      for (let i = level.scanned; i < end; i++) {
        try {
          const v = peekVersion(level.model.zip.read(refs[i].entry, 8).bytes)
          if (v) {
            const key = v.minor === 0xffff ? (1 << 16) | v.major : v.major
            level.versions?.set(key, (level.versions.get(key) ?? 0) + 1)
          }
        } catch {
          // A damaged entry has no version to count.
        }
      }
      level.scanned = end
      const el = this.detail.querySelector<HTMLElement>('[data-versions]')
      if (el) this.fillVersions(el, level)
      if (end < refs.length) this.scanTimer = setTimeout(step, 0)
    }
    this.scanTimer = setTimeout(step, 0)
  }

  private showMessage(title: string, text: string, hex?: string, extra: string[] = []): void {
    this.clearDetail()
    this.classView = undefined
    this.notice.hidden = true
    const box = h('div', { className: 'cv-center' }, svg(icon('warning')), h('h2', {}, title), h('p', {}, text), ...extra.map((x) => h('p', {}, x)))
    if (hex) box.append(h('pre', { className: 'cv-hex' }, hex))
    this.detail.append(box)
  }

  private iconButton(name: IconName, title: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { className: 'cv-btn cv-square', type: 'button', title, 'aria-label': title }, svg(icon(name)))
    b.addEventListener('click', onClick)
    return b
  }
}

/** The entry as text, or undefined when it looks binary. */
function decodeText(bytes: Uint8Array, extension: string): string | undefined {
  const sample = bytes.subarray(0, 65536)
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    if (TEXT_TYPES.has(extension)) return new TextDecoder('windows-1252').decode(bytes)
    return undefined
  }
}

function textLines(text: string, extension: string): ViewLine[] {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  if (extension === 'java' || extension === 'kt' || extension === 'groovy' || extension === 'scala') {
    const state = { comment: false }
    const cls = { kw: 't-kw', type: 't-type', str: 't-str', num: 't-num', com: 't-com', ann: 't-ann', plain: undefined } as const
    return lines.map((l) => ({ text: l, spans: tokenizeJava(l, state).map((tok) => ({ text: tok.text, cls: cls[tok.kind] })) }))
  }
  if (extension === 'mf' || extension === 'sf' || extension === 'properties') {
    return lines.map((l) => {
      if (/^\s*[#!]/.test(l)) return plainLine(l, 't-com')
      const m = /^([^:=\s][^:=]*?)(\s*[:=]\s?)(.*)$/.exec(l)
      return m ? { text: l, spans: [{ text: m[1], cls: 't-key' }, { text: m[2] }, { text: m[3], cls: 't-str' }] } : plainLine(l)
    })
  }
  return lines.map((l) => plainLine(l))
}
