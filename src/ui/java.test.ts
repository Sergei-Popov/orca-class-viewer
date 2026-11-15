import { assert, test } from 'orca/testing'
import { tokenizeJava } from './java'

const kinds = (line: string, state = { comment: false }) => tokenizeJava(line, state).filter((t) => t.text.trim()).map((t) => `${t.kind}:${t.text.trim()}`)

test('colours declarations, literals, annotations and comments', () => {
  assert.deepEqual(kinds('public static final String NAME = "a \\" b"; // note'), [
    'kw:public static final',
    'type:String',
    'plain:NAME =',
    'str:"a \\" b"',
    'plain:;',
    'com:// note'
  ])
  assert.deepEqual(kinds("@Deprecated(since = \"9\") char c = 'x';"), ['ann:@Deprecated', 'plain:(since =', 'str:"9"', 'plain:)', 'kw:char', 'plain:c =', "str:'x'", 'plain:;'])
  assert.deepEqual(kinds('long x = 0x7fffL + 1.5e3f;'), ['kw:long', 'plain:x =', 'num:0x7fffL', 'plain:+', 'num:1.5e3f', 'plain:;'])
  assert.deepEqual(kinds('public sealed interface Body permits Star, non-sealed'), ['kw:public sealed interface', 'type:Body', 'kw:permits', 'type:Star', 'plain:,', 'kw:non-sealed'])
  assert.deepEqual(kinds('public @interface Range {'), ['kw:public', 'plain:@', 'kw:interface', 'type:Range', 'plain:{'])
  assert.deepEqual(kinds('@java.lang.annotation.Retention x'), ['ann:@java.lang.annotation.Retention', 'plain:x'])
  assert.deepEqual(kinds('void a\\u200bb() { /* compiled code */ }'), ['kw:void', 'plain:a\\u200bb() {', 'com:/* compiled code */', 'plain:}'])
})

test('carries a block comment to the next line', () => {
  const state = { comment: false }
  assert.deepEqual(kinds('int a; /* starts', state), ['kw:int', 'plain:a;', 'com:/* starts'])
  assert.equal(state.comment, true)
  assert.deepEqual(kinds('still */ int b;', state), ['com:still */', 'kw:int', 'plain:b;'])
  assert.equal(state.comment, false)
  assert.deepEqual(kinds('"unterminated'), ['str:"unterminated'])
  assert.deepEqual(kinds('Ωmega ок = 1;'), ['type:Ωmega', 'plain:ок =', 'num:1', 'plain:;'])
})
