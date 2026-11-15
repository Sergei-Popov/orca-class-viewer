import { assert, test } from 'orca/testing'
import { parseClass } from '../classfile/classfile'
import { detectLanguage } from '../classfile/language'
import { stringsFor } from '../i18n'
import { asm, helloClass } from '../testing/classwriter'
import { type FakeElement, withFakeDom } from '../testing/dom'
import type { Env } from './env'
import { buildStructure } from './structure'
import { css } from './styles'

function secretive() {
  const w = helloClass('demo/Secretive')
  w.field({ access: 2, name: 'thing', descriptor: 'I', attributes: [{ name: 'com.acme.FieldThing', body: [0x11, 0x22, 0x33] }] })
  w.method({ access: 1, name: 'secret', descriptor: '()V', attributes: [w.code({ code: asm('return') }), { name: 'com.acme.Secret', body: [0xde, 0xad, 0xbe, 0xef, 0x42] }] })
  // A Code attribute that ends inside its bytecode.
  w.method({ access: 1, name: 'answer', descriptor: '()I', attributes: [{ name: 'Code', body: [0, 1, 0, 1, 0, 0, 3, 232, 0xac, 0, 0, 0, 0] }] })
  return parseClass(w.toBytes())
}

const structure = (locale: string) => {
  const cls = secretive()
  const env: Env = { t: stringsFor(locale), locale, toast: () => undefined }
  const doc = buildStructure(cls, detectLanguage(cls), env, { showPool: () => undefined, showMethod: () => undefined }) as unknown as FakeElement
  return { cls, doc }
}

// Review 1, finding 23: field and method attributes were names only, with no offset or bytes.
test('opens a member’s attributes with their offsets and bytes', () => {
  withFakeDom(() => {
    const { cls, doc } = structure('en')
    const buttons = doc.findAll((el) => el.getAttribute('aria-expanded') !== null)
    const secret = buttons.find((b) => b.textContent === 'Code, com.acme.Secret')
    const thing = buttons.find((b) => b.textContent === 'com.acme.FieldThing')
    assert.ok(secret && thing)
    assert.ok(!doc.textContent.includes('de ad be ef 42'))

    secret.click()
    const rows = () => doc.findAll((el) => el.className === 'cv-attr-row')
    assert.equal(rows().length, 1)
    assert.equal(secret.getAttribute('aria-expanded'), 'true')
    const shown = rows()[0].textContent
    const attr = cls.methods[1].attributes[1]
    assert.ok(shown.includes(`5 bytes · Offset ${attr.offset.toLocaleString('en')}`), shown)
    assert.ok(shown.includes('de ad be ef 42'), shown)
    // The row sits right under the method's row, and a second click hides it.
    const methodRow = secret.parent?.parent
    const siblings = methodRow?.parent?.childNodes ?? []
    assert.equal(siblings[siblings.indexOf(methodRow as FakeElement) + 1], rows()[0])
    secret.click()
    assert.equal(rows()[0].hidden, true)
    assert.equal(secret.getAttribute('aria-expanded'), 'false')

    thing.click()
    assert.ok(doc.textContent.includes('11 22 33'))
  })
})

// Review 1, findings 13 and 22: a damaged Code attribute is marked, with its reason in the UI language.
test('marks a damaged Code attribute in the method table, in the UI language', () => {
  withFakeDom(() => {
    for (const [locale, badge, reason] of [
      ['en', 'damaged', 'the file ends inside the bytecode'],
      ['ru', 'повреждён', stringsFor('ru').reasonTruncated]
    ]) {
      const { doc } = structure(locale)
      const bad = doc.findAll((el) => el.className === 't-bad' && el.textContent === badge)
      assert.equal(bad.length, 1, locale)
      assert.equal(bad[0].getAttribute('title'), reason)
      // The attribute name in the attributes list is marked too.
      assert.equal(doc.findAll((el) => el.className === 't-bad' && el.textContent === 'Code' && el.getAttribute('title') === reason).length, 1)
    }
  })
})

// Listing images: in a narrow Structure tab the fields table split ConstantValue into "ConstantVal"
// and "ue", because every mono cell could break anywhere. Flags, code sizes and attribute names now
// wrap between words only; descriptors, which have no spaces, still break anywhere.
test('keeps flags, code sizes and attribute names whole in a narrow member table', () => {
  withFakeDom(() => {
    const { doc } = structure('en')
    const cell = (text: string) => doc.findAll((el) => el.tagName === 'TD' && el.textContent === text)[0]
    const words = (el: FakeElement | undefined) => (el?.className ?? '').split(' ').includes('cv-words')
    assert.ok(words(cell('0x0002 private')), 'field flags')
    assert.ok(words(cell('com.acme.FieldThing')), 'field attributes')
    assert.ok(words(cell('Code, com.acme.Secret')), 'method attributes')
    const code = doc.findAll((el) => el.tagName === 'TD' && el.textContent.includes('stack'))
    assert.ok(code.length > 0 && code.every(words), 'code sizes')
    const descriptor = cell('()V')
    assert.ok(descriptor && !words(descriptor), 'descriptors still break anywhere')
  })
  assert.ok(css.includes('.cv-grid td.cv-words { overflow-wrap: break-word; }'))
})
