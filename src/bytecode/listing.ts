// The Bytecode tab's text, in the shape of `javap -c -v`: per method its declaration,
// descriptor, flags, then the code with constant pool operands resolved, the exception table,
// LineNumberTable, LocalVariableTable and a summary of the StackMapTable. Lines are made of
// segments so the view can colour them and link `#12` to the constant pool and `goto 40` to
// its target.

import { type AttributeInfo, type StackMapFrame, type VerificationType, findAttribute } from '../classfile/attributes'
import type { ClassFile, Member } from '../classfile/classfile'
import { annotationText, makeNamer, methodDeclaration } from '../classfile/declarations'
import { flagSummary } from '../classfile/flags'
import { displayName, stringText } from '../classfile/names'
import type { ConstantPool } from '../classfile/pool'
import { type Instruction, branchTargets, disassemble } from './disasm'

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
}

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
  const list = (vs: VerificationType[] | undefined) => `[${(vs ?? []).map((v) => verificationText(pool, v)).join(', ')}]`
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
  pool: ConstantPool,
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
  let comment = ''
  let width = 6 + 2 + 14
  for (const op of ins.operands) {
    switch (op.kind) {
      case 'cp': {
        const text = `#${op.index}`
        segs.push(s(text, 'cp', op.index))
        width += text.length
        comment = cpComment(pool, op.index)
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
        if (n !== undefined) comment = `// ${displayName(n)}`
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
  if (comment) {
    const gap = Math.max(1, 46 - width)
    segs.push(s(' '.repeat(gap)), s(comment, 'comment'))
  }
  return [{ segs, anchor, method }]
}

function attributeListing(cls: ClassFile, attributes: AttributeInfo[], indent: string, method: number | undefined, skip: Set<string>): ListingLine[] {
  const pool = cls.pool
  const namer = makeNamer(cls, true)
  const out: ListingLine[] = []
  const line = (...segs: Seg[]) => out.push(method === undefined ? { segs } : { segs, method })
  for (const a of attributes) {
    // Skips by what was read: a damaged Code attribute is Raw and is listed with its error.
    if (skip.has(a.value.kind)) continue
    const v = a.value
    switch (v.kind) {
      case 'Exceptions':
        line(s(`${indent}Exceptions:`, 'key'))
        line(s(`${indent}  throws `), s(v.indices.map((i) => displayName(pool.className(i).replace(/\//g, '.'))).join(', '), 'java'))
        break
      case 'Signature':
        line(s(`${indent}Signature: `, 'key'), s(`#${v.index}`, 'cp', v.index), s(`  // ${displayName(pool.str(v.index))}`, 'comment'))
        break
      case 'Annotations':
        line(s(`${indent}${a.name}:`, 'key'))
        for (const ann of v.annotations) line(s(`${indent}  `), s(annotationText(ann, pool, namer), 'java'))
        break
      case 'ParameterAnnotations':
        line(s(`${indent}${a.name}:`, 'key'))
        v.parameters.forEach((list, i) => {
          line(s(`${indent}  parameter ${i}: `), s(list.map((ann) => annotationText(ann, pool, namer)).join(' ') || '—', 'java'))
        })
        break
      case 'TypeAnnotations':
        line(s(`${indent}${a.name}:`, 'key'))
        for (const ann of v.annotations) {
          line(s(`${indent}  `), s(annotationText(ann.annotation, pool, namer), 'java'), s(`  // ${ann.target}`, 'comment'))
        }
        break
      case 'MethodParameters':
        line(s(`${indent}MethodParameters:`, 'key'))
        for (const p of v.parameters) {
          line(s(`${indent}  ${p.nameIndex ? displayName(pool.str(p.nameIndex)) : '<no name>'}`), s(p.access ? `  ${flagSummary(p.access, 'parameter')}` : '', 'comment'))
        }
        break
      case 'ConstantValue':
        line(s(`${indent}ConstantValue: `, 'key'), s(`#${v.index}`, 'cp', v.index), s(`  // ${pool.literal(v.index)}`, 'comment'))
        break
      case 'Marker':
        line(s(`${indent}${a.name}: true`, 'key'))
        break
      case 'AnnotationDefault':
        line(s(`${indent}AnnotationDefault: `, 'key'))
        break
      default:
        line(s(`${indent}${a.name}: `, 'key'), s(`${a.length} bytes${a.error ? ` — ${a.error}` : ''}`, a.error ? 'bad' : 'comment'))
    }
  }
  return out
}

/** The listing of one method. */
export function methodListing(cls: ClassFile, index: number): ListingLine[] {
  const m: Member = cls.methods[index]
  const pool = cls.pool
  const namer = makeNamer(cls, true)
  const out: ListingLine[] = []
  const line = (...segs: Seg[]) => out.push({ segs, method: index })
  out.push({ segs: [s(`${methodDeclaration(cls, m, namer)};`, 'java')], anchor: `m${index}`, method: index })
  line(s('  descriptor: ', 'key'), s(displayName(m.descriptor)))
  line(s('  flags: ', 'key'), s(flagSummary(m.access, 'method')))
  const code = findAttribute(m.attributes, 'Code')
  if (code) {
    const c = code.value.code
    const instructions = disassemble(c.code)
    const targets = branchTargets(instructions)
    for (const e of c.exceptions) targets.add(e.handler)
    const lvt = findAttribute(c.attributes, 'LocalVariableTable')
    const localName = (slot: number, pc: number) => {
      const vars = lvt?.value.variables
      if (!vars) return undefined
      // A store names the variable that starts right after it.
      const v = vars.find((x) => x.slot === slot && pc >= x.start - 4 && pc < x.start + x.length)
      return v ? pool.utf8(v.nameIndex) : undefined
    }
    line(s('  Code:', 'key'))
    const args = argsSize(m)
    line(s(`    stack=${c.maxStack}, locals=${c.maxLocals}${args === undefined ? '' : `, args_size=${args}`}`, 'comment'))
    for (const ins of instructions) append(out, instructionLines(ins, pool, index, targets, localName))
    if (c.exceptions.length) {
      line(s('    Exception table:', 'key'))
      line(s('       from    to  target type', 'comment'))
      for (const e of c.exceptions) {
        line(
          ...jumpAt(e.start, 10),
          s(`${String(e.end).padStart(6)}`, 'num'),
          ...jumpAt(e.handler, 6),
          s('   '),
          e.catchType ? s(`Class ${displayName(pool.className(e.catchType))}`, 'cp', e.catchType) : s('any')
        )
      }
    }
    for (const a of c.attributes) {
      const v = a.value
      if (v.kind === 'LineNumberTable') {
        line(s('    LineNumberTable:', 'key'))
        for (const l of v.lines) line(s(`      line ${l.line}: `), s(String(l.start), 'jump', l.start))
      } else if (v.kind === 'LocalVariableTable' || v.kind === 'LocalVariableTypeTable') {
        line(s(`    ${a.name}:`, 'key'))
        line(s('      Start  Length  Slot  Name   Signature', 'comment'))
        for (const x of v.variables) {
          line(
            ...jumpAt(x.start, 11),
            s(`${String(x.length).padStart(8)}${String(x.slot).padStart(6)}  `, 'num'),
            s(pad(displayName(pool.str(x.nameIndex)), 6)),
            s(` ${displayName(pool.str(x.descriptorIndex))}`)
          )
        }
      } else if (v.kind === 'StackMapTable') {
        line(s(`    StackMapTable: ${v.frames.length} ${v.frames.length === 1 ? 'frame' : 'frames'}`, 'key'))
        for (const f of v.frames) line(s('      at '), s(String(f.offset), 'jump', f.offset), s(`: ${frameText(pool, f)}`, 'comment'))
      } else {
        append(out, attributeListing(cls, [a], '    ', index, new Set()))
      }
    }
  }
  append(out, attributeListing(cls, m.attributes, '  ', index, new Set(['Code'])))
  return out
}

function argsSize(m: Member): number | undefined {
  try {
    let slots = m.access & 0x0008 ? 0 : 1
    const d = m.descriptor
    let i = d.indexOf('(') + 1
    if (i <= 0) return undefined
    while (d[i] !== ')') {
      if (i >= d.length) return undefined
      const ch = d[i]
      if (ch === 'J' || ch === 'D') {
        slots += 2
        i++
      } else if (ch === 'L') {
        slots++
        i = d.indexOf(';', i) + 1
        if (i === 0) return undefined
      } else if (ch === '[') {
        while (d[i] === '[') i++
        if (d[i] === 'L') i = d.indexOf(';', i) + 1
        else i++
        slots++
        if (i === 0) return undefined
      } else {
        slots++
        i++
      }
    }
    return slots
  } catch {
    return undefined
  }
}

/** Appends in a loop: a spread of a long listing would pass every line as an argument. */
function append(out: ListingLine[], lines: ListingLine[]): void {
  for (const l of lines) out.push(l)
}

/** The whole Bytecode tab: every method, a blank line between them. */
export function classListing(cls: ClassFile): ListingLine[] {
  const out: ListingLine[] = []
  cls.methods.forEach((_, i) => {
    if (i) out.push({ segs: [s('')] })
    append(out, methodListing(cls, i))
  })
  return out
}
