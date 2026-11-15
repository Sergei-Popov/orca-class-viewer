// Field and method descriptors (JVMS 4.3) and generic signatures (JVMS 4.7.9.1), parsed into
// types and printed as Java: `(ILjava/lang/String;)[J` → `long[] (int, String)`.

import { displayName } from './names'

export type BaseName = 'byte' | 'char' | 'double' | 'float' | 'int' | 'long' | 'short' | 'boolean' | 'void'

export type TypeArg = { wildcard: '*' } | { wildcard: '+' | '-' | ''; type: JType }

export type ClassPart = { name: string; args: TypeArg[] }

export type JType =
  | { kind: 'base'; name: BaseName }
  | { kind: 'class'; parts: ClassPart[] }
  | { kind: 'var'; name: string }
  | { kind: 'array'; of: JType }

export type TypeParam = { name: string; classBound?: JType; interfaceBounds: JType[] }

export type MethodType = { typeParams: TypeParam[]; params: JType[]; ret: JType; throws: JType[] }

export type ClassSignature = { typeParams: TypeParam[]; superclass: JType; interfaces: JType[] }

const BASE: Record<string, BaseName> = {
  B: 'byte',
  C: 'char',
  D: 'double',
  F: 'float',
  I: 'int',
  J: 'long',
  S: 'short',
  Z: 'boolean',
  V: 'void'
}

export class SignatureError extends Error {
  constructor(text: string, at: number) {
    super(`bad descriptor or signature at ${at}: ${text}`)
    this.name = 'SignatureError'
  }
}

/** Type arguments nest at most this deep; javac and kotlinc never come close, and the printers
 *  recurse once per level. */
export const MAX_TYPE_NESTING = 64

class Parser {
  readonly s: string
  i = 0
  private depth = 0
  constructor(s: string) {
    this.s = s
  }
  peek(): string {
    return this.s[this.i] ?? ''
  }
  eat(ch: string): void {
    if (this.s[this.i] !== ch) throw new SignatureError(this.s, this.i)
    this.i++
  }
  done(): void {
    if (this.i !== this.s.length) throw new SignatureError(this.s, this.i)
  }
  /** An identifier up to one of `stops`. */
  ident(stops: string): string {
    const start = this.i
    while (this.i < this.s.length && !stops.includes(this.s[this.i])) this.i++
    if (this.i === start) throw new SignatureError(this.s, this.i)
    return this.s.slice(start, this.i)
  }

  type(allowVoid = false): JType {
    const ch = this.peek()
    if (BASE[ch] && (ch !== 'V' || allowVoid)) {
      this.i++
      return { kind: 'base', name: BASE[ch] }
    }
    if (ch === '[') {
      this.i++
      // JVMS caps arrays at 255 dimensions; a deeper nest is not a descriptor.
      let depth = 1
      while (this.peek() === '[') {
        this.i++
        if (++depth > 255) throw new SignatureError(this.s, this.i)
      }
      let t = this.type()
      for (let d = 0; d < depth; d++) t = { kind: 'array', of: t }
      return t
    }
    if (ch === 'T') {
      this.i++
      const name = this.ident(';')
      this.eat(';')
      return { kind: 'var', name }
    }
    if (ch === 'L') {
      this.i++
      const parts: ClassPart[] = []
      let name = this.ident(';<.')
      for (;;) {
        const args = this.peek() === '<' ? this.typeArgs() : []
        parts.push({ name, args })
        if (this.peek() === '.') {
          this.i++
          name = this.ident(';<.')
          continue
        }
        this.eat(';')
        return { kind: 'class', parts }
      }
    }
    throw new SignatureError(this.s, this.i)
  }

  typeArgs(): TypeArg[] {
    this.eat('<')
    if (++this.depth > MAX_TYPE_NESTING) throw new SignatureError(this.s, this.i)
    const args: TypeArg[] = []
    while (this.peek() !== '>') {
      const ch = this.peek()
      if (ch === '*') {
        this.i++
        args.push({ wildcard: '*' })
      } else if (ch === '+' || ch === '-') {
        this.i++
        args.push({ wildcard: ch, type: this.type() })
      } else {
        args.push({ wildcard: '', type: this.type() })
      }
      if (this.i >= this.s.length) throw new SignatureError(this.s, this.i)
    }
    this.eat('>')
    this.depth--
    return args
  }

  typeParams(): TypeParam[] {
    if (this.peek() !== '<') return []
    this.i++
    const params: TypeParam[] = []
    while (this.peek() !== '>') {
      const name = this.ident(':')
      this.eat(':')
      const ch = this.peek()
      const classBound = ch === ':' || ch === '>' ? undefined : this.type()
      const interfaceBounds: JType[] = []
      while (this.peek() === ':') {
        this.i++
        interfaceBounds.push(this.type())
      }
      params.push({ name, classBound, interfaceBounds })
      if (this.i >= this.s.length) throw new SignatureError(this.s, this.i)
    }
    this.eat('>')
    return params
  }
}

export function parseFieldType(descriptor: string): JType {
  const p = new Parser(descriptor)
  const t = p.type()
  p.done()
  return t
}

/** A method descriptor or a method Signature attribute. */
export function parseMethodType(text: string): MethodType {
  const p = new Parser(text)
  const typeParams = p.typeParams()
  p.eat('(')
  const params: JType[] = []
  while (p.peek() !== ')') {
    if (p.i >= text.length) throw new SignatureError(text, p.i)
    params.push(p.type())
  }
  p.eat(')')
  const ret = p.type(true)
  const throws: JType[] = []
  while (p.peek() === '^') {
    p.i++
    throws.push(p.type())
  }
  p.done()
  return { typeParams, params, ret, throws }
}

