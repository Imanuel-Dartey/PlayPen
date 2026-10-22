// Title search and metadata from the frameXTV backend (CORS-open, TMDB-backed).

const API_BASES = ['https://api.framextv.tech', 'https://api.framextv.xyz']
let activeBase = 0

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < API_BASES.length; attempt++) {
    const base = API_BASES[(activeBase + attempt) % API_BASES.length]
    try {
      const res = await fetch(`${base}${path}`, { signal })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`The catalog returned HTTP ${res.status}.`)
      activeBase = (activeBase + attempt) % API_BASES.length
      return (await res.json()) as T
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The catalog is unreachable.')
}

const NO_IMAGE = 'placeholder.com'
const image = (url?: string) => (url && !url.includes(NO_IMAGE) ? url : undefined)

export interface SearchResult {
  id: string
  type: 'movie' | 'tv'
  title: string
  year?: string
  poster?: string
  backdrop?: string
  overview?: string
  /** TMDB's audience score out of 10, from frameXTV's listing. */
  tmdb?: number
}

export interface Page<T> {
  items: T[]
  page: number
  hasMore: boolean
}

type RawResult = Record<string, string>

function toResult(r: RawResult): SearchResult {
  const rating = Number(r.rating)
  return {
    id: String(r.id),
    type: r.type as 'movie' | 'tv',
    title: r.title,
    year: r.year || undefined,
    poster: image(r.poster || r.image),
    backdrop: image(r.backdrop),
    overview: r.overview,
    // 0 means nobody has rated it yet, which isn't the same as a bad score.
    tmdb: Number.isFinite(rating) && rating > 0 ? rating : undefined,
  }
}

const isWatchable = (r: { type?: string }) => r.type === 'movie' || r.type === 'tv'

export async function searchTitles(query: string, signal?: AbortSignal, page = 1): Promise<Page<SearchResult>> {
  const data = await get<{ results?: RawResult[]; totalPages?: number }>(
    `/api/search?q=${encodeURIComponent(query)}&type=all&page=${page}`,
    signal,
  )
  return {
    items: (data.results ?? []).filter(isWatchable).map(toResult),
    page,
    hasMore: page < (data.totalPages ?? 1),
  }
}

export interface DiscoverQuery {
  type: 'movie' | 'tv'
  /** frameXTV's lists: trending, popular, top_rated, now_playing (films), on_the_air (shows). */
  category?: string
  genre?: string
  year?: string
  minRating?: string
  sort?: string
  page?: number
}

export async function discover(q: DiscoverQuery, signal?: AbortSignal): Promise<Page<SearchResult>> {
  const page = q.page ?? 1
  const params = new URLSearchParams({ type: q.type, page: String(page) })
  if (q.category) params.set('category', q.category)
  if (q.genre) params.set('genre', q.genre)
  if (q.year) params.set('year', q.year)
  if (q.minRating) params.set('min_rating', q.minRating)
  if (q.sort) params.set('sort', q.sort)
  const data = await get<{ results?: RawResult[]; totalPages?: number }>(`/api/discover?${params}`, signal)
  return {
    // Trust the type we asked for when an item doesn't state its own.
    items: (data.results ?? []).map((r) => toResult({ ...r, type: r.type || q.type })).filter(isWatchable),
    page,
    hasMore: page < Math.min(data.totalPages ?? 1, 500),
  }
}

export interface TitleDetails {
  overview?: string
  genres: string[]
  runtime?: number
  seasons?: number
  tagline?: string
  cast: string[]
  tmdb?: number
}

export async function getDetails(type: 'movie' | 'tv', id: string, signal?: AbortSignal): Promise<TitleDetails> {
  const d = await get<{
    overview?: string
    genres?: string[]
    runtime?: number
    number_of_seasons?: number
    tagline?: string
    cast?: Array<{ name?: string }>
    rating?: string | number
  }>(`/api/details?id=${encodeURIComponent(id)}&type=${type}`, signal)
  return {
    overview: d.overview,
    genres: d.genres ?? [],
    runtime: d.runtime || undefined,
    seasons: d.number_of_seasons || undefined,
    tagline: d.tagline || undefined,
    cast: (d.cast ?? []).map((c) => c.name ?? '').filter(Boolean).slice(0, 6),
    tmdb: Number(d.rating) > 0 ? Number(d.rating) : undefined,
  }
}

