import { assert, test } from 'orca/testing'
import { parseClass } from '../classfile/classfile'
import { buildOutline } from '../classfile/outline'
import { ClassWriter, helloClass, u2 } from '../testing/classwriter'
import { type ZipItem, zip } from '../testing/zipwriter'
import { openZip } from '../zip/zip'
import { CACHE_BUDGET, ClassCache, READ_BUDGET, RESOLVE_LIMIT, readBudget } from './cache'

// Review 1, finding 9: an outer class whose member classes are padded to 64 MiB each made one
// Outline unpack and hold half a gigabyte.
test('reads classes for names within a size limit and a byte budget', () => {
  const small = helloClass('demo/Small').toBytes()
  const padded = new Uint8Array(RESOLVE_LIMIT + 1024)
  padded.set(small)
  const z = openZip(
    zip([
      { name: 'demo/Small.class', data: small },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `demo/Small$Pad${i}.class`, data: padded })),
      // A size the archive understates is caught when the bytes do not match it.
      { name: 'demo/Small$Liar.class', data: padded, size: 100 }
    ])
  )
  const cache = new ClassCache(z)
  assert.equal(cache.get('demo/Small', z.entries[0])?.name, 'demo/Small')
  for (let i = 1; i < z.entries.length; i++) assert.equal(cache.get(z.entries[i].path, z.entries[i]), undefined)
  assert.equal(cache.bytes, small.length)
  assert.equal(cache.get('missing', undefined), undefined)

  // Past the budget the oldest classes go, so it never holds more than the budget.
  const tight = new ClassCache(z, small.length * 2)
  tight.get('a', z.entries[0])
  tight.get('b', z.entries[0])
  assert.equal(tight.bytes, small.length * 2)
  assert.equal(tight.get('c', z.entries[0])?.name, 'demo/Small')
  assert.equal(tight.bytes, small.length * 2)
  assert.equal(RESOLVE_LIMIT, 1024 * 1024)
  assert.equal(CACHE_BUDGET, 64 * 1024 * 1024)
})

/** A member class of demo/Outer padded with an unknown attribute to about `size` bytes. */
function paddedMember(name: string, size: number): Uint8Array {
  const w = new ClassWriter({ name })
  w.attribute({ name: 'Padding', body: new Array(size).fill(0) })
  return w.toBytes()
}

// Review 2, finding 8: the cache bounded what it held, not what one outline unpacked, and a
// member named again was read again.
test('one outline unpacks at most its read budget and reads each member once', () => {
  const size = 100_000
  const names = Array.from({ length: 20 }, (_, i) => `demo/Outer$M${i}`)
  const items: ZipItem[] = names.map((n) => ({ name: `${n}.class`, data: paddedMember(n, size), level: 1 }))
  const z = openZip(zip(items))
  const outer = new ClassWriter({ name: 'demo/Outer' })
  // Every member five times over.
  const entries = [...names, ...names, ...names, ...names, ...names].flatMap((n) => [
    ...u2(outer.pool.cls(n)),
    ...u2(outer.pool.cls('demo/Outer')),
    ...u2(outer.pool.utf8(n.slice(n.indexOf('$') + 1))),
    ...u2(0x0009)
  ])
  outer.attribute({ name: 'InnerClasses', body: [...u2(names.length * 5), ...entries] })
  const cache = new ClassCache(z)
  const budget = readBudget(8 * (size + 1000))
  const asked: string[] = []
  const outline = buildOutline(parseClass(outer.toBytes()), {
    resolve: (n) => {
      asked.push(n)
      return cache.get(n, z.entries.find((e) => e.path === `${n}.class`), budget)
    }
  })
  assert.deepEqual(asked, names)
  assert.ok(budget.left >= 0)
  // Eight members fit the budget and are written out; the rest are named where they are.
  const written = outline.lines.filter((l) => /^ {4}public class Outer\$M\d+ \{$/.test(l.text)).length
  const named = outline.lines.filter((l) => /^ {4}public static class M\d+ \{ \/\* in Outer\$M\d+\.class \*\/ \}$/.test(l.text)).length
  assert.equal(written, 8)
  assert.equal(named, 12)
  // Members the budget left out are not remembered as missing: a new view can read them.
  assert.equal(cache.get(names[19], z.entries[19], readBudget())?.name, names[19])
  assert.equal(READ_BUDGET, 64 * 1024 * 1024)
})
