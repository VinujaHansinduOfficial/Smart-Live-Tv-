import {
  Bell,
  BellRing,
  CalendarDays,
  Clapperboard,
  Film,
  History,
  Search as SearchIcon,
  Tv,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import ProgrammeModal from '../components/ProgrammeModal'
import { Button, ChannelLogo, Chip, Empty, LiveBadge, ProgressBar, Spinner } from '../components/ui'
import { fmtDay, fmtRange, fmtRelative } from '../lib/time'
import { useNow, useSession } from '../session'
import type { Channel, ProgrammeHit, VodItem } from '../types'
import { ChannelRow } from './Watch'

type Tab = 'channels' | 'programmes' | 'catchup' | 'vod'
type When = 'now' | 'upcoming' | 'any'

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

const selectCls =
  'rounded-lg bg-ink-700 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent text-white'

export default function Search() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const now = useNow(30_000)
  const { meta, reminders } = useSession()
  const q = params.get('q') ?? ''
  const tab = (params.get('tab') as Tab) || 'channels'
  const favorites = params.get('favorites') === '1'
  const [country, setCountry] = useState('')
  const [language, setLanguage] = useState('')
  const [category, setCategory] = useState('')
  const [when, setWhen] = useState<When>('any')

  const [channels, setChannels] = useState<{ items: Channel[]; total: number } | null>(null)
  const [progs, setProgs] = useState<{ items: ProgrammeHit[]; total: number } | null>(null)
  const [catchupProgs, setCatchupProgs] = useState<{ items: ProgrammeHit[]; total: number } | null>(
    null
  )
  const [vodResults, setVodResults] = useState<{ items: VodItem[]; total: number } | null>(null)
  const [selected, setSelected] = useState<ProgrammeHit | null>(null)

  const dq = useDebounced(q)
  const reminded = useMemo(
    () => new Set(reminders.map((r) => `${r.channel_id}|${r.start}`)),
    [reminders]
  )

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  // 1. Search channels
  useEffect(() => {
    if (tab !== 'channels') return
    let alive = true
    setChannels(null)
    api
      .channels({ q: dq, country, language, category, favorites, limit: 80 })
      .then((r) => {
        if (alive) setChannels(r)
      })
      .catch(() => {
        if (alive) setChannels({ items: [], total: 0 })
      })
    return () => {
      alive = false
    }
  }, [tab, dq, country, language, category, favorites])

  // 2. Search programmes (current & upcoming 24h)
  useEffect(() => {
    if (tab !== 'programmes') return
    let alive = true
    setProgs(null)
    api
      .searchProgrammes({ q: dq, when, category, country, language, hours: 24, limit: 80 })
      .then((r) => {
        if (alive) setProgs(r)
      })
      .catch(() => {
        if (alive) setProgs({ items: [], total: 0 })
      })
    return () => {
      alive = false
    }
  }, [tab, dq, when, category, country, language])

  // 3. Search 14-day catchup archives
  useEffect(() => {
    if (tab !== 'catchup') return
    let alive = true
    setCatchupProgs(null)
    api
      .searchProgrammes({ q: dq, when: 'any', category, country, language, hours: 336, limit: 80 })
      .then((r) => {
        if (alive) setCatchupProgs(r)
      })
      .catch(() => {
        if (alive) setCatchupProgs({ items: [], total: 0 })
      })
    return () => {
      alive = false
    }
  }, [tab, dq, category, country, language])

  // 4. Search VOD (Movies & Series)
  useEffect(() => {
    if (tab !== 'vod') return
    let alive = true
    setVodResults(null)
    Promise.all([api.vodMovies({ q: dq, limit: 40 }), api.vodSeries({ q: dq, limit: 40 })])
      .then(([mRes, sRes]) => {
        if (alive) {
          const combined = [...mRes.items, ...sRes.items]
          setVodResults({ items: combined, total: mRes.total + sRes.total })
        }
      })
      .catch(() => {
        if (alive) setVodResults({ items: [], total: 0 })
      })
    return () => {
      alive = false
    }
  }, [tab, dq])

  const noGuide = meta && meta.epg.programmes === 0

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Universal Search Input */}
      <div className="relative">
        <SearchIcon
          size={18}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
        />
        <input
          autoFocus
          value={q}
          onChange={(e) => setParam('q', e.target.value || null)}
          placeholder={
            tab === 'channels'
              ? 'Channel name, network, language, or country...'
              : tab === 'programmes'
              ? 'Live or upcoming show title, sports team, genre...'
              : tab === 'catchup'
              ? 'Past broadcast titles from 14-day replay archive...'
              : 'Movie or TV series title, synopsis, genre...'
          }
          className="w-full rounded-2xl bg-ink-800 py-3.5 pl-10 pr-3 text-sm outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent text-white"
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-ink-800 p-1 border border-white/5">
          {(
            [
              { id: 'channels', label: 'Channels', icon: Tv },
              { id: 'programmes', label: 'TV Guide', icon: CalendarDays },
              { id: 'catchup', label: '14-Day Replay', icon: History },
              { id: 'vod', label: 'VOD (Movies & Series)', icon: Film },
            ] as const
          ).map((t) => {
            const Icon = t.icon
            const isSel = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setParam('tab', t.id === 'channels' ? null : t.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isSel ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {tab === 'programmes' && (
          <div className="flex items-center gap-1.5">
            {(['any', 'now', 'upcoming'] as When[]).map((w) => (
              <Chip key={w} active={when === w} onClick={() => setWhen(w)}>
                {w === 'any' ? 'Next 24 h' : w === 'now' ? 'On now' : 'Starting later'}
              </Chip>
            ))}
          </div>
        )}

        {tab === 'channels' && (
          <Chip active={favorites} onClick={() => setParam('favorites', favorites ? null : '1')}>
            Favourites only
          </Chip>
        )}
      </div>

      {/* Filter Row */}
      {tab !== 'vod' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <select
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={selectCls}
          >
            <option value="">All categories</option>
            {meta?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.channels})
              </option>
            ))}
          </select>
          <select
            aria-label="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={selectCls}
          >
            <option value="">All countries</option>
            {meta?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} ({c.channels})
              </option>
            ))}
          </select>
          <select
            aria-label="Language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={selectCls}
          >
            <option value="">All languages</option>
            {meta?.languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({l.channels})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tab 1: Channels */}
      {tab === 'channels' &&
        (channels === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : channels.items.length === 0 ? (
          <Empty title="No channels found">Try fewer words or clear a filter.</Empty>
        ) : (
          <div>
            <p className="mb-2 text-xs text-mute">
              {channels.total.toLocaleString()} channel{channels.total === 1 ? '' : 's'}
            </p>
            <div className="grid gap-1 sm:grid-cols-2">
              {channels.items.map((c) => (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  now={now}
                  onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)}
                />
              ))}
            </div>
          </div>
        ))}

      {/* Tab 2: Programmes (Guide) */}
      {tab === 'programmes' &&
        (noGuide ? (
          <Empty icon={<CalendarDays size={28} />} title="Programme search needs a guide">
            Load a guide source in Settings first.
          </Empty>
        ) : progs === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : progs.items.length === 0 ? (
          <Empty title={dq ? `Nothing called “${dq}” found` : 'Nothing found'}>
            Only channels with guide data are searched.
          </Empty>
        ) : (
          <div>
            <p className="mb-2 text-xs text-mute">
              {progs.total.toLocaleString()} programme{progs.total === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1">
              {progs.items.map((p) => (
                <li key={p.id}>
                  <div className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-ink-800 transition-colors">
                    <ChannelLogo src={p.channel.logo} name={p.channel.name} size={42} />
                    <button onClick={() => setSelected(p)} className="min-w-0 flex-1 text-left">
                      <p className="truncate font-semibold text-sm text-white">
                        {p.title}
                        {p.episode && <span className="font-normal text-mute"> · {p.episode}</span>}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-mute">
                        {p.airing && <LiveBadge />}
                        <span className="truncate">
                          {p.channel.name} · {fmtDay(p.start)} {fmtRange(p.start, p.stop)}
                        </span>
                      </p>
                      {p.airing && (
                        <ProgressBar
                          start={p.start}
                          stop={p.stop}
                          now={now}
                          className="mt-1.5 max-w-xs"
                        />
                      )}
                    </button>
                    {p.airing ? (
                      <Button onClick={() => nav(`/watch/${encodeURIComponent(p.channel_id)}`)}>
                        Watch
                      </Button>
                    ) : (
                      <button
                        onClick={() => setSelected(p)}
                        className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-xs font-semibold hover:bg-ink-600 text-slate-300"
                      >
                        {reminded.has(`${p.channel_id}|${p.start}`) ? (
                          <BellRing size={14} className="text-accent" />
                        ) : (
                          <Bell size={14} />
                        )}
                        {fmtRelative(p.start, now)}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {/* Tab 3: 14-Day Catch-Up TV Replay Search */}
      {tab === 'catchup' &&
        (catchupProgs === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : catchupProgs.items.length === 0 ? (
          <Empty title="No Catch-Up Broadcasts Found">
            Try searching for another show or channel name.
          </Empty>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-mute">
              {catchupProgs.total} past broadcasts available in the 14-day rolling window
            </p>
            {catchupProgs.items.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-ink-800/60 p-3 hover:bg-ink-800 border border-white/5 transition-all"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ChannelLogo src={p.channel.logo} name={p.channel.name} size={38} />
                  <div className="min-w-0 space-y-0.5">
                    <h3 className="font-semibold text-xs text-white truncate">{p.title}</h3>
                    <p className="text-[11px] text-mute flex items-center gap-2 truncate">
                      <span>{p.channel.name}</span>
                      <span>·</span>
                      <span>{fmtDay(p.start)}</span>
                      <span>·</span>
                      <span>{fmtRange(p.start, p.stop)}</span>
                    </p>
                  </div>
                </div>

                <Link
                  to={`/catchup?channel=${encodeURIComponent(p.channel_id)}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                >
                  <History size={12} /> Open Catch-Up
                </Link>
              </div>
            ))}
          </div>
        ))}

      {/* Tab 4: VOD (Movies & Series) Search */}
      {tab === 'vod' &&
        (vodResults === null ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : vodResults.items.length === 0 ? (
          <Empty title="No On-Demand Media Found">
            Try searching for another movie title, actor, or genre.
          </Empty>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-mute">{vodResults.total} movies and series found</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {vodResults.items.map((item) => (
                <Link
                  key={item.id}
                  to={`/vod`}
                  className="group rounded-xl bg-ink-800 p-2.5 border border-white/5 hover:border-accent/40 transition-all flex flex-col justify-between"
                >
                  <div className="relative aspect-[2/3] w-full bg-ink-900 rounded-lg overflow-hidden mb-2">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-mute">
                        <Clapperboard size={28} />
                      </div>
                    )}
                    {item.rating && (
                      <span className="absolute top-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                        ⭐ {item.rating}
                      </span>
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-white truncate">{item.title}</h4>
                    <p className="text-[10px] text-mute uppercase tracking-wider pt-0.5">
                      {item.type} {item.release_date ? `· ${item.release_date.slice(0, 4)}` : ''}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}

      {selected && (
        <ProgrammeModal
          programme={selected}
          channel={selected.channel}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
