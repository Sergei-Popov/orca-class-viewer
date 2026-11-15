// The Bytecode tab's text, in the shape of `javap -c -v`: per method its declaration,
// descriptor, flags, then the code with constant pool operands resolved, the exception table,
// LineNumberTable, LocalVariableTable and a summary of the StackMapTable. Lines are made of
// segments so the view can colour them and link `#12` to the constant pool and `goto 40` to
// its target.

import { type AttributeInfo, type CodeAttribute, type StackMapFrame, type VerificationType, findAttribute } from '../classfile/attributes'
import { MAX_LISTED_ROWS, RowBudget, joinWithin } from '../classfile/budget'
import type { ClassFile, Member } from '../classfile/classfile'
import { annotationText, elementText, makeNamer, methodDeclaration } from '../classfile/declarations'
import { flagSummary } from '../classfile/flags'
import { displayName, stringText } from '../classfile/names'
import type { ConstantPool } from '../classfile/pool'
import type { Namer } from '../classfile/types'
import { type Instruction, branchTargets, disassemble } from './disasm'

export { MAX_LISTED_ROWS }

export type SegKind =
  | 'plain'
  | 'java' // a Java declaration: the view highlights it as Java
  | 'op' // mnemonic
  | 'offset'
  | 'label' // an offset something jumps to
  | 'num'
  | 'comment'
  | 'key' // "descriptor:", "Code:"
  | 'cp' // #12, links to the constant pool
  | 'jump' // a branch target, links to the instruction
  | 'bad'

export type Seg = { text: string; kind: SegKind; ref?: number }

export type ListingLine = {
  segs: Seg[]
  /** `m3` on a method's first line, `m3@12` on the instruction at offset 12 of method 3. */
  anchor?: string
  /** The method this line belongs to. */
  method?: number
  /** On the line that stands for a method's code left out of the listing: its length in bytes. */
  cut?: number
  /** On the line that stands for what a full listing left out: entries of the list above, or attributes. */
  omitted?: { count: number; of: 'entries' | 'attributes' }
}

/** What one listing shares between its methods. */
type Listing = {
  namer: Namer
  /** Rows of code, tables and attributes. */
  budget?: RowBudget
  /** Rows of declarations: past them, a method's first line is short. */
  headers?: RowBudget
  /** Constant comments by pool index, each written once however many instructions use it. */
  comments: Map<number, string>
  /** For each method, whether its code is listed. */
  listed: boolean[]
}

const listingOf = (cls: ClassFile, limit?: number): Listing => ({
  namer: makeNamer(cls, true),
  budget: limit === undefined ? undefined : new RowBudget(limit),
  headers: limit === undefined ? undefined : new RowBudget(limit),
  comments: new Map(),
  listed: []
})

const s = (text: string, kind: SegKind = 'plain', ref?: number): Seg => (ref === undefined ? { text, kind } : { text, kind, ref })

/** A jump target right-aligned in `width` columns; only the number is the link. */
const jumpAt = (target: number, width: number): Seg[] => {
  const text = String(target)
  return [s(' '.repeat(Math.max(0, width - text.length))), s(text, 'jump', target)]
}

const TYPE_LABELS: Record<number, string> = {
  1: 'Utf8',
  3: 'int',
  4: 'float',
  5: 'long',
  6: 'double',
  7: 'class',
  8: 'String',
  9: 'Field',
  10: 'Method',
  11: 'InterfaceMethod',
  12: 'NameAndType',
  15: 'MethodHandle',
  16: 'MethodType',
  17: 'Dynamic',
  18: 'InvokeDynamic',
  19: 'Module',
  20: 'Package'
}

/** `// Method java/lang/Object."<init>":()V` */
export function cpComment(pool: ConstantPool, index: number): string {
  const e = pool.get(index)
  if (!e) return `// <bad #${index}>`
  const label = TYPE_LABELS[e.tag] ?? '?'
  const text = pool.text(index)
  // javap writes "String hello world" without quotes, a newline as \n.
  return `// ${label} ${e.tag === 8 ? stringText(pool.str(e.ref)) : text}`
}

