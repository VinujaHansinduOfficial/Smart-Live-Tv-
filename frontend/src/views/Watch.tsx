import {
  Bell,
  BellRing,
  Bookmark,
  CalendarDays,
  Check,
  CircleDot,
  Copy,
  Download,
  ExternalLink,
  Grid,
  Heart,
  Layers,
  RotateCcw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Player from '../components/Player'
import ProgrammeModal from '../components/ProgrammeModal'
import { ChannelLogo, Chip, Empty, LiveBadge, ProgressBar, SectionTitle, Spinner } from '../components/ui'
import { fmtRange, fmtTime } from '../lib/time'
import { useNow, useSession } from '../session'
import type { Channel, ChannelDetail, ContinueItem, Programme, RecommendationsResponse, Stream } from '../types'

const HEARTBEAT_MS = 30_000

/** Logs watch history: one entry per channel visit, heartbeats while video plays. */
function useWatchTracking(channelId: string | undefined) {
  const entry = useRef<{ channel: string; id: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const urlRef = useRef<string | undefined>(undefined)

  const stop = useCallback(() => {
    if (timer.current) {
      window.clearInterval(timer.current)
      timer.current = undefined
      if (entry.current) api.heartbeat(entry.current.id, urlRef.current).catch(() => undefined)
    }
  }, [])

  const playing = useCallback(async (url: string) => {
    if (!channelId) return
    urlRef.current = url
    if (!entry.current || entry.current.channel !== channelId) {
      try {
        const res = await api.startWatching(channelId, url)
        entry.current = { channel: channelId, id: res.id }
      } catch { return }
    }
    if (!timer.current) {
      timer.current = window.setInterval(() => {
        if (entry.current) api.heartbeat(entry.current.id, urlRef.current).catch(() => undefined)
      }, HEARTBEAT_MS)
    }
  }, [channelId])

  useEffect(() => () => stop(), [channelId, stop])
  return { playing, stop }
}

const QUICK_CATEGORIES = [
  { id: '', label: 'All' }, { id: 'news', label: 'News' }, { id: 'sports', label: 'Sports' },
  { id: 'movies', label: 'Movies' }, { id: 'documentary', label: 'Documentaries' }, { id: 'kids', label: 'Kids' },
]

export default function Watch() {
  const { channelId: routeId } = useParams()
  const nav = useNavigate()
  const now = useNow(30_000)
  const { profile, meta, favoriteIds, toggleFavorite, reminders } = useSession()
  const [category, setCategory] = useState('')
  const [list, setList] = useState<Channel[] | null>(null)
  const [detail, setDetail] = useState<ChannelDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<Programme[]>([])
  const [recent, setRecent] = useState<ContinueItem[]>([])
  const [selected, setSelected] = useState<Programme | null>(null)
  const [recs, setRecs] = useState<RecommendationsResponse | null>(null)
  const [customStream, setCustomStream] = useState<Stream | null>(null)
  const [inWatchlist, setInWatchlist] = useState(false)
  const [watchlistId, setWatchlistId] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ type: 'download' | 'record' | 'info'; text: string; link?: string } | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [showExternalMenu, setShowExternalMenu] = useState(false)
  const [showSourcesMenu, setShowSourcesMenu] = useState(false)

  const available = useMemo(() => new Set(meta?.categories.map((c) => c.id) ?? []), [meta])
  const allowed = profile?.allowed_categories
  const chips = QUICK_CATEGORIES.filter((c) => !c.id || (available.has(c.id) && (!allowed || allowed.includes(c.id))))

  // Which channel to show: route > last watched > first in list.
  const channelId = routeId ?? profile?.last_channel_id ?? list?.[0]?.id
  const tracking = useWatchTracking(detail?.id)

  useEffect(() => {
    let alive = true
    setList(null)
    api.channels({ category, limit: 60 })
      .then((r) => { if (alive) setList(r.items) })
      .catch(() => { if (alive) setList([]) })
    return () => { alive = false }
  }, [category])

  useEffect(() => {
    if (!channelId) return
    let alive = true
    setDetailError(null)
    api.channel(channelId).then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) { setDetail(null); setDetailError(e.message) } })
    api.schedule(channelId, { hours: 12 }).then((s) => { if (alive) setSchedule(s.programmes) })
      .catch(() => { if (alive) setSchedule([]) })
    return () => { alive = false }
  }, [channelId])

  useEffect(() => {
    api.continueWatching().then(setRecent).catch(() => undefined)
    api.recommendations().then(setRecs).catch(() => undefined)
    if (detail?.id) {
      api
        .checkWatchlist('channel', detail.id)
        .then((res) => {
          setInWatchlist(res.in_watchlist)
          setWatchlistId(res.watchlist_id)
        })
        .catch(() => undefined)
    }
  }, [detail?.id])

  // Watch From Beginning (Feature 3)
  const handleRestartBeginning = async () => {
    if (!detail || !nowProg) return
    try {
      const res = await api.resolveCatchup(detail.id, nowProg.start, nowProg.stop)
      if (res.playback_url) {
        setCustomStream({
          id: 999981,
          url: res.playback_url,
          title: `${nowProg.title} (From Beginning)`,
          feed_id: null,
          quality: '1080p',
          referrer: null,
          user_agent: null,
          labels: ['catchup'],
        })
      }
    } catch {
      // ignore
    }
  }

  // Universal Watchlist Toggle (Feature 40)
  const toggleWatchlist = async () => {
    if (!detail) return
    try {
      if (inWatchlist && watchlistId) {
        await api.removeFromWatchlist(watchlistId)
        setInWatchlist(false)
        setWatchlistId(null)
      } else {
        const item = await api.addToWatchlist({
          item_type: 'channel',
          item_id: detail.id,
          title: detail.name,
          metadata: { country: detail.country, logo: detail.logo, categories: detail.categories },
        })
        setInWatchlist(true)
        setWatchlistId(item.id)
      }
    } catch {
      // ignore
    }
  }

  // Current stream URL for copying/external playback
  const currentStreamUrl = customStream?.url || detail?.streams[0]?.url || ''

  const copyStreamUrl = () => {
    if (!currentStreamUrl) return
    navigator.clipboard.writeText(currentStreamUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  // On-demand Download for current channel or broadcast (168-Hour Architecture)
  const handleDownloadCurrent = async () => {
    if (!detail) return
    setDownloading(true)
    try {
      const title = nowProg?.title || `${detail.name} Live Broadcast`
      const start = nowProg ? nowProg.start : now
      const stop = nowProg ? nowProg.stop : now + 3600
      const progId = nowProg?.id

      await api.queueDownload({
        channel_id: detail.id,
        title,
        start,
        stop,
        programme_id: progId,
        description: nowProg?.description || `Recorded live stream from ${detail.name}`,
        stream_url: customStream?.url || detail.streams[0]?.url,
      })
      setActionFeedback({
        type: 'download',
        text: `Started downloading "${title}" to offline library.`,
        link: '/downloads',
      })
      setTimeout(() => setActionFeedback(null), 5000)
    } catch (e) {
      setActionFeedback({
        type: 'info',
        text: `Download failed: ${(e as Error).message}`,
      })
      setTimeout(() => setActionFeedback(null), 5000)
    } finally {
      setDownloading(false)
    }
  }

  // Instant DVR Recording
  const handleInstantRecord = async () => {
    if (!detail) return
    setRecording(true)
    try {
      const title = nowProg?.title || `${detail.name} Live Broadcast`
      await api.recordInstant(detail.id, 60, title)
      setActionFeedback({
        type: 'record',
        text: `Started DVR recording "${title}" (60 min).`,
        link: '/recordings',
      })
      setTimeout(() => setActionFeedback(null), 5000)
    } catch (e) {
      setActionFeedback({
        type: 'info',
        text: `Record failed: ${(e as Error).message}`,
      })
      setTimeout(() => setActionFeedback(null), 5000)
    } finally {
      setRecording(false)
    }
  }

  // Remote channel delta & tune listeners
  useEffect(() => {
    const handleChannelDelta = (e: CustomEvent<{ delta: number }>) => {
      if (!list || list.length === 0) return
      const curIdx = list.findIndex((c) => c.id === channelId)
      const nextIdx = (curIdx + e.detail.delta + list.length) % list.length
      nav(`/watch/${list[nextIdx].id}`)
    }
    const handleTune = (e: CustomEvent<{ channelId: string }>) => {
      nav(`/watch/${e.detail.channelId}`)
    }
    window.addEventListener('smarttv:channel_delta' as any, handleChannelDelta)
    window.addEventListener('smarttv:tune' as any, handleTune)
    return () => {
      window.removeEventListener('smarttv:channel_delta' as any, handleChannelDelta)
      window.removeEventListener('smarttv:tune' as any, handleTune)
    }
  }, [list, channelId, nav])

  const nowProg = schedule.find((p) => p.start <= now && now < p.stop) ?? null
  const upcoming = schedule.filter((p) => p.start > now).slice(0, 6)
  const remindedStarts = new Set(reminders.filter((r) => r.channel_id === detail?.id).map((r) => r.start))
  const isFav = detail ? favoriteIds.has(detail.id) : false

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {chips.map((c) => <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</Chip>)}
        </div>

        {detail ? (
          <Player
            key={detail.id}
            streams={customStream ? [customStream, ...detail.streams] : detail.streams}
            onPlaying={tracking.playing}
            onStopped={tracking.stop}
            onRestartBeginning={nowProg ? handleRestartBeginning : undefined}
            channelId={detail.id}
            channelName={detail.name}
            isLive={true}
            programmeTitle={nowProg?.title || `${detail.name} Live`}
            overlay={
              <div>
                <p className="truncate text-lg font-bold">{detail.name}</p>
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <LiveBadge />
                  <span className="truncate">{nowProg ? nowProg.title : 'Playing now'}</span>
                </div>
              </div>
            }
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-ink-800 text-sm text-mute">
            {detailError ? detailError : channelId ? <Spinner /> : 'Pick a channel to start watching'}
          </div>
        )}

        {detail && (
          <section className="rounded-xl bg-ink-800 p-4 ring-1 ring-white/5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <ChannelLogo src={detail.logo} name={detail.name} size={48} />
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-lg font-bold">{detail.name}</h1>
                  <p className="text-xs text-mute">
                    {[detail.country, ...detail.categories].filter(Boolean).join(' · ')}
                    {detail.streams.length > 1 && ` · ${detail.streams.length} sources`}
                  </p>
                </div>
              </div>

              {/* Channel Action Toolbar with Download, Replay, DVR, Guide, Sources, External & Social Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Download Program / Live Stream */}
                <button
                  onClick={handleDownloadCurrent}
                  disabled={downloading}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent to-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-md shadow-accent/20 hover:brightness-110 transition-all disabled:opacity-50"
                  title="Download program or live broadcast to offline library (168-hr catch-up & on-demand)"
                >
                  <Download size={15} /> {downloading ? 'Downloading...' : 'Download'}
                </button>

                {/* 2. 7-Day Catch-Up / Replay */}
                <button
                  onClick={() => nav(`/catchup?channel=${encodeURIComponent(detail.id)}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600 transition-colors"
                  title="Watch broadcasts from previous 7 days (168 hours)"
                >
                  <RotateCcw size={15} className="text-accent" /> 7-Day Replay
                </button>

                {/* 3. Instant DVR Record */}
                <button
                  onClick={handleInstantRecord}
                  disabled={recording}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600 transition-colors disabled:opacity-50"
                  title="Instant record 60 minutes to local DVR"
                >
                  <CircleDot size={15} className={`text-rose-400 ${recording ? 'animate-pulse' : ''}`} />
                  {recording ? 'Recording...' : 'Record'}
                </button>

                {/* 4. Full TV Guide */}
                <button
                  onClick={() => nav('/guide')}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600 transition-colors"
                  title="Open full TV Guide schedule grid"
                >
                  <CalendarDays size={15} /> Guide
                </button>

                {/* 5. Stream Source Switcher (when multiple feeds exist) */}
                {detail.streams.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowSourcesMenu(!showSourcesMenu)}
                      className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600 transition-colors"
                      title="Switch stream source feed"
                    >
                      <Layers size={15} /> Sources ({detail.streams.length})
                    </button>

                    {showSourcesMenu && (
                      <div className="absolute right-0 top-full mt-1.5 z-30 w-72 rounded-xl border border-white/10 bg-ink-900 p-2 shadow-2xl space-y-1">
                        <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-mute">Available Sources</p>
                        {detail.streams.map((s, idx) => {
                          const isActive = (customStream ? customStream.url === s.url : idx === 0)
                          return (
                            <button
                              key={s.id || idx}
                              onClick={() => {
                                setCustomStream(s)
                                setShowSourcesMenu(false)
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                                isActive ? 'bg-accent/20 text-accent font-semibold' : 'text-slate-300 hover:bg-white/5'
                              }`}
                            >
                              <div className="min-w-0 truncate">
                                <p className="truncate font-semibold">{s.title || `Feed #${idx + 1}`}</p>
                                <p className="truncate text-[10px] text-mute">{s.quality || 'Auto'} · {s.url}</p>
                              </div>
                              {isActive && <Check size={14} className="shrink-0 ml-2" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 6. External Player / Copy link */}
                <div className="relative">
                  <button
                    onClick={() => setShowExternalMenu(!showExternalMenu)}
                    className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600 transition-colors"
                    title="External player and link options"
                  >
                    <ExternalLink size={15} /> External
                  </button>

                  {showExternalMenu && currentStreamUrl && (
                    <div className="absolute right-0 top-full mt-1.5 z-30 w-56 rounded-xl border border-white/10 bg-ink-900 p-2 shadow-2xl space-y-1">
                      <a
                        href={`vlc://${currentStreamUrl}`}
                        onClick={() => setShowExternalMenu(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10"
                      >
                        <ExternalLink size={14} /> Open in VLC
                      </a>
                      <a
                        href={`mpv://${currentStreamUrl}`}
                        onClick={() => setShowExternalMenu(false)}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10"
                      >
                        <ExternalLink size={14} /> Open in MPV
                      </a>
                      <button
                        onClick={() => {
                          copyStreamUrl()
                          setShowExternalMenu(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-200 hover:bg-white/10 text-left"
                      >
                        <Copy size={14} /> {copiedUrl ? 'Copied URL!' : 'Copy Stream URL'}
                      </button>
                    </div>
                  )}
                </div>

                {/* 7. Multi-View */}
                <button
                  onClick={() => nav(`/multiview?add=${detail.id}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600"
                  title="Watch in multi-view"
                >
                  <Grid size={15} /> Multi-View
                </button>

                {/* 8. Watchlist */}
                <button
                  onClick={toggleWatchlist}
                  aria-pressed={inWatchlist}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    inWatchlist ? 'bg-amber-500/15 text-amber-300' : 'bg-ink-700 text-slate-200 hover:bg-ink-600'
                  }`}
                  title="Bookmark channel in universal watchlist"
                >
                  <Bookmark size={15} fill={inWatchlist ? 'currentColor' : 'none'} />
                  {inWatchlist ? 'Watchlisted' : 'Watchlist'}
                </button>

                {/* 9. Watch Party */}
                <button
                  onClick={async () => {
                    try {
                      const res = await api.createWatchParty(`${detail.name} Live Party`, detail.id)
                      nav(`/party/${res.party_id}`)
                    } catch {
                      nav('/party')
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-ink-600"
                  title="Start synced watch party with friends"
                >
                  <Users size={15} /> Party
                </button>

                {/* 10. Favourite */}
                <button
                  onClick={() => toggleFavorite(detail.id)}
                  aria-pressed={isFav}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                    isFav ? 'bg-pink-500/15 text-pink-300' : 'bg-ink-700 hover:bg-ink-600 text-slate-200'
                  }`}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart size={16} fill={isFav ? 'currentColor' : 'none'} /> {isFav ? 'Favourite' : 'Add to favourites'}
                </button>
              </div>
            </div>

            {actionFeedback && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-700/80 px-3.5 py-2 text-xs font-semibold text-emerald-400 border border-emerald-500/20 shadow-md animate-fade-in">
                <div className="flex items-center gap-2 truncate">
                  {actionFeedback.type === 'download' ? (
                    <Download size={14} className="text-accent shrink-0" />
                  ) : actionFeedback.type === 'record' ? (
                    <CircleDot size={14} className="text-rose-400 shrink-0" />
                  ) : (
                    <Sparkles size={14} className="text-amber-400 shrink-0" />
                  )}
                  <span className="truncate">{actionFeedback.text}</span>
                </div>
                {actionFeedback.link && (
                  <Link to={actionFeedback.link} className="text-accent hover:underline shrink-0 ml-2">
                    {actionFeedback.link === '/downloads' ? 'View in Downloads →' : 'View in Recordings →'}
                  </Link>
                )}
              </div>
            )}

            {nowProg ? (
              <button onClick={() => setSelected(nowProg)} className="mt-4 block w-full rounded-lg bg-ink-700/60 p-3 text-left hover:bg-ink-700">
                <div className="flex items-center justify-between gap-2 text-xs text-mute">
                  <span className="font-semibold text-accent">NOW</span><span>{fmtRange(nowProg.start, nowProg.stop)}</span>
                </div>
                <p className="mt-1 font-semibold">{nowProg.title}</p>
                {nowProg.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-400">{nowProg.description}</p>}
                <ProgressBar start={nowProg.start} stop={nowProg.stop} now={now} className="mt-2" />
              </button>
            ) : !detail.has_guide ? (
              <p className="mt-4 text-sm text-mute">No programme guide for this channel yet.</p>
            ) : null}

            {upcoming.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">Later on {detail.name}</p>
                <ul className="divide-y divide-white/5">
                  {upcoming.map((p) => (
                    <li key={p.id}>
                      <button onClick={() => setSelected(p)} className="flex w-full items-center gap-3 py-2 text-left hover:text-white">
                        <span className="w-16 shrink-0 text-sm tabular-nums text-mute">{fmtTime(p.start)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                        {remindedStarts.has(p.start) ? <BellRing size={14} className="text-accent" /> : <Bell size={14} className="text-ink-500" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section>
          <SectionTitle action={<Link to="/history" className="text-xs font-semibold text-accent">View all</Link>}>Continue Watching</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {recent.filter((r) => r.id !== detail?.id).slice(0, 3).map((r) => (
              <button key={r.id} onClick={() => nav(`/watch/${encodeURIComponent(r.id)}`)}
                className="rounded-xl bg-ink-700/70 p-3 text-left ring-1 ring-white/5 hover:bg-ink-700">
                <ChannelLogo src={r.logo} name={r.name} size={32} />
                <p className="mt-2 truncate text-sm font-bold">{r.name}</p>
                <p className="truncate text-xs text-mute">{r.now ? r.now.title : 'Live'}</p>
                {r.now && <ProgressBar start={r.now.start} stop={r.now.stop} now={now} className="mt-2" />}
              </button>
            ))}
            <ShortcutCard to="/guide" icon={<CalendarDays size={18} />} title="TV Guide" sub="What's on now" />
            <ShortcutCard to="/search?tab=programmes" icon={<Search size={18} />} title="Find a show" sub="Search programmes" />
            <ShortcutCard to="/search?favorites=1" icon={<Heart size={18} />} title="Favourites" sub={`${favoriteIds.size} channels`} />
          </div>
        </section>

        {/* Recommended For You Shelf */}
        {recs?.recommended && recs.recommended.length > 0 && (
          <section className="space-y-3">
            <SectionTitle action={<span className="text-xs font-semibold text-accent">Personalized</span>}>
              Recommended For You
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recs.recommended.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)}
                  className="rounded-xl border border-white/5 bg-ink-800 p-3 text-left hover:border-accent/40 hover:bg-ink-700/80 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ChannelLogo src={c.logo} name={c.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">{c.name}</p>
                      <p className="text-[10px] text-mute">{c.country || 'Global'}</p>
                    </div>
                  </div>
                  {c.now ? (
                    <div className="mt-2">
                      <div className="flex items-center gap-1 text-[11px] text-slate-300 truncate">
                        <LiveBadge />
                        <span className="truncate">{c.now.title}</span>
                      </div>
                      <ProgressBar start={c.now.start} stop={c.now.stop} now={now} className="mt-1.5" />
                    </div>
                  ) : (
                    <p className="mt-2 truncate text-[11px] text-mute">{c.categories.join(' · ')}</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Live Now in Your Genres Shelf */}
        {recs?.live_now && recs.live_now.length > 0 && (
          <section className="space-y-3">
            <SectionTitle action={<span className="text-xs font-semibold text-emerald-400">Airing Live</span>}>
              Live in Your Top Genres
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recs.live_now.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)}
                  className="rounded-xl border border-white/5 bg-ink-800 p-3 text-left hover:border-accent/40 hover:bg-ink-700/80 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <ChannelLogo src={c.logo} name={c.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">{c.name}</p>
                      <p className="text-[10px] text-mute">{c.country || 'Global'}</p>
                    </div>
                  </div>
                  {c.now && (
                    <div className="mt-2">
                      <div className="flex items-center gap-1 text-[11px] text-slate-300 truncate">
                        <LiveBadge />
                        <span className="truncate">{c.now.title}</span>
                      </div>
                      <ProgressBar start={c.now.start} stop={c.now.stop} now={now} className="mt-1.5" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Because You Watched Shelf */}
        {recs?.because_you_watched && recs.because_you_watched.items.length > 0 && (
          <section className="space-y-3">
            <SectionTitle action={<span className="text-xs text-mute">Similar</span>}>
              Because you watched {recs.because_you_watched.channel.name}
            </SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recs.because_you_watched.items.slice(0, 3).map((c) => (
                <button
                  key={c.id}
                  onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)}
                  className="rounded-xl border border-white/5 bg-ink-800 p-3 text-left hover:border-accent/40 hover:bg-ink-700/80 transition-all"
                >
                  <ChannelLogo src={c.logo} name={c.name} size={32} />
                  <p className="mt-2 truncate text-xs font-bold text-white">{c.name}</p>
                  <p className="truncate text-[10px] text-mute">{c.categories.join(' · ')}</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="min-w-0">
        <SectionTitle action={<span className="text-xs text-mute">{list ? `${list.length} shown` : ''}</span>}>
          {category ? QUICK_CATEGORIES.find((c) => c.id === category)?.label : 'Channels'}
        </SectionTitle>
        <div className="scroll-thin max-h-[calc(100vh-11rem)] space-y-1 overflow-y-auto pr-1 lg:sticky lg:top-24">
          {list === null ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : list.length === 0 ? (
            <Empty icon={<Sparkles />} title="No channels here" />
          ) : list.map((c) => (
            <ChannelRow key={c.id} channel={c} now={now} active={c.id === detail?.id}
              onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)} />
          ))}
        </div>
      </aside>

      {selected && detail && (
        <ProgrammeModal programme={selected} channel={detail} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function ShortcutCard({ to, icon, title, sub }: { to: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link to={to} className="rounded-xl bg-ink-700/70 p-3 ring-1 ring-white/5 hover:bg-ink-700">
      <span className="text-accent">{icon}</span>
      <p className="mt-2 text-sm font-bold">{title}</p>
      <p className="text-xs text-mute">{sub}</p>
    </Link>
  )
}

export function ChannelRow({ channel: c, now, active, onClick }: { channel: Channel; now: number; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors ${active ? 'bg-accent-strong/20 ring-1 ring-accent/50' : 'hover:bg-ink-800'}`}>
      <ChannelLogo src={c.logo} name={c.name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
          {c.name}
          {c.is_favorite && <Heart size={11} className="shrink-0 text-pink-400" fill="currentColor" />}
        </p>
        {c.now ? (
          <>
            <p className="truncate text-xs text-slate-400">{c.now.title}</p>
            <ProgressBar start={c.now.start} stop={c.now.stop} now={now} className="mt-1" />
          </>
        ) : c.next ? (
          <p className="truncate text-xs text-mute">Next {fmtTime(c.next.start)} · {c.next.title}</p>
        ) : (
          <p className="truncate text-xs text-mute">{[c.country, c.categories[0]].filter(Boolean).join(' · ')}</p>
        )}
      </div>
    </button>
  )
}
