// META-INF/MANIFEST.MF: "Name: value" lines of at most 72 bytes, continued on lines that start
// with one space; a blank line ends the main section, and each later section describes one entry.

const asciiLower = (name: string) => name.replace(/[A-Z]+/g, (s) => s.toLowerCase())

/**
 * The attributes of one section. java.util.jar.Attributes.Name matches names in any case of their
 * ASCII letters, so `main-class:` is the Main-Class, and a later line replaces an earlier one.
 */
export class Attributes {
  private readonly values = new Map<string, string>()

  get size(): number {
    return this.values.size
  }

  get(name: string): string | undefined {
    return this.values.get(asciiLower(name))
  }

  set(name: string, value: string): void {
    this.values.set(asciiLower(name), value)
  }
}

export type Manifest = {
  main: Attributes
  /** Per-entry sections by their `Name:`. */
  entries: Map<string, Attributes>
}

export function parseManifest(text: string): Manifest {
  const sections: Attributes[] = [new Attributes()]
  let current = sections[0]
  let last: string | undefined
  // A byte order mark first, as some editors write it, is not part of the first name.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (current.size) sections.push((current = new Attributes()))
      last = undefined
      continue
    }
    if (line.startsWith(' ')) {
      if (last !== undefined) current.set(last, (current.get(last) ?? '') + line.slice(1))
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    last = line.slice(0, colon).trim()
    current.set(last, line.slice(colon + 1).replace(/^ /, ''))
  }
  const main = sections[0]
  const entries = new Map<string, Attributes>()
  for (const section of sections.slice(1)) {
    const name = section.get('Name')
    if (name !== undefined) entries.set(name, section)
  }
  return { main, entries }
}

/** Attributes worth showing first, in this order; the rest follow as they come. */
export const KEY_ATTRIBUTES = [
  'Main-Class',
  'Start-Class',
  'Automatic-Module-Name',
  'Multi-Release',
  'Launcher-Agent-Class',
  'Premain-Class',
  'Agent-Class',
  'Implementation-Title',
  'Implementation-Version',
  'Implementation-Vendor',
  'Bundle-SymbolicName',
  'Bundle-Version',
  'Created-By',
  'Build-Jdk-Spec',
  'Build-Jdk',
  'Class-Path'
]
