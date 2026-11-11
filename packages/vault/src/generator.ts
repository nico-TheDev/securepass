import { err, ok, type Result } from '@securepass/shared'
import { EFF_WORDS } from './wordlist'

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const DIGITS = '0123456789'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/~'
const LOOKALIKES = new Set('Il1O0')

/** Shortest and longest password the generator makes. */
export const PASSWORD_LENGTH = { min: 8, max: 128, default: 20 } as const
/** Fewest and most words in a passphrase. */
export const PASSPHRASE_WORDS = { min: 3, max: 12, default: 5 } as const

/** Choices for a random password. */
export type PasswordOptions = {
  readonly length: number
  readonly upper: boolean
  readonly lower: boolean
  readonly digits: boolean
  readonly symbols: boolean
  /** Leaves out the characters that look alike: `I`, `l`, `1`, `O`, `0`. */
  readonly excludeLookalikes: boolean
}

/** Choices for a passphrase. */
export type PassphraseOptions = {
  readonly words: number
  readonly separator: string
  readonly capitalize: boolean
  readonly includeNumber: boolean
}

/** The generator's defaults: 20 characters from every set, and 5 words joined with a dash. */
export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: PASSWORD_LENGTH.default,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeLookalikes: false,
}
export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: PASSPHRASE_WORDS.default,
  separator: '-',
  capitalize: true,
  includeNumber: false,
}

/** Why the generator refused: a length out of range, or no character set chosen. */
export type GeneratorError = 'length_out_of_range' | 'no_character_set'

/**
 * A uniform random whole number in `[0, max)` from `crypto.getRandomValues`, using rejection
 * sampling so there is no modulo bias.
 * @param max - Exclusive upper bound, from 1 to 2^32.
 */
export const randomInt = (max: number): number => {
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buffer = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < limit) return value % max
  }
}

const pick = (chars: string): string => chars[randomInt(chars.length)] ?? ''

/** Fisher and Yates shuffle with the unbiased random source. Returns a new array. */
const shuffled = <T>(items: readonly T[]): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const a = out[i] as T
    out[i] = out[j] as T
    out[j] = a
  }
  return out
}

/**
 * Makes a random password: 8 to 128 characters, with at least one character from each chosen set.
 */
export const generatePassword = (options: PasswordOptions): Result<string, GeneratorError> => {
  if (
    !Number.isInteger(options.length) ||
    options.length < PASSWORD_LENGTH.min ||
    options.length > PASSWORD_LENGTH.max
  ) {
    return err('length_out_of_range')
  }
  const sets = [
    options.upper ? UPPER : '',
    options.lower ? LOWER : '',
    options.digits ? DIGITS : '',
    options.symbols ? SYMBOLS : '',
  ]
    .map((set) =>
      options.excludeLookalikes ? [...set].filter((char) => !LOOKALIKES.has(char)).join('') : set,
    )
    .filter((set) => set.length > 0)
  if (sets.length === 0) return err('no_character_set')

  const all = sets.join('')
  const required = sets.map(pick)
  const rest = Array.from({ length: options.length - required.length }, () => pick(all))
  return ok(shuffled([...required, ...rest]).join(''))
}

/** Makes a passphrase of 3 to 12 words from the EFF large wordlist (7776 words). */
export const generatePassphrase = (options: PassphraseOptions): Result<string, GeneratorError> => {
  if (
    !Number.isInteger(options.words) ||
    options.words < PASSPHRASE_WORDS.min ||
    options.words > PASSPHRASE_WORDS.max
  ) {
    return err('length_out_of_range')
  }
  const words = Array.from({ length: options.words }, () => {
    const word = EFF_WORDS[randomInt(EFF_WORDS.length)] ?? ''
    return options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word
  })
  if (options.includeNumber) {
    const index = randomInt(words.length)
    words[index] = `${words[index] ?? ''}${randomInt(10)}`
  }
  return ok(words.join(options.separator))
}
