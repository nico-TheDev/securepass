/** A username field and a password field that belong together. Either may be missing. */
export type LoginFields = {
  readonly username: HTMLInputElement | null
  readonly password: HTMLInputElement | null
}

const TEXT_TYPES = new Set(['text', 'email', 'tel', ''])

const usable = (field: HTMLInputElement): boolean => !field.disabled && !field.readOnly

const isTextLike = (field: HTMLInputElement): boolean =>
  TEXT_TYPES.has((field.getAttribute('type') ?? '').toLowerCase())

const saysUsername = (field: HTMLInputElement): boolean =>
  (field.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).includes('username')

/** Every input in the same form as `field`, or in the whole document when it has no form. */
const scopeOf = (field: HTMLInputElement): readonly HTMLInputElement[] => [
  ...(field.form ?? field.ownerDocument).querySelectorAll('input'),
]

/**
 * The username field that goes with a password field: the nearest text like input before it in
 * the same form. A step 2 page that only keeps the name in an `autocomplete="username"` input
 * (even a hidden one) is covered too.
 * @param isPassword - Extra test for fields that are passwords shown as text.
 */
export const usernameFor = (
  password: HTMLInputElement,
  isPassword: (field: HTMLInputElement) => boolean = () => false,
): HTMLInputElement | null => {
  const scope = scopeOf(password)
  const before = scope.slice(0, scope.indexOf(password)).toReversed()
  return (
    before.find((field) => isTextLike(field) && !isPassword(field) && usable(field)) ??
    scope.find((field) => field !== password && saysUsername(field)) ??
    null
  )
}

/**
 * Finds the login fields of a page: each password field with its username field, plus a lone
 * `autocomplete="username"` field on a page that asks for the name first.
 */
export const findLoginFields = (doc: Document): readonly LoginFields[] => {
  const passwords = [...doc.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(
    usable,
  )
  const paired = passwords.map((password) => ({ username: usernameFor(password), password }))
  const taken = new Set(paired.map((group) => group.username))
  const lone = [...doc.querySelectorAll<HTMLInputElement>('input[autocomplete~="username" i]')]
    .filter((field) => usable(field) && isTextLike(field) && !taken.has(field))
    .filter((field) => !passwords.some((password) => password.form === field.form))
    .map((username) => ({ username, password: null }))
  return [...paired, ...lone]
}

/** The group a field belongs to, if any. */
export const groupOf = (
  groups: readonly LoginFields[],
  field: HTMLInputElement,
): LoginFields | undefined =>
  groups.find((group) => group.password === field) ??
  groups.find((group) => group.username === field)

const MIN_OPACITY = 0.1

/** The combined opacity of an element and everything above it. */
const opacityOf = (element: Element): number => {
  let opacity = 1
  for (let node: Element | null = element; node; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity)
  }
  return opacity
}

/**
 * Fill rule 2: a field may only be filled when you can really see it. It has a non zero box, is
 * not `display:none`, `visibility:hidden`, or nearly transparent, and the element at its center is
 * the field itself, so nothing covers it.
 */
export const isFieldVisible = (field: HTMLInputElement): boolean => {
  if (!field.isConnected) return false
  const rect = field.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = getComputedStyle(field)
  if (style.display === 'none' || style.visibility !== 'visible') return false
  if (opacityOf(field) < MIN_OPACITY) return false
  const root = field.getRootNode()
  if (!(root instanceof Document || root instanceof ShadowRoot)) return false
  const top = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
  return top !== null && (top === field || field.contains(top))
}

/** Writes a value the way typing would, so the page's own scripts notice it. */
export const writeField = (field: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(field, value)
  else field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}
