// The Outline: a class as Java source with declarations only. Method bodies stay compiled code;
// this is not a decompiler. Member classes from the same archive nest inside their outer class.

import { type AttributeInfo, type InnerClassEntry, findAttribute } from './attributes'
import { MAX_LISTED_ROWS, MAX_MEMBER_ANNOTATIONS, RowBudget, joinWithin } from './budget'
import type { FormatErrorCode } from './bytes'
import type { ClassFile, Member } from './classfile'
import {
  annotationDefault,
  annotationText,
  annotationsOf,
  classDeclaration,
  classKind,
  fieldDeclaration,
  fieldType,
  inlineAnnotations,
  makeNamer,
  methodDeclaration,
  methodDeclarationAt,
  methodParts,
  ownInnerEntry,
  sourceSimpleName
} from './declarations'
import { ACC, javaModifiers } from './flags'
import { detectLanguage } from './language'
import { binaryName, displayName } from './names'
import { type Namer, takeLinks } from './types'
import { releaseLabel } from './versions'

export type OutlineTarget =
  | { kind: 'field' | 'method'; owner: string; index: number }
  | { kind: 'class'; name: string }

/** A class name in a line, `text.slice(from, to)`, that names `name`. */
export type OutlineLink = { from: number; to: number; name: string }

export type OutlineLine = {
  text: string
  target?: OutlineTarget
  links?: OutlineLink[]
  /** On a method's declaration line: where its name is, `text.slice(from, to)`. */
  name?: { from: number; to: number }
}

/** `cut` when the outline stopped at its row budget. */
export type Outline = { lines: OutlineLine[]; text: string; cut: boolean }

/** The comments the outline writes, in the UI language. */
export type OutlineComments = {
  /** "Outline of {file}: declarations only; method bodies are compiled code." */
  header: string
  /** "Compiled from {source} for {release}." */
  compiledFrom: string
  /** "Compiled for {release}." */
  compiledFor: string
  /** "compiled code" */
  compiledCode: string
  /** "lines {from}–{to}" */
  lines: string
  /** "line {n}" */
  line: string
  synthetic: string
  bridge: string
  /** "in {file}" for a member class whose file is not at hand */
  elsewhere: string
  anonymous: string
  local: string
  /** "in {method}" after an anonymous or local class */
  declaredIn: string
  /** "{language} class" banner, e.g. "Kotlin class" */
  language: Record<string, string>
  /** "The file is damaged after this point: {reason}." */
  damaged: string
  /** "compiled code, damaged: {reason}" for a Code attribute that cannot be read */
  damagedCode: string
  /** "{n} more annotations" after the first ones of a member */
  moreAnnotations: string
  /** Where the outline stops once it has written as much as it may. */
  cut: string
}

export const ENGLISH_COMMENTS: OutlineComments = {
  header: 'Outline of {file}: declarations only; method bodies are compiled code.',
  compiledFrom: 'Compiled from {source} for {release}.',
  compiledFor: 'Compiled for {release}.',
  compiledCode: 'compiled code',
  lines: 'lines {from}–{to}',
  line: 'line {n}',
  synthetic: 'synthetic',
  bridge: 'bridge',
  elsewhere: 'in {file}',
  anonymous: 'anonymous class',
  local: 'local class',
  declaredIn: 'in {method}',
  language: {
    kotlin: 'Compiled by Kotlin; shown as the JVM sees it.',
    scala: 'Compiled by Scala; shown as the JVM sees it.',
    groovy: 'Compiled by Groovy; shown as the JVM sees it.',
    clojure: 'Compiled by Clojure; shown as the JVM sees it.'
  },
  damaged: 'The file is damaged after this point: {reason}.',
  damagedCode: 'compiled code, damaged: {reason}',
  moreAnnotations: '{n} more annotations',
  cut: 'The rest is not shown: the outline is full.'
}

