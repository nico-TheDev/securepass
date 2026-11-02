import { err, type ItemPayload, itemPayloadSchema, ok, type Result } from '@securepass/shared'
import { concat, fromBase64Url, randomBytes, toBase64Url, utf8, zeroize } from './bytes'
import { open, seal } from './envelope'
import { type CryptoError, cryptoError } from './errors'

/** Largest packed item ciphertext (3 header bytes, wrapped key, and payload, in bytes): 64 KiB. */
export const MAX_ITEM_BYTES = 64 * 1024

/** Version byte of the packed container that holds the two envelopes. */
const CONTAINER_VERSION = 0x01
const HEADER_LENGTH = 3

const damaged = (message: string): CryptoError => cryptoError('Damaged', message)

/** Joins the two envelopes: `0x01 | u16 big endian key length | wrapped item key | payload`. */
const pack = (wrappedItemKey: Uint8Array, payload: Uint8Array): Uint8Array =>
  concat(
    Uint8Array.of(CONTAINER_VERSION, wrappedItemKey.length >> 8, wrappedItemKey.length & 0xff),
    wrappedItemKey,
    payload,
  )

/** Splits a packed blob into its two envelopes, or `null` when the container is malformed. */
const unpack = (
  blob: Uint8Array,
): { readonly wrappedItemKey: Uint8Array; readonly payload: Uint8Array } | null => {
  if (blob.length <= HEADER_LENGTH || blob[0] !== CONTAINER_VERSION) return null
  const keyLength = ((blob[1] ?? 0) << 8) | (blob[2] ?? 0)
  const keyEnd = HEADER_LENGTH + keyLength
  if (keyLength === 0 || keyEnd >= blob.length) return null
  return { wrappedItemKey: blob.subarray(HEADER_LENGTH, keyEnd), payload: blob.subarray(keyEnd) }
}

/**
 * Seals an item: a fresh item key wrapped under the vault key, and the payload sealed under the item key.
 * Both envelopes are bound to `itemId`, so moving them to another id makes them fail to open.
 * The two envelopes are packed into one blob and returned as the `ciphertext` string the server stores.
 * @param vaultKey - The 32 byte vault key.
 * @param itemId - UUID v4 made on the client when the item was created.
 * @param payload - The plaintext item. Checked against the schema first.
 * @returns The packed ciphertext as base64url text.
 */
export const sealItem = async (
  vaultKey: Uint8Array,
  itemId: string,
  payload: ItemPayload,
): Promise<Result<string, CryptoError>> => {
  const parsed = itemPayloadSchema.safeParse(payload)
  if (!parsed.success)
    return err(cryptoError('InvalidInput', 'Item payload does not match the schema'))
  const itemKey = randomBytes(32)
  const wrappedItemKey = seal(vaultKey, itemKey, `item-key|${itemId}`)
  const sealedPayload = seal(itemKey, utf8(JSON.stringify(parsed.data)), `item|${itemId}`)
  zeroize(itemKey)
  const packed = pack(wrappedItemKey, sealedPayload)
  if (packed.length > MAX_ITEM_BYTES) {
    return err(cryptoError('ItemTooLarge', 'Sealed item is larger than 64 KiB'))
  }
  return ok(toBase64Url(packed))
}

/**
 * Opens a sealed item. Any failure is `Damaged`: callers show "damaged item" and never retry another mode.
 * @param vaultKey - The 32 byte vault key.
 * @param itemId - The id the item is stored under.
 * @param ciphertext - The packed base64url ciphertext from the server or the cache.
 */
export const openItem = async (
  vaultKey: Uint8Array,
  itemId: string,
  ciphertext: string,
): Promise<Result<ItemPayload, CryptoError>> => {
  const blob = fromBase64Url(ciphertext)
  if (!blob) return err(damaged('Item is not valid base64url'))
  const parts = unpack(blob)
  if (!parts) return err(damaged('Item container is not valid'))
  const itemKey = open(vaultKey, parts.wrappedItemKey, `item-key|${itemId}`)
  if (!itemKey.ok) return itemKey
  const plaintext = open(itemKey.value, parts.payload, `item|${itemId}`)
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
