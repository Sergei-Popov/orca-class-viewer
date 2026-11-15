import { assert, test } from 'orca/testing'
import { binaryName, displayName, hasHiddenCharacters, javaChar, javaString, simpleName } from './names'
import { Namer, SignatureError, parameterSlots, parseClassSignature, parseFieldType, parseMethodType } from './types'

const namer = () => new Namer()

test('prints descriptors as Java types', () => {
  const n = namer()
  assert.equal(n.type(parseFieldType('I')), 'int')
  assert.equal(n.type(parseFieldType('[[J')), 'long[][]')
  assert.equal(n.type(parseFieldType('Ljava/lang/String;')), 'String')
  const m = parseMethodType('(I[Ljava/util/List;DZ)Ljava/lang/Object;')
  assert.deepEqual(m.params.map((t) => n.type(t)), ['int', 'List[]', 'double', 'boolean'])
  assert.equal(n.type(m.ret), 'Object')
  assert.equal(parameterSlots(m.params), 5)
  assert.equal(n.type(parseMethodType('()V').ret), 'void')
})

test('prints generic signatures with bounds and wildcards', () => {
  const n = namer()
  const m = parseMethodType('<T:Ljava/lang/Object;R::Ljava/lang/Comparable<-TR;>;>(Ljava/util/Map<TT;+TR;>;[TT;)Ljava/util/List<*>;^Ljava/io/IOException;^TX;')
  assert.equal(n.typeParams(m.typeParams), '<T, R extends Comparable<? super R>>')
  assert.deepEqual(m.params.map((t) => n.type(t)), ['Map<T, ? extends R>', 'T[]'])
  assert.equal(n.type(m.ret), 'List<?>')
  assert.deepEqual(m.throws.map((t) => n.type(t)), ['IOException', 'X'])
  const c = parseClassSignature('<T::Ldemo/Body;:Ljava/lang/Comparable<-TT;>;>Ljava/lang/Object;Ljava/lang/Iterable<TT;>;')
  assert.equal(n.typeParams(c.typeParams), '<T extends Body & Comparable<? super T>>')
  assert.equal(n.type(c.superclass), 'Object')
  assert.deepEqual(c.interfaces.map((t) => n.type(t)), ['Iterable<T>'])
})

test('prints inner class types of signatures and of InnerClasses', () => {
  const inner = new Map([['java/util/Map$Entry', { outer: 'java/util/Map', simple: 'Entry' }]])
  const n = new Namer({ inner })
  assert.equal(n.type(parseFieldType('Ljava/util/Map$Entry;')), 'Map.Entry')
  assert.equal(n.type(parseFieldType('Ldemo/Outer<TT;>.Inner<Ljava/lang/String;>;')), 'Outer<T>.Inner<String>')
  assert.deepEqual([...n.used].sort(), ['demo/Outer', 'java/lang/String', 'java/util/Map'])
  const scoped = new Namer({ inner, inScope: (outer) => outer === 'java/util/Map' })
  assert.equal(scoped.name('java/util/Map$Entry'), 'Entry')
})

test('qualifies a simple name that two classes share', () => {
  const n = namer()
  assert.equal(n.name('java/util/List'), 'List')
  assert.equal(n.name('java/awt/List'), 'java.awt.List')
  assert.equal(n.name('java/util/List'), 'List')
  assert.equal(new Namer({ qualified: true }).name('java/util/List'), 'java.util.List')
})

test('rejects malformed descriptors', () => {
  for (const bad of ['', 'Q', 'Ljava/lang/String', '[', '(I', '(I)', 'V', 'TT', '<T>V', `${'['.repeat(256)}I`]) {
    assert.throws(() => (bad.startsWith('(') || bad.startsWith('<') ? parseMethodType(bad) : parseFieldType(bad)), (e) => e instanceof SignatureError)
  }
  assert.equal(parseFieldType(`${'['.repeat(255)}I`).kind, 'array')
})

test('escapes hidden characters in obfuscated names', () => {
  assert.equal(displayName('a\u200bb'), 'a\\u200bb')
  assert.equal(displayName('\u202ename'), '\\u202ename')
  assert.equal(displayName('with space'), 'with\\u0020space')
  assert.equal(displayName('\u0000'), '\\u0000')
  assert.equal(displayName(''), '""')
  assert.equal(displayName('Ωmega_ок'), 'Ωmega_ок')
  assert.equal(hasHiddenCharacters('plain'), false)
  assert.equal(hasHiddenCharacters('a\u2066b'), true)
  assert.equal(binaryName('java/util/Map$Entry'), 'java.util.Map$Entry')
  assert.equal(simpleName('java/util/Map$Entry'), 'Map$Entry')
})

test('writes Java string and char literals', () => {
  assert.equal(javaString('a"b\\c\n\u0001'), '"a\\"b\\\\c\\n\\u0001"')
  assert.equal(javaString("it's"), '"it\'s"')
  assert.equal(javaChar(65), "'A'")
  assert.equal(javaChar(39), "'\\''")
  assert.equal(javaChar(0), "'\\u0000'")
})
