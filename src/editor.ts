// The custom editor: Orca opens a .class file (by default) or a .jar, .war, .ear, .jmod or .aar
// (as an option of the view toggle) in a main editor tab here and sends its bytes. Orca keeps
// files over about 50 MiB out of custom editors and shows its own notice instead. The viewer never
// edits, so Orca never saves the tab; an outside write sends new bytes and the view reloads.

import { stringsFor } from './i18n'
import { jarKind } from './jar/jar'
import { ClassView } from './ui/classview'
import { h, svg } from './ui/dom'
import { type Env, Toast } from './ui/env'
import { icon } from './ui/icons'
import { JarView } from './ui/jarview'
import { installStyles } from './ui/styles'

const ARCHIVES = new Set(['jar', 'war', 'ear', 'jmod', 'aar'])

// Orca's UI language, never the system's: Orca may be in English on a Russian Mac.
const uiLocale = (): string => globalThis.orca?.locale || 'en'

installStyles()
const toast = new Toast()
const env: Env = { t: stringsFor(uiLocale()), locale: uiLocale(), saveAs: globalThis.orca?.files?.saveAs, toast: (text) => toast.show(text) }
document.documentElement.lang = env.locale
const host = h('div', { className: 'cv-app' })
document.body.append(host, toast.el)

let view: ClassView | JarView | undefined

/** Orca's language may arrive after this module runs; it is surely in by the first document. */
function syncLocale(): boolean {
  const locale = uiLocale()
  if (locale === env.locale) return false
  env.locale = locale
  env.t = stringsFor(locale)
  document.documentElement.lang = locale
  return true
}

function message(title: string, text: string, busy = false): void {
  view = undefined
  host.replaceChildren(
    h('div', { className: 'cv-center' }, busy ? h('div', { className: 'cv-spinner', role: 'progressbar', 'aria-label': text }) : svg(icon('warning')), title ? h('h2', {}, title) : null, h('p', {}, text))
  )
}

document.addEventListener('keydown', (event) => {
  if (!view || event.altKey) return
  const mod = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  if (mod && !event.shiftKey && (event.code === 'KeyF' || key === 'f')) {
    event.preventDefault()
    view.focusFind()
  } else if ((mod && (event.code === 'KeyG' || key === 'g')) || event.key === 'F3') {
    event.preventDefault()
    view.stepFind(event.shiftKey ? -1 : 1)
  }
})

message('', env.t.loading, true)
const api = globalThis.orca?.document
if (!api) {
  message(env.t.errorTitle, env.t.noHost)
} else {
  let generation = 0
  api.onDidChange(async (doc) => {
    const current = ++generation
    // Views keep the strings they were made with, so a new language makes new ones.
    if (syncLocale()) view = undefined
    const t = env.t
    if (doc.content.kind !== 'bytes') {
      message(t.errorTitle, t.textContent)
      return
    }
    // Let the spinner paint before a big jar is read on this thread.
    await new Promise((resolve) => setTimeout(resolve, 16))
    if (current !== generation) return
    const bytes = new Uint8Array(doc.content.bytes)
    const type = (doc.fileType ?? '').toLowerCase().replace(/^\./, '')
    try {
      if (ARCHIVES.has(type)) {
        const jar = view instanceof JarView ? view : new JarView(env)
        if (jar !== view) host.replaceChildren(jar.root)
        view = jar
        jar.show(bytes, jarKind(type))
      } else {
        const cls = view instanceof ClassView ? view : new ClassView(env)
        if (cls !== view) host.replaceChildren(cls.root)
        view = cls
        cls.show(bytes)
      }
    } catch (error) {
      if (current !== generation) return
      console.warn('[class-viewer] cannot show the file', error)
      message(t.errorTitle, error instanceof Error ? error.message : String(error))
    }
  })
}
