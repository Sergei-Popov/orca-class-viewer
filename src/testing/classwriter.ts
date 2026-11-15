// A tiny class file writer for tests: no .class files live in git, so every test builds the
// bytes it reads. It writes exactly what a case asks for, including broken and odd files.

import { encodeModifiedUtf8 } from '../classfile/bytes'
import { OP } from '../bytecode/opcodes'

export class Bytes {
  readonly out: number[] = []
  u1(v: number): this {
    this.out.push(v & 0xff)
    return this
  }
  u2(v: number): this {
    return this.u1(v >>> 8).u1(v)
  }
  u4(v: number): this {
    return this.u2(v >>> 16).u2(v & 0xffff)
  }
  raw(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.out.push(b[i] & 0xff)
    return this
  }
  get length(): number {
    return this.out.length
  }
  done(): Uint8Array {
    return Uint8Array.from(this.out)
  }
}

export const u2 = (v: number): number[] => [(v >>> 8) & 0xff, v & 0xff]
export const s4 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]

/** Builds a constant pool, reusing equal entries like javac does. */
export class PoolWriter {
  private readonly keys = new Map<string, number>()
  private readonly bytes = new Bytes()
  next = 1

  private add(key: string, write: (b: Bytes) => void, slots = 1): number {
    const known = this.keys.get(key)
    if (known !== undefined) return known
    const index = this.next
    write(this.bytes)
    this.next += slots
    this.keys.set(key, index)
    return index
  }

  utf8(text: string): number {
    const data = encodeModifiedUtf8(text)
    return this.add(`u:${text}`, (b) => b.u1(1).u2(data.length).raw(data))
  }
  /** A Utf8 entry with arbitrary (possibly invalid) bytes. */
  rawUtf8(data: number[]): number {
    return this.add(`r:${data.join(',')}`, (b) => b.u1(1).u2(data.length).raw(data))
  }
  int(v: number): number {
    return this.add(`i:${v}`, (b) => b.u1(3).u4(v >>> 0))
  }
  float(v: number): number {
    const d = new DataView(new ArrayBuffer(4))
    d.setFloat32(0, v)
    return this.add(`f:${d.getUint32(0)}`, (b) => b.u1(4).u4(d.getUint32(0)))
  }
  long(v: bigint): number {
    const d = new DataView(new ArrayBuffer(8))
    d.setBigInt64(0, v)
    return this.add(`l:${v}`, (b) => b.u1(5).u4(d.getUint32(0)).u4(d.getUint32(4)), 2)
  }
  double(v: number): number {
    const d = new DataView(new ArrayBuffer(8))
    d.setFloat64(0, v)
    return this.add(`d:${v}`, (b) => b.u1(6).u4(d.getUint32(0)).u4(d.getUint32(4)), 2)
  }
  cls(name: string): number {
    const n = this.utf8(name)
    return this.add(`c:${name}`, (b) => b.u1(7).u2(n))
  }
  string(text: string): number {
    const n = this.utf8(text)
    return this.add(`s:${text}`, (b) => b.u1(8).u2(n))
  }
  nat(name: string, descriptor: string): number {
    const n = this.utf8(name)
    const d = this.utf8(descriptor)
    return this.add(`nt:${name}:${descriptor}`, (b) => b.u1(12).u2(n).u2(d))
  }
  private ref(tag: number, owner: string, name: string, descriptor: string): number {
    const c = this.cls(owner)
    const nt = this.nat(name, descriptor)
    return this.add(`${tag}:${owner}.${name}:${descriptor}`, (b) => b.u1(tag).u2(c).u2(nt))
  }
  field(owner: string, name: string, descriptor: string): number {
    return this.ref(9, owner, name, descriptor)
  }
  method(owner: string, name: string, descriptor: string): number {
    return this.ref(10, owner, name, descriptor)
  }
  interfaceMethod(owner: string, name: string, descriptor: string): number {
    return this.ref(11, owner, name, descriptor)
  }
  methodHandle(kind: number, ref: number): number {
    return this.add(`mh:${kind}:${ref}`, (b) => b.u1(15).u1(kind).u2(ref))
  }
  methodType(descriptor: string): number {
    const d = this.utf8(descriptor)
    return this.add(`mt:${descriptor}`, (b) => b.u1(16).u2(d))
  }
  dynamic(tag: 17 | 18, bootstrap: number, name: string, descriptor: string): number {
    const nt = this.nat(name, descriptor)
    return this.add(`${tag}:${bootstrap}:${name}:${descriptor}`, (b) => b.u1(tag).u2(bootstrap).u2(nt))
  }
  module(name: string): number {
    const n = this.utf8(name)
    return this.add(`m:${name}`, (b) => b.u1(19).u2(n))
  }
  package(name: string): number {
    const n = this.utf8(name)
    return this.add(`p:${name}`, (b) => b.u1(20).u2(n))
  }
  /** Raw entry bytes, for broken pools. */
  rawEntry(bytes: number[], slots = 1): number {
    const index = this.next
    this.bytes.raw(bytes)
    this.next += slots
    return index
  }
  write(b: Bytes): void {
    b.u2(this.next).raw(this.bytes.out)
  }
}

