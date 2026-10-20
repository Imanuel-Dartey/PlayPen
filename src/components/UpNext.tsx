import type { NextEpisode } from '../lib/useNextEpisode.ts'
import { Icon } from './Icon.tsx'

/**
 * The card for the next episode. During the closing seconds it's an offer; once the episode
 * has ended it counts down and starts the next one for both of you.
 */
export function UpNext({
  next,
  secondsLeft,
  onPlay,
  onCancel,
  onDismiss,
}: {
  next: NextEpisode
  /** Seconds until it starts on its own; null when nothing is counting down. */
  secondsLeft: number | null
  onPlay: () => void
  /** Stops the countdown for both of you. */
  onCancel?: () => void
  /** Hides the card on this screen. */
  onDismiss?: () => void
}) {
  const m = next.media
  return (
    <aside className="up-next" aria-label="Up next">
      <span className="up-next-still">
        {next.still && <img src={next.still} alt="" />}
        {secondsLeft != null && (
          <span className="up-next-count">
            {secondsLeft}
            <span className="visually-hidden"> seconds</span>
          </span>
        )}
      </span>
      <span className="up-next-text">
        <span className="up-next-label">{secondsLeft != null ? 'Next episode' : 'Up next'}</span>
        <span className="up-next-title">
          S{m.season} E{m.episode}
          {m.episodeTitle ? `: ${m.episodeTitle}` : ''}
        </span>
        <span className="up-next-actions">
          <button className="btn btn-primary btn-small" onClick={onPlay}>
            <Icon name="play" size={14} />
            Play now
          </button>
          {onCancel && (
            <button className="btn btn-small" onClick={onCancel}>
              Cancel
            </button>
          )}
        </span>
      </span>
      {onDismiss && (
        <button className="icon-btn up-next-close" onClick={onDismiss} aria-label="Hide">
          <Icon name="close" size={16} />
        </button>
      )}
    </aside>
  )
}