export interface SeasonSummary {
  number: number
  name: string
  episodeCount: number
}

export interface ShowDetails {
  id: string
  title: string
  poster?: string
  backdrop?: string
  seasons: SeasonSummary[]
}

// Seasons and episode lists don't change while you watch, and the episode panel, the next
// button and "Up next" all ask for the same ones: keep them for the session.
const showCache = new Map<string, Promise<unknown>>()

function cached<T>(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let p = showCache.get(key) as Promise<T> | undefined
  if (!p) {
    p = load()
    showCache.set(key, p)
    p.catch(() => showCache.delete(key))
  }
  if (!signal) return p
  // A caller giving up shouldn't cancel the shared request for everyone else.
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    p.then(resolve, reject)
  })
}

export function getShow(id: string, signal?: AbortSignal): Promise<ShowDetails> {
  return cached(`show:${id}`, () => fetchShow(id), signal)
}

async function fetchShow(id: string): Promise<ShowDetails> {
  const d = await get<{
    title: string
    poster?: string
    backdrop?: string
    seasons?: Array<{ season_number: number; name: string; episode_count: number }>
  }>(`/api/tv/${encodeURIComponent(id)}`)
  const seasons = (d.seasons ?? [])
    .map((s) => ({ number: s.season_number, name: s.name, episodeCount: s.episode_count }))
    .filter((s) => s.episodeCount > 0)
  // Specials go last; most people want season 1 first.
  seasons.sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number))
  return { id, title: d.title, poster: image(d.poster), backdrop: image(d.backdrop), seasons }
}

export interface Episode {
  number: number
  name: string
  overview?: string
  still?: string
  airDate?: string
}

export function getSeason(id: string, season: number, signal?: AbortSignal): Promise<Episode[]> {
  return cached(`season:${id}:${season}`, () => fetchSeason(id, season), signal)
}

async function fetchSeason(id: string, season: number): Promise<Episode[]> {
  const d = await get<{
    episodes?: Array<{ episode_number: number; name: string; overview?: string; still?: string; air_date?: string }>
  }>(`/api/season?id=${encodeURIComponent(id)}&season=${season}`)
  return (d.episodes ?? []).map((e) => ({
    number: e.episode_number,
    name: e.name,
    overview: e.overview,
    still: image(e.still),
    airDate: e.air_date,
  }))
}

export interface Provider {
  id: string
  name: string
  tagline?: string
}

export async function getProviders(): Promise<Provider[]> {
  const d = await get<{ providers?: Array<Provider & { status?: string }> }>('/api/providers')
  return (d.providers ?? []).filter((p) => p.status !== 'unavailable')
}

export interface SubtitleTrack {
  url: string
  /** BCP 47-ish code from the source, e.g. "en", "pt-br". */
  lang: string
  label: string
  isDefault: boolean
}

export async function getSubtitleTracks(
  media: { type: 'movie' | 'tv'; id: string; season?: number; episode?: number },
  signal?: AbortSignal,
): Promise<SubtitleTrack[]> {
  let path = `/api/subtitles?id=${encodeURIComponent(media.id)}&type=${media.type}`
  if (media.type === 'tv') path += `&season=${media.season}&episode=${media.episode}`
  const d = await get<{ subtitles?: Array<{ url: string; lang?: string; language?: string; label?: string; isDefault?: boolean }> }>(
    path,
    signal,
  )
  return (d.subtitles ?? [])
    .filter((s) => typeof s.url === 'string' && /^https?:\/\//.test(s.url))
    .map((s) => ({
      url: s.url,
      lang: (s.lang || s.language || 'und').toLowerCase(),
      label: s.label ?? '',
      isDefault: !!s.isDefault,
    }))
}

/** Subtitle files usually allow any site to read them; frameXTV's proxy covers the ones that don't. */
export async function fetchSubtitleFile(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  try {
    const res = await fetch(url, { signal })
    if (res.ok) return await res.arrayBuffer()
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
  }
  const res = await fetch(`${API_BASES[activeBase]}/api/subtitles/proxy?url=${encodeURIComponent(url)}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.arrayBuffer()
}
