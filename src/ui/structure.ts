// The Structure tab: the class file as it is laid out — header, fields, methods and every
// attribute with its offset and length, the known ones decoded, the rest as hex.

import type { AttributeInfo } from '../classfile/attributes'
import type { ClassFile, Member } from '../classfile/classfile'
import { annotationText, makeNamer } from '../classfile/declarations'
import { flagNames, flagSummary } from '../classfile/flags'
import type { LanguageInfo } from '../classfile/language'
import { binaryName, displayName } from '../classfile/names'
import { javaRelease } from '../classfile/versions'
import { h } from './dom'
import { type Env, fill, hexDump, sizeText } from './env'

export type StructureActions = {
  showPool: (index: number) => void
  showMethod: (index: number) => void
  /** Opens a class of the same archive; undefined when there is none at hand. */
  openClass?: (name: string) => void
  hasClass?: (name: string) => boolean
}

const hex4 = (n: number) => `0x${n.toString(16).padStart(4, '0')}`

export function buildStructure(cls: ClassFile, lang: LanguageInfo, env: Env, actions: StructureActions): HTMLElement {
  const t = env.t
  const pool = cls.pool
  const namer = makeNamer(cls, true)
  const doc = h('div', { className: 'cv-doc' })

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
  cls.interfaceIndices.forEach((i, k) => {
    if (k) interfaces.append(', ')
    interfaces.append(classRef(i))
  })
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
    const extra = lang.kotlin?.version ? ` ${lang.kotlin.version}` : lang.scalaVersion ? ` ${lang.scalaVersion}` : ''
    rows.push([t.language, `${name}${extra}`])
    if (lang.kotlin?.kind !== undefined) rows.push([t.kotlinKind, t.kotlinKinds[lang.kotlin.kind - 1] ?? String(lang.kotlin.kind)])
  }
  section(t.secClass, undefined, true, kv(rows))

  // Fields and methods.
  const memberTable = (members: Member[], kind: 'field' | 'method') => {
    const table = h('table', { className: 'cv-grid' })
    const head = h('tr', {}, h('th', {}, t.colFlags), h('th', {}, t.colName), h('th', {}, t.colDescriptor))
    if (kind === 'method') head.append(h('th', {}, t.colCode))
    head.append(h('th', {}, t.colAttributes))
    table.append(h('thead', {}, head))
    const body = h('tbody', {})
    members.forEach((m, k) => {
      const name =
        kind === 'method'
          ? h('button', { className: 'cv-a cv-mono', 'data-method': k, title: t.showBytecode }, displayName(m.name))
          : h('span', { className: 'cv-mono' }, displayName(m.name))
      const row = h('tr', {}, h('td', { className: 'cv-mono', title: flagNames(m.access, kind).join(', ') }, `${hex4(m.access)} ${javaFlags(m.access, kind)}`), h('td', {}, name), h('td', { className: 'cv-mono' }, displayName(m.descriptor)))
      if (kind === 'method') {
        const code = m.attributes.find((a) => a.value.kind === 'Code')
        row.append(
          h(
            'td',
            { className: 'cv-mono' },
            code?.value.kind === 'Code' ? fill(t.codeSummary, { size: t.bytes(code.value.code.code.length), stack: code.value.code.maxStack, locals: code.value.code.maxLocals }) : '—'
          )
        )
      }
      row.append(h('td', { className: 'cv-mono' }, m.attributes.map((a) => a.name).join(', ') || '—'))
      body.append(row)
    })
    table.append(body)
    return table
  }
  section(t.secFields, cls.fields.length, cls.fields.length > 0 && cls.fields.length <= 60, cls.fields.length ? memberTable(cls.fields, 'field') : h('p', { className: 'cv-hint' }, t.none))
  section(t.secMethods, cls.methods.length, cls.methods.length > 0 && cls.methods.length <= 60, cls.methods.length ? memberTable(cls.methods, 'method') : h('p', { className: 'cv-hint' }, t.none))

  // Class attributes.
  const attrs = h('div', {})
  for (const a of cls.attributes) attrs.append(attributeBlock(a))
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

  function attributeBlock(a: AttributeInfo): HTMLElement {
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
    const list = (items: Node[]) => {
      const p = h('div', { className: 'cv-mono' })
      items.forEach((n, k) => {
        if (k) p.append(', ')
        p.append(n)
      })
      return p
    }
    const pre = (text: string) => h('pre', { className: 'cv-pre' }, text)
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
        body.append(list(v.indices.map((i) => className(pool.className(i)))))
        break
      case 'ModulePackages':
        body.append(list(v.indices.map((i) => h('span', {}, displayName(pool.text(i).replace(/\//g, '.'))))))
        break
      case 'InnerClasses': {
        const table = h('table', { className: 'cv-grid' }, h('thead', {}, h('tr', {}, h('th', {}, t.colInner), h('th', {}, t.colOuter), h('th', {}, t.colSimple), h('th', {}, t.colFlags))))
        const tb = h('tbody', {})
        for (const c of v.classes) {
          tb.append(
            h(
              'tr',
              {},
              h('td', {}, c.inner ? className(pool.className(c.inner)) : '—'),
              h('td', {}, c.outer ? className(pool.className(c.outer)) : '—'),
              h('td', { className: 'cv-mono' }, c.nameIndex ? displayName(pool.str(c.nameIndex)) : '—'),
              h('td', { className: 'cv-mono' }, `${hex4(c.access)} ${javaFlags(c.access, 'inner')}`)
            )
          )
        }
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
        v.methods.forEach((m, k) => {
          const args = h('td', { className: 'cv-mono' })
          m.args.forEach((x, j) => {
            if (j) args.append(h('br', {}))
            args.append(cp(x), ` ${pool.text(x)}`)
          })
          tb.append(h('tr', {}, h('td', { className: 'cv-mono' }, String(k)), h('td', { className: 'cv-mono' }, cp(m.ref), ` ${pool.text(m.ref)}`), args))
        })
        table.append(tb)
        body.append(table)
        break
      }
      case 'Annotations':
        body.append(pre(v.annotations.map((x) => annotationText(x, pool, namer)).join('\n')))
        break
      case 'TypeAnnotations':
        body.append(pre(v.annotations.map((x) => `${annotationText(x.annotation, pool, namer)}  // ${x.target}`).join('\n')))
        break
      case 'Record':
        body.append(pre(v.components.map((c) => `${displayName(pool.str(c.nameIndex))}: ${displayName(pool.str(c.descriptorIndex))}`).join('\n')))
        break
      case 'Module': {
        const m = v.module
        const lines = [`${displayName(pool.text(m.nameIndex))}${m.versionIndex ? ` @${pool.str(m.versionIndex)}` : ''}  ${flagSummary(m.access, 'module')}`]
        for (const r of m.requires) lines.push(`requires ${displayName(pool.text(r.index))}${r.versionIndex ? ` @${pool.str(r.versionIndex)}` : ''}  ${flagSummary(r.access, 'requires')}`)
        for (const e of m.exports) lines.push(`exports ${displayName(pool.text(e.index).replace(/\//g, '.'))}${e.to.length ? ` to ${e.to.map((x) => pool.text(x)).join(', ')}` : ''}`)
        for (const e of m.opens) lines.push(`opens ${displayName(pool.text(e.index).replace(/\//g, '.'))}${e.to.length ? ` to ${e.to.map((x) => pool.text(x)).join(', ')}` : ''}`)
        for (const u of m.uses) lines.push(`uses ${displayName(binaryName(pool.className(u)))}`)
        for (const p of m.provides) lines.push(`provides ${displayName(binaryName(pool.className(p.index)))} with ${p.with.map((x) => displayName(binaryName(pool.className(x)))).join(', ')}`)
        body.append(pre(lines.join('\n')))
        break
      }
      case 'SourceDebugExtension':
        body.append(pre(v.text))
        break
      case 'Marker':
        break
      default:
        if (a.error) body.append(h('p', { className: 't-bad' }, fill(t.attributeError, { reason: env.t.ownReasons === 'yes' ? a.error : t.reasonDamaged })))
        if (a.bytes.length) body.append(h('pre', { className: 'cv-hex' }, hexDump(a.bytes, 512)))
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
