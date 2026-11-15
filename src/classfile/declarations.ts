// Java declarations of a class, its fields and methods, from descriptors, generic signatures,
// flags, annotations and parameter names (MethodParameters or LocalVariableTable).

import { type Annotation, type ElementValue, findAttribute } from './attributes'
import { joinWithin, listWithin } from './budget'
import type { ClassFile, Member } from './classfile'
import { ACC, javaModifiers } from './flags'
import { displayName, javaChar, javaString } from './names'
import { type ConstantPool, javaDouble, javaFloat } from './pool'
import {
  type ClassSignature,
  type InnerInfo,
  type JType,
  type MethodType,
  Namer,
  internalOf,
  parseClassSignature,
  parseFieldType,
  parseMethodType
} from './types'

export type ClassKind = 'class' | 'interface' | 'enum' | 'record' | 'annotation' | 'module' | 'package'

const LONG_STRING = 200

/** Nested classes this class knows by name, from its InnerClasses attribute. */
export function innerInfo(cls: ClassFile): InnerInfo {
  const info: InnerInfo = new Map()
  const attr = findAttribute(cls.attributes, 'InnerClasses')
  for (const entry of attr?.value.classes ?? []) {
    if (!entry.outer || !entry.nameIndex) continue
    const simple = cls.pool.utf8(entry.nameIndex)
    if (simple === undefined) continue
    info.set(cls.pool.className(entry.inner), { outer: cls.pool.className(entry.outer), simple })
  }
  return info
}

/** The class's own InnerClasses entry: its flags and simple name when it is nested. */
export function ownInnerEntry(cls: ClassFile): { access: number; simple?: string; outer?: string } | undefined {
  const attr = findAttribute(cls.attributes, 'InnerClasses')
  for (const entry of attr?.value.classes ?? []) {
    if (entry.inner && cls.pool.className(entry.inner) === cls.name) {
      return {
        access: entry.access,
        simple: entry.nameIndex ? cls.pool.utf8(entry.nameIndex) : undefined,
        outer: entry.outer ? cls.pool.className(entry.outer) : undefined
      }
    }
  }
  return undefined
}

export function classKind(cls: ClassFile): ClassKind {
  if (cls.access & ACC.MODULE) return 'module'
  if (cls.access & ACC.ANNOTATION) return 'annotation'
  if (cls.access & ACC.INTERFACE) return cls.name.endsWith('package-info') ? 'package' : 'interface'
  if (cls.access & ACC.ENUM && cls.superName === 'java/lang/Enum') return 'enum'
  if (cls.superName === 'java/lang/Record' && findAttribute(cls.attributes, 'Record')) return 'record'
  return 'class'
}

/** The name a class has in source: `Observation` for `demo/Telescope$Observation`. */
export function sourceSimpleName(cls: ClassFile): string {
  const own = ownInnerEntry(cls)
  if (own?.simple) return own.simple
  return cls.name.slice(cls.name.lastIndexOf('/') + 1)
}

/** A namer for code inside `cls`: its own member classes, and those of the classes it is
 *  nested in, go by their simple names. With `links`, class names carry link markers. */
export function makeNamer(cls: ClassFile, qualified = false, links = false): Namer {
  const top = cls.name.includes('$') ? cls.name.slice(0, cls.name.indexOf('$', cls.name.lastIndexOf('/') + 1)) : cls.name
  return new Namer({
    qualified,
    links,
    inner: innerInfo(cls),
    inScope: (outer) => outer === cls.name || outer === top || (outer.startsWith(`${top}$`) && cls.name.startsWith(outer))
  })
}

const tryParse = <T>(parse: () => T): T | undefined => {
  try {
    return parse()
  } catch {
    return undefined
  }
}

function typeText(namer: Namer, descriptor: string): string {
  const t = tryParse(() => parseFieldType(descriptor))
  return t ? namer.type(t) : displayName(descriptor)
}

