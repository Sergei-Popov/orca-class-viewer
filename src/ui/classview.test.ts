import { assert, test } from 'orca/testing'
import { MAX_LISTED_ROWS } from '../bytecode/listing'
import { MAX_STRUCTURE_ROWS } from '../classfile/budget'
import { type ClassFile, parseClass } from '../classfile/classfile'
import { detectLanguage } from '../classfile/language'
import { buildOutline } from '../classfile/outline'
import { poolUsage } from '../classfile/usage'
import { stringsFor } from '../i18n'
import { ClassWriter, asm, helloClass, u2 } from '../testing/classwriter'
import { type FakeElement, withFakeDom } from '../testing/dom'
import { ClassView, hasObfuscatedNames } from './classview'
import type { ViewLine } from './codeview'
import { type Env, fill, shortcuts } from './env'
import { buildStructure } from './structure'

const env: Env = { t: stringsFor('en'), locale: 'en', toast: () => undefined }

/** A tab's lines as ClassView makes them, without a document, and the titles of the notices it shows. */
function tabLines(cls: ClassFile, tab: 'outlineLines' | 'listingLines'): { lines: ViewLine[]; notices: string[] } {
  const notices: string[] = []
  const view = ClassView.prototype as unknown as Record<typeof tab, (this: unknown, cls: ClassFile) => ViewLine[]>
  const notice = (_tone: string, _icon: string, title: string) => notices.push(title)
  return { lines: view[tab].call({ env, ctx: {}, notice }, cls), notices }
}

/** The Outline's lines as the Outline tab gets them. */
const outlineLines = (cls: ClassFile): ViewLine[] => tabLines(cls, 'outlineLines').lines

/** Per line, the text that links to a method's bytecode, and the method. */
function methodLinks(lines: ViewLine[]): [string, string, number][] {
  const out: [string, string, number][] = []
  for (const line of lines) {
    const spans = line.spans.filter((s) => s.link?.kind === 'method')
    if (!spans.length) continue
    const link = spans[0].link
    out.push([line.text.trim(), spans.map((s) => s.text).join(''), link?.kind === 'method' ? link.index : -1])
  }
  return out
}

// Review 2, findings 9 and 12: the link sat on an annotation's name, and covered only the last
// word of a name with spaces (Kotlin's backtick names).
test('links a method’s whole name on its declaration line only', () => {
  const w = new ClassWriter({ name: 'demo/Odd' })
  const code = () => w.code({ code: asm('return') })
  w.method({ access: 1, name: '<init>', descriptor: '()V', attributes: [code()] })
  w.method({ access: 0x11, name: 'adding an item increases the total', descriptor: '()V', attributes: [code()] })
  w.method({ access: 0x11, name: 'returns 404 - not found', descriptor: '()V', attributes: [code()] })
  w.method({ access: 1, name: 'isOk?', descriptor: '()V', attributes: [code()] })
  // @GetMapping("/users") public void users()
  const mapping = [...u2(1), ...u2(w.pool.utf8('Lorg/springframework/web/bind/annotation/GetMapping;')), ...u2(1), ...u2(w.pool.utf8('value')), 0x73, ...u2(w.pool.utf8('/users'))]
  w.method({ access: 1, name: 'users', descriptor: '()V', attributes: [{ name: 'RuntimeVisibleAnnotations', body: mapping }, code()] })
  // A generic return type puts link marks before the name.
  const signature = w.indexAttr('Signature', w.pool.utf8('()Ljava/util/Map<Ljava/lang/String;Ldemo/Body;>;'))
  w.method({ access: 1, name: 'bodies', descriptor: '()Ljava/util/Map;', attributes: [signature, w.code({ code: asm('aconst_null', 'areturn') })] })
  w.method({ access: 0x100a, name: 'lambda$main$0', descriptor: '()V', attributes: [code()] })
  w.method({ access: 8, name: '<clinit>', descriptor: '()V', attributes: [code()] })
  const lines = outlineLines(parseClass(w.toBytes()))
  assert.deepEqual(methodLinks(lines), [
    ['public Odd() { /* compiled code */ }', 'Odd', 0],
    ['public final void adding an item increases the total() { /* compiled code */ }', 'adding an item increases the total', 1],
    ['public final void returns 404 - not found() { /* compiled code */ }', 'returns 404 - not found', 2],
    ['public void isOk?() { /* compiled code */ }', 'isOk?', 3],
    ['public void users() { /* compiled code */ }', 'users', 4],
    ['public Map<String, Body> bodies() { /* compiled code */ }', 'bodies', 5],
    ['// synthetic: private static void lambda$main$0()', 'lambda$main$0', 6],
    ['static { /* compiled code */ }', 'static', 7]
  ])
  // The annotation line is there, without a link.
  assert.ok(lines.some((l) => l.text.trim() === '@GetMapping("/users")' && !l.spans.some((s) => s.link)))
})

