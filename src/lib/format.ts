import type { MediaRef } from '../../shared/protocol.ts'

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function mediaLabel(media: MediaRef): string {
  if (media.type === 'movie') return media.title
  return `${media.title}, S${media.season} E${media.episode}`
}

/** Person colors, handed out by sorted member id so everyone sees the same color for the same person. */
export const PERSON_COLORS = ['var(--rose)', 'var(--sea)', 'var(--amber)', 'var(--lilac)']
export const personColor = (hue: number) => PERSON_COLORS[hue % PERSON_COLORS.length]

const WORDS = ['moon', 'porch', 'lantern', 'comet', 'harbor', 'meadow', 'ember', 'velvet', 'orchard', 'tide', 'fern', 'dune']

/** Anyone with the code can join, so the random part is long enough not to be guessed. */
export function newRoomCode(): string {
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const tail = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('')
  return `${WORDS[bytes[0] % WORDS.length]}-${tail}`
}

export function readName(): string {
  try {
    return localStorage.getItem('playpen:name') ?? ''
  } catch {
    return ''
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem('playpen:name', name)
  } catch {
    /* private mode: the name just won't be remembered */
  }
}
