import type { ItemPayload } from '@securepass/shared'
import type { Cache } from '@securepass/shared/cache'
import Papa from 'papaparse'
import { createItemFromPayload } from './items'
import { hostOf, normalizeUrl, siteOf } from './url'

/** Why a CSV row was skipped, or imported with a caveat. */
export type ImportReason =
  | 'no_name_no_url'
  | 'too_large'
  | 'duplicate'
  | 'parse_error'
  /** Imported, but as a plain note holding the raw text of a LastPass structured note. */
  | 'structured_note_as_text'

/** One line of the import report. `row` counts from 1, not including the header. */
export type ImportNote = {
  readonly row: number
  readonly name: string
  readonly reason: ImportReason
}

/** What parsing found: the items ready to seal, and the rows that need a mention. */
export type ParsedImport = {
  readonly items: readonly { readonly row: number; readonly payload: ItemPayload }[]
  readonly notes: readonly ImportNote[]
}

/** The final report shown to the user. */
export type ImportReport = {
  readonly imported: number
  readonly skipped: readonly ImportNote[]
  /** Rows that were imported with a caveat. */
  readonly warnings: readonly ImportNote[]
}

const SECURE_NOTE_URL = 'http://sn'
const BATCH_SIZE = 50

const duplicateKey = (payload: ItemPayload): string =>
  [
    payload.name.toLowerCase(),
    payload.login?.username.toLowerCase() ?? '',
    payload.login?.urls[0] ? (siteOf(payload.login.urls[0].url) ?? '') : '',
  ].join('\n')

/**
 * Parses a LastPass CSV export into item payloads, entirely on this device.
 * Handles a BOM, CRLF line ends, and quoted multi line fields.
 * @param text - The file's text, read with the File API.
 * @param existing - Items already in the vault, for duplicate detection.
 * @param deviceId - This device's id, recorded as `edited_by`.
 * @param now - The import time, used as `edited_at`.
 */
export const parseLastPassCsv = (
  text: string,
  existing: readonly ItemPayload[],
  deviceId: string,
  now: Date,
): ParsedImport => {
  const parsed = Papa.parse<Record<string, string | undefined>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase(),
  })
  const badRows = new Set(
    parsed.errors.flatMap((error) => (typeof error.row === 'number' ? [error.row] : [])),
  )
  const seen = new Set(existing.filter((item) => !item.trashed).map(duplicateKey))
  const items: { row: number; payload: ItemPayload }[] = []
  const notes: ImportNote[] = []

  for (const [index, record] of parsed.data.entries()) {
    const row = index + 1
    const field = (name: string): string => (record[name] ?? '').trim()
    const url = field('url')
    const isNote = url === SECURE_NOTE_URL
    const name = field('name') || (isNote || url === '' ? '' : hostOf(url))

    if (badRows.has(index)) {
      notes.push({ row, name, reason: 'parse_error' })
      continue
    }
    if (name === '') {
      notes.push({ row, name: '', reason: 'no_name_no_url' })
      continue
    }

    const grouping = field('grouping')
    const extra = record.extra ?? ''
    const base = {
      v: 1 as const,
      seq: 1,
      name: name.slice(0, 256),
      folder: grouping === '' || grouping === '(none)' ? null : grouping,
      favorite: field('fav') === '1',
      trashed: false,
      edited_at: now.toISOString(),
      edited_by: deviceId,
      note: extra,
    }
    const totp = field('totp')
    const payload: ItemPayload = isNote
      ? { ...base, type: 'note' }
      : {
          ...base,
          type: 'login',
          login: {
            username: field('username'),
            // The password is kept exactly as exported, spaces included.
            password: record.password ?? '',
            urls: url === '' ? [] : [{ url: normalizeUrl(url) ?? url, match: 'domain' }],
            totp_secret: totp === '' ? null : totp,
          },
        }

    const key = duplicateKey(payload)
    if (seen.has(key)) {
      notes.push({ row, name, reason: 'duplicate' })
      continue
    }
    seen.add(key)
    if (isNote && extra.startsWith('NoteType:')) {
      notes.push({ row, name, reason: 'structured_note_as_text' })
    }
    items.push({ row, payload })
  }
  return { items, notes }
}

/**
 * Seals and queues parsed items 50 at a time, and builds the report. Nothing is uploaded here:
 * the sealed items wait in the queue for the next sync like any other write.
 * @param onProgress - Called after each batch with how many rows are done.
 */
export const importParsedItems = async (
  cache: Cache,
  vaultKey: Uint8Array,
  parsed: ParsedImport,
  now: Date = new Date(),
  onProgress: (done: number, total: number) => void = () => {},
): Promise<ImportReport> => {
  const skipped = parsed.notes.filter((note) => note.reason !== 'structured_note_as_text')
  const tooLarge: ImportNote[] = []
  let imported = 0
  for (let start = 0; start < parsed.items.length; start += BATCH_SIZE) {
    for (const { row, payload } of parsed.items.slice(start, start + BATCH_SIZE)) {
      const created = await createItemFromPayload(cache, vaultKey, payload, now)
      if (created.ok) imported += 1
      else tooLarge.push({ row, name: payload.name, reason: 'too_large' })
    }
    onProgress(Math.min(start + BATCH_SIZE, parsed.items.length), parsed.items.length)
    // Let the page paint between batches.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const failed = new Set(tooLarge.map((note) => note.row))
  return {
    imported,
    skipped: [...skipped, ...tooLarge].toSorted((a, b) => a.row - b.row),
    warnings: parsed.notes.filter(
      (note) => note.reason === 'structured_note_as_text' && !failed.has(note.row),
    ),
  }
}