export type OutlineOptions = {
  /** Another class of the same archive, for member classes; undefined when unknown. */
  resolve?: (internal: string) => ClassFile | undefined
  comments?: OutlineComments
  /** A parser error in the comments' language; the parser's English message by default. */
  reason?: (code: FormatErrorCode | undefined, message: string) => string
  /** The most rows the outline writes; `MAX_LISTED_ROWS` by default. */
  limit?: number
}

/** A member's annotations past this many are counted in one comment: real code has a handful. */
export const MAX_ANNOTATION_LINES = MAX_MEMBER_ANNOTATIONS

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))

const reasonOf = (options: OutlineOptions, code: FormatErrorCode | undefined, message: string) =>
  options.reason ? options.reason(code, message) : message

const INDENT = '    '
const MAX_NESTING = 8

/**
 * Lines of the outline; class names the namer marked become links. With a budget, each line takes
 * its rows; the first line that does not fit is replaced by `cutText`, and the writer is `full`.
 */
class Writer {
  readonly lines: OutlineLine[] = []
  private readonly targets: readonly string[]
  private readonly budget: RowBudget | undefined
  private readonly cutText: string
  constructor(targets: readonly string[], budget?: RowBudget, cutText = '') {
    this.targets = targets
    this.budget = budget
    this.cutText = cutText
  }
  get full(): boolean {
    return this.budget?.cut ?? false
  }
  /** `name` is `[from, to)` of the declared name in `text`, before its link marks are taken out. */
  push(depth: number, text: string, target?: OutlineTarget, name?: [number, number]): void {
    if (this.full) return
    if (this.budget && !this.budget.line(INDENT.length * depth + text.length)) {
      this.lines.push({ text: `${INDENT.repeat(depth)}// ${this.cutText}` })
      return
    }
    this.write(depth, text, target, name)
  }
  /** A closing brace: written even when full, so the classes that were opened end. */
  close(depth: number, target?: OutlineTarget): void {
    this.write(depth, '}', target)
  }
  private write(depth: number, text: string, target?: OutlineTarget, name?: [number, number]): void {
    const indent = INDENT.repeat(depth)
    const taken = takeLinks(text, this.targets)
    const line: OutlineLine = { text: indent + taken.text }
    if (target) line.target = target
    if (taken.links.length) line.links = taken.links.map((l) => ({ from: l.from + indent.length, to: l.to + indent.length, name: l.name }))
    if (name && name[1] > name[0]) {
      const from = indent.length + takeLinks(text.slice(0, name[0]), this.targets).text.length
      line.name = { from, to: from + name[1] - name[0] }
    }
    this.lines.push(line)
  }
}

function lineRange(method: Member): { from: number; to: number } | undefined {
  const code = findAttribute(method.attributes, 'Code')
  const table = code && findAttribute(code.value.code.attributes, 'LineNumberTable')
  if (!table || !table.value.lines.length) return undefined
  let from = Infinity
  let to = -Infinity
  for (const l of table.value.lines) {
    from = Math.min(from, l.line)
    to = Math.max(to, l.line)
  }
  return { from, to }
}

function bodyComment(method: Member, c: OutlineComments): string {
  const range = lineRange(method)
  if (!range) return `{ /* ${c.compiledCode} */ }`
  const where = range.from === range.to ? fill(c.line, { n: range.from }) : fill(c.lines, range)
  return `{ /* ${c.compiledCode}, ${where} */ }`
}

