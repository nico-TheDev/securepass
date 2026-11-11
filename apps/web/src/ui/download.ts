/**
 * Saves text as a file on this device. Nothing is sent anywhere.
 * @param fileName - The name the browser suggests.
 * @param text - The file's contents.
 */
export const downloadText = (fileName: string, text: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
