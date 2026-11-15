// A jar as a Java developer reads it: packages (compacted like "demo.sky") holding classes, with
// nested and anonymous classes under the class they belong to, resources beside them, and the
// rest of the archive (META-INF, WEB-INF/lib, a jmod's conf and legal folders) as folders.
// Classes under WEB-INF/classes, BOOT-INF/classes or a jmod's classes/ get a root node of their
// own; META-INF/versions/N copies of a class are listed on the class they replace.
//
// Entries are taken the way java.util.zip takes them: by their exact stored names, the last copy
// of a name winning; for a name no entry has, the first entry of that name with a `/` after it.
// A name the JVM would never look up (`x/../a/B.class`, `a\B.class`, a leading `/`) and the copies
// it does not read are not merged into the tree; they are listed under their stored names in a
// folder of their own, so a crafted jar cannot show a decoy in place of the class that runs.

import { type Manifest, parseManifest } from './manifest'
import { type Zip, type ZipEntry, ZipError } from '../zip/zip'

export type JarKind = 'jar' | 'war' | 'ear' | 'jmod' | 'aar'

export type NodeKind = 'root' | 'package' | 'class' | 'folder' | 'file' | 'archive'

export type ClassVersion = { release: number; entry: ZipEntry }

/**
 * Why an entry is listed apart: a name the JVM would not look up, a copy a later one replaces, a
 * name ending in `/` that holds data (the JVM finds it under the name without the slash), or a
 * later entry of such a name, which the JVM never reads, as it takes the first.
 */
export type EntryIssue = 'unusual' | 'shadowed' | 'folder' | 'unread'

export type JarNode = {
  /** Unique within the jar. */
  id: string
  kind: NodeKind
  label: string
  /** The entry path, or the folder's path without the trailing slash; an entry listed apart has
   *  its stored name. */
  path: string
  entry?: ZipEntry
  /** Classes: the internal name, such as `demo/sky/Star$Kind`. */
  className?: string
  /** Classes: copies under META-INF/versions/N, oldest first. */
  versions?: ClassVersion[]
  /** A class a multi-release jar has only under META-INF/versions/N: the release of `entry`, its
   *  oldest copy, which `versions` follows with the newer ones. */
  release?: number
  /** Roots and packages: the number of classes in them, nested classes included. */
  classCount: number
  children: JarNode[]
  /** Entries listed apart, and the folder that holds them (`'unusual'`). */
  issue?: EntryIssue
}

export type ClassRef = { name: string; entry: ZipEntry; root: string; node: JarNode }

export type ModuleInfo = { entry: ZipEntry; nodeId: string; /** Set for a META-INF/versions/N copy. */ release?: number }

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
  /**
   * Some entry is named exactly META-INF/MANIFEST.MF. `java -jar` (Java 21) refuses a jar without
   * one ("Invalid or corrupt jarfile"); with one, it runs the Main-Class of `manifestEntry`, which
   * may be a later copy in other capitals.
   */
  manifestExact: boolean
  /** Releases with a META-INF/versions/N folder that holds files, as java.util.jar registers them. */
  versions: number[]
  /** The manifest says Multi-Release: true. Only then does the JVM use the versions, and the
   *  tree attach them to their classes. */
  multiRelease: boolean
  /** Archives inside, which open as jars of their own. */
  nested: ZipEntry[]
  /** The module descriptor: module-info.class at the top, or in a multi-release jar the copy
   *  for the newest release. */
  moduleInfo?: ModuleInfo
  /** Files whose stored names the JVM would never look up. */
  unusual: ZipEntry[]
  /** Earlier copies of a name; the JVM, like the tree, uses the last one. */
  shadowed: ZipEntry[]
  /** Entries named like folders that hold data. When no entry has the name without the slash,
   *  the JVM reads such an entry under it, and a class there is listed in `classes`. */
  folderData: ZipEntry[]
  /** Later entries of a name like a folder whose first entry the JVM reads instead. */
  unread: ZipEntry[]
}

/** Roots whose classes are not at the top of the archive. */
const CLASS_ROOTS = ['WEB-INF/classes/', 'BOOT-INF/classes/']
const NESTED = /\.(jar|war|ear|aar|jmod|zip)$/i
export const MANIFEST = 'META-INF/MANIFEST.MF'
const VERSIONED = /^META-INF\/versions\/(\d{1,4})\/(.+)$/
/** Outer classes are looked for among this many `$` from the right, in names of up to this length:
 *  a name of thousands of `$` would otherwise cost a lookup of a long prefix per `$`. */
const MAX_NESTING_TRIES = 32
const MAX_OUTER_NAME = 1024

