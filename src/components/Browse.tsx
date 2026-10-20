import { useEffect, useRef, useState } from 'react'
import {
  cardKey,
  type BrowseFilters,
  type BrowseState,
  type CardRef,
  type MediaRef,
  type ShortlistItem,
} from '../../shared/protocol.ts'
import { getDetails, type SearchResult, type TitleDetails } from '../lib/catalog.ts'
import {
  CATEGORIES,
  DEFAULT_FILTERS,
  GENRES,
  HOME_RAILS,
  MIN_RATINGS,
  SORTS,
  YEARS,
  isHome,
  toCard,
  toDiscover,
  usePagedList,
  type Rail as RailDef,
} from '../lib/browseData.ts'
import { ratingsEnabled, useRatings, type Ratings } from '../lib/ratings.ts'
import type { PeerBrowse } from '../lib/useBrowsePresence.ts'
import { Episodes } from './Episodes.tsx'
import { Icon } from './Icon.tsx'

interface Props {
  state: BrowseState
  onChange: (s: BrowseState) => void
  onClose: () => void
  onWatch: (m: MediaRef) => void
  peers: PeerBrowse[]
  colorFor: (device: string) => string
  shortlist: ShortlistItem[]
  onShortlistAdd: (c: CardRef) => void
  onShortlistRemove: (key: string) => void
}

