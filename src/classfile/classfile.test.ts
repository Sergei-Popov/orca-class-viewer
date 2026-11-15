import { assert, test } from 'orca/testing'
import { ClassWriter, asm, helloClass, u2 } from '../testing/classwriter'
import { findAttribute } from './attributes'
import { ClassFormatError, decodeModifiedUtf8, encodeModifiedUtf8 } from './bytes'
import { damagedAttributes, parseClass, peekVersion } from './classfile'
import { flagNames, flagSummary, javaModifiers } from './flags'
import { formatJavaNumber, javaDouble, javaFloat } from './pool'
import { javaRelease, releaseLabel } from './versions'

test('reads the header, names and members of a plain class', () => {
  const cls = parseClass(helloClass('demo/Hello').toBytes())
  assert.equal(cls.error, undefined)
  assert.equal(cls.major, 61)
  assert.equal(cls.minor, 0)
  assert.equal(cls.name, 'demo/Hello')
  assert.equal(cls.superName, 'java/lang/Object')
  assert.deepEqual(cls.interfaces, [])
  assert.equal(cls.methods.length, 1)
  assert.equal(cls.methods[0].name, '<init>')
  assert.equal(cls.methods[0].descriptor, '()V')
  const code = findAttribute(cls.methods[0].attributes, 'Code')
  assert.ok(code)
  const bytes = Array.from(code.value.code.code)
  assert.equal(bytes.length, 5)
  assert.equal(cls.pool.text((bytes[2] << 8) | bytes[3]), 'java/lang/Object."<init>":()V')
  assert.equal(cls.trailing, 0)
})

test('maps major versions to Java releases', () => {
  assert.equal(releaseLabel(45, 3), 'Java 1.1')
  assert.equal(releaseLabel(48), 'Java 1.4')
  assert.equal(releaseLabel(49), 'Java 5')
  assert.equal(releaseLabel(52), 'Java 8')
  assert.equal(releaseLabel(61), 'Java 17')
  assert.equal(releaseLabel(65, 0xffff), 'Java 21 preview')
  assert.equal(releaseLabel(69), 'Java 25')
  assert.equal(javaRelease(71).newer, false)
  assert.equal(javaRelease(72).newer, true)
  assert.equal(releaseLabel(72), 'Java 28')
  assert.equal(javaRelease(40).unknown, true)
  // Before Java 12 the minor version 0xFFFF means nothing special.
  assert.equal(javaRelease(52, 0xffff).preview, false)
})

test('refuses empty files and wrong magic with a clear code', () => {
  assert.throws(() => parseClass(new Uint8Array(0)), (e: unknown) => e instanceof ClassFormatError && e.code === 'empty')
  assert.throws(
    () => parseClass(Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0)),
    (e: unknown) => e instanceof ClassFormatError && e.code === 'magic' && e.message.includes('50 4b 03 04')
  )
  assert.throws(() => parseClass(Uint8Array.of(0xca, 0xfe)), (e: unknown) => e instanceof ClassFormatError && e.code === 'magic')
})

test('a truncated class keeps what was read before the cut', () => {
  const bytes = helloClass('demo/Cut').toBytes()
  // Inside the method's Code attribute.
  const cls = parseClass(bytes.subarray(0, bytes.length - 6))
  assert.ok(cls.error)
  assert.equal(cls.error.code, 'truncated')
  assert.equal(cls.name, 'demo/Cut')
  assert.equal(cls.methods.length, 1)
  // Inside the constant pool: the entries before the cut stay.
  const early = parseClass(bytes.subarray(0, 30))
  assert.equal(early.error?.code, 'truncated')
  assert.equal(early.major, 61)
  assert.ok(early.pool.entries.filter(Boolean).length >= 1)
  assert.equal(early.name, '')
})

test('an unknown constant pool tag stops reading with a malformed error', () => {
  const w = new ClassWriter({ name: 'demo/Bad' })
  w.pool.utf8('fine')
  w.pool.rawEntry([99, 0, 0])
  const cls = parseClass(w.toBytes())
  assert.equal(cls.error?.code, 'malformed')
  assert.match(cls.error?.message ?? '', /unknown constant pool tag 99/)
  assert.equal(cls.pool.utf8(1), 'fine')
})

