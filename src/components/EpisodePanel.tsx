import { useEffect, useRef } from 'react'
import type { MediaRef } from '../../shared/protocol.ts'
import { Episodes } from './Episodes.tsx'
import { Icon } from './Icon.tsx'

type Episodic = Extract<MediaRef, { type: 'tv' }>

/** The show's episodes, over the side of the picture, so you can switch without leaving. */
export function EpisodePanel({
  media,
  onPick,
  onClose,
}: {
  media: Episodic
  onPick: (m: MediaRef) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <section ref={ref} className="ep-panel" tabIndex={-1} aria-label={`${media.title} episodes`}>
      <header className="ep-panel-head">
        <div>
          <h2 className="ep-panel-title">Episodes</h2>
          <p className="ep-panel-show">{media.title}. Picking one starts it for both of you.</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close episodes">
          <Icon name="close" />
        </button>
      </header>
      <div className="ep-panel-body">
        <Episodes
          show={{ type: 'tv', id: media.id, title: media.title, poster: media.poster, backdrop: media.backdrop }}
          current={{ season: media.season, episode: media.episode }}
          onPick={onPick}
        />
      </div>
    </section>
  )
}
