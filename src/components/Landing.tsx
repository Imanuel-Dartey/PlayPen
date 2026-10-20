import { useState } from 'react'
import { ROOM_CODE_PATTERN } from '../../shared/protocol.ts'
import { newRoomCode, readName, saveName } from '../lib/format.ts'

export function Landing({ onEnter }: { onEnter: (code: string) => void }) {
  const [name, setName] = useState(readName)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const trimmed = name.trim()

  const start = () => {
    if (!trimmed) return
    saveName(trimmed)
    onEnter(newRoomCode())
  }

  const join = (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed) return
    // Accept a pasted invite link as well as a bare code.
    const raw = code.trim().toLowerCase()
    const fromLink = raw.match(/\/r\/([a-z0-9-]+)/)?.[1]
    const c = fromLink ?? raw
    if (!ROOM_CODE_PATTERN.test(c)) {
      setCodeError('Room codes look like moon-k3x9pq. Paste the link or the code you were sent.')
      return
    }
    saveName(trimmed)
    onEnter(c)
  }

  return (
    <main className="landing">
      <div className="landing-mark" aria-hidden="true">
        <span className="orb orb-you" />
        <span className="orb orb-them" />
      </div>
      <h1 className="landing-title">PlayPen</h1>
      <p className="landing-lede">The same film, the same second, wherever you both are.</p>

      <div className="landing-form">
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
            placeholder="What should they see?"
            maxLength={40}
            autoComplete="nickname"
            autoFocus={!name}
          />
        </label>

        <button className="btn btn-primary btn-wide" onClick={start} disabled={!trimmed}>
          Start a room
        </button>

        <form className="join" onSubmit={join}>
          <label className="field">
            <span className="field-label">Got a link or code?</span>
            <div className="join-row">
              <input
                className="input"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setCodeError(null)
                }}
                placeholder="moon-k3x9pq"
                aria-invalid={!!codeError}
                aria-describedby={codeError ? 'code-error' : undefined}
              />
              <button className="btn" type="submit" disabled={!trimmed || !code.trim()}>
                Join
              </button>
            </div>
          </label>
          {codeError && (
            <p className="field-error" id="code-error">
              {codeError}
            </p>
          )}
        </form>
      </div>
    </main>
  )
}

export function NamePrompt({ code, onReady }: { code: string; onReady: (name: string) => void }) {
  const [name, setName] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n) return
    saveName(n)
    onReady(n)
  }
  return (
    <main className="landing">
      <div className="landing-mark" aria-hidden="true">
        <span className="orb orb-you" />
        <span className="orb orb-them" />
      </div>
      <h1 className="landing-title landing-title-small">You're invited to {code}</h1>
      <form className="landing-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should they see?"
            maxLength={40}
            autoFocus
          />
        </label>
        <button className="btn btn-primary btn-wide" type="submit" disabled={!name.trim()}>
          Join the room
        </button>
      </form>
    </main>
  )
}
