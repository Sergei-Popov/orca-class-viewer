// A stand-in for the few DOM calls the Structure view makes, so a test can build the view, click
// a button and read the text. It is no browser: no layout, no styles, and no markup parsing (an
// icon's markup becomes an empty <svg>).

class FakeNode {
  parent: FakeElement | null = null
  get textContent(): string {
    return ''
  }
  remove(): void {
    if (!this.parent) return
    const siblings = this.parent.childNodes
    siblings.splice(siblings.indexOf(this), 1)
    this.parent = null
  }
}

class FakeText extends FakeNode {
  readonly data: string
  constructor(data: string) {
    super()
    this.data = data
  }
  override get textContent(): string {
    return this.data
  }
}

type Listener = (event: { type: string; target: FakeElement }) => void

export class FakeElement extends FakeNode {
  readonly tagName: string
  readonly childNodes: FakeNode[] = []
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}
  hidden = false
  private readonly listeners = new Map<string, Listener[]>()

  constructor(tag: string) {
    super()
    this.tagName = tag.toUpperCase()
  }

  get className(): string {
    return this.attributes.get('class') ?? ''
  }
  set className(value: string) {
    this.attributes.set('class', value)
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean)
    return {
      add: (...add: string[]) => (this.className = [...new Set([...names(), ...add])].join(' ')),
      remove: (...drop: string[]) => (this.className = names().filter((n) => !drop.includes(n)).join(' ')),
      contains: (name: string) => names().includes(name)
    }
  }
  get dataset(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of this.attributes) if (k.startsWith('data-')) out[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v
    return out
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement)
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null
  }
  override get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('')
  }
  set textContent(value: string) {
    for (const n of [...this.childNodes]) n.remove()
    if (value) this.append(value)
  }
  /** A template's content: its markup is not parsed, an icon becomes an empty <svg>. */
  set innerHTML(_markup: string) {
    for (const n of [...this.childNodes]) n.remove()
    this.append(new FakeElement('svg'))
  }
  get content(): FakeElement {
    return this
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new FakeText(n) : n
      if (node instanceof FakeElement && node.tagName === '#FRAGMENT') {
        for (const c of [...node.childNodes]) this.append(c)
        continue
      }
      node.remove()
      node.parent = this
      this.childNodes.push(node)
    }
  }
  after(...nodes: FakeNode[]): void {
    const parent = this.parent
    if (!parent) return
    let at = parent.childNodes.indexOf(this) + 1
    for (const node of nodes) {
      node.remove()
      node.parent = parent
      parent.childNodes.splice(at++, 0, node)
    }
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  /** A click on this element, bubbling up to its ancestors. */
  click(): void {
    for (let el: FakeElement | null = this; el; el = el.parent) for (const l of el.listeners.get('click') ?? []) l({ type: 'click', target: this })
  }
  /** The nearest ancestor-or-self with one of the attributes of an `[a],[b]` selector. */
  closest(selector: string): FakeElement | null {
    const names = [...selector.matchAll(/\[([\w-]+)\]/g)].map((m) => m[1])
    for (let el: FakeElement | null = this; el; el = el.parent) if (names.some((n) => el?.attributes.has(n))) return el
    return null
  }

  /** Every element below this one, depth first, that `match` accepts. */
  findAll(match: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = []
    const stack = [...this.children].reverse()
    for (let el = stack.pop(); el; el = stack.pop()) {
      if (match(el)) out.push(el)
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i])
    }
    return out
  }
}

/** Runs `body` with `document` and `Element` set to the stand-in, then puts them back. */
export function withFakeDom<T>(body: () => T): T {
  const g = globalThis as Record<string, unknown>
  const saved = { document: g.document, Element: g.Element }
  g.document = {
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => new FakeText(text),
    createDocumentFragment: () => new FakeElement('#fragment')
  }
  g.Element = FakeElement
  try {
    return body()
  } finally {
    g.document = saved.document
    g.Element = saved.Element
  }
}
