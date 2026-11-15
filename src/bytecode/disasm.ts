// Decodes a method's bytecode into instructions. Bad bytes never stop the listing: an unknown
// opcode becomes a one-byte `.byte` entry and an instruction cut off by the end of the code
// becomes a `truncated` entry, so the rest of a damaged or obfuscated method stays readable.

import { ARRAY_TYPES, OPCODES, WIDENABLE } from './opcodes'

export type Operand =
  | { kind: 'int'; value: number }
  | { kind: 'local'; index: number }
  | { kind: 'cp'; index: number }
  | { kind: 'branch'; target: number }
  | { kind: 'atype'; value: number; name: string }
  | { kind: 'count'; value: number }
  | { kind: 'switch'; defaultTarget: number; cases: [match: number, target: number][]; low?: number; high?: number }

export type Instruction = {
  offset: number
  opcode: number
  mnemonic: string
  length: number
  wide: boolean
  operands: Operand[]
  /** Not a real instruction: an unknown opcode or one cut off by the end of the code. */
  invalid?: 'opcode' | 'truncated' | 'operand'
}

/** Switches with more cases than this are listed as damaged: real ones stay far below. */
const MAX_SWITCH_CASES = 1 << 16

export function disassemble(code: Uint8Array): Instruction[] {
  const out: Instruction[] = []
  let pc = 0
  const u1 = (at: number) => code[at]
  const s1 = (at: number) => (code[at] << 24) >> 24
  const u2 = (at: number) => (code[at] << 8) | code[at + 1]
  const s2 = (at: number) => (u2(at) << 16) >> 16
  const s4 = (at: number) => (code[at] << 24) | (code[at + 1] << 16) | (code[at + 2] << 8) | code[at + 3]

  while (pc < code.length) {
    const start = pc
    const opcode = code[pc]
    const info = OPCODES[opcode]
    if (!info) {
      out.push({ offset: start, opcode, mnemonic: '.byte', length: 1, wide: false, operands: [{ kind: 'int', value: opcode }], invalid: 'opcode' })
      pc++
      continue
    }
    const fits = (n: number) => start + n <= code.length
    const make = (length: number, operands: Operand[], wide = false, mnemonic = info.name): Instruction => ({
      offset: start,
      opcode,
      mnemonic,
      length,
      wide,
      operands
    })
    const cut = (): Instruction => ({
      offset: start,
      opcode,
      mnemonic: info.name,
      length: code.length - start,
      wide: false,
      operands: [],
      invalid: 'truncated'
    })
    let ins: Instruction
    switch (info.shape) {
      case '':
        ins = make(1, [])
        break
      case 'b':
        ins = fits(2) ? make(2, [{ kind: 'int', value: s1(pc + 1) }]) : cut()
        break
      case 's':
        ins = fits(3) ? make(3, [{ kind: 'int', value: s2(pc + 1) }]) : cut()
        break
      case 'l':
        ins = fits(2) ? make(2, [{ kind: 'local', index: u1(pc + 1) }]) : cut()
        break
      case 'c1':
        ins = fits(2) ? make(2, [{ kind: 'cp', index: u1(pc + 1) }]) : cut()
        break
      case 'c2':
        ins = fits(3) ? make(3, [{ kind: 'cp', index: u2(pc + 1) }]) : cut()
        break
      case 'j2':
        ins = fits(3) ? make(3, [{ kind: 'branch', target: start + s2(pc + 1) }]) : cut()
        break
      case 'j4':
        ins = fits(5) ? make(5, [{ kind: 'branch', target: start + s4(pc + 1) }]) : cut()
        break
      case 'iinc':
        ins = fits(3) ? make(3, [{ kind: 'local', index: u1(pc + 1) }, { kind: 'int', value: s1(pc + 2) }]) : cut()
        break
      case 'iface':
        ins = fits(5) ? make(5, [{ kind: 'cp', index: u2(pc + 1) }, { kind: 'count', value: u1(pc + 3) }]) : cut()
        break
      case 'indy':
        ins = fits(5) ? make(5, [{ kind: 'cp', index: u2(pc + 1) }]) : cut()
        break
      case 'atype':
        ins = fits(2)
          ? make(2, [{ kind: 'atype', value: u1(pc + 1), name: ARRAY_TYPES[u1(pc + 1)] ?? `?${u1(pc + 1)}` }])
          : cut()
        break
      case 'multi':
        ins = fits(4) ? make(4, [{ kind: 'cp', index: u2(pc + 1) }, { kind: 'count', value: u1(pc + 3) }]) : cut()
        break
      case 'wide': {
        if (!fits(2)) {
          ins = cut()
          break
        }
        const inner = code[pc + 1]
        const innerInfo = OPCODES[inner]
        if (!innerInfo || !WIDENABLE.has(inner)) {
          ins = { ...make(2, [{ kind: 'int', value: inner }]), invalid: 'operand' }
          break
        }
        if (inner === 0x84) {
          ins = fits(6)
            ? make(6, [{ kind: 'local', index: u2(pc + 2) }, { kind: 'int', value: s2(pc + 4) }], true, innerInfo.name)
            : cut()
        } else {
          ins = fits(4) ? make(4, [{ kind: 'local', index: u2(pc + 2) }], true, innerInfo.name) : cut()
        }
        if (!ins.invalid) ins.opcode = inner
        break
      }
      case 'table': {
        const base = (start + 4) & ~3 // operands start at a multiple of four from the method start
        if (!fits(base - start + 12)) {
          ins = cut()
          break
        }
        const defaultTarget = start + s4(base)
        const low = s4(base + 4)
        const high = s4(base + 8)
        const n = high - low + 1
        if (high < low || n > MAX_SWITCH_CASES || !fits(base - start + 12 + n * 4)) {
          ins = n > MAX_SWITCH_CASES || high < low ? { ...make(base - start + 12, []), invalid: 'operand' } : cut()
          break
        }
        const cases: [number, number][] = []
        for (let i = 0; i < n; i++) cases.push([low + i, start + s4(base + 12 + i * 4)])
        ins = make(base - start + 12 + n * 4, [{ kind: 'switch', defaultTarget, cases, low, high }])
        break
      }
      case 'lookup': {
        const base = (start + 4) & ~3
        if (!fits(base - start + 8)) {
          ins = cut()
          break
        }
        const defaultTarget = start + s4(base)
        const n = s4(base + 4)
        if (n < 0 || n > MAX_SWITCH_CASES) {
          ins = { ...make(base - start + 8, []), invalid: 'operand' }
          break
        }
        if (!fits(base - start + 8 + n * 8)) {
          ins = cut()
          break
        }
        const cases: [number, number][] = []
        for (let i = 0; i < n; i++) cases.push([s4(base + 8 + i * 8), start + s4(base + 12 + i * 8)])
        ins = make(base - start + 8 + n * 8, [{ kind: 'switch', defaultTarget, cases }])
        break
      }
    }
    out.push(ins)
    pc = start + Math.max(1, ins.length)
  }
  return out
}

/** Offsets that instructions jump to, for labels. */
export function branchTargets(instructions: Instruction[]): Set<number> {
  const targets = new Set<number>()
  for (const ins of instructions) {
    for (const op of ins.operands) {
      if (op.kind === 'branch') targets.add(op.target)
      else if (op.kind === 'switch') {
        targets.add(op.defaultTarget)
        for (const [, target] of op.cases) targets.add(target)
      }
    }
  }
  return targets
}
