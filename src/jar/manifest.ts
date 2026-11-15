// META-INF/MANIFEST.MF: "Name: value" lines of at most 72 bytes, continued on lines that start
// with one space; a blank line ends the main section, and each later section describes one entry.

export type Manifest = {
  main: Map<string, string>
  /** Per-entry sections by their `Name:`. */
  entries: Map<string, Map<string, string>>
}

export function parseManifest(text: string): Manifest {
  const sections: Map<string, string>[] = [new Map()]
  let current = sections[0]
  let last: string | undefined
  for (const line of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    if (line === '') {
      if (current.size) sections.push((current = new Map()))
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
  const entries = new Map<string, Map<string, string>>()
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
