// Where chat history and photos are kept.
//
// With Supabase: messages in the `messages` table, photos in the `chat-media` bucket
// (see supabase/setup.sql). Every request names its room in an `x-room` header, which
// is what the row-level security rules check.
//
// In local test mode: this browser's localStorage, with photos inlined as data URLs.

import type { ChatMedia, ChatMessage } from '../../shared/protocol.ts'
import { supabase } from './supabase.ts'
import { transportKind } from './transport.ts'

export interface ChatStore {
  /** Newest `limit` messages (older than `before`, if given), oldest first. */
  load: (room: string, opts?: { before?: number; limit?: number }) => Promise<ChatMessage[]>
  save: (room: string, msg: ChatMessage) => Promise<void>
  /** Stores a photo and returns the link to show it with. */
  upload: (room: string, file: Blob, ext: string) => Promise<string>
}

export const PAGE_SIZE = 60

interface Row {
  id: string
  device: string
  author: string
  kind: ChatMessage['kind']
  body: string | null
  media: ChatMedia | null
  created_at: string
}

const supabaseStore: ChatStore = {
  async load(room, { before, limit = PAGE_SIZE } = {}) {
    let q = supabase!
      .from('messages')
      .select('id, device, author, kind, body, media, created_at')
      .eq('room', room)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (before) q = q.lt('created_at', new Date(before).toISOString())
    const { data, error } = await q.setHeader('x-room', room)
    if (error) throw new Error(error.message)
    return (data as Row[])
      .map((r) => ({
        id: r.id,
        device: r.device,
        author: r.author,
        kind: r.kind,
        body: r.body,
        media: r.media,
        at: Date.parse(r.created_at),
      }))
      .reverse()
  },

  async save(room, msg) {
    const { error } = await supabase!
      .from('messages')
      .insert({
        id: msg.id,
        room,
        device: msg.device,
        author: msg.author,
        kind: msg.kind,
        body: msg.body,
        media: msg.media,
      })
      .setHeader('x-room', room)
    // A retry of a message that did reach the table is fine.
    if (error && error.code !== '23505') throw new Error(error.message)
  },

  async upload(room, file, ext) {
    const bucket = supabase!.storage.from('chat-media')
    const path = `${room}/${crypto.randomUUID()}.${ext}`
    const { error } = await bucket.upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
      upsert: false,
    })
    if (error) throw new Error(error.message)
    return bucket.getPublicUrl(path).data.publicUrl
  },
}

const localKey = (room: string) => `playpen:chat:${room}`

function readLocal(room: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(localKey(room)) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

const localStore: ChatStore = {
  async load(room, { before, limit = PAGE_SIZE } = {}) {
    const all = readLocal(room).filter((m) => !before || m.at < before)
    return all.slice(-limit)
  },
  async save(room, msg) {
    const all = readLocal(room).filter((m) => m.id !== msg.id)
    all.push(msg)
    all.sort((a, b) => a.at - b.at)
    try {
      localStorage.setItem(localKey(room), JSON.stringify(all.slice(-300)))
    } catch {
      /* storage full: the message still went out live */
    }
  },
  async upload(_room, file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('Could not read that photo.'))
      r.readAsDataURL(file)
    })
  },
}

export const chatStore: ChatStore | null =
  transportKind === 'supabase' ? supabaseStore : transportKind === 'local' ? localStore : null
