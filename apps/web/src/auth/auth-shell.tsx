import type { ReactNode } from 'react'
import { Brand } from '../ui/brand'

/**
 * The two panel layout around every signed out screen: a side panel that says plainly what stays on
 * this device and what this page cannot protect, and the form beside it.
 */
export function AuthShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="auth">
      <a className="skip-link" href="#main">
        Skip to the form
      </a>
      <aside className="auth-aside" aria-label="About this vault">
        <Brand />
        <div>
          <h2>Your vault, on your own server</h2>
          <ul className="trust-list">
            <li>
              <strong>Encrypted here first</strong>
              <span>
                Your master password and keys stay in this browser. The server only stores scrambled
                data.
              </span>
            </li>
            <li>
              <strong>Type your master password only on devices you trust</strong>
              <span>
                This page is delivered by your server, so a hacked server could change it. The
                browser extension is the trusted way in.
              </span>
            </li>
          </ul>
        </div>
        <p className="field-hint">One account. No sharing. No vendor.</p>
      </aside>
      <main className="auth-main" id="main">
        {children}
      </main>
    </div>
  )
}