const VTYPE = ['top', 'int', 'float', 'double', 'long', 'null', 'uninitialized this']

export function verificationText(pool: ConstantPool, v: VerificationType): string {
  if (v.tag === 7) {
    const name = displayName(pool.className(v.index ?? 0))
    return name.startsWith('[') ? name : `class ${name}`
  }
  if (v.tag === 8) return `uninitialized ${v.offset}`
  return VTYPE[v.tag] ?? `?${v.tag}`
}

export function frameText(pool: ConstantPool, f: StackMapFrame): string {
  const list = (vs: VerificationType[] | undefined) => `[${joinWithin(vs ?? [], (v) => verificationText(pool, v))}]`
  switch (f.kind) {
    case 'same':
      return 'same'
    case 'same_locals_1_stack_item':
      return `same locals, stack ${list(f.stack)}`
    case 'chop':
      return `chop ${f.chop}`
    case 'append':
      return `append ${list(f.locals)}`
    case 'full':
      return `full locals ${list(f.locals)}, stack ${list(f.stack)}`
  }
}

function pad(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width)
}

/** Lines of one instruction (switches take several). */
function instructionLines(
  ins: Instruction,
  comment: (index: number) => string,
  method: number,
  targets: Set<number>,
  localName: (slot: number, pc: number) => string | undefined
): ListingLine[] {
  const anchor = `m${method}@${ins.offset}`
  const offsetSeg = s(`${String(ins.offset).padStart(6)}: `, targets.has(ins.offset) ? 'label' : 'offset')
  const name = ins.wide ? `${ins.mnemonic}_w` : ins.mnemonic
  const bare = ins.operands.length === 0 && !ins.invalid
  const segs: Seg[] = [offsetSeg, s(ins.invalid === 'opcode' || bare ? name : pad(name, 14), ins.invalid ? 'bad' : 'op')]
  if (ins.invalid === 'truncated') {
    segs.push(s('// cut off by the end of the code', 'bad'))
    return [{ segs, anchor, method }]
  }
  if (ins.invalid === 'opcode') {
    segs.push(s(` 0x${ins.opcode.toString(16).padStart(2, '0')}`, 'bad'), s('  // not a JVM opcode', 'bad'))
    return [{ segs, anchor, method }]
  }
  if (ins.invalid === 'operand') {
    segs.push(s('// bad operands', 'bad'))
    return [{ segs, anchor, method }]
  }
  let note = ''
  let width = 6 + 2 + 14
  for (const op of ins.operands) {
    switch (op.kind) {
      case 'cp': {
        const text = `#${op.index}`
        segs.push(s(text, 'cp', op.index))
        width += text.length
        note = comment(op.index)
        break
      }
      case 'int':
      case 'count': {
        const text = (segs.length > 2 ? ', ' : '') + String(op.value)
        segs.push(s(text, 'num'))
        width += text.length
        break
      }
      case 'local': {
        const text = String(op.index)
        segs.push(s(text, 'num'))
        width += text.length
        const n = localName(op.index, ins.offset)
        if (n !== undefined) note = `// ${displayName(n)}`
        break
      }
      case 'branch': {
        const text = String(op.target)
        segs.push(s(text, 'jump', op.target))
        width += text.length
        break
      }
      case 'atype':
        segs.push(s(op.name, 'plain'))
        width += op.name.length
        break
      case 'switch': {
        const head = op.low !== undefined ? `{ // ${op.low} to ${op.high}` : `{ // ${op.cases.length}`
        segs.push(s(head, 'comment'))
        const lines: ListingLine[] = [{ segs, anchor, method }]
        for (const [match, target] of op.cases) {
          lines.push({
            segs: [s(`${String(match).padStart(22)}: `, 'num'), s(String(target), 'jump', target)],
            method
          })
        }
        lines.push({ segs: [s(`${'default'.padStart(22)}: `, 'plain'), s(String(op.defaultTarget), 'jump', op.defaultTarget)], method })
        lines.push({ segs: [s(`${''.padStart(8)}}`, 'plain')], method })
        return lines
      }
    }
  }
  if (note) {
    const gap = Math.max(1, 46 - width)
    segs.push(s(' '.repeat(gap)), s(note, 'comment'))
  }
  return [{ segs, anchor, method }]
}

