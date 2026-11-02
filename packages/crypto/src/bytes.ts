const encoder = new TextEncoder()

/** Encodes a string as UTF-8 bytes. */
export const utf8 = (text: string): Uint8Array => encoder.encode(text)

/** Joins byte arrays into one new array. */
export const concat = (...parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Encodes bytes as unpadded base64url, the form used for every ciphertext in JSON. */
export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Decodes unpadded base64url. Returns `null` when the text is not valid base64url. */
export const fromBase64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const padded = text
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** Returns `length` random bytes from the platform's cryptographic source. */
export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))

/**
 * Overwrites a key buffer with zeros. Best effort only: JavaScript may have copied the bytes already.
 * @param buffer - The buffer to clear in place.
 */
export const zeroize = (buffer: Uint8Array): void => {
  buffer.fill(0)
}
