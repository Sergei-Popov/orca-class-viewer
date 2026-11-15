// Text previews of jar entries: decoding (the start of a large entry included) and lines for the
// code view, highlighted for Java-like sources and for `key: value` files. Every pass is linear,
// so a crafted line of a few megabytes cannot freeze the tab.

import type { ViewLine } from './codeview'
import { tokenizeJava } from './java'

export const TEXT_TYPES = new Set(
  'mf sf txt md properties xml json yml yaml html htm css js mjs ts kt kts java scala groovy gradle sql csv tsv conf cfg ini toml list factories imports idx policy jsp tld xsd dtd wsdl xsl xslt pom license notice'.split(' ')
)

const plain = (text: string, cls?: string): ViewLine => ({ text, spans: [{ text, cls }] })

/**
 * The entry as text, or undefined when it looks binary. `partial` bytes are the start of a longer
 * entry: a character cut off at the end is left out instead of making the text look binary.
 */
export function decodeText(bytes: Uint8Array, extension: string, partial = false): string | undefined {
  const sample = bytes.subarray(0, 65536)
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: partial }).replace(/^﻿/, '')
  } catch {
    if (TEXT_TYPES.has(extension)) return new TextDecoder('windows-1252').decode(bytes)
    return undefined
  }
}

const SPACE = /\s/
const isSpace = (ch: string) => SPACE.test(ch)

/**
 * A manifest or properties line as key, separator and value: the key starts with neither a blank
 * nor a separator and ends before the blanks in front of the first `:` or `=`; the separator takes
 * one blank after it. Found in one pass, without a backtracking regex.
 */
export function splitKeyValue(line: string): [key: string, separator: string, value: string] | undefined {
  if (!line || line[0] === ':' || line[0] === '=' || isSpace(line[0])) return undefined
  let sep = 1
  while (sep < line.length && line[sep] !== ':' && line[sep] !== '=') sep++
  if (sep === line.length) return undefined
  let keyEnd = sep
  while (keyEnd > 1 && isSpace(line[keyEnd - 1])) keyEnd--
  const valueStart = sep + 1 < line.length && isSpace(line[sep + 1]) ? sep + 2 : sep + 1
  return [line.slice(0, keyEnd), line.slice(keyEnd, valueStart), line.slice(valueStart)]
}

const COMMENT = /^\s*[#!]/

export function textLines(text: string, extension: string): ViewLine[] {
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  if (extension === 'java' || extension === 'kt' || extension === 'groovy' || extension === 'scala') {
    const state = { comment: false }
    const cls = { kw: 't-kw', type: 't-type', str: 't-str', num: 't-num', com: 't-com', ann: 't-ann', plain: undefined } as const
    return lines.map((l) => ({ text: l, spans: tokenizeJava(l, state).map((tok) => ({ text: tok.text, cls: cls[tok.kind] })) }))
  }
  if (extension === 'mf' || extension === 'sf' || extension === 'properties') {
    return lines.map((l) => {
      if (COMMENT.test(l)) return plain(l, 't-com')
      const kv = splitKeyValue(l)
      return kv ? { text: l, spans: [{ text: kv[0], cls: 't-key' }, { text: kv[1] }, { text: kv[2], cls: 't-str' }] } : plain(l)
    })
  }
  return lines.map((l) => plain(l))
}
