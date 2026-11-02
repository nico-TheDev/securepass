import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as common from '@zxcvbn-ts/language-common'
import * as english from '@zxcvbn-ts/language-en'

const checker = new ZxcvbnFactory({
  translations: english.translations,
  graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...english.dictionary },
})

/** How strong a master password looks. Scores run 0 (weak) to 4 (strong). Runs fully on this device. */
export type Strength = { readonly score: 0 | 1 | 2 | 3 | 4; readonly warning: string }

/**
 * Scores a password with zxcvbn-ts, using the email as a known word so it cannot carry the score.
 * @param password - The candidate master password.
 * @param email - The account email, which an attacker would guess first.
 */
export const measureStrength = (password: string, email: string): Strength => {
  if (password.length === 0) return { score: 0, warning: '' }
  const result = checker.check(password, email ? [email] : [])
  return { score: result.score, warning: result.feedback.warning ?? '' }
}