// Annotations -----------------------------------------------------------------------------

function constValue(pool: ConstantPool, v: Extract<ElementValue, { index: number }>): string {
  const e = pool.get(v.index)
  if (v.tag === 's') {
    const s = pool.utf8(v.index) ?? '?'
    return javaString(s.length > LONG_STRING ? `${s.slice(0, LONG_STRING)}…` : s)
  }
  if (!e) return `<bad #${v.index}>`
  switch (v.tag) {
    case 'Z':
      return e.tag === 3 ? (e.value !== 0 ? 'true' : 'false') : '?'
    case 'C':
      return e.tag === 3 ? javaChar(e.value & 0xffff) : '?'
    case 'J':
      return e.tag === 5 ? `${e.value}L` : '?'
    case 'F':
      return e.tag === 4 ? javaFloat(e.value) : '?'
    case 'D':
      return e.tag === 6 ? javaDouble(e.value) : '?'
    default:
      return e.tag === 3 ? String(e.value) : '?'
  }
}

/**
 * One annotation's text stops near this many characters, its arrays and elements ending in "…":
 * a few bytes of a class file make an array of 65,535 values, each a string of 200 characters.
 */
export const MAX_ANNOTATION_TEXT = 10_000

/** The characters an annotation's text may still take. */
type Room = { left: number }

const room = (): Room => ({ left: MAX_ANNOTATION_TEXT })

export function elementText(v: ElementValue, pool: ConstantPool, namer: Namer, depth = 0, left: Room = room()): string {
  let text: string
  switch (v.tag) {
    case 'e':
      text = `${typeText(namer, pool.str(v.typeIndex))}.${displayName(pool.str(v.nameIndex))}`
      break
    case 'c': {
      const d = pool.str(v.index)
      text = d === 'V' ? 'void.class' : `${typeText(namer, d)}.class`
      break
    }
    case '@':
      return annotationText(v.annotation, pool, namer, depth + 1, left)
    case '[': {
      let out = '{'
      for (let i = 0; i < v.values.length; i++) {
        if (i) {
          if (left.left <= 0) {
            out += ', …'
            break
          }
          out += ', '
          left.left -= 2
        }
        out += elementText(v.values[i], pool, namer, depth + 1, left)
      }
      return `${out}}`
    }
    default:
      text = constValue(pool, v)
  }
  left.left -= text.length
  return text
}

export function annotationText(a: Annotation, pool: ConstantPool, namer: Namer, depth = 0, left: Room = room()): string {
  const type = pool.str(a.typeIndex)
  const name = typeText(namer, type)
  left.left -= name.length + 1
  if (!a.elements.length) return `@${name}`
  if (depth > 8) return `@${name}(…)`
  if (a.elements.length === 1 && pool.str(a.elements[0].nameIndex) === 'value') {
    return `@${name}(${elementText(a.elements[0].value, pool, namer, depth, left)})`
  }
  const kotlin = type === 'Lkotlin/Metadata;'
  let out = ''
  for (let i = 0; i < a.elements.length; i++) {
    if (i) {
      if (left.left <= 0) {
        out += ', …'
        break
      }
      out += ', '
      left.left -= 2
    }
    const e = a.elements[i]
    const key = pool.str(e.nameIndex)
    // Kotlin's d1 is protobuf data in strings: unreadable, and often many kilobytes.
    if (kotlin && key === 'd1' && e.value.tag === '[') {
      const text = `d1 = {/* ${e.value.values.length} × protobuf */}`
      left.left -= text.length
      out += text
      continue
    }
    const shown = displayName(key)
    left.left -= shown.length + 3
    out += `${shown} = ${elementText(e.value, pool, namer, depth, left)}`
  }
  return `@${name}(${out})`
}

/** Annotations written one after another in a declaration, ending in "…" when they would make a huge line. */
export function inlineAnnotations(list: readonly Annotation[], pool: ConstantPool, namer: Namer): string {
  return joinWithin(list, (a) => annotationText(a, pool, namer), ' ')
}

