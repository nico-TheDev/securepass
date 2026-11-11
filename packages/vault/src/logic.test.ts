import type { ItemPayload } from '@securepass/shared'
import { describe, expect, it, vi } from 'vitest'
import { checkBreach } from './breach'
import { resolveConflict } from './conflict'
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
  randomInt,
} from './generator'
import { parseLastPassCsv } from './import-lastpass'
import {
  draftOf,
  editItemPayload,
  emptyDraft,
  newItemPayload,
  pushPasswordHistory,
} from './payload'
import { filterItems, foldersOf } from './search'
import { matchSavedUrl, normalizeUrl, siteOf } from './url'
import { EFF_WORDS } from './wordlist'

const at = (minutes: number): string => new Date(Date.UTC(2026, 10, 3, 10, minutes)).toISOString()
const login = (overrides: Partial<ItemPayload> = {}, password = 'pw-a'): ItemPayload => ({
  v: 1,
  seq: 2,
  type: 'login',
  name: 'Example',
  folder: null,
  favorite: false,
  trashed: false,
  edited_at: at(0),
  edited_by: 'device-a',
  note: '',
  login: {
    username: 'me',
    password,
    urls: [{ url: 'https://example.com', match: 'domain' }],
    totp_secret: null,
  },
  ...overrides,
})
const serverTime = Date.UTC(2026, 10, 3, 10, 30) / 1000
const now = new Date(Date.UTC(2026, 10, 3, 11, 0))