export function Browse(p: Props) {
  const { state, onChange } = p
  const setFilters = (f: Partial<BrowseFilters>) => onChange({ ...state, filters: { ...state.filters, ...f } })
  const open = (card: CardRef | null) => onChange({ ...state, card })
  const shortlisted = new Set(p.shortlist.map((i) => i.key))
  // Which partner (if any) has each card open, for the ring in their color.
  const watchers = new Map<string, PeerBrowse>()
  for (const peer of p.peers) if (peer.state.card) watchers.set(cardKey(peer.state.card), peer)

  const cardProps = { onOpen: open, shortlisted, watchers, colorFor: p.colorFor }

  return (
    <section className="browse" aria-label="Browse films and shows">
      <header className="browse-head">
        <label className="search browse-search">
          <Icon name="search" size={18} />
          <input
            className="search-input"
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder="Search films and shows"
            aria-label="Search films and shows"
          />
          {state.query && (
            <button className="icon-btn" onClick={() => onChange({ ...state, query: '' })} aria-label="Clear search">
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        <div className="segmented browse-type" role="radiogroup" aria-label="Show">
          {(
            [
              ['all', 'Everything'],
              ['movie', 'Films'],
              ['tv', 'Shows'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="radio"
              aria-checked={!state.query && state.filters.type === id}
              className="segment"
              // Genres differ between films and shows, so switching type starts that filter over.
              onClick={() => onChange({ ...state, query: '', filters: { ...state.filters, type: id, genre: '' } })}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Close browse">
          <Icon name="close" />
        </button>
      </header>

      <PartnerStrip peers={p.peers} colorFor={p.colorFor} onJump={(peer) => onChange(structuredClone(peer.state))} />

      <ShortlistStrip
        items={p.shortlist}
        colorFor={p.colorFor}
        onOpen={(i) => open({ type: i.type, id: i.id, title: i.title, year: i.year, poster: i.poster })}
      />

      {!state.query && state.filters.type !== 'all' && (
        <Filters filters={state.filters} onChange={setFilters} onReset={() => setFilters({ ...DEFAULT_FILTERS, type: state.filters.type })} />
      )}

      <div className="browse-body">
        {state.query.trim() ? (
          <Grid source={{ kind: 'search', text: state.query.trim() }} empty={`Nothing matches “${state.query.trim()}”. Try the original title, or fewer words.`} {...cardProps} />
        ) : isHome(state) ? (
          HOME_RAILS.map((rail, i) => (
            <Rail
              key={rail.id}
              rail={rail}
              reverse={i % 2 === 1}
              onSeeAll={() => setFilters({ ...DEFAULT_FILTERS, ...rail.filters })}
              {...cardProps}
            />
          ))
        ) : (
          <Grid
            source={{ kind: 'discover', q: toDiscover(state.filters) }}
            empty="Nothing matches all of these filters. Try loosening one."
            {...cardProps}
          />
        )}
      </div>

      {state.card && (
        <TitleDetail
          card={state.card}
          onClose={() => open(null)}
          onWatch={p.onWatch}
          shortlisted={shortlisted.has(cardKey(state.card))}
          onToggleShortlist={() =>
            shortlisted.has(cardKey(state.card!)) ? p.onShortlistRemove(cardKey(state.card!)) : p.onShortlistAdd(state.card!)
          }
          alsoHere={p.peers.filter((peer) => peer.state.card && cardKey(peer.state.card) === cardKey(state.card!))}
          colorFor={p.colorFor}
        />
      )}
    </section>
  )
}

// ---------- partner presence ----------

function describeView(s: BrowseState): string {
  if (s.card) return `looking at ${s.card.title}`
  if (s.query.trim()) return `searching for “${s.query.trim()}”`
  if (s.filters.type === 'all') return 'browsing everything'
  const what = s.filters.type === 'movie' ? 'films' : 'shows'
  const genre = GENRES[s.filters.type].find((g) => g.id === s.filters.genre)?.label
  return `browsing ${genre ? `${genre.toLowerCase()} ` : ''}${what}`
}

function PartnerStrip({
  peers,
  colorFor,
  onJump,
}: {
  peers: PeerBrowse[]
  colorFor: (d: string) => string
  onJump: (p: PeerBrowse) => void
}) {
  if (peers.length === 0) return null
  return (
    <ul className="partner-strip" aria-label="What the others are looking at">
      {peers.map((peer) => (
        <li key={peer.device} className="partner" style={{ '--c': colorFor(peer.device) } as React.CSSProperties}>
          <span className="partner-dot" aria-hidden="true" />
          <span className="partner-text">
            <strong>{peer.name}</strong> is {describeView(peer.state)}
          </span>
          <button className="btn btn-quiet partner-jump" onClick={() => onJump(peer)}>
            Jump there
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------- shortlist ----------

function ShortlistStrip({
  items,
  colorFor,
  onOpen,
}: {
  items: ShortlistItem[]
  colorFor: (d: string) => string
  onOpen: (i: ShortlistItem) => void
}) {
  return (
    <div className="shortlist">
      <span className="shortlist-label">
        Shortlist{items.length > 0 && <span className="shortlist-count">{items.length}</span>}
      </span>
      {items.length === 0 ? (
        <span className="shortlist-empty">Save titles with the heart to decide on together.</span>
      ) : (
        <ol className="shortlist-items">
          {items
            .slice()
            .reverse()
            .map((i) => (
              <li key={i.key}>
                <button
                  className="shortlist-item"
                  onClick={() => onOpen(i)}
                  title={`${i.title}, added by ${i.byName}`}
                  style={{ '--c': colorFor(i.by) } as React.CSSProperties}
                >
                  <span className="shortlist-thumb">{i.poster ? <img src={i.poster} alt="" loading="lazy" /> : i.title[0]}</span>
                  <span className="shortlist-title">{i.title}</span>
                </button>
              </li>
            ))}
        </ol>
      )}
    </div>
  )
}

// ---------- filters ----------

function Filters({
  filters,
  onChange,
  onReset,
}: {
  filters: BrowseFilters
  onChange: (f: Partial<BrowseFilters>) => void
  onReset: () => void
}) {
  const type = filters.type === 'all' ? 'movie' : filters.type
  const refined = !!(filters.genre || filters.year || filters.minRating || filters.sort)
  return (
    <div className="filters">
      <div className="chips" role="radiogroup" aria-label="List">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="radio"
            className="chip"
            aria-checked={!refined && filters.category === c.id}
            onClick={() => onChange({ category: c.id, genre: '', year: '', minRating: '', sort: '' })}
          >
            {c.id === 'new' ? (type === 'movie' ? 'In cinemas' : 'On the air') : c.label}
          </button>
        ))}
      </div>
      <div className="selects">
        <Select label="Genre" value={filters.genre} onChange={(genre) => onChange({ genre })} any="Any genre" options={GENRES[type]} />
        <Select label="Year" value={filters.year} onChange={(year) => onChange({ year })} any="Any year" options={YEARS.map((y) => ({ id: y, label: y }))} />
        <Select label="Rating" value={filters.minRating} onChange={(minRating) => onChange({ minRating })} any="Any rating" options={MIN_RATINGS} />
        <Select label="Sort" value={filters.sort} onChange={(sort) => onChange({ sort })} any="Default order" options={SORTS} />
        {refined && (
          <button className="link-btn" onClick={onReset}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

function Select(p: {
  label: string
  value: string
  any: string
  options: Array<{ id: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <label className={`select${p.value ? ' select-on' : ''}`}>
      <span className="visually-hidden">{p.label}</span>
      <select value={p.value} onChange={(e) => p.onChange(e.target.value)}>
        <option value="">{p.any}</option>
        {p.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------- lists ----------

interface CardListProps {
  onOpen: (c: CardRef) => void
  shortlisted: Set<string>
  watchers: Map<string, PeerBrowse>
  colorFor: (d: string) => string
}

function Rail({ rail, reverse, onSeeAll, ...cardProps }: { rail: RailDef; reverse: boolean; onSeeAll: () => void } & CardListProps) {
  const list = usePagedList({ kind: 'discover', q: rail.query })
  const items = list.items.slice(0, 20)
  return (
    <section className="rail" aria-label={rail.title}>
      <header className="rail-head">
        <h3 className="rail-title">{rail.title}</h3>
        <button className="link-btn" onClick={onSeeAll}>
          See all
        </button>
      </header>
      {items.length === 0 ? (
        <div className="rail-placeholder">{list.state === 'error' ? 'This list didn’t load.' : ''}</div>
      ) : (
        // The track holds the list twice; sliding it by half its width loops seamlessly.
        <div className="rail-window">
          <div
            className={`rail-track${reverse ? ' rail-reverse' : ''}`}
            style={{ '--rail-duration': `${items.length * 5}s` } as React.CSSProperties}
          >
            {[0, 1].map((copy) =>
              items.map((r) => <Card key={`${copy}-${r.type}-${r.id}`} r={r} clone={copy === 1} {...cardProps} />),
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Grid({
  source,
  empty,
  ...cardProps
}: { source: Parameters<typeof usePagedList>[0]; empty: string } & CardListProps) {
  const list = usePagedList(source)
  return (
    <div className="grid-wrap">
      {list.items.length > 0 && (
        <ul className="card-grid">
          {list.items.map((r) => (
            <li key={`${r.type}-${r.id}`}>
              <Card r={r} {...cardProps} />
            </li>
          ))}
        </ul>
      )}
      <div className="grid-foot">
        {list.state === 'loading' && <p className="sheet-hint">Loading…</p>}
        {list.state === 'error' && (
          <p className="sheet-hint">
            The catalog isn’t responding.{' '}
            <button className="link-btn" onClick={list.retry}>
              Try again
            </button>
          </p>
        )}
        {list.state === 'ready' && list.items.length === 0 && <p className="sheet-hint">{empty}</p>}
        {list.state === 'ready' && list.hasMore && (
          <button className="btn" onClick={list.more}>
            Show more
          </button>
        )}
      </div>
    </div>
  )
}

// ---------- card ----------

function Card({
  r,
  clone,
  onOpen,
  shortlisted,
  watchers,
  colorFor,
}: { r: SearchResult; clone?: boolean } & CardListProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [onScreen, setOnScreen] = useState(false)
  const card = toCard(r)
  const key = cardKey(card)
  const ratings = useRatings(card, onScreen && !clone)
  const watcher = watchers.get(key)

  useEffect(() => {
    const el = ref.current
    if (!el || onScreen) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setOnScreen(true), {
      rootMargin: '200px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [onScreen])

  return (
    <button
      ref={ref}
      className={`card${watcher ? ' card-watched' : ''}`}
      onClick={() => onOpen(card)}
      // The second copy in a rotating rail is only there to make the loop seamless.
      tabIndex={clone ? -1 : undefined}
      aria-hidden={clone || undefined}
      style={watcher ? ({ '--peer': colorFor(watcher.device) } as React.CSSProperties) : undefined}
    >
      <span className="card-lift">
        <span className="card-wiggle">
          <span className="card-poster">
            {r.poster ? <img src={r.poster} alt="" loading="lazy" draggable={false} /> : <span className="card-initial">{r.title[0]}</span>}
            {shortlisted.has(key) && (
              <span className="card-saved" aria-label="On the shortlist">
                <Icon name="heart" size={14} />
              </span>
            )}
            {watcher && <span className="card-peer">{watcher.name}</span>}
          </span>
        </span>
      </span>
      <span className="card-title">{r.title}</span>
      <span className="card-meta">
        {r.type === 'tv' ? 'Series' : 'Film'}
        {r.year ? `, ${r.year}` : ''}
      </span>
      <RatingBadges tmdb={r.tmdb} r={ratings} compact />
    </button>
  )
}

function RatingBadges({ tmdb, r, compact }: { tmdb?: number; r: Ratings | null | undefined; compact?: boolean }) {
  const badges: Array<{ k: string; label: string; value: string; title: string }> = []
  if (r?.imdb != null) badges.push({ k: 'imdb', label: 'IMDb', value: r.imdb.toFixed(1), title: `IMDb ${r.imdb} out of 10` })
  if (r?.rt != null) badges.push({ k: 'rt', label: 'RT', value: `${r.rt}%`, title: `Rotten Tomatoes ${r.rt}%` })
  if (!compact && r?.mc != null) badges.push({ k: 'mc', label: 'Metacritic', value: String(r.mc), title: `Metascore ${r.mc} out of 100` })
  // TMDB's own score is always available; on cards it's the fallback when there's nothing else.
  if (tmdb != null && (!compact || badges.length === 0))
    badges.push({ k: 'tmdb', label: 'TMDB', value: tmdb.toFixed(1), title: `TMDB ${tmdb.toFixed(1)} out of 10` })
  if (badges.length === 0) return compact ? <span className="ratings ratings-empty" /> : null
  return (
    <span className={`ratings${compact ? ' ratings-compact' : ''}`}>
      {badges.slice(0, compact ? 2 : 4).map((b) => (
        <span key={b.k} className={`rating rating-${b.k}`} title={b.title}>
          <span className="rating-src">{b.label}</span> {b.value}
        </span>
      ))}
    </span>
  )
}

// ---------- detail ----------

function TitleDetail({
  card,
  onClose,
  onWatch,
  shortlisted,
  onToggleShortlist,
  alsoHere,
  colorFor,
}: {
  card: CardRef
  onClose: () => void
  onWatch: (m: MediaRef) => void
  shortlisted: boolean
  onToggleShortlist: () => void
  alsoHere: PeerBrowse[]
  colorFor: (d: string) => string
}) {
  const [details, setDetails] = useState<TitleDetails | null>(null)
  const [failed, setFailed] = useState(false)
  const ratings = useRatings(card, true)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setDetails(null)
    setFailed(false)
    const ctrl = new AbortController()
    getDetails(card.type, card.id, ctrl.signal).then(setDetails, (err) => err.name !== 'AbortError' && setFailed(true))
    return () => ctrl.abort()
  }, [card.type, card.id])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])

  const meta = [
    card.type === 'tv' ? 'Series' : 'Film',
    card.year,
    details?.runtime ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : null,
    details?.seasons ? `${details.seasons} season${details.seasons === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  return (
    <div className="detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <article className="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="detail-hero">
          {card.backdrop && <img src={card.backdrop} alt="" />}
          <button ref={closeRef} className="icon-btn detail-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="detail-body">
          <h2 className="detail-title" id="detail-title">
            {card.title}
          </h2>
          <p className="detail-meta">{meta.join(', ')}</p>
          {details?.genres.length ? <p className="detail-genres">{details.genres.join(', ')}</p> : null}
          <RatingBadges tmdb={details?.tmdb} r={ratings} />
          {!ratingsEnabled && details && (
            <p className="detail-note">Add an OMDb key to see IMDb and Rotten Tomatoes scores here too.</p>
          )}

          {alsoHere.length > 0 && (
            <p className="detail-together">
              {alsoHere.map((p) => (
                <span key={p.device} className="detail-peer" style={{ '--c': colorFor(p.device) } as React.CSSProperties}>
                  {p.name}
                </span>
              ))}{' '}
              {alsoHere.length === 1 ? 'is' : 'are'} looking at this too.
            </p>
          )}

          <div className="detail-actions">
            {card.type === 'movie' && (
              <button
                className="btn btn-primary"
                onClick={() =>
                  onWatch({ type: 'movie', id: card.id, title: card.title, poster: card.poster, backdrop: card.backdrop })
                }
              >
                <Icon name="play" size={18} />
                Watch together
              </button>
            )}
            <button className="btn" onClick={onToggleShortlist} aria-pressed={shortlisted}>
              <Icon name={shortlisted ? 'heart' : 'heartOutline'} size={18} />
              {shortlisted ? 'On the shortlist' : 'Add to shortlist'}
            </button>
          </div>

          {details?.tagline && <p className="detail-tagline">{details.tagline}</p>}
          {details?.overview && <p className="detail-overview">{details.overview}</p>}
          {details?.cast.length ? <p className="detail-cast">With {details.cast.join(', ')}</p> : null}
          {failed && <p className="detail-note">Couldn’t load more about this title.</p>}

          {card.type === 'tv' && (
            <section className="detail-episodes" aria-label="Episodes">
              <h3 className="rail-title">Pick an episode to watch together</h3>
              <Episodes show={card} onPick={onWatch} />
            </section>
          )}
        </div>
      </article>
    </div>
  )
}
