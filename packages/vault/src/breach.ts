import { err, ok, type Result } from '@securepass/shared'

/** The Have I Been Pwned range API. Only a 5 character hash prefix is ever sent to it. */
export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/'

const sha1Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Checks a password against known breaches with k anonymity: the SHA-1 hash is made here, only its
 * first 5 hex characters are sent (with `Add-Padding: true`), and the rest is matched locally.
 * @param password - The password to check. It never leaves the device.
 * @param fetcher - `fetch`, injectable for tests.
 * @returns How many times the password appears in known breaches (0 if never).
 */
export const checkBreach = async (
  password: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<Result<number, 'network'>> => {
  const hash = await sha1Hex(password)
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)
  try {
    const response = await fetcher(`${HIBP_RANGE_URL}${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      // No cookies, no referrer: the request carries the prefix and nothing else.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (!response.ok) return err('network')
    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':')
      if (candidate === suffix) return ok(Number(count) || 0)
    }
    return ok(0)
  } catch {
    return err('network')
  }
}
