// Finds a stream server whose copy of a title has the length we want.
//
// Servers don't all carry the same cut: for The Office, the automatic choice is a 32-minute
// extended version while most others have the 21-minute broadcast one that every subtitle
// file is timed to. Nothing in the API says which is which, so each candidate is loaded
// muted, out of sight, just long enough for it to report its length.

import type { MediaRef } from '../../shared/protocol.ts'
import type { Provider } from './catalog.ts'
import { EMBED_ORIGIN, embedUrl } from './framex.ts'

// Most servers start within 10 seconds; one that hasn't by now is down for this title.
const PROBE_TIMEOUT_MS = 25_000
// Loading every server at once would compete with the real stream for bandwidth.
const AT_ONCE = 3

/** Loads one server's stream and resolves with its length in seconds, or null. */
function measure(media: MediaRef, provider: string, host: HTMLElement, signal: AbortSignal): Promise<number | null> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.className = 'probe'
    frame.tabIndex = -1
    frame.setAttribute('aria-hidden', 'true')
    // Same restrictions as the real player: the embed's ads can't open or redirect anything.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    frame.allow = 'autoplay'
    frame.referrerPolicy = 'origin'
    frame.src = embedUrl(media, { start: 0, autoplay: true, muted: true, provider })

    const done = (duration: number | null) => {
      clearTimeout(timer)
      removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
      frame.remove()
      resolve(duration)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== EMBED_ORIGIN || e.source !== frame.contentWindow) return
      const d = (e.data as { event?: string; duration?: number })?.duration
      if ((e.data as { event?: string })?.event === 'frameXTV:timeupdate' && typeof d === 'number' && d > 0 && Number.isFinite(d)) {
        done(d)
      }
    }
    const onAbort = () => done(null)
    const timer = window.setTimeout(() => done(null), PROBE_TIMEOUT_MS)
    addEventListener('message', onMessage)
    signal.addEventListener('abort', onAbort)
    host.appendChild(frame)
  })
}

export interface ProbeResult {
  provider: Provider
  duration: number
}

/**
 * Tries the candidates (a few at a time, in order) and returns the first whose length
 * passes `fits`, or null when none does.
 */
export async function findServer(opts: {
  media: MediaRef
  candidates: Provider[]
  fits: (duration: number) => boolean
  host: HTMLElement
  signal: AbortSignal
  onTry?: (provider: Provider) => void
}): Promise<ProbeResult | null> {
  const queue = [...opts.candidates]
  const inner = new AbortController()
  const stop = () => inner.abort()
  opts.signal.addEventListener('abort', stop)
  let found: ProbeResult | null = null

  const worker = async () => {
    while (!found && !inner.signal.aborted) {
      const provider = queue.shift()
      if (!provider) return
      opts.onTry?.(provider)
      const duration = await measure(opts.media, provider.id, opts.host, inner.signal)
      if (duration != null && opts.fits(duration) && !found) {
        found = { provider, duration }
        inner.abort() // the others can stop loading
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
  } finally {
    opts.signal.removeEventListener('abort', stop)
    inner.abort()
  }
  return opts.signal.aborted ? null : found
}
