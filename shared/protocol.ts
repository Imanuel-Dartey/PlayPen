// Messages exchanged between the browsers in a room, over a Supabase broadcast channel.
//
// There is no server holding the room. Every browser keeps its own copy of the
// RoomDoc; each change bumps `rev`, and the copy with the highest (rev, by) wins.
// Timestamps are in the room clock (see useRoom); positions are seconds.

export type MediaRef =
  | { type: 'movie'; id: string; title: string; poster?: string; backdrop?: string }
  | {
      type: 'tv'
      id: string
      title: string
      season: number
      episode: number
      episodeTitle?: string
      poster?: string
      backdrop?: string
    }

export interface Playback {
  playing: boolean
  /** Position at `updatedAt`. While playing, the live position keeps advancing from here. */
  position: number
  updatedAt: number
}

/** A title either of you saved while browsing, to decide on together. */
export interface ShortlistItem {
  key: string
  type: 'movie' | 'tv'
  id: string
  title: string
  year?: string
  poster?: string
  /** Device id and name of whoever added it. */
  by: string
  byName: string
  at: number
}

export interface RoomDoc {
  media: MediaRef | null
  /** Bumps on every load, so choosing the same title again restarts it for everyone. */
  mediaVersion: number
  playback: Playback
  /**
   * The stream server everyone uses, '' for the embed's own choice. Shared because servers
   * can carry different cuts of the same episode, and two cuts can't be kept in sync.
   */
  provider: string
  /** The mediaVersion whose "Up next" countdown someone cancelled (0 for none). */
  upNextCancelled: number
  shortlist: ShortlistItem[]
  /**
   * When each title was last taken off the shortlist. Kept so that a removal and a
   * simultaneous add elsewhere resolve the same way on both screens (later one wins).
   */
  shortlistRemoved: Record<string, number>
  rev: number
  /** clientId of whoever made this revision; breaks ties between simultaneous edits. */
  by: string
}

export type MemberStatus = 'loading' | 'playing' | 'paused' | 'buffering' | 'idle'

export interface Member {
  id: string
  /** Stable per browser (unlike `id`, which is per tab); ties chat messages to people. */
  device: string
  name: string
  online: boolean
  status: MemberStatus
  position: number | null
  reportedAt: number
  /** Their measured gap from the room clock, when they've reported one. */
  drift: number | null
  /** How long the stream on their screen is, once it has started. */
  duration: number | null
}

export interface RoomSnapshot extends RoomDoc {
  code: string
  members: Member[]
}

export type RoomEvent =
  | { kind: 'join' | 'leave'; by: string }
  | { kind: 'play' | 'pause' | 'seek'; by: string; position: number }
  | { kind: 'load'; by: string; media: MediaRef }
  | { kind: 'shortlist'; by: string; title: string }
  | { kind: 'server'; by: string; server: string; reason?: 'subtitles' }
  | { kind: 'upNextCancelled'; by: string }

export type PeerMessage =
  /** Our current copy of the room, sent after every change and whenever a peer is behind. */
  | { t: 'doc'; from: string; doc: RoomDoc; event?: RoomEvent }
  /** "I just arrived (or fell behind), send me your copy." */
  | { t: 'hello'; from: string }
  | { t: 'ping'; from: string; to: string; c: number }
  | { t: 'pong'; from: string; to: string; c: number; s: number }
  /** Once a second: what my player is doing, and which revision I'm on. */
  | {
      t: 'report'
      from: string
      status: MemberStatus
      position: number | null
      rev: number
      /** Sender's measured gap from the room clock, in seconds (+ is ahead). */
      drift?: number | null
      /** When the position was read, in the room clock. */
      at?: number
      /** Length of the stream on the sender's screen. */
      duration?: number | null
    }
  /** A chat message that has just been saved. */
  | { t: 'chat'; from: string; msg: ChatMessage }
  | { t: 'typing'; from: string; device: string; name: string }
  /** What I'm looking at in Browse (null once I close it). Sent on change and every few seconds. */
  | { t: 'browse'; from: string; device: string; name: string; state: BrowseState | null }

export interface BrowseFilters {
  /** 'all' is the home view of rotating rails; the others are a filtered grid. */
  type: 'all' | 'movie' | 'tv'
  category: 'trending' | 'popular' | 'top_rated' | 'new'
  genre: string
  year: string
  minRating: string
  sort: string
}

export interface CardRef {
  type: 'movie' | 'tv'
  id: string
  title: string
  year?: string
  poster?: string
  backdrop?: string
}

export interface BrowseState {
  query: string
  filters: BrowseFilters
  card: CardRef | null
}

export interface ChatMedia {
  url: string
  width: number
  height: number
  /** GIFs: a much lighter looping video of the same clip, when the provider has one. */
  mp4?: string
}

export interface ChatMessage {
  id: string
  device: string
  author: string
  kind: 'text' | 'gif' | 'image'
  body: string | null
  media: ChatMedia | null
  /** Milliseconds since epoch. */
  at: number
}

export const CHAT_BODY_MAX = 2000

export const ROOM_CODE_PATTERN = /^[a-z0-9-]{3,32}$/

export function emptyDoc(): RoomDoc {
  return {
    media: null,
    mediaVersion: 0,
    playback: { playing: false, position: 0, updatedAt: 0 },
    provider: '',
    upNextCancelled: 0,
    shortlist: [],
    shortlistRemoved: {},
    rev: 0,
    by: '',
  }
}

export const cardKey = (c: { type: string; id: string }) => `${c.type}:${c.id}`

/**
 * Combines two copies of the shortlist. An add and a removal of the same title keep
 * whichever happened later, so the result doesn't depend on which copy arrived first.
 */
export function mergeShortlist(
  a: Pick<RoomDoc, 'shortlist' | 'shortlistRemoved'>,
  b: Pick<RoomDoc, 'shortlist' | 'shortlistRemoved'>,
): Pick<RoomDoc, 'shortlist' | 'shortlistRemoved'> {
  const removed: Record<string, number> = { ...(a.shortlistRemoved ?? {}) }
  for (const [k, at] of Object.entries(b.shortlistRemoved ?? {})) removed[k] = Math.max(removed[k] ?? 0, at)
  const items = new Map<string, ShortlistItem>()
  for (const item of [...(a.shortlist ?? []), ...(b.shortlist ?? [])]) {
    const have = items.get(item.key)
    if (!have || item.at > have.at) items.set(item.key, item) // the latest add is the one that counts
  }
  const shortlist = [...items.values()].filter((i) => !(removed[i.key] >= i.at)).sort((x, y) => x.at - y.at)
  return { shortlist, shortlistRemoved: removed }
}

export function isNewer(a: RoomDoc, b: RoomDoc): boolean {
  return a.rev > b.rev || (a.rev === b.rev && a.by > b.by)
}

export function livePosition(p: Playback, now: number): number {
  return p.playing ? p.position + Math.max(0, now - p.updatedAt) / 1000 : p.position
}
