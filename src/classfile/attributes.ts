// Attributes (JVMS 4.7): parsed by name into typed values. An attribute the parser does not know,
// or one that is damaged, keeps its raw bytes so the structure view can still list it.

import { ClassFormatError, type FormatErrorCode, Reader, decodeModifiedUtf8 } from './bytes'
import type { ConstantPool } from './pool'

export type ExceptionEntry = { start: number; end: number; handler: number; catchType: number }
export type LineNumber = { start: number; line: number }
export type LocalVariable = { start: number; length: number; nameIndex: number; descriptorIndex: number; slot: number }
export type InnerClassEntry = { inner: number; outer: number; nameIndex: number; access: number }
export type BootstrapMethod = { ref: number; args: number[] }
export type MethodParameter = { nameIndex: number; access: number }

export type ElementValue =
  | { tag: 'B' | 'C' | 'D' | 'F' | 'I' | 'J' | 'S' | 'Z' | 's'; index: number }
  | { tag: 'e'; typeIndex: number; nameIndex: number }
  | { tag: 'c'; index: number }
  | { tag: '@'; annotation: Annotation }
  | { tag: '['; values: ElementValue[] }

export type Annotation = { typeIndex: number; elements: { nameIndex: number; value: ElementValue }[] }

export type TypeAnnotation = {
  targetType: number
  /** A short description of where it applies: "field", "parameter 0", "local variable"… */
  target: string
  path: { kind: number; argument: number }[]
  annotation: Annotation
}

/** Verification types (JVMS 4.10.1.2): tag 7 carries a class index, tag 8 an offset. */
export type VerificationType = { tag: number; index?: number; offset?: number }

export type StackMapFrame = {
  offset: number
  frameType: number
  kind: 'same' | 'same_locals_1_stack_item' | 'chop' | 'append' | 'full'
  chop?: number
  locals?: VerificationType[]
  stack?: VerificationType[]
}

export type ModuleRequire = { index: number; access: number; versionIndex: number }
export type ModuleExport = { index: number; access: number; to: number[] }
export type ModuleProvide = { index: number; with: number[] }
export type ModuleInfo = {
  nameIndex: number
  access: number
  versionIndex: number
  requires: ModuleRequire[]
  exports: ModuleExport[]
  opens: ModuleExport[]
  uses: number[]
  provides: ModuleProvide[]
}

export type RecordComponent = { nameIndex: number; descriptorIndex: number; attributes: AttributeInfo[] }

export type CodeAttribute = {
  maxStack: number
  maxLocals: number
  code: Uint8Array
  exceptions: ExceptionEntry[]
  attributes: AttributeInfo[]
}

export type AttributeValue =
  | { kind: 'Code'; code: CodeAttribute }
  | { kind: 'ConstantValue'; index: number }
  | { kind: 'Signature' | 'SourceFile'; index: number }
  | { kind: 'Exceptions' | 'NestMembers' | 'PermittedSubclasses' | 'ModulePackages'; indices: number[] }
  | { kind: 'NestHost' | 'ModuleMainClass'; index: number }
  | { kind: 'InnerClasses'; classes: InnerClassEntry[] }
  | { kind: 'EnclosingMethod'; classIndex: number; methodIndex: number }
  | { kind: 'LineNumberTable'; lines: LineNumber[] }
  | { kind: 'LocalVariableTable' | 'LocalVariableTypeTable'; variables: LocalVariable[] }
  | { kind: 'StackMapTable'; frames: StackMapFrame[] }
  | { kind: 'BootstrapMethods'; methods: BootstrapMethod[] }
  | { kind: 'Annotations'; visible: boolean; annotations: Annotation[] }
  | { kind: 'ParameterAnnotations'; visible: boolean; parameters: Annotation[][] }
  | { kind: 'TypeAnnotations'; visible: boolean; annotations: TypeAnnotation[] }
  | { kind: 'AnnotationDefault'; value: ElementValue }
  | { kind: 'MethodParameters'; parameters: MethodParameter[] }
  | { kind: 'Module'; module: ModuleInfo }
  | { kind: 'Record'; components: RecordComponent[] }
  | { kind: 'SourceDebugExtension'; text: string }
  | { kind: 'Marker' }
  | { kind: 'Raw' }

export type AttributeInfo = {
  name: string
  nameIndex: number
  /** Offset of the attribute's header in the file. */
  offset: number
  length: number
  bytes: Uint8Array
  value: AttributeValue
  /** Set when the attribute is damaged; `value` is then `Raw`. */
  error?: string
  /** What kind of damage, for a message in the UI language. */
  errorCode?: FormatErrorCode
}

