import { ask, el } from '../content/overlay-root'
import type { ContentMessage, FillReply, Suggestion, SuggestReply } from '../messages'
import { findLoginFields, groupOf, isFieldVisible, type LoginFields, writeField } from './fields'

const ICON_SIZE = 22
const MIN_FIELD_WIDTH = 80

const TEXT = {
  locked: 'securepass is locked. Open the extension from the toolbar to unlock it.',
  blocked: 'securepass does not fill on this page.',
  none: 'No saved login matches this site.',
  hidden: 'Nothing was filled: a field is hidden or covered.',
  refused: 'Nothing was filled: this login does not match the page.',
} as const

/**
 * Shows the inline icon in login fields and, after a click, the suggestion list. Everything is
 * drawn inside the closed shadow root. A login is requested only after a real click or Enter on a
 * suggestion (fill rule 1), and only when the target fields are visible (fill rule 2).
 */
export const startFill = (doc: Document, root: ShadowRoot): void => {
  const view = doc.defaultView
  if (!view) return
  const icons = new Map<HTMLInputElement, HTMLButtonElement>()
  const fieldIds = new WeakMap<HTMLInputElement, string>()
  let groups: readonly LoginFields[] = []
  let list: { readonly node: HTMLElement; readonly field: HTMLInputElement } | null = null

  const idOf = (field: HTMLInputElement): string => {
    const known = fieldIds.get(field)
    if (known) return known
    const made = crypto.randomUUID()
    fieldIds.set(field, made)
    return made
  }

  const closeList = (): void => {
    list?.node.remove()
    list = null
  }

  const place = (): void => {
    for (const [field, icon] of icons) {
      const rect = field.getBoundingClientRect()
      const shown = field.isConnected && rect.width >= MIN_FIELD_WIDTH && rect.height > 0
      icon.hidden = !shown
      icon.style.left = `${rect.right - ICON_SIZE - 6}px`
      icon.style.top = `${rect.top + (rect.height - ICON_SIZE) / 2}px`
    }
    if (list) {
      const rect = list.field.getBoundingClientRect()
      list.node.style.left = `${Math.max(4, rect.left)}px`
      list.node.style.top = `${rect.bottom + 4}px`
      list.node.style.width = `${Math.max(rect.width, 260)}px`
    }
  }

  // A short message. It lets clicks through, so it never blocks the page, and it goes away alone.
  const showText = (field: HTMLInputElement, text: string): void => {
    closeList()
    const node = el(doc, 'div', 'list note')
    setTimeout(() => {
      if (list?.node === node) closeList()
    }, 5000)
    node.setAttribute('role', 'status')
    node.append(el(doc, 'p', 'text', text))
    root.append(node)
    list = { node, field }
    place()
  }

  const fill = async (field: HTMLInputElement, choice: Suggestion): Promise<void> => {
    const group = groupOf(groups, field) ?? { username: null, password: null }
    const targets = [group.username, group.password].filter(
      (target): target is HTMLInputElement => target !== null,
    )
    // The list is gone before the check, so it cannot be what covers a field.
    closeList()
    if (targets.length === 0 || !targets.every(isFieldVisible)) return showText(field, TEXT.hidden)
    const message: ContentMessage = {
      type: 'fill',
      item_id: choice.item_id,
      field_ids: targets.map(idOf),
    }
    const reply = await ask<FillReply>(message)
    if (reply?.status !== 'ok') return showText(field, TEXT.refused)
    // Checked again right before writing: the page may have changed while the reply was on its way.
    if (!targets.every(isFieldVisible)) return showText(field, TEXT.hidden)
    for (const target of targets) {
      if (!reply.field_ids.includes(idOf(target))) continue
      writeField(target, target === group.password ? reply.password : reply.username)
    }
  }

  const showSuggestions = (field: HTMLInputElement, matches: readonly Suggestion[]): void => {
    closeList()
    const node = el(doc, 'div', 'list')
    node.setAttribute('role', 'group')
    node.setAttribute('aria-label', 'securepass logins for this site')
    node.append(el(doc, 'p', 'title', 'securepass'))
    for (const match of matches) {
      const row = el(doc, 'button', 'row')
      row.type = 'button'
      row.append(
        el(doc, 'b', '', match.name),
        el(doc, 'small', '', match.username || 'No username'),
      )
      // Fill rule 1: only a real click or Enter key counts. A click made by a script does not.
      row.addEventListener('click', (event) => {
        if (event.isTrusted) void fill(field, match)
      })
      node.append(row)
    }
    root.append(node)
    list = { node, field }
    place()
    node.querySelector('button')?.focus()
  }

  const open = async (field: HTMLInputElement): Promise<void> => {
    const reply = await ask<SuggestReply>({ type: 'suggest' } satisfies ContentMessage)
    if (!reply || reply.status === 'blocked') return showText(field, TEXT.blocked)
    if (reply.status === 'locked') return showText(field, TEXT.locked)
    if (reply.matches.length === 0) return showText(field, TEXT.none)
    showSuggestions(field, reply.matches)
  }

  const scan = (): void => {
    groups = findLoginFields(doc)
    const wanted = new Set(
      groups.flatMap((group) => [group.username, group.password]).filter((field) => field !== null),
    )
    for (const [field, icon] of icons) {
      if (wanted.has(field)) continue
      icon.remove()
      icons.delete(field)
    }
    for (const field of wanted) {
      if (icons.has(field)) continue
      const icon = el(doc, 'button', 'icon')
      icon.type = 'button'
      icon.tabIndex = -1
      icon.setAttribute('aria-label', 'Show securepass logins for this site')
      icon.append(el(doc, 'span', ''))
      icon.addEventListener('click', (event) => {
        if (!event.isTrusted) return
        if (list?.field === field) closeList()
        else void open(field)
      })
      root.append(icon)
      icons.set(field, icon)
    }
    if (list && !list.field.isConnected) closeList()
    place()
  }

  let scanTimer: ReturnType<typeof setTimeout> | undefined
  const scanSoon = (): void => {
    if (scanTimer !== undefined) return
    scanTimer = setTimeout(() => {
      scanTimer = undefined
      scan()
    }, 250)
  }

  new MutationObserver(scanSoon).observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'disabled', 'readonly', 'style', 'class', 'hidden'],
  })
  view.addEventListener('scroll', place, { capture: true, passive: true })
  view.addEventListener('resize', place, { passive: true })
  doc.addEventListener('focusin', place)
  // Typing in the page means the list is no longer wanted.
  doc.addEventListener('input', closeList, true)
  // A click or key outside the overlay closes the list. Events inside the closed root are
  // retargeted to its host, so they are told apart by where they land.
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (list && event.target !== root.host) closeList()
    },
    true,
  )
  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !list) return
      const { field } = list
      closeList()
      field.focus()
    },
    true,
  )
  scan()
}