export type Attr = { name: string; body: number[] | Uint8Array }

export type MemberSpec = { access: number; name: string; descriptor: string; attributes?: Attr[] }

export type CodeSpec = {
  maxStack?: number
  maxLocals?: number
  code: number[]
  exceptions?: { start: number; end: number; handler: number; catchType: number }[]
  attributes?: Attr[]
}

export class ClassWriter {
  readonly pool = new PoolWriter()
  major: number
  minor: number
  access: number
  name: string
  superName: string | null
  interfaces: string[]
  fields: MemberSpec[] = []
  methods: MemberSpec[] = []
  attributes: Attr[] = []

  constructor(options: {
    name: string
    superName?: string | null
    interfaces?: string[]
    access?: number
    major?: number
    minor?: number
  }) {
    this.name = options.name
    this.superName = options.superName === undefined ? 'java/lang/Object' : options.superName
    this.interfaces = options.interfaces ?? []
    this.access = options.access ?? 0x0021
    this.major = options.major ?? 61
    this.minor = options.minor ?? 0
  }

  field(spec: MemberSpec): this {
    this.fields.push(spec)
    return this
  }

  method(spec: MemberSpec): this {
    this.methods.push(spec)
    return this
  }

  attribute(attr: Attr): this {
    this.attributes.push(attr)
    return this
  }

  /** A Code attribute body. */
  code(spec: CodeSpec): Attr {
    const b = new Bytes().u2(spec.maxStack ?? 4).u2(spec.maxLocals ?? 4).u4(spec.code.length).raw(spec.code)
    const exceptions = spec.exceptions ?? []
    b.u2(exceptions.length)
    for (const e of exceptions) b.u2(e.start).u2(e.end).u2(e.handler).u2(e.catchType)
    this.writeAttributes(b, spec.attributes ?? [])
    return { name: 'Code', body: b.out }
  }

  /** Attribute with a single u2 constant pool index (Signature, SourceFile, ConstantValue…). */
  indexAttr(name: string, index: number): Attr {
    return { name, body: u2(index) }
  }

  utf8Attr(name: 'Signature' | 'SourceFile', text: string): Attr {
    return this.indexAttr(name, this.pool.utf8(text))
  }

  classListAttr(name: string, classes: string[]): Attr {
    return { name, body: [...u2(classes.length), ...classes.flatMap((c) => u2(this.pool.cls(c)))] }
  }

  writeAttributes(b: Bytes, attributes: Attr[]): void {
    b.u2(attributes.length)
    for (const a of attributes) {
      b.u2(this.pool.utf8(a.name)).u4(a.body.length).raw(a.body)
    }
  }

  toBytes(): Uint8Array {
    // Members and attributes are written first so every name lands in the pool.
    const body = new Bytes()
    body.u2(this.access).u2(this.pool.cls(this.name)).u2(this.superName ? this.pool.cls(this.superName) : 0)
    body.u2(this.interfaces.length)
    for (const i of this.interfaces) body.u2(this.pool.cls(i))
    for (const list of [this.fields, this.methods]) {
      body.u2(list.length)
      for (const m of list) {
        body.u2(m.access).u2(this.pool.utf8(m.name)).u2(this.pool.utf8(m.descriptor))
        this.writeAttributes(body, m.attributes ?? [])
      }
    }
    this.writeAttributes(body, this.attributes)
    const out = new Bytes().u4(0xcafebabe).u2(this.minor).u2(this.major)
    this.pool.write(out)
    out.raw(body.out)
    return out.done()
  }
}

/** Bytecode from mnemonics and operand bytes: `asm('aload_0', 'invokespecial', ...u2(i))`. */
export function asm(...parts: (string | number)[]): number[] {
  return parts.map((p) => {
    if (typeof p === 'number') return p & 0xff
    const code = OP[p]
    if (code === undefined) throw new Error(`unknown mnemonic ${p}`)
    return code
  })
}

/** A plain class with a default constructor, like `javac` writes for `class Hello {}`. */
export function helloClass(name = 'demo/Hello'): ClassWriter {
  const w = new ClassWriter({ name })
  const init = w.pool.method('java/lang/Object', '<init>', '()V')
  w.method({
    access: 0x0001,
    name: '<init>',
    descriptor: '()V',
    attributes: [w.code({ maxStack: 1, maxLocals: 1, code: asm('aload_0', 'invokespecial', ...u2(init), 'return') })]
  })
  return w
}
