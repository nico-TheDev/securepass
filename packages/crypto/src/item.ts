import { err, type ItemPayload, itemPayloadSchema, ok, type Result } from '@securepass/shared'
import { fromBase64Url, randomBytes, toBase64Url, utf8, zeroize } from './bytes'
import { open, seal } from './envelope'
import { type CryptoError, cryptoError } from './errors'

/** Largest sealed item (wrapped key plus payload, in bytes): 64 KiB. */
export const MAX_ITEM_BYTES = 64 * 1024

/** The ciphertext the server stores for one item. Both parts are base64url envelopes. */
export type SealedItem = { readonly wrapped_item_key: string; readonly payload: string }

/**
 * Seals an item: a fresh item key wrapped under the vault key, and the payload sealed under the item key.
 * Both envelopes are bound to `itemId`, so moving them to another id makes them fail to open.
 * @param vaultKey - The 32 byte vault key.
 * @param itemId - UUID v4 made on the client when the item was created.
 * @param payload - The plaintext item. Checked against the schema first.
 */
export const sealItem = async (
  vaultKey: Uint8Array,
  itemId: string,
  payload: ItemPayload,
): Promise<Result<SealedItem, CryptoError>> => {
  const parsed = itemPayloadSchema.safeParse(payload)
  if (!parsed.success)
    return err(cryptoError('InvalidInput', 'Item payload does not match the schema'))
  const itemKey = randomBytes(32)
  const wrappedItemKey = seal(vaultKey, itemKey, `item-key|${itemId}`)
  const sealedPayload = seal(itemKey, utf8(JSON.stringify(parsed.data)), `item|${itemId}`)
  zeroize(itemKey)
  if (wrappedItemKey.length + sealedPayload.length > MAX_ITEM_BYTES) {
    return err(cryptoError('ItemTooLarge', 'Sealed item is larger than 64 KiB'))
  }
  return ok({ wrapped_item_key: toBase64Url(wrappedItemKey), payload: toBase64Url(sealedPayload) })
}

/**
 * Opens a sealed item. Any failure is `Damaged`: callers show "damaged item" and never retry another mode.
 * @param vaultKey - The 32 byte vault key.
 * @param itemId - The id the item is stored under.
 * @param sealed - The two envelopes from the server or the cache.
 */
export const openItem = async (
  vaultKey: Uint8Array,
  itemId: string,
  sealed: SealedItem,
): Promise<Result<ItemPayload, CryptoError>> => {
  const wrapped = fromBase64Url(sealed.wrapped_item_key)
  const body = fromBase64Url(sealed.payload)
  if (!wrapped || !body) return err(cryptoError('Damaged', 'Item is not valid base64url'))
  const itemKey = open(vaultKey, wrapped, `item-key|${itemId}`)
  if (!itemKey.ok) return itemKey
  const plaintext = open(itemKey.value, body, `item|${itemId}`)
  zeroize(itemKey.value)
  if (!plaintext.ok) return plaintext
  try {
    const parsed = itemPayloadSchema.safeParse(
      JSON.parse(new TextDecoder().decode(plaintext.value)),
    )
    return parsed.success
      ? ok(parsed.data)
      : err(cryptoError('Damaged', 'Item payload is not valid'))
  } catch {
    return err(cryptoError('Damaged', 'Item payload is not valid'))
  }
}
