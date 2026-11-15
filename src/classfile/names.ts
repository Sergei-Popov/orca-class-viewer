// Names as the JVM stores them (`java/util/Map$Entry`) and as people read them. Obfuscators
// like names made of control characters, zero-width or right-to-left marks, unassigned code
// points and look-alike blanks; those are shown as escapes so every name stays visible and tells
// apart from its neighbours. A plain space inside a name stays a space: Kotlin and Groovy test
// names (`adding an item works`) have them.

/** Characters escaped in names: controls, format and private-use characters, surrogates,
 *  unassigned code points and noncharacters, blanks, and the replacement character. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Z}\u{fffd}]/gu
/** Characters escaped in string data: what would not show, or would move the text around. */
const STRING_HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u
/** Characters `stringText` changes, for a quick check before the per-character pass. */
const STRING_ESCAPED = /[\\"'\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Cn}\p{Zl}\p{Zp}]/u

const SHORT_ESCAPES: Record<string, string> = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' }

const escapeChar = (ch: string): string => {
  let out = ''
  for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`
  return out
}

/** A JVM name with invisible characters escaped: `\t`, `\n` and the like for the common
 *  controls, `\uXXXX` for the rest. A space is escaped only at either end of the name. */
export function displayName(name: string): string {
  if (name === '') return '""'
  const last = name.length - 1
  return name.replace(HIDDEN, (ch: string, at: number) => {
    if (ch === ' ' && at > 0 && at < last) return ch
    return SHORT_ESCAPES[ch] ?? escapeChar(ch)
  })
}

/** True when `displayName` changes the name. */
export function hasHiddenCharacters(name: string): boolean {
  return name !== '' && displayName(name) !== name
}

/**
 * String data without the surrounding quotes, as `javap -v` prints String and Utf8 constants:
 * Java's backslash escapes (`\t`, `\n`, `\"`, `\'`, `\\`…), spaces kept, and characters that
 * would not show as `\uXXXX`.
 */
export function stringText(value: string): string {
  if (!STRING_ESCAPED.test(value)) return value
  let out = ''
  for (const ch of value) out += SIMPLE_ESCAPES[ch] ?? (STRING_HIDDEN.test(ch) ? escapeChar(ch) : ch)
  return out
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
    else if (STRING_HIDDEN.test(ch)) out += escapeChar(ch)
    else out += ch
  }
  return `${out}"`
}

/** A Java char literal for a UTF-16 code unit. */
export function javaChar(code: number): string {
  const ch = String.fromCharCode(code)
  if (SIMPLE_ESCAPES[ch]) return `'${SIMPLE_ESCAPES[ch]}'`
  if (STRING_HIDDEN.test(ch) || (/\p{Z}/u.test(ch) && ch !== ' ')) return `'${escapeChar(ch)}'`
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
