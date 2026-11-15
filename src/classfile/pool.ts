// The constant pool (JVMS 4.4): every name, descriptor, literal and member reference a class
// uses. Index 0 is unused, and a Long or Double takes two slots.

import { ClassFormatError, type Reader, decodeModifiedUtf8 } from './bytes'
import { binaryName, displayName, javaString, stringText } from './names'

export const Tag = {
  Utf8: 1,
  Integer: 3,
  Float: 4,
  Long: 5,
  Double: 6,
  Class: 7,
  String: 8,
  Fieldref: 9,
  Methodref: 10,
  InterfaceMethodref: 11,
  NameAndType: 12,
  MethodHandle: 15,
  MethodType: 16,
  Dynamic: 17,
  InvokeDynamic: 18,
  Module: 19,
  Package: 20
} as const

export const TAG_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(Tag).map(([name, tag]) => [tag, name])
)

export const REFERENCE_KINDS: Record<number, string> = {
  1: 'REF_getField',
  2: 'REF_getStatic',
  3: 'REF_putField',
  4: 'REF_putStatic',
  5: 'REF_invokeVirtual',
  6: 'REF_invokeStatic',
  7: 'REF_invokeSpecial',
  8: 'REF_newInvokeSpecial',
  9: 'REF_invokeInterface'
}

export type PoolEntry =
  | { tag: 1; value: string; damaged: boolean }
  | { tag: 3; value: number }
  | { tag: 4; value: number }
  | { tag: 5; value: bigint }
  | { tag: 6; value: number }
  | { tag: 7 | 16 | 19 | 20; ref: number }
  | { tag: 8; ref: number }
  | { tag: 9 | 10 | 11; classIndex: number; natIndex: number }
  | { tag: 12; nameIndex: number; descriptorIndex: number }
  | { tag: 15; kind: number; ref: number }
  | { tag: 17 | 18; bootstrap: number; natIndex: number }

export class ConstantPool {
  /** `entries[i]` for 1 ≤ i < count; undefined for 0, the slot after a Long or Double, and
   *  slots a truncated file never reached. */
  readonly entries: (PoolEntry | undefined)[]
  readonly count: number

  constructor(entries: (PoolEntry | undefined)[], count: number) {
    this.entries = entries
    this.count = count
  }

  get(index: number): PoolEntry | undefined {
    return index > 0 && index < this.entries.length ? this.entries[index] : undefined
  }

  tagName(index: number): string {
    const entry = this.get(index)
    return entry ? TAG_NAMES[entry.tag] : '?'
  }

  /** The raw string of a Utf8 entry, or undefined. */
  utf8(index: number): string | undefined {
    const entry = this.get(index)
    return entry?.tag === Tag.Utf8 ? entry.value : undefined
  }

  /** A Utf8 entry's text, or a placeholder naming the bad index. */
  str(index: number): string {
    return this.utf8(index) ?? `<bad #${index}>`
  }

  /** The internal name of a Class entry (`java/lang/Object`). */
  className(index: number): string {
    const entry = this.get(index)
    if (entry?.tag === Tag.Class) return this.str(entry.ref)
    return `<bad #${index}>`
  }

  /** Name and descriptor of a NameAndType entry. */
  nameAndType(index: number): { name: string; descriptor: string } {
    const entry = this.get(index)
    if (entry?.tag === Tag.NameAndType) {
      return { name: this.str(entry.nameIndex), descriptor: this.str(entry.descriptorIndex) }
    }
    return { name: `<bad #${index}>`, descriptor: '' }
  }

  /** Owner, name and descriptor of a field, method or interface method reference. */
  member(index: number): { owner: string; name: string; descriptor: string } | undefined {
    const entry = this.get(index)
    if (!entry || (entry.tag !== 9 && entry.tag !== 10 && entry.tag !== 11)) return undefined
    return { owner: this.className(entry.classIndex), ...this.nameAndType(entry.natIndex) }
  }

  /** The indices an entry points at, for cross-links. */
  refs(index: number): number[] {
    const e = this.get(index)
    if (!e) return []
    switch (e.tag) {
      case 7:
      case 8:
      case 16:
      case 19:
      case 20:
        return [e.ref]
      case 9:
      case 10:
      case 11:
        return [e.classIndex, e.natIndex]
      case 12:
        return [e.nameIndex, e.descriptorIndex]
      case 15:
        return [e.ref]
      case 17:
      case 18:
        return [e.natIndex]
      default:
        return []
    }
  }

