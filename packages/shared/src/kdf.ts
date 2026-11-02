import { z } from 'zod'

/** Argon2id settings: memory in KiB (`m`), passes (`t`), lanes (`p`). Only `argon2id` exists. */
export const kdfParamsSchema = z.object({
  alg: z.literal('argon2id'),
  m: z.number().int(),
  t: z.number().int(),
  p: z.number().int(),
})

export type KdfParams = z.infer<typeof kdfParamsSchema>
