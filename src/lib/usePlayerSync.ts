import { useEffect, useState } from 'react'
import { livePosition, type MemberStatus } from '../../shared/protocol.ts'
import type { FramexBridge, Observed } from './framex.ts'
import type { RoomApi } from './useRoom.ts'

// Two ways back to the room clock. A big gap is closed by seeking (a visible jump). A small
// one is closed by playing a few percent faster or slower until it's gone, which nobody
// notices (browsers keep the pitch the same).
const SEEK_PLAYING = 1
const DRIFT_PAUSED = 0.15
// Start nudging once the gap passes NUDGE_START, keep going until it's under NUDGE_STOP.
// The gap between the two stops it flip-flopping around the target.
const NUDGE_START = 0.08
const NUDGE_STOP = 0.03
// Speed change per second of gap, and its limits: 0.3s behind plays at 1.045×.
const NUDGE_GAIN = 0.15
const NUDGE_MIN = 0.02
const NUDGE_MAX = 0.06
// Gaps are measured on the player's own time reports (about four a second), taking the
// median of a short window so one late report can't trigger a correction.
const SAMPLE_WINDOW_MS = 1500
const MIN_SAMPLES = 4
// Aim slightly ahead when seeking a playing video, since the seek itself takes time to
// buffer. How long depends on the connection, so this is only the starting guess: each seek
// is checked afterwards and the next one aims accordingly.
const SEEK_LEAD_START = 0.3
const SEEK_LEAD_MAX = 2
// Leave the player alone this long after a seek, so it can buffer before being judged.
const SEEK_SETTLE_MS = 4000
// While a playing video sits stalled this long, the browser has probably blocked autoplay.
const BLOCKED_HINT_MS = 8000

export interface SyncView extends Observed {
  /** Where the room says we should be right now. */
  expected: number
  status: MemberStatus
  maybeBlocked: boolean
  /** Our measured gap from the room clock in seconds (+ is ahead); null until measured. */
  drift: number | null
  /** The playback rate currently in use to close a gap (1 when there's none). */
  rate: number
}

const EMPTY: SyncView = {
  ready: false,
  hasTime: false,
  time: 0,
  duration: 0,
  playing: false,
  expected: 0,
  status: 'loading',
  maybeBlocked: false,
  drift: null,
  rate: 1,
}

/**
 * Keeps one embed in line with the room's shared playback state.
 *
 * Rather than relaying individual events, it repeatedly compares what the player is
 * doing with what the room says should be happening and nudges it back. That covers
 * late joiners, reloads, the embed silently switching servers, and dropped messages
 * with the same code path.
 */
