import { useEffect, useRef, useState } from 'react'
import type { CaptionSize, SubtitlesApi } from '../lib/useSubtitles.ts'
import { Icon } from './Icon.tsx'

const SIZES: Array<{ id: CaptionSize; label: string }> = [
  { id: 's', label: 'Small' },
  { id: 'm', label: 'Medium' },
  { id: 'l', label: 'Large' },
]

/** Whether the subtitles were made for the cut of the episode this server is playing. */
export type CutCheck =
  | { state: 'ok' }
  | { state: 'mismatch'; subtitles: number; stream: number }
  | { state: 'searching'; trying: string }
  | { state: 'none'; subtitles: number; stream: number }

export function SubtitleMenu({ subs, cut, onFindServer }: { subs: SubtitlesApi; cut: CutCheck; onFindServer: () => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const on = subs.selection.kind !== 'off'

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey, true)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const current =
    subs.selection.kind === 'track'
      ? subs.options.find((o) => o.track.url === (subs.selection as { url: string }).url)?.name
      : subs.selection.kind === 'file'
        ? subs.selection.name
        : null

  return (
    <div className="subs" ref={rootRef}>
      <button
        className={`icon-btn cc-btn${on ? ' cc-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={on ? `Subtitles: ${current ?? 'on'}` : 'Subtitles: off'}
        title="Subtitles (C)"
      >
        <Icon name="cc" size={22} />
      </button>

      {open && (
        <div className="subs-menu" role="dialog" aria-label="Subtitles">
          <div className="subs-head">
            <span className="subs-title">Subtitles</span>
            <span className="subs-note">Only changes your screen</span>
          </div>

          <div className="subs-list" role="radiogroup" aria-label="Subtitle language">
            <label className="subs-option">
              <input type="radio" name="subs" checked={!on} onChange={() => subs.select(null)} />
              Off
            </label>
            {subs.options.map((o) => (
              <label key={o.track.url} className="subs-option">
                <input
                  type="radio"
                  name="subs"
                  checked={subs.selection.kind === 'track' && subs.selection.url === o.track.url}
                  onChange={() => subs.select(o.track.url)}
                />
                {o.name}
              </label>
            ))}
            {subs.selection.kind === 'file' && (
              <label className="subs-option">
                <input type="radio" name="subs" checked readOnly />
                {subs.selection.name}
              </label>
            )}
            {subs.listState === 'loading' && <p className="subs-msg">Finding subtitles…</p>}
            {subs.listState === 'error' && <p className="subs-msg">Couldn’t get the subtitle list. You can still use a file.</p>}
            {subs.listState === 'ready' && subs.options.length === 0 && (
              <p className="subs-msg">No subtitles listed for this one. You can use a file instead.</p>
            )}
          </div>

          <button className="link-btn subs-file" onClick={() => fileRef.current?.click()}>
            Use a subtitle file (.srt, .vtt)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void subs.loadFile(f)
              e.target.value = ''
            }}
          />

          {on && cut.state !== 'ok' && <CutNote cut={cut} onFindServer={onFindServer} />}

          {subs.loading && <p className="subs-msg">Loading subtitles…</p>}
          {subs.error && <p className="subs-msg subs-error">{subs.error}</p>}

          <div className="subs-row">
            <span className="subs-label">Size</span>
            <div className="segmented" role="radiogroup" aria-label="Subtitle size">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={subs.size === s.id}
                  className="segment"
                  onClick={() => subs.setSize(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {on && (
            <div className="subs-row">
              <span className="subs-label" id="subs-timing">
                Timing
              </span>
              <div className="timing" role="group" aria-labelledby="subs-timing">
                <button className="segment" onClick={() => subs.nudge(-0.5)}>
                  Earlier
                </button>
                <span className="timing-value" aria-live="polite">
                  {subs.delay === 0 ? '0.0s' : `${subs.delay > 0 ? '+' : '−'}${Math.abs(subs.delay).toFixed(1)}s`}
                </span>
                <button className="segment" onClick={() => subs.nudge(0.5)}>
                  Later
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function CutNote({
  cut,
  onFindServer,
  onHide,
}: {
  cut: CutCheck
  onFindServer: () => void
  /** Offers a way to put the note away, when it's shown over the picture. */
  onHide?: () => void
}) {
  const hide = onHide && (
    <button className="btn btn-small btn-quiet" onClick={onHide}>
      Not now
    </button>
  )
  if (cut.state === 'ok') return null
  if (cut.state === 'searching') {
    return (
      <p className="subs-msg subs-cut" role="status">
        Looking for a server with the matching version{cut.trying ? `… trying ${cut.trying}` : '…'}
      </p>
    )
  }
  const minutes = (s: number) => `${Math.max(1, Math.round(s / 60))}-minute`
  const versions = `These subtitles are timed for a ${minutes(cut.subtitles)} version, but this server is playing a ${minutes(cut.stream)} one`
  return (
    <div className="subs-msg subs-cut" role="status">
      {cut.state === 'mismatch' ? (
        <>
          <p>{versions}, so the timing will drift and moving it won’t fix it.</p>
          <span className="subs-cut-actions">
            <button className="btn btn-small" onClick={onFindServer}>
              Find a server that matches
            </button>
            {hide}
          </span>
        </>
      ) : (
        <>
          <p>{versions}. No other server has a version that matches; pick another subtitle version or use a file.</p>
          {hide}
        </>
      )}
    </div>
  )
}
