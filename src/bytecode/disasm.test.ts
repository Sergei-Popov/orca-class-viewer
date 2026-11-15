import { assert, test } from 'orca/testing'
import { ClassWriter, asm, s4, u2 } from '../testing/classwriter'
import { parseClass } from '../classfile/classfile'
import { branchTargets, disassemble } from './disasm'
import { classListing, cpComment, methodListing } from './listing'
import { OP, OPCODES } from './opcodes'

const text = (lines: { segs: { text: string }[] }[]) => lines.map((l) => l.segs.map((s) => s.text).join('')).join('\n')

test('knows all 202 JVM opcodes plus the reserved ones', () => {
  let known = 0
  for (let code = 0; code < 256; code++) if (OPCODES[code]) known++
  assert.equal(known, 205)
  assert.equal(OPCODES[0xc9]?.name, 'jsr_w')
  assert.equal(OPCODES[0xcb], undefined)
  assert.equal(OP.iload_3, 0x1d)
  assert.equal(OP.astore_0, 0x4b)
  assert.equal(OP.dneg, 0x77)
})

test('decodes operands of every shape', () => {
  const code = Uint8Array.from([
    ...asm('bipush', 0xfe), // -2
    ...asm('sipush', 0x12, 0x34),
    ...asm('ldc', 7),
    ...asm('ldc_w', ...u2(300)),
    ...asm('iload', 4),
    ...asm('iinc', 4, 0xff), // -1
    ...asm('newarray', 10),
    ...asm('multianewarray', ...u2(9), 2),
    ...asm('invokeinterface', ...u2(11), 2, 0),
    ...asm('invokedynamic', ...u2(12), 0, 0),
    ...asm('goto', ...u2(0xfffe)), // back 2
    ...asm('goto_w', ...s4(5)),
    ...asm('return')
  ])
  const ins = disassemble(code)
  assert.deepEqual(
    ins.map((i) => i.mnemonic),
    ['bipush', 'sipush', 'ldc', 'ldc_w', 'iload', 'iinc', 'newarray', 'multianewarray', 'invokeinterface', 'invokedynamic', 'goto', 'goto_w', 'return']
  )
  assert.deepEqual(ins[0].operands, [{ kind: 'int', value: -2 }])
  assert.deepEqual(ins[1].operands, [{ kind: 'int', value: 0x1234 }])
  assert.deepEqual(ins[3].operands, [{ kind: 'cp', index: 300 }])
  assert.deepEqual(ins[5].operands, [{ kind: 'local', index: 4 }, { kind: 'int', value: -1 }])
  assert.deepEqual(ins[6].operands, [{ kind: 'atype', value: 10, name: 'int' }])
  assert.deepEqual(ins[7].operands, [{ kind: 'cp', index: 9 }, { kind: 'count', value: 2 }])
  assert.equal(ins[8].length, 5)
  assert.equal(ins[9].length, 5)
  assert.deepEqual(ins[10].operands, [{ kind: 'branch', target: ins[10].offset - 2 }])
  assert.deepEqual(ins[11].operands, [{ kind: 'branch', target: ins[11].offset + 5 }])
  assert.equal(ins[12].offset, code.length - 1)
})

test('wide widens loads, stores, ret and iinc', () => {
  const ins = disassemble(Uint8Array.from([...asm('wide', 'iload', 0x01, 0x00), ...asm('wide', 'iinc', 0x01, 0x00, 0x80, 0x00), ...asm('return')]))
  assert.equal(ins[0].mnemonic, 'iload')
  assert.equal(ins[0].wide, true)
  assert.equal(ins[0].length, 4)
  assert.deepEqual(ins[0].operands, [{ kind: 'local', index: 256 }])
  assert.equal(ins[1].mnemonic, 'iinc')
  assert.equal(ins[1].length, 6)
  assert.deepEqual(ins[1].operands, [{ kind: 'local', index: 256 }, { kind: 'int', value: -32768 }])
  assert.equal(ins[2].offset, 10)
  // wide in front of something it cannot widen
  const bad = disassemble(Uint8Array.from(asm('wide', 'nop')))
  assert.equal(bad[0].invalid, 'operand')
})

