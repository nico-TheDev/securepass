---

## source: generated-from-product-brief

# securepass web vault: design

## Character

Calm and plain spoken, like a well kept ledger. A locked vault is a normal state, so nothing flashes or alarms. Warm paper background in light mode, deep green black in dark mode, one teal accent. No logos, no stock art, no gradients. Honest copy: the page says what it can and cannot protect.

## Build mandate

- Auth screens use a two panel shell: a quiet side panel that states plainly what stays on this device, and a form card. The side panel stacks above the form on narrow screens.
- The recovery kit step is the one ceremony: the key is large, monospaced, in groups of four, with a download button and a retype check. Nothing else competes with it.
- The vault view is a toolbar (brand, sync status, lock) plus a list. The list has a real empty state and shows a "not synced yet" tag on writes still in the queue.
- Secrets are hidden by default. Passwords are never printed in the list.
- Motion is limited to short fades and a progress bar, and is off under `prefers-reduced-motion`.
- System font stacks only (no web fonts), so nothing is fetched from another origin.

## Where the tokens live

All colors, spacing, radii, and type sizes are CSS custom properties in `src/index.css`, with light and dark values. Contrast was checked for WCAG AA: body text 15:1, muted text 6:1, accent on surface 7:1, field borders 3:1 or more in both themes.
