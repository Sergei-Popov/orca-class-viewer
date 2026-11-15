import { assert, test } from 'orca/testing'
import { ClassWriter, asm, s4, u2 } from '../testing/classwriter'
import { MAX_CODE_LENGTH } from '../classfile/attributes'
import { damagedAttributes, parseClass } from '../classfile/classfile'
import { poolUsage } from '../classfile/usage'
import { stringsFor } from '../i18n'
import { useSiteText } from '../ui/pooltable'
import { branchTargets, disassemble } from './disasm'
import { MAX_LISTED_ROWS, classListing, cpComment, localNames, methodListing } from './listing'
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

// Review 1, findings 2, 3 and 18. The expected text is javap's, copied from `javap -v -p` of
// Java 21 on this source (javac 21):
//   static final float F = Float.MIN_VALUE; static final double D = Double.MIN_VALUE;
//   static final double D2 = 2 * Double.MIN_VALUE;
//   String a() { return "Illegal null or empty Level name."; }  String b() { return "<Map>\n"; }
//   String c() { return "tab\there"; }  String d() { return "back\\slash \"q\" it's"; }
//   Object e(Object o) { try { return o.toString(); } catch (IllegalStateException x) { return x; } }
test('string, float and stack map text matches javap', () => {
  const w = new ClassWriter({ name: 'demo/Golden' })
  const strings = ['Illegal null or empty Level name.', '<Map>\n', 'tab\there', 'back\\slash "q" it\'s']
  const javap = [
    String.raw`// String Illegal null or empty Level name.`,
    String.raw`// String <Map>\n`,
    String.raw`// String tab\there`,
    String.raw`// String back\\slash \"q\" it\'s`
  ]
  const utf8 = [String.raw`Illegal null or empty Level name.`, String.raw`<Map>\n`, String.raw`tab\there`, String.raw`back\\slash \"q\" it\'s`]
  const refs = strings.map((s) => w.pool.string(s))
  refs.forEach((ref, i) => {
    w.method({ access: 0, name: String.fromCharCode(97 + i), descriptor: '()Ljava/lang/String;', attributes: [w.code({ code: asm('ldc', ref, 'areturn') })] })
  })
  const f = w.pool.float(new DataView(Uint32Array.of(1).buffer).getFloat32(0, true))
  const d = w.pool.double(Number.MIN_VALUE)
  const d2 = w.pool.double(2 * Number.MIN_VALUE)
  const ise = w.pool.cls('java/lang/IllegalStateException')
  // e(Object): same_locals_1_stack_item at 5 holding the caught IllegalStateException.
  w.method({ access: 0, name: 'e', descriptor: '(Ljava/lang/Object;)Ljava/lang/Object;', attributes: [w.code({ code: asm('aload_1', 'areturn', 'nop', 'nop', 'nop', 'astore_2', 'aload_2', 'areturn'), attributes: [{ name: 'StackMapTable', body: [...u2(1), 69, 7, ...u2(ise)] }] })] })
  const cls = parseClass(w.toBytes())
  const listing = text(classListing(cls))
  javap.forEach((comment, i) => {
    assert.equal(cpComment(cls.pool, refs[i]), comment)
    assert.ok(listing.includes(comment), comment)
    const e = cls.pool.get(refs[i])
    assert.equal(e?.tag === 8 ? cls.pool.text(e.ref) : undefined, utf8[i])
  })
  assert.equal(cls.pool.text(f), '1.4E-45f')
  assert.equal(cls.pool.text(d), '4.9E-324d')
  assert.equal(cls.pool.text(d2), '9.9E-324d')
  // javap: `stack = [ class java/lang/IllegalStateException ]`
  assert.match(listing, /at 5: same locals, stack \[class java\/lang\/IllegalStateException\]$/m)
  assert.ok(!/\\u0020/.test(listing))
})

// Review 1, finding 10: one method can list more lines than a call takes arguments.
test('lists a method of 131 thousand lines without overflowing the stack', () => {
  const w = new ClassWriter({ name: 'demo/Huge' })
  const n = 65535
  const code = [...new Array(n - 1).fill(0), 0xb1] // nop … return
  const lines: number[] = [...u2(n)]
  for (let i = 0; i < n; i++) lines.push(...u2(i), ...u2(i + 1))
  w.method({ access: 0x0009, name: 'big', descriptor: '()V', attributes: [w.code({ code, attributes: [{ name: 'LineNumberTable', body: lines }] })] })
  const cls = parseClass(w.toBytes())
  const listing = classListing(cls)
  assert.ok(listing.length > 131000)
})

