import { useEffect, useState } from 'react'
import type { Assignment, FeedEvent, Guess, Packet, Page, ReviewItem, Student } from '../../shared/types'

export type { Assignment, Guess, Packet, Page, ReviewItem, Student }

export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText)
  return r.json()
}
export async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? r.statusText)
  return data
}

// Fetches once and again whenever `bump` changes or a live event arrives.
export function useFetch<T>(url: string | null, bump = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tick = useLive()
  useEffect(() => {
    if (!url) return
    let alive = true
    get<T>(url)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [url, bump, tick])
  return { data, error, reload: () => setData((d) => d) }
}

// One shared event source; every subscriber re-renders on each server event.
let source: EventSource | null = null
const listeners = new Set<(ev: FeedEvent) => void>()
function ensureSource() {
  if (source) return
  source = new EventSource('/api/events')
  source.onmessage = (m) => {
    const ev = JSON.parse(m.data) as FeedEvent
    for (const l of listeners) l(ev)
  }
}
export function useLive() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    ensureSource()
    const l = (ev: FeedEvent) => {
      if (ev.type !== 'hello') setTick((t) => t + 1)
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return tick
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
export function ago(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} days`
}
export function relDay(iso: string | null) {
  if (!iso) return 'never'
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return `${diff} days ago`
  if (diff < 14) return 'Last week'
  return fmtDate(iso)
}
export function sideLabel(page: number | null, side: string | null) {
  if (page == null || !side) return '?'
  return `${page} ${side === 'a' ? 'front' : 'back'}`
}
export function fileUrl(rel: string | null) {
  return rel ? `/files/${rel}` : ''
}
