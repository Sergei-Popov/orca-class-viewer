import { assert, test } from 'orca/testing'
import { type ClassFile, parseClass } from '../classfile/classfile'
import { stringsFor } from '../i18n'
import { ClassWriter, asm, u2 } from '../testing/classwriter'
import { ClassView } from './classview'
import type { ViewLine } from './codeview'
import { type Env, fill, shortcuts } from './env'

/** The Outline's lines as the Outline tab gets them, without a document. */
function outlineLines(cls: ClassFile): ViewLine[] {
  const env: Env = { t: stringsFor('en'), locale: 'en', toast: () => undefined }
  const view = ClassView.prototype as unknown as { outlineLines(this: unknown, cls: ClassFile): ViewLine[] }
  return view.outlineLines.call({ env, ctx: {} }, cls)
}

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