describe('conflict rules (AC-9, AC-12)', () => {
  it('the newer edit wins and the whole losing version is kept as a conflict copy', () => {
    const local = login({ edited_at: at(10), edited_by: 'device-a', name: 'Local' }, 'pw-local')
    const server = login({ edited_at: at(5), edited_by: 'device-b', name: 'Server' }, 'pw-server')
    const outcome = resolveConflict(local, server, serverTime, now)
    if (outcome.kind !== 'merged') throw new Error('expected merge')
    expect(outcome.winner).toBe('local')
    expect(outcome.payload.name).toBe('Local')
    expect(outcome.payload.conflict_copies).toHaveLength(1)
    expect(outcome.payload.conflict_copies?.[0]?.payload).toMatchObject({ name: 'Server' })
    expect(outcome.payload.conflict_copies?.[0]?.kept_at).toBe(now.toISOString())
    expect(outcome.payload.password_history?.[0]).toEqual({
      password: 'pw-server',
      replaced_at: now.toISOString(),
    })
  })

  it('when the server copy is newer it wins, and the local edit is still kept', () => {
    const local = login({ edited_at: at(5), name: 'Local' }, 'pw-local')
    const server = login({ edited_at: at(10), edited_by: 'device-b', name: 'Server' }, 'pw-server')
    const outcome = resolveConflict(local, server, serverTime, now)
    if (outcome.kind !== 'merged') throw new Error('expected merge')
    expect(outcome.winner).toBe('server')
    expect(outcome.payload.conflict_copies?.[0]?.payload.name).toBe('Local')
    expect(outcome.payload.password_history?.[0]?.password).toBe('pw-local')
  })

  it('a device clock more than 5 minutes ahead of the server loses to the server copy', () => {
    const fast = login({ edited_at: new Date((serverTime + 6 * 60) * 1000).toISOString() })
    const server = login({ edited_at: at(1), edited_by: 'device-b', name: 'Server' })
    const outcome = resolveConflict(fast, server, serverTime, now)
    expect(outcome.kind === 'merged' && outcome.winner).toBe('server')
    const withinSkew = login({ edited_at: new Date((serverTime + 4 * 60) * 1000).toISOString() })
    const allowed = resolveConflict(withinSkew, server, serverTime, now)
    expect(allowed.kind === 'merged' && allowed.winner).toBe('local')
  })

  it('a tie goes to the higher device id', () => {
    const local = login({ edited_by: 'device-a', name: 'A' })
    const server = login({ edited_by: 'device-b', name: 'B' })
    const outcome = resolveConflict(local, server, serverTime, now)
    expect(outcome.kind === 'merged' && outcome.winner).toBe('server')
    const flipped = resolveConflict(
      login({ edited_by: 'device-z', name: 'Z' }),
      server,
      serverTime,
      now,
    )
    expect(flipped.kind === 'merged' && flipped.winner).toBe('local')
  })

  it('an edit made after a trash wins and restores the item', () => {
    const trashed = login({ trashed: true, edited_at: at(5), edited_by: 'device-b' })
    const edited = login({ edited_at: at(8), name: 'Edited later' })
    const localEdit = resolveConflict(edited, trashed, serverTime, now)
    expect(localEdit.kind === 'merged' && localEdit.payload).toMatchObject({
      trashed: false,
      name: 'Edited later',
    })
    const serverEdit = resolveConflict(
      trashed,
      { ...edited, edited_by: 'device-c' },
      serverTime,
      now,
    )
    expect(serverEdit.kind === 'merged' && serverEdit.winner).toBe('server')
    expect(serverEdit.kind === 'merged' && serverEdit.payload.trashed).toBe(false)
  })

  it('a trash made after the edit wins and the item stays trashed', () => {
    const trashed = login({ trashed: true, edited_at: at(9), edited_by: 'device-b' })
    const edited = login({ edited_at: at(8), name: 'Edited earlier' })
    const outcome = resolveConflict(edited, trashed, serverTime, now)
    expect(outcome.kind === 'merged' && outcome.payload.trashed).toBe(true)
    expect(outcome.kind === 'merged' && outcome.payload.conflict_copies?.[0]?.payload.name).toBe(
      'Edited earlier',
    )
  })

  it('keeps at most 5 conflict copies, dropping the oldest', () => {
    const copies = Array.from({ length: 5 }, (_, index) => ({
      payload: { ...login({ seq: index + 1, edited_at: at(index), name: `Old ${index}` }) },
      kept_at: at(index),
    }))
    const local = login({ edited_at: at(20), seq: 9, conflict_copies: copies })
    const server = login({ edited_at: at(15), edited_by: 'device-b', seq: 8, name: 'Newest loser' })
    const outcome = resolveConflict(local, server, serverTime, now)
    if (outcome.kind !== 'merged') throw new Error('expected merge')
    const names = outcome.payload.conflict_copies?.map((copy) => copy.payload.name)
    expect(names).toEqual(['Newest loser', 'Old 0', 'Old 1', 'Old 2', 'Old 3'])
  })

  it("the same edit on both sides is not a conflict, and neither is this device's own older write", () => {
    expect(resolveConflict(login(), login({ seq: 7 }), serverTime, now)).toEqual({ kind: 'same' })
    const newer = login({ seq: 4, edited_at: at(3), name: 'Second edit' })
    const own = resolveConflict(newer, login({ seq: 3, edited_at: at(2) }), serverTime, now)
    expect(own).toEqual({ kind: 'merged', winner: 'local', payload: newer })
  })

  it('does not add the losing password to the history when it is the same', () => {
    const outcome = resolveConflict(
      login({ edited_at: at(10), name: 'Local' }),
      login({ edited_at: at(5), edited_by: 'device-b' }),
      serverTime,
      now,
    )
    expect(outcome.kind === 'merged' && outcome.payload.password_history).toBeUndefined()
  })
})

describe('password history (AC-12)', () => {
  it('pushes the old password when a login password changes, newest first, 5 at most', () => {
    let payload = newItemPayload({ ...emptyDraft('login'), name: 'Site', password: 'p0' }, 'd', now)
    for (let index = 1; index <= 7; index++) {
      payload = editItemPayload(
        payload,
        { ...draftOf(payload), password: `p${index}` },
        'd',
        new Date(now.getTime() + index * 1000),
        undefined,
      )
    }
    expect(payload.password_history?.map((entry) => entry.password)).toEqual([
      'p6',
      'p5',
      'p4',
      'p3',
      'p2',
    ])
    expect(payload.password_history?.[0]?.replaced_at).toBe(
      new Date(now.getTime() + 7000).toISOString(),
    )
    expect(payload.seq).toBe(8)
  })

  it('leaves the history alone when the password did not change or equals the newest entry', () => {
    const payload = newItemPayload(
      { ...emptyDraft('login'), name: 'Site', password: 'same' },
      'd',
      now,
    )
    const renamed = editItemPayload(payload, { ...draftOf(payload), name: 'Renamed' }, 'd', now, 5)
    expect(renamed.password_history).toBeUndefined()
    expect(renamed.seq).toBe(6)
    expect(pushPasswordHistory([{ password: 'a', replaced_at: at(1) }], 'a', at(2))).toHaveLength(1)
    expect(pushPasswordHistory(undefined, '', at(2))).toEqual([])
  })

  it('builds notes and identities with only their own fields', () => {
    const note = newItemPayload(
      { ...emptyDraft('note'), name: ' Wifi ', note: 'secret', folder: ' Home ' },
      'd',
      now,
    )
    expect(note).toMatchObject({ type: 'note', name: 'Wifi', folder: 'Home', note: 'secret' })
    expect(note.login).toBeUndefined()
    const draft = emptyDraft('identity')
    const identity = newItemPayload(
      { ...draft, name: 'Me', identity: { ...draft.identity, first: ' Ada ', city: '' } },
      'd',
      now,
    )
    expect(identity.identity).toMatchObject({ first: 'Ada', city: null })
    expect(draftOf(identity).identity.first).toBe('Ada')
  })
})

