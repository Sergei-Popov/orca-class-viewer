import { assert, test } from 'orca/testing'
import { type Attr, ClassWriter, anonymousName, asm, u2 } from '../testing/classwriter'
import { parseClass } from './classfile'
import { classKind } from './declarations'
import { detectLanguage } from './language'
import { buildOutline } from './outline'

const body = (w: ClassWriter) => w.code({ maxStack: 1, maxLocals: 1, code: asm('return') })

/** A RuntimeVisibleAnnotations attribute with elements given as raw element_value bytes. */
function annotations(w: ClassWriter, list: { type: string; elements?: [string, number[]][] }[], visible = true): Attr {
  const out: number[] = [...u2(list.length)]
  for (const a of list) {
    out.push(...u2(w.pool.utf8(a.type)), ...u2(a.elements?.length ?? 0))
    for (const [name, value] of a.elements ?? []) out.push(...u2(w.pool.utf8(name)), ...value)
  }
  return { name: visible ? 'RuntimeVisibleAnnotations' : 'RuntimeInvisibleAnnotations', body: out }
}

const str = (w: ClassWriter, s: string) => ['s'.charCodeAt(0), ...u2(w.pool.utf8(s))]
const bool = (w: ClassWriter, b: boolean) => ['Z'.charCodeAt(0), ...u2(w.pool.int(b ? 1 : 0))]
const int = (w: ClassWriter, n: number) => ['I'.charCodeAt(0), ...u2(w.pool.int(n))]

