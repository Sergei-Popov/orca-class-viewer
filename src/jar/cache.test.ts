import { assert, test } from 'orca/testing'
import { helloClass } from '../testing/classwriter'
import { zip } from '../testing/zipwriter'
import { openZip } from '../zip/zip'
import { ClassCache, RESOLVE_LIMIT } from './cache'

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

  // Past the budget the cache starts again, so it never holds more than the budget.
  const tight = new ClassCache(z, small.length * 2)
  tight.get('a', z.entries[0])
  tight.get('b', z.entries[0])
  assert.equal(tight.bytes, small.length * 2)
  assert.equal(tight.get('c', z.entries[0])?.name, 'demo/Small')
  assert.equal(tight.bytes, small.length)
})