// Review 2, finding 16: the hints named ⌘F on Windows and Linux too, where the key is Ctrl+F.
test('names the find keys as the platform writes them', () => {
  assert.deepEqual(shortcuts('MacIntel'), { find: '⌘F', back: '⇧Enter' })
  assert.deepEqual(shortcuts('macOS'), { find: '⌘F', back: '⇧Enter' })
  for (const p of ['Win32', 'Windows', 'Linux x86_64', '']) assert.deepEqual(shortcuts(p), { find: 'Ctrl+F', back: 'Shift+Enter' }, p)
  const en = stringsFor('en')
  const ru = stringsFor('ru')
  assert.equal(fill(en.findHint, shortcuts('Win32')), 'Find (Ctrl+F); Enter for the next match')
  assert.equal(fill(en.treeFilterHint, shortcuts('MacIntel')), 'Filter classes and files by name (⌘F)')
  assert.equal(fill(en.prevMatch, shortcuts('Linux x86_64')), 'Previous match (Shift+Enter)')
  assert.equal(fill(ru.findHint, shortcuts('Win32')), 'Найти (Ctrl+F); Enter — следующее совпадение')
  assert.equal(fill(ru.treeFilterHint, shortcuts('Win32')), 'Фильтр классов и файлов по имени (Ctrl+F)')
  // No string names a Mac key itself.
  for (const t of [en, ru]) for (const v of Object.values(t)) if (typeof v === 'string') assert.ok(!/[⌘⇧⌥]/.test(v), v)
})

/** `methods` methods, each with one RuntimeVisibleAnnotations of 65,535 annotations of 4 bytes and no elements. */
function annotationFlood(methods: number): ClassFile {
  const w = new ClassWriter({ name: 'demo/Ann' })
  const type = w.pool.utf8('Ljava/lang/Deprecated;')
  const body = new Uint8Array(2 + 65535 * 4)
  body[0] = 0xff
  body[1] = 0xff
  for (let i = 0; i < 65535; i++) {
    body[2 + i * 4] = type >> 8
    body[3 + i * 4] = type & 0xff
  }
  for (let k = 0; k < methods; k++) w.method({ access: 9, name: `m${k}`, descriptor: '()V', attributes: [{ name: 'RuntimeVisibleAnnotations', body }, w.code({ code: asm('return') })] })
  return parseClass(w.toBytes())
}

// Review 2, round 2, the major: 95 methods of 65,535 annotations (24 MB, 26 KB deflated) ran the
// frame out of memory, as the row budget counted only code and tables, and the Outline had none.
test('keeps every tab within its rows for a class of six million annotations', () => {
  const cls = annotationFlood(95)
  const typeIndex = (() => {
    const v = cls.methods[0].attributes[0].value
    return v.kind === 'Annotations' ? v.annotations[0].typeIndex : -1
  })()

  // Bytecode: each method takes 3 rows of code, 1 of the attribute's name and 65,535 of annotations.
  // 15 methods fit whole; the 16th lists 16,911 annotations; the rest keep their first lines.
  const bytecode = tabLines(cls, 'listingLines')
  assert.deepEqual(bytecode.notices, ['The listing is cut'])
  assert.ok(bytecode.lines.length < MAX_LISTED_ROWS + 1000, `${bytecode.lines.length} lines`)
  const texts = bytecode.lines.map((l) => l.text)
  assert.equal(texts.filter((t) => t === '    @java.lang.Deprecated').length, 15 * 65535 + 16911)
  assert.deepEqual(
    texts.filter((t) => t.includes('the listing is full')).slice(0, 3),
    ['    … 48,624 more not listed: the listing is full', '  Code: not listed (1 byte): the listing is full', '  Attributes not listed (1): the listing is full']
  )
  assert.equal(texts.filter((t) => t === '  Attributes not listed (1): the listing is full').length, 79)
  for (let k = 0; k < 95; k++) assert.ok(bytecode.lines.some((l) => l.anchor === `m${k}`), `m${k}`)

  // Outline: 100 annotations a member, then a count of the rest.
  const outline = tabLines(cls, 'outlineLines')
  assert.deepEqual(outline.notices, [])
  assert.ok(outline.lines.length < 95 * 110, `${outline.lines.length} lines`)
  assert.equal(outline.lines.filter((l) => l.text.trim() === '// 65435 more annotations').length, 95)

  // Constant pool: one use of the type's name per attribute, not 65,535; and, as the Bytecode tab
  // leaves out the code of methods 16 to 94, their code is not searched either.
  const usage = poolUsage(cls)
  assert.equal(usage[typeIndex].sites.length, 95)
  assert.equal(usage.codeCut, true)

  // Structure: a member's attributes, built on a click, stop at their own budget and say so.
  withFakeDom(() => {
    let cuts = 0
    const doc = buildStructure(cls, detectLanguage(cls), env, { showPool: () => undefined, showMethod: () => undefined, cut: () => cuts++ }) as unknown as FakeElement
    assert.equal(cuts, 0)
    const button = doc.findAll((el) => el.getAttribute('aria-expanded') !== null)[0]
    button.click()
    const shown = doc.findAll((el) => el.className === 'cv-attr-row')[0].textContent
    assert.equal(cuts, 1)
    assert.equal(shown.split('@java.lang.Deprecated').length - 1, MAX_STRUCTURE_ROWS - 1)
    assert.ok(shown.includes(`… ${(65535 - MAX_STRUCTURE_ROWS + 1).toLocaleString('en')} more not shown: the tab is full`), shown.slice(-300))
  })
})

