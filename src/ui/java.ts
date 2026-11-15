// Java syntax colouring for the outline and for declarations in the bytecode listing: one line
// at a time, with the open block comment carried to the next line.

export type TokenKind = 'kw' | 'type' | 'str' | 'num' | 'com' | 'ann' | 'plain'

export type Token = { text: string; kind: TokenKind }

const KEYWORDS = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
    'final finally float for goto if implements import instanceof int interface long native new package private ' +
    'protected public return short static strictfp super switch synchronized this throw throws transient try void ' +
    'volatile while true false null var record sealed permits non-sealed yield module requires exports opens uses ' +
    'provides with to transitive open'
  ).split(' ')
)

const IDENT = /[\p{L}\p{Nl}$_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$]*/uy
const NUMBER = /(?:0[xX][\da-fA-F_]+[lL]?|0[bB][01_]+[lL]?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[fFdDlL]?)/y
// `\uXXXX` escapes that the viewer writes into obfuscated names belong to the name.
const ESCAPED_IDENT = /(?:[\p{L}\p{Nl}$_]|\\u[\da-fA-F]{4})(?:[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$]|\\u[\da-fA-F]{4})*/uy

/** Capitalized names are types; ALL_CAPS ones are constants, except a lone type variable. */
function isTypeName(word: string): boolean {
  return /^\p{Lu}/u.test(word) && (word.length === 1 || /\p{Ll}/u.test(word))
}

export type JavaState = { comment: boolean }

export function tokenizeJava(line: string, state: JavaState = { comment: false }): Token[] {
  const out: Token[] = []
  const push = (text: string, kind: TokenKind) => {
    if (!text) return
    const last = out[out.length - 1]
    // Spaces join the token before them, so a run of keywords is one span.
    if (last && (last.kind === kind || (/^\s+$/.test(text) && last.kind !== 'com'))) last.text += text
    else out.push({ text, kind })
  }
  let i = 0
  if (state.comment) {
    const end = line.indexOf('*/')
    if (end < 0) {
      push(line, 'com')
      return out
    }
    push(line.slice(0, end + 2), 'com')
    state.comment = false
    i = end + 2
  }
  while (i < line.length) {
    const ch = line[i]
    if (ch === '/' && line[i + 1] === '/') {
      push(line.slice(i), 'com')
      break
    }
    if (ch === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2)
      if (end < 0) {
        push(line.slice(i), 'com')
        state.comment = true
        break
      }
      push(line.slice(i, end + 2), 'com')
      i = end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
      push(line.slice(i, Math.min(line.length, j + 1)), 'str')
      i = j + 1
      continue
    }
    if (ch === '@' && line[i + 1] !== undefined) {
      ESCAPED_IDENT.lastIndex = i + 1
      const m = ESCAPED_IDENT.exec(line)
      if (m && line.slice(i + 1, i + 10) !== 'interface') {
        let end = i + 1 + m[0].length
        // A qualified annotation name: @java.lang.Deprecated
        while (line[end] === '.') {
          ESCAPED_IDENT.lastIndex = end + 1
          const next = ESCAPED_IDENT.exec(line)
          if (!next) break
          end += 1 + next[0].length
        }
        push(line.slice(i, end), 'ann')
        i = end
        continue
      }
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(line[i + 1] ?? ''))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(line)
      if (m && m[0]) {
        push(m[0], 'num')
        i += m[0].length
        continue
      }
    }
    ESCAPED_IDENT.lastIndex = i
    const m = ESCAPED_IDENT.exec(line)
    if (m) {
      const word = m[0]
      if (word === 'non' && line.startsWith('non-sealed', i)) {
        push('non-sealed', 'kw')
        i += 'non-sealed'.length
        continue
      }
      push(word, KEYWORDS.has(word) ? 'kw' : isTypeName(word) ? 'type' : 'plain')
      i += word.length
      continue
    }
    push(ch, 'plain')
    i++
  }
  return out
}

export { IDENT }
