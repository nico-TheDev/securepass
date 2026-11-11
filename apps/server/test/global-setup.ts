import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

/** Test only secrets. Each key is 32 bytes in base64url; none is used anywhere else. */
export const TEST_VARS = {
  SETUP_TOKEN: 'test-setup-token-0123456789',
  AUTH_HMAC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  CODE_HMAC_KEY: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
  IP_HASH_KEY: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
  PRELOGIN_KEY: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM',
  TOTP_ENC_KEY: 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ',
  ALLOWED_ORIGINS: 'chrome-extension://testextensionid',
} as const

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })

const waitForHealth = async (baseUrl: string): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('The Worker did not start')
}

let worker: ChildProcess | undefined
let persistDir: string | undefined

/** Starts the real Worker on a local D1 database with the migrations applied. */
// biome-ignore lint/style/noDefaultExport: Vitest requires a default export for global setup.
export default async function setup(project: TestProject): Promise<() => void> {
  persistDir = mkdtempSync(join(tmpdir(), 'securepass-server-test-'))
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'securepass',
      '--local',
      '--persist-to',
      persistDir,
    ],
    { stdio: 'pipe', env: { ...process.env, CI: '1' } },
  )
  const port = await freePort()
  const vars = Object.entries(TEST_VARS).flatMap(([name, value]) => ['--var', `${name}:${value}`])
  worker = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      persistDir,
      '--test-scheduled',
      '--show-interactive-dev-session=false',
      ...vars,
    ],
    { stdio: 'pipe', env: { ...process.env, CI: '1' }, detached: true },
  )
  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHealth(baseUrl)
  project.provide('baseUrl', baseUrl)
  project.provide('persistDir', persistDir)
  return () => {
    if (worker?.pid) {
      try {
        process.kill(-worker.pid, 'SIGTERM')
      } catch {
        worker.kill('SIGTERM')
      }
    }
    if (persistDir) rmSync(persistDir, { recursive: true, force: true })
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    persistDir: string
  }
}
