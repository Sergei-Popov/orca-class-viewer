import { assert, test } from 'orca/testing'
import { binaryName, displayName, hasHiddenCharacters, javaChar, javaString, simpleName, stringText } from './names'
import { MAX_TYPE_NESTING, Namer, SignatureError, parameterSlots, parseClassSignature, parseFieldType, parseMethodType, takeLinks } from './types'

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
  assert.equal(displayName('\u0000'), '\\u0000')
  assert.equal(displayName(''), '""')
  assert.equal(displayName('Ωmega_ок'), 'Ωmega_ок')
  assert.equal(hasHiddenCharacters('plain'), false)
  assert.equal(hasHiddenCharacters('a\u2066b'), true)
  assert.equal(binaryName('java/util/Map$Entry'), 'java.util.Map$Entry')
  assert.equal(simpleName('java/util/Map$Entry'), 'Map$Entry')
})

// Review 1, findings 2, 3 and 16: a space is not hidden, and the usual controls read as \t, \n.
test('keeps spaces inside names and writes tabs and newlines as \\t and \\n', () => {
  assert.equal(displayName('adding an item increases the total'), 'adding an item increases the total')
  assert.equal(hasHiddenCharacters('adding an item increases the total'), false)
  assert.equal(displayName('Order History.jsp'), 'Order History.jsp')
  assert.equal(displayName('a\tb\nc'), 'a\\tb\\nc')
  // At either end a space would make two names look alike, so it is escaped there.
  assert.equal(displayName(' Main '), '\\u0020Main\\u0020')
  assert.equal(hasHiddenCharacters('Main '), true)
  // Other blanks are look-alikes and stay escaped.
  assert.equal(displayName('a\u00a0b'), 'a\\u00a0b')
  assert.equal(displayName('a\u3000b'), 'a\\u3000b')
})

// Review 1, findings 2 and 3: string data reads as javap prints it.
test('writes string data like javap: spaces kept, controls as backslash escapes', () => {
  assert.equal(stringText('Illegal null or empty Level name.'), 'Illegal null or empty Level name.')
  assert.equal(stringText('<Map>\n'), '<Map>\\n')
  assert.equal(stringText('a\tb\r\f\b'), 'a\\tb\\r\\f\\b')
  assert.equal(stringText('C:\\temp "quoted" it\'s'), String.raw`C:\\temp \"quoted\" it\'s`)
  assert.equal(stringText('zero\u200bwidth \u202eflip'), 'zero\\u200bwidth \\u202eflip')
  assert.equal(stringText('line\u2028sep'), 'line\\u2028sep')
  assert.equal(stringText('Omega \u03a9 \u{1f600}'), 'Omega \u03a9 \u{1f600}')
})

// Review 1, finding 20: noncharacters and unassigned code points do not show, so they are escaped.
test('escapes noncharacters and unassigned code points in literals and names', () => {
  assert.equal(javaChar(0xffff), "'\\uffff'")
  assert.equal(javaChar(0xfffe), "'\\ufffe'")
  assert.equal(javaChar(0xfdd0), "'\\ufdd0'")
  assert.equal(javaChar(0x0378), "'\\u0378'")
  assert.equal(javaChar(0xd800), "'\\ud800'")
  assert.equal(javaChar(32), "' '")
  assert.equal(javaString(`a${String.fromCharCode(0xffff)}b`), '"a\\uffffb"')
  assert.equal(javaString('two words'), '"two words"')
  assert.equal(stringText(String.fromCharCode(0xfdef)), '\\ufdef')
  assert.equal(displayName(`x${String.fromCharCode(0xffff)}`), 'x\\uffff')
  // The private-use characters the outline uses as link markers never reach the text raw.
  assert.equal(displayName(String.fromCharCode(0xe000)), '\\ue000')
  assert.equal(javaString(String.fromCharCode(0xe001)), '"\\ue001"')
  assert.equal(stringText(String.fromCharCode(0xe002)), '\\ue002')
})

// Review 1, finding 14: a signature nested thousands deep would overflow the printers.
test('caps generic nesting so a deep signature falls back to the descriptor', () => {
  const deep = (d: number) => `${'Ljava/util/List<'.repeat(d)}Ljava/lang/String;${'>;'.repeat(d)}`
  assert.equal(new Namer().type(parseFieldType(deep(MAX_TYPE_NESTING))).startsWith('List<List<'), true)
  for (const d of [MAX_TYPE_NESTING + 1, 3000]) {
    assert.throws(() => parseFieldType(deep(d)), (e) => e instanceof SignatureError)
    assert.throws(() => parseMethodType(`(${deep(d)})V`), (e) => e instanceof SignatureError)
    assert.throws(() => parseClassSignature(`Ljava/lang/Object;${deep(d)}`), (e) => e instanceof SignatureError)
  }
})

// Review 1, finding 6: a namer made with links marks every class name it prints.
test('marks class names for links and takes the marks out again', () => {
  const n = new Namer({ links: true })
  const text = n.type(parseFieldType('Ljava/util/Map<Ljava/lang/String;Ldemo/Body;>;'))
  const taken = takeLinks(`private ${text} bodies;`, n.linkTargets)
  assert.equal(taken.text, 'private Map<String, Body> bodies;')
  assert.deepEqual(
    taken.links.map((l) => [taken.text.slice(l.from, l.to), l.name]),
    [
      ['Map', 'java/util/Map'],
      ['String', 'java/lang/String'],
      ['Body', 'demo/Body']
    ]
  )
  // A namer without links prints plain names.
  assert.equal(new Namer().name('demo/Body'), 'Body')
})

test('writes Java string and char literals', () => {
  assert.equal(javaString('a"b\\c\n\u0001'), '"a\\"b\\\\c\\n\\u0001"')
  assert.equal(javaString("it's"), '"it\'s"')
  assert.equal(javaChar(65), "'A'")
  assert.equal(javaChar(39), "'\\''")
  assert.equal(javaChar(0), "'\\u0000'")
})
