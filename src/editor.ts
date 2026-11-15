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

const locale = globalThis.orca?.locale || navigator.language || 'en'
const t = stringsFor(locale)
installStyles()
document.documentElement.lang = locale
const toast = new Toast()
const env: Env = { t, locale, saveAs: globalThis.orca?.files?.saveAs, toast: (text) => toast.show(text) }
const host = h('div', { className: 'cv-app' })
document.body.append(host, toast.el)

let view: ClassView | JarView | undefined

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

message('', t.loading, true)
const api = globalThis.orca?.document
if (!api) {
  message(t.errorTitle, t.noHost)
} else {
  let generation = 0
  api.onDidChange(async (doc) => {
    const current = ++generation
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
