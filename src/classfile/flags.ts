// Access flags (JVMS 4.1, 4.5, 4.6, 4.7.6, 4.7.24, 4.7.25) as javap names them and as Java
// writes them.

export type FlagContext = 'class' | 'field' | 'method' | 'inner' | 'parameter' | 'module' | 'requires' | 'exports'

const TABLES: Record<FlagContext, [number, string][]> = {
  class: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0020, 'ACC_SUPER'],
    [0x0200, 'ACC_INTERFACE'],
    [0x0400, 'ACC_ABSTRACT'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x2000, 'ACC_ANNOTATION'],
    [0x4000, 'ACC_ENUM'],
    [0x8000, 'ACC_MODULE']
  ],
  field: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0002, 'ACC_PRIVATE'],
    [0x0004, 'ACC_PROTECTED'],
    [0x0008, 'ACC_STATIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0040, 'ACC_VOLATILE'],
    [0x0080, 'ACC_TRANSIENT'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x4000, 'ACC_ENUM']
  ],
  method: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0002, 'ACC_PRIVATE'],
    [0x0004, 'ACC_PROTECTED'],
    [0x0008, 'ACC_STATIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0020, 'ACC_SYNCHRONIZED'],
    [0x0040, 'ACC_BRIDGE'],
    [0x0080, 'ACC_VARARGS'],
    [0x0100, 'ACC_NATIVE'],
    [0x0400, 'ACC_ABSTRACT'],
    [0x0800, 'ACC_STRICT'],
    [0x1000, 'ACC_SYNTHETIC']
  ],
  inner: [
    [0x0001, 'ACC_PUBLIC'],
    [0x0002, 'ACC_PRIVATE'],
    [0x0004, 'ACC_PROTECTED'],
    [0x0008, 'ACC_STATIC'],
    [0x0010, 'ACC_FINAL'],
    [0x0200, 'ACC_INTERFACE'],
    [0x0400, 'ACC_ABSTRACT'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x2000, 'ACC_ANNOTATION'],
    [0x4000, 'ACC_ENUM']
  ],
  parameter: [
    [0x0010, 'ACC_FINAL'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x8000, 'ACC_MANDATED']
  ],
  module: [
    [0x0020, 'ACC_OPEN'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x8000, 'ACC_MANDATED']
  ],
  requires: [
    [0x0020, 'ACC_TRANSITIVE'],
    [0x0040, 'ACC_STATIC_PHASE'],
    [0x1000, 'ACC_SYNTHETIC'],
    [0x8000, 'ACC_MANDATED']
  ],
  exports: [
    [0x1000, 'ACC_SYNTHETIC'],
    [0x8000, 'ACC_MANDATED']
  ]
}

/** javap's flag names, plus `0x…` for bits the context does not define. */
export function flagNames(access: number, context: FlagContext): string[] {
  const names: string[] = []
  let known = 0
  for (const [bit, name] of TABLES[context]) {
    known |= bit
    if (access & bit) names.push(name)
  }
  const rest = access & ~known & 0xffff
  if (rest) names.push(`0x${rest.toString(16).padStart(4, '0')}`)
  return names
}

/** `(0x0021) ACC_PUBLIC, ACC_SUPER` */
export function flagSummary(access: number, context: FlagContext): string {
  const names = flagNames(access, context)
  return `(0x${access.toString(16).padStart(4, '0')})${names.length ? ` ${names.join(', ')}` : ''}`
}

export const ACC = {
  PUBLIC: 0x0001,
  PRIVATE: 0x0002,
  PROTECTED: 0x0004,
  STATIC: 0x0008,
  FINAL: 0x0010,
  SUPER: 0x0020,
  SYNCHRONIZED: 0x0020,
  VOLATILE: 0x0040,
  BRIDGE: 0x0040,
  TRANSIENT: 0x0080,
  VARARGS: 0x0080,
  NATIVE: 0x0100,
  INTERFACE: 0x0200,
  ABSTRACT: 0x0400,
  STRICT: 0x0800,
  SYNTHETIC: 0x1000,
  ANNOTATION: 0x2000,
  ENUM: 0x4000,
  MODULE: 0x8000,
  MANDATED: 0x8000
} as const

/** Java source modifiers in the usual order. */
export function javaModifiers(access: number, context: 'class' | 'field' | 'method' | 'inner'): string[] {
  const out: string[] = []
  if (access & ACC.PUBLIC) out.push('public')
  if (context !== 'class') {
    if (access & ACC.PROTECTED) out.push('protected')
    if (access & ACC.PRIVATE) out.push('private')
  }
  const iface = context !== 'field' && context !== 'method' && access & ACC.INTERFACE
  if (access & ACC.ABSTRACT && !iface) out.push('abstract')
  if (context !== 'class' && access & ACC.STATIC) out.push('static')
  if (access & ACC.FINAL && !(access & ACC.ENUM && context !== 'field')) out.push('final')
  if (context === 'field') {
    if (access & ACC.TRANSIENT) out.push('transient')
    if (access & ACC.VOLATILE) out.push('volatile')
  }
  if (context === 'method') {
    if (access & ACC.SYNCHRONIZED) out.push('synchronized')
    if (access & ACC.NATIVE) out.push('native')
    if (access & ACC.STRICT) out.push('strictfp')
  }
  return out
}
