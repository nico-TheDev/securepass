import type { RecoveryKit } from '@securepass/crypto'

/** The file name the recovery kit is saved under. */
export const RECOVERY_KIT_FILE_NAME = 'securepass-recovery-kit.txt'

/**
 * The text of the recovery kit file: the key in groups of 4, the email, the server, and the date.
 * @param kit - The new recovery kit.
 * @param email - The account email.
 * @param serverUrl - The server origin this vault belongs to.
 * @param date - When the kit was made.
 */
export const recoveryKitText = (
  kit: RecoveryKit,
  email: string,
  serverUrl: string,
  date: Date,
): string =>
  [
    'securepass recovery kit',
    '',
    'Keep this file somewhere safe and offline. Anyone with it and a second proof can reach your vault.',
    'If you forget your master password, this key is the only way back in.',
    '',
    `Recovery key: ${kit.display}`,
    `Email: ${email}`,
    `Server: ${serverUrl}`,
    `Date: ${date.toISOString().slice(0, 10)}`,
    '',
  ].join('\n')
