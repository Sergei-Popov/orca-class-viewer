// The Structure tab: the class file as it is laid out — header, fields, methods and every
// attribute with its offset and length, the known ones decoded, the rest as hex.

import type { AttributeInfo } from '../classfile/attributes'
import { MAX_LINE_CHARS, MAX_STRUCTURE_ROWS, RowBudget, joinWithin } from '../classfile/budget'
import type { ClassFile, Member } from '../classfile/classfile'
import { annotationText, makeNamer } from '../classfile/declarations'
import { flagNames, flagSummary } from '../classfile/flags'
import type { LanguageInfo } from '../classfile/language'
import { binaryName, displayName } from '../classfile/names'
import { javaRelease } from '../classfile/versions'
import { h } from './dom'
import { type Env, fill, hexDump, reasonFor, sizeText } from './env'

export type StructureActions = {
  showPool: (index: number) => void
  showMethod: (index: number) => void
  /** Opens a class of the same archive; undefined when there is none at hand. */
  openClass?: (name: string) => void
  hasClass?: (name: string) => boolean
  /** Called once the tab leaves rows out. */
  cut?: () => void
}

const hex4 = (n: number) => `0x${n.toString(16).padStart(4, '0')}`

/** A member's attribute names stop after about this many characters. */
const NAMES_CHARS = 200

/**
 * The Structure tab. What it builds at once takes rows from one budget of `limit`; the attributes
 * of a member, built on a click, from a budget of their own. A list that does not fit ends with a
 * count of what is left out.
 */