// Review 1, finding 13: a damaged Code attribute is listed with its error, not dropped.
test('lists a damaged Code attribute with its error', () => {
  const w = new ClassWriter({ name: 'demo/Broken' })
  w.method({ access: 1, name: 'answer', descriptor: '()I', attributes: [{ name: 'Code', body: [0, 1, 0, 1, 0, 0, 3, 232, 0xac, 0, 0, 0, 0] }] })
  const listing = text(classListing(parseClass(w.toBytes())))
  assert.match(listing, /^ {2}Code: 13 bytes — the file ends inside the bytecode$/m)
})

/** A Code attribute body as the class file stores it, with any code_length. */
function codeBody(code: number[], length = code.length): number[] {
  return [...u2(1), ...u2(1), (length >>> 24) & 255, (length >>> 16) & 255, (length >>> 8) & 255, length & 255, ...code, ...u2(0), ...u2(0)]
}

// Review 2, finding 1: code_length is 1 to 65535 (JVMS 4.7.3); a crafted 20 MB method froze the tab.
test('takes a Code attribute with code_length past 65535 or of 0 as damaged', () => {
  for (const length of [65536, 70000, 0]) {
    const w = new ClassWriter({ name: 'demo/Long' })
    const code = [...new Array(Math.max(length - 1, 0)).fill(0), ...(length ? [0xb1] : [])]
    w.method({ access: 9, name: 'big', descriptor: '()V', attributes: [{ name: 'Code', body: codeBody(code) }] })
    const cls = parseClass(w.toBytes())
    const [damaged] = damagedAttributes(cls)
    assert.equal(damaged?.attribute.name, 'Code', String(length))
    assert.equal(damaged?.attribute.errorCode, 'malformed')
    assert.equal(damaged?.attribute.error, `code_length is ${length}, where the JVM allows 1 to 65535`)
    const listing = classListing(cls)
    assert.ok(listing.length < 10, `${listing.length} lines`)
    assert.match(text(listing), new RegExp(`^ {2}Code: ${length + 12} bytes — code_length is ${length}`, 'm'))
  }
  // The longest the JVM takes is still listed.
  const w = new ClassWriter({ name: 'demo/Longest' })
  w.method({ access: 9, name: 'big', descriptor: '()V', attributes: [{ name: 'Code', body: codeBody([...new Array(65534).fill(0), 0xb1]) }] })
  const cls = parseClass(w.toBytes())
  assert.equal(damagedAttributes(cls).length, 0)
  assert.equal(MAX_CODE_LENGTH, 65535)
  assert.ok(classListing(cls).length > 65535)
})

/** A class of `methods` static methods, each `size` bytes of nop and a return. */
function fullMethods(methods: number, size: number) {
  const w = new ClassWriter({ name: 'demo/Full' })
  const code = [...new Array(size - 1).fill(0), 0xb1]
  for (let k = 0; k < methods; k++) w.method({ access: 9, name: `m${k}`, descriptor: '()V', attributes: [w.code({ code })] })
  return parseClass(w.toBytes())
}

// Review 2, finding 1: 300 methods of 64 KB list 20 million lines; past 1M rows code is left out.
test('stops listing code past a million rows and marks the methods left out', () => {
  const cls = fullMethods(3, 10)
  const listing = classListing(cls, 15)
  // m0 takes 10 rows; m1 would take 20 of 15, so m1 and m2 are cut.
  const cut = listing.filter((l) => l.cut !== undefined)
  assert.deepEqual(
    cut.map((l) => [l.method, l.cut]),
    [
      [1, 10],
      [2, 10]
    ]
  )
  // Their declarations stay, so "Go to method" still finds them.
  for (const m of [0, 1, 2]) assert.ok(listing.some((l) => l.anchor === `m${m}`), `m${m}`)
  assert.ok(listing.some((l) => l.anchor === 'm0@9'))
  assert.ok(!listing.some((l) => l.anchor?.startsWith('m1@')))
  assert.equal(MAX_LISTED_ROWS, 1_000_000)
  // Table rows count too: a short method with a huge LineNumberTable.
  const w = new ClassWriter({ name: 'demo/Lines' })
  const lines: number[] = [...u2(40)]
  for (let i = 0; i < 40; i++) lines.push(...u2(0), ...u2(i))
  w.method({ access: 9, name: 'm', descriptor: '()V', attributes: [w.code({ code: asm('return'), attributes: [{ name: 'LineNumberTable', body: lines }] })] })
  assert.equal(classListing(parseClass(w.toBytes()), 30).filter((l) => l.cut !== undefined).length, 1)
  // At the real limit: 15 full methods fit, the 16th and 17th do not.
  const big = classListing(fullMethods(17, 65535))
  assert.ok(big.length < MAX_LISTED_ROWS + 1000, `${big.length} lines`)
  assert.deepEqual(
    big.filter((l) => l.cut !== undefined).map((l) => l.method),
    [15, 16]
  )
})