function writeClass(
  out: Writer,
  cls: ClassFile,
  namer: Namer,
  depth: number,
  options: Required<Pick<OutlineOptions, 'comments'>> & OutlineOptions,
  seen: Set<string>
): void {
  const c = options.comments
  const pool = cls.pool
  const kind = classKind(cls)
  const target: OutlineTarget = { kind: 'class', name: cls.name }
  writeAnnotations(out, cls.attributes, cls, namer, depth, c, target)
  out.push(depth, `${classDeclaration(cls, namer)} {`, target)
  if (out.full) return out.close(depth, target)
  const inner = depth + 1
  const isInterface = kind === 'interface' || kind === 'annotation'
  const recordFields = new Set(
    (findAttribute(cls.attributes, 'Record')?.value.components ?? []).map((comp) => pool.str(comp.nameIndex))
  )

  // Enum constants first, as source has them.
  const constants = cls.fields.filter((f) => f.access & ACC.ENUM)
  if (kind === 'enum' && constants.length) {
    for (let i = 0; i < constants.length && !out.full; i++) {
      const f = constants[i]
      const annotations = annotationsOf(f.attributes)
      const before = annotations.length ? `${inlineAnnotations(annotations, pool, namer)} ` : ''
      const text = before + displayName(f.name) + (i === constants.length - 1 ? ';' : ',')
      out.push(inner, text, { kind: 'field', owner: cls.name, index: cls.fields.indexOf(f) })
    }
  }
  // A blank line goes between groups, never right after the opening brace.
  let blank = kind === 'enum' && constants.length > 0
  let printed = blank

  for (let index = 0; index < cls.fields.length && !out.full; index++) {
    const f = cls.fields[index]
    if (kind === 'enum' && f.access & ACC.ENUM) continue
    // A record's private fields come from its header.
    if (kind === 'record' && !(f.access & ACC.STATIC) && recordFields.has(f.name)) continue
    if (blank) out.push(0, '')
    blank = false
    printed = true
    const t: OutlineTarget = { kind: 'field', owner: cls.name, index }
    writeAnnotations(out, f.attributes, cls, namer, inner, c, t)
    const decl = fieldDeclaration(cls, f, namer, isInterface)
    out.push(inner, f.access & ACC.SYNTHETIC ? `// ${c.synthetic}: ${decl}` : decl, t)
  }

  blank = printed
  for (let index = 0; index < cls.methods.length && !out.full; index++) {
    const m = cls.methods[index]
    if (blank) out.push(0, '')
    blank = false
    printed = true
    const t: OutlineTarget = { kind: 'method', owner: cls.name, index }
    const { text: decl, name } = methodDeclarationAt(cls, m, namer)
    if (m.access & (ACC.SYNTHETIC | ACC.BRIDGE)) {
      const prefix = `// ${m.access & ACC.BRIDGE ? c.bridge : c.synthetic}: `
      out.push(inner, `${prefix}${decl}`, t, [name[0] + prefix.length, name[1] + prefix.length])
      continue
    }
    // Annotations belong to the method but name another type: only the declaration links to the bytecode.
    writeAnnotations(out, m.attributes, cls, namer, inner, c, t)
    // A Code attribute that cannot be read still means the method has a body.
    const code = m.attributes.find((a) => a.name === 'Code')
    const body = code?.error
      ? `{ /* ${fill(c.damagedCode, { reason: reasonOf(options, code.errorCode, code.error) })} */ }`
      : bodyComment(m, c)
    if (m.name === '<clinit>') out.push(inner, `static ${body}`, t, name)
    else if (code) out.push(inner, `${decl} ${body}`, t, name)
    else out.push(inner, `${decl}${kind === 'annotation' ? annotationDefault(cls, m, namer) : ''};`, t, name)
  }
  if (out.full) return out.close(depth, target)

  // Member classes, then anonymous and local classes declared here.
  const innerAttr = findAttribute(cls.attributes, 'InnerClasses')
  // Each class once, by its first entry: a crafted table may name one class thousands of times.
  const members = new Map<string, InnerClassEntry>()
  const locals = new Map<string, { name: string; anonymous: boolean }>()
  for (const e of innerAttr?.value.classes ?? []) {
    const name = pool.className(e.inner)
    if (name === cls.name) continue
    if (e.outer && pool.className(e.outer) === cls.name) {
      if (!members.has(name)) members.set(name, e)
    } else if (!e.outer && name.startsWith(`${cls.name}$`) && !locals.has(name)) {
      locals.set(name, { name, anonymous: !e.nameIndex })
    }
  }
  for (const [name, entry] of members) {
    if (out.full) break
    if (printed) out.push(0, '')
    printed = true
    // A class already written above is not read again.
    const nested = depth < MAX_NESTING && !seen.has(name) ? options.resolve?.(name) : undefined
    if (nested && !nested.error) {
      seen.add(name)
      writeClass(out, nested, namer, inner, options, seen)
    } else {
      const flags = entry.access
      const keyword =
        flags & ACC.ANNOTATION ? '@interface' : flags & ACC.INTERFACE ? 'interface' : flags & ACC.ENUM ? 'enum' : 'class'
      const modifiers = javaModifiers(flags, 'inner').filter(
        (m) => keyword === 'class' || (m !== 'static' && m !== 'abstract' && (keyword !== 'enum' || m !== 'final'))
      )
      const simple = entry.nameIndex ? pool.str(entry.nameIndex) : name
      const file = `${name.slice(name.lastIndexOf('/') + 1)}.class`
      out.push(inner, `${[...modifiers, keyword, namer.link(name, displayName(simple))].join(' ')} { /* ${fill(c.elsewhere, { file: displayName(file) })} */ }`, {
        kind: 'class',
        name
      })
    }
  }
  if (locals.size && !out.full) {
    if (printed) out.push(0, '')
    for (const l of locals.values()) {
      if (out.full) break
      // The local class's own file names the method it is declared in.
      const local = options.resolve?.(l.name)
      const enclosing = local && findAttribute(local.attributes, 'EnclosingMethod')
      let where = ''
      if (local && enclosing?.value.methodIndex) {
        const nt = local.pool.nameAndType(enclosing.value.methodIndex)
        const owner = cls.methods.find((m) => m.name === nt.name && m.descriptor === nt.descriptor)
        const parts = owner && methodParts(cls, owner, namer, false)
        const method = parts ? `${parts.name}(${parts.paramTypes.join(', ')})` : displayName(nt.name)
        where = ` ${fill(c.declaredIn, { method })}`
      }
      out.push(inner, `// ${l.anonymous ? c.anonymous : c.local} ${namer.link(l.name, displayName(l.name.slice(l.name.lastIndexOf('/') + 1)))}${where}`, {
        kind: 'class',
        name: l.name
      })
    }
  }
  if (cls.error && depth === 0) {
    out.push(0, '')
    out.push(inner, `// ${fill(c.damaged, { reason: reasonOf(options, cls.error.code, cls.error.message) })}`)
  }
  out.close(depth, target)
}