describe('URL rules (AC-14)', () => {
  it('normalizes on save: lowercase host, default port and query dropped, https added', () => {
    expect(normalizeUrl('HTTPS://Example.COM:443/Login?next=1#top')).toBe(
      'https://example.com/Login',
    )
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('http://example.com:8080/')).toBe('http://example.com:8080')
    expect(normalizeUrl('   ')).toBeNull()
    expect(normalizeUrl('ftp://example.com')).toBeNull()
  })

  const domain = (url: string) => ({ url, match: 'domain' as const })
  const host = (url: string) => ({ url, match: 'host' as const })

  it('matches by registrable domain, or by exact host when the item says so', () => {
    expect(matchSavedUrl('https://login.example.com', domain('https://example.com'))).toBe('domain')
    expect(matchSavedUrl('https://example.com', domain('https://example.com/login'))).toBe('host')
    expect(matchSavedUrl('https://login.example.com', host('https://example.com'))).toBeNull()
    expect(matchSavedUrl('https://example.com', host('https://example.com'))).toBe('host')
  })

  it('never matches a lookalike or a sibling on a shared public suffix', () => {
    expect(matchSavedUrl('https://examp1e.com', domain('https://example.com'))).toBeNull()
    expect(matchSavedUrl('https://example.com.evil.net', domain('https://example.com'))).toBeNull()
    expect(matchSavedUrl('https://other.github.io', domain('https://alice.github.io'))).toBeNull()
    expect(matchSavedUrl('https://alice.github.io', domain('https://alice.github.io'))).toBe('host')
    expect(siteOf('https://alice.github.io/repo')).toBe('alice.github.io')
    expect(siteOf('https://a.b.example.co.uk')).toBe('example.co.uk')
  })

  it('IP addresses and localhost match only by exact host and port', () => {
    expect(matchSavedUrl('https://192.168.1.10', domain('https://192.168.1.10'))).toBe('host')
    expect(matchSavedUrl('https://192.168.1.11', domain('https://192.168.1.10'))).toBeNull()
    expect(matchSavedUrl('https://192.168.1.10:8443', domain('https://192.168.1.10'))).toBeNull()
    expect(matchSavedUrl('https://localhost:3000', domain('https://localhost:3000'))).toBe('host')
    expect(matchSavedUrl('https://localhost:3001', domain('https://localhost:3000'))).toBeNull()
  })

  it('a saved URL with an explicit port matches only that port', () => {
    expect(matchSavedUrl('https://example.com:8443', domain('https://example.com:8443'))).toBe(
      'host',
    )
    expect(matchSavedUrl('https://example.com', domain('https://example.com:8443'))).toBeNull()
    expect(matchSavedUrl('https://app.example.com:8443', domain('https://example.com'))).toBe(
      'domain',
    )
  })
})