test('reads every constant kind, with Long and Double taking two slots', () => {
  const w = new ClassWriter({ name: 'demo/Consts' })
  const i = w.pool.int(-42)
  const l = w.pool.long(-9007199254740993n)
  const after = w.pool.utf8('after')
  const f = w.pool.float(1.5)
  const d = w.pool.double(9.4607e12)
  const s = w.pool.string('tab\there "q"')
  const m = w.pool.method('java/lang/Object', '<init>', '()V')
  const im = w.pool.interfaceMethod('java/util/List', 'size', '()I')
  const fr = w.pool.field('demo/Consts', 'x', 'I')
  const mh = w.pool.methodHandle(6, m)
  const mt = w.pool.methodType('(I)V')
  const indy = w.pool.dynamic(18, 0, 'run', '()Ljava/lang/Runnable;')
  const mod = w.pool.module('demo.mod')
  const pkg = w.pool.package('demo/pkg')
  const arr = w.pool.cls('[Ljava/lang/String;')
  const cls = parseClass(w.toBytes())
  const p = cls.pool
  assert.equal(after, l + 2)
  assert.equal(p.get(l + 1), undefined)
  assert.equal(p.text(i), '-42')
  assert.equal(p.text(l), '-9007199254740993l')
  assert.equal(p.literal(l), '-9007199254740993L')
  assert.equal(p.text(f), '1.5f')
  assert.equal(p.literal(f), '1.5F')
  assert.equal(p.text(d), '9.4607E12d')
  assert.equal(p.text(s), '"tab\\there \\"q\\""')
  assert.equal(p.text(m), 'java/lang/Object."<init>":()V')
  assert.equal(p.text(im), 'java/util/List.size:()I')
  assert.equal(p.text(fr), 'demo/Consts.x:I')
  assert.equal(p.text(mh), 'REF_invokeStatic java/lang/Object."<init>":()V')
  assert.equal(p.text(mt), '(I)V')
  assert.equal(p.text(indy), '#0:run:()Ljava/lang/Runnable;')
  assert.equal(p.text(mod), 'demo.mod')
  assert.equal(p.text(pkg), 'demo/pkg')
  assert.equal(p.text(arr), '"[Ljava/lang/String;"')
  const [owner, nat] = p.refs(m)
  assert.equal(p.className(owner), 'java/lang/Object')
  assert.deepEqual(p.nameAndType(nat), { name: '<init>', descriptor: '()V' })
  assert.equal(p.tagName(indy), 'InvokeDynamic')
  assert.equal(p.text(9999), '<bad #9999>')
})

test('formats float and double like Java', () => {
  assert.equal(formatJavaNumber(1, false), '1.0')
  assert.equal(formatJavaNumber(0.001, false), '0.001')
  assert.equal(formatJavaNumber(0.0001, false), '1.0E-4')
  assert.equal(formatJavaNumber(1e7, false), '1.0E7')
  assert.equal(formatJavaNumber(9999999, false), '9999999.0')
  assert.equal(formatJavaNumber(-0, false), '-0.0')
  assert.equal(formatJavaNumber(Math.fround(0.1), true), '0.1')
  assert.equal(formatJavaNumber(Math.fround(3.26156), true), '3.26156')
  assert.equal(javaFloat(NaN), 'Float.NaN')
  assert.equal(javaDouble(-Infinity), 'Double.NEGATIVE_INFINITY')
  assert.equal(javaDouble(203.2), '203.2')
})

// Review 1, finding 18: Java never prints one digit; it takes the closest two-digit decimal.
// Expected values are what Float.toString and Double.toString print in Java 21.
test('formats subnormal floats and doubles like Float.toString and Double.toString', () => {
  const float = (bits: number) => new DataView(Uint32Array.of(bits).buffer).getFloat32(0, true)
  assert.equal(formatJavaNumber(float(0x00000001), true), '1.4E-45') // Float.MIN_VALUE
  assert.equal(formatJavaNumber(float(0x00000002), true), '2.8E-45')
  assert.equal(formatJavaNumber(float(0x7f7fffff), true), '3.4028235E38') // Float.MAX_VALUE
  assert.equal(formatJavaNumber(float(0x00800000), true), '1.1754944E-38') // Float.MIN_NORMAL
  assert.equal(formatJavaNumber(Number.MIN_VALUE, false), '4.9E-324') // Double.MIN_VALUE
  assert.equal(formatJavaNumber(2 * Number.MIN_VALUE, false), '9.9E-324')
  assert.equal(formatJavaNumber(Number.MAX_VALUE, false), '1.7976931348623157E308')
  assert.equal(formatJavaNumber(2.2250738585072014e-308, false), '2.2250738585072014E-308') // Double.MIN_NORMAL
  assert.equal(formatJavaNumber(1e23, false), '1.0E23')
  assert.equal(formatJavaNumber(1e10, false), '1.0E10')
  assert.equal(formatJavaNumber(100, false), '100.0')
  assert.equal(formatJavaNumber(-123456.789, false), '-123456.789')
  assert.equal(formatJavaNumber(Math.fround(1.1), true), '1.1')
  assert.equal(javaDouble(Number.MIN_VALUE), '4.9E-324')
  assert.equal(javaFloat(float(1)), '1.4E-45F')
})

