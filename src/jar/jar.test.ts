import { assert, test } from 'orca/testing'
import { parseClass } from '../classfile/classfile'
import { ClassWriter, anonymousName, helloClass, u2 } from '../testing/classwriter'
import { type ZipItem, zip } from '../testing/zipwriter'
import { openZip } from '../zip/zip'
import { ClassCache } from './cache'
import { type JarModel, type JarNode, MAX_FOLDER_DEPTH, UNUSUAL_ID, buildJar, findClass, jarKind, walk } from './jar'
import { parseManifest } from './manifest'

const cls = (name: string): ZipItem => ({ name: `${name}.class`, data: helloClass(name.replace(/^.*?classes\//, '')).toBytes() })

/** The tree as indented lines: kind, label and class count. */
function outline(nodes: JarNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.kind} ${n.label}${n.kind === 'package' || n.kind === 'root' ? ` (${n.classCount})` : ''}`,
    ...outline(n.children, depth + 1)
  ])
}

test('lists packages, nested classes and resources like a Java project', () => {
  const bytes = zip([
    { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\nMain-Class: demo.sky.Main\r\nMulti-Release: true\r\n\r\n' },
    cls('demo/sky/Main'),
    cls('demo/sky/Star'),
    cls('demo/sky/Star$Kind'),
    cls('demo/sky/Star$Kind$Inner'),
    cls(anonymousName('demo/sky/Star', 1)),
    cls('demo/sky/Star$$Lambda'),
    cls('demo/sky/catalog/Catalog'),
    { name: 'demo/sky/messages.properties', data: 'hello=world' },
    cls('Default'),
    { name: 'static/index.html', data: '<p>hi</p>' },
    { name: 'lib/extra.jar', data: zip([cls('x/Y')]) },
    cls('META-INF/versions/17/demo/sky/Star'),
    cls('META-INF/versions/11/demo/sky/Star')
  ])
  const model = buildJar(openZip(bytes))
  assert.deepEqual(outline(model.tree), [
    'package demo.sky (7)',
    '  package catalog (1)',
    '    class Catalog',
    '  class Main',
    '  class Star',
    '    class Kind',
    '      class Inner',
    '    class Star$$Lambda',
    `    class ${anonymousName('Star', 1)}`,
    '  file messages.properties',
    'class Default',
    'folder lib',
    '  archive extra.jar',
    'folder META-INF',
    '  folder versions',
    '    folder 11',
    '      folder demo',
    '        folder sky',
    '          class Star',
    '    folder 17',
    '      folder demo',
    '        folder sky',
    '          class Star',
    '  file MANIFEST.MF',
    'folder static',
    '  file index.html'
  ])
  assert.equal(model.classCount, 8)
  assert.equal(model.resourceCount, 3)
  assert.deepEqual(model.versions, [11, 17])
  assert.equal(model.multiRelease, true)
  assert.equal(model.manifest?.main.get('Main-Class'), 'demo.sky.Main')
  assert.deepEqual(model.nested.map((e) => e.path), ['lib/extra.jar'])
  const star = findClass(model, 'demo/sky/Star')
  assert.deepEqual(star?.node.versions?.map((v) => v.release), [11, 17])
  assert.equal(findClass(model, 'demo/sky/Star$Kind$Inner')?.node.label, 'Inner')
  // A versioned copy still knows its class name.
  const copy = [...walk(model.tree)].find((n) => n.path === 'META-INF/versions/17/demo/sky/Star.class')
  assert.equal(copy?.className, 'demo/sky/Star')
})

test('gives WEB-INF/classes and BOOT-INF/classes roots of their own', () => {
  const war = buildJar(
    openZip(
      zip([
        cls('WEB-INF/classes/demo/web/Servlet'),
        cls('WEB-INF/classes/demo/web/Servlet$Handler'),
        { name: 'WEB-INF/web.xml', data: '<web-app/>' },
        { name: 'WEB-INF/lib/core-1.0.jar', data: zip([]) },
        { name: 'index.jsp', data: '<html/>' }
      ])
    ),
    jarKind('war')
  )
  assert.deepEqual(outline(war.tree), [
    'root WEB-INF/classes (2)',
    '  package demo.web (2)',
    '    class Servlet',
    '      class Handler',
    'folder WEB-INF',
    '  folder lib',
    '    archive core-1.0.jar',
    '  file web.xml',
    'file index.jsp'
  ])
  assert.equal(findClass(war, 'demo/web/Servlet')?.root, 'WEB-INF/classes/')

  const boot = buildJar(openZip(zip([cls('org/loader/Launcher'), cls('BOOT-INF/classes/demo/App'), { name: 'BOOT-INF/lib/a.jar', data: zip([]) }])))
  assert.deepEqual(outline(boot.tree), [
    'root BOOT-INF/classes (1)',
    '  package demo (1)',
    '    class App',
    'package org.loader (1)',
    '  class Launcher',
    'folder BOOT-INF',
    '  folder lib',
    '    archive a.jar'
  ])
})

test('reads a jmod: its classes folder is the root, the rest are folders', () => {
  const bytes = zip([cls('classes/module-info'), cls('classes/demo/api/Api'), { name: 'conf/demo.properties', data: 'a=1' }, { name: 'legal/LICENSE', data: 'MIT' }], {
    prefix: Uint8Array.from([0x4a, 0x4d, 1, 0])
  })
  const model = buildJar(openZip(bytes), jarKind('.jmod'))
  assert.deepEqual(outline(model.tree), [
    'root classes (2)',
    '  package demo.api (1)',
    '    class Api',
    '  class module-info',
    'folder conf',
    '  file demo.properties',
    'folder legal',
    '  file LICENSE'
  ])
  assert.equal(model.kind, 'jmod')
})

test('parses manifests with continuation lines and entry sections', () => {
  const m = parseManifest(
    '﻿Manifest-Version: 1.0\r\nClass-Path: lib/a.jar lib/b\r\n .jar\r\nImplementation-Title:Demo\r\n\r\nName: demo/sky/\r\nSealed: true\r\n\r\n\r\n'
  )
  assert.equal(m.main.get('Class-Path'), 'lib/a.jar lib/b.jar')
  assert.equal(m.main.get('Implementation-Title'), 'Demo')
  assert.equal(m.entries.get('demo/sky/')?.get('Sealed'), 'true')
  assert.equal(parseManifest('').main.size, 0)
})

test('an empty or damaged archive still builds', () => {
  assert.deepEqual(buildJar(openZip(zip([]))).tree, [])
  const model = buildJar(openZip(zip([{ name: 'META-INF/MANIFEST.MF', data: 'x', crc: 1 }, cls('a/B')])))
  assert.equal(model.manifest, undefined)
  assert.equal(model.classCount, 1)
})

// Review 1, findings 1 and 12: java.util.zip looks entries up by their stored names, and the last
// copy of a name wins. The tree shows what the JVM loads; the rest is listed apart.
test('takes the last copy of a name, as the JVM does, and lists the others apart', () => {
  const decoy = helloClass('demo/Decoy').toBytes()
  const real = helloClass('demo/Main').toBytes()
  const loaded = (model: JarModel) => {
    const ref = findClass(model, 'demo/Main')
    return ref ? parseClass(model.zip.read(ref.entry).bytes).name : undefined
  }
  for (const name of ['demo/Main.class', 'x/../demo/Main.class', 'demo\\Main.class', '/demo/Main.class', './demo/Main.class', 'demo//Main.class']) {
    const model = buildJar(openZip(zip([{ name, data: decoy }, { name: 'demo/Main.class', data: real }])))
    assert.equal(loaded(model), 'demo/Main', name)
    assert.equal(model.classCount, 1)
    const issue = name === 'demo/Main.class' ? 'shadowed' : 'unusual'
    const apart = model.tree.find((n) => n.id === UNUSUAL_ID)
    assert.deepEqual(apart?.children.map((n) => [n.label, n.issue, n.kind, n.className]), [[name, issue, 'class', 'demo/Main']])
    assert.deepEqual([model.unusual.length, model.shadowed.length], issue === 'unusual' ? [1, 0] : [0, 1])
    assert.equal(model.tree[model.tree.length - 1].id, UNUSUAL_ID)
  }
  // In the other order the JVM runs the other copy, and so does the tree.
  assert.equal(loaded(buildJar(openZip(zip([{ name: 'demo/Main.class', data: real }, { name: 'demo/Main.class', data: decoy }])))), 'demo/Decoy')
  // Under an unusual name only, it is not a class the JVM can load.
  const only = buildJar(openZip(zip([{ name: 'x/../demo/Main.class', data: real }])))
  assert.equal(findClass(only, 'demo/Main'), undefined)
  assert.equal(only.classCount, 0)
  assert.deepEqual(outline(only.tree), ['folder Unusual entries', '  class x/../demo/Main.class'])
  // The stored name is kept next to the path.
  assert.deepEqual(only.unusual.map((e) => [e.name, e.path]), [['x/../demo/Main.class', 'demo/Main.class']])
  // An ordinary jar has nothing apart.
  const plain = buildJar(openZip(zip([cls('demo/Main'), { name: 'demo/', method: 0 }, { name: 'demo/', method: 0 }])))
  assert.deepEqual([plain.unusual.length, plain.shadowed.length, plain.tree.some((n) => n.id === UNUSUAL_ID)], [0, 0, false])
})

test('reads the manifest that java.util.jar reads', () => {
  const man = (main: string) => `Manifest-Version: 1.0\r\nMain-Class: ${main}\r\n\r\n`
  const twice = buildJar(openZip(zip([{ name: 'META-INF/MANIFEST.MF', data: man('demo.Main') }, { name: 'META-INF/MANIFEST.MF', data: man('other.Run') }])))
  assert.equal(twice.manifest?.main.get('Main-Class'), 'other.Run')
  assert.equal(twice.manifestEntry?.index, 1)
  const fake = buildJar(openZip(zip([{ name: 'x/../META-INF/MANIFEST.MF', data: man('Fake') }, { name: 'META-INF/MANIFEST.MF', data: man('Main') }])))
  assert.equal(fake.manifest?.main.get('Main-Class'), 'Main')
  assert.equal(buildJar(openZip(zip([{ name: 'x/../META-INF/MANIFEST.MF', data: man('Fake') }]))).manifest, undefined)
  // JarFile falls back to a META-INF entry whose name matches in capitals.
  assert.equal(buildJar(openZip(zip([{ name: 'meta-inf/manifest.mf', data: man('Low') }]))).manifest?.main.get('Main-Class'), 'Low')
})

// Review 2, finding 14. What JarFile.getManifest() of Java 21.0.13 read from jars of these names,
// each entry with Main-Class m<index> (checked on the PC with eclipse-temurin:21-jdk): the last
// name that matches in ASCII capitals, the exact one included; ſ and ı are not ASCII.
test('matches the manifest name in ASCII capitals only and takes the last match, as Java 21', () => {
  const cases: [string[], string | undefined][] = [
    [['META-INF/MANIFEST.MF', 'META-INF/manifest.mf'], 'm1'],
    [['META-INF/manifest.mf', 'META-INF/MANIFEST.MF'], 'm1'],
    [['META-INF/Manifest.MF', 'META-INF/MANIFEST.mf'], 'm1'],
    [['meta-inf/manifest.mf'], 'm0'],
    [['META-INF/MANIFEST.MF', 'META-INF/MANIFEſT.MF'], 'm0'],
    [['META-ıNF/MANIFEST.MF'], undefined],
    [['META-ıNF/MANIFEST.MF', 'META-INF/manifest.mf'], 'm1']
  ]
  for (const [names, expected] of cases) {
    const items = names.map((name, i) => ({ name, data: `Manifest-Version: 1.0\r\nMain-Class: m${i}\r\n\r\n` }))
    assert.equal(buildJar(openZip(zip(items))).manifest?.main.get('Main-Class'), expected, names.join(' + '))
  }
})

// Review 2, finding 2: java.util.zip finds `demo/Main.class/` under `demo/Main.class` when no entry
// has that exact name, and `java -jar` runs it (JDK 8 and 21); with the exact name beside it, the
// file wins in either order.
test('lists an entry named like a folder that holds data, and takes its class as the JVM does', () => {
  const main = 'Manifest-Version: 1.0\r\nMain-Class: demo.Main\r\n\r\n'
  const slash = { name: 'demo/Main.class/', data: helloClass('demo/Main').toBytes() }
  const only = buildJar(openZip(zip([{ name: 'META-INF/MANIFEST.MF', data: main }, slash])))
  assert.deepEqual(
    only.folderData.map((e) => e.name),
    ['demo/Main.class/']
  )
  const apart = only.tree.find((n) => n.id === UNUSUAL_ID)
  assert.deepEqual(
    apart?.children.map((n) => [n.label, n.kind, n.issue]),
    [['demo/Main.class/', 'class', 'folder']]
  )
  assert.equal(findClass(only, 'demo/Main')?.entry.name, 'demo/Main.class/')
  assert.equal(only.classCount, 1)
  assert.ok(![...walk(only.tree)].some((n) => n.kind === 'folder' && n.label === 'Main.class'))
  // A decoy under BOOT-INF/classes: a plain `java -jar` runs the folder-named entry.
  const decoy = buildJar(openZip(zip([{ name: 'META-INF/MANIFEST.MF', data: main }, cls('BOOT-INF/classes/demo/Main'), slash])))
  assert.equal(findClass(decoy, 'demo/Main')?.entry.name, 'demo/Main.class/')
  // Beside the exact name the file wins; the data is still listed apart.
  for (const items of [[cls('demo/Main'), slash], [slash, cls('demo/Main')]]) {
    const both = buildJar(openZip(zip(items)))
    assert.deepEqual(
      both.classes.get('demo/Main')?.map((r) => r.entry.name),
      ['demo/Main.class']
    )
    assert.deepEqual(
      both.folderData.map((e) => e.name),
      ['demo/Main.class/']
    )
  }
  // An empty folder entry is still a folder.
  assert.equal(buildJar(openZip(zip([{ name: 'demo/' }, cls('demo/Main')]))).folderData.length, 0)
})

// Review 2, finding 13: JarFile looks up META-INF/versions/<release>/, so 09 or 017 is never used.
test('takes only the version folders java.util.jar looks up', () => {
  const mr = 'Manifest-Version: 1.0\r\nMulti-Release: true\r\n\r\n'
  const model = buildJar(
    openZip(
      zip([
        { name: 'META-INF/MANIFEST.MF', data: mr },
        cls('demo/Main'),
        cls('META-INF/versions/09/demo/Main'),
        cls('META-INF/versions/017/demo/Main'),
        cls('META-INF/versions/8/demo/Main'),
        cls('META-INF/versions/11/demo/Main'),
        { name: 'META-INF/versions/09/module-info.class', data: moduleInfo('padded') }
      ])
    )
  )
  assert.deepEqual(model.versions, [11])
  assert.deepEqual(
    findClass(model, 'demo/Main')?.node.versions?.map((v) => [v.release, v.entry.name]),
    [[11, 'META-INF/versions/11/demo/Main.class']]
  )
  assert.equal(model.moduleInfo, undefined)
  // The others stay ordinary files under META-INF.
  for (const v of ['09', '017', '8']) assert.ok([...walk(model.tree)].some((n) => n.path === `META-INF/versions/${v}/demo/Main.class`), v)
})

// Review 2, finding 5: each `$` of a name cost a lookup of the prefix before it, so names of
// thousands of `$` took seconds.
test('nests classes under their outer classes quickly, even for names of thousands of $', () => {
  const items: ZipItem[] = []
  for (let j = 0; j < 100; j++) items.push({ name: `p/${'$'.repeat(16000)}${j}.class`, data: 'x', method: 0 })
  items.push(cls('p/A'), cls('p/A$B'), cls('p/A$B$C'))
  const bytes = zip(items)
  const started = Date.now()
  const model = buildJar(openZip(bytes))
  const took = Date.now() - started
  assert.ok(took < 1500, `${took} ms`)
  assert.equal(model.classCount, 103)
  assert.deepEqual(
    findClass(model, 'p/A$B')?.node.children.map((n) => n.className),
    ['p/A$B$C']
  )
  assert.deepEqual(
    findClass(model, 'p/A')?.node.children.map((n) => n.className),
    ['p/A$B']
  )
})

// Review 2, finding 4: a jmod keeps module-info.class under classes/.
test('names the module of a jmod', () => {
  const bytes = zip([{ name: 'classes/module-info.class', data: moduleInfo('demo.api') }, cls('classes/demo/api/Api')], { prefix: Uint8Array.from([0x4a, 0x4d, 1, 0]) })
  const model = buildJar(openZip(bytes), 'jmod')
  const info = model.moduleInfo
  assert.equal(info?.nodeId, 'c:classes/module-info')
  assert.equal(info?.release, undefined)
  assert.ok([...walk(model.tree)].some((n) => n.id === info?.nodeId && n.entry === info.entry))
  const parsed = info ? new ClassCache(model.zip).get('module', info.entry) : undefined
  const attr = parsed?.attributes.find((a) => a.value.kind === 'Module')
  assert.equal(attr?.value.kind === 'Module' ? parsed?.pool.text(attr.value.module.nameIndex) : undefined, 'demo.api')
  // In a plain jar, classes/ is only a folder.
  assert.equal(buildJar(openZip(zip([{ name: 'classes/module-info.class', data: moduleInfo('x') }]))).moduleInfo, undefined)
})

/** A module-info class with a Module attribute for `name`. */
function moduleInfo(name: string): Uint8Array {
  const w = new ClassWriter({ name: 'module-info', superName: null, access: 0x8000 })
  const mod = w.pool.module(name)
  w.attribute({ name: 'Module', body: [...u2(mod), ...u2(0), ...u2(0), ...u2(0), ...u2(0), ...u2(0), ...u2(0), ...u2(0)] })
  return w.toBytes()
}

// Review 1, finding 4: kotlin-stdlib, slf4j-api and jackson-core keep module-info under versions/9.
test('finds the module of a multi-release jar that keeps module-info under versions', () => {
  const mr = 'Manifest-Version: 1.0\r\nMulti-Release: true\r\n\r\n'
  const model = buildJar(
    openZip(
      zip([
        { name: 'META-INF/MANIFEST.MF', data: mr },
        cls('kotlin/Unit'),
        { name: 'META-INF/versions/9/module-info.class', data: moduleInfo('kotlin.old') },
        { name: 'META-INF/versions/11/module-info.class', data: moduleInfo('kotlin.stdlib') }
      ])
    )
  )
  const info = model.moduleInfo
  assert.equal(info?.release, 11)
  assert.equal(info?.entry.name, 'META-INF/versions/11/module-info.class')
  assert.ok([...walk(model.tree)].some((n) => n.id === info?.nodeId && n.entry === info.entry))
  // The overview reads the name the same way.
  const cls11 = info ? new ClassCache(model.zip).get('module', info.entry) : undefined
  const attr = cls11?.attributes.find((a) => a.value.kind === 'Module')
  assert.equal(attr?.value.kind === 'Module' ? cls11?.pool.text(attr.value.module.nameIndex) : undefined, 'kotlin.stdlib')
  // Without Multi-Release the JVM ignores the versions folder.
  assert.equal(buildJar(openZip(zip([cls('kotlin/Unit'), { name: 'META-INF/versions/9/module-info.class', data: moduleInfo('x') }]))).moduleInfo, undefined)
  // A module-info at the top comes first.
  const top = buildJar(openZip(zip([{ name: 'META-INF/MANIFEST.MF', data: mr }, { name: 'module-info.class', data: moduleInfo('top') }, { name: 'META-INF/versions/9/module-info.class', data: moduleInfo('nine') }])))
  assert.deepEqual([top.moduleInfo?.entry.name, top.moduleInfo?.release, top.moduleInfo?.nodeId], ['module-info.class', undefined, 'c:module-info'])
})

/** The deepest level of the tree, counted without recursion. */
function treeDepth(nodes: JarNode[]): number {
  let max = 0
  const stack: [JarNode, number][] = nodes.map((n) => [n, 1])
  for (let item = stack.pop(); item; item = stack.pop()) {
    const [n, d] = item
    max = Math.max(max, d)
    for (const c of n.children) stack.push([c, d + 1])
  }
  return max
}

// Review 1, findings 11 and 15: an entry thousands of folders deep overflowed the stack.
test('opens a jar with entries tens of thousands of folders deep', () => {
  const deepClass = `${'a/'.repeat(32000)}X`
  const deepText = `${'b/'.repeat(6000)}x.txt`
  const model = buildJar(
    openZip(
      zip([
        { name: `${deepClass}.class`, data: 'x', method: 0 },
        { name: deepText, data: 'x', method: 0 },
        { name: 'c/'.repeat(5000), method: 0 },
        cls('demo/Ok'),
        { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\r\n\r\n' }
      ])
    )
  )
  assert.equal(findClass(model, deepClass)?.node.path, `${deepClass}.class`)
  assert.ok(findClass(model, 'demo/Ok'))
  assert.ok([...walk(model.tree)].some((n) => n.path === deepText))
  assert.ok(treeDepth(model.tree) <= MAX_FOLDER_DEPTH + 1, String(treeDepth(model.tree)))
  assert.equal(model.classCount, 2)
})

test('lists more entries at the top than a call takes arguments', () => {
  const items: ZipItem[] = []
  for (let i = 0; i < 130_000; i++) items.push({ name: `r${i}.txt`, method: 0 })
  assert.equal(buildJar(openZip(zip(items))).tree.length, 130_000)
})
