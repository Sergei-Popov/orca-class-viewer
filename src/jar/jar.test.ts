import { assert, test } from 'orca/testing'
import { anonymousName, helloClass } from '../testing/classwriter'
import { type ZipItem, zip } from '../testing/zipwriter'
import { openZip } from '../zip/zip'
import { type JarNode, buildJar, findClass, jarKind, walk } from './jar'
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
