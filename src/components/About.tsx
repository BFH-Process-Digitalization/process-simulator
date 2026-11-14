import { useEffect, useState } from 'react'
import { APP_NAME, COPYRIGHT, LICENCE, LICENCE_TEXT, NOTICES, THIRD_PARTY } from '../about'

function AboutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="about-backdrop" onClick={onClose}>
      <div className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="eyebrow">About</div>
          <h2 id="about-title">{APP_NAME}</h2>
          <button className="icon about-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <h3>Licence</h3>
        <p>
          {COPYRIGHT} {LICENCE}
        </p>
        <details>
          <summary>Full licence</summary>
          <pre>{LICENCE_TEXT}</pre>
        </details>
        <h3>Third-party software</h3>
        <p>{THIRD_PARTY}</p>
        <details>
          <summary>Third-party licences ({NOTICES.length} packages)</summary>
          {NOTICES.map((n) => (
            <details key={n.name} className="about-notice">
              <summary>
                {n.name} <span className="mute">· {n.licence}</span>
              </summary>
              <pre>{n.text || n.licence}</pre>
            </details>
          ))}
        </details>
      </div>
    </div>
  )
}

/** Footer bar with the copyright and a link to the About dialog. */
export default function AboutFooter() {
  const [open, setOpen] = useState(false)
  return (
    <footer className="about-bar">
      <span>{COPYRIGHT}</span>
      <button className="link" onClick={() => setOpen(true)}>
        About and licence
      </button>
      {open && <AboutDialog onClose={() => setOpen(false)} />}
    </footer>
  )
}