/** Lines that take their rows from a budget; `add` refuses a line once the budget has no room. */
class Sink {
  readonly lines: ListingLine[] = []
  constructor(
    private readonly budget: RowBudget | undefined,
    private readonly method: number | undefined
  ) {}

  add(line: ListingLine): boolean {
    if (this.budget) {
      let chars = 0
      for (const seg of line.segs) chars += seg.text.length
      if (!this.budget.line(chars)) return false
    }
    this.lines.push(line)
    return true
  }

  line(...segs: Seg[]): boolean {
    return this.add(this.method === undefined ? { segs } : { segs, method: this.method })
  }

  /** A line that says how much was left out; it takes no rows. */
  omitted(indent: string, count: number, of: 'entries' | 'attributes'): void {
    const line: ListingLine = { segs: [s(indent)], omitted: { count, of } }
    if (this.method !== undefined) line.method = this.method
    this.lines.push(line)
  }
}

/**
 * The lines of `attributes`, skipping those read as `skip`. Each entry of a list takes its rows;
 * once the budget is spent, a line counts the entries left out, and another the attributes.
 */
function attributeLines(cls: ClassFile, attributes: AttributeInfo[], indent: string, method: number | undefined, skip: string | undefined, listing: Listing): ListingLine[] {
  const pool = cls.pool
  const namer = listing.namer
  const out = new Sink(listing.budget, method)
  const remaining = (from: number) => {
    let n = 0
    for (let k = from; k < attributes.length; k++) if (attributes[k].value.kind !== skip) n++
    return n
  }
  /** A header, then one line per entry while they fit. */
  const entries = (header: Seg[], count: number, entry: (i: number) => Seg[]): boolean => {
    if (!out.line(...header)) return false
    for (let i = 0; i < count; i++) {
      if (!out.line(...entry(i))) {
        out.omitted(`${indent}  `, count - i, 'entries')
        return false
      }
    }
    return true
  }
  for (let k = 0; k < attributes.length; k++) {
    const a = attributes[k]
    // Skips by what was read: a damaged Code attribute is Raw and is listed with its error.
    if (a.value.kind === skip) continue
    const before = out.lines.length
    const v = a.value
    // An attribute the JVM does not know may be named anything, controls and bidi marks included.
    const name = displayName(a.name)
    let ok: boolean
    switch (v.kind) {
      case 'Exceptions':
        ok = out.line(s(`${indent}Exceptions:`, 'key')) && out.line(s(`${indent}  throws `), s(joinWithin(v.indices, (i) => displayName(pool.className(i).replace(/\//g, '.'))), 'java'))
        break
      case 'Signature':
        ok = out.line(s(`${indent}Signature: `, 'key'), s(`#${v.index}`, 'cp', v.index), s(`  // ${displayName(pool.str(v.index))}`, 'comment'))
        break
      case 'Annotations':
        ok = entries([s(`${indent}${name}:`, 'key')], v.annotations.length, (i) => [s(`${indent}  `), s(annotationText(v.annotations[i], pool, namer), 'java')])
        break
      case 'ParameterAnnotations':
        ok = entries([s(`${indent}${name}:`, 'key')], v.parameters.length, (i) => [
          s(`${indent}  parameter ${i}: `),
          s(joinWithin(v.parameters[i], (ann) => annotationText(ann, pool, namer), ' ') || '—', 'java')
        ])
        break
      case 'TypeAnnotations':
        ok = entries([s(`${indent}${name}:`, 'key')], v.annotations.length, (i) => [
          s(`${indent}  `),
          s(annotationText(v.annotations[i].annotation, pool, namer), 'java'),
          s(`  // ${v.annotations[i].target}`, 'comment')
        ])
        break
      case 'MethodParameters':
        ok = entries([s(`${indent}MethodParameters:`, 'key')], v.parameters.length, (i) => {
          const p = v.parameters[i]
          return [s(`${indent}  ${p.nameIndex ? displayName(pool.str(p.nameIndex)) : '<no name>'}`), s(p.access ? `  ${flagSummary(p.access, 'parameter')}` : '', 'comment')]
        })
        break
      case 'ConstantValue':
        ok = out.line(s(`${indent}ConstantValue: `, 'key'), s(`#${v.index}`, 'cp', v.index), s(`  // ${pool.literal(v.index)}`, 'comment'))
        break
      case 'Marker':
        ok = out.line(s(`${indent}${name}: true`, 'key'))
        break
      case 'AnnotationDefault':
        // javap: `AnnotationDefault:` then `default_value: s#12`; this writes the value as Java does.
        ok = out.line(s(`${indent}AnnotationDefault: `, 'key'), s(elementText(v.value, pool, namer), 'java'))
        break
      default:
        ok = out.line(s(`${indent}${name}: `, 'key'), s(`${a.length} bytes${a.error ? ` — ${a.error}` : ''}`, a.error ? 'bad' : 'comment'))
    }
    if (!ok) {
      // This attribute, when nothing of it was written, and the ones after it are left out.
      const left = remaining(out.lines.length === before ? k : k + 1)
      if (left) out.omitted(indent, left, 'attributes')
      break
    }
  }
  return out.lines
}

/** The lines of a method's code, or undefined when they do not all fit in the budget. */
function codeLines(cls: ClassFile, index: number, c: CodeAttribute, listing: Listing): ListingLine[] | undefined {
  if (listing.budget?.cut) return undefined
  const pool = cls.pool
  const out = new Sink(listing.budget, index)
  const instructions = disassemble(c.code)
  const targets = branchTargets(instructions)
  for (const e of c.exceptions) targets.add(e.handler)
  const localName = localNames(pool, findAttribute(c.attributes, 'LocalVariableTable')?.value.variables)
  const comment = (i: number) => {
    let text = listing.comments.get(i)
    if (text === undefined) {
      text = cpComment(pool, i)
      listing.comments.set(i, text)
    }
    return text
  }
  if (!out.line(s('  Code:', 'key'))) return undefined
  const args = argsSize(cls.methods[index])
  if (!out.line(s(`    stack=${c.maxStack}, locals=${c.maxLocals}${args === undefined ? '' : `, args_size=${args}`}`, 'comment'))) return undefined
  for (const ins of instructions) for (const l of instructionLines(ins, comment, index, targets, localName)) if (!out.add(l)) return undefined
  if (c.exceptions.length) {
    if (!out.line(s('    Exception table:', 'key')) || !out.line(s('       from    to  target type', 'comment'))) return undefined
    for (const e of c.exceptions) {
      const ok = out.line(
        ...jumpAt(e.start, 10),
        s(`${String(e.end).padStart(6)}`, 'num'),
        ...jumpAt(e.handler, 6),
        s('   '),
        e.catchType ? s(`Class ${displayName(pool.className(e.catchType))}`, 'cp', e.catchType) : s('any')
      )
      if (!ok) return undefined
    }
  }
  for (const a of c.attributes) {
    const v = a.value
    if (v.kind === 'LineNumberTable') {
      if (!out.line(s('    LineNumberTable:', 'key'))) return undefined
      for (const l of v.lines) if (!out.line(s(`      line ${l.line}: `), s(String(l.start), 'jump', l.start))) return undefined
    } else if (v.kind === 'LocalVariableTable' || v.kind === 'LocalVariableTypeTable') {
      if (!out.line(s(`    ${displayName(a.name)}:`, 'key')) || !out.line(s('      Start  Length  Slot  Name   Signature', 'comment'))) return undefined
      for (const x of v.variables) {
        const ok = out.line(
          ...jumpAt(x.start, 11),
          s(`${String(x.length).padStart(8)}${String(x.slot).padStart(6)}  `, 'num'),
          s(pad(displayName(pool.str(x.nameIndex)), 6)),
          s(` ${displayName(pool.str(x.descriptorIndex))}`)
        )
        if (!ok) return undefined
      }
    } else if (v.kind === 'StackMapTable') {
      if (!out.line(s(`    StackMapTable: ${v.frames.length} ${v.frames.length === 1 ? 'frame' : 'frames'}`, 'key'))) return undefined
      for (const f of v.frames) if (!out.line(s('      at '), s(String(f.offset), 'jump', f.offset), s(`: ${frameText(pool, f)}`, 'comment'))) return undefined
    } else {
      // The code's other attributes, type annotations among them, belong to the code: all or nothing.
      const lines = attributeLines(cls, [a], '    ', index, undefined, listing)
      if (listing.budget?.cut) return undefined
      for (const l of lines) out.lines.push(l)
    }
  }
  return out.lines
}

type Variable = { start: number; length: number; slot: number; nameIndex: number }
type Range = { from: number; to: number; order: number; nameIndex: number }

/** A binary heap of ranges, the one first in the table on top. */
class RangeHeap {
  readonly items: Range[] = []
  push(r: Range): void {
    const a = this.items
    a.push(r)
    let i = a.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (a[up].order <= r.order) break
      a[i] = a[up]
      i = up
    }
    a[i] = r
  }
  pop(): void {
    const a = this.items
    const last = a.pop()
    if (!a.length || !last) return
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      if (l >= a.length) break
      const m = l + 1 < a.length && a[l + 1].order < a[l].order ? l + 1 : l
      if (a[m].order >= last.order) break
      a[i] = a[m]
      i = m
    }
    a[i] = last
  }
}

/**
 * The name of a local variable at an instruction, from a LocalVariableTable: of the ranges that
 * hold the instruction, the table's first one wins. A scan of the whole table per instruction is
 * quadratic in a crafted method, so each slot is swept once as the listing goes down the code: the
 * ranges started so far wait in a heap ordered by their place in the table, and those that ended
 * leave it when they reach its top.
 */
export function localNames(pool: ConstantPool, vars: readonly Variable[] | undefined): (slot: number, pc: number) => string | undefined {
  if (!vars?.length) return () => undefined
  const bySlot = new Map<number, Range[]>()
  vars.forEach((v, order) => {
    // A store names the variable that starts right after it: up to 4 bytes before its range.
    const range = { from: v.start - 4, to: v.start + v.length, order, nameIndex: v.nameIndex }
    const list = bySlot.get(v.slot)
    if (list) list.push(range)
    else bySlot.set(v.slot, [range])
  })
  for (const list of bySlot.values()) list.sort((a, b) => a.from - b.from || a.order - b.order)
  const sweeps = new Map<number, { pc: number; next: number; heap: RangeHeap }>()
  return (slot, pc) => {
    const list = bySlot.get(slot)
    if (!list) return undefined
    let sweep = sweeps.get(slot)
    // The listing asks in code order; a step back starts the slot's sweep over.
    if (!sweep || pc < sweep.pc) {
      sweep = { pc, next: 0, heap: new RangeHeap() }
      sweeps.set(slot, sweep)
    }
    sweep.pc = pc
    while (sweep.next < list.length && list[sweep.next].from <= pc) sweep.heap.push(list[sweep.next++])
    const heap = sweep.heap
    while (heap.items.length && heap.items[0].to <= pc) heap.pop()
    return heap.items.length ? pool.utf8(heap.items[0].nameIndex) : undefined
  }
}

/** At most this many characters of a name on the short first line of a method in a full listing. */
const SHORT_NAME = 200

const clip = (text: string) => (text.length > SHORT_NAME ? `${text.slice(0, SHORT_NAME)}…` : text)

/** The listing of one method. Past its budget, the code and attributes are left out and say so. */
export function methodListing(cls: ClassFile, index: number, listing: Listing = listingOf(cls)): ListingLine[] {
  const m: Member = cls.methods[index]
  const out: ListingLine[] = []
  // Every method keeps a first line with its anchor, so "Go to method" finds it.
  if (listing.headers?.cut) {
    out.push({ segs: [s(`${clip(displayName(m.name))}${clip(displayName(m.descriptor))}`)], anchor: `m${index}`, method: index })
  } else {
    const head: ListingLine[] = [
      { segs: [s(`${methodDeclaration(cls, m, listing.namer)};`, 'java')], anchor: `m${index}`, method: index },
      { segs: [s('  descriptor: ', 'key'), s(displayName(m.descriptor))], method: index },
      { segs: [s('  flags: ', 'key'), s(flagSummary(m.access, 'method'))], method: index }
    ]
    for (const l of head) {
      out.push(l)
      listing.headers?.line(l.segs.reduce((n, seg) => n + seg.text.length, 0))
    }
  }
  const code = findAttribute(m.attributes, 'Code')
  if (code) {
    const c = code.value.code
    const lines = codeLines(cls, index, c, listing)
    listing.listed[index] = lines !== undefined
    if (lines) append(out, lines)
    else out.push({ segs: [s('  Code: ', 'key'), s(`${c.code.length} bytes, not listed`, 'comment')], method: index, cut: c.code.length })
  }
  append(out, attributeLines(cls, m.attributes, '  ', index, 'Code', listing))
  return out
}

/** javap's args_size: one per parameter, long and double too, and one for `this`. */
function argsSize(m: Member): number | undefined {
  let count = m.access & 0x0008 ? 0 : 1
  const d = m.descriptor
  let i = d.indexOf('(') + 1
  if (i <= 0) return undefined
  while (d[i] !== ')') {
    if (i >= d.length) return undefined
    while (d[i] === '[') i++
    const ch = d[i]
    if (ch === 'L') {
      i = d.indexOf(';', i) + 1
      if (i === 0) return undefined
    } else if (ch !== undefined && 'BCDFIJSZ'.includes(ch)) i++
    else return undefined
    count++
  }
  return count
}

/** Appends in a loop: a spread of a long listing would pass every line as an argument. */
function append(out: ListingLine[], lines: ListingLine[]): void {
  for (const l of lines) out.push(l)
}

/** For each class listed whole with the default limit, which methods have their code listed. */
const LISTED = new WeakMap<ClassFile, boolean[]>()

/**
 * The whole Bytecode tab: every method, a blank line between them. Once `limit` rows are listed,
 * the remaining methods keep a first line with their anchor, so "Go to method" still finds them,
 * and lines marked `cut` and `omitted` stand for their code and attributes.
 */
export function classListing(cls: ClassFile, limit = MAX_LISTED_ROWS): ListingLine[] {
  const listing = listingOf(cls, limit)
  const out: ListingLine[] = []
  cls.methods.forEach((_, i) => {
    if (i) out.push({ segs: [s('')] })
    append(out, methodListing(cls, i, listing))
  })
  if (limit === MAX_LISTED_ROWS) LISTED.set(cls, listing.listed)
  return out
}

/** Whether the Bytecode tab lists method `index`'s code: the Constant pool searches the same code. */
export function codeListed(cls: ClassFile, limit = MAX_LISTED_ROWS): (index: number) => boolean {
  let listed = limit === MAX_LISTED_ROWS ? LISTED.get(cls) : undefined
  if (!listed) {
    const listing = listingOf(cls, limit)
    cls.methods.forEach((_, i) => methodListing(cls, i, listing))
    listed = listing.listed
    if (limit === MAX_LISTED_ROWS) LISTED.set(cls, listed)
  }
  const result = listed
  return (index) => result[index] === true
}
