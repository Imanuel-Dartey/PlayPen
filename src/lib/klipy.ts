// GIF search from KLIPY (https://docs.klipy.com). Needs a free app key in VITE_KLIPY_APP_KEY;
// without one the GIF button is simply not shown.

import type { ChatMedia } from '../../shared/protocol.ts'

const KEY = import.meta.env.VITE_KLIPY_APP_KEY as string | undefined
export const gifsEnabled = !!KEY

export interface Gif {
  id: string
  title: string
  /** Small rendition for the picker grid. */
  preview: { url: string; width: number; height: number }
  /** What gets sent. */
  media: ChatMedia
}

type Rendition = { url: string; width: number; height: number }
type Size = Partial<Record<'gif' | 'webp' | 'mp4' | 'jpg' | 'webm', Rendition>>
interface Item {
  id: number | string
  title?: string
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', Size>>
}

export async function findGifs(
  query: string,
  opts: { page?: number; customerId: string; signal?: AbortSignal },
): Promise<{ gifs: Gif[]; hasNext: boolean }> {
  const q = query.trim()
  const params = new URLSearchParams({
    page: String(opts.page ?? 1),
    per_page: '24',
    customer_id: opts.customerId,
    locale: navigator.language || 'en',
  })
  if (q) params.set('q', q)
  const res = await fetch(
    `https://api.klipy.com/api/v1/${encodeURIComponent(KEY!)}/gifs/${q ? 'search' : 'trending'}?${params}`,
    { signal: opts.signal },
  )
  const json = (await res.json().catch(() => null)) as {
    result?: boolean
    data?: { data?: Item[]; has_next?: boolean }
  } | null
  if (!res.ok || !json?.result) throw new Error('GIF search is not responding right now.')

  const gifs: Gif[] = []
  for (const item of json.data?.data ?? []) {
    const sm = item.file?.sm ?? item.file?.xs
    const md = item.file?.md ?? item.file?.hd ?? sm
    const preview = sm?.webp ?? sm?.gif
    const main = md?.webp ?? md?.gif
    if (!preview || !main) continue
    gifs.push({
      id: String(item.id),
      title: item.title ?? 'GIF',
      preview,
      media: { url: main.url, width: main.width, height: main.height, mp4: md?.mp4?.url },
    })
  }
  return { gifs, hasNext: !!json.data?.has_next }
}
