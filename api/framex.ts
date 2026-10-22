// Relays PlayPen's catalog requests to frameXTV's API (search, browse lists, seasons,
// servers, subtitles).
//
// In October 2026 frameXTV's API stopped letting other sites read it from the browser: it
// now only allows frameXTV's own domains. Requests made from a server aren't subject to that
// browser rule, so the app asks this function and the function asks frameXTV. It identifies
// itself as PlayPen and doesn't pretend to be frameXTV's site.
//
// Only the endpoints PlayPen uses are relayed, and answers are cached on Vercel's CDN, so a
// list or a season is fetched from frameXTV about once per cache period, not once per viewer.
// No CORS header is sent: only PlayPen's own pages can read the answers from a browser.

const UPSTREAMS = ['https://api.framextv.tech', 'https://api.framextv.xyz']
const TIMEOUT_MS = 8_000
const MAX_BYTES = 5 * 1024 * 1024

// Endpoint (after /api/) and how long Vercel's CDN may serve a cached answer, in seconds.
const ROUTES: Array<[RegExp, number]> = [
  [/^search$/, 60 * 60],
  [/^discover$/, 15 * 60],
  [/^details$/, 24 * 60 * 60],
  [/^tv\/\d+$/, 6 * 60 * 60],
  [/^season$/, 6 * 60 * 60],
  [/^providers$/, 60 * 60],
  [/^subtitles$/, 24 * 60 * 60],
  [/^subtitles\/proxy$/, 24 * 60 * 60],
]
// The subtitle proxy fetches a URL it's given, so it only accepts the host frameXTV's
// subtitle lists point to. Anything else would make this an open proxy.
const SUBTITLE_HOST = /^subs\d*\.strem\.io$/

function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Only GET is supported.')

    const url = new URL(request.url)
    // Called as /api/framex?path=<endpoint>&<frameXTV's own parameters>.
    const endpoint = (url.searchParams.get('path') ?? '').replace(/\/+$/, '')
    const route = ROUTES.find(([pattern]) => pattern.test(endpoint))
    if (!route) return fail(404, 'Unknown catalog endpoint.')

    const query = new URLSearchParams(url.searchParams)
    query.delete('path')
    if (endpoint === 'subtitles/proxy') {
      let target: URL
      try {
        target = new URL(query.get('url') ?? '')
      } catch {
        return fail(400, 'A subtitle URL is required.')
      }
      if (target.protocol !== 'https:' || !SUBTITLE_HOST.test(target.hostname)) {
        return fail(400, 'That subtitle host isn’t allowed.')
      }
    }

    let lastError = 'The catalog is unreachable.'
    for (const base of UPSTREAMS) {
      try {
        const res = await fetch(`${base}/api/${endpoint}?${query}`, {
          headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': 'PlayPen (playpen-omega.vercel.app)' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        // A server error means this host is having trouble; the other one may not be.
        if (res.status >= 500) {
          lastError = `The catalog returned HTTP ${res.status}.`
          continue
        }
        const body = await res.arrayBuffer()
        if (body.byteLength > MAX_BYTES) return fail(502, 'The catalog’s answer was too large.')
        const [, maxAge] = route
        return new Response(request.method === 'HEAD' ? null : body, {
          status: res.status,
          headers: {
            'Content-Type': res.headers.get('content-type') ?? 'application/json',
            // Only successful answers are cached, and a stale one is served while it refreshes.
            'Cache-Control': res.ok
              ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`
              : 'no-store',
          },
        })
      } catch (err) {
        lastError = (err as Error).name === 'TimeoutError' ? 'The catalog took too long to answer.' : 'The catalog is unreachable.'
      }
    }
    return fail(502, lastError)
  },
}