describe('generator (AC-16)', () => {
  it('makes passwords of the asked length with at least one character from each chosen set', () => {
    for (let round = 0; round < 200; round++) {
      const result = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 8 })
      if (!result.ok) throw new Error('generate failed')
      expect(result.value).toHaveLength(8)
      expect(result.value).toMatch(/[A-Z]/)
      expect(result.value).toMatch(/[a-z]/)
      expect(result.value).toMatch(/[0-9]/)
      expect(result.value).toMatch(/[^A-Za-z0-9]/)
    }
  })

  it('honours the chosen sets and the look alike option', () => {
    const digits = generatePassword({
      length: 128,
      upper: false,
      lower: false,
      digits: true,
      symbols: false,
      excludeLookalikes: true,
    })
    expect(digits.ok && /^[2-9]{128}$/.test(digits.value)).toBe(true)
    const letters = generatePassword({
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 128,
      digits: false,
      symbols: false,
      excludeLookalikes: true,
    })
    expect(letters.ok && /^[A-HJ-NP-Za-km-z]{128}$/.test(letters.value)).toBe(true)
  })

  it('refuses lengths outside 8 to 128 and an empty choice of sets', () => {
    expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 7 })).toEqual({
      ok: false,
      error: 'length_out_of_range',
    })
    expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 129 })).toEqual({
      ok: false,
      error: 'length_out_of_range',
    })
    expect(
      generatePassword({
        length: 20,
        upper: false,
        lower: false,
        digits: false,
        symbols: false,
        excludeLookalikes: false,
      }),
    ).toEqual({ ok: false, error: 'no_character_set' })
  })

  it('makes passphrases of 3 to 12 words from the EFF list', () => {
    expect(EFF_WORDS).toHaveLength(7776)
    const words = new Set(EFF_WORDS)
    const result = generatePassphrase({
      ...DEFAULT_PASSPHRASE_OPTIONS,
      capitalize: false,
      words: 12,
      separator: ' ',
    })
    if (!result.ok) throw new Error('generate failed')
    const parts = result.value.split(' ')
    expect(parts).toHaveLength(12)
    expect(parts.every((part) => words.has(part))).toBe(true)
    const fancy = generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, includeNumber: true })
    expect(fancy.ok && fancy.value).toMatch(/^([A-Z][a-z-]+\d?-){4}[A-Z][a-z-]+\d?$/)
    expect(fancy.ok && fancy.value).toMatch(/\d/)
    expect(generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 2 }).ok).toBe(false)
    expect(generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 13 }).ok).toBe(false)
  })

  it('draws from crypto.getRandomValues and rejects values that would cause modulo bias', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    // 0xFFFFFFFF is above the largest multiple of 10, so it must be thrown away and drawn again.
    spy.mockImplementationOnce((buffer) => {
      ;(buffer as Uint32Array)[0] = 0xffffffff
      return buffer
    })
    spy.mockImplementationOnce((buffer) => {
      ;(buffer as Uint32Array)[0] = 23
      return buffer
    })
    expect(randomInt(10)).toBe(3)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
    const counts = new Array<number>(6).fill(0)
    for (let round = 0; round < 6000; round++)
      counts[randomInt(6)] = (counts[randomInt(6)] ?? 0) + 1
    expect(Math.min(...counts)).toBeGreaterThan(700)
  })
})

describe('breach check (AC-18)', () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  it('sends only the first 5 hex characters and matches the rest locally', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0\r\n',
        ),
    )
    const result = await checkBreach('password', fetcher as unknown as typeof fetch)
    expect(result).toEqual({ ok: true, value: 3861493 })
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    expect(init.headers).toEqual({ 'Add-Padding': 'true' })
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('1E4C9B93')
    expect(url.slice(url.lastIndexOf('/') + 1)).toHaveLength(5)
  })

  it('reports 0 when there is no match and network when the lookup fails', async () => {
    const none = await checkBreach(
      'password',
      (async () => new Response('ABC:5\n')) as unknown as typeof fetch,
    )
    expect(none).toEqual({ ok: true, value: 0 })
    const down = await checkBreach('x', (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch)
    expect(down).toEqual({ ok: false, error: 'network' })
    const bad = await checkBreach(
      'x',
      (async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    )
    expect(bad).toEqual({ ok: false, error: 'network' })
  })
})