/** Annotations from the visible and invisible attributes of a member or class. */
export function annotationsOf(attributes: Member['attributes']): Annotation[] {
  const out: Annotation[] = []
  // A loop, not flatMap: a crafted member has millions of annotations, too many for one spread.
  for (const a of attributes) if (a.value.kind === 'Annotations') for (const x of a.value.annotations) out.push(x)
  return out
}

// Fields ----------------------------------------------------------------------------------

export function fieldType(cls: ClassFile, field: Member, namer: Namer): string {
  const sig = findAttribute(field.attributes, 'Signature')
  const text = sig ? cls.pool.utf8(sig.value.index) : undefined
  const t = (text && tryParse(() => parseFieldType(text))) || tryParse(() => parseFieldType(field.descriptor))
  return t ? namer.type(t) : displayName(field.descriptor)
}

/** ` = 42` for a constant field, typed after the field's descriptor. */
export function fieldInitializer(cls: ClassFile, field: Member): string {
  const cv = findAttribute(field.attributes, 'ConstantValue')
  if (!cv) return ''
  const e = cls.pool.get(cv.value.index)
  if (!e) return ''
  if (e.tag === 3) {
    if (field.descriptor === 'Z') return ` = ${e.value !== 0}`
    if (field.descriptor === 'C') return ` = ${javaChar(e.value & 0xffff)}`
    return ` = ${e.value}`
  }
  return ` = ${cls.pool.literal(cv.value.index)}`
}

export function fieldDeclaration(cls: ClassFile, field: Member, namer: Namer, inInterface = false): string {
  let modifiers = javaModifiers(field.access, 'field')
  if (inInterface) modifiers = modifiers.filter((m) => m !== 'public' && m !== 'static' && m !== 'final')
  const head = [...modifiers, fieldType(cls, field, namer), displayName(field.name)].join(' ')
  return `${head}${fieldInitializer(cls, field)};`
}

// Methods ---------------------------------------------------------------------------------

export type MethodParts = {
  typeParams: string
  /** Empty for constructors and static initializers. */
  returns: string
  name: string
  params: string[]
  /** Parameter types alone, for short references such as `tracker(CelestialBody)`. */
  paramTypes: string[]
  throws: string[]
}

/** Parameter names from MethodParameters, else LocalVariableTable, else `arg0`, `arg1`… */
function parameterNames(cls: ClassFile, method: Member, descriptor: MethodType | undefined): (string | undefined)[] {
  const count = descriptor?.params.length ?? 0
  const names: (string | undefined)[] = new Array(count).fill(undefined)
  const mp = findAttribute(method.attributes, 'MethodParameters')
  if (mp) {
    mp.value.parameters.forEach((p, i) => {
      if (i < count && p.nameIndex) names[i] = cls.pool.utf8(p.nameIndex)
    })
    if (names.every((n) => n !== undefined)) return names
  }
  const code = findAttribute(method.attributes, 'Code')
  const lvt = code && findAttribute(code.value.code.attributes, 'LocalVariableTable')
  if (lvt && descriptor) {
    let slot = method.access & ACC.STATIC ? 0 : 1
    descriptor.params.forEach((t, i) => {
      if (names[i] === undefined) {
        const v = lvt.value.variables.find((x) => x.slot === slot && x.start === 0)
        if (v) names[i] = cls.pool.utf8(v.nameIndex)
      }
      slot += t.kind === 'base' && (t.name === 'long' || t.name === 'double') ? 2 : 1
    })
  }
  return names
}

const SYNTHETIC_PARAMETER = 0x1000 | 0x8000 // ACC_SYNTHETIC, ACC_MANDATED

const isWide = (t: JType) => t.kind === 'base' && (t.name === 'long' || t.name === 'double')

