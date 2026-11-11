import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A QR code drawn as inline SVG, so it needs no image source and no inline style (the page's
 * content security policy allows neither). The text never leaves the page.
 */
export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const count = qr.getModuleCount()
    const parts: string[] = []
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        if (qr.isDark(row, column)) parts.push(`M${column} ${row}h1v1h-1z`)
      }
    }
    return { size: count, path: parts.join('') }
  }, [text])

  const quiet = 4
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`${-quiet} ${-quiet} ${size + quiet * 2} ${size + quiet * 2}`}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={size + quiet * 2} height={size + quiet * 2} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
