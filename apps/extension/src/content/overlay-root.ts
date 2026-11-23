import { browser } from 'wxt/browser'

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.icon, .list, .bar {
  --surface: #ffffff; --text: #16201e; --muted: #4f5d59; --accent: #0b6355; --on-accent: #ffffff;
  --accent-soft: #e3efeb; --line: #8d9a96; --danger: #a3261f;
  position: fixed; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--text); pointer-events: auto;
}
@media (prefers-color-scheme: dark) {
  .icon, .list, .bar {
    --surface: #161e1c; --text: #e9f0ed; --muted: #a3b3ae; --accent: #5fcdb6; --on-accent: #04211b;
    --accent-soft: #1b2e2a; --line: #6f807b; --danger: #ff9a90;
  }
}
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
.icon {
  width: 22px; height: 22px; padding: 0; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); display: grid; place-items: center;
}
.icon:hover { background: var(--accent-soft); }
.icon span { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.list, .bar {
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
}
.list { max-height: 260px; overflow: auto; }
.note { pointer-events: none; }
.title { margin: 2px 8px 6px; font-size: 12px; color: var(--muted); }
.text { margin: 6px 8px; }
.row {
  display: block; width: 100%; text-align: left; border: 0; border-radius: 6px; padding: 8px;
  background: transparent; min-height: 44px;
}
.row:hover, .row:focus-visible { background: var(--accent-soft); }
.row b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row small { display: block; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { top: 12px; right: 12px; width: 320px; max-width: calc(100vw - 24px); padding: 12px; }
.bar h2 { margin: 0 0 4px; font-size: 15px; }
.bar p { margin: 0 0 10px; color: var(--muted); overflow-wrap: anywhere; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn {
  min-height: 36px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); font-weight: 600;
}
.btn:hover { background: var(--accent-soft); }
.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.primary:hover { background: var(--accent); filter: brightness(1.08); }
`

/**
 * Makes the one element this extension adds to a page, with a closed shadow root. The page's
 * scripts cannot reach inside it, so they can neither read the suggestion list nor click it.
 * Styles go in through a constructed sheet, which a page's CSP cannot block.
 */
export const createOverlayRoot = (doc: Document): ShadowRoot => {
  const host = doc.createElement('div')
  host.style.setProperty('all', 'initial')
  host.style.setProperty('position', 'fixed')
  host.style.setProperty('top', '0')
  host.style.setProperty('left', '0')
  host.style.setProperty('width', '0')
  host.style.setProperty('height', '0')
  host.style.setProperty('z-index', '2147483647')
  // The empty host itself never takes a click or hides what is under it.
  host.style.setProperty('pointer-events', 'none')
  const root = host.attachShadow({ mode: 'closed' })
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(STYLES)
  root.adoptedStyleSheets = [sheet]
  doc.documentElement.append(host)
  return root
}

/** Makes an element with a class and optional text. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = doc.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Sends a message to the background. Returns `undefined` if the extension was reloaded. */
export const ask = async <T>(message: unknown): Promise<T | undefined> => {
  try {
    return (await browser.runtime.sendMessage(message)) as T | undefined
  } catch {
    return undefined
  }
}
