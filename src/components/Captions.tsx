import { useEffect, useState } from 'react'
import type { FramexBridge } from '../lib/framex.ts'
import { activeCues, type Cue } from '../lib/subtitles.ts'
import type { CaptionSize } from '../lib/useSubtitles.ts'

/**
 * Draws subtitles over the video. The embed only reports its time a few times a second,
 * so this reads the bridge's estimate every frame; React only re-renders when the set of
 * cues on screen actually changes.
 */
export function Captions({
  cues,
  bridge,
  delay,
  size,
  raised,
}: {
  cues: Cue[]
  bridge: FramexBridge
  delay: number
  size: CaptionSize
  /** Lift the captions clear of the control bar when it floats over the picture. */
  raised: boolean
}) {
  const [shown, setShown] = useState<Cue[]>([])

  useEffect(() => {
    let raf = 0
    // Not a possible key, so the first frame always draws (and clears anything left over).
    let key = '-'
    const frame = () => {
      const o = bridge.observe()
      const next = o.hasTime ? activeCues(cues, o.time - delay) : []
      const k = next.map((c) => c.id).join(',')
      if (k !== key) {
        key = k
        setShown(next)
      }
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(raf)
  }, [cues, bridge, delay])

  const top = shown.filter((c) => c.top)
  const bottom = shown.filter((c) => !c.top)

  return (
    <div className={`captions captions-${size}${raised ? ' captions-raised' : ''}`} aria-hidden="true">
      {top.length > 0 && <CueBlock cues={top} where="top" />}
      {bottom.length > 0 && <CueBlock cues={bottom} where="bottom" />}
    </div>
  )
}

function CueBlock({ cues, where }: { cues: Cue[]; where: 'top' | 'bottom' }) {
  return (
    <div className={`caption-block caption-${where}`}>
      {cues.flatMap((cue) =>
        cue.lines.map((line, i) => (
          <span key={`${cue.id}-${i}`} className="caption-line">
            {line.map((s, j) => {
              const node = s.bold ? <b>{s.text}</b> : s.text
              return s.italic ? <i key={j}>{node}</i> : <span key={j}>{node}</span>
            })}
          </span>
        )),
      )}
    </div>
  )
}