  /**
   * The resolved value in javap's style: `java/lang/Object."<init>":()V`, `String hello`,
   * `int 42`. Names keep their JVM form with hidden characters escaped; Utf8 text is escaped
   * like javap does it, so spaces stay spaces and a newline reads `\n`.
   */
  text(index: number, depth = 0): string {
    const e = this.get(index)
    if (!e) return `<bad #${index}>`
    if (depth > 4) return '…'
    switch (e.tag) {
      case 1:
        return stringText(e.value)
      case 3:
        return String(e.value)
      case 4:
        return formatFloat(e.value)
      case 5:
        return `${e.value}l`
      case 6:
        return formatDouble(e.value)
      case 7:
      case 19:
      case 20: {
        const name = this.str(e.ref)
        // javap quotes array class names: "[Ljava/lang/String;"
        return name.startsWith('[') ? `"${displayName(name)}"` : displayName(name)
      }
      case 8:
        return javaString(this.str(e.ref))
      case 16:
        return displayName(this.str(e.ref))
      case 9:
      case 10:
      case 11: {
        const m = this.member(index)
        if (!m) return '?'
        return `${displayName(m.owner)}.${quoteSpecial(m.name)}:${displayName(m.descriptor)}`
      }
      case 12: {
        const nt = this.nameAndType(index)
        return `${quoteSpecial(nt.name)}:${displayName(nt.descriptor)}`
      }
      case 15:
        return `${REFERENCE_KINDS[e.kind] ?? `kind ${e.kind}`} ${this.text(e.ref, depth + 1)}`
      case 17:
      case 18:
        return `#${e.bootstrap}:${this.text(e.natIndex, depth + 1)}`
    }
  }

  /** What an ldc or a ConstantValue pushes, as a Java literal or a short label. */
  literal(index: number): string {
    const e = this.get(index)
    if (!e) return `<bad #${index}>`
    switch (e.tag) {
      case 3:
        return String(e.value)
      case 4:
        return javaFloat(e.value)
      case 5:
        return `${e.value}L`
      case 6:
        return javaDouble(e.value)
      case 8:
        return javaString(this.str(e.ref))
      case 7:
        return `${binaryName(this.str(e.ref))}.class`
      default:
        return this.text(index)
    }
  }
}

const quoteSpecial = (name: string) => (name.startsWith('<') ? `"${name}"` : displayName(name))

/** javap's float form: `1.5f`, `NaNf`, `Infinityf`. */
export function formatFloat(value: number): string {
  return `${formatJavaNumber(value, true)}f`
}

export function formatDouble(value: number): string {
  return `${formatJavaNumber(value, false)}d`
}

/** A Java source literal: `1.5f`, `Float.NaN`, `1.0E10`. */
export function javaFloat(value: number): string {
  if (Number.isNaN(value)) return 'Float.NaN'
  if (value === Infinity) return 'Float.POSITIVE_INFINITY'
  if (value === -Infinity) return 'Float.NEGATIVE_INFINITY'
  return `${formatJavaNumber(value, true)}F`
}

export function javaDouble(value: number): string {
  if (Number.isNaN(value)) return 'Double.NaN'
  if (value === Infinity) return 'Double.POSITIVE_INFINITY'
  if (value === -Infinity) return 'Double.NEGATIVE_INFINITY'
  return formatJavaNumber(value, false)
}

/**
 * Java's `Float.toString`/`Double.toString` (JDK 19 and later): the shortest decimal that reads
 * back as the same value, but never fewer than two digits, so `Double.MIN_VALUE` is `4.9E-324`
 * rather than `5.0E-324`. Plain notation from 10⁻³ up to 10⁷, `E` exponents outside it.
 */