// Review 2, finding 11. Float.toString(Float.intBitsToFloat(bits)) printed by Java 21.0.13
// (eclipse-temurin:21-jdk): the reported values, edges, every ninth power of two, and 30 exact
// ties that Java rounds to an even digit. The same code matched 52,983 patterns from that JDK.
const JAVA_21_FLOATS = `
43053400 133.20312 40034000 2.0507812 39800000 2.4414062E-4 4a000001 2097152.2 0f800000 1.2621775E-29
6b000000 1.5474251E26 6c800000 1.2379401E27 c270e800 -60.226562 3e020000 0.12695312 45fb0e40 8033.7812
00000001 1.4E-45 00000002 2.8E-45 007fffff 1.1754942E-38 00800000 1.1754944E-38 7f7fffff 3.4028235E38
3f800000 1.0 3dcccccd 0.1 4b189680 1.0E7 4b18967f 9999999.0 3a83126f 0.001 3a83126e 9.999999E-4
7f000000 1.7014118E38 00400000 5.877472E-39 05000000 6.018531E-36 09800000 3.081488E-33
0e000000 1.5777218E-30 12800000 8.077936E-28 17000000 4.135903E-25 1b800000 2.1175824E-22
20000000 1.0842022E-19 24800000 5.551115E-17 29000000 2.842171E-14 2d800000 1.4551915E-11
32000000 7.450581E-9 36800000 3.8146973E-6 3b000000 0.001953125 44000000 512.0 48800000 262144.0
4d000000 1.3421773E8 51800000 6.871948E10 56000000 3.5184372E13 5a800000 1.8014399E16
5f000000 9.223372E18 63800000 4.7223665E21 68000000 2.4178516E24 71000000 6.338253E29
75800000 3.2451855E32 7a000000 1.661535E35 7e800000 8.507059E37 40fb2000 7.8476562
40c0a000 6.0195312 40eca000 7.3945312 3f928000 1.1445312 40594000 3.3945312 40064000 2.0976562
40ed2000 7.4101562 40f42000 7.6289062 3f9e8000 1.2382812 4083a000 4.1132812 403c4000 2.9414062
4082a000 4.0820312 3fde8000 1.7382812 3fcc8000 1.5976562 40a7a000 5.2382812 40cb2000 6.3476562
40d92000 6.7851562 3efd0000 0.49414062 40584000 3.3789062 404e4000 3.2226562 3e620000 0.22070312
4095a000 4.6757812 40b0a000 5.5195312 40872000 4.2226562 3fee8000 1.8632812 409a2000 4.8164062
40f52000 7.6601562 406f4000 3.7382812 3fb28000 1.3945312 3ef90000 0.48632812`

test('formats floats like Float.toString: ties to even, shorter decimals above powers of two', () => {
  const words = JAVA_21_FLOATS.trim().split(/\s+/)
  assert.equal(words.length, 79 * 2)
  const view = new DataView(new ArrayBuffer(4))
  for (let i = 0; i < words.length; i += 2) {
    view.setUint32(0, parseInt(words[i], 16))
    assert.equal(formatJavaNumber(view.getFloat32(0), true), words[i + 1], words[i])
  }
  // The same digits reach javap's text and the Outline.
  view.setUint32(0, 0x3e020000)
  assert.equal(javaFloat(view.getFloat32(0)), '0.12695312F')
})

// Review 1, finding 13: a Code attribute that cannot be read leaves the class readable.
test('finds a damaged Code attribute though the class reads to its end', () => {
  const w = helloClass('demo/Broken')
  // code_length says 1000, but the attribute holds one byte of code.
  const code = [0, 1, 0, 1, ...[0, 0, 3, 232], 0xac, 0, 0, 0, 0]
  w.method({ access: 1, name: 'answer', descriptor: '()I', attributes: [{ name: 'Code', body: code }] })
  const cls = parseClass(w.toBytes())
  assert.equal(cls.error, undefined)
  const damaged = damagedAttributes(cls)
  assert.equal(damaged.length, 1)
  assert.equal(damaged[0].attribute.name, 'Code')
  assert.deepEqual(damaged[0].owner, { kind: 'method', index: 1 })
  assert.equal(damaged[0].attribute.errorCode, 'truncated')
  assert.equal(damagedAttributes(parseClass(helloClass().toBytes())).length, 0)
})

test('decodes modified UTF-8 with encoded NUL and surrogate pairs', () => {
  const text = 'a\u0000é€😀'
  const bytes = encodeModifiedUtf8(text)
  assert.deepEqual(Array.from(bytes.subarray(1, 3)), [0xc0, 0x80])
  assert.equal(bytes.length, 1 + 2 + 2 + 3 + 6)
  assert.deepEqual(decodeModifiedUtf8(bytes), { text, damaged: false })
  const bad = decodeModifiedUtf8(Uint8Array.of(0x41, 0xff, 0x42))
  assert.equal(bad.text, 'A�B')
  assert.equal(bad.damaged, true)
})

