// Which JVM language compiled a class, from the traces compilers leave: Kotlin's @Metadata,
// Scala's ScalaSig/TASTY attributes, Groovy's GroovyObject, and the SourceFile name.

import { type Annotation, type ElementValue, findAttribute } from './attributes'
import type { ClassFile } from './classfile'
import type { ConstantPool } from './pool'

export type Language = 'java' | 'kotlin' | 'scala' | 'groovy' | 'clojure' | 'other'

export type KotlinInfo = {
  /** 1 class, 2 file facade, 3 synthetic class (lambdas, `when` mappings), 4 multi-file facade, 5 multi-file part. */
  kind: number
  /**
   * `mv`, the version of the @Metadata format, "1.9.0". It is not the compiler's version: Kotlin
   * 1.3.72 wrote 1.1.16, and 1.9.22 writes 1.9.0. The class file does not record the compiler.
   */
  metadataVersion?: string
  /** Package name when it differs from the JVM package (`pn`). */
  packageName?: string
  /** `xs`: the facade class of a multi-file part. */
  extra?: string
}

export type LanguageInfo = {
  language: Language
  kotlin?: KotlinInfo
  /** Scala 3 classes carry a TASTY attribute, Scala 2 a ScalaSig. */
  scalaVersion?: '2' | '3'
  /** The SourceFile attribute, if any. */
  sourceFile?: string
}

const EXTENSIONS: Record<string, Language> = {
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',
  gvy: 'groovy',
  clj: 'clojure',
  cljc: 'clojure'
}

/** Every annotation on the class, visible and invisible. */
export function classAnnotations(cls: ClassFile): Annotation[] {
  return cls.attributes.flatMap((a) => (a.value.kind === 'Annotations' ? a.value.annotations : []))
}

export function detectLanguage(cls: ClassFile): LanguageInfo {
  const pool = cls.pool
  const source = findAttribute(cls.attributes, 'SourceFile')
  const sourceFile = source ? pool.utf8(source.value.index) : undefined
  const annotations = classAnnotations(cls)
  const metadata = annotations.find((a) => pool.utf8(a.typeIndex) === 'Lkotlin/Metadata;')
  if (metadata) return { language: 'kotlin', kotlin: kotlinInfo(pool, metadata), sourceFile }
  const names = new Set(cls.attributes.map((a) => a.name))
  if (names.has('TASTY')) return { language: 'scala', scalaVersion: '3', sourceFile }
  if (
    names.has('ScalaSig') ||
    names.has('Scala') ||
    annotations.some((a) => pool.utf8(a.typeIndex) === 'Lscala/reflect/ScalaSignature;')
  ) {
    return { language: 'scala', scalaVersion: '2', sourceFile }
  }
  if (cls.interfaces.includes('groovy/lang/GroovyObject')) return { language: 'groovy', sourceFile }
  const ext = sourceFile?.slice(sourceFile.lastIndexOf('.') + 1).toLowerCase()
  if (ext && EXTENSIONS[ext]) return { language: EXTENSIONS[ext], sourceFile }
  if (ext) return { language: 'other', sourceFile }
  return { language: 'java', sourceFile }
}

function element(a: Annotation, pool: ConstantPool, name: string): ElementValue | undefined {
  return a.elements.find((e) => pool.utf8(e.nameIndex) === name)?.value
}

function kotlinInfo(pool: ConstantPool, a: Annotation): KotlinInfo {
  const int = (v: ElementValue | undefined): number | undefined => {
    if (!v || v.tag !== 'I') return undefined
    const e = pool.get(v.index)
    return e?.tag === 3 ? e.value : undefined
  }
  const str = (v: ElementValue | undefined): string | undefined => (v?.tag === 's' ? pool.utf8(v.index) : undefined)
  const mv = element(a, pool, 'mv')
  const version = mv?.tag === '[' ? mv.values.map(int).filter((n) => n !== undefined).join('.') : undefined
  return {
    kind: int(element(a, pool, 'k')) ?? 1,
    metadataVersion: version || undefined,
    packageName: str(element(a, pool, 'pn')) || undefined,
    extra: str(element(a, pool, 'xs')) || undefined
  }
}
