/** The product name with a small lock mark. */
export function Brand() {
  return (
    <span className="brand">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor" />
        <path
          d="M8 10V7.5a4 4 0 0 1 8 0V10"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      securepass
    </span>
  )
}
