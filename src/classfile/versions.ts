// Class file versions and the Java release that introduced each one (JVMS 4.1, table 4.1-A).

/** The newest major version this viewer knows: 71, Java 27 (September 2026). */
export const NEWEST_KNOWN_MAJOR = 71

/** Minor version 0xFFFF marks a class compiled with preview features (Java 12 and later). */
export const PREVIEW_MINOR = 0xffff

export type JavaRelease = {
  /** "1.1", "1.4", "5", "17" */
  release: string
  /** Release as a number for sorting: 1.1 → 1.1, 5 → 5. */
  order: number
  /** Compiled with `--enable-preview`. */
  preview: boolean
  /** Major version past the newest one this viewer knows. */
  newer: boolean
  /** Major version below 45: no Java release produces it. */
  unknown: boolean
}

export function javaRelease(major: number, minor = 0): JavaRelease {
  const preview = major >= 56 && minor === PREVIEW_MINOR
  if (major < 45) {
    return { release: '?', order: 0, preview: false, newer: false, unknown: true }
  }
  if (major <= 48) {
    const release = major === 45 ? (minor >= 3 ? '1.1' : '1.0') : `1.${major - 44}`
    return { release, order: Number(release), preview: false, newer: false, unknown: false }
  }
  const n = major - 44
  return { release: String(n), order: n, preview, newer: major > NEWEST_KNOWN_MAJOR, unknown: false }
}

/** Short label such as "Java 17", "Java 21 preview", "Java 1.4". */
export function releaseLabel(major: number, minor = 0): string {
  const info = javaRelease(major, minor)
  if (info.unknown) return `major ${major}`
  return `Java ${info.release}${info.preview ? ' preview' : ''}`
}