/** True when `descriptor` is the erasure `signature` compiles to (a type variable fits any
 *  reference type, since its bound is not at hand). */
function erasesTo(signature: JType, descriptor: JType): boolean {
  switch (signature.kind) {
    case 'base':
      return descriptor.kind === 'base' && descriptor.name === signature.name
    case 'var':
      return descriptor.kind === 'class' || descriptor.kind === 'array'
    case 'array':
      return descriptor.kind === 'array' && erasesTo(signature.of, descriptor.of)
    case 'class':
      return descriptor.kind === 'class' && internalOf(descriptor) === internalOf(signature)
  }
}

/**
 * Which descriptor parameter each Signature parameter is. A Signature leaves out synthetic
 * parameters: an inner class's outer instance and an enum's name and ordinal come first, the
 * variables a local class captures come last. MethodParameters flags say which ones they are;
 * else the LocalVariableTable, which names only declared parameters; else the run of descriptor
 * parameters the Signature's types erase to; else the last ones.
 */
function sourceParameters(cls: ClassFile, method: Member, descriptor: MethodType | undefined, shape: MethodType): number[] {
  const k = shape.params.length
  const n = descriptor?.params.length ?? k
  const run = (skip: number) => shape.params.map((_, i) => skip + i)
  if (!descriptor || shape === descriptor || n <= k) return run(0)
  const mp = findAttribute(method.attributes, 'MethodParameters')
  if (mp && mp.value.parameters.length === n) {
    const real = mp.value.parameters.flatMap((p, i) => (p.access & SYNTHETIC_PARAMETER ? [] : [i]))
    if (real.length === k) return real
  }
  const code = findAttribute(method.attributes, 'Code')
  const lvt = code && findAttribute(code.value.code.attributes, 'LocalVariableTable')
  if (lvt) {
    const real: number[] = []
    let slot = method.access & ACC.STATIC ? 0 : 1
    descriptor.params.forEach((t, i) => {
      const v = lvt.value.variables.find((x) => x.slot === slot && x.start === 0)
      const name = v && cls.pool.utf8(v.nameIndex)
      if (name && !/^(this|val)\$/.test(name)) real.push(i)
      slot += isWide(t) ? 2 : 1
    })
    if (real.length === k) return real
  }
  const own = ownInnerEntry(cls)
  const expected = classKind(cls) === 'enum' ? 2 : own && !(own.access & ACC.STATIC) ? 1 : 0
  const fits = (skip: number) => shape.params.every((t, i) => erasesTo(t, descriptor.params[skip + i]))
  const order = [expected, ...Array.from({ length: n - k + 1 }, (_, i) => i).filter((i) => i !== expected)]
  for (const skip of order) if (skip <= n - k && fits(skip)) return run(skip)
  return run(n - k)
}

