import { Bell, BellRing, Bookmark, CircleDot, Download, Play, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { fmtDay, fmtDuration, fmtRange, fmtRelative } from '../lib/time'
import { useNow, useSession } from '../session'
import type { AiSummaryResponse, Programme } from '../types'
import { Button, ChannelLogo, LiveBadge, ProgressBar, Spinner } from './ui'

interface Props {
  programme: Programme
  channel: { id: string; name: string; logo: string | null }
  onClose: () => void
}

const LEADS = [0, 5, 10, 15, 30]

export default function ProgrammeModal({ programme: p, channel, onClose }: Props) {
  const now = useNow(15_000)
  const nav = useNavigate()
  const { reminders, refreshReminders } = useSession()
  const existing = reminders.find((r) => r.channel_id === p.channel_id && r.start === p.start)
  const [lead, setLead] = useState(existing?.notify_before_min ?? 5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const airing = p.start <= now && now < p.stop
  const ended = now >= p.stop

  // Watchlist & AI Summary & DVR state
  const [inWatchlist, setInWatchlist] = useState(false)
  const [watchlistId, setWatchlistId] = useState<number | null>(null)
  const [aiSummary, setAiSummary] = useState<AiSummaryResponse | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [dvrStatus, setDvrStatus] = useState<string | null>(null)

  useEffect(() => {
    api
      .checkWatchlist('programme', String(p.id))
      .then((res) => {
        setInWatchlist(res.in_watchlist)
        setWatchlistId(res.watchlist_id)
      })
      .catch(() => undefined)
  }, [p.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleWatchlist = async () => {
    try {
      if (inWatchlist && watchlistId) {
        await api.removeFromWatchlist(watchlistId)
        setInWatchlist(false)
        setWatchlistId(null)
      } else {
        const item = await api.addToWatchlist({
          item_type: 'programme',
          item_id: String(p.id),
          title: p.title,
          metadata: {
            channel_id: channel.id,
            channel_name: channel.name,
            channel_logo: channel.logo,
            start: p.start,
            stop: p.stop,
          },
        })
        setInWatchlist(true)
        setWatchlistId(item.id)
      }
    } catch {
      // ignore
    }
  }

  const handleFetchAiSummary = async () => {
    if (aiSummary || loadingSummary) return
    setLoadingSummary(true)
    try {
      const res = await api.aiSummarize(p.title, p.description, channel.name, p.categories)
      setAiSummary(res)
      setLoadingSummary(false)
    } catch {
      setLoadingSummary(false)
    }
  }

  const handleScheduleDvr = async () => {
    try {
      await api.scheduleRecording({
        channel_id: channel.id,
        programme_id: p.id,
        title: p.title,
        start: p.start,
        stop: p.stop,
        description: p.description || undefined,
      })
      setDvrStatus('Scheduled for DVR')
      setTimeout(() => setDvrStatus(null), 3000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const handleDownload = async () => {
    try {
      await api.queueDownload({
        channel_id: channel.id,
        title: p.title,
        start: p.start,
        stop: p.stop,
        programme_id: p.id,
        description: p.description || undefined,
      })
      setDvrStatus(`Downloading "${p.title}" to offline library...`)
      setTimeout(() => {
        onClose()
        nav('/downloads')
      }, 1200)
    } catch (e) {
      setError(`Download failed: ${(e as Error).message}`)
    }
  }

  const remind = async () => {
    setBusy(true)
    setError(null)
    try {
      if (existing) await api.deleteReminder(existing.id)
      else await api.addReminder(p.id, lead)
      await refreshReminders()
      if (!existing && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => undefined)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prog-title"
    >
      <div
        className="w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl bg-ink-800 ring-1 ring-white/10 shadow-2xl max-h-[90vh] overflow-y-auto scroll-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {p.icon && (
          <img
            src={p.icon}
            alt=""
            className="h-44 w-full rounded-t-2xl object-cover"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <ChannelLogo src={channel.logo} name={channel.name} size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-mute">{channel.name}</p>
              <h3 id="prog-title" className="text-lg font-bold leading-snug text-white">
                {p.title}
              </h3>
              {(p.sub_title || p.episode) && (
                <p className="text-sm text-slate-300">
                  {[p.episode, p.sub_title].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggleWatchlist}
                className={`rounded-lg p-2 transition-colors ${
                  inWatchlist ? 'text-accent bg-accent/20' : 'text-mute hover:bg-white/10 hover:text-white'
                }`}
                title={inWatchlist ? 'Remove from Watchlist' : 'Add to Universal Watchlist'}
              >
                <Bookmark size={18} fill={inWatchlist ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-2 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            {airing && <LiveBadge />}
            <span>
              {fmtDay(p.start)}, {fmtRange(p.start, p.stop)}
            </span>
            <span className="text-mute">· {fmtDuration(p.stop - p.start)}</span>
            {!airing && !ended && (
              <span className="text-mute">· starts {fmtRelative(p.start, now)}</span>
            )}
            {p.rating && (
              <span className="rounded border border-white/20 px-1.5 text-xs">{p.rating}</span>
            )}
          </div>
          {airing && <ProgressBar start={p.start} stop={p.stop} now={now} className="mt-2" />}

          {p.description && (
            <p className="text-xs leading-relaxed text-slate-300">{p.description}</p>
          )}

          {p.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {p.categories.map((c) => (
                <span key={c} className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs text-mute">
                  {c}
                </span>
              ))}
            </div>
          )}

          {/* AI Show Summary Box (Feature 15) */}
          {aiSummary ? (
            <div className="rounded-xl bg-ink-900/80 p-3.5 border border-accent/20 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-accent">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={14} /> AI Entertainment Analysis
                </span>
                <span className="text-[10px] text-mute uppercase">{aiSummary.source}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-line">
                {aiSummary.summary}
              </p>
            </div>
          ) : (
            <button
              onClick={handleFetchAiSummary}
              disabled={loadingSummary}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-accent/20 to-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-accent hover:brightness-110 border border-accent/30 transition-all"
            >
              {loadingSummary ? <Spinner /> : <Sparkles size={13} />}
              <span>Generate AI Show Summary</span>
            </button>
          )}

          {dvrStatus && (
            <div className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400">
              {dvrStatus}
            </div>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center gap-2">
              {airing && (
                <Button
                  onClick={() => {
                    onClose()
                    nav(`/watch/${encodeURIComponent(channel.id)}`)
                  }}
                >
                  <Play size={16} /> Watch now
                </Button>
              )}

              {ended && (
                <Button
                  onClick={() => {
                    onClose()
                    const dateStr = new Date(p.start * 1000).toISOString().split('T')[0]
                    nav(`/catchup/${encodeURIComponent(channel.id)}?date=${dateStr}`)
                  }}
                >
                  <Play size={16} /> Watch Replay
                </Button>
              )}

              {/* On-Demand Download button for past and live programs */}
              {(ended || airing) && (
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-ink-600"
                  title="Download broadcast to offline library"
                >
                  <Download size={14} /> Download Program
                </button>
              )}

              {/* DVR Schedule (Feature 25) */}
              {!ended && (
                <button
                  onClick={handleScheduleDvr}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-ink-600"
                >
                  <CircleDot size={14} /> Schedule DVR
                </button>
              )}
            </div>

            {!airing && !ended && (
              <div className="flex items-center gap-2">
                {!existing && (
                  <select
                    value={lead}
                    onChange={(e) => setLead(Number(e.target.value))}
                    className="rounded-xl bg-ink-700 px-2.5 py-2 text-xs text-white outline-none"
                    aria-label="Remind me"
                  >
                    {LEADS.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? 'When it starts' : `${m} min before`}
                      </option>
                    ))}
                  </select>
                )}
                <Button variant={existing ? 'danger' : 'ghost'} disabled={busy} onClick={remind}>
                  {existing ? <BellRing size={14} /> : <Bell size={14} />}
                  {existing ? 'Cancel alert' : 'Set reminder'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
