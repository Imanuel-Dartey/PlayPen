import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CHAT_BODY_MAX, type ChatMedia, type ChatMessage } from '../../shared/protocol.ts'
import { gifsEnabled } from '../lib/klipy.ts'
import type { ChatApi } from '../lib/useChat.ts'
import { Icon } from './Icon.tsx'
import { GifPicker } from './GifPicker.tsx'

// Messages from the same person this close together share one name label.
const GROUP_GAP_MS = 3 * 60 * 1000

interface Props {
  chat: ChatApi
  colorFor: (device: string) => string
  onClose: () => void
}

export function Chat({ chat, colorFor, onClose }: Props) {
  const logRef = useRef<HTMLOListElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [gifOpen, setGifOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [unseenBelow, setUnseenBelow] = useState(false)
  const [lightbox, setLightbox] = useState<ChatMedia | null>(null)
  const [dragging, setDragging] = useState(false)
  const prevCount = useRef(0)
  const prevScrollHeight = useRef(0)
  const loadingOlder = useRef(false)

  // Stick to the bottom as messages arrive, unless they've scrolled up to read.
  useLayoutEffect(() => {
    const log = logRef.current
    if (!log) return
    const added = chat.messages.length - prevCount.current
    prevCount.current = chat.messages.length
    if (loadingOlder.current) {
      // Older messages went in above: keep what they were reading in place.
      log.scrollTop += log.scrollHeight - prevScrollHeight.current
      loadingOlder.current = false
      return
    }
    if (added <= 0) return
    const last = chat.messages[chat.messages.length - 1]
    if (atBottom || last?.device === chat.device) {
      log.scrollTop = log.scrollHeight
    } else {
      setUnseenBelow(true)
    }
  }, [chat.messages, chat.device, atBottom])

  useEffect(() => {
    if (atBottom) setUnseenBelow(false)
  }, [atBottom])

  const scrollToEnd = () => logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })

  const olderMessages = async () => {
    const log = logRef.current
    if (!log) return
    loadingOlder.current = true
    prevScrollHeight.current = log.scrollHeight
    try {
      await chat.loadOlder()
    } catch {
      loadingOlder.current = false
      setError('Couldn’t load earlier messages. Try again.')
    }
  }

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    chat.sendText(text)
    setText('')
    inputRef.current?.focus()
  }

  const sendFiles = async (files: FileList | File[] | null) => {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (list.length === 0) return
    setError(null)
    for (const f of list.slice(0, 6)) {
      try {
        await chat.sendImage(f)
      } catch (err) {
        setError((err as Error).message || 'That photo couldn’t be sent.')
      }
    }
  }

  return (
    <section
      className={`chat${dragging ? ' chat-drop' : ''}`}
      aria-label="Chat"
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void sendFiles(e.dataTransfer.files)
      }}
    >
      <header className="chat-head">
        <h2 className="chat-title">Chat</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Hide chat">
          <Icon name="close" size={18} />
        </button>
      </header>

      <ol
        ref={logRef}
        className="chat-log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
        }}
      >
        {chat.hasMore && (
          <li className="chat-more">
            <button className="link-btn" onClick={olderMessages}>
              Show earlier messages
            </button>
          </li>
        )}
        {chat.loadError && <li className="chat-note">{chat.loadError}</li>}
        {chat.messages.length === 0 && !chat.loadError && (
          <li className="chat-note">
            Nothing here yet. Messages, GIFs and photos stay in this room, so you can scroll back next time.
          </li>
        )}
        {chat.messages.map((m, i) => {
          const prev = chat.messages[i - 1]
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at)
          const first = newDay || prev.device !== m.device || m.at - prev.at > GROUP_GAP_MS
          const mine = m.device === chat.device
          return (
            <Fragment key={m.id}>
              {newDay && (
                <li className="chat-day" aria-hidden="true">
                  {dayLabel(m.at)}
                </li>
              )}
              <Message
                m={m}
                mine={mine}
                first={first}
                color={colorFor(m.device)}
                delivery={chat.delivery[m.id]}
                onRetry={() => chat.retry(m.id)}
                onOpen={setLightbox}
              />
            </Fragment>
          )
        })}
        {Array.from({ length: chat.uploading }, (_, i) => (
          <li key={`up-${i}`} className="msg msg-mine">
            <span className="msg-uploading">Sending photo…</span>
          </li>
        ))}
      </ol>

      {unseenBelow && (
        <button className="chat-jump" onClick={scrollToEnd}>
          New messages
        </button>
      )}

      <p className="chat-typing" aria-live="polite">
        {chat.typing.length > 0 && `${chat.typing.join(' and ')} ${chat.typing.length > 1 ? 'are' : 'is'} typing…`}
      </p>

      {error && (
        <p className="chat-error" role="alert">
          {error}
          <button className="link-btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      {gifOpen && (
        <GifPicker
          customerId={chat.device}
          onClose={() => setGifOpen(false)}
          onPick={(media) => {
            chat.sendGif(media)
            setGifOpen(false)
            inputRef.current?.focus()
          }}
        />
      )}

      <form className="composer" onSubmit={submit}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            void sendFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Send a photo">
          <Icon name="image" size={20} />
        </button>
        {gifsEnabled && (
          <button
            type="button"
            className="gif-toggle"
            data-gif-toggle
            aria-pressed={gifOpen}
            onClick={() => setGifOpen((o) => !o)}
          >
            GIF
          </button>
        )}
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={1}
          value={text}
          maxLength={CHAT_BODY_MAX}
          placeholder="Message"
          aria-label="Message"
          onChange={(e) => {
            setText(e.target.value)
            if (e.target.value) chat.notifyTyping()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length) {
              e.preventDefault()
              void sendFiles(files)
            }
          }}
        />
        <button type="submit" className="icon-btn send-btn" disabled={!text.trim()} aria-label="Send">
          <Icon name="send" size={20} />
        </button>
      </form>

      {dragging && <div className="chat-drop-note">Drop to send</div>}
      {lightbox && <Lightbox media={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  )
}

