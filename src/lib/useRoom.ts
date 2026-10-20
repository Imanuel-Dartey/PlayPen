import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cardKey,
  emptyDoc,
  isNewer,
  mergeShortlist,
  type CardRef,
  livePosition,
  type MediaRef,
  type Member,
  type MemberStatus,
  type PeerMessage,
  type Playback,
  type RoomDoc,
  type RoomEvent,
  type RoomSnapshot,
} from '../../shared/protocol.ts'
import { openTransport, type PresenceState, type Transport } from './transport.ts'

type Outgoing = PeerMessage extends infer M ? (M extends { from: string } ? Omit<M, 'from'> : never) : never

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'failed'

export interface RoomApi {
  connection: Connection
  error: string | null
  you: string
  room: RoomSnapshot | null
  /** Latest playback, including our own changes. Read it in timers rather than during render. */
  playbackRef: React.RefObject<Playback | null>
  /** The room clock: the earliest-sorting member's clock, so every screen agrees on "now". */
  serverNow: () => number
  load: (media: MediaRef) => void
  play: (position: number) => void
  /** `quiet` skips telling the others, for pauses nobody chose (the end of an episode). */
  pause: (position: number, quiet?: boolean) => void
  seek: (position: number) => void
  report: (status: MemberStatus, position: number | null, drift?: number | null, duration?: number | null) => void
  /** Switches everyone to a stream server ('' for automatic). */
  setProvider: (id: string, label: string, reason?: 'subtitles') => void
  /** Stops the countdown to the next episode, on every screen. */
  cancelUpNext: () => void
  onEvent: (fn: (e: RoomEvent) => void) => () => void
  shortlistAdd: (card: CardRef) => void
  shortlistRemove: (key: string) => void
  /** Raw room messages, for features layered on the room (chat). */
  sendPeer: (msg: Outgoing) => void
  onPeer: (fn: (msg: PeerMessage) => void) => () => void
  /** Bumps every time the connection (re)opens, so features can catch up on what they missed. */
  openCount: number
}

/** One id per browser, kept for good: it's how chat knows which messages are yours. */
export function deviceId(): string {
  const KEY = 'playpen:deviceId'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return clientId()
  }
}

/** One id per tab (kept across reloads), so two tabs are two seats in the room. */
export function clientId(): string {
  const KEY = 'playpen:clientId'
  try {
    let id = sessionStorage.getItem(KEY)
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

// How long to wait for someone already in the room before resuming our own saved copy.
const RESTORE_AFTER_MS = 1500

const storageKey = (code: string) => `playpen:room:${code}`

/** Copies saved or sent by an older version of PlayPen may lack newer fields. */
const withDefaults = (doc: RoomDoc): RoomDoc => ({
  ...doc,
  provider: doc.provider ?? '',
  upNextCancelled: doc.upNextCancelled ?? 0,
  shortlist: doc.shortlist ?? [],
  shortlistRemoved: doc.shortlistRemoved ?? {},
})

function loadSaved(code: string): RoomDoc | null {
  try {
    const raw = localStorage.getItem(storageKey(code))
    return raw ? withDefaults(JSON.parse(raw) as RoomDoc) : null
  } catch {
    return null
  }
}

function save(code: string, doc: RoomDoc) {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(doc))
  } catch {
    /* storage full or blocked: the room just won't be remembered on this device */
  }
}

interface Peer {
  id: string
  device: string
  name: string
  online: boolean
  status: MemberStatus
  position: number | null
  reportedAt: number
  drift: number | null
  duration: number | null
}

/** Episodes of the same show usually come from the same place, so the server carries over. */
const sameShow = (a: MediaRef | null, b: MediaRef) => !!a && a.type === b.type && a.id === b.id

