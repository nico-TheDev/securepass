import { sql } from 'drizzle-orm'
import { check, customType, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** A blob column that reads and writes `Uint8Array`, so the Worker needs no `Buffer`. */
const bytes = customType<{ data: Uint8Array; driverData: ArrayBuffer | number[] }>({
  dataType: () => 'blob',
  toDriver: (value) => value.slice().buffer,
  fromDriver: (value) => new Uint8Array(value),
})

/** Largest ciphertext one item may hold, in bytes. */
export const MAX_ITEM_SIZE = 65536

/** The single account. Setup refuses a second row. */
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  kdf: text('kdf').notNull(),
  kdfSalt: bytes('kdf_salt').notNull(),
  authKeyHmac: bytes('auth_key_hmac').notNull(),
  recoveryAuthHmac: bytes('recovery_auth_hmac').notNull(),
  wrappedVaultKey: bytes('wrapped_vault_key').notNull(),
  wrappedVaultKeyRecovery: bytes('wrapped_vault_key_recovery').notNull(),
  totpSecretEnc: bytes('totp_secret_enc'),
  totpEnabled: integer('totp_enabled').notNull().default(0),
  totpLastStep: integer('totp_last_step'),
  recoveryCodeHmacs: text('recovery_code_hmacs').notNull().default('[]'),
  recoveryTokenHash: bytes('recovery_token_hash'),
  recoveryTokenExpiresAt: integer('recovery_token_expires_at'),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

/** One row per signed in device. Only the SHA-256 of the token is stored. */
export const deviceSession = sqliteTable('device_session', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => account.id),
  deviceName: text('device_name').notNull(),
  // `unique()` creates the index the spec asks for on `token_hash`.
  tokenHash: bytes('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  revokedAt: integer('revoked_at'),
})

/** One row per item. `ciphertext` is null once purged (a tombstone). */
export const item = sqliteTable(
  'item',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => account.id),
    revision: integer('revision').notNull(),
    ciphertext: bytes('ciphertext'),
    size: integer('size').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    purgeAfter: integer('purge_after'),
    purgedAt: integer('purged_at'),
  },
  (table) => [
    index('item_account_revision_idx').on(table.accountId, table.revision),
    check('item_size_max', sql`${table.size} <= ${sql.raw(String(MAX_ITEM_SIZE))}`),
  ],
)

/** Failed and successful credential checks, used by the login limiter. */
export const loginAttempt = sqliteTable(
  'login_attempt',
  {
    id: text('id').primaryKey(),
    ipHash: bytes('ip_hash').notNull(),
    accountId: text('account_id'),
    kind: text('kind', { enum: ['login', 'recover', 'totp'] }).notNull(),
    at: integer('at').notNull(),
    outcome: text('outcome').notNull(),
  },
  (table) => [
    index('login_attempt_ip_at_idx').on(table.ipHash, table.at),
    index('login_attempt_account_at_idx').on(table.accountId, table.at),
  ],
)
