import type { RecoveryKit } from '@securepass/crypto'
import { describe, expect, it } from 'vitest'
import { RECOVERY_KIT_FILE_NAME, recoveryKitText } from './recovery-kit-file'

const kit = {
  display: 'ABCD-EFGH-IJKL',
  groups: ['ABCD', 'EFGH', 'IJKL'],
} as unknown as RecoveryKit

describe('recoveryKitText', () => {
  const text = recoveryKitText(
    kit,
    'me@example.com',
    'https://vault.example.com',
    new Date('2026-11-03T23:59:59Z'),
  )

  it('includes the recovery key, email, server, and date', () => {
    expect(text).toContain('Recovery key: ABCD-EFGH-IJKL')
    expect(text).toContain('Email: me@example.com')
    expect(text).toContain('Server: https://vault.example.com')
    expect(text).toContain('Date: 2026-11-03')
  })

  it('tells the user to keep the file offline', () => {
    expect(text).toMatch(/offline/i)
  })

  it('ends with a newline', () => {
    expect(text.endsWith('\n')).toBe(true)
  })

  it('names the file as a text file', () => {
    expect(RECOVERY_KIT_FILE_NAME).toBe('securepass-recovery-kit.txt')
  })
})