/**
 * A META-INF/versions/N/ copy as java.util.jar.JarFile finds it: it looks up the folder named by
 * the release number itself, so `09` or `017` is never used, and releases before 8, its base
 * release, are not either (JarFile.getVersionedEntry, Java 21).
 */
export function versionOf(path: string): { release: number; rest: string } | undefined {
  const v = VERSIONED.exec(path)
  if (!v) return undefined
  const release = Number(v[1])
  return String(release) === v[1] && release >= 8 ? { release, rest: v[2] } : undefined
}

/** A name compared as java.util.zip compares META-INF names: ASCII letters in any case, nothing else. */
const asciiUpper = (name: string) => name.replace(/[a-z]+/g, (s) => s.toUpperCase())

/** True for the name java.util.jar takes for the manifest when the exact one is missing. */
export const isManifestName = (name: string): boolean => name.length === MANIFEST.length && asciiUpper(name) === MANIFEST
/** Folders deeper than this are joined into one, so every walk over the tree stays shallow. */
export const MAX_FOLDER_DEPTH = 128
export const UNUSUAL_ID = 'u:'

export function jarKind(fileType: string | undefined): JarKind {
  const t = (fileType ?? '').toLowerCase().replace(/^\./, '')
  return t === 'war' || t === 'ear' || t === 'jmod' || t === 'aar' ? t : 'jar'
}

/** True when the stored name is the path itself: no `\`, no leading `/`, no empty, `.` or `..`
 *  segments. Only then does the JVM find the entry by that path. */
export function isCanonical(entry: ZipEntry): boolean {
  if (!entry.path) return false
  const name = entry.dir && entry.name.endsWith('/') ? entry.name.slice(0, -1) : entry.name
  return name === entry.path
}

const compare = (a: string, b: string) => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

const ORDER: Record<NodeKind, number> = { root: 0, package: 1, class: 2, folder: 3, archive: 4, file: 5 }

const byKindAndLabel = (a: JarNode, b: JarNode) => ORDER[a.kind] - ORDER[b.kind] || compare(a.label, b.label)

function sortNodes(nodes: JarNode[]): void {
  nodes.sort(byKindAndLabel)
  for (const n of walk(nodes)) if (n.children.length > 1) n.children.sort(byKindAndLabel)
}

type Dir = { path: string; dirs: Map<string, Dir>; files: ZipEntry[]; hasClasses: boolean }

const newDir = (path: string): Dir => ({ path, dirs: new Map(), files: [], hasClasses: false })

/** Folder names of a path, the ones past `MAX_FOLDER_DEPTH` joined into the last. */
function folderParts(parts: string[]): string[] {
  if (parts.length <= MAX_FOLDER_DEPTH) return parts
  return [...parts.slice(0, MAX_FOLDER_DEPTH - 1), parts.slice(MAX_FOLDER_DEPTH - 1).join('/')]
}

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

/** Sets `hasClasses` on every folder, children before parents. */
function markClasses(top: Dir): void {
  const order: Dir[] = [top]
  for (let i = 0; i < order.length; i++) for (const sub of order[i].dirs.values()) order.push(sub)
  for (let i = order.length - 1; i >= 0; i--) {
    const d = order[i]
    let has = d.files.some((f) => f.path.endsWith('.class'))
    for (const sub of d.dirs.values()) has ||= sub.hasClasses
    d.hasClasses = has
  }
}

