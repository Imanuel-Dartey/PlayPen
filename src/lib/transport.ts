// How the browsers in a room reach each other.
//
// In production that's a Supabase Realtime channel (broadcast + presence). In local
// development without Supabase keys, tabs of the same browser talk over
// BroadcastChannel instead, so the sync can be tried with two tabs side by side.

import type { PeerMessage } from '../../shared/protocol.ts'
import { supabase } from './supabase.ts'

export type PresenceMeta = { name: string; device: string }
export type PresenceState = Record<string, PresenceMeta>
export type TransportStatus = 'open' | 'reconnecting'

export interface TransportHandlers {
  onMessage: (msg: PeerMessage) => void
  onPresence: (state: PresenceState) => void
  onStatus: (status: TransportStatus) => void
}

export interface Transport {
  send: (msg: PeerMessage) => void
  close: () => void
}

export type TransportFactory = (room: string, me: string, meta: PresenceMeta, h: TransportHandlers) => Transport

export const transportKind: 'supabase' | 'local' | null = supabase ? 'supabase' : import.meta.env.DEV ? 'local' : null

export const openTransport: TransportFactory | null =
  transportKind === 'supabase' ? openSupabase : transportKind === 'local' ? openLocal : null

function openSupabase(room: string, me: string, meta: PresenceMeta, h: TransportHandlers): Transport {
  const client = supabase!
  const channel = client.channel(`playpen:${room}`, {
    config: { broadcast: { self: false, ack: false }, presence: { key: me } },
  })
  channel.on('broadcast', { event: 'm' }, ({ payload }) => h.onMessage(payload as PeerMessage))
  channel.on('presence', { event: 'sync' }, () => {
    const state: PresenceState = {}
    for (const [id, metas] of Object.entries(channel.presenceState<PresenceMeta>())) {
      state[id] = { name: metas[0]?.name ?? 'Someone', device: metas[0]?.device ?? id }
    }
    h.onPresence(state)
  })
  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track(meta)
      h.onStatus('open')
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      // supabase-js keeps retrying on its own; we only reflect it.
      h.onStatus('reconnecting')
    }
  })
  return {
    send: (msg) => void channel.send({ type: 'broadcast', event: 'm', payload: msg }),
    close: () => void client.removeChannel(channel),
  }
}

/** Same-browser stand-in for Supabase, for development only. */
function openLocal(room: string, me: string, meta: PresenceMeta, h: TransportHandlers): Transport {
  type Wire = { kind: 'msg'; msg: PeerMessage } | { kind: 'here'; id: string; meta: PresenceMeta } | { kind: 'bye'; id: string }
  const bc = new BroadcastChannel(`playpen:${room}`)
  let closed = false
  const post = (w: Wire) => !closed && bc.postMessage(w)
  const seen = new Map<string, { meta: PresenceMeta; at: number }>()
  const announce = () => post({ kind: 'here', id: me, meta })
  const emitPresence = () => {
    const state: PresenceState = { [me]: meta }
    for (const [id, p] of seen) if (Date.now() - p.at < 4000) state[id] = p.meta
    h.onPresence(state)
  }

  bc.onmessage = (e: MessageEvent<Wire>) => {
    const w = e.data
    if (w.kind === 'msg') h.onMessage(w.msg)
    else if (w.kind === 'here') {
      const isNew = !seen.has(w.id) || Date.now() - seen.get(w.id)!.at >= 4000
      seen.set(w.id, { meta: w.meta, at: Date.now() })
      if (isNew) {
        announce()
        emitPresence()
      }
    } else if (w.kind === 'bye') {
      seen.delete(w.id)
      emitPresence()
    }
  }

  const heartbeat = setInterval(() => {
    announce()
    emitPresence()
  }, 1500)
  const bye = () => post({ kind: 'bye', id: me })
  addEventListener('pagehide', bye)
  // Async, to match Supabase: handlers fire after the caller has finished wiring up.
  setTimeout(() => {
    if (closed) return
    announce()
    emitPresence()
    h.onStatus('open')
  }, 0)

  return {
    send: (msg) => post({ kind: 'msg', msg }),
    close: () => {
      clearInterval(heartbeat)
      removeEventListener('pagehide', bye)
      bye()
      closed = true
      bc.close()
    },
  }
}