test('outlines a generic class with annotations, constants and parameter names', () => {
  const w = new ClassWriter({ name: 'demo/sky/Catalog', interfaces: ['java/lang/Iterable'] })
  w.attribute(w.utf8Attr('SourceFile', 'Catalog.java'))
  w.attribute(w.utf8Attr('Signature', '<T:Ljava/lang/Object;:Ljava/lang/Comparable<-TT;>;>Ljava/lang/Object;Ljava/lang/Iterable<TT;>;'))
  w.attribute(annotations(w, [{ type: 'Ljava/lang/Deprecated;', elements: [['since', str(w, '2.0')], ['forRemoval', bool(w, false)]] }]))
  w.field({ access: 0x0019, name: 'LIMIT', descriptor: 'I', attributes: [w.indexAttr('ConstantValue', w.pool.int(42))] })
  w.field({ access: 0x0019, name: 'GRADE', descriptor: 'C', attributes: [w.indexAttr('ConstantValue', w.pool.int(65))] })
  w.field({ access: 0x0019, name: 'NAME', descriptor: 'Ljava/lang/String;', attributes: [w.indexAttr('ConstantValue', w.pool.string('sky'))] })
  w.field({ access: 0x0012, name: 'items', descriptor: 'Ljava/util/Map;', attributes: [w.utf8Attr('Signature', 'Ljava/util/Map<Ljava/lang/String;TT;>;')] })
  w.method({
    access: 0x0081,
    name: 'addAll',
    descriptor: '(Ljava/lang/String;[Ljava/lang/Object;)V',
    attributes: [
      body(w),
      w.utf8Attr('Signature', '(Ljava/lang/String;[TT;)V'),
      { name: 'MethodParameters', body: [2, ...u2(w.pool.utf8('group')), 0, 0x10, ...u2(w.pool.utf8('values')), 0, 0] },
      w.classListAttr('Exceptions', ['java/io/IOException'])
    ]
  })
  w.method({ access: 0x1041, name: 'bridge', descriptor: '()V', attributes: [body(w)] })
  const outline = buildOutline(parseClass(w.toBytes()))
  const text = outline.text
  assert.match(text, /^\/\/ Outline of Catalog\.class: declarations only; method bodies are compiled code\.$/m)
  assert.match(text, /^\/\/ Compiled from Catalog\.java for Java 17\.$/m)
  assert.match(text, /^package demo\.sky;$/m)
  assert.match(text, /^import java\.io\.IOException;$/m)
  assert.match(text, /^import java\.util\.Map;$/m)
  assert.ok(!/import java\.lang\./.test(text))
  assert.match(text, /^@Deprecated\(since = "2\.0", forRemoval = false\)$/m)
  assert.match(text, /^public class Catalog<T extends Comparable<\? super T>> implements Iterable<T> \{$/m)
  assert.match(text, /^ {4}public static final int LIMIT = 42;$/m)
  assert.match(text, /^ {4}public static final char GRADE = 'A';$/m)
  assert.match(text, /^ {4}public static final String NAME = "sky";$/m)
  assert.match(text, /^ {4}private final Map<String, T> items;$/m)
  assert.match(text, /^ {4}public void addAll\(final String group, T\.\.\. values\) throws IOException \{ \/\* compiled code \*\/ \}$/m)
  assert.match(text, /^ {4}\/\/ bridge: public void bridge\(\)$/m)
  // Lines know the member they declare.
  const line = outline.lines.find((l) => l.text.includes('addAll'))
  assert.deepEqual(line?.target, { kind: 'method', owner: 'demo/sky/Catalog', index: 0 })
})

test('outlines interfaces, enums, records and annotation types', () => {
  const iface = new ClassWriter({ name: 'demo/Body', access: 0x0601 })
  iface.attribute(iface.classListAttr('PermittedSubclasses', ['demo/Planet', 'demo/Star']))
  iface.field({ access: 0x0019, name: 'MAX', descriptor: 'D', attributes: [iface.indexAttr('ConstantValue', iface.pool.double(1.5))] })
  iface.method({ access: 0x0401, name: 'name', descriptor: '()Ljava/lang/String;' })
  iface.method({ access: 0x0001, name: 'bright', descriptor: '()Z', attributes: [body(iface)] })
  iface.method({ access: 0x0009, name: 'of', descriptor: '()Ldemo/Body;', attributes: [body(iface)] })
  const ic = parseClass(iface.toBytes())
  assert.equal(classKind(ic), 'interface')
  const it = buildOutline(ic).text
  assert.match(it, /^public sealed interface Body permits Planet, Star \{$/m)
  assert.match(it, /^ {4}double MAX = 1\.5;$/m)
  assert.match(it, /^ {4}String name\(\);$/m)
  assert.match(it, /^ {4}default boolean bright\(\) \{/m)
  assert.match(it, /^ {4}static Body of\(\) \{/m)

  const en = new ClassWriter({ name: 'demo/Mount', superName: 'java/lang/Enum', access: 0x4031 })
  en.attribute(en.utf8Attr('Signature', 'Ljava/lang/Enum<Ldemo/Mount;>;'))
  for (const name of ['ALT', 'EQ']) en.field({ access: 0x4019, name, descriptor: 'Ldemo/Mount;' })
  en.field({ access: 0x101a, name: '$VALUES', descriptor: '[Ldemo/Mount;' })
  en.method({ access: 0x0002, name: '<init>', descriptor: '(Ljava/lang/String;I)V', attributes: [body(en), en.utf8Attr('Signature', '()V')] })
  const et = buildOutline(parseClass(en.toBytes())).text
  assert.match(et, /^public enum Mount \{\n {4}ALT,\n {4}EQ;$/m)
  assert.match(et, /^ {4}\/\/ synthetic: private static final Mount\[\] \$VALUES;$/m)
  assert.match(et, /^ {4}Mount\(\) \{/m)

  const rec = new ClassWriter({ name: 'demo/Planet', superName: 'java/lang/Record', access: 0x0031, interfaces: ['demo/Body'] })
  rec.attribute({
    name: 'Record',
    body: [
      ...u2(2),
      ...u2(rec.pool.utf8('name')), ...u2(rec.pool.utf8('Ljava/lang/String;')), ...u2(0),
      ...u2(rec.pool.utf8('moons')), ...u2(rec.pool.utf8('I')), ...u2(0)
    ]
  })
  rec.field({ access: 0x0012, name: 'name', descriptor: 'Ljava/lang/String;' })
  rec.field({ access: 0x0012, name: 'moons', descriptor: 'I' })
  const rt = buildOutline(parseClass(rec.toBytes())).text
  assert.match(rt, /^public record Planet\(String name, int moons\) implements Body \{$/m)
  assert.ok(!/private final/.test(rt))

  const ann = new ClassWriter({ name: 'demo/Range', access: 0x2601, interfaces: ['java/lang/annotation/Annotation'] })
  ann.method({ access: 0x0401, name: 'min', descriptor: '()I', attributes: [{ name: 'AnnotationDefault', body: int(ann, 0) }] })
  ann.method({ access: 0x0401, name: 'unit', descriptor: '()Ljava/lang/String;' })
  const at = buildOutline(parseClass(ann.toBytes())).text
  assert.match(at, /^public @interface Range \{$/m)
  assert.match(at, /^ {4}int min\(\) default 0;$/m)
  assert.match(at, /^ {4}String unit\(\);$/m)
})

test('nests member classes from the same archive and names those it cannot see', () => {
  const inner = (w: ClassWriter) =>
    w.attribute({
      name: 'InnerClasses',
      body: [
        ...u2(2),
        ...u2(w.pool.cls('demo/Outer$Mode')), ...u2(w.pool.cls('demo/Outer')), ...u2(w.pool.utf8('Mode')), ...u2(0x4019),
        ...u2(w.pool.cls(anonymousName('demo/Outer', 1))), 0, 0, 0, 0, ...u2(0)
      ]
    })
  const outer = new ClassWriter({ name: 'demo/Outer' })
  inner(outer)
  outer.field({ access: 0x0002, name: 'mode', descriptor: 'Ldemo/Outer$Mode;' })
  const mode = new ClassWriter({ name: 'demo/Outer$Mode', superName: 'java/lang/Enum', access: 0x4030 })
  inner(mode)
  mode.field({ access: 0x4019, name: 'FAST', descriptor: 'Ldemo/Outer$Mode;' })
  const o = parseClass(outer.toBytes())
  const m = parseClass(mode.toBytes())
  const alone = buildOutline(o).text
  assert.match(alone, /^ {4}private Mode mode;$/m)
  assert.match(alone, /^ {4}public static final enum Mode \{ \/\* in Outer\$Mode\.class \*\/ \}$|^ {4}public enum Mode \{ \/\* in Outer\$Mode\.class \*\/ \}$/m)
  assert.ok(alone.split('\n').includes(`    // anonymous class ${anonymousName('Outer', 1)}`))
  const nested = buildOutline(o, { resolve: (n) => (n === m.name ? m : undefined) }).text
  assert.match(nested, /^ {4}public enum Mode \{\n {8}FAST;\n {4}\}$/m)
  // Opened alone, a member class still shows its source name.
  assert.match(buildOutline(m).text, /^public enum Mode \{$/m)
})

test('outlines module-info', () => {
  const w = new ClassWriter({ name: 'module-info', superName: null, access: 0x8000, major: 53 })
  const mod = w.pool.module('demo.sky')
  const base = w.pool.module('java.base')
  const pkg = w.pool.package('demo/sky/api')
  const svc = w.pool.cls('demo/sky/Service')
  const impl = w.pool.cls('demo/sky/Impl')
  w.attribute({
    name: 'Module',
    body: [
      ...u2(mod), ...u2(0x0020), ...u2(w.pool.utf8('1.4.0')),
      ...u2(1), ...u2(base), ...u2(0x8020), ...u2(0),
      ...u2(1), ...u2(pkg), ...u2(0), ...u2(1), ...u2(base),
      ...u2(0),
      ...u2(1), ...u2(svc),
      ...u2(1), ...u2(svc), ...u2(1), ...u2(impl)
    ]
  })
  const cls = parseClass(w.toBytes())
  assert.equal(classKind(cls), 'module')
  const text = buildOutline(cls).text
  assert.match(text, /^open module demo\.sky \{ \/\/ @1\.4\.0$/m)
  assert.match(text, /^ {4}requires transitive java\.base;$/m)
  assert.match(text, /^ {4}exports demo\.sky\.api to java\.base;$/m)
  assert.match(text, /^ {4}uses demo\.sky\.Service;$/m)
  assert.match(text, /^ {4}provides demo\.sky\.Service with demo\.sky\.Impl;$/m)
})

test('recognises Kotlin, Scala and Groovy classes', () => {
  const kt = new ClassWriter({ name: 'demo/Point' })
  kt.attribute(kt.utf8Attr('SourceFile', 'Point.kt'))
  kt.attribute(
    annotations(kt, [
      {
        type: 'Lkotlin/Metadata;',
        elements: [
          ['mv', ['['.charCodeAt(0), ...u2(3), ...int(kt, 2), ...int(kt, 1), ...int(kt, 0)]],
          ['k', int(kt, 1)],
          ['d1', ['['.charCodeAt(0), ...u2(1), ...str(kt, 'binary protobuf')]]
        ]
      }
    ])
  )
  const kc = parseClass(kt.toBytes())
  assert.deepEqual(detectLanguage(kc), { language: 'kotlin', kotlin: { kind: 1, version: '2.1.0', packageName: undefined, extra: undefined }, sourceFile: 'Point.kt' })
  const ko = buildOutline(kc).text
  assert.match(ko, /^\/\/ Compiled by Kotlin; shown as the JVM sees it\.$/m)
  assert.match(ko, /^@Metadata\(mv = \{2, 1, 0\}, k = 1, d1 = \{\/\* 1 × protobuf \*\/\}\)$/m)
  assert.match(ko, /^import kotlin\.Metadata;$/m)

  const sc = new ClassWriter({ name: 'demo/Shape' })
  sc.attribute({ name: 'TASTY', body: [0, 1, 2] })
  assert.equal(detectLanguage(parseClass(sc.toBytes())).scalaVersion, '3')
  const s2 = new ClassWriter({ name: 'demo/Shape2' })
  s2.attribute({ name: 'ScalaSig', body: [5, 0, 0] })
  assert.equal(detectLanguage(parseClass(s2.toBytes())).language, 'scala')
  const gr = new ClassWriter({ name: 'demo/Script', interfaces: ['groovy/lang/GroovyObject'] })
  assert.equal(detectLanguage(parseClass(gr.toBytes())).language, 'groovy')
  const plain = new ClassWriter({ name: 'demo/Plain' })
  assert.equal(detectLanguage(parseClass(plain.toBytes())).language, 'java')
})

test('a damaged class still outlines what was read, with a note', () => {
  const w = new ClassWriter({ name: 'demo/Cut' })
  w.method({ access: 1, name: 'first', descriptor: '()V', attributes: [body(w)] })
  w.method({ access: 1, name: 'second', descriptor: '()V', attributes: [body(w)] })
  const bytes = w.toBytes()
  const cls = parseClass(bytes.subarray(0, bytes.length - 8))
  const text = buildOutline(cls).text
  assert.match(text, /void first\(\)/)
  assert.match(text, /\/\/ The file is damaged after this point: the file ends inside/)
})