/** A member's annotations, one a line; past `MAX_ANNOTATION_LINES` a comment counts the rest. */
function writeAnnotations(
  out: Writer,
  attributes: AttributeInfo[],
  cls: ClassFile,
  namer: Namer,
  depth: number,
  c: OutlineComments,
  target?: OutlineTarget
): void {
  const list = annotationsOf(attributes)
  const shown = Math.min(list.length, MAX_ANNOTATION_LINES)
  for (let i = 0; i < shown && !out.full; i++) out.push(depth, annotationText(list[i], cls.pool, namer), target)
  if (list.length > shown) out.push(depth, `// ${fill(c.moreAnnotations, { n: list.length - shown })}`, target)
}

function writeModule(out: Writer, cls: ClassFile, namer: Namer, c: OutlineComments): void {
  const pool = cls.pool
  const attr = findAttribute(cls.attributes, 'Module')
  writeAnnotations(out, cls.attributes, cls, namer, 0, c)
  if (!attr) {
    out.push(0, `module ${binaryName(cls.name)} {}`)
    return
  }
  const m = attr.value.module
  const dotted = (i: number) => displayName(pool.str(i).replace(/\//g, '.'))
  const ref = (i: number) => {
    const e = pool.get(i)
    return e && 'ref' in e ? dotted(e.ref) : `<bad #${i}>`
  }
  const version = m.versionIndex ? ` // @${displayName(pool.str(m.versionIndex))}` : ''
  out.push(0, `${m.access & 0x0020 ? 'open ' : ''}module ${ref(m.nameIndex)} {${version}`)
  for (const r of m.requires) {
    if (out.full) break
    const mods = [r.access & 0x0020 ? 'transitive' : '', r.access & 0x0040 ? 'static' : ''].filter(Boolean)
    const v = r.versionIndex ? ` // @${displayName(pool.str(r.versionIndex))}` : ''
    out.push(1, `requires ${[...mods, ref(r.index)].join(' ')};${v}`)
  }
  for (const [word, list] of [
    ['exports', m.exports],
    ['opens', m.opens]
  ] as const) {
    for (const e of list) {
      if (out.full) break
      const to = e.to.length ? ` to ${joinWithin(e.to, ref)}` : ''
      out.push(1, `${word} ${ref(e.index)}${to};`)
    }
  }
  for (const u of m.uses) {
    if (out.full) break
    out.push(1, `uses ${binaryName(pool.className(u))};`)
  }
  for (const p of m.provides) {
    if (out.full) break
    out.push(1, `provides ${binaryName(pool.className(p.index))} with ${joinWithin(p.with, (w) => binaryName(pool.className(w)))};`)
  }
  out.close(0)
}

/** The outline of `cls` as lines of Java, each tied to the member it declares. */
export function buildOutline(cls: ClassFile, options: OutlineOptions = {}): Outline {
  const comments = options.comments ?? ENGLISH_COMMENTS
  const namer = makeNamer(cls, false, true)
  const budget = new RowBudget(options.limit ?? MAX_LISTED_ROWS)
  const body = new Writer(namer.linkTargets, budget, comments.cut)
  const kind = classKind(cls)
  const pkg = cls.name.includes('/') ? cls.name.slice(0, cls.name.lastIndexOf('/')) : ''
  if (kind === 'module') writeModule(body, cls, namer, comments)
  else if (kind === 'package') {
    writeAnnotations(body, cls.attributes, cls, namer, 0, comments)
  } else {
    // A member class opened on its own still shows as the top level of its outline.
    writeClass(body, cls, namer, 0, { ...options, comments }, new Set([cls.name]))
  }

  const head = new Writer(namer.linkTargets)
  const lang = detectLanguage(cls)
  const file = `${cls.name.slice(cls.name.lastIndexOf('/') + 1) || '?'}.class`
  head.push(0, `// ${fill(comments.header, { file: displayName(file) })}`)
  const release = releaseLabel(cls.major, cls.minor)
  head.push(
    0,
    `// ${lang.sourceFile ? fill(comments.compiledFrom, { source: displayName(lang.sourceFile), release }) : fill(comments.compiledFor, { release })}`
  )
  if (comments.language[lang.language]) head.push(0, `// ${comments.language[lang.language]}`)
  head.push(0, '')
  if (pkg && kind !== 'module') {
    head.push(0, `package ${displayName(pkg.replace(/\//g, '.'))};`)
    head.push(0, '')
  }
  const imports = [...namer.used]
    .filter((n) => n.includes('/') && n.slice(0, n.lastIndexOf('/')) !== pkg)
    .filter((n) => n.slice(0, n.lastIndexOf('/')) !== 'java/lang' && n !== cls.name)
    .map((n) => ({ name: n, text: displayName(n.replace(/\//g, '.')) }))
    .sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
  if (imports.length && kind !== 'module') {
    for (const i of imports) head.push(0, `import ${namer.link(i.name, i.text)};`)
    head.push(0, '')
  }
  const lines = [...head.lines, ...body.lines]
  return { lines, text: lines.map((l) => l.text).join('\n') + '\n', cut: budget.cut }
}

/** Short Java text of one member, for the structure view. */
export function memberDeclaration(cls: ClassFile, member: Member, kind: 'field' | 'method'): string {
  const namer = makeNamer(cls)
  return kind === 'field' ? fieldDeclaration(cls, member, namer) : methodDeclaration(cls, member, namer)
}

export { fieldType, ownInnerEntry }
