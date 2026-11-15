// Every JVM opcode (JVMS 6.5) with the shape of its operands.

/**
 * Operand shapes:
 * - `''` none
 * - `b` signed byte (bipush), `s` signed short (sipush)
 * - `l` local variable index, u1 (u2 after `wide`)
 * - `c1` constant pool index u1 (ldc), `c2` constant pool index u2
 * - `j2` / `j4` signed branch offset
 * - `iinc` local u1 + signed byte (u2 + signed short after `wide`)
 * - `iface` invokeinterface: cp u2, count u1, zero u1
 * - `indy` invokedynamic: cp u2, two zero bytes
 * - `atype` newarray element type u1
 * - `multi` multianewarray: cp u2, dimensions u1
 * - `table` tableswitch, `lookup` lookupswitch, `wide` the wide prefix
 */
export type OperandShape =
  | ''
  | 'b'
  | 's'
  | 'l'
  | 'c1'
  | 'c2'
  | 'j2'
  | 'j4'
  | 'iinc'
  | 'iface'
  | 'indy'
  | 'atype'
  | 'multi'
  | 'table'
  | 'lookup'
  | 'wide'

type Row = [code: number, name: string, shape: OperandShape]

const ROWS: Row[] = [
  [0x00, 'nop', ''],
  [0x01, 'aconst_null', ''],
  [0x02, 'iconst_m1', ''],
  [0x03, 'iconst_0', ''],
  [0x04, 'iconst_1', ''],
  [0x05, 'iconst_2', ''],
  [0x06, 'iconst_3', ''],
  [0x07, 'iconst_4', ''],
  [0x08, 'iconst_5', ''],
  [0x09, 'lconst_0', ''],
  [0x0a, 'lconst_1', ''],
  [0x0b, 'fconst_0', ''],
  [0x0c, 'fconst_1', ''],
  [0x0d, 'fconst_2', ''],
  [0x0e, 'dconst_0', ''],
  [0x0f, 'dconst_1', ''],
  [0x10, 'bipush', 'b'],
  [0x11, 'sipush', 's'],
  [0x12, 'ldc', 'c1'],
  [0x13, 'ldc_w', 'c2'],
  [0x14, 'ldc2_w', 'c2'],
  [0x15, 'iload', 'l'],
  [0x16, 'lload', 'l'],
  [0x17, 'fload', 'l'],
  [0x18, 'dload', 'l'],
  [0x19, 'aload', 'l'],
  ...numbered(0x1a, ['iload', 'lload', 'fload', 'dload', 'aload']),
  [0x2e, 'iaload', ''],
  [0x2f, 'laload', ''],
  [0x30, 'faload', ''],
  [0x31, 'daload', ''],
  [0x32, 'aaload', ''],
  [0x33, 'baload', ''],
  [0x34, 'caload', ''],
  [0x35, 'saload', ''],
  [0x36, 'istore', 'l'],
  [0x37, 'lstore', 'l'],
  [0x38, 'fstore', 'l'],
  [0x39, 'dstore', 'l'],
  [0x3a, 'astore', 'l'],
  ...numbered(0x3b, ['istore', 'lstore', 'fstore', 'dstore', 'astore']),
  [0x4f, 'iastore', ''],
  [0x50, 'lastore', ''],
  [0x51, 'fastore', ''],
  [0x52, 'dastore', ''],
  [0x53, 'aastore', ''],
  [0x54, 'bastore', ''],
  [0x55, 'castore', ''],
  [0x56, 'sastore', ''],
  [0x57, 'pop', ''],
  [0x58, 'pop2', ''],
  [0x59, 'dup', ''],
  [0x5a, 'dup_x1', ''],
  [0x5b, 'dup_x2', ''],
  [0x5c, 'dup2', ''],
  [0x5d, 'dup2_x1', ''],
  [0x5e, 'dup2_x2', ''],
  [0x5f, 'swap', ''],
  ...typed(0x60, 'add'),
  ...typed(0x64, 'sub'),
  ...typed(0x68, 'mul'),
  ...typed(0x6c, 'div'),
  ...typed(0x70, 'rem'),
  ...typed(0x74, 'neg'),
  [0x78, 'ishl', ''],
  [0x79, 'lshl', ''],
  [0x7a, 'ishr', ''],
  [0x7b, 'lshr', ''],
  [0x7c, 'iushr', ''],
  [0x7d, 'lushr', ''],
  [0x7e, 'iand', ''],
  [0x7f, 'land', ''],
  [0x80, 'ior', ''],
  [0x81, 'lor', ''],
  [0x82, 'ixor', ''],
  [0x83, 'lxor', ''],
  [0x84, 'iinc', 'iinc'],
  [0x85, 'i2l', ''],
  [0x86, 'i2f', ''],
  [0x87, 'i2d', ''],
  [0x88, 'l2i', ''],
  [0x89, 'l2f', ''],
  [0x8a, 'l2d', ''],
  [0x8b, 'f2i', ''],
  [0x8c, 'f2l', ''],
  [0x8d, 'f2d', ''],
  [0x8e, 'd2i', ''],
  [0x8f, 'd2l', ''],
  [0x90, 'd2f', ''],
  [0x91, 'i2b', ''],
  [0x92, 'i2c', ''],
  [0x93, 'i2s', ''],
  [0x94, 'lcmp', ''],
  [0x95, 'fcmpl', ''],
  [0x96, 'fcmpg', ''],
  [0x97, 'dcmpl', ''],
  [0x98, 'dcmpg', ''],
  [0x99, 'ifeq', 'j2'],
  [0x9a, 'ifne', 'j2'],
  [0x9b, 'iflt', 'j2'],
  [0x9c, 'ifge', 'j2'],
  [0x9d, 'ifgt', 'j2'],
  [0x9e, 'ifle', 'j2'],
  [0x9f, 'if_icmpeq', 'j2'],
  [0xa0, 'if_icmpne', 'j2'],
  [0xa1, 'if_icmplt', 'j2'],
  [0xa2, 'if_icmpge', 'j2'],
  [0xa3, 'if_icmpgt', 'j2'],
  [0xa4, 'if_icmple', 'j2'],
  [0xa5, 'if_acmpeq', 'j2'],
  [0xa6, 'if_acmpne', 'j2'],
  [0xa7, 'goto', 'j2'],
  [0xa8, 'jsr', 'j2'],
  [0xa9, 'ret', 'l'],
  [0xaa, 'tableswitch', 'table'],
  [0xab, 'lookupswitch', 'lookup'],
  [0xac, 'ireturn', ''],
  [0xad, 'lreturn', ''],
  [0xae, 'freturn', ''],
  [0xaf, 'dreturn', ''],
  [0xb0, 'areturn', ''],
  [0xb1, 'return', ''],
  [0xb2, 'getstatic', 'c2'],
  [0xb3, 'putstatic', 'c2'],
  [0xb4, 'getfield', 'c2'],
  [0xb5, 'putfield', 'c2'],
  [0xb6, 'invokevirtual', 'c2'],
  [0xb7, 'invokespecial', 'c2'],
  [0xb8, 'invokestatic', 'c2'],
  [0xb9, 'invokeinterface', 'iface'],
  [0xba, 'invokedynamic', 'indy'],
  [0xbb, 'new', 'c2'],
  [0xbc, 'newarray', 'atype'],
  [0xbd, 'anewarray', 'c2'],
  [0xbe, 'arraylength', ''],
  [0xbf, 'athrow', ''],
  [0xc0, 'checkcast', 'c2'],
  [0xc1, 'instanceof', 'c2'],
  [0xc2, 'monitorenter', ''],
  [0xc3, 'monitorexit', ''],
  [0xc4, 'wide', 'wide'],
  [0xc5, 'multianewarray', 'multi'],
  [0xc6, 'ifnull', 'j2'],
  [0xc7, 'ifnonnull', 'j2'],
  [0xc8, 'goto_w', 'j4'],
  [0xc9, 'jsr_w', 'j4'],
  [0xca, 'breakpoint', ''],
  [0xfe, 'impdep1', ''],
  [0xff, 'impdep2', '']
]

function numbered(start: number, names: string[]): Row[] {
  const rows: Row[] = []
  names.forEach((name, i) => {
    for (let n = 0; n < 4; n++) rows.push([start + i * 4 + n, `${name}_${n}`, ''])
  })
  return rows
}

function typed(start: number, op: string): Row[] {
  return ['i', 'l', 'f', 'd'].map((t, i): Row => [start + i, `${t}${op}`, ''])
}

export type OpcodeInfo = { code: number; name: string; shape: OperandShape }

/** Opcode info by byte value; undefined for the unassigned values 0xcb–0xfd. */
export const OPCODES: (OpcodeInfo | undefined)[] = new Array(256)
/** Opcode byte by mnemonic, for tests and the assembler. */
export const OP: Record<string, number> = {}

for (const [code, name, shape] of ROWS) {
  OPCODES[code] = { code, name, shape }
  OP[name] = code
}

export const ARRAY_TYPES: Record<number, string> = {
  4: 'boolean',
  5: 'char',
  6: 'float',
  7: 'double',
  8: 'byte',
  9: 'short',
  10: 'int',
  11: 'long'
}

/** Opcodes that `wide` may modify. */
export const WIDENABLE = new Set([0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0x84])
