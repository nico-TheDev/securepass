import { browser } from 'wxt/browser'
import { ask, el } from '../content/overlay-root'
import {
  type ContentMessage,
  type PromptAnswerReply,
  type PromptView,
  promptPushSchema,
} from '../messages'

const who = (view: { readonly username: string; readonly host: string }): string =>
  view.username === '' ? `On ${view.host}` : `${view.username} on ${view.host}`

/**
 * The save bar: shown in the top frame after a login was submitted. It is drawn inside the closed
 * shadow root, never shows a password, and writes nothing until you click.
 */
export const startSaveBar = (doc: Document, root: ShadowRoot): void => {
  let bar: HTMLElement | null = null
  const hide = (): void => {
    bar?.remove()
    bar = null
  }

  const say = (text: string, thenHide: boolean): void => {
    hide()
    bar = el(doc, 'div', 'bar')
    bar.setAttribute('role', 'status')
    bar.append(el(doc, 'p', '', text))
    root.append(bar)
    if (thenHide) setTimeout(hide, 2500)
  }

  const answer = async (action: 'save' | 'update' | 'dismiss', itemId?: string): Promise<void> => {
    const message: ContentMessage = {
      type: 'prompt-answer',
      action,
      ...(itemId === undefined ? {} : { item_id: itemId }),
    }
    const reply = await ask<PromptAnswerReply>(message)
    if (action === 'dismiss') return hide()
    if (reply?.status === 'saved') return say('Saved to securepass.', true)
    if (reply?.status === 'locked')
      return say('securepass is locked. Unlock it, then try again.', true)
    say('securepass could not save this login.', true)
  }

  const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
    const node = el(doc, 'button', className, label)
    node.type = 'button'
    // Only a real click counts. A click made by a script does nothing.
    node.addEventListener('click', (event) => {
      if (event.isTrusted) onClick()
    })
    return node
  }

  const show = (view: PromptView): void => {
    hide()
    const node = el(doc, 'div', 'bar')
    node.setAttribute('role', 'region')
    node.setAttribute('aria-label', 'securepass')
    const actions = el(doc, 'div', 'actions')
    const notNow = button('Not now', 'btn', () => void answer('dismiss'))

    if (view.kind === 'save') {
      node.append(el(doc, 'h2', '', 'Save login?'), el(doc, 'p', '', who(view)))
      actions.append(
        button('Save', 'btn primary', () => void answer('save')),
        notNow,
      )
    } else if (view.kind === 'update') {
      node.append(
        el(doc, 'h2', '', 'Update password?'),
        el(
          doc,
          'p',
          '',
          `${view.item.name}: ${who(view)}. The old password is kept in its history.`,
        ),
      )
      actions.append(
        button('Update', 'btn primary', () => void answer('update', view.item.item_id)),
        notNow,
      )
    } else if (view.kind === 'choose') {
      node.append(
        el(doc, 'h2', '', 'Update password?'),
        el(doc, 'p', '', `Several logins match ${who(view)}. Choose the one to update.`),
      )
      for (const item of view.items) {
        const row = button('', 'row', () => void answer('update', item.item_id))
        row.append(
          el(doc, 'b', '', item.name),
          el(doc, 'small', '', item.username || 'No username'),
        )
        node.append(row)
      }
      actions.append(notNow)
    } else {
      node.append(
        el(doc, 'h2', '', 'Unlock to save'),
        el(
          doc,
          'p',
          '',
          `Open securepass from the toolbar and unlock it to save this login for ${view.host}. It waits for 2 minutes.`,
        ),
      )
      actions.append(notNow)
    }
    node.append(actions)
    root.append(node)
    bar = node
  }

  browser.runtime.onMessage.addListener((raw, sender) => {
    if (sender.id !== browser.runtime.id || sender.tab !== undefined) return
    const message = promptPushSchema.safeParse(raw)
    if (!message.success) return
    if (message.data.type === 'prompt-show') show(message.data.prompt)
    else hide()
  })

  void ask<PromptView | null>({ type: 'prompt-get' } satisfies ContentMessage).then((view) => {
    if (view) show(view)
  })
}
