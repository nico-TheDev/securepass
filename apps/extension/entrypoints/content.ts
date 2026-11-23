import { createOverlayRoot } from '../src/content/overlay-root'
import { startFill } from '../src/fill/overlay'
import { startSaveBar } from '../src/save/bar'
import { startCapture } from '../src/save/capture'

// Runs in every `https` frame. It only finds fields, draws the icon, list, and save bar in a
// closed shadow root, and reports submits. It never holds the vault key, and the only password it
// ever receives is the one you clicked. The background decides everything from `sender`.
export default defineContentScript({
  matches: ['https://*/*'],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    const root = createOverlayRoot(document)
    startFill(document, root)
    startCapture(document)
    if (window.top === window) startSaveBar(document, root)
  },
})
