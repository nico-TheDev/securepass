import {
  checkBreach,
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
  PASSPHRASE_WORDS,
  PASSWORD_LENGTH,
  type PassphraseOptions,
  type PasswordOptions,
} from '@securepass/vault'
import { type FormEvent, useCallback, useEffect, useId, useState } from 'react'
import { copy } from './background'
import { PasswordField } from './fields'

const SETS = [
  ['upper', 'Capital letters'],
  ['lower', 'Small letters'],
  ['digits', 'Digits'],
  ['symbols', 'Symbols'],
] as const

/** Makes random passwords and passphrases on this device, and checks any password for breaches. */
export function Generator() {
  const [kind, setKind] = useState<'password' | 'passphrase'>('password')
  const [password, setPassword] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const [passphrase, setPassphrase] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS)
  const [output, setOutput] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const sizeId = useId()

  const generate = useCallback(() => {
    const made = kind === 'password' ? generatePassword(password) : generatePassphrase(passphrase)
    setCopied('')
    setOutput(made.ok ? made.value : '')
    setProblem(
      made.ok
        ? null
        : made.error === 'no_character_set'
          ? 'Choose at least one kind of character.'
          : 'That length is outside the allowed range.',
    )
  }, [kind, password, passphrase])

  // A new value appears whenever a choice changes.
  useEffect(() => generate(), [generate])

  const range = kind === 'password' ? PASSWORD_LENGTH : PASSPHRASE_WORDS
  const size = kind === 'password' ? password.length : passphrase.words
  const setSize = (value: number) => {
    const next = Math.min(range.max, Math.max(range.min, Math.round(value) || range.min))
    if (kind === 'password') setPassword((current) => ({ ...current, length: next }))
    else setPassphrase((current) => ({ ...current, words: next }))
  }

  return (
    <>
      <section className="panel" aria-labelledby="generator-title">
        <h2 id="generator-title">Make a new password</h2>
        <fieldset className="segmented">
          <legend className="visually-hidden">What to make</legend>
          {(['password', 'passphrase'] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="generator-kind"
                checked={kind === option}
                onChange={() => setKind(option)}
              />
              {option === 'password' ? 'Random password' : 'Passphrase'}
            </label>
          ))}
        </fieldset>
        <output className="generated" aria-label="Generated value" aria-live="polite">
          {output}
        </output>
        {problem ? (
          <p className="notice notice-error" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="actions">
          <button className="btn btn-primary" type="button" onClick={generate}>
            Make another
          </button>
          <button
            className="btn"
            type="button"
            disabled={output === ''}
            onClick={() =>
              void copy(output).then((done) =>
                setCopied(
                  done ? 'Copied. It will be cleared in 30 seconds.' : 'The copy did not work.',
                ),
              )
            }
          >
            Copy
          </button>
        </div>
        <p className="status" role="status">
          {copied}
        </p>
        <div className="field">
          <label htmlFor={sizeId}>
            {kind === 'password' ? 'Length' : 'Words'}: {size} ({range.min} to {range.max})
          </label>
          <input
            id={sizeId}
            type="range"
            min={range.min}
            max={range.max}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </div>
        {kind === 'password' ? (
          <fieldset className="group">
            <legend>Characters to use</legend>
            {SETS.map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={password[key]}
                  onChange={(event) =>
                    setPassword((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={password.excludeLookalikes}
                onChange={(event) =>
                  setPassword((current) => ({
                    ...current,
                    excludeLookalikes: event.target.checked,
                  }))
                }
              />
              Leave out look alikes (I, l, 1, O, 0)
            </label>
          </fieldset>
        ) : (
          <fieldset className="group">
            <legend>Passphrase options</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={passphrase.capitalize}
                onChange={(event) =>
                  setPassphrase((current) => ({ ...current, capitalize: event.target.checked }))
                }
              />
              Capital first letters
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={passphrase.includeNumber}
                onChange={(event) =>
                  setPassphrase((current) => ({ ...current, includeNumber: event.target.checked }))
                }
              />
              Add a number
            </label>
          </fieldset>
        )}
      </section>
      <BreachCheck />
    </>
  )
}

/** Checks any typed password against known breaches without sending the password. */
function BreachCheck() {
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ readonly bad: boolean; readonly text: string } | null>(
    null,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setChecking(true)
    setResult(null)
    const checked = await checkBreach(password)
    setChecking(false)
    setResult(
      !checked.ok
        ? { bad: true, text: 'The breach check could not be reached. Try again later.' }
        : checked.value === 0
          ? { bad: false, text: 'This password was not found in any known breach.' }
          : {
              bad: true,
              text: `This password appears ${checked.value.toLocaleString()} times in known breaches. Do not use it.`,
            },
    )
  }

  return (
    <section className="panel" aria-labelledby="breach-title">
      <h2 id="breach-title">Check a password for breaches</h2>
      <form className="form" onSubmit={submit}>
        <PasswordField
          label="Password to check"
          value={password}
          onChange={(value) => {
            setPassword(value)
            setResult(null)
          }}
          autoComplete="off"
          hint="Only the first 5 characters of its hash are sent to Have I Been Pwned. The match is done here."
        />
        <button className="btn btn-primary" type="submit" disabled={checking || password === ''}>
          {checking ? 'Checking…' : 'Check'}
        </button>
        <p className={result?.bad ? 'notice notice-error' : result ? 'notice' : ''} role="status">
          {result?.text ?? ''}
        </p>
      </form>
    </section>
  )
}
