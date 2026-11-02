/** The expected ways a crypto call can fail. Callers show a message and never retry another mode. */
export type CryptoError =
  | { readonly kind: 'UnsupportedKdf'; readonly message: string }
  | { readonly kind: 'WeakKdf'; readonly message: string }
  | { readonly kind: 'KdfOutOfRange'; readonly message: string }
  | { readonly kind: 'KdfDowngrade'; readonly message: string }
  | { readonly kind: 'InvalidInput'; readonly message: string }
  | { readonly kind: 'ItemTooLarge'; readonly message: string }
  /** Tag check failed, wrong key, wrong id, unknown version, or a payload that is not valid. */
  | { readonly kind: 'Damaged'; readonly message: string }

export const cryptoError = <K extends CryptoError['kind']>(
  kind: K,
  message: string,
): Extract<CryptoError, { kind: K }> => ({ kind, message }) as Extract<CryptoError, { kind: K }>
