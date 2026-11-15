import { assert, test } from 'orca/testing'
import { css } from './styles'

// Listing images: in a 635 px detail pane the constant pool's columns needed 764 px, so the Used
// column sat off-screen and values were cut without an ellipsis. The table now fits 564 px, and
// the Value column is the one that gives way.
test('the constant pool table fits a narrow detail pane', () => {
  const rule = /\.cv-thead, \.cv-trow \{\s*display: grid; grid-template-columns: ([^;]+); gap: 0 (\d+)px;[^}]*?padding: 0 (\d+)px;/.exec(css)
  assert.ok(rule, 'the pool row grid')
  const tracks = rule[1].match(/minmax\([^)]*\)|\S+/g) ?? []
  assert.equal(tracks.length, 5)
  const mins = tracks.map((track) => Number(/(\d+)px/.exec(track)?.[1]))
  const total = mins.reduce((a, b) => a + b, 0) + Number(rule[2]) * (tracks.length - 1) + Number(rule[3]) * 2
  assert.ok(total <= 600, `the columns need ${total} px`)
  // "#65535.#65535" in 12 px monospace is about 94 px.
  assert.ok(mins[2] >= 96, 'Refers to holds two five-digit indexes')
  assert.ok(tracks[3].endsWith('1fr)'), 'Value takes the space that is left')
})