function Message(p: {
  m: ChatMessage
  mine: boolean
  first: boolean
  color: string
  delivery?: 'sending' | 'failed'
  onRetry: () => void
  onOpen: (m: ChatMedia) => void
}) {
  const { m } = p
  return (
    <li
      className={`msg${p.mine ? ' msg-mine' : ''}${p.first ? ' msg-first' : ''}`}
      style={{ '--c': p.color } as React.CSSProperties}
    >
      {p.first && (
        <span className="msg-meta">
          {!p.mine && <span className="msg-author">{m.author}</span>}
          <time dateTime={new Date(m.at).toISOString()}>{timeLabel(m.at)}</time>
        </span>
      )}
      {m.kind === 'text' && <p className="bubble">{linkify(m.body ?? '')}</p>}
      {m.kind !== 'text' && m.media && (
        <button
          className="msg-media"
          onClick={() => m.kind === 'image' && p.onOpen(m.media!)}
          aria-label={m.kind === 'image' ? `Photo from ${m.author}, open larger` : `GIF from ${m.author}`}
          style={{ aspectRatio: `${m.media.width} / ${m.media.height}` }}
          tabIndex={m.kind === 'image' ? 0 : -1}
        >
          {m.kind === 'gif' && m.media.mp4 ? (
            <video src={m.media.mp4} autoPlay loop muted playsInline aria-hidden="true" />
          ) : (
            <img src={m.media.url} alt="" loading="lazy" />
          )}
        </button>
      )}
      {p.delivery === 'sending' && <span className="msg-status">Sending…</span>}
      {p.delivery === 'failed' && (
        <span className="msg-status msg-failed">
          Not sent.{' '}
          <button className="link-btn" onClick={p.onRetry}>
            Try again
          </button>
        </span>
      )}
    </li>
  )
}

function Lightbox({ media, onClose }: { media: ChatMedia; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <img src={media.url} alt="" />
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <a className="btn" href={media.url} target="_blank" rel="noreferrer">
          Open original
        </a>
        <button className="btn btn-primary" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
    </div>
  )
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]']/g

function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const i = match.index!
    if (i > last) out.push(text.slice(last, i))
    out.push(
      <a key={i} href={match[0]} target="_blank" rel="noreferrer noopener">
        {match[0]}
      </a>,
    )
    last = i + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const dayKey = (t: number) => new Date(t).toDateString()

function dayLabel(t: number) {
  const d = new Date(t)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
