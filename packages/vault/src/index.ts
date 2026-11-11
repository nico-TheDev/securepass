export { type ApiClient, type ApiError, createApiClient } from './api'
export {
  changeMasterPassword,
  type FinishedRecovery,
  finishRecovery,
  type PendingRecovery,
  reauthenticate,
  type SecondProof,
  type Session,
  type SignInError,
  type SignInInput,
  signIn,
  signInFailure,
  startRecovery,
  type UnlockError,
  unlockWithPassword,
} from './auth'
export { checkBreach, HIBP_RANGE_URL } from './breach'
export { type ConflictOutcome, resolveConflict } from './conflict'
export { syncVault } from './engine'
export {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  type GeneratorError,
  generatePassphrase,
  generatePassword,
  PASSPHRASE_WORDS,
  PASSWORD_LENGTH,
  type PassphraseOptions,
  type PasswordOptions,
  randomInt,
} from './generator'
export {
  type ImportNote,
  type ImportReason,
  type ImportReport,
  importParsedItems,
  type ParsedImport,
  parseLastPassCsv,
} from './import-lastpass'
export {
  createItem,
  createItemFromPayload,
  dismissRollbackFlag,
  loadVaultItems,
  type OpenVaultItem,
  patchItem,
  queueItemWrite,
  type SaveError,
  updateItem,
  type VaultItem,
} from './items'
export {
  draftOf,
  editItemPayload,
  emptyDraft,
  IDENTITY_KEYS,
  type IdentityFields,
  type ItemDraft,
  newItemPayload,
  patchItemPayload,
  pushPasswordHistory,
} from './payload'
export { filterItems, foldersOf, type ListFilter, type ListView, matchesQuery } from './search'
export {
  hostOf,
  matchSavedUrl,
  normalizeUrl,
  type SavedUrl,
  siteOf,
  type UrlMatchMode,
} from './url'
