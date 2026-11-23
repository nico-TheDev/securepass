import { describe, expect, it } from 'vitest'
import { loginItem } from '../test-items'
import { decideSave, isExpired, loginsForSite, PENDING_TTL_MS } from './rules'

const ORIGIN = 'https://shop.example.com'
const ada = loginItem('ada', 'Shop', 'ada', 'old-pw', ['https://shop.example.com/login'])
const bob = loginItem('bob', 'Shop (Bob)', 'bob', 'bob-pw', ['https://www.example.com'])
const other = loginItem('other', 'Elsewhere', 'ada', 'x', ['https://other.org'])

const submit = (username: string, password: string, previous?: string) => ({
  origin: ORIGIN,
  username,
  password,
  previous,
})

describe('loginsForSite', () => {
  it('keeps logins of the same registrable domain and drops trashed ones', () => {
    const trashed = loginItem('t', 'Gone', 'ada', 'pw', [ORIGIN], { trashed: true })
    expect(loginsForSite([ada, bob, other, trashed], ORIGIN).map((item) => item.id)).toEqual([
      'ada',
      'bob',
    ])
  })
})

describe('decideSave', () => {
  it('offers to save when no login matches the site and username', () => {
    expect(decideSave([other], submit('ada', 'pw'))).toEqual({ kind: 'save' })
    expect(decideSave([ada], submit('carol', 'pw'))).toEqual({ kind: 'save' })
  })

  it('offers an update when one login matches with a different password', () => {
    expect(decideSave([ada, bob], submit('ada', 'new-pw'))).toEqual({
      kind: 'update',
      itemId: 'ada',
    })
  })

  it('compares usernames without regard to case or outer spaces', () => {
    expect(decideSave([ada], submit(' ADA ', 'new-pw'))).toEqual({ kind: 'update', itemId: 'ada' })
  })

  it('offers nothing when the vault already holds this password', () => {
    expect(decideSave([ada], submit('ada', 'old-pw'))).toEqual({ kind: 'none' })
  })

  it('asks which one when several logins match the username', () => {
    const second = loginItem('ada2', 'Shop admin', 'ada', 'admin-pw', ['https://pay.example.com'])
    expect(decideSave([ada, second], submit('ada', 'new-pw'))).toEqual({
      kind: 'choose',
      itemIds: ['ada', 'ada2'],
    })
  })

  it('picks the login whose current password is the old one on a change password form', () => {
    const second = loginItem('ada2', 'Shop admin', 'ada', 'admin-pw', ['https://pay.example.com'])
    expect(decideSave([ada, second], submit('', 'new-pw', 'admin-pw'))).toEqual({
      kind: 'update',
      itemId: 'ada2',
    })
  })

  it('with no username, updates the only login for the site or asks among several', () => {
    expect(decideSave([ada], submit('', 'new-pw'))).toEqual({ kind: 'update', itemId: 'ada' })
    expect(decideSave([ada, bob], submit('', 'new-pw'))).toEqual({
      kind: 'choose',
      itemIds: ['ada', 'bob'],
    })
  })

  it('offers nothing for an empty password', () => {
    expect(decideSave([], submit('ada', ''))).toEqual({ kind: 'none' })
  })
})

describe('isExpired', () => {
  it('keeps captured credentials for 2 minutes', () => {
    expect(isExpired(1000, 1000 + PENDING_TTL_MS)).toBe(false)
    expect(isExpired(1000, 1001 + PENDING_TTL_MS)).toBe(true)
  })
})