export function buildJar(zip: Zip, kind: JarKind = 'jar'): JarModel {
  // The JVM looks entries up by their stored names, and a later copy of a name replaces an earlier one.
  const byName = new Map<string, ZipEntry>()
  // Of the entries named `x/`, java.util.zip (Java 21) gives the first for `x` when no entry is named `x`.
  const firstSlashed = new Map<string, ZipEntry>()
  for (const entry of zip.entries) {
    byName.set(entry.name, entry)
    if (entry.name.endsWith('/') && !firstSlashed.has(entry.name)) firstSlashed.set(entry.name, entry)
  }
  /** Named `x/` with no entry named `x`: the JVM reads its first entry for `x`. */
  const readBySlash = (entry: ZipEntry) => entry.name.endsWith('/') && !byName.has(entry.name.slice(0, -1))
  /** The name the JVM reads `entry` under as a file, or undefined when it never does. */
  const readAs = (entry: ZipEntry): string | undefined => {
    if (entry.dir) return undefined
    if (!entry.name.endsWith('/')) return byName.get(entry.name) === entry && isCanonical(entry) ? entry.name : undefined
    const name = entry.name.slice(0, -1)
    return readBySlash(entry) && firstSlashed.get(entry.name) === entry && name === entry.path ? name : undefined
  }
  const unusual: ZipEntry[] = []
  const shadowed: ZipEntry[] = []
  const folderData: ZipEntry[] = []
  const unread: ZipEntry[] = []
  const top = newDir('')
  for (const entry of zip.entries) {
    if (readBySlash(entry)) {
      if (firstSlashed.get(entry.name) !== entry) {
        if (!entry.dir) unread.push(entry)
        continue
      }
    } else if (byName.get(entry.name) !== entry) {
      if (!entry.dir) shadowed.push(entry)
      continue
    }
    if (!entry.dir && entry.name.endsWith('/')) {
      folderData.push(entry)
      continue
    }
    if (!isCanonical(entry)) {
      if (!entry.dir) unusual.push(entry)
      continue
    }
    const parts = entry.path.split('/')
    if (entry.dir) dirAt(top, folderParts(parts))
    else dirAt(top, folderParts(parts.slice(0, -1))).files.push(entry)
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
      let tries = 0
      for (let i = simple.lastIndexOf('$', MAX_OUTER_NAME); i > 0 && tries < MAX_NESTING_TRIES; i = simple.lastIndexOf('$', i - 1), tries++) {
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
    // Count nested classes into their outer classes' totals, innermost first.
    const order = [...walk(out)]
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i]
      n.classCount = 1
      for (const c of n.children) n.classCount += c.classCount
    }
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
      let label = part.replace(/\//g, '.')
      let at = sub
      while (at.files.length === 0 && at.dirs.size === 1) {
        const [[nextPart, next]] = at.dirs
        if (!next.hasClasses) break
        label += `.${nextPart.replace(/\//g, '.')}`
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

  /** Class files in plain folders, such as META-INF/versions/N, by entry. */
  const folderClasses = new Map<ZipEntry, JarNode>()
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
        const v = versionOf(f.path)
        const name = (v ? v.rest : f.path).slice(0, -'.class'.length)
        const node: JarNode = { id: `c:${f.path}`, kind: 'class', label: leaf.slice(0, -'.class'.length), path: f.path, entry: f, className: name, classCount: 1, children: [] }
        folderClasses.set(f, node)
        children.push(node)
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
      for (const n of packageNodes({ ...top, dirs: new Map([[part, sub]]) }, '')) tree.push(n)
    }
  }
  for (const n of classNodes(top, '', '')) tree.push(n)
  for (const n of resourceNodes(top)) tree.push(n)
  sortNodes(tree)

  // Entries listed apart, in archive order, under their stored names.
  const apartNodes = new Map<ZipEntry, JarNode>()
  if (unusual.length || shadowed.length || folderData.length || unread.length) {
    const apart = [
      ...unusual.map((e) => [e, 'unusual'] as const),
      ...shadowed.map((e) => [e, 'shadowed'] as const),
      ...folderData.map((e) => [e, 'folder'] as const),
      ...unread.map((e) => [e, 'unread'] as const)
    ].sort((a, b) => a[0].index - b[0].index)
    const children: JarNode[] = apart.map(([entry, issue]) => {
      const isClass = entry.path.endsWith('.class')
      const kind: NodeKind = isClass ? 'class' : NESTED.test(entry.path) ? 'archive' : 'file'
      const className = isClass ? (versionOf(entry.path)?.rest ?? entry.path).slice(0, -'.class'.length) : undefined
      const node: JarNode = { id: `x:${entry.index}`, kind, label: entry.name, path: entry.name, entry, className, classCount: isClass ? 1 : 0, children: [], issue }
      apartNodes.set(entry, node)
      return node
    })
    tree.push({ id: UNUSUAL_ID, kind: 'folder', label: 'Unusual entries', path: '', classCount: 0, children, issue: 'unusual' })
  }
  // java.util.zip finds `a/B.class/` under `a/B.class` when no entry has that exact name, so a
  // class loader reads it: such a class is the class of that name, though it is listed apart.
  for (const entry of folderData) {
    const path = readAs(entry)
    if (path === undefined || !path.endsWith('.class') || path.startsWith('META-INF/')) continue
    const root = roots.find((r) => path.startsWith(r)) ?? (kind === 'jmod' ? undefined : '')
    const node = apartNodes.get(entry)
    if (root !== undefined && node) addClass(path.slice(root.length, -'.class'.length), entry, root, node)
  }

  let manifest: Manifest | undefined
  // As java.util.jar.JarFile in Java 21: the last entry whose name is META-INF/MANIFEST.MF in any
  // case of its ASCII letters (ZipFile.Source.isMetaName and isManifestName), the exact name included.
  let manifestEntry: ZipEntry | undefined
  let manifestExact = false
  for (const e of zip.entries) {
    if (!isManifestName(e.name)) continue
    manifestEntry = e
    if (e.name === MANIFEST) manifestExact = true
  }
  let manifestText = ''
  if (manifestEntry && manifestEntry.size < 4 * 1024 * 1024) {
    try {
      manifestText = new TextDecoder().decode(zip.read(manifestEntry).bytes)
      manifest = parseManifest(manifestText)
    } catch (error) {
      if (!(error instanceof ZipError)) throw error
    }
  }
  // JarFile.checkForSpecialAttributes (Java 21): the bytes hold a line "Multi-Release: true" in any
  // case, and the main section's value, past exactly one space, is "true" in any case, untrimmed.
  const multiRelease = /\nmulti-release: true/i.test(manifestText) && manifest?.main.get('Multi-Release')?.toLowerCase() === 'true'

  // java.util.jar registers a release for each entry under META-INF/versions/N/ not named like a
  // folder, META-INF/ and versions/ in any ASCII capitals (ZipFile.Source.getMetaVersion), and
  // looks a class up by its exact name in the registered releases only.
  const versionSet = new Set<number>()
  for (const entry of zip.entries) {
    const v = entry.name.endsWith('/') ? undefined : versionOf(entry.name.replace(/^meta-inf\/versions\//i, 'META-INF/versions/'))
    if (v) versionSet.add(v.release)
  }
  let moduleInfo: ModuleInfo | undefined
  // A jmod keeps its classes, module-info.class included, under classes/.
  const topModule = classes.get('module-info')?.find((r) => r.root === (kind === 'jmod' ? 'classes/' : ''))
  if (topModule) moduleInfo = { entry: topModule.entry, nodeId: topModule.node.id }
  // In a multi-release jar, META-INF/versions/N/… classes are listed on the class they replace;
  // without Multi-Release: true the JVM does not use them, and they stay files under META-INF.
  const versionOnly = new Map<string, ClassVersion[]>()
  for (const entry of multiRelease ? zip.entries : []) {
    const path = readAs(entry)
    const v = path === undefined ? undefined : versionOf(path)
    if (!v || !versionSet.has(v.release) || !v.rest.endsWith('.class')) continue
    const release = v.release
    const name = v.rest.slice(0, -'.class'.length)
    const base = classes.get(name)?.find((r) => r.root === '')
    if (base) (base.node.versions ??= []).push({ release, entry })
    // Libraries that still run on Java 8 keep their module descriptor under versions/9.
    else if (name === 'module-info') {
      if (!topModule && release >= (moduleInfo?.release ?? 0)) {
        // One named like a folder is listed apart.
        moduleInfo = { entry, nodeId: entry.name.endsWith('/') ? `x:${entry.index}` : `c:${entry.path}`, release }
      }
    } else {
      const list = versionOnly.get(name)
      if (list) list.push({ release, entry })
      else versionOnly.set(name, [{ release, entry }])
    }
  }
  // JarFile finds a class that has copies under versions/N only, as bcprov, the JUnit console and
  // log4j-api hold: it is indexed by its oldest copy, with the newer ones as its versions.
  for (const [name, copies] of versionOnly) {
    copies.sort((a, b) => a.release - b.release)
    const [oldest, ...newer] = copies
    const node = folderClasses.get(oldest.entry) ?? apartNodes.get(oldest.entry)
    if (!node) continue
    node.release = oldest.release
    if (newer.length) node.versions = newer
    addClass(name, oldest.entry, '', node)
  }
  for (const list of classes.values()) for (const r of list) r.node.versions?.sort((a, b) => a.release - b.release)

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
    manifestExact,
    versions: [...versionSet].sort((a, b) => a - b),
    multiRelease,
    nested,
    moduleInfo,
    unusual,
    shadowed,
    folderData,
    unread
  }
}

/**
 * The class that `name` names, preferring the same root as `from`; without `from`, the top of
 * the archive, where `java -jar` and a class path look.
 */
export function findClass(model: JarModel, name: string, from?: ClassRef): ClassRef | undefined {
  const list = model.classes.get(name)
  if (!list) return undefined
  const root = from ? from.root : ''
  return list.find((r) => r.root === root) ?? list[0]
}

/** Every node in the tree, depth first, parents before children. */
export function* walk(nodes: JarNode[]): Generator<JarNode> {
  const stack: JarNode[] = []
  for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i])
  for (let n = stack.pop(); n; n = stack.pop()) {
    yield n
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
  }
}