const MAX_NESTING = 32

/** Reads `attributes_count` attributes. */
export function readAttributes(r: Reader, pool: ConstantPool, depth = 0): AttributeInfo[] {
  const count = r.u2()
  const out: AttributeInfo[] = []
  for (let i = 0; i < count; i++) {
    const offset = r.pos
    const nameIndex = r.u2()
    const length = r.u4()
    const body = r.sub(length, 'an attribute')
    const name = pool.utf8(nameIndex) ?? `<bad #${nameIndex}>`
    const info: AttributeInfo = { name, nameIndex, offset, length, bytes: body.bytes.subarray(body.pos, body.end), value: { kind: 'Raw' } }
    try {
      info.value = parseValue(name, body, pool, depth)
      if (body.remaining > 0 && info.value.kind !== 'Raw') {
        info.error = `${body.remaining} bytes left over`
        info.errorCode = 'malformed'
      }
    } catch (error) {
      if (!(error instanceof ClassFormatError)) throw error
      info.value = { kind: 'Raw' }
      info.error = error.message
      info.errorCode = error.code
    }
    out.push(info)
  }
  return out
}

function indices(r: Reader): number[] {
  const n = r.u2()
  r.need(n * 2, 'a table')
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r.u2())
  return out
}

function parseValue(name: string, r: Reader, pool: ConstantPool, depth: number): AttributeValue {
  switch (name) {
    case 'Code': {
      if (depth > 0) return { kind: 'Raw' }
      const maxStack = r.u2()
      const maxLocals = r.u2()
      const codeLength = r.u4()
      const code = r.take(codeLength, 'the bytecode')
      const n = r.u2()
      const exceptions: ExceptionEntry[] = []
      for (let i = 0; i < n; i++) {
        exceptions.push({ start: r.u2(), end: r.u2(), handler: r.u2(), catchType: r.u2() })
      }
      const attributes = readAttributes(r, pool, depth + 1)
      return { kind: 'Code', code: { maxStack, maxLocals, code, exceptions, attributes } }
    }
    case 'ConstantValue':
    case 'Signature':
    case 'SourceFile':
    case 'NestHost':
    case 'ModuleMainClass':
      return { kind: name, index: r.u2() }
    case 'Exceptions':
    case 'NestMembers':
    case 'PermittedSubclasses':
    case 'ModulePackages':
      return { kind: name, indices: indices(r) }
    case 'InnerClasses': {
      const n = r.u2()
      const classes: InnerClassEntry[] = []
      for (let i = 0; i < n; i++) classes.push({ inner: r.u2(), outer: r.u2(), nameIndex: r.u2(), access: r.u2() })
      return { kind: 'InnerClasses', classes }
    }
    case 'EnclosingMethod':
      return { kind: 'EnclosingMethod', classIndex: r.u2(), methodIndex: r.u2() }
    case 'LineNumberTable': {
      const n = r.u2()
      const lines: LineNumber[] = []
      for (let i = 0; i < n; i++) lines.push({ start: r.u2(), line: r.u2() })
      return { kind: 'LineNumberTable', lines }
    }
    case 'LocalVariableTable':
    case 'LocalVariableTypeTable': {
      const n = r.u2()
      const variables: LocalVariable[] = []
      for (let i = 0; i < n; i++) {
        variables.push({ start: r.u2(), length: r.u2(), nameIndex: r.u2(), descriptorIndex: r.u2(), slot: r.u2() })
      }
      return { kind: name, variables }
    }
    case 'StackMapTable':
      return { kind: 'StackMapTable', frames: readStackMap(r) }
    case 'BootstrapMethods': {
      const n = r.u2()
      const methods: BootstrapMethod[] = []
      for (let i = 0; i < n; i++) methods.push({ ref: r.u2(), args: indices(r) })
      return { kind: 'BootstrapMethods', methods }
    }
    case 'RuntimeVisibleAnnotations':
    case 'RuntimeInvisibleAnnotations': {
      const n = r.u2()
      const annotations: Annotation[] = []
      for (let i = 0; i < n; i++) annotations.push(readAnnotation(r, 0))
      return { kind: 'Annotations', visible: name === 'RuntimeVisibleAnnotations', annotations }
    }
    case 'RuntimeVisibleParameterAnnotations':
    case 'RuntimeInvisibleParameterAnnotations': {
      const n = r.u1()
      const parameters: Annotation[][] = []
      for (let p = 0; p < n; p++) {
        const k = r.u2()
        const list: Annotation[] = []
        for (let i = 0; i < k; i++) list.push(readAnnotation(r, 0))
        parameters.push(list)
      }
      return { kind: 'ParameterAnnotations', visible: name === 'RuntimeVisibleParameterAnnotations', parameters }
    }
    case 'RuntimeVisibleTypeAnnotations':
    case 'RuntimeInvisibleTypeAnnotations': {
      const n = r.u2()
      const annotations: TypeAnnotation[] = []
      for (let i = 0; i < n; i++) annotations.push(readTypeAnnotation(r))
      return { kind: 'TypeAnnotations', visible: name === 'RuntimeVisibleTypeAnnotations', annotations }
    }
    case 'AnnotationDefault':
      return { kind: 'AnnotationDefault', value: readElementValue(r, 0) }
    case 'MethodParameters': {
      const n = r.u1()
      const parameters: MethodParameter[] = []
      for (let i = 0; i < n; i++) parameters.push({ nameIndex: r.u2(), access: r.u2() })
      return { kind: 'MethodParameters', parameters }
    }
    case 'Module':
      return { kind: 'Module', module: readModule(r) }
    case 'Record': {
      if (depth > 0) return { kind: 'Raw' }
      const n = r.u2()
      const components: RecordComponent[] = []
      for (let i = 0; i < n; i++) {
        components.push({ nameIndex: r.u2(), descriptorIndex: r.u2(), attributes: readAttributes(r, pool, depth + 1) })
      }
      return { kind: 'Record', components }
    }
    case 'SourceDebugExtension':
      return { kind: 'SourceDebugExtension', text: decodeModifiedUtf8(r.take(r.remaining)).text }
    case 'Deprecated':
    case 'Synthetic':
      return { kind: 'Marker' }
    default:
      r.pos = r.end
      return { kind: 'Raw' }
  }
}