test('names flags the way javap and Java do', () => {
  assert.equal(flagSummary(0x0021, 'class'), '(0x0021) ACC_PUBLIC, ACC_SUPER')
  assert.deepEqual(flagNames(0x0009, 'method'), ['ACC_PUBLIC', 'ACC_STATIC'])
  assert.deepEqual(flagNames(0x0041 | 0x1000, 'method'), ['ACC_PUBLIC', 'ACC_BRIDGE', 'ACC_SYNTHETIC'])
  assert.deepEqual(flagNames(0x0040, 'field'), ['ACC_VOLATILE'])
  assert.deepEqual(flagNames(0x0100, 'field'), ['0x0100'])
  assert.deepEqual(javaModifiers(0x0019, 'field'), ['public', 'static', 'final'])
  assert.deepEqual(javaModifiers(0x0031, 'class'), ['public', 'final'])
  assert.deepEqual(javaModifiers(0x4031, 'class'), ['public'])
  assert.deepEqual(javaModifiers(0x0601, 'class'), ['public'])
  assert.deepEqual(javaModifiers(0x0021 | 0x0100, 'method'), ['public', 'synchronized', 'native'])
})

test('a damaged attribute is kept raw with its error, and the class still reads', () => {
  const w = helloClass('demo/Odd')
  w.attribute({ name: 'InnerClasses', body: [0, 5, 0, 1] }) // says 5 entries, holds 2 bytes
  w.attribute({ name: 'com.example.Custom', body: [1, 2, 3] })
  w.attribute(w.utf8Attr('SourceFile', 'Odd.java'))
  const cls = parseClass(w.toBytes())
  assert.equal(cls.error, undefined)
  const [inner, custom, source] = cls.attributes
  assert.equal(inner.value.kind, 'Raw')
  assert.match(inner.error ?? '', /ends inside/)
  assert.equal(custom.value.kind, 'Raw')
  assert.deepEqual(Array.from(custom.bytes), [1, 2, 3])
  assert.equal(source.value.kind, 'SourceFile')
})

test('reads trailing bytes and peeks at the version', () => {
  const bytes = helloClass().toBytes()
  const padded = new Uint8Array(bytes.length + 3)
  padded.set(bytes)
  assert.equal(parseClass(padded).trailing, 3)
  assert.deepEqual(peekVersion(bytes), { major: 61, minor: 0 })
  assert.equal(peekVersion(Uint8Array.of(1, 2, 3)), undefined)
})

test('reads stack map frames, line numbers and local variables', () => {
  const w = new ClassWriter({ name: 'demo/Frames' })
  const obj = w.pool.cls('java/lang/String')
  const stackMap = [
    ...u2(4),
    3, // same, offset 3
    64 + 2, 1, // same_locals_1_stack_item, offset 3+2+1 = 6, Integer
    252, ...u2(1), 7, ...u2(obj), // append 1 local, offset 6+1+1 = 8
    255, ...u2(0), ...u2(2), 1, 4, ...u2(1), 8, ...u2(0) // full frame at 9
  ]
  const lines = [...u2(2), ...u2(0), ...u2(10), ...u2(4), ...u2(11)]
  const lvt = [...u2(1), ...u2(0), ...u2(10), ...u2(w.pool.utf8('count')), ...u2(w.pool.utf8('I')), ...u2(1)]
  w.method({
    access: 9,
    name: 'f',
    descriptor: '(I)V',
    attributes: [
      w.code({
        code: asm('iload_0', 'pop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'nop', 'return'),
        attributes: [
          { name: 'StackMapTable', body: stackMap },
          { name: 'LineNumberTable', body: lines },
          { name: 'LocalVariableTable', body: lvt }
        ]
      })
    ]
  })
  const cls = parseClass(w.toBytes())
  const code = findAttribute(cls.methods[0].attributes, 'Code')!.value.code
  const frames = findAttribute(code.attributes, 'StackMapTable')!.value.frames
  assert.deepEqual(
    frames.map((f) => [f.offset, f.kind]),
    [
      [3, 'same'],
      [6, 'same_locals_1_stack_item'],
      [8, 'append'],
      [9, 'full']
    ]
  )
  assert.deepEqual(frames[2].locals, [{ tag: 7, index: obj }])
  assert.deepEqual(frames[3].stack, [{ tag: 8, offset: 0 }])
  assert.deepEqual(findAttribute(code.attributes, 'LineNumberTable')!.value.lines, [
    { start: 0, line: 10 },
    { start: 4, line: 11 }
  ])
  const vars = findAttribute(code.attributes, 'LocalVariableTable')!.value.variables
  assert.equal(cls.pool.str(vars[0].nameIndex), 'count')
})
