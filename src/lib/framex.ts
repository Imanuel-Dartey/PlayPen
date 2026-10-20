// Bridge to the frameXTV embed player over postMessage.
//
// The embed accepts commands (play, pause, seek, ...) but only reports `ready` and
// `timeupdate` back, never play/pause. So "is it playing?" is inferred from whether
// timeupdates keep arriving with the clock moving forward.

import type { MediaRef } from '../../shared/protocol.ts'

// frameXTV moved its player here from framextv.xyz in October 2026; the old address
// redirects. If the player ever goes silent again, check where the embed redirects to.
export const EMBED_ORIGIN = 'https://framextv.cc'

export function embedUrl(media: MediaRef, opts: { start: number; autoplay: boolean; muted?: boolean; provider?: string }) {
  const path =
    media.type === 'tv' ? `/embed/tv/${media.id}/${media.season}/${media.episode}` : `/embed/movie/${media.id}`
  const params = new URLSearchParams({
    autoplay: opts.autoplay ? '1' : '0',
    muted: opts.muted ? '1' : '0',
    controls: '0', // we draw our own controls so every play/pause/seek goes through the room
    t: String(Math.floor(opts.start)),
  })
  if (opts.provider) params.set('provider', opts.provider)
  return `${EMBED_ORIGIN}${path}?${params}`
}

type Command =
  | { action: 'play' | 'pause' | 'mute' | 'unmute' }
  | { action: 'seek'; time: number }
  | { action: 'setVolume'; volume: number }
  | { action: 'setProvider'; provider: string }
  | { action: 'setSpeed'; speed: number }

/** A single timeupdate jump larger than this (beyond what elapsed) is a seek, not playback. */
const SEEK_JUMP = 2.5
/** No forward progress for this long means the video isn't playing (paused or buffering). */
const STALL_MS = 1000

export interface Observed {
  ready: boolean
  hasTime: boolean
  time: number
  duration: number
  playing: boolean
}

export class FramexBridge {
  private frame: HTMLIFrameElement | null = null
  private ready = false
  private time = 0
  private timeAt = 0
  private advanceAt = 0
  private duration = 0
  private lastSeekAt = 0
  /** The playback rate we last asked for; the clock runs this much faster between reports. */
  private rate = 1
  /** Fires when the clock jumps without us having asked for it (someone used the embed's own UI). */
  onExternalSeek: ((time: number) => void) | null = null
  /**
   * Fires with each time report while the video is playing normally. These are the most
   * accurate readings there are (no guessing between reports), so sync is measured on them.
   */
  onSample: ((time: number) => void) | null = null

  /** Start receiving telemetry; returns the matching cleanup. */
  listen() {
    window.addEventListener('message', this.onMessage)
    return () => window.removeEventListener('message', this.onMessage)
  }

  attach(frame: HTMLIFrameElement | null) {
    this.frame = frame
    this.ready = false
    this.time = 0
    this.timeAt = 0
    this.advanceAt = 0
    this.duration = 0
    this.rate = 1
  }

  private onMessage = (e: MessageEvent) => {
    if (e.origin !== EMBED_ORIGIN || !this.frame || e.source !== this.frame.contentWindow) return
    const data = e.data as { event?: string; currentTime?: number; duration?: number }
    if (data?.event === 'frameXTV:ready') this.ready = true
    if (data?.event !== 'frameXTV:timeupdate' || typeof data.currentTime !== 'number') return

    this.ready = true
    const now = performance.now()
    const t = data.currentTime
    if (typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration > 0) {
      this.duration = data.duration
    }
    if (this.timeAt > 0) {
      const expected = this.time + (this.isAdvancing(now) ? ((now - this.timeAt) / 1000) * this.rate : 0)
      const delta = t - this.time
      if (Math.abs(t - expected) > SEEK_JUMP) {
        if (now - this.lastSeekAt > 2500) this.onExternalSeek?.(t)
      } else if (delta > 0 && delta < 2) {
        // Only steady forward progress counts as a sample: not the first report after a
        // stall, a seek, or a reload.
        if (this.isAdvancing(now)) this.onSample?.(t)
        this.advanceAt = now
      }
    }
    this.time = t
    this.timeAt = now
  }

  private isAdvancing(now: number) {
    return this.advanceAt > 0 && now - this.advanceAt < STALL_MS
  }

  observe(): Observed {
    const now = performance.now()
    const playing = this.isAdvancing(now)
    return {
      ready: this.ready,
      hasTime: this.timeAt > 0,
      time: this.time + (playing ? ((now - this.timeAt) / 1000) * this.rate : 0),
      duration: this.duration,
      playing,
    }
  }

  private post(cmd: Command) {
    this.frame?.contentWindow?.postMessage(cmd, EMBED_ORIGIN)
  }

  play() {
    this.post({ action: 'play' })
  }
  pause() {
    this.post({ action: 'pause' })
    this.advanceAt = 0
  }
  seek(time: number) {
    this.lastSeekAt = performance.now()
    this.post({ action: 'seek', time: Math.max(0, time) })
    this.time = Math.max(0, time)
    this.timeAt = performance.now()
    this.advanceAt = 0
  }
  setVolume(volume: number) {
    this.post({ action: 'setVolume', volume })
    this.post({ action: volume === 0 ? 'mute' : 'unmute' })
  }
  /** Plays slightly faster or slower to close a small gap without a visible jump. */
  setRate(rate: number) {
    if (rate === this.rate) return
    // Fold the time so far in at the old rate, so the estimate doesn't jump.
    const now = performance.now()
    if (this.isAdvancing(now)) {
      this.time += ((now - this.timeAt) / 1000) * this.rate
      this.timeAt = now
    }
    this.rate = rate
    this.post({ action: 'setSpeed', speed: rate })
  }
  get playbackRate() {
    return this.rate
  }
  setProvider(provider: string) {
    this.post({ action: 'setProvider', provider })
  }
}
