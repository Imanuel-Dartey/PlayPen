import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaRef } from '../../shared/protocol.ts'
import { fetchSubtitleFile, getSubtitleTracks, type SubtitleTrack } from './catalog.ts'
import { decodeSubtitleBytes, parseSubtitles, type Cue } from './subtitles.ts'

// Subtitles are personal: each person picks their own language, size and timing, and
// nothing here is shared with the room.

export type CaptionSize = 's' | 'm' | 'l'

export interface SubtitleOption {
  track: SubtitleTrack
  /** "English", or "English 2" when there's more than one. */
  name: string
}

export type Selection = { kind: 'off' } | { kind: 'track'; url: string } | { kind: 'file'; name: string }

export interface SubtitlesApi {
  options: SubtitleOption[]
  listState: 'loading' | 'ready' | 'error'
  selection: Selection
  cues: Cue[] | null
  loading: boolean
  error: string | null
  size: CaptionSize
  /** Seconds added to every cue's time: positive shows subtitles later. */
  delay: number
  select: (url: string | null) => void
  loadFile: (file: File) => Promise<void>
  toggle: () => void
  setSize: (s: CaptionSize) => void
  nudge: (by: number) => void
}

interface Prefs {
  lang: string | null
  size: CaptionSize
}

const PREFS_KEY = 'playpen:subtitles'

function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { lang: p.lang ?? null, size: p.size === 's' || p.size === 'l' ? p.size : 'm' }
  } catch {
    return { lang: null, size: 'm' }
  }
}

function writePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* not remembered */
  }
}

const delayKey = (m: MediaRef) => `playpen:subDelay:${m.type}:${m.id}${m.type === 'tv' ? `:${m.season}:${m.episode}` : ''}`

function readDelay(m: MediaRef): number {
  try {
    const v = Number(localStorage.getItem(delayKey(m)))
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

let displayNames: Intl.DisplayNames | null = null
export function languageName(code: string): string {
  if (!code || code === 'und') return 'Other language'
  try {
    displayNames ??= new Intl.DisplayNames(undefined, { type: 'language' })
    const name = displayNames.of(code)
    return name ? name[0].toUpperCase() + name.slice(1) : code
  } catch {
    return code
  }
}

/** Same language if the codes match, or failing that, the main part does ("pt" for "pt-br"). */
function pickTrack(tracks: SubtitleTrack[], lang: string): SubtitleTrack | undefined {
  return (
    tracks.find((t) => t.lang === lang && t.isDefault) ??
    tracks.find((t) => t.lang === lang) ??
    tracks.find((t) => t.lang.split('-')[0] === lang.split('-')[0])
  )
}

export function useSubtitles(media: MediaRef | null): SubtitlesApi {
  const [prefs, setPrefs] = useState(readPrefs)
  const [tracks, setTracks] = useState<SubtitleTrack[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selection, setSelection] = useState<Selection>({ kind: 'off' })
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [delay, setDelay] = useState(0)
  const loadToken = useRef(0)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const mediaId = media ? delayKey(media) : null

  const updatePrefs = useCallback((change: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...change }
      writePrefs(next)
      return next
    })
  }, [])

  const loadTrack = useCallback(async (track: SubtitleTrack) => {
    const token = ++loadToken.current
    setSelection({ kind: 'track', url: track.url })
    setCues(null)
    setError(null)
    setLoading(true)
    try {
      const parsed = parseSubtitles(decodeSubtitleBytes(await fetchSubtitleFile(track.url)))
      if (token !== loadToken.current) return
      if (parsed.length === 0) throw new Error('empty')
      setCues(parsed)
    } catch {
      if (token === loadToken.current) setError('These subtitles didn’t load. Try another version.')
    } finally {
      if (token === loadToken.current) setLoading(false)
    }
  }, [])

  // A new title: fetch its list, and turn on the language this person used last time.
  useEffect(() => {
    loadToken.current++
    setTracks([])
    setSelection({ kind: 'off' })
    setCues(null)
    setError(null)
    setLoading(false)
    if (!media) return
    setDelay(readDelay(media))
    setListState('loading')
    const ctrl = new AbortController()
    getSubtitleTracks(media, ctrl.signal)
      .then((list) => {
        setTracks(list)
        setListState('ready')
        const lang = prefsRef.current.lang
        const track = lang ? pickTrack(list, lang) : undefined
        if (track) void loadTrack(track)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setListState('error')
      })
    return () => ctrl.abort()
    // The media's identity is mediaId; the object itself changes on every room update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId, loadTrack])

  const options = useMemo(() => {
    const groups = new Map<string, SubtitleTrack[]>()
    for (const t of tracks) groups.set(t.lang, [...(groups.get(t.lang) ?? []), t])
    const preferred = (prefs.lang ?? navigator.language ?? 'en').toLowerCase()
    const langs = [...groups.keys()].sort((a, b) => {
      const pa = a.split('-')[0] === preferred.split('-')[0] ? 0 : 1
      const pb = b.split('-')[0] === preferred.split('-')[0] ? 0 : 1
      return pa - pb || languageName(a).localeCompare(languageName(b))
    })
    return langs.flatMap((lang) => {
      const list = groups.get(lang)!
      const name = languageName(lang)
      return list.map((track, i) => ({ track, name: list.length > 1 ? `${name} ${i + 1}` : name }))
    })
  }, [tracks, prefs.lang])

  const select = useCallback(
    (url: string | null) => {
      if (!url) {
        loadToken.current++
        setSelection({ kind: 'off' })
        setCues(null)
        setError(null)
        setLoading(false)
        updatePrefs({ lang: null })
        return
      }
      const track = tracks.find((t) => t.url === url)
      if (!track) return
      updatePrefs({ lang: track.lang })
      void loadTrack(track)
    },
    [tracks, loadTrack, updatePrefs],
  )

  const loadFile = useCallback(async (file: File) => {
    const token = ++loadToken.current
    setError(null)
    setLoading(true)
    try {
      const parsed = parseSubtitles(decodeSubtitleBytes(await file.arrayBuffer()))
      if (token !== loadToken.current) return
      if (parsed.length === 0) {
        setError('PlayPen couldn’t find any subtitles in that file. Use an .srt or .vtt file.')
        return
      }
      setSelection({ kind: 'file', name: file.name })
      setCues(parsed)
    } finally {
      if (token === loadToken.current) setLoading(false)
    }
  }, [])

  const toggle = useCallback(() => {
    if (selection.kind !== 'off') return select(null)
    const lang = prefsRef.current.lang ?? navigator.language ?? 'en'
    const track = pickTrack(tracks, lang.toLowerCase()) ?? tracks.find((t) => t.isDefault) ?? tracks[0]
    if (track) select(track.url)
  }, [selection.kind, tracks, select])

  const nudge = useCallback(
    (by: number) => {
      setDelay((d) => {
        const next = Math.round((d + by) * 10) / 10
        if (media) {
          try {
            localStorage.setItem(delayKey(media), String(next))
          } catch {
            /* not remembered */
          }
        }
        return next
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaId],
  )

  return {
    options,
    listState,
    selection,
    cues,
    loading,
    error,
    size: prefs.size,
    delay,
    select,
    loadFile,
    toggle,
    setSize: useCallback((size: CaptionSize) => updatePrefs({ size }), [updatePrefs]),
    nudge,
  }
}
