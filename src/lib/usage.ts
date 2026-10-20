// Active-user counts for the /stats page (see "active users" in supabase/setup.sql).
//
// While PlayPen is open, this browser is marked active for the day, whether or not anything
// is playing. All that's sent is the browser's random device id. Only the live site counts:
// local development, automated browsers, and browsers switched off on the stats page are
// left out.

import { useEffect } from 'react'
import { supabase } from './supabase.ts'
import { deviceId } from './useRoom.ts'

const OPT_OUT_KEY = 'playpen:notCounted'
// The database keeps one row per browser per day, so this only needs to be often enough to
// catch a tab that stays open past midnight.
const RECHECK_MS = 30 * 60_000

export function isCounted(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== '1'
  } catch {
    return true
  }
}

export function setCounted(on: boolean) {
  try {
    if (on) localStorage.removeItem(OPT_OUT_KEY)
    else localStorage.setItem(OPT_OUT_KEY, '1')
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

const liveSite =
  import.meta.env.PROD && !navigator.webdriver && !/^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname)

function markActive() {
  if (!supabase || !liveSite || !isCounted()) return
  // Counting must never get in the way of using the app, so failures are ignored.
  void supabase.rpc('track_active', { p_device: deviceId() }).then(
    () => {},
    () => {},
  )
}

/** Marks this browser active today while the app is open. */
export function useActiveUser() {
  useEffect(() => {
    markActive()
    const id = window.setInterval(markActive, RECHECK_MS)
    return () => clearInterval(id)
  }, [])
}

export interface ActiveUsers {
  since: string | null
  total: number
  today: number
  week: number
  month: number
  returning: number
  daily: { day: string; users: number }[]
}

export class StatsUnavailable extends Error {}

export async function loadActiveUsers(): Promise<ActiveUsers> {
  if (!supabase) throw new StatsUnavailable('Stats need Supabase. Add the keys from the README and reload.')
  const { data, error } = await supabase.rpc('active_users')
  if (error) {
    // PGRST202: the function doesn't exist yet.
    if (error.code === 'PGRST202')
      throw new StatsUnavailable(
        'Active users aren’t set up yet. Run supabase/setup.sql again in the Supabase SQL editor, then reload.',
      )
    throw new Error(error.message)
  }
  return data as ActiveUsers
}