function readAnnotation(r: Reader, depth: number): Annotation {
  if (depth > MAX_NESTING) throw new ClassFormatError('malformed', r.pos, 'annotations nest too deep')
  const typeIndex = r.u2()
  const n = r.u2()
  const elements: Annotation['elements'] = []
  for (let i = 0; i < n; i++) elements.push({ nameIndex: r.u2(), value: readElementValue(r, depth + 1) })
  return { typeIndex, elements }
}

function readElementValue(r: Reader, depth: number): ElementValue {
  if (depth > MAX_NESTING) throw new ClassFormatError('malformed', r.pos, 'annotations nest too deep')
  const at = r.pos
  const tag = String.fromCharCode(r.u1())
  switch (tag) {
    case 'B':
    case 'C':
    case 'D':
    case 'F':
    case 'I':
    case 'J':
    case 'S':
    case 'Z':
    case 's':
      return { tag, index: r.u2() }
    case 'e':
      return { tag, typeIndex: r.u2(), nameIndex: r.u2() }
    case 'c':
      return { tag, index: r.u2() }
    case '@':
      return { tag, annotation: readAnnotation(r, depth + 1) }
    case '[': {
      const n = r.u2()
      const values: ElementValue[] = []
      for (let i = 0; i < n; i++) values.push(readElementValue(r, depth + 1))
      return { tag, values }
    }
    default:
      throw new ClassFormatError('malformed', at, `unknown annotation element tag ${JSON.stringify(tag)}`)
  }
}

function readTypeAnnotation(r: Reader): TypeAnnotation {
  const at = r.pos
  const targetType = r.u1()
  let target: string
  switch (targetType) {
    case 0x00:
    case 0x01:
      target = `type parameter ${r.u1()}`
      break
    case 0x10: {
      const index = r.u2()
      target = index === 0xffff ? 'superclass' : `interface ${index}`
      break
    }
    case 0x11:
    case 0x12:
      target = `bound ${r.u1()}.${r.u1()}`
      break
    case 0x13:
      target = 'field'
      break
    case 0x14:
      target = 'return type'
      break
    case 0x15:
      target = 'receiver'
      break
    case 0x16:
      target = `parameter ${r.u1()}`
      break
    case 0x17:
      target = `throws ${r.u2()}`
      break
    case 0x40:
    case 0x41: {
      const n = r.u2()
      r.take(n * 6, 'a type annotation')
      target = targetType === 0x40 ? 'local variable' : 'resource variable'
      break
    }
    case 0x42:
      target = `catch ${r.u2()}`
      break
    case 0x43:
    case 0x44:
    case 0x45:
    case 0x46:
      target = `${['instanceof', 'new', 'method reference ::new', 'method reference'][targetType - 0x43]} at ${r.u2()}`
      break
    case 0x47:
    case 0x48:
    case 0x49:
    case 0x4a:
    case 0x4b: {
      const offset = r.u2()
      const arg = r.u1()
      target = `type argument ${arg} at ${offset}`
      break
    }
    default:
      throw new ClassFormatError('malformed', at, `unknown type annotation target 0x${targetType.toString(16)}`)
  }
  const pathLength = r.u1()
  const path: TypeAnnotation['path'] = []
  for (let i = 0; i < pathLength; i++) path.push({ kind: r.u1(), argument: r.u1() })
  return { targetType, target, path, annotation: readAnnotation(r, 0) }
}

