import { assert, test } from 'orca/testing'
import { decodeText, splitKeyValue, textLines } from './textpreview'

/** The pattern the preview used before review 1; it backtracks quadratically on long blanks. */
const OLD = /^([^:=\s][^:=]*?)(\s*[:=]\s?)(.*)$/

test('splits manifest and properties lines as the old pattern did', () => {
  const lines = ['Main-Class: demo.Main', 'key=value', 'key = value', 'key  :  v', 'a:b', 'key:', 'Name: a=b', ' continued: line', ':x', '=x', 'no separator', '', 'k\t=\tv', 'Ключ: значение', 'a b c = d']
  for (const line of lines) {
    const m = OLD.exec(line)
    assert.deepEqual(splitKeyValue(line), m ? [m[1], m[2], m[3]] : undefined, line)
  }
})

// Review 1, finding 8: 'a' and 160,000 blanks took 12 s; a 2 MiB line would have taken minutes.
test('highlights lines of megabytes of blanks in linear time', () => {
  for (const blank of [' ', '\t']) {
    const long = `a${blank.repeat(2 * 1024 * 1024)}`
    const text = `Manifest-Version: 1.0\n${long}\nb${blank.repeat(1_000_000)}=x\n`
    const start = Date.now()
    const lines = textLines(text, 'mf')
    const ms = Date.now() - start
    assert.ok(ms < 1000, `${ms} ms`)
    assert.equal(lines.length, 3)
    assert.deepEqual(
      lines[1].spans.map((s) => s.text.length),
      [long.length]
    )
    assert.deepEqual(
      lines[2].spans.map((s) => [s.text.length, s.cls]),
      [
        [1, 't-key'],
        [1_000_001, undefined],
        [1, 't-str']
      ]
    )
  }
})

// Review 1, finding 21: a text entry over 2 MiB showed as a 4 KiB 'Binary file' hex dump.
test('decodes the start of a large text entry, leaving out a character cut in two', () => {
  const bytes = new TextEncoder().encode(`${String.fromCharCode(0xfeff)}{"name": "Ωmega"}`)
  const cut = bytes.subarray(0, bytes.indexOf(0xce) + 1)
  assert.equal(decodeText(cut, 'json', true), '{"name": "')
  assert.equal(decodeText(bytes, 'json'), '{"name": "Ωmega"}')
  // A whole entry that ends inside a character is not UTF-8: a text type falls back to Windows-1252.
  assert.equal(decodeText(cut, 'json')?.endsWith('"Î'), true)
  assert.equal(decodeText(cut, 'bin'), undefined)
  assert.equal(decodeText(Uint8Array.of(0x61, 0, 0x62), 'txt'), undefined)
})
