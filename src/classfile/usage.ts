// Who uses each constant pool entry: other entries, instructions in the bytecode, and the class's
// own structure (its name, members and attributes). Plain data for the Constant pool tab, which
// translates the parts of a use site and links the instructions.

import { disassemble } from '../bytecode/disasm'
import { MAX_LISTED_ROWS, codeListed } from '../bytecode/listing'
import type { AttributeInfo } from './attributes'
import type { ClassFile } from './classfile'

export type CodeUse = { method: number; offset: number }

/** A part of the class file, named for the reader in their language. */
export type UsePart = 'name' | 'descriptor' | 'attributeName' | 'exceptionTable' | 'argument'

/**
 * A step on the way to a use: an attribute or item named as the class file format names it
 * (`Code`, `this_class`, `BootstrapMethods[0]`), or a part to translate.
 */
export type UseStep = string | { part: UsePart }

/** Where an entry is used: the class itself, a field, a method or a record component, then the steps. */
export type UseSite = { owner: 'class' | 'field' | 'method' | 'component'; name?: string; path: UseStep[] }

export type Usage = { referredBy: number[]; code: CodeUse[]; sites: UseSite[] }

/** Every entry's uses, by index; `codeCut` when some code was not searched, as the Bytecode tab does not list it. */
export type PoolUsage = Usage[] & { codeCut?: boolean }

const sameStep = (a: UseStep, b: UseStep) => (typeof a === 'string' ? a === b : typeof b !== 'string' && a.part === b.part)

/**
 * Who uses each entry. The bytecode is searched in the methods whose code the Bytecode tab lists
 * within `limit` rows: a crafted class of many full methods would make tens of millions of uses,
 * and a use the tab does not list could not be shown.
 */
export function poolUsage(cls: ClassFile, limit = MAX_LISTED_ROWS): PoolUsage {
  const pool = cls.pool
  const usage: PoolUsage = Array.from({ length: pool.entries.length }, () => ({ referredBy: [], code: [], sites: [] }))
  const listed = codeListed(cls, limit)
  const valid = (index: number) => index > 0 && index < usage.length
  const add = (index: number, at: UseSite, ...steps: UseStep[]) => {
    if (!valid(index)) return
    const sites = usage[index].sites
    const path = [...at.path, ...steps]
    const last = sites[sites.length - 1]
    // A site once in a row: 65,535 annotations of one type in one attribute are one use of its name.
    const repeated = last && last.owner === at.owner && last.name === at.name && last.path.length === path.length && path.every((step, i) => sameStep(step, last.path[i]))
    if (!repeated) sites.push({ ...at, path })
  }
  const within = (at: UseSite, step: UseStep): UseSite => ({ ...at, path: [...at.path, step] })

  for (let i = 1; i < pool.entries.length; i++) for (const r of pool.refs(i)) if (valid(r)) usage[r].referredBy.push(i)

  const theClass: UseSite = { owner: 'class', path: [] }
  add(cls.thisIndex, theClass, 'this_class')
  add(cls.superIndex, theClass, 'super_class')
  for (const i of cls.interfaceIndices) add(i, theClass, 'interfaces')

  const attributes = (list: AttributeInfo[], at: UseSite) => {
    for (const a of list) {
      add(a.nameIndex, at, a.name, { part: 'attributeName' })
      const v = a.value
      switch (v.kind) {
        case 'Signature':
        case 'SourceFile':
        case 'ConstantValue':
        case 'NestHost':
        case 'ModuleMainClass':
          add(v.index, at, a.name)
          break
        case 'Exceptions':
        case 'NestMembers':
        case 'PermittedSubclasses':
        case 'ModulePackages':
          for (const i of v.indices) add(i, at, a.name)
          break
        case 'InnerClasses':
          for (const c of v.classes) {
            add(c.inner, at, a.name)
            add(c.outer, at, a.name)
            add(c.nameIndex, at, a.name)
          }
          break
        case 'EnclosingMethod':
          add(v.classIndex, at, a.name)
          add(v.methodIndex, at, a.name)
          break
        case 'BootstrapMethods':
          v.methods.forEach((m, k) => {
            add(m.ref, at, `${a.name}[${k}]`)
            for (const arg of m.args) add(arg, at, `${a.name}[${k}]`, { part: 'argument' })
          })
          break
        case 'Annotations':
          for (const ann of v.annotations) add(ann.typeIndex, at, a.name)
          break
        case 'Code': {
          const inCode = within(at, a.name)
          attributes(v.code.attributes, inCode)
          for (const e of v.code.exceptions) add(e.catchType, inCode, { part: 'exceptionTable' })
          break
        }
        case 'LocalVariableTable':
        case 'LocalVariableTypeTable':
          for (const x of v.variables) {
            add(x.nameIndex, at, a.name)
            add(x.descriptorIndex, at, a.name)
          }
          break
        case 'MethodParameters':
          for (const p of v.parameters) add(p.nameIndex, at, a.name)
          break
        case 'Record':
          for (const c of v.components) {
            const component: UseSite = { owner: 'component', name: pool.text(c.nameIndex), path: [] }
            add(c.nameIndex, component, { part: 'name' })
            add(c.descriptorIndex, component, { part: 'descriptor' })
            attributes(c.attributes, component)
          }
          break
      }
    }
  }

  for (const f of cls.fields) {
    const at: UseSite = { owner: 'field', name: f.name, path: [] }
    add(f.nameIndex, at, { part: 'name' })
    add(f.descriptorIndex, at, { part: 'descriptor' })
    attributes(f.attributes, at)
  }
  cls.methods.forEach((m, k) => {
    const at: UseSite = { owner: 'method', name: m.name, path: [] }
    add(m.nameIndex, at, { part: 'name' })
    add(m.descriptorIndex, at, { part: 'descriptor' })
    attributes(m.attributes, at)
    const code = m.attributes.find((a) => a.value.kind === 'Code')
    if (code?.value.kind === 'Code') {
      if (!listed(k)) {
        usage.codeCut = true
      } else {
        for (const ins of disassemble(code.value.code.code)) {
          for (const op of ins.operands) if (op.kind === 'cp' && valid(op.index)) usage[op.index].code.push({ method: k, offset: ins.offset })
        }
      }
    }
  })
  attributes(cls.attributes, theClass)
  return usage
}
