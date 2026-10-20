import { useEffect, useState } from 'react'
import type { MediaRef } from '../../shared/protocol.ts'
import { getSeason, getShow } from './catalog.ts'

type Episodic = Extract<MediaRef, { type: 'tv' }>

export interface NextEpisode {
  media: Episodic
  still?: string
  overview?: string
}

const aired = (date?: string) => !date || date <= new Date().toISOString().slice(0, 10)

/** The episode after this one: the next in the season, or the first of the next season. */
export async function findNextEpisode(media: Episodic, signal?: AbortSignal): Promise<NextEpisode | null> {
  const [show, episodes] = await Promise.all([getShow(media.id, signal), getSeason(media.id, media.season, signal)])
  let season = media.season
  let next = episodes.filter((e) => e.number > media.episode).sort((a, b) => a.number - b.number)[0]
  if (!next && media.season > 0) {
    // Specials (season 0) aren't "next" after a finale.
    const later = show.seasons.filter((s) => s.number > media.season).sort((a, b) => a.number - b.number)[0]
    if (later) {
      season = later.number
      next = (await getSeason(media.id, later.number, signal)).sort((a, b) => a.number - b.number)[0]
    }
  }
  if (!next || !aired(next.airDate)) return null
  return {
    media: { ...media, season, episode: next.number, episodeTitle: next.name || undefined },
    still: next.still,
    overview: next.overview,
  }
}

export function useNextEpisode(media: MediaRef | null): NextEpisode | null {
  const [next, setNext] = useState<NextEpisode | null>(null)
  const key = media?.type === 'tv' ? `${media.id}:${media.season}:${media.episode}` : null

  useEffect(() => {
    setNext(null)
    if (!key || media?.type !== 'tv') return
    const ctrl = new AbortController()
    findNextEpisode(media, ctrl.signal).then(setNext, () => setNext(null))
    return () => ctrl.abort()
    // The episode's identity is the key; the object changes on every room update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return next
}
