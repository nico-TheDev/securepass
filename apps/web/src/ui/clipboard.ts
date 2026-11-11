/** How long a copied secret stays on the clipboard. */
export const CLIPBOARD_CLEAR_MS = 30_000

let clearTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Copies a secret, then clears it after 30 seconds, best effort: the clear only happens if the tab
 * has focus, the browser lets the page read the clipboard, and it still holds the copied value.
 * The extension does this reliably; a web page cannot.
 * @returns False when the browser refused the copy.
 */
export const copySecret = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return false
  }
  if (clearTimer !== undefined) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => {
    clearTimer = undefined
    void (async () => {
      try {
        if (!document.hasFocus()) return
        if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('')
      } catch {
        // Reading the clipboard was not allowed. Nothing more a page can do.
      }
    })()
  }, CLIPBOARD_CLEAR_MS)
  return true
}