/** The parts of a method's declaration; with `params` false, `params` stays empty, as a short label needs only the types. */
export function methodParts(cls: ClassFile, method: Member, namer: Namer, params = true): MethodParts {
  const pool = cls.pool
  const descriptor = tryParse(() => parseMethodType(method.descriptor))
  const sigAttr = findAttribute(method.attributes, 'Signature')
  const sigText = sigAttr ? pool.utf8(sigAttr.value.index) : undefined
  const signature = sigText ? tryParse(() => parseMethodType(sigText)) : undefined
  const shape = signature ?? descriptor
  const isInit = method.name === '<init>'
  const name = isInit ? displayName(sourceSimpleName(cls)) : displayName(method.name)
  if (!shape) {
    return { typeParams: '', returns: '', name: `${name} /* ${displayName(method.descriptor)} */`, params: [], paramTypes: [], throws: [] }
  }
  const names = parameterNames(cls, method, descriptor)
  const at = sourceParameters(cls, method, descriptor, shape)
  const declared = descriptor?.params.length ?? shape.params.length
  const paramAnnotations = method.attributes
    .filter((a) => a.value.kind === 'ParameterAnnotations')
    .map((a) => (a.value.kind === 'ParameterAnnotations' ? a.value.parameters : []))
  const mp = findAttribute(method.attributes, 'MethodParameters')
  const varargs = (method.access & ACC.VARARGS) !== 0
  const paramTypes = shape.params.map((t, i) =>
    varargs && i === shape.params.length - 1 && t.kind === 'array' ? `${namer.type(t.of)}...` : namer.type(t)
  )
  const written = (params ? shape.params : []).map((t, i) => {
    const type = paramTypes[i]
    const annotations: Annotation[] = []
    for (const list of paramAnnotations) {
      // javac counts the declared parameters; other compilers count every descriptor parameter.
      const k = list.length === shape.params.length ? i : list.length === declared ? at[i] : list.length - shape.params.length + i
      for (const a of list[k] ?? []) annotations.push(a)
    }
    const pname = names[at[i]]
    const isFinal = ((mp?.value.parameters[at[i]]?.access ?? 0) & ACC.FINAL) !== 0
    const before = annotations.length ? [inlineAnnotations(annotations, pool, namer)] : []
    return [...before, ...(isFinal ? ['final'] : []), type, pname !== undefined ? displayName(pname) : `arg${i}`].join(' ')
  })
  // An Exceptions attribute may name 65,535 classes.
  let throws = listWithin(shape.throws, (t) => namer.type(t))
  if (!throws.length) {
    const ex = findAttribute(method.attributes, 'Exceptions')
    throws = listWithin(ex?.value.indices ?? [], (i) => namer.name(pool.className(i)))
  }
  return {
    typeParams: namer.typeParams(shape.typeParams),
    returns: isInit || method.name === '<clinit>' ? '' : namer.type(shape.ret),
    name,
    params: written,
    paramTypes,
    throws
  }
}

/** Modifiers as Java source writes them, dropping what an interface implies. */
export function methodModifiers(cls: ClassFile, method: Member): string[] {
  let modifiers = javaModifiers(method.access, 'method')
  if (cls.access & ACC.INTERFACE) {
    modifiers = modifiers.filter((m) => m !== 'public' && m !== 'abstract')
    const isDefault =
      !(method.access & (ACC.STATIC | ACC.ABSTRACT | ACC.PRIVATE)) && !!findAttribute(method.attributes, 'Code')
    if (isDefault && method.name !== '<clinit>') modifiers.push('default')
  }
  if (classKind(cls) === 'enum' && method.name === '<init>') modifiers = modifiers.filter((m) => m !== 'private')
  return modifiers
}

/** `public static <T> List<T> copy(List<? extends T> source) throws IOException` */
export function methodDeclaration(cls: ClassFile, method: Member, namer: Namer): string {
  return methodDeclarationAt(cls, method, namer).text
}

/**
 * The declaration, and where the method's name is in it: `[from, to)` of `text`, which may hold
 * the namer's link marks before the name. A static initializer's name is `static`.
 */
export function methodDeclarationAt(cls: ClassFile, method: Member, namer: Namer): { text: string; name: [number, number] } {
  if (method.name === '<clinit>') return { text: 'static', name: [0, 6] }
  const parts = methodParts(cls, method, namer)
  const before = [...methodModifiers(cls, method), parts.typeParams, parts.returns].filter(Boolean).join(' ')
  const head = [before, `${parts.name}(${parts.params.join(', ')})`].filter(Boolean).join(' ')
  // The name as methodParts writes it; a descriptor that cannot be read follows it in a comment.
  const shown = method.name === '<init>' ? displayName(sourceSimpleName(cls)) : displayName(method.name)
  const from = before ? before.length + 1 : 0
  return { text: parts.throws.length ? `${head} throws ${parts.throws.join(', ')}` : head, name: [from, from + shown.length] }
}