export function parseClassSignature(text: string): ClassSignature {
  const p = new Parser(text)
  const typeParams = p.typeParams()
  const superclass = p.type()
  const interfaces: JType[] = []
  while (p.i < text.length) interfaces.push(p.type())
  return { typeParams, superclass, interfaces }
}

/** Number of local variable slots the parameters take (long and double take two). */
export function parameterSlots(params: JType[]): number {
  let slots = 0
  for (const t of params) slots += t.kind === 'base' && (t.name === 'long' || t.name === 'double') ? 2 : 1
  return slots
}

/** `java/util/Map$Entry` with nested classes known from InnerClasses. */
export type InnerInfo = Map<string, { outer: string; simple: string }>

// Link markers: a namer made with `links` wraps each class name it prints as
// START index MID text END, and the outline turns those into links. They are private-use
// characters, which every name and string from the file has escaped, so the file cannot fake one.
export const LINK_START = '\u{e000}'
export const LINK_MID = '\u{e001}'
export const LINK_END = '\u{e002}'
const LINK = /\u{e000}(\d+)\u{e001}([^\u{e000}-\u{e002}]*)\u{e002}/gu

/** Text with the link markers taken out, and where each link went. */
export function takeLinks(text: string, targets: readonly string[]): { text: string; links: { from: number; to: number; name: string }[] } {
  if (!text.includes(LINK_START)) return { text, links: [] }
  const links: { from: number; to: number; name: string }[] = []
  let out = ''
  let pos = 0
  for (const m of text.matchAll(LINK)) {
    out += text.slice(pos, m.index)
    const name = targets[Number(m[1])]
    if (name !== undefined && m[2]) links.push({ from: out.length, to: out.length + m[2].length, name })
    out += m[2]
    pos = (m.index ?? 0) + m[0].length
  }
  return { text: out + text.slice(pos), links }
}

/** Prints class names: simple names by default, fully qualified when two would clash. */
export class Namer {
  private readonly qualified: boolean
  private readonly inner: InnerInfo
  private readonly bySimple = new Map<string, string>()
  /** Top-level classes printed by their simple name: what an import list needs. */
  readonly used = new Set<string>()
  /** With `links`, the classes the link markers point to, by index. */
  readonly linkTargets: string[] = []
  private readonly linkIndex: Map<string, number> | undefined

  private readonly inScope: (outer: string) => boolean

  constructor(options: { qualified?: boolean; inner?: InnerInfo; inScope?: (outer: string) => boolean; links?: boolean } = {}) {
    this.qualified = options.qualified ?? false
    this.inner = options.inner ?? new Map()
    this.inScope = options.inScope ?? (() => false)
    this.linkIndex = options.links ? new Map() : undefined
  }

  /** `text` marked as a link to `internal` when this namer makes links. */
  link(internal: string, text: string): string {
    if (!this.linkIndex || !text) return text
    let i = this.linkIndex.get(internal)
    if (i === undefined) {
      i = this.linkTargets.length
      this.linkTargets.push(internal)
      this.linkIndex.set(internal, i)
    }
    return `${LINK_START}${i}${LINK_MID}${text}${LINK_END}`
  }

  /** The Java name of an internal class name. */
  name(internal: string, depth = 0): string {
    const text = this.plainName(internal, depth)
    return depth === 0 ? this.link(internal, text) : text
  }

  private plainName(internal: string, depth: number): string {
    const nested = this.inner.get(internal)
    if (nested && depth < 16) {
      // Inside the outer class (or one nested in it) a member class goes by its simple name.
      if (!this.qualified && this.inScope(nested.outer)) return displayName(nested.simple)
      return `${this.name(nested.outer, depth + 1)}.${displayName(nested.simple)}`
    }
    if (this.qualified) return displayName(internal.replace(/\//g, '.'))
    const simple = internal.slice(internal.lastIndexOf('/') + 1)
    const owner = this.bySimple.get(simple)
    if (owner === undefined) this.bySimple.set(simple, internal)
    else if (owner !== internal) return displayName(internal.replace(/\//g, '.'))
    this.used.add(internal)
    return displayName(simple)
  }

  type(t: JType): string {
    switch (t.kind) {
      case 'base':
        return t.name
      case 'var':
        return displayName(t.name)
      case 'array':
        return `${this.type(t.of)}[]`
      case 'class': {
        let out = ''
        for (const [i, part] of t.parts.entries()) {
          out = i === 0 ? this.name(part.name) : `${out}.${displayName(part.name)}`
          if (part.args.length) out += `<${part.args.map((a) => this.arg(a)).join(', ')}>`
        }
        return out
      }
    }
  }

  arg(a: TypeArg): string {
    if (a.wildcard === '*') return '?'
    if (a.wildcard === '+') return `? extends ${this.type(a.type)}`
    if (a.wildcard === '-') return `? super ${this.type(a.type)}`
    return this.type(a.type)
  }

  typeParams(params: TypeParam[]): string {
    if (!params.length) return ''
    const one = (p: TypeParam) => {
      const bounds = [...(p.classBound ? [p.classBound] : []), ...p.interfaceBounds].filter(
        (b) => !(b.kind === 'class' && b.parts.length === 1 && b.parts[0].name === 'java/lang/Object' && !b.parts[0].args.length)
      )
      return bounds.length ? `${displayName(p.name)} extends ${bounds.map((b) => this.type(b)).join(' & ')}` : displayName(p.name)
    }
    return `<${params.map(one).join(', ')}>`
  }
}

/** The internal name of a class type (`java/util/Map$Entry` for `Map<K,V>.Entry<K,V>`). */
export function internalOf(t: JType): string | undefined {
  if (t.kind !== 'class') return undefined
  return t.parts.map((p) => p.name).join('$')
}
