import type { Cache } from '@securepass/shared/cache'
import { readMeta } from '@securepass/shared/cache'
import {
  type ImportNote,
  type ImportReason,
  type ImportReport,
  importParsedItems,
  type ParsedImport,
  parseLastPassCsv,
  type VaultItem,
} from '@securepass/vault'
import { useId, useState } from 'react'

type Props = {
  readonly cache: Cache
  readonly vaultKey: Uint8Array
  readonly items: readonly VaultItem[]
  /** Called after items were queued, so the list reloads and a sync starts. */
  readonly onImported: () => void
}

const REASON_TEXT: Record<ImportReason, string> = {
  no_name_no_url: 'It has no name and no website.',
  too_large: 'It is larger than one item may be (64 KiB once encrypted).',
  duplicate: 'An item with the same name, username, and site already exists.',
  parse_error: 'The row could not be read. It may have the wrong number of columns.',
  structured_note_as_text:
    'A LastPass structured note (such as a card). It was imported as a plain note holding the raw text.',
}

type Stage =
  | { readonly name: 'pick' }
  | { readonly name: 'ready'; readonly fileName: string; readonly parsed: ParsedImport }
  | { readonly name: 'working'; readonly done: number; readonly total: number }
  | { readonly name: 'done'; readonly report: ImportReport }

function NoteTable({
  caption,
  notes,
}: {
  readonly caption: string
  readonly notes: readonly ImportNote[]
}) {
  if (notes.length === 0) return null
  return (
    <table className="table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Row</th>
          <th scope="col">Name</th>
          <th scope="col">Why</th>
        </tr>
      </thead>
      <tbody>
        {notes.map((note) => (
          <tr key={`${note.row}|${note.reason}`}>
            <td>{note.row}</td>
            <td>{note.name || '(no name)'}</td>
            <td>{REASON_TEXT[note.reason]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Imports a LastPass CSV export. The file is read in this browser and is never uploaded. */
export function ImportScreen({ cache, vaultKey, items, onImported }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'pick' })
  const [error, setError] = useState<string | null>(null)
  const fileId = useId()

  const pick = async (file: File | undefined) => {
    setError(null)
    if (!file) return
    const meta = await readMeta(cache)
    if (!meta)
      return setError('This device has no account record. Lock and unlock, then try again.')
    try {
      const existing = items.flatMap((item) => (item.kind === 'item' ? [item.payload] : []))
      const parsed = parseLastPassCsv(await file.text(), existing, meta.device_id, new Date())
      if (parsed.items.length === 0 && parsed.notes.length === 0) {
        return setError('No rows were found. Is this a LastPass CSV export?')
      }
      setStage({ name: 'ready', fileName: file.name, parsed })
    } catch {
      setError('That file could not be read.')
    }
  }

  const run = async (parsed: ParsedImport) => {
    setStage({ name: 'working', done: 0, total: parsed.items.length })
    const report = await importParsedItems(cache, vaultKey, parsed, new Date(), (done, total) =>
      setStage({ name: 'working', done, total }),
    )
    setStage({ name: 'done', report })
    onImported()
  }

  return (
    <div className="page">
      <h1>Import</h1>
      <section className="panel" aria-labelledby="import-title">
        <h2 id="import-title">Import a LastPass CSV export</h2>
        <p>
          The file is read by this browser and never uploaded. Each row is encrypted here, then
          synced like any other item. Delete the CSV file afterwards: it holds your passwords in
          plain text.
        </p>

        {stage.name === 'pick' ? (
          <div className="field">
            <label htmlFor={fileId}>LastPass CSV file</label>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void pick(event.target.files?.[0])}
            />
          </div>
        ) : null}
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}

        {stage.name === 'ready' ? (
          <>
            <p className="notice" role="status">
              {stage.fileName}: {stage.parsed.items.length} item(s) ready to import,{' '}
              {
                stage.parsed.notes.filter((note) => note.reason !== 'structured_note_as_text')
                  .length
              }{' '}
              row(s) will be skipped.
            </p>
            <NoteTable caption="Rows that need a mention" notes={stage.parsed.notes} />
            <div className="kit-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={stage.parsed.items.length === 0}
                onClick={() => void run(stage.parsed)}
              >
                Import {stage.parsed.items.length} item(s)
              </button>
              <button className="btn" type="button" onClick={() => setStage({ name: 'pick' })}>
                Choose another file
              </button>
            </div>
          </>
        ) : null}

        {stage.name === 'working' ? (
          <>
            <div className="progress" aria-hidden="true" />
            <p role="status">
              Encrypting {stage.done} of {stage.total}…
            </p>
          </>
        ) : null}

        {stage.name === 'done' ? (
          <>
            <p className="notice" role="status">
              Imported {stage.report.imported} item(s). Skipped {stage.report.skipped.length}{' '}
              row(s).
            </p>
            <NoteTable caption="Skipped rows" notes={stage.report.skipped} />
            <NoteTable caption="Imported with a caveat" notes={stage.report.warnings} />
            <div className="kit-actions">
              <button className="btn" type="button" onClick={() => setStage({ name: 'pick' })}>
                Import another file
              </button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}