export function usePlayerSync(
  bridge: FramexBridge,
  api: RoomApi,
  mediaKey: string | null,
  /** Clicks are going straight to the embed, so it may change state on its own. */
  unlocked: boolean,
): SyncView {
  const [view, setView] = useState<SyncView>(EMPTY)

  useEffect(() => {
    if (!mediaKey) {
      setView(EMPTY)
      return
    }
    const last = { play: 0, pause: 0, seek: 0, report: 0, endedFor: '' }
    let stalledSince = 0
    let playingSince = 0
    let samples: Array<{ drift: number; at: number }> = []
    let anchor = -1
    let nudging = false
    let seekLead = SEEK_LEAD_START
    let checkLeadAfterSeek = false

    const resetRate = () => {
      nudging = false
      bridge.setRate(1)
    }

    bridge.onSample = (t) => {
      const pb = api.playbackRef.current
      if (!pb?.playing) return
      samples.push({ drift: t - livePosition(pb, api.serverNow()), at: performance.now() })
    }

    const measuredDrift = (now: number): number | null => {
      samples = samples.filter((x) => now - x.at < SAMPLE_WINDOW_MS)
      if (samples.length < MIN_SAMPLES) return null
      const sorted = samples.map((x) => x.drift).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }

    bridge.onExternalSeek = (t) => {
      // Only trust jumps we couldn't have caused, and ignore the embed resetting to 0
      // when it switches servers.
      if (unlocked && t > 2) {
        last.seek = performance.now()
        api.seek(t)
      }
    }

    const tick = () => {
      const pb = api.playbackRef.current
      if (!pb) return
      const now = performance.now()
      const obs = bridge.observe()
      let expected = livePosition(pb, api.serverNow())
      const atEnd = obs.duration > 0 && expected >= obs.duration - 0.5
      if (obs.duration > 0) expected = Math.min(expected, obs.duration)

      // A new play/pause/seek moves the room clock, so earlier measurements no longer apply.
      if (pb.updatedAt !== anchor) {
        anchor = pb.updatedAt
        samples = []
      }
      const drift = pb.playing && obs.playing ? measuredDrift(now) : null
      // Where the last seek actually landed tells us how much to aim ahead next time.
      if (checkLeadAfterSeek && drift !== null) {
        checkLeadAfterSeek = false
        seekLead = Math.min(SEEK_LEAD_MAX, Math.max(0, seekLead - drift))
      }

      stalledSince = pb.playing && obs.ready && !obs.playing ? stalledSince || now : 0
      playingSince = obs.playing ? playingSince || now : 0

      const status: MemberStatus = !obs.ready
        ? 'loading'
        : obs.playing
          ? 'playing'
          : pb.playing
            ? obs.hasTime
              ? 'buffering'
              : 'loading'
            : 'paused'

      if (now - last.report > 1000) {
        last.report = now
        api.report(status, obs.hasTime ? obs.time : null, drift, obs.duration || null)
      }

      setView({
        ...obs,
        expected,
        status,
        maybeBlocked: stalledSince > 0 && now - stalledSince > BLOCKED_HINT_MS,
        drift,
        rate: bridge.playbackRate,
      })

      if (!obs.ready) return

      // The film finished: stop the room once instead of fighting the player's end state.
      if (pb.playing && atEnd) {
        if (last.endedFor !== mediaKey) {
          last.endedFor = mediaKey
          api.pause(obs.duration, true)
        }
        return
      }

      // Someone pressed play inside the embed while it was reachable: take that as the room's intent.
      // (The pause must be old enough that our own pause command has had time to land.)
      const pausedFor = api.serverNow() - pb.updatedAt
      if (unlocked && !pb.playing && obs.playing && now - playingSince > 800 && pausedFor > 2500) {
        api.play(obs.time)
        return
      }

      const settling = now - last.seek < SEEK_SETTLE_MS
      if (!settling) {
        // The rough gap, good enough to decide on a jump (and available before measuring).
        const rough = (obs.hasTime ? obs.time : 0) - expected
        const limit = pb.playing ? SEEK_PLAYING : DRIFT_PAUSED
        if ((obs.hasTime || expected > 2) && Math.abs(rough) > limit) {
          resetRate()
          bridge.seek(expected + (pb.playing ? seekLead : 0))
          last.seek = now
          samples = []
          checkLeadAfterSeek = pb.playing
        }
      }

      // Fine-tuning while both the room and our player are playing.
      if (!pb.playing || !obs.playing || settling) {
        if (bridge.playbackRate !== 1) resetRate()
      } else if (drift !== null) {
        const gap = Math.abs(drift)
        if (!nudging && gap > NUDGE_START) nudging = true
        else if (nudging && gap < NUDGE_STOP) resetRate()
        if (nudging) {
          const change = Math.min(NUDGE_MAX, Math.max(NUDGE_MIN, gap * NUDGE_GAIN))
          // Ahead of the room: slow down. Behind: speed up. In steps of 0.5%.
          const rate = Math.round((1 - Math.sign(drift) * change) * 200) / 200
          bridge.setRate(rate)
        }
      }

      if (pb.playing && !obs.playing && now - last.play > 2000) {
        bridge.play()
        last.play = now
      } else if (!pb.playing && obs.playing && now - last.pause > 1200) {
        bridge.pause()
        last.pause = now
      }
    }

    const id = window.setInterval(tick, 250)
    tick()
    return () => {
      clearInterval(id)
      bridge.onExternalSeek = null
      bridge.onSample = null
      bridge.setRate(1)
    }
  }, [bridge, api.playbackRef, api.serverNow, api.seek, api.play, api.pause, api.report, mediaKey, unlocked])

  return view
}