// Review 2, finding 1: the Constant pool's uses search the same number of instructions.
test('searches uses in code within the instruction limit', () => {
  const cls = fullMethods(3, 10)
  assert.equal(poolUsage(cls, 15).codeCut, true)
  assert.equal(poolUsage(cls).codeCut, undefined)
})

// Review 2, finding 7: one LocalVariableTable scan per instruction was quadratic.
test('looks local variable names up in an index of the LocalVariableTable', () => {
  const w = new ClassWriter({ name: 'demo/Locals' })
  const name = w.pool.utf8('x')
  const desc = w.pool.utf8('I')
  // 32,767 × iload 5 and 65,535 table entries for other slots.
  const code = [...new Array(32767).fill(0).flatMap(() => asm('iload', 5)), ...asm('return')]
  const vars: number[] = [...u2(65535)]
  for (let i = 0; i < 65535; i++) vars.push(...u2(0), ...u2(65535), ...u2(name), ...u2(desc), ...u2(6 + (i % 1000)))
  w.method({ access: 9, name: 'm', descriptor: '()V', attributes: [w.code({ code, attributes: [{ name: 'LocalVariableTable', body: vars }] })] })
  const cls = parseClass(w.toBytes())
  const started = Date.now()
  classListing(cls)
  const took = Date.now() - started
  assert.ok(took < 1000, `${took} ms`)
  // The lookup finds what a scan of the table finds: a store names the variable starting after it.
  const pool = cls.pool
  const v = (start: number, length: number, slot: number) => ({ start, length, slot, nameIndex: name })
  const at = localNames(pool, [v(10, 5, 1), v(0, 30, 2), v(12, 3, 2)])
  assert.equal(at(1, 6), 'x')
  assert.equal(at(1, 5), undefined)
  assert.equal(at(1, 14), 'x')
  assert.equal(at(1, 15), undefined)
  assert.equal(at(3, 0), undefined)
  // Overlapping ranges: the table's first one wins, as before.
  const a = w.pool.utf8('a')
  const b = w.pool.utf8('b')
  const pick = localNames(parseClass(w.toBytes()).pool, [
    { start: 10, length: 20, slot: 1, nameIndex: b },
    { start: 0, length: 40, slot: 1, nameIndex: a }
  ])
  assert.equal(pick(1, 12), 'b')
  assert.equal(pick(1, 35), 'a')
  assert.equal(localNames(pool, undefined)(1, 0), undefined)
})

// Review 2, finding 10: an unknown attribute may be named with a bidi mark and a newline.
test('escapes unknown attribute names in the listing and the pool uses', () => {
  const w = new ClassWriter({ name: 'demo/Odd' })
  // Built from char codes, so this source holds no right-to-left mark itself.
  const rlo = String.fromCharCode(0x202e)
  const odd = `Note${rlo}txt.exe\nsecond line`
  w.method({ access: 9, name: 'm', descriptor: '()V', attributes: [{ name: odd, body: [1, 2, 3] }] })
  const cls = parseClass(w.toBytes())
  const listing = text(classListing(cls))
  assert.match(listing, /^ {2}Note\\u202etxt\.exe\\nsecond line: 3 bytes$/m)
  assert.ok(!listing.includes(rlo))
  const site = poolUsage(cls)[w.pool.utf8(odd)].sites[0]
  assert.equal(useSiteText(stringsFor('en'), site), 'method m · Note\\u202etxt.exe\\nsecond line · attribute name')
})
