import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_BODY_MAX, type ChatMedia, type ChatMessage } from '../../shared/protocol.ts'
import { PAGE_SIZE, chatStore } from './chatStore.ts'
import { prepareImage } from './images.ts'
import { deviceId, type RoomApi } from './useRoom.ts'

export type Delivery = 'sending' | 'failed'

export interface ChatApi {
  enabled: boolean
  device: string
  messages: ChatMessage[]
  /** Our own messages that haven't been saved yet. Absent means delivered. */
  delivery: Record<string, Delivery>
  /** Photos still being prepared or uploaded, shown as placeholders. */
  uploading: number
  loadError: string | null
  hasMore: boolean
  loadOlder: () => Promise<void>
  typing: string[]
  sendText: (text: string) => void
  sendGif: (media: ChatMedia) => void
  sendImage: (file: File) => Promise<void>
  retry: (id: string) => void
  notifyTyping: () => void
  /** Called with each message someone else sends, as it arrives. */
  onIncoming: (fn: (m: ChatMessage) => void) => () => void
}

const TYPING_SHOW_MS = 4000
const TYPING_SEND_EVERY_MS = 2500

function merge(list: ChatMessage[], add: ChatMessage[]): ChatMessage[] {
  const byId = new Map(list.map((m) => [m.id, m]))
  for (const m of add) byId.set(m.id, { ...byId.get(m.id), ...m })
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

export function useChat(api: RoomApi, room: string, name: string): ChatApi {
  const device = useRef(deviceId()).current
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({})
  const [uploading, setUploading] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [typingMap, setTypingMap] = useState<Record<string, { name: string; until: number }>>({})
  const listeners = useRef(new Set<(m: ChatMessage) => void>())
  const outbox = useRef(new Map<string, ChatMessage>())
  const lastTypingSent = useRef(0)
  const { sendPeer, onPeer, openCount } = api

  // History: on first connect, and again after any reconnect to pick up what we missed.
  useEffect(() => {
    if (!chatStore || openCount === 0) return
    let cancelled = false
    chatStore
      .load(room)
      .then((list) => {
        if (cancelled) return
        setMessages((cur) => merge(cur, list))
        setHasMore((h) => h || list.length >= PAGE_SIZE)
        setLoadError(null)
      })
      .catch(() => !cancelled && setLoadError('Couldn’t load earlier messages. New ones still arrive.'))
    return () => {
      cancelled = true
    }
  }, [room, openCount])

  useEffect(
    () =>
      onPeer((msg) => {
        if (msg.t === 'chat') {
          setMessages((cur) => merge(cur, [msg.msg]))
          // Their message ends their typing indicator.
          setTypingMap(({ [msg.msg.device]: _, ...rest }) => rest)
          if (msg.msg.device !== device) for (const fn of listeners.current) fn(msg.msg)
        } else if (msg.t === 'typing' && msg.device !== device) {
          setTypingMap((cur) => ({ ...cur, [msg.device]: { name: msg.name, until: Date.now() + TYPING_SHOW_MS } }))
        }
      }),
    [onPeer, device],
  )

  // Let typing indicators lapse.
  useEffect(() => {
    if (Object.keys(typingMap).length === 0) return
    const t = setTimeout(() => {
      const now = Date.now()
      setTypingMap((cur) => Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now)))
    }, 1000)
    return () => clearTimeout(t)
  }, [typingMap])

  const deliver = useCallback(
    async (msg: ChatMessage) => {
      setDelivery((d) => ({ ...d, [msg.id]: 'sending' }))
      try {
        await chatStore!.save(room, msg)
        // Only announce it once it's saved, so everyone's history agrees.
        sendPeer({ t: 'chat', msg })
        outbox.current.delete(msg.id)
        setDelivery(({ [msg.id]: _, ...rest }) => rest)
      } catch {
        setDelivery((d) => ({ ...d, [msg.id]: 'failed' }))
      }
    },
    [room, sendPeer],
  )

  const post = useCallback(
    (kind: ChatMessage['kind'], body: string | null, media: ChatMedia | null) => {
      if (!chatStore) return
      const msg: ChatMessage = { id: crypto.randomUUID(), device, author: name, kind, body, media, at: Date.now() }
      outbox.current.set(msg.id, msg)
      setMessages((cur) => merge(cur, [msg]))
      lastTypingSent.current = 0
      void deliver(msg)
    },
    [device, name, deliver],
  )

  return {
    enabled: !!chatStore,
    device,
    messages,
    delivery,
    uploading,
    loadError,
    hasMore,
    typing: Object.values(typingMap).map((t) => t.name),
    loadOlder: useCallback(async () => {
      if (!chatStore) return
      const oldest = messages.find((m) => !outbox.current.has(m.id))?.at
      const list = await chatStore.load(room, { before: oldest })
      setMessages((cur) => merge(cur, list))
      setHasMore(list.length >= PAGE_SIZE)
    }, [messages, room]),
    sendText: useCallback(
      (text: string) => {
        const body = text.trim().slice(0, CHAT_BODY_MAX)
        if (body) post('text', body, null)
      },
      [post],
    ),
    sendGif: useCallback((media: ChatMedia) => post('gif', null, media), [post]),
    sendImage: useCallback(
      async (file: File) => {
        if (!chatStore) return
        setUploading((n) => n + 1)
        try {
          const img = await prepareImage(file)
          const url = await chatStore.upload(room, img.blob, img.ext)
          post('image', null, { url, width: img.width, height: img.height })
        } finally {
          setUploading((n) => n - 1)
        }
      },
      [post, room],
    ),
    retry: useCallback(
      (id: string) => {
        const msg = outbox.current.get(id)
        if (msg) void deliver(msg)
      },
      [deliver],
    ),
    notifyTyping: useCallback(() => {
      const now = Date.now()
      if (now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return
      lastTypingSent.current = now
      sendPeer({ t: 'typing', device, name })
    }, [sendPeer, device, name]),
    onIncoming: useCallback((fn: (m: ChatMessage) => void) => {
      listeners.current.add(fn)
      return () => {
        listeners.current.delete(fn)
      }
    }, []),
  }
}
