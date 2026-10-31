import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, onUnauthorized, setToken } from './api'
import type { Meta, Profile, Reminder } from './types'

interface Session {
  profile: Profile | null
  meta: Meta | null
  favoriteIds: Set<string>
  reminders: Reminder[]
  ready: boolean
  signIn: (token: string, profile: Profile) => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  refreshMeta: () => Promise<void>
  toggleFavorite: (channelId: string) => Promise<void>
  refreshReminders: () => Promise<void>
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [ready, setReady] = useState(false)

  const loadProfileData = useCallback(async () => {
    const [m, favs, rem] = await Promise.all([api.meta(), api.favorites(), api.reminders()])
    setMeta(m)
    setFavoriteIds(new Set(favs.map((f) => f.id)))
    setReminders(rem)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (getToken()) {
        try {
          const p = await api.me()
          if (cancelled) return
          setProfile(p)
          await loadProfileData()
        } catch {
          setToken(null)
        }
      }
      if (!cancelled) setReady(true)
    }
    boot()
    return () => { cancelled = true }
  }, [loadProfileData])

  useEffect(() => onUnauthorized(() => {
    setToken(null)
    setProfile(null)
  }), [])

  const signIn = useCallback((token: string, p: Profile) => {
    setToken(token)
    setProfile(p)
    loadProfileData().catch(() => undefined)
  }, [loadProfileData])

  const signOut = useCallback(async () => {
    try { await api.closeSession() } catch { /* already gone */ }
    setToken(null)
    setProfile(null)
    setMeta(null)
    setFavoriteIds(new Set())
    setReminders([])
  }, [])

  const refreshProfile = useCallback(async () => { setProfile(await api.me()) }, [])
  const refreshMeta = useCallback(async () => { setMeta(await api.meta()) }, [])
  const refreshReminders = useCallback(async () => { setReminders(await api.reminders()) }, [])

  const toggleFavorite = useCallback(async (channelId: string) => {
    const isFav = favoriteIds.has(channelId)
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (isFav) next.delete(channelId)
      else next.add(channelId)
      return next
    })
    try {
      if (isFav) await api.removeFavorite(channelId)
      else await api.addFavorite(channelId)
    } catch (e) {
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(channelId)
        else next.delete(channelId)
        return next
      })
      throw e
    }
  }, [favoriteIds])

  const value = useMemo<Session>(() => ({
    profile, meta, favoriteIds, reminders, ready, signIn, signOut, refreshProfile, refreshMeta,
    toggleFavorite, refreshReminders,
  }), [profile, meta, favoriteIds, reminders, ready, signIn, signOut, refreshProfile, refreshMeta,
    toggleFavorite, refreshReminders])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}

/** Current unix time, refreshed on an interval so progress bars move. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
