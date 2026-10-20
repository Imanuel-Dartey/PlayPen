import { useRef, useState, type ReactNode } from 'react'
import type { Provider } from '../lib/catalog.ts'
import { formatTime, personColor } from '../lib/format.ts'
import { Icon } from './Icon.tsx'

export interface Playhead {
  id: string
  name: string
  hue: number
  position: number | null
  isYou: boolean
}

interface Props {
  playing: boolean
  position: number
  duration: number
  playheads: Playhead[]
  onToggle: () => void
  onSeek: (position: number) => void
  onSeekBy: (delta: number) => void
  volume: number
  onVolume: (v: number) => void
  fullscreen: boolean
  onFullscreen: () => void
  onNext?: () => void
  /** Opens the list of episodes, for shows. */
  onEpisodes?: () => void
  episodesOpen?: boolean
  providers: Provider[]
  provider: string
  onProvider: (id: string) => void
  /** The subtitle control, which owns its own menu. */
  subtitles?: ReactNode
  /** How far apart your screen and the other person's are, in seconds, while both play. */
  apart?: number | null
}

export function TogetherBar(p: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const known = p.duration > 0
  const shown = scrub ?? p.position

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * p.duration
  }

  const pct = (t: number) => `${known ? Math.max(0, Math.min(100, (t / p.duration) * 100)) : 0}%`

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!known) return
    const step = e.shiftKey ? 30 : 10
    if (e.key === 'ArrowRight') p.onSeekBy(step)
    else if (e.key === 'ArrowLeft') p.onSeekBy(-step)
    else if (e.key === 'Home') p.onSeek(0)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="bar">
      <div
        ref={trackRef}
        className="track"
        role="slider"
        tabIndex={0}
        aria-label="Seek, for both of you"
        aria-valuemin={0}
        aria-valuemax={Math.round(p.duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(p.duration)}`}
        aria-disabled={!known}
        data-disabled={!known || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (!known) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setScrub(timeAt(e.clientX))
        }}
        onPointerMove={(e) => {
          if (!known) return
          const t = timeAt(e.clientX)
          setHover(t)
          if (scrub != null) setScrub(t)
        }}
        onPointerUp={(e) => {
          if (scrub == null) return
          p.onSeek(timeAt(e.clientX))
          setScrub(null)
        }}
        onPointerCancel={() => setScrub(null)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="track-rail">
          <div className="track-fill" style={{ width: pct(shown) }} />
        </div>
        {known &&
          p.playheads.map(
            (h) =>
              h.position != null && (
                <span
                  key={h.id}
                  className={`playhead${h.isYou ? ' playhead-you' : ''}`}
                  style={{
                    left: h.isYou ? pct(shown) : pct(h.position),
                    background: personColor(h.hue),
                  }}
                  title={h.isYou ? 'You' : `${h.name}, ${formatTime(h.position)}`}
                />
              ),
          )}
        {hover != null && known && (
          <span className="track-tip" style={{ left: pct(hover) }}>
            {formatTime(hover)}
          </span>
        )}
      </div>

      <div className="bar-row">
        <button
          className="icon-btn icon-btn-lg"
          onClick={p.onToggle}
          aria-label={p.playing ? 'Pause for both of you' : 'Play for both of you'}
        >
          <Icon name={p.playing ? 'pause' : 'play'} size={24} />
        </button>
        {p.onNext && (
          <button className="icon-btn" onClick={p.onNext} aria-label="Next episode" title="Next episode">
            <Icon name="next" />
          </button>
        )}
        {p.onEpisodes && (
          <button
            className="icon-btn"
            onClick={p.onEpisodes}
            aria-pressed={p.episodesOpen}
            aria-label="Episodes"
            title="Episodes (E)"
          >
            <Icon name="episodes" />
          </button>
        )}
        <span className="bar-time">
          {formatTime(shown)}
          <span className="bar-time-total"> / {known ? formatTime(p.duration) : '--:--'}</span>
        </span>
        {p.apart != null && (
          <span
            className={`bar-apart${p.apart > 0.25 ? ' bar-apart-far' : ''}`}
            title="How far apart your screen and theirs are right now"
          >
            {p.apart < 1 ? `${Math.max(1, Math.round(p.apart * 1000))} ms apart` : `${p.apart.toFixed(1)} s apart`}
          </span>
        )}

        <span className="bar-spacer" />

        <div className="volume">
          <button
            className="icon-btn"
            onClick={() => p.onVolume(p.volume === 0 ? 1 : 0)}
            aria-label={p.volume === 0 ? 'Unmute' : 'Mute'}
          >
            <Icon name={p.volume === 0 ? 'muted' : 'volume'} />
          </button>
          <input
            className="volume-range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))}
            aria-label="Your volume"
            style={{ '--fill': `${p.volume * 100}%` } as React.CSSProperties}
          />
        </div>

        {p.providers.length > 0 && (
          <label className="server" title="Changes the stream source for both of you">
            <span className="visually-hidden">Stream server, for both of you</span>
            <select value={p.provider} onChange={(e) => p.onProvider(e.target.value)}>
              <option value="">Auto server</option>
              {p.providers.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {p.subtitles}
        <button
          className="icon-btn"
          onClick={p.onFullscreen}
          aria-label={p.fullscreen ? 'Exit full screen' : 'Full screen'}
        >
          <Icon name={p.fullscreen ? 'shrink' : 'expand'} />
        </button>
      </div>
    </div>
  )
}