export function formatJavaNumber(value: number, single: boolean): string {
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  const abs = Math.abs(value)
  // `d.ddde±x`: the shortest digits that round-trip at the value's own precision.
  let shortest = single ? shortestFloat(abs) : abs.toExponential()
  // One digit is not enough for Java: it takes the two-digit decimal closest to the value.
  if (!shortest.includes('.')) shortest = abs.toExponential(1)
  const [mantissa, exponent] = shortest.split('e')
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0'
  const exp = Number(exponent)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e-3 && abs < 1e7) {
    if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`
    const whole = digits.slice(0, exp + 1).padEnd(exp + 1, '0')
    return `${sign}${whole}.${digits.slice(exp + 1) || '0'}`
  }
  return `${sign}${digits[0]}.${digits.slice(1) || '0'}E${exp}`
}

const pow10 = (k: number) => 10n ** BigInt(k)

/**
 * Float.toString's digits as `d.ddde±x`, in exact arithmetic: of the decimals with the fewest
 * digits that read back as the float, the one closest to it, ties to an even last digit. When
 * one digit is enough, the closest decimal of one or two digits. The decimals that read back
 * lie halfway to the neighbouring floats, the halves included when the significand is even;
 * below a power of two the neighbour is half as far.
 */
function shortestFloat(abs: number): string {
  const view = new DataView(new ArrayBuffer(4))
  view.setFloat32(0, abs)
  const bits = view.getUint32(0)
  const biased = (bits >>> 23) & 0xff
  const fraction = bits & 0x7fffff
  const significand = biased ? fraction | 0x800000 : fraction
  // Values in units of 2^q: the float, and the bounds of what reads back as it.
  const q = (biased || 1) - 152
  const value = 4n * BigInt(significand)
  const upper = value + 2n
  const lower = value - (fraction === 0 && biased > 1 ? 1n : 2n)
  const inclusive = significand % 2 === 0
  const num = q >= 0 ? 2n ** BigInt(q) : 1n
  const den = q < 0 ? 2n ** BigInt(-q) : 1n
  /** `units` × 2^q / 10^k as a fraction. */
  const over = (units: bigint, k: number): [bigint, bigint] => (k >= 0 ? [units * num, den * pow10(k)] : [units * num * pow10(-k), den])
  const fits = (d: bigint, k: number) => {
    const [ln, ld] = over(lower, k)
    const [un, ud] = over(upper, k)
    const above = d * ld - ln
    const below = un - d * ud
    return inclusive ? above >= 0n && below >= 0n : above > 0n && below > 0n
  }
  /** The n-digit decimals d × 10^k on either side of the float that read back as it. */
  const around = (n: number) => {
    let k = Math.floor(Math.log10(abs)) - n + 1
    let low = 0n
    for (let step = 0; step < 4; step++) {
      const [xn, xd] = over(value, k)
      low = xn / xd
      if (low >= pow10(n)) k++
      else if (low < pow10(n - 1)) k--
      else break
    }
    return { k, low, fit: [low, low + 1n].filter((d) => fits(d, k)) }
  }
  for (let n = 1; n <= 9; n++) {
    if (!around(n).fit.length) continue
    const { k, low, fit } = n === 1 ? around(2) : around(n)
    let d = fit[0]
    if (fit.length === 2) {
      // Closer to low when 2x < (2·low + 1)·10^k.
      const [xn, xd] = over(value, k)
      const c = 2n * xn - (2n * low + 1n) * xd
      d = c < 0n ? low : c > 0n ? low + 1n : low % 2n === 0n ? low : low + 1n
    }
    const s = d.toString()
    return `${s[0]}.${s.slice(1)}e${k + s.length - 1}`
  }
  return abs.toExponential(8)
}

/** Reads `constant_pool_count` and the entries. A truncated pool keeps the entries before the
 *  cut and rethrows with `pool` attached. */
export function readConstantPool(r: Reader): ConstantPool {
  const count = r.u2()
  const entries: (PoolEntry | undefined)[] = new Array(Math.max(count, 1))
  const view = new DataView(r.bytes.buffer, r.bytes.byteOffset, r.bytes.byteLength)
  try {
    for (let i = 1; i < count; i++) {
      const at = r.pos
      const tag = r.u1()
      switch (tag) {
        case Tag.Utf8: {
          const length = r.u2()
          const { text, damaged } = decodeModifiedUtf8(r.take(length, 'a constant pool string'))
          entries[i] = { tag, value: text, damaged }
          break
        }
        case Tag.Integer:
          entries[i] = { tag, value: r.s4() }
          break
        case Tag.Float:
          r.need(4)
          entries[i] = { tag, value: view.getFloat32(r.pos) }
          r.pos += 4
          break
        case Tag.Long:
        case Tag.Double: {
          r.need(8)
          const value = tag === Tag.Long ? view.getBigInt64(r.pos) : view.getFloat64(r.pos)
          entries[i] = { tag, value } as PoolEntry
          r.pos += 8
          i++ // the next slot is unusable
          break
        }
        case Tag.Class:
        case Tag.String:
        case Tag.MethodType:
        case Tag.Module:
        case Tag.Package:
          entries[i] = { tag, ref: r.u2() } as PoolEntry
          break
        case Tag.Fieldref:
        case Tag.Methodref:
        case Tag.InterfaceMethodref:
          entries[i] = { tag, classIndex: r.u2(), natIndex: r.u2() }
          break
        case Tag.NameAndType:
          entries[i] = { tag, nameIndex: r.u2(), descriptorIndex: r.u2() }
          break
        case Tag.MethodHandle:
          entries[i] = { tag, kind: r.u1(), ref: r.u2() }
          break
        case Tag.Dynamic:
        case Tag.InvokeDynamic:
          entries[i] = { tag, bootstrap: r.u2(), natIndex: r.u2() }
          break
        default:
          throw new ClassFormatError('malformed', at, `unknown constant pool tag ${tag} at entry #${i}`)
      }
    }
  } catch (error) {
    if (error instanceof ClassFormatError) {
      throw Object.assign(error, { pool: new ConstantPool(entries, count) })
    }
    throw error
  }
  return new ConstantPool(entries, count)
}
