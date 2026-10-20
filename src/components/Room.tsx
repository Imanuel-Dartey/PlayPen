import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  livePosition,
  type BrowseState,
  type ChatMessage,
  type MediaRef,
  type Member,
  type RoomEvent,
} from '../../shared/protocol.ts'
import { getProviders, type Provider } from '../lib/catalog.ts'
import { FramexBridge, embedUrl } from '../lib/framex.ts'
import { formatTime, mediaLabel, personColor } from '../lib/format.ts'
import { emptyBrowse } from '../lib/browseData.ts'
import { findServer } from '../lib/serverProbe.ts'
import { fitsStream, lastLineEnd } from '../lib/subtitles.ts'
import { useBrowsePresence } from '../lib/useBrowsePresence.ts'
import { useChat } from '../lib/useChat.ts'
import { useNextEpisode } from '../lib/useNextEpisode.ts'
import { useSubtitles } from '../lib/useSubtitles.ts'
import { usePlayerSync } from '../lib/usePlayerSync.ts'
import { transportKind } from '../lib/transport.ts'
import { useRoom } from '../lib/useRoom.ts'
import { Browse } from './Browse.tsx'
import { Captions } from './Captions.tsx'
import { Chat } from './Chat.tsx'
import { EpisodePanel } from './EpisodePanel.tsx'
import { Icon } from './Icon.tsx'
import { CutNote, SubtitleMenu, type CutCheck } from './SubtitleMenu.tsx'
import { TogetherBar, type Playhead } from './TogetherBar.tsx'
import { UpNext } from './UpNext.tsx'

// The "Up next" card appears this long before an episode ends...
const UP_NEXT_LEAD_S = 20
// ...and once it has ended, the next one starts after this countdown.
const UP_NEXT_COUNTDOWN_MS = 10_000
// Two screens whose streams differ by more than this are playing different cuts.
const CUT_TOLERANCE_S = 20

interface Toast {
  id: number
  text: string
}

function readVolume() {
  try {
    const v = Number(localStorage.getItem('playpen:volume'))
    return Number.isFinite(v) && localStorage.getItem('playpen:volume') != null ? Math.min(1, Math.max(0, v)) : 1
  } catch {
    return 1
  }
}

function readChatOpen() {
  try {
    return localStorage.getItem('playpen:chatOpen') !== '0'
  } catch {
    return true
  }
}

function preview(m: ChatMessage): string {
  if (m.kind === 'gif') return `${m.author} sent a GIF`
  if (m.kind === 'image') return `${m.author} sent a photo`
  const body = m.body ?? ''
  return `${m.author}: ${body.length > 60 ? `${body.slice(0, 57)}…` : body}`
}

function describe(e: RoomEvent): string {
  switch (e.kind) {
    case 'join':
      return `${e.by} is here`
    case 'leave':
      return `${e.by} left`
    case 'play':
      return `${e.by} pressed play`
    case 'pause':
      return `${e.by} paused at ${formatTime(e.position)}`
    case 'seek':
      return `${e.by} jumped to ${formatTime(e.position)}`
    case 'load':
      return `${e.by} put on ${mediaLabel(e.media)}`
    case 'shortlist':
      return `${e.by} added ${e.title} to the shortlist`
    case 'server':
      return e.reason === 'subtitles'
        ? `${e.by} switched to ${e.server} so the subtitles line up`
        : `${e.by} switched to ${e.server}`
    case 'upNextCancelled':
      return `${e.by} cancelled the next episode`
  }
}