export function buildStructure(cls: ClassFile, lang: LanguageInfo, env: Env, actions: StructureActions, limit = MAX_STRUCTURE_ROWS): HTMLElement {
  const t = env.t
  const pool = cls.pool
  const namer = makeNamer(cls, true)
  const doc = h('div', { className: 'cv-doc' })
  const budget = new RowBudget(limit)
  let reported = false
  /** "… 12 more not shown: the tab is full" */
  const more = (n: number, tag: 'p' | 'span' = 'p') => {
    if (!reported) {
      reported = true
      actions.cut?.()
    }
    return h(tag, { className: 'cv-hint cv-more' }, fill(t.structureMore, { n: n.toLocaleString(env.locale) }))
  }

  const cp = (index: number) => h('button', { className: 'cv-a t-cp cv-mono', 'data-cp': index, title: fill(t.showPool, { n: index }) }, `#${index}`)
  const className = (internal: string) => {
    const text = displayName(binaryName(internal))
    if (actions.openClass && actions.hasClass?.(internal) && internal !== cls.name) {
      return h('button', { className: 'cv-a cv-mono', 'data-class': internal, title: fill(t.openClass, { name: text }) }, text)
    }
    return h('span', { className: 'cv-mono' }, text)
  }
  const classRef = (index: number) => {
    const span = h('span', {})
    if (!index) {
      span.append(h('span', { className: 'cv-hint' }, t.none))
      return span
    }
    span.append(className(pool.className(index)), ' ', cp(index))
    return span
  }
  const section = (title: string, count: number | undefined, open: boolean, ...body: (Node | null)[]) => {
    const summary = h('summary', {}, title)
    if (count !== undefined) summary.append(h('span', { className: 'cv-count' }, count.toLocaleString(env.locale)))
    const details = h('details', open ? { open: true } : {}, summary, h('div', { className: 'cv-sec' }, ...body.filter((b): b is Node => b !== null)))
    doc.append(details)
  }
  const kv = (rows: [string, Node | string][]) => {
    const dl = h('dl', { className: 'cv-kv' })
    for (const [k, v] of rows) dl.append(h('dt', {}, k), h('dd', {}, v))
    return dl
  }

  // The class header.
  const release = javaRelease(cls.major, cls.minor)
  const versionText = `${cls.major}.${cls.minor} · ${release.unknown ? '?' : fill(release.preview ? t.javaPreview : t.java, { n: release.release })}`
  const interfaces = h('span', {})
  for (let k = 0; k < cls.interfaceIndices.length; k++) {
    const i = cls.interfaceIndices[k]
    if (!budget.line(pool.className(i).length)) {
      interfaces.append(' ', more(cls.interfaceIndices.length - k, 'span'))
      break
    }
    if (k) interfaces.append(', ')
    interfaces.append(classRef(i))
  }
  const rows: [string, Node | string][] = [
    [t.fileSize, `${sizeText(env, cls.size)} (${cls.size.toLocaleString(env.locale)})`],
    [t.magic, h('span', { className: 'cv-mono' }, 'CA FE BA BE')],
    [t.version, versionText],
    [t.accessFlags, h('span', { className: 'cv-mono' }, flagSummary(cls.access, 'class'))],
    [t.thisClass, classRef(cls.thisIndex)],
    [t.superClass, classRef(cls.superIndex)],
    [t.interfaces, cls.interfaceIndices.length ? interfaces : h('span', { className: 'cv-hint' }, t.none)],
    [t.constantPool, t.poolEntries(Math.max(0, pool.count - 1))]
  ]
  if (lang.sourceFile) rows.push([t.sourceFile, h('span', { className: 'cv-mono' }, displayName(lang.sourceFile))])
  if (lang.language !== 'java' && lang.language !== 'other') {
    const name = { kotlin: t.languageKotlin, scala: t.languageScala, groovy: t.languageGroovy, clojure: t.languageClojure }[lang.language]
    rows.push([t.language, lang.scalaVersion ? `${name} ${lang.scalaVersion}` : name])
    // @Metadata keeps the version of its own format, not of the compiler that wrote it.
    if (lang.kotlin?.metadataVersion) rows.push([t.kotlinMetadata, lang.kotlin.metadataVersion])
    if (lang.kotlin?.kind !== undefined) rows.push([t.kotlinKind, t.kotlinKinds[lang.kotlin.kind - 1] ?? String(lang.kotlin.kind)])
  }
  section(t.secClass, undefined, true, kv(rows))

  // Fields and methods.
  const memberTable = (members: Member[], kind: 'field' | 'method') => {
    const table = h('table', { className: 'cv-grid' })
    const head = h('tr', {}, h('th', {}, t.colFlags), h('th', {}, t.colName), h('th', {}, t.colDescriptor))
    if (kind === 'method') head.append(h('th', {}, t.colCode))
    head.append(h('th', {}, t.colAttributes))
    const columns = kind === 'method' ? 5 : 4
    table.append(h('thead', {}, head))
    const body = h('tbody', {})
    for (let k = 0; k < members.length; k++) {
      const m = members[k]
      if (!budget.line(m.name.length + m.descriptor.length + 40)) {
        body.append(h('tr', {}, h('td', { colspan: columns }, more(members.length - k))))
        break
      }
      const name =
        kind === 'method'
          ? h('button', { className: 'cv-a cv-mono', 'data-method': k, title: t.showBytecode }, displayName(m.name))
          : h('span', { className: 'cv-mono' }, displayName(m.name))
      const row = h('tr', {}, h('td', { className: 'cv-mono cv-words', title: flagNames(m.access, kind).join(', ') }, `${hex4(m.access)} ${javaFlags(m.access, kind)}`), h('td', {}, name), h('td', { className: 'cv-mono' }, displayName(m.descriptor)))
      if (kind === 'method') {
        const code = m.attributes.find((a) => a.name === 'Code')
        const cell = h('td', { className: 'cv-mono cv-words' })
        if (code?.value.kind === 'Code') {
          const c = code.value.code
          cell.append(fill(t.codeSummary, { size: t.bytes(c.code.length), stack: c.maxStack, locals: c.maxLocals }))
        } else if (code?.error) {
          cell.append(h('span', { className: 't-bad', title: reasonFor(env, code.errorCode, code.error) }, t.damagedBadge))
        } else cell.append('—')
        row.append(cell)
      }
      row.append(memberAttributes(m, row, columns))
      body.append(row)
    }
    table.append(body)
    return table
  }
  section(t.secFields, cls.fields.length, cls.fields.length > 0 && cls.fields.length <= 60, cls.fields.length ? memberTable(cls.fields, 'field') : h('p', { className: 'cv-hint' }, t.none))
  section(t.secMethods, cls.methods.length, cls.methods.length > 0 && cls.methods.length <= 60, cls.methods.length ? memberTable(cls.methods, 'method') : h('p', { className: 'cv-hint' }, t.none))

  // Class attributes.
  const attrs = h('div', {})
  attributeBlocks(attrs, cls.attributes, budget)
  section(t.secAttributes, cls.attributes.length, true, cls.attributes.length ? attrs : h('p', { className: 'cv-hint' }, t.none))

  doc.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const el = target?.closest<HTMLElement>('[data-cp],[data-method],[data-class]')
    if (!el) return
    if (el.dataset.cp) actions.showPool(Number(el.dataset.cp))
    else if (el.dataset.method) actions.showMethod(Number(el.dataset.method))
    else if (el.dataset.class) actions.openClass?.(el.dataset.class)
  })
  return doc

  /** A member's attribute names; a click opens a row below with each attribute in full. */
  function memberAttributes(m: Member, row: HTMLElement, columns: number): HTMLElement {
    const cell = h('td', { className: 'cv-mono cv-words' })
    if (!m.attributes.length) {
      cell.append('—')
      return cell
    }
    const button = h('button', { className: 'cv-a cv-mono', type: 'button', 'aria-expanded': 'false', title: t.showAttributes })
    // A crafted member may carry 65,535 attributes: the names stop after a line's worth.
    let chars = 0
    for (let k = 0; k < m.attributes.length; k++) {
      const a = m.attributes[k]
      if (k && chars > NAMES_CHARS) {
        button.append(`, … +${(m.attributes.length - k).toLocaleString(env.locale)}`)
        break
      }
      if (k) button.append(', ')
      const shown = displayName(a.name)
      chars += shown.length + 2
      button.append(a.error ? h('span', { className: 't-bad', title: reasonFor(env, a.errorCode, a.error) }, shown) : shown)
    }
    let detail: HTMLTableRowElement | undefined
    button.addEventListener('click', () => {
      if (!detail) {
        const blocks = h('td', { colspan: columns })
        attributeBlocks(blocks, m.attributes, new RowBudget(limit))
        detail = h('tr', { className: 'cv-attr-row' }, blocks)
        row.after(detail)
      } else detail.hidden = !detail.hidden
      button.setAttribute('aria-expanded', String(!detail.hidden))
    })
    cell.append(button)
    return cell
  }

  /** Blocks of `attributes` while `rows` lasts, then a count of the rest. */
  function attributeBlocks(into: HTMLElement, attributes: AttributeInfo[], rows: RowBudget): void {
    for (let k = 0; k < attributes.length; k++) {
      if (!rows.line(attributes[k].name.length + 40)) {
        into.append(more(attributes.length - k))
        return
      }
      into.append(attributeBlock(attributes[k], rows))
    }
  }

  function attributeBlock(a: AttributeInfo, rows: RowBudget): HTMLElement {
    const block = h('div', { className: 'cv-attr' })
    block.append(
      h(
        'div',
        { className: 'cv-attr-head' },
        h('strong', {}, displayName(a.name)),
        h('span', { className: 'cv-hint' }, `${t.bytes(a.length)} · ${t.colOffset} ${a.offset.toLocaleString(env.locale)}`),
        cp(a.nameIndex)
      )
    )
    const body = h('div', { className: 'cv-attr-body' })
    block.append(body)
    const v = a.value
    /** Items of a list, comma-separated, while `rows` lasts. */
    const list = (count: number, item: (i: number) => { node: Node | string; chars: number }) => {
      const p = h('div', { className: 'cv-mono' })
      body.append(p)
      for (let k = 0; k < count; k++) {
        const { node, chars } = item(k)
        if (!rows.line(chars)) {
          body.append(more(count - k))
          return
        }
        if (k) p.append(', ')
        p.append(node)
      }
    }
    const pre = (text: string) => h('pre', { className: 'cv-pre' }, text)
    /** Lines of one block of text while `rows` lasts. */
    const lines = (count: number, line: (i: number) => string) => {
      const out: string[] = []
      for (let i = 0; i < count; i++) {
        const text = line(i)
        if (!rows.line(text.length)) {
          body.append(pre(out.join('\n')), more(count - i))
          return
        }
        out.push(text)
      }
      body.append(pre(out.join('\n')))
    }
    /** Rows of a table while `rows` lasts. */
    const tableRows = (tb: HTMLElement, columns: number, count: number, row: (i: number) => { node: HTMLElement; chars: number }) => {
      for (let i = 0; i < count; i++) {
        const r = row(i)
        if (!rows.line(r.chars)) {
          tb.append(h('tr', {}, h('td', { colspan: columns }, more(count - i))))
          return
        }
        tb.append(r.node)
      }
    }
    switch (v.kind) {
      case 'SourceFile':
      case 'Signature':
        body.append(h('span', { className: 'cv-mono' }, displayName(pool.str(v.index))), ' ', cp(v.index))
        break
      case 'NestHost':
      case 'ModuleMainClass':
        body.append(classRef(v.index))
        break
      case 'NestMembers':
      case 'PermittedSubclasses':
        list(v.indices.length, (i) => {
          const name = pool.className(v.indices[i])
          return { node: className(name), chars: name.length }
        })
        break
      case 'ModulePackages':
        list(v.indices.length, (i) => {
          const text = displayName(pool.text(v.indices[i]).replace(/\//g, '.'))
          return { node: h('span', {}, text), chars: text.length }
        })
        break
      case 'InnerClasses': {
        const table = h('table', { className: 'cv-grid' }, h('thead', {}, h('tr', {}, h('th', {}, t.colInner), h('th', {}, t.colOuter), h('th', {}, t.colSimple), h('th', {}, t.colFlags))))
        const tb = h('tbody', {})
        tableRows(tb, 4, v.classes.length, (i) => {
          const c = v.classes[i]
          const node = h(
            'tr',
            {},
            h('td', {}, c.inner ? className(pool.className(c.inner)) : '—'),
            h('td', {}, c.outer ? className(pool.className(c.outer)) : '—'),
            h('td', { className: 'cv-mono' }, c.nameIndex ? displayName(pool.str(c.nameIndex)) : '—'),
            h('td', { className: 'cv-mono cv-words' }, `${hex4(c.access)} ${javaFlags(c.access, 'inner')}`)
          )
          return { node, chars: node.textContent?.length ?? 0 }
        })
        table.append(tb)
        body.append(table)
        break
      }
      case 'EnclosingMethod': {
        const nat = v.methodIndex ? pool.nameAndType(v.methodIndex) : undefined
        body.append(classRef(v.classIndex), nat ? h('span', { className: 'cv-mono' }, `.${displayName(nat.name)}${displayName(nat.descriptor)}`) : '')
        break
      }
      case 'BootstrapMethods': {
        const table = h('table', { className: 'cv-grid' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t.colMethod), h('th', {}, t.colArguments))))
        const tb = h('tbody', {})
        tableRows(tb, 3, v.methods.length, (k) => {
          const m = v.methods[k]
          const args = h('td', { className: 'cv-mono' })
          let chars = 0
          for (let j = 0; j < m.args.length; j++) {
            // One bootstrap method may take 65,535 arguments.
            if (j && chars > MAX_LINE_CHARS) {
              args.append(h('br', {}), `… +${(m.args.length - j).toLocaleString(env.locale)}`)
              break
            }
            if (j) args.append(h('br', {}))
            const text = ` ${pool.text(m.args[j])}`
            chars += text.length + 8
            args.append(cp(m.args[j]), text)
          }
          const ref = ` ${pool.text(m.ref)}`
          return { node: h('tr', {}, h('td', { className: 'cv-mono' }, String(k)), h('td', { className: 'cv-mono' }, cp(m.ref), ref), args), chars: chars + ref.length }
        })
        table.append(tb)
        body.append(table)
        break
      }
      case 'Annotations':
        lines(v.annotations.length, (i) => annotationText(v.annotations[i], pool, namer))
        break
      case 'TypeAnnotations':
        lines(v.annotations.length, (i) => `${annotationText(v.annotations[i].annotation, pool, namer)}  // ${v.annotations[i].target}`)
        break
      case 'Record':
        lines(v.components.length, (i) => `${displayName(pool.str(v.components[i].nameIndex))}: ${displayName(pool.str(v.components[i].descriptorIndex))}`)
        break
      case 'Module': {
        const m = v.module
        const to = (list: number[]) => (list.length ? ` to ${joinWithin(list, (x) => pool.text(x))}` : '')
        const head = `${displayName(pool.text(m.nameIndex))}${m.versionIndex ? ` @${pool.str(m.versionIndex)}` : ''}  ${flagSummary(m.access, 'module')}`
        const directives: (() => string)[] = [
          ...m.requires.map((r) => () => `requires ${displayName(pool.text(r.index))}${r.versionIndex ? ` @${pool.str(r.versionIndex)}` : ''}  ${flagSummary(r.access, 'requires')}`),
          ...m.exports.map((e) => () => `exports ${displayName(pool.text(e.index).replace(/\//g, '.'))}${to(e.to)}`),
          ...m.opens.map((e) => () => `opens ${displayName(pool.text(e.index).replace(/\//g, '.'))}${to(e.to)}`),
          ...m.uses.map((u) => () => `uses ${displayName(binaryName(pool.className(u)))}`),
          ...m.provides.map((p) => () => `provides ${displayName(binaryName(pool.className(p.index)))} with ${joinWithin(p.with, (x) => displayName(binaryName(pool.className(x))))}`)
        ]
        lines(directives.length + 1, (i) => (i ? directives[i - 1]() : head))
        break
      }
      case 'SourceDebugExtension': {
        // Its text is as long as the attribute: a line of it shows at most a line's worth.
        const shown = v.text.length > MAX_LINE_CHARS ? `${v.text.slice(0, MAX_LINE_CHARS)}…` : v.text
        if (rows.line(shown.length)) body.append(pre(shown))
        else body.append(more(1))
        break
      }
      case 'Marker':
        break
      case 'Code': {
        const c = v.code
        body.append(h('div', { className: 'cv-mono' }, fill(t.codeSummary, { size: t.bytes(c.code.length), stack: c.maxStack, locals: c.maxLocals })))
        attributeBlocks(body, c.attributes, rows)
        break
      }
      default:
        if (a.error) body.append(h('p', { className: 't-bad' }, fill(t.attributeError, { reason: reasonFor(env, a.errorCode, a.error) })))
        // At most 512 bytes, 32 lines of hex.
        if (a.bytes.length) {
          rows.take(Math.ceil(Math.min(a.bytes.length, 512) / 16))
          body.append(h('pre', { className: 'cv-hex' }, hexDump(a.bytes, 512)))
        }
    }
    return block
  }
}

/** Java modifiers for the flags column, as a short hint after the hex. */
function javaFlags(access: number, kind: 'field' | 'method' | 'inner'): string {
  return flagNames(access, kind)
    .filter((f) => !f.startsWith('0x'))
    .map((f) => f.replace(/^ACC_/, '').toLowerCase())
    .join(' ')
}
