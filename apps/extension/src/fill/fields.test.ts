// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotOf } from '../save/capture'
import { findLoginFields, groupOf, usernameFor, writeField } from './fields'

const input = (id: string): HTMLInputElement => {
  const node = document.getElementById(id)
  if (!(node instanceof HTMLInputElement)) throw new Error(`no input #${id}`)
  return node
}
const isPassword = (field: HTMLInputElement): boolean => field.type === 'password'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('findLoginFields', () => {
  it('pairs a password field with the text field before it in the same form', () => {
    document.body.innerHTML = `
      <input id="search" type="text">
      <form><input id="user" type="email"><input id="pw" type="password"><input id="after"></form>`
    const groups = findLoginFields(document)
    expect(groups).toEqual([{ username: input('user'), password: input('pw') }])
    expect(groupOf(groups, input('user'))).toBe(groups[0])
    expect(groupOf(groups, input('search'))).toBeUndefined()
  })

  it('skips disabled, read only, and non text inputs when looking for the username', () => {
    document.body.innerHTML = `
      <form><input id="user"><input type="checkbox"><input id="ro" readonly>
      <input id="off" disabled><input id="pw" type="password"></form>`
    expect(usernameFor(input('pw'))).toBe(input('user'))
  })

  it('falls back to a hidden autocomplete="username" input on a password only step', () => {
    document.body.innerHTML = `
      <form><input id="pw" type="password">
      <input id="name" type="hidden" autocomplete="username" value="ada"></form>`
    expect(usernameFor(input('pw'))).toBe(input('name'))
  })

  it('finds a lone username field on a page that asks for the name first', () => {
    document.body.innerHTML = `<form><input id="user" autocomplete="username"></form>`
    expect(findLoginFields(document)).toEqual([{ username: input('user'), password: null }])
  })

  it('finds nothing on a page with no login fields', () => {
    document.body.innerHTML = `<form><input type="text" name="q"></form>`
    expect(findLoginFields(document)).toEqual([])
  })
})

describe('writeField', () => {
  it('sets the value and tells the page with input and change events', () => {
    document.body.innerHTML = `<input id="user">`
    const seen: string[] = []
    input('user').addEventListener('input', () => seen.push('input'))
    input('user').addEventListener('change', () => seen.push('change'))
    writeField(input('user'), 'ada')
    expect(input('user').value).toBe('ada')
    expect(seen).toEqual(['input', 'change'])
  })
})

describe('snapshotOf', () => {
  it('reads the username and password of a login form', () => {
    document.body.innerHTML = `
      <form><input id="user" value="ada"><input id="pw" type="password" value="pw-1"></form>`
    expect(snapshotOf(input('pw'), isPassword)).toEqual({ username: 'ada', password: 'pw-1' })
  })

  it('treats two or more filled password fields as a change password form', () => {
    document.body.innerHTML = `
      <form><input id="old" type="password" value="old-pw">
      <input type="password" value="new-pw"><input type="password" value="new-pw"></form>`
    expect(snapshotOf(input('old'), isPassword)).toEqual({
      username: '',
      password: 'old-pw',
      password_new: 'new-pw',
    })
  })

  it('returns nothing while every password field is empty', () => {
    document.body.innerHTML = `<form><input value="ada"><input id="pw" type="password"></form>`
    expect(snapshotOf(input('pw'), isPassword)).toBeNull()
  })
})
