/** An `ArrayBuffer` copy of the bytes, the form D1 accepts for a blob. */
export const blobOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer

/** Random bytes from the platform's cryptographic source. */
export const randomBytes = (length: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(length))
