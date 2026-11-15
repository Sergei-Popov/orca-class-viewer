// The class file (JVMS 4.1) read into a model. A damaged or cut-off file still yields what came
// before the damage, with `error` set, so the structure and bytecode views can show it; only a
// file that is not a class file at all throws.

import { type AttributeInfo, findAttribute, readAttributes } from './attributes'
import { ClassFormatError, Reader, hex } from './bytes'
import { ConstantPool, readConstantPool } from './pool'

export const MAGIC = 0xcafebabe

export type Member = {
  /** Offset of the member in the file. */
  offset: number
  access: number
  nameIndex: number
  descriptorIndex: number
  name: string
  descriptor: string
  attributes: AttributeInfo[]
}

export type ClassFile = {
  size: number
  minor: number
  major: number
  pool: ConstantPool
  access: number
  thisIndex: number
  superIndex: number
  interfaceIndices: number[]
  /** Internal name, `java/lang/String`; empty when the file ends before it. */
  name: string
  superName?: string
  interfaces: string[]
  fields: Member[]
  methods: Member[]
  attributes: AttributeInfo[]
  /** Where and why reading stopped early. */
  error?: ClassFormatError
  /** Bytes after the end of the class. */
  trailing: number
}

/** Throws `ClassFormatError` with code `empty` or `magic` when `bytes` is not a class file. */
export function parseClass(bytes: Uint8Array): ClassFile {
  if (bytes.length === 0) throw new ClassFormatError('empty', 0, 'the file is empty')
  if (bytes.length < 4 || readU32(bytes, 0) !== MAGIC) {
    const head = Array.from(bytes.subarray(0, 4), (b) => hex(b)).join(' ')
    throw new ClassFormatError('magic', 0, `the file starts with ${head}, not ca fe ba be`)
  }
  const r = new Reader(bytes, 4)
  const cls: ClassFile = {
    size: bytes.length,
    minor: 0,
    major: 0,
    pool: new ConstantPool([], 0),
    access: 0,
    thisIndex: 0,
    superIndex: 0,
    interfaceIndices: [],
    name: '',
    interfaces: [],
    fields: [],
    methods: [],
    attributes: [],
    trailing: 0
  }
  try {
    cls.minor = r.u2()
    cls.major = r.u2()
    try {
      cls.pool = readConstantPool(r)
    } catch (error) {
      const partial = (error as { pool?: ConstantPool }).pool
      if (partial) cls.pool = partial
      throw error
    }
    cls.access = r.u2()
    cls.thisIndex = r.u2()
    cls.name = cls.pool.className(cls.thisIndex)
    cls.superIndex = r.u2()
    if (cls.superIndex) cls.superName = cls.pool.className(cls.superIndex)
    const count = r.u2()
    for (let i = 0; i < count; i++) {
      const index = r.u2()
      cls.interfaceIndices.push(index)
      cls.interfaces.push(cls.pool.className(index))
    }
    readMembers(r, cls.pool, cls.fields)
    readMembers(r, cls.pool, cls.methods)
    cls.attributes = readAttributes(r, cls.pool)
    cls.trailing = r.remaining
  } catch (error) {
    if (!(error instanceof ClassFormatError)) throw error
    cls.error = error
  }
  return cls
}

function readMembers(r: Reader, pool: ConstantPool, into: Member[]): void {
  const count = r.u2()
  for (let i = 0; i < count; i++) {
    const offset = r.pos
    const access = r.u2()
    const nameIndex = r.u2()
    const descriptorIndex = r.u2()
    const member: Member = {
      offset,
      access,
      nameIndex,
      descriptorIndex,
      name: pool.str(nameIndex),
      descriptor: pool.str(descriptorIndex),
      attributes: []
    }
    into.push(member)
    member.attributes = readAttributes(r, pool)
  }
}

function readU32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
}

/** An attribute that could not be read, and whose it is. */
export type DamagedAttribute = {
  attribute: AttributeInfo
  owner: { kind: 'class' } | { kind: 'field' | 'method'; index: number }
}

/**
 * Attributes that could not be read, though the class around them could: a Code attribute
 * that ends inside its bytecode, say. The class itself keeps no `error` for them.
 */
export function damagedAttributes(cls: ClassFile): DamagedAttribute[] {
  const out: DamagedAttribute[] = []
  const scan = (attributes: AttributeInfo[], owner: DamagedAttribute['owner'], depth = 0) => {
    for (const a of attributes) {
      if (a.error) out.push({ attribute: a, owner })
      else if (depth < 2 && a.value.kind === 'Code') scan(a.value.code.attributes, owner, depth + 1)
      else if (depth < 2 && a.value.kind === 'Record') for (const c of a.value.components) scan(c.attributes, owner, depth + 1)
    }
  }
  cls.fields.forEach((f, index) => scan(f.attributes, { kind: 'field', index }))
  cls.methods.forEach((m, index) => scan(m.attributes, { kind: 'method', index }))
  scan(cls.attributes, { kind: 'class' })
  return out
}

/** The Signature attribute's text, when present. */
export function signatureOf(pool: ConstantPool, attributes: AttributeInfo[]): string | undefined {
  const a = findAttribute(attributes, 'Signature')
  return a ? pool.utf8(a.value.index) : undefined
}

/** Quick look at the header without parsing the rest: major and minor version. */
export function peekVersion(bytes: Uint8Array): { major: number; minor: number } | undefined {
  if (bytes.length < 8 || readU32(bytes, 0) !== MAGIC) return undefined
  return { minor: (bytes[4] << 8) | bytes[5], major: (bytes[6] << 8) | bytes[7] }
}
