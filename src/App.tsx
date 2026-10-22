import { useEffect, useState } from 'react'
import { ROOM_CODE_PATTERN } from '../shared/protocol.ts'
import { Landing, NamePrompt } from './components/Landing.tsx'
import { Room } from './components/Room.tsx'
import { readName } from './lib/format.ts'

function roomFromPath(): string | null {
  const code = location.pathname.match(/^\/r\/([^/]+)\/?$/)?.[1]?.toLowerCase()
  return code && ROOM_CODE_PATTERN.test(code) ? code : null
}

export function App() {
  const [code, setCode] = useState(roomFromPath)
  // Entering from the landing page counts as the click browsers want before playing sound,
  // so the name step is only shown to people arriving straight from an invite link.
  const [name, setName] = useState<string | null>(() => (code ? null : readName() || null))

  useEffect(() => {
    const onPop = () => setCode(roomFromPath())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const enter = (c: string) => {
    history.pushState(null, '', `/r/${c}`)
    setName(readName())
    setCode(c)
  }

  const leave = () => {
    history.pushState(null, '', '/')
    setCode(null)
  }

  if (!code) return <Landing onEnter={enter} />
  if (!name) return <NamePromptOrRemembered code={code} onReady={setName} />
  return <Room key={code} code={code} name={name} onLeave={leave} />
}

function NamePromptOrRemembered({ code, onReady }: { code: string; onReady: (n: string) => void }) {
  const remembered = readName()
  if (!remembered) return <NamePrompt code={code} onReady={onReady} />
  return <RejoinPrompt code={code} name={remembered} onReady={onReady} />
}

function RejoinPrompt({ code, name, onReady }: { code: string; name: string; onReady: (n: string) => void }) {
  return (
    <main className="landing">
      <div className="landing-mark" aria-hidden="true">
        <span className="orb orb-you" />
        <span className="orb orb-them" />
      </div>
      <h1 className="landing-title landing-title-small">Welcome back, {name}</h1>
      <div className="landing-form">
        <button className="btn btn-primary btn-wide" autoFocus onClick={() => onReady(name)}>
          Join {code}
        </button>
      </div>
    </main>
  )
}