/** `default "x"` for an annotation member with a default value. */
export function annotationDefault(cls: ClassFile, method: Member, namer: Namer): string {
  const d = findAttribute(method.attributes, 'AnnotationDefault')
  return d ? ` default ${elementText(d.value.value, cls.pool, namer)}` : ''
}

// Classes ---------------------------------------------------------------------------------

function classSignature(cls: ClassFile): ClassSignature | undefined {
  const sig = findAttribute(cls.attributes, 'Signature')
  const text = sig ? cls.pool.utf8(sig.value.index) : undefined
  return text ? tryParse(() => parseClassSignature(text)) : undefined
}

const classType = (name: string): JType => ({ kind: 'class', parts: [{ name, args: [] }] })

/** Record components as `Type name`, with their annotations. */
export function recordComponents(cls: ClassFile, namer: Namer): string[] {
  const rec = findAttribute(cls.attributes, 'Record')
  return listWithin(rec?.value.components ?? [], (c) => {
    const sig = findAttribute(c.attributes, 'Signature')
    const text = sig ? cls.pool.utf8(sig.value.index) : undefined
    const descriptor = cls.pool.str(c.descriptorIndex)
    const t = (text && tryParse(() => parseFieldType(text))) || tryParse(() => parseFieldType(descriptor))
    const annotations = annotationsOf(c.attributes)
    const before = annotations.length ? [inlineAnnotations(annotations, cls.pool, namer)] : []
    return [...before, t ? namer.type(t) : displayName(descriptor), displayName(cls.pool.str(c.nameIndex))].join(' ')
  })
}

/** `public final class Telescope<T> extends Base implements AutoCloseable` */
export function classDeclaration(cls: ClassFile, namer: Namer): string {
  const kind = classKind(cls)
  const own = ownInnerEntry(cls)
  const access = own ? own.access : cls.access
  let modifiers = javaModifiers(access, own ? 'inner' : 'class')
  if (kind === 'interface' || kind === 'annotation') modifiers = modifiers.filter((m) => m !== 'abstract')
  if (kind === 'enum' || kind === 'record' || kind === 'interface' || kind === 'annotation') {
    modifiers = modifiers.filter((m) => m !== 'static' && m !== 'abstract' && (kind !== 'record' || m !== 'final'))
  }
  // javac gives an enum with constant bodies a PermittedSubclasses attribute, but Java has no
  // sealed enums: its constant classes show as comments instead.
  const permitted = kind === 'enum' ? undefined : findAttribute(cls.attributes, 'PermittedSubclasses')
  if (permitted) modifiers.push('sealed')
  const sig = classSignature(cls)
  const superclass = sig?.superclass ?? (cls.superName ? classType(cls.superName) : undefined)
  const interfaces = sig?.interfaces ?? cls.interfaces.map(classType)
  const keyword = { class: 'class', interface: 'interface', enum: 'enum', record: 'record', annotation: '@interface', module: 'module', package: 'package' }[kind]
  let head = [...modifiers, keyword].join(' ')
  head += ` ${displayName(sourceSimpleName(cls))}${namer.typeParams(sig?.typeParams ?? [])}`
  if (kind === 'record') head += `(${recordComponents(cls, namer).join(', ')})`
  const supers = listWithin(
    interfaces.filter((t) => !(kind === 'annotation' && t.kind === 'class' && t.parts[0]?.name === 'java/lang/annotation/Annotation')),
    (t) => namer.type(t)
  )
  if (kind === 'class' && superclass && !(superclass.kind === 'class' && superclass.parts[0]?.name === 'java/lang/Object')) {
    head += ` extends ${namer.type(superclass)}`
  }
  if (supers.length) head += ` ${kind === 'interface' || kind === 'annotation' ? 'extends' : 'implements'} ${supers.join(', ')}`
  if (permitted?.value.indices.length) {
    head += ` permits ${joinWithin(permitted.value.indices, (i) => namer.name(cls.pool.className(i)))}`
  }
  return head
}
