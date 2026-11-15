// Names as the JVM stores them (`java/util/Map$Entry`) and as people read them. Obfuscators
// like names made of control characters, zero-width or right-to-left marks and blanks; those are
// shown as `\uXXXX` escapes so every name stays visible and tells apart from its neighbours.

const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Z}\u{fffd}]/gu
const STRING_HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu

const escapeChar = (ch: string): string => {
  let out = ''
  for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`
  return out
}

/** A JVM name with invisible and blank characters escaped. */
export function displayName(name: string): string {
  if (name === '') return '""'
  return name.replace(HIDDEN, escapeChar)
}

/** True when `displayName` changes the name. */
export function hasHiddenCharacters(name: string): boolean {
  HIDDEN.lastIndex = 0
  const found = HIDDEN.test(name)
  HIDDEN.lastIndex = 0
  return found
}

/** `java/util/Map$Entry` → `java.util.Map$Entry`. */
export function binaryName(internal: string): string {
  return displayName(internal.replace(/\//g, '.'))
}

/** `java/util/Map$Entry` → `Map$Entry`. */
export function simpleName(internal: string): string {
  return displayName(internal.slice(internal.lastIndexOf('/') + 1))
}

/** `java/util/Map$Entry` → `java/util`; the default package is `''`. */
export function packageOf(internal: string): string {
  const slash = internal.lastIndexOf('/')
  return slash < 0 ? '' : internal.slice(0, slash)
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  "'": "\\'",
  '\\': '\\\\'
}

/** A Java string literal for `value`, with control and invisible characters escaped. */
export function javaString(value: string): string {
  let out = '"'
  for (const ch of value) {
    if (ch === "'") out += ch
    else if (SIMPLE_ESCAPES[ch]) out += SIMPLE_ESCAPES[ch]
    else if (ch.match(STRING_HIDDEN)) out += escapeChar(ch)
    else out += ch
  }
  return `${out}"`
}

/** A Java char literal for a UTF-16 code unit. */
export function javaChar(code: number): string {
  const ch = String.fromCharCode(code)
  if (SIMPLE_ESCAPES[ch]) return `'${SIMPLE_ESCAPES[ch]}'`
  if (ch.match(STRING_HIDDEN) || ch.match(/\p{Z}/u) && ch !== ' ') return `'${escapeChar(ch)}'`
  return `'${ch}'`
}

export const JAVA_KEYWORDS = new Set(
  (
    'abstract assert boolean break byte case catch char class const continue default do double ' +
    'else enum extends final finally float for goto if implements import instanceof int interface ' +
    'long native new package private protected public return short static strictfp super switch ' +
    'synchronized this throw throws transient try void volatile while true false null _'
  ).split(' ')
)