describe('LastPass CSV import (AC-17)', () => {
  const csv = [
    '﻿url,username,password,totp,extra,name,grouping,fav',
    'https://Example.com/login?x=1,me@example.com, spaced pw ,JBSWY3DP,"line one',
    'line two",Example,Work\\Sites,1',
    'http://sn,,,,"NoteType:Credit Card',
    'Number:4111",My card,(none),0',
    'http://sn,,,,just a note,Wifi,,0',
    'https://nameless.example.org/path,user,pw,,,,,0',
    ',,,,,,,0',
    'https://example.com/other,me@example.com,pw2,,,Example,,0',
    'https://existing.example.net,bob,pw,,,Existing,,0',
  ].join('\r\n')
  const existing = [
    login({
      name: 'existing',
      login: {
        username: 'Bob',
        password: 'x',
        urls: [{ url: 'https://www.existing.example.net', match: 'domain' }],
        totp_secret: null,
      },
    }),
  ]

  it('maps the columns, reads multi line fields, and reports each skipped row with its reason', () => {
    const parsed = parseLastPassCsv(csv, existing, 'device-1', now)
    expect(parsed.items.map((item) => item.payload.name)).toEqual([
      'Example',
      'My card',
      'Wifi',
      'nameless.example.org',
    ])
    expect(parsed.items[0]?.payload).toMatchObject({
      type: 'login',
      folder: 'Work\\Sites',
      favorite: true,
      note: 'line one\r\nline two',
      edited_at: now.toISOString(),
      edited_by: 'device-1',
      login: {
        username: 'me@example.com',
        password: ' spaced pw ',
        totp_secret: 'JBSWY3DP',
        urls: [{ url: 'https://example.com/login', match: 'domain' }],
      },
    })
    expect(parsed.items[1]?.payload).toMatchObject({
      type: 'note',
      folder: null,
      note: 'NoteType:Credit Card\r\nNumber:4111',
    })
    expect(parsed.items[1]?.payload.login).toBeUndefined()
    expect(parsed.notes).toEqual([
      { row: 2, name: 'My card', reason: 'structured_note_as_text' },
      { row: 5, name: '', reason: 'no_name_no_url' },
      { row: 6, name: 'Example', reason: 'duplicate' },
      { row: 7, name: 'Existing', reason: 'duplicate' },
    ])
  })

  it('reports a row with the wrong number of fields as a parse error', () => {
    const parsed = parseLastPassCsv(
      'url,username,password,totp,extra,name,grouping,fav\nhttps://a.example,u,p,,,A,,0\nhttps://b.example,u,p\n',
      [],
      'd',
      now,
    )
    expect(parsed.items.map((item) => item.payload.name)).toEqual(['A'])
    expect(parsed.notes).toEqual([{ row: 2, name: 'b.example', reason: 'parse_error' }])
  })
})

describe('list filter', () => {
  const item = (id: string, payload: ItemPayload) => ({
    kind: 'item' as const,
    id,
    revision: 1,
    pending: false,
    payload,
    deletedAt: null,
    rolledBack: false,
  })
  const items = [
    item('a', login({ name: 'Bank', folder: 'Money', favorite: true })),
    item(
      'b',
      login({
        name: 'apple',
        folder: 'Shopping',
        login: {
          username: 'ada',
          password: 'x',
          urls: [{ url: 'https://store.apple.example', match: 'domain' }],
          totp_secret: null,
        },
      }),
    ),
    item('c', login({ name: 'Gone', trashed: true, folder: 'Old' })),
    { kind: 'damaged' as const, id: 'd' },
  ]

  it('filters by view, folder, and query, and sorts by name', () => {
    expect(
      filterItems(items, { view: 'all', query: '', folder: null }).map((entry) => entry.id),
    ).toEqual(['d', 'b', 'a'])
    expect(
      filterItems(items, { view: 'favorites', query: '', folder: null }).map((entry) => entry.id),
    ).toEqual(['a'])
    expect(
      filterItems(items, { view: 'trash', query: '', folder: null }).map((entry) => entry.id),
    ).toEqual(['c'])
    expect(
      filterItems(items, { view: 'all', query: 'ADA store', folder: null }).map(
        (entry) => entry.id,
      ),
    ).toEqual(['b'])
    expect(
      filterItems(items, { view: 'all', query: '', folder: 'Money' }).map((entry) => entry.id),
    ).toEqual(['a'])
    expect(foldersOf(items)).toEqual(['Money', 'Shopping'])
  })

  it('never searches passwords', () => {
    expect(filterItems(items, { view: 'all', query: 'pw-a', folder: null })).toEqual([])
  })
})