export function Room({ code, name, onLeave }: { code: string; name: string; onLeave: () => void }) {
  const api = useRoom(code, name)
  const bridge = useMemo(() => new FramexBridge(), [])
  useEffect(() => bridge.listen(), [bridge])
  // Stable, so React doesn't detach and re-attach the player on every render.
  const attachFrame = useCallback((el: HTMLIFrameElement | null) => bridge.attach(el), [bridge])

  const chat = useChat(api, code, name)
  const theaterRef = useRef<HTMLDivElement>(null)
  const [chatOpen, setChatOpen] = useState(readChatOpen)
  const [unread, setUnread] = useState(0)
  // What this person is looking at in Browse; null while it's closed.
  const [browse, setBrowse] = useState<BrowseState | null>(null)
  const browseOpen = browse !== null
  const openBrowse = useCallback(() => setBrowse((b) => b ?? emptyBrowse()), [])
  const peersBrowsing = useBrowsePresence(api, browse)
  // A moment of letting clicks through to the embed: to click an ad away, or to press its
  // own play button when the browser blocked autoplay.
  const [reach, setReach] = useState<null | 'ad' | 'play'>(null)
  const [adLikely, setAdLikely] = useState(false)
  // Bumped to rebuild the embed if something navigates it away from the player.
  const [frameNonce, setFrameNonce] = useState(0)
  const frameLoads = useRef(0)
  const [frameLoadedAt, setFrameLoadedAt] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [volume, setVolume] = useState(readVolume)
  const [providers, setProviders] = useState<Provider[]>([])
  const [episodesOpen, setEpisodesOpen] = useState(false)
  // The "Up next" card, hidden on this screen for this episode.
  const [upNextHidden, setUpNextHidden] = useState<string | null>(null)
  const [cutSearch, setCutSearch] = useState<null | { trying: string } | 'none'>(null)
  const [cutNoteHidden, setCutNoteHidden] = useState<string | null>(null)
  const probeHost = useRef<HTMLDivElement>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [copied, setCopied] = useState(false)

  const media = api.room?.media ?? null
  const mediaKey = media && api.room ? `${api.room.mediaVersion}:${mediaLabel(media)}` : null
  const provider = api.room?.provider ?? ''
  const providerRef = useRef(provider)
  providerRef.current = provider
  const passThrough = reach !== null
  const sync = usePlayerSync(bridge, api, mediaKey, passThrough)
  const subs = useSubtitles(media)

  // ---- the embed src is fixed per title; everything after load happens over postMessage ----
  const src = useMemo(() => {
    if (!media) return null
    const pb = api.playbackRef.current
    const start = pb ? livePosition(pb, api.serverNow()) : 0
    return embedUrl(media, { start, autoplay: !!pb?.playing, provider: providerRef.current })
    // Only a new load (or a rebuilt embed) should reload the iframe, never a play/pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, frameNonce])

  useEffect(() => {
    frameLoads.current = 0
  }, [mediaKey, frameNonce])

  const onFrameLoad = useCallback(() => {
    frameLoads.current++
    if (frameLoads.current > 1) {
      // The player is a single page, so a second load means an ad navigated the frame
      // somewhere else. Put the player back, at the room's current position.
      setFrameNonce((n) => n + 1)
      return
    }
    setFrameLoadedAt(Date.now())
  }, [])

  // The embed's ad dialog shows up roughly 12s after it loads; offer the way past it then.
  useEffect(() => {
    setAdLikely(false)
    if (!frameLoadedAt) return
    const show = setTimeout(() => setAdLikely(true), 9_000)
    const hide = setTimeout(() => setAdLikely(false), 45_000)
    return () => {
      clearTimeout(show)
      clearTimeout(hide)
    }
  }, [frameLoadedAt])

  // While reaching into the player, clicks go to the embed. The ad's invisible pop-up layer can
  // swallow the first click, so stay open for a few seconds after the latest click rather
  // than closing on the first one (and give up after a while regardless).
  useEffect(() => {
    if (!reach) return
    let after: number | undefined
    let refocus: number | undefined
    const giveUp = window.setTimeout(() => setReach(null), 20_000)
    const onBlur = () => {
      setTimeout(() => {
        if (document.activeElement?.tagName !== 'IFRAME') return
        // A click landed in the player. Take focus back so the next click registers too,
        // and so PlayPen's keyboard shortcuts keep working.
        clearTimeout(refocus)
        refocus = window.setTimeout(() => theaterRef.current?.focus({ preventScroll: true }), 250)
        clearTimeout(after)
        after = window.setTimeout(() => setReach(null), 4000)
      }, 0)
    }
    addEventListener('blur', onBlur)
    return () => {
      clearTimeout(giveUp)
      clearTimeout(after)
      clearTimeout(refocus)
      removeEventListener('blur', onBlur)
    }
  }, [reach])

  // A new player starts on the room's server (it's in the URL). After that, follow the room's
  // choice over postMessage; going back to the automatic choice needs a fresh player.
  const frameKey = `${mediaKey}:${frameNonce}`
  const appliedProvider = useRef({ frame: '', id: '' })
  useEffect(() => {
    appliedProvider.current = { frame: frameKey, id: providerRef.current }
  }, [frameKey])
  useEffect(() => {
    const applied = appliedProvider.current
    if (applied.frame !== frameKey || applied.id === provider) return
    applied.id = provider
    if (provider) bridge.setProvider(provider)
    else setFrameNonce((n) => n + 1)
  }, [provider, frameKey, bridge])

  useEffect(() => {
    setEpisodesOpen(false)
    setCutSearch(null)
  }, [mediaKey])

  useEffect(() => {
    getProviders().then(setProviders, () => setProviders([]))
  }, [])

  // ---- toasts for what the other person did ----

  const pushToast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const chatOpenRef = useRef(chatOpen)
  chatOpenRef.current = chatOpen
  useEffect(
    () =>
      chat.onIncoming((m) => {
        if (chatOpenRef.current) return
        setUnread((n) => n + 1)
        pushToast(preview(m))
      }),
    [chat.onIncoming, pushToast],
  )

  useEffect(() => api.onEvent((e) => pushToast(describe(e))), [api.onEvent, pushToast])

  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      try {
        localStorage.setItem('playpen:chatOpen', open ? '0' : '1')
      } catch {
        /* not remembered */
      }
      return !open
    })
    setUnread(0)
  }, [])

  // ---- transport, shared by the bar, the click shield and the keyboard ----
  const currentPosition = useCallback(() => {
    if (sync.hasTime) return sync.time
    const pb = api.playbackRef.current
    return pb ? livePosition(pb, api.serverNow()) : 0
  }, [sync.hasTime, sync.time, api.playbackRef, api.serverNow])

  const playing = api.room?.playback.playing ?? false

  const togglePlay = useCallback(() => {
    if (!media) return
    const pos = currentPosition()
    if (playing) {
      api.pause(pos)
      bridge.pause()
    } else {
      api.play(pos)
      bridge.play()
    }
  }, [media, playing, currentPosition, api, bridge])

  const seek = useCallback(
    (pos: number) => {
      if (!media) return
      api.seek(pos)
      bridge.seek(pos)
    },
    [media, api, bridge],
  )

  // Quick repeated presses add up (3 × →  = +30s) instead of each starting from a stale position.
  const seekTarget = useRef<{ pos: number; at: number } | null>(null)
  const seekBy = useCallback(
    (delta: number) => {
      const now = performance.now()
      const recent = seekTarget.current && now - seekTarget.current.at < 1500
      const base = recent ? seekTarget.current!.pos : currentPosition()
      const pos = Math.max(0, Math.min(sync.duration || Infinity, base + delta))
      seekTarget.current = { pos, at: now }
      seek(pos)
    },
    [currentPosition, seek, sync.duration],
  )

  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v)
      bridge.setVolume(v)
      try {
        localStorage.setItem('playpen:volume', String(v))
      } catch {
        /* not remembered */
      }
    },
    [bridge],
  )

  // Re-apply the volume each time a new player loads.
  useEffect(() => {
    if (sync.ready) bridge.setVolume(volume)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.ready, mediaKey])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen()
    else theaterRef.current?.requestFullscreen?.()
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Hide the bar while watching full screen; any movement brings it back.
  useEffect(() => {
    if (!fullscreen) {
      setIdle(false)
      return
    }
    let t: number | undefined
    const wake = () => {
      setIdle(false)
      clearTimeout(t)
      t = window.setTimeout(() => setIdle(true), 2500)
    }
    wake()
    const el = theaterRef.current
    el?.addEventListener('pointermove', wake)
    el?.addEventListener('keydown', wake)
    return () => {
      clearTimeout(t)
      el?.removeEventListener('pointermove', wake)
      el?.removeEventListener('keydown', wake)
    }
  }, [fullscreen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (browseOpen || !media) return
      const el = e.target as HTMLElement
      if (el.closest('input, select, textarea, [role="slider"]')) return
      if (e.key === ' ' || e.key === 'k') togglePlay()
      else if (e.key === 'ArrowRight') seekBy(10)
      else if (e.key === 'ArrowLeft') seekBy(-10)
      else if (e.key === 'f') toggleFullscreen()
      else if (e.key === 'm') changeVolume(volume === 0 ? 1 : 0)
      else if (e.key === 'c') subs.toggle()
      else if (e.key === 'e' && media.type === 'tv') setEpisodesOpen((o) => !o)
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [browseOpen, media, togglePlay, seekBy, toggleFullscreen, changeVolume, volume, subs.toggle])

  // ---- picking things ----
  const pick = (m: MediaRef) => {
    setBrowse(null)
    setEpisodesOpen(false)
    api.load(m)
    setReach(null)
  }

  const pickEpisode = (m: MediaRef) => {
    const same = m.type === 'tv' && media?.type === 'tv' && m.id === media.id && m.season === media.season && m.episode === media.episode
    if (same) setEpisodesOpen(false)
    else pick(m)
  }

  const upNext = useNextEpisode(media)
  const next = useCallback(() => {
    if (upNext) api.load(upNext.media)
    else if (media?.type === 'tv') pushToast('There’s no next episode yet. Pick one from the episode list.')
  }, [upNext, media, api, pushToast])

  const invite = async () => {
    const url = `${location.origin}/r/${code}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      prompt('Copy this link and send it to them:', url)
    }
  }

  // ---- people ----
  const members = api.room?.members ?? []
  // Colors go by sorted device id, over everyone present or in the chat, so each person
  // gets the same color on both screens.
  const devices = [...new Set([...members.map((m) => m.device), ...chat.messages.map((m) => m.device)])].sort()
  const hueOf = (device: string) => Math.max(0, devices.indexOf(device))
  const others = members.filter((m) => m.id !== api.you)
  const onlineOthers = others.filter((m) => m.online)
  const playheads: Playhead[] = members
    .filter((m) => m.online)
    .map((m) => ({
      id: m.id,
      name: m.name,
      hue: hueOf(m.device),
      isYou: m.id === api.you,
      position: m.id === api.you ? (sync.hasTime ? sync.time : null) : extrapolate(m, api.serverNow()),
    }))

  const position = sync.hasTime ? sync.time : sync.expected
  const roomPb = api.room?.playback
  const mediaVersion = api.room?.mediaVersion ?? 0
  // For timers and async work that outlive this render.
  const latest = useRef({ mediaKey, mediaVersion })
  latest.current = { mediaKey, mediaVersion }
  const closeEpisodes = useCallback(() => setEpisodesOpen(false), [])

  // ---- up next: an offer near the end, then a shared countdown once the episode is over ----
  const ended = !!roomPb && !roomPb.playing && sync.duration > 0 && roomPb.position >= sync.duration - 1
  const nearEnd = playing && sync.duration > 0 && position >= sync.duration - UP_NEXT_LEAD_S
  const upNextCancelled = api.room?.upNextCancelled === mediaVersion
  // On the room clock, so both screens count down together.
  const upNextAt = upNext && ended && !upNextCancelled ? roomPb.updatedAt + UP_NEXT_COUNTDOWN_MS : null
  const secondsLeft = upNextAt != null ? Math.max(0, Math.ceil((upNextAt - api.serverNow()) / 1000)) : null
  // One screen starts it, so the room doesn't load it twice: the same one that keeps the clock.
  const leads = [api.you, ...onlineOthers.map((m) => m.id)].sort()[0] === api.you
  const nextMedia = upNext?.media
  useEffect(() => {
    if (upNextAt == null || !nextMedia) return
    // If the leading screen doesn't (its tab might be asleep), the other one steps in.
    const wait = upNextAt - api.serverNow() + (leads ? 0 : 3000)
    const version = mediaVersion
    const t = window.setTimeout(() => {
      // Unless someone already moved on (or picked something else) in the meantime.
      if (latest.current.mediaVersion === version) api.load(nextMedia)
    }, Math.max(0, wait))
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNextAt, nextMedia, leads, mediaVersion])
  const showUpNext = !!upNext && (ended || nearEnd) && upNextHidden !== mediaKey

  // ---- subtitles made for another cut of the episode than the one this server plays ----
  const subsEnd = subs.cues ? lastLineEnd(subs.cues) : 0
  const cutCheck: CutCheck =
    cutSearch && cutSearch !== 'none'
      ? { state: 'searching', trying: cutSearch.trying }
      : subsEnd && sync.duration > 0 && !fitsStream(subsEnd, sync.duration)
        ? { state: cutSearch === 'none' ? 'none' : 'mismatch', subtitles: subsEnd, stream: sync.duration }
        : { state: 'ok' }
  const cutNoteKey = `${mediaKey}:${subsEnd}`

  const findMatchingServer = async () => {
    const host = probeHost.current
    if (!media || !host || !subsEnd) return
    const ctrl = new AbortController()
    const version = mediaKey
    const stopOnChange = () => version !== latest.current.mediaKey && ctrl.abort()
    const watch = window.setInterval(stopOnChange, 500)
    setCutSearch({ trying: '' })
    try {
      const found = await findServer({
        media,
        candidates: providers.filter((p) => p.id !== provider),
        fits: (d) => fitsStream(subsEnd, d),
        host,
        signal: ctrl.signal,
        onTry: (p) => setCutSearch((cur) => (cur && cur !== 'none' ? { trying: p.name } : cur)),
      })
      if (ctrl.signal.aborted) return
      if (found) {
        setCutSearch(null)
        api.setProvider(found.provider.id, found.provider.name, 'subtitles')
        pushToast(`Switched to ${found.provider.name}: its version matches the subtitles`)
      } else {
        setCutSearch('none')
      }
    } finally {
      clearInterval(watch)
    }
  }

  // ---- two screens playing different cuts can't be kept together ----
  const otherCut =
    sync.duration > 0
      ? onlineOthers.find(
          (m) =>
            m.status !== 'loading' && m.duration != null && Math.abs(m.duration - sync.duration) > CUT_TOLERANCE_S,
        )
      : undefined

  if (api.error && !api.room?.media) {
    return (
      <main className="landing">
        <h1 className="landing-title landing-title-small">Can’t open this room</h1>
        <p className="landing-lede">{api.error}</p>
        <button className="btn" onClick={onLeave}>
          Back to start
        </button>
      </main>
    )
  }

  // Both screens measure their own gap from the room clock; the difference is the gap
  // between the two screens. Shown for the partner furthest away, while everyone plays.
  const partnerDrifts = onlineOthers.filter((m) => m.status === 'playing' && m.drift != null).map((m) => m.drift!)
  const apart =
    sync.drift != null && partnerDrifts.length > 0
      ? Math.max(...partnerDrifts.map((d) => Math.abs(d - sync.drift!)))
      : null

  return (
    <div className="room">
      <header className="room-head">
        <button className="wordmark" onClick={onLeave} aria-label="Leave room and go to the start page">
          <span className="wordmark-mark" aria-hidden="true">
            <span className="orb orb-you" />
            <span className="orb orb-them" />
          </span>
          PlayPen
        </button>

        <div className="now">
          {media ? (
            <>
              <span className="now-title">{media.title}</span>
              {media.type === 'tv' && (
                <span className="now-ep">
                  S{media.season} E{media.episode}
                  {media.episodeTitle ? `, ${media.episodeTitle}` : ''}
                </span>
              )}
            </>
          ) : (
            <span className="now-ep">Room {code}</span>
          )}
        </div>

        <div className="head-actions">
          <ul className="people" aria-label="Who's here">
            {members
              .filter((m) => m.online)
              .map((m) => (
                <li
                  key={m.id}
                  className="person"
                  style={{ '--c': personColor(hueOf(m.device)) } as React.CSSProperties}
                  title={`${m.id === api.you ? 'You' : m.name}: ${statusText(m, m.id === api.you ? sync.status : m.status)}`}
                >
                  <span className="person-dot" data-status={m.id === api.you ? sync.status : m.status} />
                  <span className="person-name">{m.id === api.you ? 'You' : m.name}</span>
                </li>
              ))}
          </ul>
          <button className="btn btn-quiet" onClick={invite}>
            <Icon name="link" size={18} />
            <span>{copied ? 'Link copied' : 'Copy invite link'}</span>
          </button>
          {chat.enabled && (
            <button
              className="btn btn-quiet chat-toggle"
              onClick={toggleChat}
              aria-pressed={chatOpen}
              aria-label={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
            >
              <Icon name="chat" size={18} />
              <span>Chat</span>
              {unread > 0 && !chatOpen && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
            </button>
          )}
          <button
            className="btn btn-primary browse-btn"
            onClick={() => (browseOpen ? setBrowse(null) : openBrowse())}
            aria-pressed={browseOpen}
            title={peersBrowsing.length ? `${peersBrowsing.map((p) => p.name).join(' and ')} is browsing` : undefined}
          >
            <Icon name={browseOpen ? 'play' : 'grid'} size={18} />
            <span>{browseOpen ? 'Back to the screen' : 'Browse'}</span>
            {!browseOpen &&
              peersBrowsing.map((p) => (
                <span
                  key={p.device}
                  className="browse-btn-dot"
                  style={{ background: personColor(hueOf(p.device)) }}
                  aria-label={`${p.name} is browsing`}
                />
              ))}
          </button>
        </div>
      </header>

      {transportKind === 'local' && (
        <p className="banner" role="status">
          Local test mode: no Supabase keys, so this only syncs between tabs of this browser.
        </p>
      )}
      {api.connection !== 'open' && (
        <p className="banner" role="status">
          {api.connection === 'connecting' ? 'Connecting to the room…' : 'Connection lost. Reconnecting…'}
        </p>
      )}

      <div
        ref={theaterRef}
        tabIndex={-1}
        className={`theater${chatOpen && chat.enabled ? ' theater-chat' : ''}${fullscreen ? ' theater-full' : ''}`}
      >
        {browse && (
          <Browse
            state={browse}
            onChange={setBrowse}
            onClose={() => setBrowse(null)}
            onWatch={pick}
            peers={peersBrowsing}
            colorFor={(d) => personColor(hueOf(d))}
            shortlist={api.room?.shortlist ?? []}
            onShortlistAdd={api.shortlistAdd}
            onShortlistRemove={api.shortlistRemove}
          />
        )}
        {/* While browsing, the player stays loaded (and playing) off to the side. */}
        <div className={`stage${fullscreen ? ' stage-full' : ''}${idle ? ' stage-idle' : ''}${browseOpen ? ' stage-away' : ''}`}>
          <div className="screen">
            {src ? (
              <>
                <iframe
                  key={`${mediaKey}:${frameNonce}`}
                  ref={attachFrame}
                  className="embed"
                  src={src}
                  title={mediaLabel(media!)}
                  // The embed carries third-party ads that open pop-up windows and try to
                  // redirect the page. Without allow-popups and allow-top-navigation the
                  // browser refuses both; the player itself only needs scripts and its own origin.
                  sandbox="allow-scripts allow-same-origin"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  referrerPolicy="origin"
                  onLoad={onFrameLoad}
                />
                {!passThrough && (
                  <div className="shield" onClick={togglePlay} onDoubleClick={toggleFullscreen} aria-hidden="true" />
                )}
                {!passThrough && (
                  <button
                    className={`ad-btn${adLikely ? ' ad-btn-show' : ''}`}
                    onClick={() => setReach('ad')}
                    title="Lets your next clicks reach the player, so you can click the ad away"
                  >
                    <Icon name="close" size={14} />
                    Close an ad
                  </button>
                )}
                {reach === 'ad' && (
                  <div className="hint hint-top" role="status">
                    Click the ad’s button to close it, even if it says “Add to Chrome” or “OK”. Here it can’t open
                    anything.
                    <button className="hint-action" onClick={() => setReach(null)}>
                      Done
                    </button>
                  </div>
                )}
                {media && !sync.hasTime && (
                  <div className="screen-note" role="status">
                    {media.backdrop && <img className="screen-backdrop" src={media.backdrop} alt="" />}
                    <span>Finding a stream…</span>
                  </div>
                )}
                {subs.cues && (
                  <Captions
                    cues={subs.cues}
                    bridge={bridge}
                    delay={subs.delay}
                    size={subs.size}
                    raised={fullscreen && !idle}
                  />
                )}
                {sync.maybeBlocked && reach === null ? (
                  <div className="hint hint-actionable" role="status">
                    Not starting? Your browser may be blocking autoplay.
                    <button className="hint-action" onClick={() => setReach('play')}>
                      Press play in the player
                    </button>
                  </div>
                ) : otherCut ? (
                  <div className="hint hint-actionable" role="status">
                    You and {otherCut.name} are watching different versions ({formatTime(sync.duration)} here,{' '}
                    {formatTime(otherCut.duration!)} for them), so you can’t stay in step. Pick a server other than
                    Auto in the server menu.
                  </div>
                ) : (
                  cutCheck.state !== 'ok' &&
                  cutNoteHidden !== cutNoteKey &&
                  !showUpNext && (
                    <div className="hint hint-actionable hint-cut">
                      <CutNote
                        cut={cutCheck}
                        onFindServer={findMatchingServer}
                        onHide={() => setCutNoteHidden(cutNoteKey)}
                      />
                    </div>
                  )
                )}
                {showUpNext && upNext && (
                  <UpNext
                    next={upNext}
                    secondsLeft={secondsLeft}
                    onPlay={() => api.load(upNext.media)}
                    onCancel={secondsLeft != null ? api.cancelUpNext : undefined}
                    onDismiss={secondsLeft == null ? () => setUpNextHidden(mediaKey) : undefined}
                  />
                )}
                {episodesOpen && media?.type === 'tv' && (
                  <EpisodePanel media={media} onPick={pickEpisode} onClose={closeEpisodes} />
                )}
                <div ref={probeHost} className="probes" aria-hidden="true" />
                {reach === 'play' && (
                  <div className="hint hint-top" role="status">
                    Click the play button in the middle of the video once. After that, PlayPen takes over again.
                    <button className="hint-action" onClick={() => setReach(null)}>
                      Done
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Empty
                partnerHere={onlineOthers.length > 0}
                partnerName={onlineOthers[0]?.name}
                onChoose={openBrowse}
                onInvite={invite}
                copied={copied}
              />
            )}

            <ol className="toasts" aria-live="polite">
              {toasts.map((t) => (
                <li key={t.id} className="toast">
                  {t.text}
                </li>
              ))}
            </ol>
          </div>

          {media && (
            <TogetherBar
              playing={playing}
              position={position}
              duration={sync.duration}
              playheads={playheads}
              onToggle={togglePlay}
              onSeek={seek}
              onSeekBy={seekBy}
              volume={volume}
              onVolume={changeVolume}
              fullscreen={fullscreen}
              onFullscreen={toggleFullscreen}
              onNext={media.type === 'tv' && upNext ? next : undefined}
              onEpisodes={media.type === 'tv' ? () => setEpisodesOpen((o) => !o) : undefined}
              episodesOpen={episodesOpen}
              providers={providers}
              provider={provider}
              onProvider={(id) => api.setProvider(id, providers.find((p) => p.id === id)?.name ?? 'the automatic server')}
              subtitles={<SubtitleMenu subs={subs} cut={cutCheck} onFindServer={findMatchingServer} />}
              apart={apart}
            />
          )}
        </div>
        {chat.enabled && chatOpen && <Chat chat={chat} colorFor={(d) => personColor(hueOf(d))} onClose={toggleChat} />}
      </div>

    </div>
  )
}

function extrapolate(m: Member, now: number): number | null {
  if (m.position == null) return null
  return m.status === 'playing' ? m.position + Math.max(0, now - m.reportedAt) / 1000 : m.position
}

function statusText(m: Member, status: Member['status']) {
  if (!m.online) return 'away'
  return { loading: 'loading', playing: 'watching', paused: 'paused', buffering: 'buffering', idle: 'here' }[status]
}

function Empty(p: {
  partnerHere: boolean
  partnerName?: string
  onChoose: () => void
  onInvite: () => void
  copied: boolean
}) {
  return (
    <div className="empty">
      <div className="empty-orbs" aria-hidden="true">
        <span className="orb orb-you" />
        <span className={`orb orb-them${p.partnerHere ? '' : ' orb-waiting'}`} />
      </div>
      {p.partnerHere ? (
        <>
          <h2 className="empty-title">You and {p.partnerName} are both here</h2>
          <p className="empty-text">
            Pick a film or an episode. It opens on both screens, paused, until someone presses play.
          </p>
          <button className="btn btn-primary" onClick={p.onChoose}>
            <Icon name="search" size={18} />
            Choose something to watch
          </button>
        </>
      ) : (
        <>
          <h2 className="empty-title">Waiting for your person</h2>
          <p className="empty-text">
            Send them the invite link. You can pick something now; it’ll be waiting when they arrive.
          </p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={p.onInvite}>
              <Icon name="link" size={18} />
              {p.copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button className="btn" onClick={p.onChoose}>
              Choose something
            </button>
          </div>
        </>
      )}
    </div>
  )
}
