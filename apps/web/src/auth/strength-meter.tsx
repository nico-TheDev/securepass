import type { Strength } from './strength'

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const

/** Four bars plus a word, so the score is never shown by color alone. Updates politely for screen readers. */
export function StrengthMeter({
  strength,
  empty,
}: {
  readonly strength: Strength
  readonly empty: boolean
}) {
  if (empty) return null
  return (
    <div className="meter" data-score={strength.score}>
      <div className="meter-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} data-on={strength.score >= step} />
        ))}
      </div>
      <p className="field-hint" aria-live="polite">
        Strength: {LABELS[strength.score]}.{strength.warning ? ` ${strength.warning}` : ''}
      </p>
    </div>
  )
}
