import { useEffect, useRef, useState } from 'react'
import type { ChatMedia } from '../../shared/protocol.ts'
import { findGifs, type Gif } from '../lib/klipy.ts'
import { Icon } from './Icon.tsx'

export function GifPicker({
  customerId,
  onPick,
  onClose,
}: {
  customerId: string
  onPick: (m: ChatMedia) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState<Gif[]>([])
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading')
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node
      if (rootRef.current && !rootRef.current.contains(el) && !(el as HTMLElement).closest?.('[data-gif-toggle]')) onClose()
    }
    addEventListener('keydown', onKey, true)
    addEventListener('pointerdown', onDown)
    return () => {
      removeEventListener('keydown', onKey, true)
      removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(
      async () => {
        setState('loading')
        try {
          const res = await findGifs(query, { customerId, page, signal: ctrl.signal })
          setGifs((cur) => (page === 1 ? res.gifs : [...cur, ...res.gifs]))
          setHasNext(res.hasNext)
          setState('done')
        } catch (err) {
          if ((err as Error).name !== 'AbortError') setState('error')
        }
      },
      page === 1 ? 300 : 0,
    )
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query, page, customerId])

  return (
    <div className="gif-picker" ref={rootRef} role="dialog" aria-label="Choose a GIF">
      <label className="gif-search">
        <Icon name="search" size={16} />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder="Search GIFs"
          aria-label="Search GIFs"
          autoFocus
        />
      </label>
      <div className="gif-grid">
        {gifs.map((g) => (
          <button key={g.id} className="gif-cell" onClick={() => onPick(g.media)} title={g.title}>
            <img
              src={g.preview.url}
              alt={g.title}
              loading="lazy"
              style={{ aspectRatio: `${g.preview.width} / ${g.preview.height}` }}
            />
          </button>
        ))}
        {state === 'done' && gifs.length === 0 && <p className="gif-note">No GIFs for “{query.trim()}”.</p>}
        {state === 'error' && <p className="gif-note">GIF search isn’t responding. Try again in a moment.</p>}
      </div>
      <div className="gif-foot">
        {hasNext && state === 'done' && (
          <button className="link-btn" onClick={() => setPage((p) => p + 1)}>
            Show more
          </button>
        )}
        {state === 'loading' && <span className="gif-note">Loading…</span>}
        <span className="gif-credit">Powered by KLIPY</span>
      </div>
    </div>
  )
}
