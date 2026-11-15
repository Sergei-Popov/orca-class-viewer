// A tiny element builder, after Archive Viewer's: text goes in as text nodes, never as HTML,
// because names come from the class file. Only the static icon strings are parsed as markup.

type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue
    if (key === 'className') el.className = String(value)
    else el.setAttribute(key, value === true ? '' : String(value))
  }
  append(el, ...children)
  return el
}

export function append(el: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}

/** One of the static SVG icons as an element. */
export function svg(markup: string): Element {
  const template = document.createElement('template')
  template.innerHTML = markup
  const el = template.content.firstElementChild
  if (!el) throw new Error('empty icon')
  return el
}

/** `text` with every case-insensitive occurrence of `needle` wrapped in <mark>. */
export function highlight(text: string, needle: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const query = needle.trim().toLowerCase()
  if (!query) {
    fragment.append(text)
    return fragment
  }
  const lower = text.toLowerCase()
  let at = 0
  for (let i = lower.indexOf(query); i >= 0; i = lower.indexOf(query, at)) {
    if (i > at) fragment.append(text.slice(at, i))
    fragment.append(h('mark', {}, text.slice(i, i + query.length)))
    at = i + query.length
  }
  if (at < text.length) fragment.append(text.slice(at))
  return fragment
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage may be off in the frame; the setting just does not stick.
  }
}

/** Copies text to the clipboard, falling back to execCommand when the frame has no access. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = h('textarea', { readonly: true, 'aria-hidden': 'true' })
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.pointerEvents = 'none'
    const focused = document.activeElement
    document.body.append(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    return ok
  }
}
