// A jar as a Java developer reads it: packages (compacted like "demo.sky") holding classes, with
// nested and anonymous classes under the class they belong to, resources beside them, and the
// rest of the archive (META-INF, WEB-INF/lib, a jmod's conf and legal folders) as folders.
// Classes under WEB-INF/classes, BOOT-INF/classes or a jmod's classes/ get a root node of their
// own; META-INF/versions/N copies of a class are listed on the class they replace.

import { type Manifest, parseManifest } from './manifest'
import { type Zip, type ZipEntry, ZipError } from '../zip/zip'

export type JarKind = 'jar' | 'war' | 'ear' | 'jmod' | 'aar'

export type NodeKind = 'root' | 'package' | 'class' | 'folder' | 'file' | 'archive'

export type ClassVersion = { release: number; entry: ZipEntry }

export type JarNode = {
  /** Unique within the jar. */
  id: string
  kind: NodeKind
  label: string
  /** The entry path, or the folder's path without the trailing slash. */
  path: string
  entry?: ZipEntry
  /** Classes: the internal name, such as `demo/sky/Star$Kind`. */
  className?: string
  /** Classes: copies under META-INF/versions/N, oldest first. */
  versions?: ClassVersion[]
  /** Roots and packages: the number of classes in them, nested classes included. */
  classCount: number
  children: JarNode[]
}

export type ClassRef = { name: string; entry: ZipEntry; root: string; node: JarNode }

export type JarModel = {
  zip: Zip
  kind: JarKind
  tree: JarNode[]
  /** Every class by internal name; a name in two roots has two refs. */
  classes: Map<string, ClassRef[]>
  classCount: number
  resourceCount: number
  manifest?: Manifest
  manifestEntry?: ZipEntry
  /** Releases with a META-INF/versions/N folder. */
  versions: number[]
  multiRelease: boolean
  /** Archives inside, which open as jars of their own. */
  nested: ZipEntry[]
}

/** Roots whose classes are not at the top of the archive. */
const CLASS_ROOTS = ['WEB-INF/classes/', 'BOOT-INF/classes/']
const NESTED = /\.(jar|war|ear|aar|jmod|zip)$/i
const MANIFEST = 'META-INF/MANIFEST.MF'
const VERSIONED = /^META-INF\/versions\/(\d{1,4})\/(.+)$/

export function jarKind(fileType: string | undefined): JarKind {
  const t = (fileType ?? '').toLowerCase().replace(/^\./, '')
  return t === 'war' || t === 'ear' || t === 'jmod' || t === 'aar' ? t : 'jar'
}

const compare = (a: string, b: string) => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

const ORDER: Record<NodeKind, number> = { root: 0, package: 1, class: 2, folder: 3, archive: 4, file: 5 }

function sortNodes(nodes: JarNode[]): void {
  nodes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || compare(a.label, b.label))
  for (const n of nodes) if (n.children.length) sortNodes(n.children)
}

type Dir = { path: string; dirs: Map<string, Dir>; files: ZipEntry[]; hasClasses: boolean }

const newDir = (path: string): Dir => ({ path, dirs: new Map(), files: [], hasClasses: false })

function dirAt(top: Dir, parts: string[]): Dir {
  let d = top
  for (const part of parts) {
    let next = d.dirs.get(part)
    if (!next) {
      next = newDir(d.path ? `${d.path}/${part}` : part)
      d.dirs.set(part, next)
    }
    d = next
  }
  return d
}

function findDir(top: Dir, parts: string[]): Dir | undefined {
  let d: Dir | undefined = top
  for (const part of parts) d = d?.dirs.get(part)
  return d
}

function markClasses(d: Dir): boolean {
  let has = d.files.some((f) => f.path.endsWith('.class'))
  for (const sub of d.dirs.values()) has = markClasses(sub) || has
  d.hasClasses = has
  return has
}

