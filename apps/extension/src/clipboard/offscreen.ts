/**
 * Writes text to the clipboard from the offscreen document. `navigator.clipboard` needs a focused
 * document, which an offscreen document never is, so this uses a `copy` event instead.
 * An empty text clears the clipboard.
 * @returns True when the browser accepted the copy.
 */
export const writeClipboard = (doc: Document, text: string): boolean => {
  const area = doc.createElement('textarea')
  // A selection must exist for the copy command to run. The handler replaces what is copied.
  area.value = text === '' ? ' ' : text
  doc.body.append(area)
  area.select()
  const onCopy = (event: ClipboardEvent): void => {
    event.clipboardData?.setData('text/plain', text)
    event.preventDefault()
  }
  doc.addEventListener('copy', onCopy)
  try {
    return doc.execCommand('copy')
  } finally {
    doc.removeEventListener('copy', onCopy)
    area.remove()
  }
}

/** Reads the clipboard's text from the offscreen document. */
export const readClipboard = (doc: Document): string => {
  const area = doc.createElement('textarea')
  doc.body.append(area)
  area.focus()
  try {
    doc.execCommand('paste')
    return area.value
  } finally {
    area.remove()
  }
}
