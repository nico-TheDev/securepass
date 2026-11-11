/**
 * Rollback check: an item that opens to a `seq` lower than the highest one this device has seen
 * is an older version sent back by the server. It must be flagged and not applied.
 * @param seq - The `seq` inside the item the server just sent.
 * @param seenSeq - `seen_seq[item_id]` from the cache, or `undefined` for an item never seen.
 * @returns `true` when the item is older than what this device has already seen.
 */
export const isRollback = (seq: number, seenSeq: number | undefined): boolean =>
  seenSeq !== undefined && seq < seenSeq

/**
 * The `seq` for the next edit of an item: one more than the highest value seen so far.
 * @param seenSeq - `seen_seq[item_id]` from the cache, or `undefined`.
 * @param payloadSeq - The `seq` of the version being edited, or `undefined` for a new item.
 */
export const nextSeq = (seenSeq: number | undefined, payloadSeq: number | undefined): number =>
  Math.max(seenSeq ?? 0, payloadSeq ?? 0) + 1