export function buildJar(zip: Zip, kind: JarKind = 'jar'): JarModel {
  const top = newDir('')
  const seen = new Set<string>()
  for (const entry of zip.entries) {
    if (!entry.path || seen.has(entry.path)) continue
    seen.add(entry.path)
    const parts = entry.path.split('/')
    if (entry.dir) dirAt(top, parts)
    else dirAt(top, parts.slice(0, -1)).files.push(entry)
  }
  markClasses(top)

  const roots = [...CLASS_ROOTS]
  if (kind === 'jmod') roots.push('classes/')
  const classes = new Map<string, ClassRef[]>()
  const nested: ZipEntry[] = []
  let resourceCount = 0

  const addClass = (name: string, entry: ZipEntry, root: string, node: JarNode) => {
    const list = classes.get(name)
    const ref = { name, entry, root, node }
    if (list) list.push(ref)
    else classes.set(name, [ref])
  }

  const fileNode = (entry: ZipEntry, label: string): JarNode => {
    const archive = NESTED.test(entry.path)
    if (archive) nested.push(entry)
    else resourceCount++
    return { id: `f:${entry.path}`, kind: archive ? 'archive' : 'file', label, path: entry.path, entry, classCount: 0, children: [] }
  }

  /** Classes of one directory, nested ones under the class whose name is the longest prefix. */
  const classNodes = (d: Dir, root: string, packageName: string): JarNode[] => {
    const files = d.files.filter((f) => f.path.endsWith('.class'))
    const bySimple = new Map<string, JarNode>()
    for (const f of files) {
      const simple = f.path.slice(f.path.lastIndexOf('/') + 1, -'.class'.length)
      const name = packageName ? `${packageName}/${simple}` : simple
      const node: JarNode = { id: `c:${root}${name}`, kind: 'class', label: simple, path: f.path, entry: f, className: name, classCount: 1, children: [] }
      bySimple.set(simple, node)
      addClass(name, f, root, node)
    }
    const out: JarNode[] = []
    for (const [simple, node] of bySimple) {
      let parent: JarNode | undefined
      for (let i = simple.lastIndexOf('$'); i > 0; i = simple.lastIndexOf('$', i - 1)) {
        parent = bySimple.get(simple.slice(0, i))
        if (parent) {
          const rest = simple.slice(i + 1)
          node.label = rest && !/^[\d$]/.test(rest) ? rest : simple
          break
        }
      }
      if (parent) parent.children.push(node)
      else out.push(node)
    }
    // Count nested classes into their outer classes' totals.
    const count = (n: JarNode): number => (n.classCount = 1 + n.children.reduce((s, c) => s + count(c), 0))
    for (const n of out) count(n)
    return out
  }

  /** A class root's directory as packages; directories without classes stay folders. */
  const packageNodes = (d: Dir, root: string): JarNode[] => {
    const out: JarNode[] = []
    for (const [part, sub] of d.dirs) {
      if (!sub.hasClasses) {
        out.push(folderNode(sub, part))
        continue
      }
      // Compact a chain of packages that hold only one package each.
      let label = part
      let at = sub
      while (at.files.length === 0 && at.dirs.size === 1) {
        const [[nextPart, next]] = at.dirs
        if (!next.hasClasses) break
        label += `.${nextPart}`
        at = next
      }
      const name = at.path.slice(root.length)
      const children = [...packageNodes(at, root), ...classNodes(at, root, name), ...resourceNodes(at)]
      const classCount = children.reduce((s, c) => s + (c.kind === 'class' || c.kind === 'package' ? c.classCount : 0), 0)
      out.push({ id: `p:${root}${name}`, kind: 'package', label, path: at.path, classCount, children })
    }
    return out
  }

  const resourceNodes = (d: Dir): JarNode[] =>
    d.files.filter((f) => !f.path.endsWith('.class')).map((f) => fileNode(f, f.path.slice(f.path.lastIndexOf('/') + 1)))

  /** A plain folder: its files as files, classes included (they still open as classes). */
  const folderNode = (d: Dir, label: string): JarNode => {
    const children: JarNode[] = []
    for (const [part, sub] of d.dirs) {
      if (rootDirs.has(sub.path)) continue
      children.push(folderNode(sub, part))
    }
    for (const f of d.files) {
      const leaf = f.path.slice(f.path.lastIndexOf('/') + 1)
      if (leaf.endsWith('.class')) {
        const v = VERSIONED.exec(f.path)
        const name = v ? v[2].slice(0, -'.class'.length) : f.path.slice(0, -'.class'.length)
        children.push({ id: `c:${f.path}`, kind: 'class', label: leaf.slice(0, -'.class'.length), path: f.path, entry: f, className: name, classCount: 1, children: [] })
      } else {
        children.push(fileNode(f, leaf))
      }
    }
    return { id: `d:${d.path}`, kind: 'folder', label, path: d.path, classCount: 0, children }
  }

  // Class roots other than the top that hold classes.
  const rootDirs = new Map<string, string>()
  for (const r of roots) {
    const d = findDir(top, r.slice(0, -1).split('/'))
    if (d?.hasClasses) rootDirs.set(d.path, r)
  }

  const tree: JarNode[] = []
  for (const [path, r] of rootDirs) {
    const d = findDir(top, path.split('/')) as Dir
    const children = [...packageNodes(d, r), ...classNodes(d, r, ''), ...resourceNodes(d)]
    const classCount = children.reduce((s, c) => s + (c.kind === 'file' || c.kind === 'archive' ? 0 : c.classCount), 0)
    tree.push({ id: `r:${r}`, kind: 'root', label: path, path, classCount, children })
  }
  // The top of the archive is a class root too, except for META-INF and the other roots.
  for (const [part, sub] of top.dirs) {
    if (rootDirs.has(sub.path)) continue
    const isRootParent = [...rootDirs.keys()].some((p) => p.startsWith(`${sub.path}/`))
    if (part === 'META-INF' || !sub.hasClasses || isRootParent || kind === 'jmod') {
      tree.push(folderNode(sub, part))
    } else {
      tree.push(...packageNodes({ ...top, dirs: new Map([[part, sub]]) }, ''))
    }
  }
  tree.push(...classNodes(top, '', ''), ...resourceNodes(top))
  sortNodes(tree)

  // META-INF/versions/N/… classes are listed on the class they replace.
  const versionSet = new Set<number>()
  for (const entry of zip.entries) {
    const v = VERSIONED.exec(entry.path)
    if (!v) continue
    const release = Number(v[1])
    versionSet.add(release)
    if (!v[2].endsWith('.class')) continue
    const name = v[2].slice(0, -'.class'.length)
    const base = classes.get(name)?.find((r) => r.root === '')
    if (base) (base.node.versions ??= []).push({ release, entry })
  }
  for (const list of classes.values()) for (const r of list) r.node.versions?.sort((a, b) => a.release - b.release)

  let manifest: Manifest | undefined
  const manifestEntry = zip.entries.find((e) => e.path === MANIFEST || e.path.toUpperCase() === MANIFEST)
  if (manifestEntry && manifestEntry.size < 4 * 1024 * 1024) {
    try {
      manifest = parseManifest(new TextDecoder().decode(zip.read(manifestEntry).bytes))
    } catch (error) {
      if (!(error instanceof ZipError)) throw error
    }
  }

  let classCount = 0
  for (const list of classes.values()) classCount += list.length
  return {
    zip,
    kind,
    tree,
    classes,
    classCount,
    resourceCount,
    manifest,
    manifestEntry,
    versions: [...versionSet].sort((a, b) => a - b),
    multiRelease: manifest?.main.get('Multi-Release')?.trim().toLowerCase() === 'true',
    nested
  }
}

/** The class that `name` names, preferring the same root as `from`. */
export function findClass(model: JarModel, name: string, from?: ClassRef): ClassRef | undefined {
  const list = model.classes.get(name)
  if (!list) return undefined
  return list.find((r) => r.root === from?.root) ?? list[0]
}

/** Every node in the tree, depth first. */
export function* walk(nodes: JarNode[]): Generator<JarNode> {
  for (const n of nodes) {
    yield n
    yield* walk(n.children)
  }
}
