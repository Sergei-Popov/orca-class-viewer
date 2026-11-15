import { assert, test } from 'orca/testing'
import { stringsFor } from '../i18n'
import { ClassWriter, asm, u2 } from '../testing/classwriter'
import { useSiteText } from '../ui/pooltable'
import { parseClass } from './classfile'
import { poolUsage } from './usage'

/** class Counter implements Runnable { private int count; public void run() { count++; } } with a catch. */
function counter() {
  const w = new ClassWriter({ name: 'demo/Counter', interfaces: ['java/lang/Runnable'] })
  const count = w.pool.field('demo/Counter', 'count', 'I')
  const caught = w.pool.cls('java/lang/IllegalStateException')
  w.field({ access: 0x0002, name: 'count', descriptor: 'I' })
  w.method({
    access: 0x0001,
    name: 'run',
    descriptor: '()V',
    attributes: [
      w.code({
        maxStack: 3,
        maxLocals: 1,
        code: asm('aload_0', 'dup', 'getfield', ...u2(count), 'iconst_1', 'iadd', 'putfield', ...u2(count), 'return'),
        exceptions: [{ start: 0, end: 10, handler: 10, catchType: caught }]
      })
    ]
  })
  w.attribute(w.utf8Attr('SourceFile', 'Counter.java'))
  const cls = parseClass(w.toBytes())
  return { w, cls, usage: poolUsage(cls), count, caught }
}

test('finds every use of a constant: entries, instructions and the class structure', () => {
  const { w, cls, usage, count, caught } = counter()
  assert.deepEqual(usage[count].code, [
    { method: 0, offset: 2 },
    { method: 0, offset: 7 }
  ])
  assert.deepEqual(usage[cls.thisIndex].sites, [{ owner: 'class', path: ['this_class'] }])
  assert.ok(usage[cls.thisIndex].referredBy.includes(count))
  assert.deepEqual(usage[w.pool.cls('java/lang/Runnable')].sites, [{ owner: 'class', path: ['interfaces'] }])
  const name = w.pool.utf8('count')
  assert.deepEqual(usage[name].sites, [{ owner: 'field', name: 'count', path: [{ part: 'name' }] }])
  assert.ok(usage[name].referredBy.includes(w.pool.nat('count', 'I')))
  assert.deepEqual(usage[caught].sites, [{ owner: 'method', name: 'run', path: ['Code', { part: 'exceptionTable' }] }])
  assert.deepEqual(usage[w.pool.utf8('Code')].sites, [{ owner: 'method', name: 'run', path: ['Code', { part: 'attributeName' }] }])
  assert.deepEqual(usage[w.pool.utf8('Counter.java')].sites, [{ owner: 'class', path: ['SourceFile'] }])
})

test('names use sites in English and Russian', () => {
  const { usage, caught } = counter()
  const [site] = usage[caught].sites
  assert.equal(useSiteText(stringsFor('en'), site), 'method run · Code · exception table')
  assert.equal(useSiteText(stringsFor('ru'), site), 'метод run · Code · таблица исключений')
})

test('a damaged class still gets a usage list for every entry', () => {
  const { w } = counter()
  const bytes = w.toBytes()
  for (const cut of [10, 200, bytes.length - 3]) {
    const cls = parseClass(bytes.subarray(0, cut))
    assert.equal(poolUsage(cls).length, cls.pool.entries.length)
  }
})
