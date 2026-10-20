import { useEffect, useRef, useState } from 'react'
import type { BrowseState } from '../../shared/protocol.ts'
import { deviceId, type RoomApi } from './useRoom.ts'

export interface PeerBrowse {
  device: string
  name: string
  state: BrowseState
}

// Sent again this often while browsing, so someone arriving late still sees it.
const HEARTBEAT_MS = 5000
// Forget someone's browsing if we stop hearing about it (closed tab, lost connection).
const STALE_MS = 15000

/**
 * Shares what this person is looking at in Browse, and collects what everyone else is
 * looking at. Nothing here is saved: it's only "where are you right now".
 */
export function useBrowsePresence(api: RoomApi, mine: BrowseState | null): PeerBrowse[] {
  const device = useRef(deviceId()).current
  const [peers, setPeers] = useState<Record<string, PeerBrowse & { at: number }>>({})
  const { sendPeer, onPeer, room } = api
  const myName = room?.members.find((m) => m.id === api.you)?.name ?? ''
  const json = mine ? JSON.stringify(mine) : null
  const wasOpen = useRef(false)

  // Announce changes quickly (but not on every keystroke), and keep announcing while open.
  useEffect(() => {
    if (!json) {
      if (wasOpen.current) sendPeer({ t: 'browse', device, name: myName, state: null })
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    const state = JSON.parse(json) as BrowseState
    const send = () => sendPeer({ t: 'browse', device, name: myName, state })
    const soon = setTimeout(send, 250)
    const beat = setInterval(send, HEARTBEAT_MS)
    return () => {
      clearTimeout(soon)
      clearInterval(beat)
    }
  }, [json, sendPeer, device, myName])

  useEffect(
    () =>
      onPeer((msg) => {
        if (msg.t !== 'browse' || msg.device === device) return
        setPeers((cur) => {
          const next = { ...cur }
          if (msg.state) next[msg.device] = { device: msg.device, name: msg.name, state: msg.state, at: Date.now() }
          else delete next[msg.device]
          return next
        })
      }),
    [onPeer, device],
  )

  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      setPeers((cur) => {
        const fresh = Object.fromEntries(Object.entries(cur).filter(([, p]) => now - p.at < STALE_MS))
        return Object.keys(fresh).length === Object.keys(cur).length ? cur : fresh
      })
    }, 3000)
    return () => clearInterval(t)
  }, [])

  // Someone who left the room isn't browsing any more.
  const online = new Set(room?.members.filter((m) => m.online).map((m) => m.device))
  return Object.values(peers).filter((p) => online.has(p.device))
}
