import { z } from 'zod'

const MAX_TEXT = 4096

/**
 * Messages a content script may send. The background reads the page origin and frame only from
 * `sender`, never from the payload.
 */
export const contentMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('suggest') }),
  z.object({
    type: z.literal('fill'),
    item_id: z.string().min(1).max(64),
    field_ids: z.array(z.string().min(1).max(64)).min(1).max(2),
  }),
  z.object({
    type: z.literal('submitted'),
    username: z.string().max(MAX_TEXT),
    password: z.string().min(1).max(MAX_TEXT),
    password_new: z.string().min(1).max(MAX_TEXT).optional(),
  }),
  z.object({ type: z.literal('prompt-get') }),
  z.object({
    type: z.literal('prompt-answer'),
    action: z.enum(['save', 'update', 'dismiss']),
    item_id: z.string().min(1).max(64).optional(),
  }),
])

/** Messages only an extension page (the popup) may send. */
export const popupMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('unlocked') }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('sync') }),
  z.object({ type: z.literal('activity') }),
  z.object({
    type: z.literal('copy'),
    text: z.string().max(65536),
    item_id: z.string().max(64).optional(),
  }),
])

export type ContentMessage = z.infer<typeof contentMessageSchema>
export type PopupMessage = z.infer<typeof popupMessageSchema>

/** One row of the suggestion list. It never carries a password. */
export type Suggestion = {
  readonly item_id: string
  readonly name: string
  readonly username: string
}

/** Reply to `suggest`. */
export type SuggestReply =
  | { readonly status: 'ok'; readonly matches: readonly Suggestion[] }
  | { readonly status: 'locked' }
  | { readonly status: 'blocked' }

/** Reply to `fill`: the one login that was clicked, or a refusal. */
export type FillReply =
  | {
      readonly status: 'ok'
      readonly username: string
      readonly password: string
      readonly field_ids: readonly string[]
    }
  | { readonly status: 'refused' }

/** What the save bar shows. It never carries a password. */
export type PromptView =
  | { readonly kind: 'save'; readonly host: string; readonly username: string }
  | {
      readonly kind: 'update'
      readonly host: string
      readonly username: string
      readonly item: Suggestion
    }
  | {
      readonly kind: 'choose'
      readonly host: string
      readonly username: string
      readonly items: readonly Suggestion[]
    }
  | { readonly kind: 'unlock'; readonly host: string }

/** Reply to `prompt-answer`. */
export type PromptAnswerReply = { readonly status: 'saved' | 'dismissed' | 'locked' | 'failed' }

/** Messages the background sends to the top frame's content script. */
export const promptPushSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt-show'), prompt: z.custom<PromptView>() }),
  z.object({ type: z.literal('prompt-hide') }),
])
export type PromptPush = z.infer<typeof promptPushSchema>

/** Messages the background sends to the offscreen document. */
export const offscreenMessageSchema = z.discriminatedUnion('type', [
  z.object({
    target: z.literal('offscreen'),
    type: z.literal('clipboard-write'),
    text: z.string(),
  }),
  z.object({ target: z.literal('offscreen'), type: z.literal('clipboard-read') }),
])
export type OffscreenMessage = z.infer<typeof offscreenMessageSchema>
