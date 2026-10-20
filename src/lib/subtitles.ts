// Parsing and timing for subtitle files. One parser handles both SRT and WebVTT: it
// looks for timing lines ("00:01:59,455 --> 00:02:02,447") and takes the text under each.

export interface Span {
  text: string
  italic?: boolean
  bold?: boolean
}

export interface Cue {
  id: number
  start: number
  end: number
  /** One entry per line of text. */
  lines: Span[][]
  /** The file asked for this cue at the top of the picture ({\an8} and friends). */
  top: boolean
  /** Latest end time of this cue and every cue before it; lets lookups stop scanning early. */
  maxEnd: number
}

const TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})`
const TIMING_LINE = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}`)

const seconds = (h: string | undefined, m: string, s: string, ms: string) =>
  Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000

/** Decodes a subtitle file: UTF-8 if it is valid UTF-8, otherwise the usual Windows encoding. */
export function decodeSubtitleBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export function parseSubtitles(raw: string): Cue[] {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
  const cues: Cue[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = TIMING_LINE.exec(lines[i])
    if (!m) continue
    const start = seconds(m[1], m[2], m[3], m[4])
    const end = seconds(m[5], m[6], m[7], m[8])
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1].trim() !== '' && !TIMING_LINE.test(lines[i + 1])) {
      text.push(lines[++i])
    }
    if (end <= start || text.length === 0) continue
    const joined = text.join('\n')
    const top = /\{\\an[789]\}/.test(joined)
    const parsed = toSpans(joined)
    if (parsed.some((line) => line.some((s) => s.text.trim()))) {
      cues.push({ id: cues.length, start, end, lines: parsed, top, maxEnd: end })
    }
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end)
  let maxEnd = 0
  cues.forEach((c, i) => {
    c.id = i
    maxEnd = Math.max(maxEnd, c.end)
    c.maxEnd = maxEnd
  })
  return cues
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

/** Keeps italic and bold, drops every other tag and the ASS-style {\…} overrides some SRTs carry. */
function toSpans(text: string): Span[][] {
  const clean = text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<(?!\/?[ib]>)[^>]*>/gi, '')
    .replace(/&(#\d+|[a-z]+);/gi, (all, name: string) =>
      name.startsWith('#') ? String.fromCharCode(Number(name.slice(1))) : (ENTITIES[name.toLowerCase()] ?? all),
    )
  return clean.split('\n').map((line) => {
    const spans: Span[] = []
    let italic = false
    let bold = false
    for (const part of line.split(/(<\/?[ib]>)/i)) {
      const tag = part.toLowerCase()
      if (tag === '<i>') italic = true
      else if (tag === '</i>') italic = false
      else if (tag === '<b>') bold = true
      else if (tag === '</b>') bold = false
      else if (part) spans.push({ text: part, italic, bold })
    }
    return spans
  })
}

/** The cues showing at time `t`, earliest first. */
export function activeCues(cues: Cue[], t: number): Cue[] {
  let lo = 0
  let hi = cues.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) lo = mid + 1
    else hi = mid
  }
  const out: Cue[] = []
  // Walk back through cues that started earlier; once nothing up to here ends after `t`,
  // no earlier cue can still be showing.
  for (let i = lo - 1; i >= 0 && cues[i].maxEnd > t; i--) {
    if (cues[i].end > t) out.unshift(cues[i])
  }
  return out
}

/** When the last line of dialogue ends. */
export const lastLineEnd = (cues: Cue[]) => cues[cues.length - 1]?.maxEnd ?? 0

/**
 * Whether subtitles ending at `lastLine` were made for a stream this long. Some servers
 * carry a different cut of the same episode (an extended one, or one with scenes trimmed),
 * and no single delay can line subtitles up with that. After the last line there are only
 * the closing credits, so a stream much longer than that, or shorter, is another cut.
 */
export function fitsStream(lastLine: number, duration: number): boolean {
  if (!lastLine || !duration) return true
  return lastLine <= duration + 5 && duration - lastLine <= Math.max(150, duration * 0.15)
}
