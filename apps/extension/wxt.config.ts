import { defineConfig } from 'wxt'
import { parseServerUrl } from './src/server-url'

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // A real production build needs the server origin. `wxt prepare` (run on install) does not.
    'build:manifestGenerated': (wxt) => {
      const server = parseServerUrl(import.meta.env.WXT_SERVER_URL, wxt.config.mode === 'production')
      if (!server.ok) throw new Error(server.error)
    },
  },
  // A function, so it runs after WXT has loaded the `.env` files.
  manifest: () => {
    const server = parseServerUrl(import.meta.env.WXT_SERVER_URL, false)
    if (!server.ok) throw new Error(server.error)
    return {
      name: 'securepass',
      description: 'Fills logins from your own securepass vault, only after you click.',
      minimum_chrome_version: '120',
      permissions: [
        'storage',
        'alarms',
        'idle',
        'offscreen',
        'clipboardWrite',
        'clipboardRead',
        'webNavigation',
        'activeTab',
      ],
      // Only the vault server and the breach check. Pages are reached through the content script.
      host_permissions: [`${server.value}/*`, 'https://api.pwnedpasswords.com/*'],
      // `wasm-unsafe-eval` is for Argon2id (hash-wasm) in the popup. No remote code.
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
    }
  },
})