test('aligns tableswitch and lookupswitch operands to four bytes', () => {
  // nop at 0, tableswitch at 1: two padding bytes, operands from 4.
  const table = Uint8Array.from([
    ...asm('nop', 'tableswitch', 0, 0),
    ...s4(30), // default → 1 + 30
    ...s4(1), // low
    ...s4(3), // high
    ...s4(20),
    ...s4(21),
    ...s4(22)
  ])
  const [, sw] = disassemble(table)
  assert.equal(sw.mnemonic, 'tableswitch')
  assert.equal(sw.length, 3 + 12 + 12)
  assert.deepEqual(sw.operands[0], {
    kind: 'switch',
    defaultTarget: 31,
    cases: [
      [1, 21],
      [2, 22],
      [3, 23]
    ],
    low: 1,
    high: 3
  })
  // lookupswitch at 0: three padding bytes.
  const lookup = Uint8Array.from([...asm('lookupswitch', 0, 0, 0), ...s4(8), ...s4(2), ...s4(-5), ...s4(4), ...s4(1000), ...s4(6)])
  const [lk] = disassemble(lookup)
  assert.equal(lk.length, 4 + 8 + 16)
  assert.deepEqual(lk.operands[0], { kind: 'switch', defaultTarget: 8, cases: [[-5, 4], [1000, 6]] })
  assert.deepEqual([...branchTargets([sw, lk])].sort((a, b) => a - b), [4, 6, 8, 21, 22, 23, 31])
})

test('bad bytes do not stop the listing', () => {
  const ins = disassemble(Uint8Array.from([0xcb, ...asm('iconst_1', 'sipush', 0x01)]))
  assert.equal(ins[0].invalid, 'opcode')
  assert.equal(ins[0].mnemonic, '.byte')
  assert.equal(ins[1].mnemonic, 'iconst_1')
  assert.equal(ins[2].invalid, 'truncated')
  // A tableswitch whose high is below low is damaged, not an endless loop.
  const sw = disassemble(Uint8Array.from([...asm('tableswitch', 0, 0, 0), ...s4(0), ...s4(5), ...s4(1), ...asm('return')]))
  assert.equal(sw[0].invalid, 'operand')
  assert.equal(sw[1].mnemonic, 'return')
  // A huge case count is refused before any allocation.
  const huge = disassemble(Uint8Array.from([...asm('lookupswitch', 0, 0, 0), ...s4(0), ...s4(0x7fffffff)]))
  assert.equal(huge[0].invalid, 'operand')
})

test('lists a method like javap -c -v, with constants resolved', () => {
  const w = new ClassWriter({ name: 'demo/Greeter', major: 52 })
  const out = w.pool.field('java/lang/System', 'out', 'Ljava/io/PrintStream;')
  const hello = w.pool.string('Hello')
  const println = w.pool.method('java/io/PrintStream', 'println', '(Ljava/lang/String;)V')
  const ex = w.pool.cls('java/lang/RuntimeException')
  const lines = [...u2(1), ...u2(0), ...u2(7)]
  const lvt = [...u2(1), ...u2(0), ...u2(9), ...u2(w.pool.utf8('args')), ...u2(w.pool.utf8('[Ljava/lang/String;')), ...u2(0)]
  w.method({
    access: 0x0009,
    name: 'main',
    descriptor: '([Ljava/lang/String;)V',
    attributes: [
      w.code({
        maxStack: 2,
        maxLocals: 1,
        code: asm('getstatic', ...u2(out), 'ldc', hello, 'invokevirtual', ...u2(println), 'return'),
        exceptions: [{ start: 0, end: 8, handler: 8, catchType: ex }],
        attributes: [
          { name: 'LineNumberTable', body: lines },
          { name: 'LocalVariableTable', body: lvt }
        ]
      }),
      w.classListAttr('Exceptions', ['java/io/IOException'])
    ]
  })
  const cls = parseClass(w.toBytes())
  const listing = text(methodListing(cls, 0))
  assert.match(listing, /^public static void main\(java\.lang\.String\[\] args\) throws java\.io\.IOException;$/m)
  assert.match(listing, /descriptor: \(\[Ljava\/lang\/String;\)V/)
  assert.match(listing, /flags: \(0x0009\) ACC_PUBLIC, ACC_STATIC/)
  assert.match(listing, /stack=2, locals=1, args_size=1/)
  assert.match(listing, /0: getstatic +#\d+ +\/\/ Field java\/lang\/System\.out:Ljava\/io\/PrintStream;/)
  assert.match(listing, /3: ldc +#\d+ +\/\/ String Hello/)
  assert.match(listing, /5: invokevirtual +#\d+ +\/\/ Method java\/io\/PrintStream\.println:\(Ljava\/lang\/String;\)V/)
  assert.match(listing, /^ +8: return$/m)
  assert.match(listing, / +0 +8 +8 +Class java\/lang\/RuntimeException/)
  assert.match(listing, /line 7: 0/)
  assert.match(listing, /0 +9 +0 +args +\[Ljava\/lang\/String;/)
  // Links: cp operands point at the pool, branch targets at offsets.
  const seg = methodListing(cls, 0).flatMap((l) => l.segs).find((s) => s.kind === 'cp')
  assert.equal(seg?.ref, out)
  assert.equal(cpComment(cls.pool, 9999), '// <bad #9999>')
  assert.ok(classListing(cls).length > 5)
})
