import { useEffect, useRef, useState } from 'react'
import type { CardRef, MediaRef } from '../../shared/protocol.ts'
import { getSeason, getShow, type Episode, type ShowDetails } from '../lib/catalog.ts'

type Load<T> = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } | { state: 'done'; data: T }

/** Season tabs and an episode list for a show; picking an episode starts it for the room. */
export function Episodes({
  show: result,
  onPick,
  current,
}: {
  show: CardRef
  onPick: (m: MediaRef) => void
  /** The episode on screen now: its season opens first and it's marked in the list. */
  current?: { season: number; episode: number }
}) {
  const [details, setDetails] = useState<Load<ShowDetails>>({ state: 'loading' })
  const [season, setSeason] = useState<number | null>(null)
  const [episodes, setEpisodes] = useState<Load<Episode[]>>({ state: 'idle' })
  const currentRef = useRef<HTMLButtonElement>(null)
  const scrolled = useRef(false)

  useEffect(() => {
    const ctrl = new AbortController()
    getShow(result.id, ctrl.signal)
      .then((d) => {
        setDetails({ state: 'done', data: d })
        const start = current && d.seasons.some((s) => s.number === current.season) ? current.season : d.seasons[0]?.number
        setSeason(start ?? null)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setDetails({ state: 'error', message: 'Could not load the seasons for this show.' })
      })
    return () => ctrl.abort()
    // Only the show decides the starting season; moving on to another episode shouldn't
    // pull the tabs away from wherever this person is looking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.id])

  useEffect(() => {
    if (season == null) return
    const ctrl = new AbortController()
    setEpisodes({ state: 'loading' })
    getSeason(result.id, season, ctrl.signal)
      .then((data) => setEpisodes({ state: 'done', data }))
      .catch((err) => {
        if (err.name !== 'AbortError') setEpisodes({ state: 'error', message: 'Could not load these episodes.' })
      })
    return () => ctrl.abort()
  }, [result.id, season])

  // Bring the episode on screen into view once, when its list first appears.
  useEffect(() => {
    if (episodes.state !== 'done' || scrolled.current || !currentRef.current) return
    scrolled.current = true
    currentRef.current.scrollIntoView({ block: 'center' })
  }, [episodes])

  if (details.state === 'loading' || details.state === 'idle') return <p className="sheet-hint">Loading seasons…</p>
  if (details.state === 'error') return <p className="sheet-hint">{details.message}</p>
  const show = details.data
  if (show.seasons.length === 0) return <p className="sheet-hint">This show has no episodes listed yet.</p>

  return (
    <>
      <div className="seasons" role="tablist" aria-label="Seasons">
        {show.seasons.map((s) => (
          <button
            key={s.number}
            role="tab"
            aria-selected={s.number === season}
            className="season-tab"
            onClick={() => setSeason(s.number)}
          >
            {s.number === 0 ? 'Specials' : `Season ${s.number}`}
          </button>
        ))}
      </div>
      {episodes.state === 'loading' || episodes.state === 'idle' ? (
        <p className="sheet-hint">Loading episodes…</p>
      ) : episodes.state === 'error' ? (
        <p className="sheet-hint">{episodes.message}</p>
      ) : (
        <ol className="episodes">
          {episodes.data.map((ep) => {
            const isCurrent = current?.season === season && current.episode === ep.number
            return (
              <li key={ep.number}>
                <button
                  ref={isCurrent ? currentRef : undefined}
                  className={`episode${isCurrent ? ' episode-current' : ''}`}
                  aria-current={isCurrent || undefined}
                  onClick={() =>
                    onPick({
                      type: 'tv',
                      id: show.id,
                      title: show.title,
                      season: season!,
                      episode: ep.number,
                      episodeTitle: ep.name,
                      poster: show.poster,
                      backdrop: show.backdrop,
                    })
                  }
                >
                  <span className="episode-still">
                    {ep.still && <img src={ep.still} alt="" loading="lazy" />}
                    {isCurrent && <span className="episode-badge">Now playing</span>}
                  </span>
                  <span className="episode-text">
                    <span className="episode-name">
                      <span className="episode-num">{ep.number}</span> {ep.name}
                    </span>
                    {ep.airDate && <span className="episode-date">{airedOn(ep.airDate)}</span>}
                    {ep.overview && <span className="episode-overview">{ep.overview}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function airedOn(date: string) {
  const d = new Date(`${date}T12:00:00`)
  return Number.isNaN(d.getTime()) ? date : dateFormat.format(d)
}
