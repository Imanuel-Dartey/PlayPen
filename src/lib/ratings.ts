// IMDb, Rotten Tomatoes and Metacritic scores from OMDb (https://www.omdbapi.com), a free
// API with a key and 1,000 lookups a day. Without a key, cards show only TMDB's score.
//
// Ratings change slowly, so each title is looked up at most once a week per device, a
// few at a time, and only once its card is on screen.

import { useEffect, useState } from 'react'
import { cardKey, type CardRef } from '../../shared/protocol.ts'

const KEY = import.meta.env.VITE_OMDB_API_KEY as string | undefined
export const ratingsEnabled = !!KEY

export interface Ratings {
  imdb?: number
  /** Rotten Tomatoes Tomatometer, 0–100. */
  rt?: number
  /** Metascore, 0–100. */
  mc?: number
  imdbId?: string
}

const CACHE_KEY = 'playpen:ratings:v1'
const BUDGET_KEY = 'playpen:omdbBudget'
const FOUND_TTL = 7 * 86_400_000
const MISSING_TTL = 2 * 86_400_000
// Stay well inside the free 1,000 a day, leaving room for the other person's device.
const DAILY_BUDGET = 800
const CONCURRENCY = 3

type Entry = { r: Ratings | null; at: number }
let cache: Record<string, Entry> | null = null

function readCache(): Record<string, Entry> {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Entry>
  } catch {
    cache = {}
  }
  const now = Date.now()
  for (const [k, e] of Object.entries(cache)) {
    if (now - e.at > (e.r ? FOUND_TTL : MISSING_TTL)) delete cache[k]
  }
  return cache
}

let saveTimer: number | undefined
function remember(key: string, r: Ratings | null) {
  readCache()[key] = { r, at: Date.now() }
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      /* full: they'll be looked up again next time */
    }
  }, 500)
}

/** Takes one lookup from today's allowance; false once it's used up. */
function spend(): boolean {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const b = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? '{}') as { day?: string; used?: number }
    const used = b.day === today ? (b.used ?? 0) : 0
    if (used >= DAILY_BUDGET) return false
    localStorage.setItem(BUDGET_KEY, JSON.stringify({ day: today, used: used + 1 }))
  } catch {
    /* can't count without storage; carry on */
  }
  return true
}

interface OmdbResponse {
  Response: 'True' | 'False'
  Error?: string
  imdbRating?: string
  imdbID?: string
  Metascore?: string
  Ratings?: Array<{ Source: string; Value: string }>
}

async function omdb(params: Record<string, string>): Promise<OmdbResponse | null> {
  if (!spend()) return null
  const res = await fetch(`https://www.omdbapi.com/?${new URLSearchParams({ apikey: KEY!, ...params })}`)
  if (res.status === 401) return null
  return (await res.json()) as OmdbResponse
}

function parse(d: OmdbResponse): Ratings | null {
  const num = (v?: string) => (v && v !== 'N/A' && Number.isFinite(parseFloat(v)) ? parseFloat(v) : undefined)
  const rtValue = d.Ratings?.find((x) => x.Source === 'Rotten Tomatoes')?.Value
  const r: Ratings = { imdb: num(d.imdbRating), rt: num(rtValue), mc: num(d.Metascore), imdbId: d.imdbID }
  return r.imdb ?? r.rt ?? r.mc ? r : null
}

async function lookup(card: CardRef): Promise<Ratings | null | undefined> {
  const type = card.type === 'tv' ? 'series' : 'movie'
  // Years can differ by one between TMDB and IMDb, so fall back to the title alone.
  let d = await omdb({ t: card.title, type, ...(card.year ? { y: card.year } : {}) })
  if (d && d.Response === 'False' && card.year) d = await omdb({ t: card.title, type })
  if (!d) return undefined // out of budget or no key: try again another day
  return d.Response === 'True' ? parse(d) : null
}

// ---- a small shared queue, so many cards on screen don't fire everything at once ----

const waiting: CardRef[] = []
const inFlight = new Map<string, Promise<void>>()
const listeners = new Map<string, Set<(r: Ratings | null) => void>>()
let running = 0

function pump() {
  while (running < CONCURRENCY && waiting.length) {
    const card = waiting.shift()!
    const key = cardKey(card)
    running++
    const p = lookup(card)
      .then((r) => {
        if (r === undefined) return
        remember(key, r)
        for (const fn of listeners.get(key) ?? []) fn(r)
      })
      .catch(() => {})
      .finally(() => {
        running--
        inFlight.delete(key)
        pump()
      })
    inFlight.set(key, p)
  }
}

function request(card: CardRef) {
  const key = cardKey(card)
  if (key in readCache() || inFlight.has(key) || waiting.some((c) => cardKey(c) === key)) return
  waiting.push(card)
  pump()
}

/**
 * Ratings for a card: from the cache straight away, otherwise fetched once `wanted` is
 * true (the card is on screen). `undefined` while unknown, `null` when OMDb has none.
 */
export function useRatings(card: CardRef, wanted: boolean): Ratings | null | undefined {
  const key = cardKey(card)
  const [r, setR] = useState<Ratings | null | undefined>(() => (ratingsEnabled ? readCache()[key]?.r : undefined))

  useEffect(() => {
    if (!ratingsEnabled) return
    const cached = readCache()[key]
    if (cached) {
      setR(cached.r)
      return
    }
    setR(undefined)
    let set = listeners.get(key)
    if (!set) listeners.set(key, (set = new Set()))
    set.add(setR)
    if (wanted) request(card)
    return () => {
      set!.delete(setR)
    }
    // card is identified by key; its other fields don't change what's looked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, wanted])

  return r
}
