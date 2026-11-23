import { ask } from '../content/overlay-root'
import { usernameFor } from '../fill/fields'
import type { ContentMessage } from '../messages'

/** The credentials a form holds at one moment. */
export type Snapshot = {
  readonly username: string
  readonly password: string
  readonly password_new?: string
}

/** A script driven login must navigate within this long after its password field lost its value. */
export const NAVIGATION_WINDOW_MS = 5000
/** How long a press of Enter or a button stays a possible script driven login. */
const INTENT_WINDOW_MS = 30_000
const POLL_MS = 250

/**
 * Reads the credentials around a password field. A form with two or more filled password fields
 * is a change password form: the first filled one is the old password, the last the new one.
 * @param isPassword - True for a field that is, or once was, a password field.
 */
export const snapshotOf = (
  anchor: HTMLInputElement,
  isPassword: (field: HTMLInputElement) => boolean,
): Snapshot | null => {
  const scope = [...(anchor.form ?? anchor.ownerDocument).querySelectorAll('input')]
  const filled = scope.filter((field) => isPassword(field) && field.value !== '')
  const first = filled[0]
  const last = filled.at(-1)
  if (!first || !last) return null
  const anyPassword = scope.find(isPassword) ?? first
  return {
    username: usernameFor(anyPassword, isPassword)?.value ?? '',
    password: first.value,
    ...(filled.length >= 2 ? { password_new: last.value } : {}),
  }
}

const BUTTON =
  'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]'

/**
 * Watches for a login being submitted and reports the credentials to the background, which
 * decides whether to offer a save. Two triggers: a form `submit`, and, for logins driven by a
 * script, a press of Enter or a button followed by the password field losing its value and the
 * page navigating within 5 seconds.
 */
export const startCapture = (doc: Document): void => {
  const view = doc.defaultView
  if (!view) return
  // Fields that are or were `type="password"`, so a "show password" toggle does not hide them.
  const seen = new WeakSet<HTMLInputElement>()
  const isPassword = (field: HTMLInputElement): boolean => {
    if (field.type === 'password') seen.add(field)
    return seen.has(field)
  }

  let last: { readonly text: string; readonly at: number } | null = null
  const report = (snapshot: Snapshot): void => {
    const text = JSON.stringify(snapshot)
    const now = Date.now()
    if (last && last.text === text && now - last.at < NAVIGATION_WINDOW_MS) return
    last = { text, at: now }
    void ask({ type: 'submitted', ...snapshot } satisfies ContentMessage)
  }

  type Intent = {
    readonly anchor: HTMLInputElement
    readonly snapshot: Snapshot
    readonly at: number
    readonly href: string
    lostAt: number | null
    timer: ReturnType<typeof setInterval>
  }
  let intent: Intent | null = null
  const endIntent = (): void => {
    if (intent) clearInterval(intent.timer)
    intent = null
  }

  const lostValue = (field: HTMLInputElement): boolean => !field.isConnected || field.value === ''

  const poll = (): void => {
    if (!intent) return
    const now = Date.now()
    if (now - intent.at > INTENT_WINDOW_MS) {
      endIntent()
      return
    }
    if (intent.lostAt === null && lostValue(intent.anchor)) intent.lostAt = now
    if (intent.lostAt === null) return
    if (now - intent.lostAt > NAVIGATION_WINDOW_MS) {
      endIntent()
      return
    }
    if (view.location.href === intent.href) return
    report(intent.snapshot)
    endIntent()
  }

  const startIntent = (near: Element | null): void => {
    const scope = near?.closest('form') ?? doc
    const anchor = [...scope.querySelectorAll('input')].find(
      (field) => isPassword(field) && field.value !== '',
    )
    const snapshot = anchor ? snapshotOf(anchor, isPassword) : null
    if (!anchor || !snapshot) return
    endIntent()
    intent = {
      anchor,
      snapshot,
      at: Date.now(),
      href: view.location.href,
      lostAt: null,
      timer: setInterval(poll, POLL_MS),
    }
  }

  doc.addEventListener(
    'input',
    (event) => {
      if (event.target instanceof HTMLInputElement) isPassword(event.target)
    },
    true,
  )

  doc.addEventListener(
    'submit',
    (event) => {
      if (!(event.target instanceof HTMLFormElement)) return
      const anchor = [...event.target.querySelectorAll('input')].find(
        (field) => isPassword(field) && field.value !== '',
      )
      const snapshot = anchor ? snapshotOf(anchor, isPassword) : null
      if (snapshot) report(snapshot)
      endIntent()
    },
    true,
  )

  doc.addEventListener(
    'keydown',
    (event) => {
      if (event.isTrusted && event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        startIntent(event.target)
      }
    },
    true,
  )

  doc.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return
      const button = event.target.closest(BUTTON)
      if (button) startIntent(button)
    },
    true,
  )

  // Leaving the page is both the field losing its value and the navigation.
  view.addEventListener('pagehide', () => {
    if (!intent) return
    const now = Date.now()
    const fresh = now - intent.at <= INTENT_WINDOW_MS
    const inWindow = intent.lostAt === null || now - intent.lostAt <= NAVIGATION_WINDOW_MS
    if (fresh && inWindow) report(intent.snapshot)
    endIntent()
  })
}
