import type { ApiError, SaveError, SignInError } from '@securepass/vault'

/** What to tell the user after a call that proves credentials failed. */
export const signInErrorText = (error: SignInError): string => {
  switch (error.kind) {
    case 'wrong_credentials':
      return 'That was not accepted. Check the master password and the code, then try again.'
    case 'rate_limited':
      return `Too many failed attempts from this network. Wait ${Math.ceil(error.retryAfter / 60)} minute(s), then try again.`
    case 'network':
      return 'Could not reach the server. Check your connection and try again.'
    case 'crypto':
      return 'The server sent settings this app will not accept, so nothing was unlocked.'
    case 'server':
      return 'The server could not finish this. Try again in a moment.'
  }
}

/** What to tell the user after an action that needs a fresh TOTP code failed. */
export const actionErrorText = (error: ApiError): string => {
  if (error.kind === 'network') return 'Could not reach the server. This action needs a connection.'
  switch (error.status) {
    case 401:
      return error.code === 'invalid'
        ? 'That code was not accepted. Wait for a new code and try again.'
        : 'Your session has ended. Sign in again, then retry.'
    case 404:
      return 'The server no longer has this. Sync and look again.'
    case 409:
      return 'This changed on another device. Sync first, then try again.'
    case 429:
      return `Too many failed attempts. Wait ${Math.ceil((error.retryAfter ?? 60) / 60)} minute(s), then try again.`
    default:
      return 'The server could not finish this. Try again in a moment.'
  }
}

/** What to tell the user when an item could not be saved on this device. */
export const saveErrorText = (error: SaveError): string => {
  switch (error.kind) {
    case 'invalid':
      return 'Give the item a name before saving.'
    case 'too_large':
      return 'This item is too large to save. Shorten the note and try again.'
    case 'not_found':
      return 'This item is no longer in the vault.'
    case 'seal':
      return 'This item could not be encrypted, so it was not saved.'
  }
}