/**
 * `methods` static methods of 255 int parameters, each parameter with 257 annotations @A, whose
 * code has a LocalVariableTable of 65,535 variables that name no parameter (they start at 1);
 * with `signature`, a Signature of one parameter, which sends the declaration to that table.
 */
function parameterFlood(methods: number, signature: boolean): ClassFile {
  const w = new ClassWriter({ name: 'demo/Params' })
  const type = w.pool.utf8('LA;')
  const annotations = new Uint8Array(1 + 255 * (2 + 257 * 4))
  annotations[0] = 255
  for (let p = 0, at = 1; p < 255; p++) {
    annotations.set(u2(257), at)
    at += 2
    for (let a = 0; a < 257; a++, at += 4) annotations.set(u2(type), at)
  }
  const [x, int] = [w.pool.utf8('x'), w.pool.utf8('I')]
  const vars = new Uint8Array(2 + 65535 * 10)
  vars.set(u2(65535))
  for (let i = 0; i < 65535; i++) vars.set([...u2(1), ...u2(0), ...u2(x), ...u2(int), ...u2(i % 255)], 2 + i * 10)
  const sig = signature ? [w.indexAttr('Signature', w.pool.utf8('(I)V'))] : []
  const descriptor = `(${'I'.repeat(255)})V`
  const code = w.code({ code: asm('return'), attributes: [{ name: 'LocalVariableTable', body: vars }] })
  for (let k = 0; k < methods; k++) w.method({ access: 9, name: `m${k}`, descriptor, attributes: [{ name: 'RuntimeVisibleParameterAnnotations', body: annotations }, ...sig, code] })
  return parseClass(w.toBytes())
}

// Review 2, round 3: 185 methods of 255 parameters with 257 annotations each took 5 to 8 s and
// 2 to 3.5 GB on the Outline and Bytecode tabs, and a 65,535-variable LocalVariableTable was
// scanned once per parameter, twice for a Signature (more than 5 s for 70 methods).
test('writes 100 parameter annotations a member and reads the LocalVariableTable once a method', () => {
  for (const signature of [false, true]) {
    const cls = parameterFlood(20, signature)
    let started = Date.now()
    const outline = tabLines(cls, 'outlineLines')
    const outlineTook = Date.now() - started
    started = Date.now()
    const bytecode = tabLines(cls, 'listingLines')
    const bytecodeTook = Date.now() - started
    assert.ok(outlineTook < 500, `Outline: ${outlineTook} ms`)
    // Most of it is a million rows of the tables.
    assert.ok(bytecodeTook < 3000, `Bytecode: ${bytecodeTook} ms`)
    // 20 tables of 65,535 variables are past the Bytecode tab's million rows.
    assert.deepEqual([outline.notices, bytecode.notices], [[], ['The listing is cut']])
    const declaration = outline.lines.map((l) => l.text).find((t) => t.includes(' m0(')) ?? ''
    assert.equal(declaration.split('@A').length - 1, 100)
    if (signature) {
      // The Signature's one parameter is the first: 100 of its annotations, and a count of the rest.
      assert.match(declaration, /@A … \/\* \+157 \*\/ int arg0\) \{/)
    } else {
      assert.ok(declaration.includes('@A … /* +157 */ int arg0, … /* +257 */ int arg1, … /* +257 */ int arg2,'), declaration.slice(0, 200))
      assert.ok(declaration.endsWith('… /* +257 */ int arg254) { /* compiled code */ }'), declaration.slice(-200))
    }
    const texts = bytecode.lines.map((l) => l.text)
    assert.equal(texts.find((t) => t.startsWith('    parameter 0: '))?.split('@A').length, 101)
    assert.ok(texts.includes('    parameter 1: … /* +257 */'))
  }
})