function readVerificationType(r: Reader): VerificationType {
  const at = r.pos
  const tag = r.u1()
  if (tag === 7) return { tag, index: r.u2() }
  if (tag === 8) return { tag, offset: r.u2() }
  if (tag > 8) throw new ClassFormatError('malformed', at, `unknown verification type ${tag}`)
  return { tag }
}

function readStackMap(r: Reader): StackMapFrame[] {
  const n = r.u2()
  const frames: StackMapFrame[] = []
  let offset = -1
  for (let i = 0; i < n; i++) {
    const at = r.pos
    const frameType = r.u1()
    let delta: number
    let frame: Omit<StackMapFrame, 'offset'>
    if (frameType < 64) {
      delta = frameType
      frame = { frameType, kind: 'same' }
    } else if (frameType < 128) {
      delta = frameType - 64
      frame = { frameType, kind: 'same_locals_1_stack_item', stack: [readVerificationType(r)] }
    } else if (frameType < 247) {
      throw new ClassFormatError('malformed', at, `reserved stack map frame type ${frameType}`)
    } else if (frameType === 247) {
      delta = r.u2()
      frame = { frameType, kind: 'same_locals_1_stack_item', stack: [readVerificationType(r)] }
    } else if (frameType < 251) {
      delta = r.u2()
      frame = { frameType, kind: 'chop', chop: 251 - frameType }
    } else if (frameType === 251) {
      delta = r.u2()
      frame = { frameType, kind: 'same' }
    } else if (frameType < 255) {
      delta = r.u2()
      const locals: VerificationType[] = []
      for (let k = 0; k < frameType - 251; k++) locals.push(readVerificationType(r))
      frame = { frameType, kind: 'append', locals }
    } else {
      delta = r.u2()
      const nl = r.u2()
      const locals: VerificationType[] = []
      for (let k = 0; k < nl; k++) locals.push(readVerificationType(r))
      const ns = r.u2()
      const stack: VerificationType[] = []
      for (let k = 0; k < ns; k++) stack.push(readVerificationType(r))
      frame = { frameType, kind: 'full', locals, stack }
    }
    offset += delta + 1
    frames.push({ offset, ...frame })
  }
  return frames
}

function readModule(r: Reader): ModuleInfo {
  const nameIndex = r.u2()
  const access = r.u2()
  const versionIndex = r.u2()
  const requires: ModuleRequire[] = []
  for (let i = 0, n = r.u2(); i < n; i++) requires.push({ index: r.u2(), access: r.u2(), versionIndex: r.u2() })
  const exportList = (): ModuleExport[] => {
    const out: ModuleExport[] = []
    for (let i = 0, n = r.u2(); i < n; i++) out.push({ index: r.u2(), access: r.u2(), to: indices(r) })
    return out
  }
  const exports = exportList()
  const opens = exportList()
  const uses = indices(r)
  const provides: ModuleProvide[] = []
  for (let i = 0, n = r.u2(); i < n; i++) provides.push({ index: r.u2(), with: indices(r) })
  return { nameIndex, access, versionIndex, requires, exports, opens, uses, provides }
}

/** The attribute value shape whose `kind` includes K. */
export type ValueOfKind<K> = AttributeValue extends infer V
  ? V extends { kind: infer VK }
    ? K extends VK
      ? V
      : never
    : never
  : never

/** The first attribute with this value kind. */
export function findAttribute<K extends AttributeValue['kind']>(
  attributes: AttributeInfo[] | undefined,
  kind: K,
  name?: string
): (AttributeInfo & { value: ValueOfKind<K> }) | undefined {
  return attributes?.find((a) => a.value.kind === kind && (name === undefined || a.name === name)) as
    | (AttributeInfo & { value: ValueOfKind<K> })
    | undefined
}

export { Reader }
