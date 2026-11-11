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
import { copySecret } from '../ui/clipboard'
import { PasswordField } from '../ui/text-field'

type Kind = 'password' | 'passphrase'

const SETS = [
  ['upper', 'Capital letters (A to Z)'],
  ['lower', 'Small letters (a to z)'],
  ['digits', 'Digits (0 to 9)'],
  ['symbols', 'Symbols (!@#$…)'],
] as const

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min

/** Makes random passwords and passphrases on this device, and checks any password for breaches. */
export function GeneratorScreen() {
  const [kind, setKind] = useState<Kind>('password')
  const [password, setPassword] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS)
  const [passphrase, setPassphrase] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS)
  const [output, setOutput] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const lengthId = useId()
  const wordsId = useId()
  const separatorId = useId()

  const generate = useCallback(() => {
    const made = kind === 'password' ? generatePassword(password) : generatePassphrase(passphrase)
    setCopied(false)
    if (made.ok) {
      setOutput(made.value)
      setProblem(null)
    } else {
      setOutput('')
      setProblem(
        made.error === 'no_character_set'
          ? 'Choose at least one kind of character.'
          : 'That length is outside the allowed range.',
      )
    }
  }, [kind, password, passphrase])

  // A new value appears whenever a choice changes.
  useEffect(() => generate(), [generate])

  return (
    <div className="page">
      <h1>Generator</h1>
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
        <div className="kit-actions">
          <button className="btn btn-primary" type="button" onClick={generate}>
            Make another
          </button>
          <button
            className="btn"
            type="button"
            disabled={output === ''}
            onClick={() => void copySecret(output).then(setCopied)}
          >
            Copy
          </button>
          <span className="status" role="status">
            {copied ? 'Copied. It will be cleared in 30 seconds if this tab stays open.' : ''}
          </span>
        </div>

        {kind === 'password' ? (
          <div className="form">
            <div className="field">
              <label htmlFor={lengthId}>
                Length: {password.length} characters ({PASSWORD_LENGTH.min} to {PASSWORD_LENGTH.max}
                )
              </label>
              <input
                id={lengthId}
                type="range"
                min={PASSWORD_LENGTH.min}
                max={PASSWORD_LENGTH.max}
                value={password.length}
                onChange={(event) =>
                  setPassword((current) => ({
                    ...current,
                    length: clamp(
                      Number(event.target.value),
                      PASSWORD_LENGTH.min,
                      PASSWORD_LENGTH.max,
                    ),
                  }))
                }
              />
            </div>
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
          </div>
        ) : (
          <div className="form">
            <div className="field">
              <label htmlFor={wordsId}>
                Words: {passphrase.words} ({PASSPHRASE_WORDS.min} to {PASSPHRASE_WORDS.max})
              </label>
              <input
                id={wordsId}
                type="range"
                min={PASSPHRASE_WORDS.min}
                max={PASSPHRASE_WORDS.max}
                value={passphrase.words}
                onChange={(event) =>
                  setPassphrase((current) => ({
                    ...current,
                    words: clamp(
                      Number(event.target.value),
                      PASSPHRASE_WORDS.min,
                      PASSPHRASE_WORDS.max,
                    ),
                  }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor={separatorId}>Separator</label>
              <input
                id={separatorId}
                value={passphrase.separator}
                maxLength={3}
                onChange={(event) =>
                  setPassphrase((current) => ({ ...current, separator: event.target.value }))
                }
              />
            </div>
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
          </div>
        )}
        <p className="field-hint">
          Made on this device with the browser's cryptographic random source. Passphrase words come
          from the EFF large wordlist of 7776 words.
        </p>
      </section>
      <BreachCheckPanel />
    </div>
  )
}

/** Checks any typed password against known breaches without sending the password. */
function BreachCheckPanel() {
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
          hint="A hash of the password is made here. Only its first 5 characters are sent to Have I Been Pwned, and the match is done on this device."
        />
        <div className="kit-actions">
          <button className="btn btn-primary" type="submit" disabled={checking || password === ''}>
            {checking ? 'Checking…' : 'Check'}
          </button>
        </div>
        <p className={result?.bad ? 'notice notice-error' : result ? 'notice' : ''} role="status">
          {result?.text ?? ''}
        </p>
      </form>
    </section>
  )
}
