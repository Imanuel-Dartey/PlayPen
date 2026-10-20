// What Browse shows, and the lists behind it.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowseFilters, BrowseState, CardRef } from '../../shared/protocol.ts'
import { discover, searchTitles, type DiscoverQuery, type Page, type SearchResult } from './catalog.ts'

export const DEFAULT_FILTERS: BrowseFilters = {
  type: 'all',
  category: 'trending',
  genre: '',
  year: '',
  minRating: '',
  sort: '',
}

export const emptyBrowse = (): BrowseState => ({ query: '', filters: { ...DEFAULT_FILTERS }, card: null })

export const CATEGORIES: Array<{ id: BrowseFilters['category']; label: string }> = [
  { id: 'trending', label: 'Trending' },
  { id: 'popular', label: 'Popular' },
  { id: 'top_rated', label: 'Top rated' },
  { id: 'new', label: 'New' },
]

// TMDB genre ids, as frameXTV uses them. Films and shows have different lists.
export const GENRES: Record<'movie' | 'tv', Array<{ id: string; label: string }>> = {
  movie: [
    { id: '28', label: 'Action' },
    { id: '12', label: 'Adventure' },
    { id: '16', label: 'Animation' },
    { id: '35', label: 'Comedy' },
    { id: '80', label: 'Crime' },
    { id: '99', label: 'Documentary' },
    { id: '18', label: 'Drama' },
    { id: '10751', label: 'Family' },
    { id: '14', label: 'Fantasy' },
    { id: '36', label: 'History' },
    { id: '27', label: 'Horror' },
    { id: '10402', label: 'Music' },
    { id: '9648', label: 'Mystery' },
    { id: '10749', label: 'Romance' },
    { id: '878', label: 'Science fiction' },
    { id: '53', label: 'Thriller' },
    { id: '10752', label: 'War' },
    { id: '37', label: 'Western' },
  ],
  tv: [
    { id: '10759', label: 'Action & adventure' },
    { id: '16', label: 'Animation' },
    { id: '35', label: 'Comedy' },
    { id: '80', label: 'Crime' },
    { id: '99', label: 'Documentary' },
    { id: '18', label: 'Drama' },
    { id: '10751', label: 'Family' },
    { id: '10762', label: 'Kids' },
    { id: '9648', label: 'Mystery' },
    { id: '10764', label: 'Reality' },
    { id: '10765', label: 'Sci-fi & fantasy' },
    { id: '10768', label: 'War & politics' },
    { id: '37', label: 'Western' },
  ],
}

export const SORTS = [
  { id: 'popularity.desc', label: 'Most popular' },
  { id: 'vote_average.desc', label: 'Highest rated' },
  { id: 'primary_release_date.desc', label: 'Newest' },
  { id: 'primary_release_date.asc', label: 'Oldest' },
]

export const MIN_RATINGS = [
  { id: '8', label: '8+' },
  { id: '7', label: '7+' },
  { id: '6', label: '6+' },
]

export const YEARS = Array.from({ length: 40 }, (_, i) => String(new Date().getFullYear() - i))

export interface Rail {
  id: string
  title: string
  query: DiscoverQuery
  /** Where "See all" takes you. */
  filters: Partial<BrowseFilters>
}

export const HOME_RAILS: Rail[] = [
  { id: 'tm', title: 'Trending films', query: { type: 'movie', category: 'trending' }, filters: { type: 'movie', category: 'trending' } },
  { id: 'tt', title: 'Trending shows', query: { type: 'tv', category: 'trending' }, filters: { type: 'tv', category: 'trending' } },
  { id: 'rm', title: 'Top-rated films', query: { type: 'movie', category: 'top_rated' }, filters: { type: 'movie', category: 'top_rated' } },
  { id: 'rt', title: 'Top-rated shows', query: { type: 'tv', category: 'top_rated' }, filters: { type: 'tv', category: 'top_rated' } },
  { id: 'nm', title: 'New films', query: { type: 'movie', category: 'now_playing' }, filters: { type: 'movie', category: 'new' } },
  { id: 'nt', title: 'On the air', query: { type: 'tv', category: 'on_the_air' }, filters: { type: 'tv', category: 'new' } },
]

/** The home view is the one with no search and no filters. */
export const isHome = (s: BrowseState) => !s.query.trim() && s.filters.type === 'all'

export function toDiscover(f: BrowseFilters): DiscoverQuery {
  const type = f.type === 'all' ? 'movie' : f.type
  const category = f.category === 'new' ? (type === 'movie' ? 'now_playing' : 'on_the_air') : f.category
  return {
    type,
    // A chosen sort or filter means "everything matching", not one of the curated lists.
    category: f.genre || f.year || f.minRating || f.sort ? undefined : category,
    genre: f.genre || undefined,
    year: f.year || undefined,
    minRating: f.minRating || undefined,
    sort: f.sort || undefined,
  }
}

export const toCard = (r: SearchResult): CardRef => ({
  type: r.type,
  id: r.id,
  title: r.title,
  year: r.year,
  poster: r.poster,
  backdrop: r.backdrop,
})

// Lists are kept for the session, so going back and forth between views is instant.
const pageCache = new Map<string, Page<SearchResult>[]>()

type Source = { kind: 'discover'; q: DiscoverQuery } | { kind: 'search'; text: string }

export function usePagedList(source: Source | null) {
  const key = source ? JSON.stringify(source) : ''
  const [pages, setPages] = useState<Page<SearchResult>[]>(() => pageCache.get(key) ?? [])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const ctrl = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (page: number) => {
      if (!source) return
      ctrl.current?.abort()
      const c = new AbortController()
      ctrl.current = c
      setState('loading')
      try {
        const next =
          source.kind === 'search'
            ? await searchTitles(source.text, c.signal, page)
            : await discover({ ...source.q, page }, c.signal)
        setPages((cur) => {
          const all = [...cur.filter((p) => p.page < page), next]
          pageCache.set(key, all)
          return all
        })
        setState('ready')
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setState('error')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  useEffect(() => {
    if (!source) return
    const cached = pageCache.get(key)
    if (cached?.length) {
      setPages(cached)
      setState('ready')
      return
    }
    setPages([])
    // Searching waits for a pause in typing.
    const t = setTimeout(() => void fetchPage(1), source.kind === 'search' ? 300 : 0)
    return () => {
      clearTimeout(t)
      ctrl.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchPage])

  // The same title can turn up on two pages when the list shifts between requests.
  const seen = new Set<string>()
  const items = pages.flatMap((p) => p.items).filter((r) => {
    const k = `${r.type}:${r.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const last = pages[pages.length - 1]
  return {
    items,
    state,
    hasMore: !!last?.hasMore,
    more: () => last && fetchPage(last.page + 1),
    retry: () => fetchPage(last ? last.page + 1 : 1),
  }
}