export function useRoom(code: string, name: string): RoomApi {
  const me = useRef(clientId()).current
  const device = useRef(deviceId()).current
  const [openCount, setOpenCount] = useState(0)
  const peerListeners = useRef(new Set<(msg: PeerMessage) => void>())
  const [connection, setConnection] = useState<Connection>('connecting')
  const [error, setError] = useState<string | null>(
    openTransport ? null : 'Sync is not set up yet: add the Supabase keys described in the README.',
  )
  const [room, setRoom] = useState<RoomSnapshot | null>(null)

  const docRef = useRef<RoomDoc>(emptyDoc())
  const playbackRef = useRef<Playback | null>(null)
  const peersRef = useRef(new Map<string, Peer>())
  const offsetRef = useRef(0)
  const transportRef = useRef<Transport | null>(null)
  const listeners = useRef(new Set<(e: RoomEvent) => void>())

  const serverNow = useCallback(() => Date.now() + offsetRef.current, [])

  /** Push the current refs into React state. */
  const render = useCallback(() => {
    playbackRef.current = docRef.current.playback
    const peers = [...peersRef.current.values()]
    const self: Peer = {
      id: me,
      device,
      name,
      online: true,
      status: 'idle',
      position: null,
      reportedAt: 0,
      drift: null,
      duration: null,
    }
    const members: Member[] = [self, ...peers]
    setRoom({ ...docRef.current, code, members })
  }, [code, me, device, name])

  const emit = useCallback((e: RoomEvent) => {
    for (const fn of listeners.current) fn(e)
  }, [])

  const send = useCallback((msg: PeerMessage) => {
    transportRef.current?.send(msg)
  }, [])

  useEffect(() => {
    if (!openTransport) return
    let disposed = false
    let pingTimer: number | undefined
    let restoreTimer: number | undefined
    let leader = me
    let bestRtt = Infinity
    const throttle = { hello: 0, doc: 0 }
    const saved = loadSaved(code)
    docRef.current = emptyDoc()
    peersRef.current = new Map()
    render()

    const adopt = (doc: RoomDoc) => {
      docRef.current = doc
      save(code, doc)
      render()
    }

    const sendDoc = () => {
      throttle.doc = Date.now()
      if (docRef.current.rev > 0) send({ t: 'doc', from: me, doc: docRef.current })
    }

    const sendHello = () => {
      throttle.hello = Date.now()
      send({ t: 'hello', from: me })
    }

    // ---- room clock: follow whoever sorts first among the people here ----

    const setOffset = (next: number) => {
      const pb = docRef.current.playback
      if (pb.playing) {
        // Re-express our copy in the new clock so the picture doesn't jump.
        const pos = livePosition(pb, Date.now() + offsetRef.current)
        docRef.current = { ...docRef.current, playback: { ...pb, position: pos, updatedAt: Date.now() + next } }
      }
      offsetRef.current = next
      render()
    }

    const ping = () => leader !== me && send({ t: 'ping', from: me, to: leader, c: Date.now() })

    const electLeader = () => {
      const online = [me, ...[...peersRef.current.values()].filter((p) => p.online).map((p) => p.id)].sort()
      const next = online[0]
      if (next === leader) return
      leader = next
      bestRtt = Infinity
      clearInterval(pingTimer)
      if (leader === me) {
        setOffset(0)
        return
      }
      let burst = 0
      ping()
      pingTimer = window.setInterval(() => {
        ping()
        if (++burst === 5) {
          clearInterval(pingTimer)
          pingTimer = window.setInterval(ping, 15_000)
        }
      }, 400)
    }

    // ---- channel ----

    const onMessage = (msg: PeerMessage) => {
      if (disposed || !msg || msg.from === me) return
      for (const fn of peerListeners.current) fn(msg)
      switch (msg.t) {
        case 'doc':
          if (isNewer(msg.doc, docRef.current)) {
            const incoming = withDefaults(msg.doc)
            const merged = mergeShortlist(docRef.current, incoming)
            adopt({ ...incoming, ...merged })
            if (msg.event) emit(msg.event)
            // Their copy was missing something of ours (say we both added a title at once):
            // publish the combined list so both screens end up with it.
            if (JSON.stringify(merged) !== JSON.stringify(mergeShortlist(incoming, incoming))) {
              adopt({ ...docRef.current, rev: docRef.current.rev + 1, by: me })
              sendDoc()
            }
          }
          break
        case 'hello':
          sendDoc()
          break
        case 'ping':
          if (msg.to === me) send({ t: 'pong', from: me, to: msg.from, c: msg.c, s: serverNow() })
          break
        case 'pong': {
          if (msg.to !== me || msg.from !== leader) break
          const rtt = Date.now() - msg.c
          // Keep the least noisy sample, but let it age so a slowly drifting clock still gets corrected.
          if (rtt <= bestRtt * 1.2) {
            bestRtt = Math.min(rtt, bestRtt)
            setOffset(msg.s - (msg.c + rtt / 2))
          } else {
            bestRtt *= 1.05
          }
          break
        }
        case 'report': {
          const peer = peersRef.current.get(msg.from)
          if (peer) {
            peer.status = msg.status
            peer.position = msg.position
            peer.drift = typeof msg.drift === 'number' ? msg.drift : null
            peer.duration = typeof msg.duration === 'number' && msg.duration > 0 ? msg.duration : null
            // Use when they read it, not when it got here; the trip takes a while.
            const now = serverNow()
            peer.reportedAt = typeof msg.at === 'number' ? Math.min(now, Math.max(now - 3000, msg.at)) : now
            render()
          }
          // Broadcasts can be dropped; the heartbeat is where copies that fell out of step heal.
          const now = Date.now()
          if (msg.rev > docRef.current.rev && now - throttle.hello > 3000) sendHello()
          else if (msg.rev < docRef.current.rev && now - throttle.doc > 2000) sendDoc()
          break
        }
      }
    }

    const onPresence = (state: PresenceState) => {
      if (disposed) return
      const here = new Set(Object.keys(state).filter((id) => id !== me))
      for (const id of here) {
        const meta = state[id]
        const peer = peersRef.current.get(id)
        if (!peer) {
          peersRef.current.set(id, {
            id,
            device: meta?.device ?? id,
            name: meta?.name ?? 'Someone',
            online: true,
            status: 'loading',
            position: null,
            reportedAt: 0,
            drift: null,
            duration: null,
          })
          emit({ kind: 'join', by: meta?.name ?? 'Someone' })
        } else if (!peer.online) {
          peer.online = true
          peer.name = meta?.name ?? peer.name
          emit({ kind: 'join', by: peer.name })
        }
      }
      for (const peer of peersRef.current.values()) {
        if (peer.online && !here.has(peer.id)) {
          peer.online = false
          peer.status = 'idle'
          emit({ kind: 'leave', by: peer.name })
        }
      }
      electLeader()
      render()
    }

    const onStatus = (status: 'open' | 'reconnecting') => {
      if (disposed) return
      if (status === 'open') {
        setConnection('open')
        setError(null)
        setOpenCount((n) => n + 1)
        sendHello()
        // If nobody answers with a copy of the room, pick up where this device left off, paused.
        clearTimeout(restoreTimer)
        restoreTimer = window.setTimeout(() => {
          if (docRef.current.rev > 0 || !saved?.rev) return
          const position = livePosition(saved.playback, Date.now())
          adopt({
            ...saved,
            playback: { playing: false, position, updatedAt: serverNow() },
            rev: saved.rev + 1,
            by: me,
          })
          sendDoc()
        }, RESTORE_AFTER_MS)
      } else {
        setConnection('reconnecting')
      }
    }

    transportRef.current = openTransport(code, me, { name, device }, { onMessage, onPresence, onStatus })

    return () => {
      disposed = true
      clearInterval(pingTimer)
      clearTimeout(restoreTimer)
      transportRef.current?.close()
      transportRef.current = null
    }
  }, [code, me, device, name, render, emit, send, serverNow])

  const change = useCallback(
    (update: Partial<RoomDoc>, event?: RoomEvent) => {
      const doc: RoomDoc = { ...docRef.current, ...update, rev: docRef.current.rev + 1, by: me }
      docRef.current = doc
      save(code, doc)
      render()
      send({ t: 'doc', from: me, doc, event })
    },
    [code, me, render, send],
  )

  const transport = useCallback(
    (kind: 'play' | 'pause' | 'seek', position: number, quiet = false) => {
      if (!docRef.current.media) return
      const position_ = Math.max(0, position)
      const playing = kind === 'seek' ? docRef.current.playback.playing : kind === 'play'
      change(
        { playback: { playing, position: position_, updatedAt: serverNow() } },
        quiet ? undefined : { kind, by: name, position: position_ },
      )
    },
    [change, name, serverNow],
  )

  return {
    connection,
    error,
    you: me,
    room,
    playbackRef,
    serverNow,
    load: useCallback(
      (media: MediaRef) =>
        change(
          {
            media,
            mediaVersion: docRef.current.mediaVersion + 1,
            playback: { playing: false, position: 0, updatedAt: serverNow() },
            provider: sameShow(docRef.current.media, media) ? docRef.current.provider : '',
          },
          { kind: 'load', by: name, media },
        ),
      [change, name, serverNow],
    ),
    play: useCallback((p: number) => transport('play', p), [transport]),
    pause: useCallback((p: number, quiet?: boolean) => transport('pause', p, quiet), [transport]),
    seek: useCallback((p: number) => transport('seek', p), [transport]),
    report: useCallback(
      (status: MemberStatus, position: number | null, drift?: number | null, duration?: number | null) =>
        send({
          t: 'report',
          from: me,
          status,
          position,
          rev: docRef.current.rev,
          drift: drift ?? null,
          at: serverNow(),
          duration: duration ?? null,
        }),
      [me, send, serverNow],
    ),
    setProvider: useCallback(
      (id: string, label: string, reason?: 'subtitles') => {
        if (!docRef.current.media || docRef.current.provider === id) return
        change({ provider: id }, { kind: 'server', by: name, server: label, reason })
      },
      [change, name],
    ),
    cancelUpNext: useCallback(() => {
      if (!docRef.current.media) return
      change({ upNextCancelled: docRef.current.mediaVersion }, { kind: 'upNextCancelled', by: name })
    }, [change, name]),
    openCount,
    sendPeer: useCallback((msg: Outgoing) => send({ ...msg, from: me } as PeerMessage), [me, send]),
    onPeer: useCallback((fn: (msg: PeerMessage) => void) => {
      peerListeners.current.add(fn)
      return () => {
        peerListeners.current.delete(fn)
      }
    }, []),
    shortlistAdd: useCallback(
      (card: CardRef) => {
        const key = cardKey(card)
        const doc = docRef.current
        if (doc.shortlist.some((i) => i.key === key)) return
        const item = {
          key,
          type: card.type,
          id: card.id,
          title: card.title,
          year: card.year,
          poster: card.poster,
          by: device,
          byName: name,
          at: serverNow(),
        }
        // Keep the list a manageable size: the oldest picks drop off first.
        change({ shortlist: [...doc.shortlist, item].slice(-40) }, { kind: 'shortlist', by: name, title: card.title })
      },
      [change, device, name, serverNow],
    ),
    shortlistRemove: useCallback(
      (key: string) => {
        const doc = docRef.current
        change({
          shortlist: doc.shortlist.filter((i) => i.key !== key),
          shortlistRemoved: { ...doc.shortlistRemoved, [key]: serverNow() },
        })
      },
      [change, serverNow],
    ),
    onEvent: useCallback((fn: (e: RoomEvent) => void) => {
      listeners.current.add(fn)
      return () => {
        listeners.current.delete(fn)
      }
    }, []),
  }
}
