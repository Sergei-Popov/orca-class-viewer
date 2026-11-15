// What every view needs: strings, the locale, saving, and a toast for short confirmations.

import type { SaveAsOptions } from 'orca/frame'
import { type Strings, fill } from '../i18n'
import { ClassFormatError, type FormatErrorCode } from '../classfile/bytes'
import { h } from './dom'

export type Env = {
  t: Strings
  locale: string
  saveAs?: (options: SaveAsOptions) => Promise<{ status: 'saved' | 'cancelled' }>
  toast: (text: string) => void
}

export class Toast {
  readonly el = h('div', { className: 'cv-toast', role: 'status', 'aria-live': 'polite' })
  private timer: ReturnType<typeof setTimeout> | undefined
  show(text: string): void {
    this.el.textContent = text
    this.el.classList.add('cv-show')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.el.classList.remove('cv-show'), 1800)
  }
}

/** A parser error as the UI language says it; English shows the parser's own message. */
export function reasonText(env: Env, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return reasonFor(env, error instanceof ClassFormatError ? error.code : undefined, message)
}

/** The same from an error's code and message, as damaged attributes keep them. */
export function reasonFor(env: Env, code: FormatErrorCode | undefined, message: string): string {
  const t = env.t
  if (t.ownReasons === 'yes') return message
  if (code === undefined) return t.reasonDamaged
  return code === 'truncated' ? t.reasonTruncated : t.reasonMalformed
}

export function sizeText(env: Env, bytes: number): string {
  if (bytes < 1024) return env.t.bytes(bytes)
  const units = env.locale.toLowerCase().startsWith('ru') ? ['КБ', 'МБ', 'ГБ'] : ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = value < 10 ? 1 : 0
  return `${value.toLocaleString(env.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`
}

/** Saves `data` with Orca's dialog and confirms in a toast. */
export function saveFile(env: Env, name: string, data: string | Uint8Array, mimeType?: string): void {
  if (!env.saveAs) return
  env.saveAs({ suggestedName: name, mimeType, data: typeof data === 'string' ? data : data.slice() }).then(
    (outcome) => {
      if (outcome.status === 'saved') env.toast(env.t.saved)
    },
    (error: unknown) => {
      console.warn('[class-viewer] save failed', error)
      env.toast(env.t.saveFailed)
    }
  )
}

/** A hex dump: offset, sixteen bytes, and their ASCII. */
export function hexDump(bytes: Uint8Array, limit = 256): string {
  const out: string[] = []
  const n = Math.min(bytes.length, limit)
  for (let at = 0; at < n; at += 16) {
    const row = bytes.subarray(at, Math.min(at + 16, n))
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    out.push(`${at.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`)
  }
  return out.join('\n')
}

export { fill }

/** The platform the frame runs on, as the browser names it: `MacIntel`, `Win32`, `macOS`, `Linux x86_64`. */
function platformName(): string {
  if (typeof navigator === 'undefined') return ''
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
}

/**
 * Key names for the hints, as the platform writes them (the editor takes ⌘ and Ctrl alike):
 * `{ find: '⌘F', back: '⇧Enter' }` on a Mac, `{ find: 'Ctrl+F', back: 'Shift+Enter' }` elsewhere.
 */
export function shortcuts(platform = platformName()): { find: string; back: string } {
  return /mac|iphone|ipad/i.test(platform) ? { find: '⌘F', back: '⇧Enter' } : { find: 'Ctrl+F', back: 'Shift+Enter' }
}