// Review 2, round 3: one annotation's text stopped at 10,000 characters with a bare "…", which
// shortened two real kotlin-stdlib @Metadata lines without a word.
test('counts the values an annotation too long to write leaves out', () => {
  const w = new ClassWriter({ name: 'demo/Long' })
  const one = w.pool.int(1)
  const values = new Array(65535).fill(0).flatMap(() => [0x49, ...u2(one)])
  w.attribute({ name: 'RuntimeVisibleAnnotations', body: [...u2(1), ...u2(w.pool.utf8('LB;')), ...u2(1), ...u2(w.pool.utf8('value')), 0x5b, ...u2(65535), ...values] })
  const line = buildOutline(parseClass(w.toBytes())).lines.map((l) => l.text).find((t) => t.startsWith('@B(')) ?? ''
  const more = /, … \/\* \+(\d+) \*\/\}\)$/.exec(line)
  assert.ok(more, line.slice(-100))
  const shown = line.match(/\b1\b/g)?.length ?? 0
  assert.ok(shown > 3000 && line.length < 10_100, `${shown} values, ${line.length} characters`)
  assert.equal(shown + Number(more?.[1]), 65535)
})

// Review 2, round 3: past the declarations' rows a method's first line was its name and
// descriptor alone, without a notice; and the declarations could take as many rows as the rest.
test('says when a method’s declaration is left out of the listing', () => {
  const w = new ClassWriter({ name: 'demo/Names' })
  // 200 methods named with 65,535 characters: about 560 rows each, past a tenth of the budget.
  for (let k = 0; k < 200; k++) w.method({ access: 0x401, name: 'n'.repeat(65535), descriptor: `(${'I'.repeat(k)})V` })
  const cls = parseClass(w.toBytes())
  const { lines, notices } = tabLines(cls, 'listingLines')
  assert.deepEqual(notices, ['The listing is cut'])
  const short = lines.filter((l) => l.text.endsWith('  // declaration not listed: the listing is full'))
  const full = lines.filter((l) => l.text.startsWith('public abstract void nnn'))
  assert.equal(short.length + full.length, 200)
  assert.ok(full.length > 100 && short.length > 0, `${full.length} full, ${short.length} short`)
  for (let k = 0; k < 200; k++) assert.ok(lines.some((l) => l.anchor === `m${k}`), `m${k}`)
  // The declarations stay within a tenth of the rows.
  const chars = full.reduce((n, l) => n + l.text.length, 0)
  assert.ok(chars <= (MAX_LISTED_ROWS / 10) * 120 + 70_000, `${chars} characters`)
})

// The Outline's own budget: past it, writing stops with a comment and the braces still close.
test('stops the outline at its row limit and closes what it opened', () => {
  const w = new ClassWriter({ name: 'demo/Wide' })
  for (let k = 0; k < 50; k++) w.field({ access: 1, name: `f${k}`, descriptor: 'I' })
  const cls = parseClass(w.toBytes())
  const outline = buildOutline(cls, { comments: env.t.comments, limit: 20 })
  assert.equal(outline.cut, true)
  const lines = outline.lines.map((l) => l.text)
  // The class line and 19 fields take the 20 rows; the header above the class takes none.
  assert.equal(lines.filter((l) => /^ {4}public int f\d+;$/.test(l)).length, 19)
  assert.ok(lines.includes('    // The rest is not shown: the outline is full.'), lines.join('\n'))
  assert.equal(lines[lines.length - 1], '}')
  assert.equal(buildOutline(cls, { comments: env.t.comments }).cut, false)
})

// Review 2, round 2, minor 5: an attribute or a record component named with hidden characters
// got no notice.
test('gives the hidden-character notice for attribute and record component names too', () => {
  const zwsp = String.fromCharCode(0x200b)
  const plain = new ClassWriter({ name: 'demo/Plain' })
  assert.equal(hasObfuscatedNames(parseClass(plain.toBytes())), false)

  const attribute = new ClassWriter({ name: 'demo/Plain' })
  attribute.method({ access: 9, name: 'm', descriptor: '()V', attributes: [attribute.code({ code: asm('return'), attributes: [{ name: `Line${zwsp}NumberTable`, body: [] }] })] })
  assert.equal(hasObfuscatedNames(parseClass(attribute.toBytes())), true)

  const record = new ClassWriter({ name: 'demo/Point', superName: 'java/lang/Record' })
  const component = [...u2(1), ...u2(record.pool.utf8(`x${zwsp}`)), ...u2(record.pool.utf8('I')), ...u2(0)]
  record.attribute({ name: 'Record', body: component })
  assert.equal(hasObfuscatedNames(parseClass(record.toBytes())), true)
})
