import {
  CheckCircle2,
  Clock,
  Download,
  HardDrive,
  History,
  Info,
  Play,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Player from '../components/Player'
import { ChannelLogo, Empty, Spinner } from '../components/ui'
import { fmtDuration, fmtRange } from '../lib/time'
import { useNow, useSession } from '../session'
import type {
  CatchupDay,
  CatchupProgram,
  CatchupScheduleResponse,
  CatchupStatus,
  Channel,
  ChannelDetail,
  Stream,
} from '../types'

function AvailabilityBadge({ status }: { status: CatchupStatus }) {
  switch (status) {
    case 'downloaded':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
          <Download size={12} /> Downloaded (Offline)
        </span>
      )
    case 'provider_archive':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={12} /> Provider Archive
        </span>
      )
    case 'local_dvr':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-400 border border-sky-500/20">
          <HardDrive size={12} /> Local DVR
        </span>
      )
    case 'unavailable':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-500/15 px-2.5 py-0.5 text-xs font-semibold text-slate-400 border border-slate-500/20">
          <X size={12} /> Unavailable
        </span>
      )
    case 'outside_window':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/20">
          <TriangleAlert size={12} /> Outside 168h Window
        </span>
      )
  }
}

export default function Catchup() {
  const { channelId: routeChannelId } = useParams()
  const [params, setParams] = useSearchParams()
  const now = useNow(30_000)
  const { favoriteIds } = useSession()

  // State
  const [days, setDays] = useState<CatchupDay[]>([])
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [channelSearch, setChannelSearch] = useState('')
  const [scheduleData, setScheduleData] = useState<CatchupScheduleResponse | null>(null)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [selectedProgram, setSelectedProgram] = useState<CatchupProgram | null>(null)
  const [activeReplayStream, setActiveReplayStream] = useState<{
    stream: Stream
    program: CatchupProgram
    channel: ChannelDetail
  } | null>(null)
  const [recordFeedback, setRecordFeedback] = useState<string | null>(null)

  // 1. Load rolling 14-day calendar
  useEffect(() => {
    api.catchupDays().then((res) => {
      setDays(res)
      const qDate = params.get('date')
      if (qDate && res.some((d) => d.date === qDate)) {
        setSelectedDate(qDate)
      } else if (res.length > 0) {
        // Default to Yesterday or Today
        setSelectedDate(res[1]?.date || res[0].date)
      }
    })
  }, [params])

  // 2. Load channels with guide or favorites
  useEffect(() => {
    api.channels({ limit: 80 }).then((res) => {
      setChannels(res.items)
      const targetId = routeChannelId || params.get('channel') || res.items[0]?.id
      if (targetId) setSelectedChannelId(targetId)
    })
  }, [routeChannelId, params])

  // 3. Load schedule when selectedDate or selectedChannelId changes
  useEffect(() => {
    if (!selectedChannelId || !selectedDate) return
    setLoadingSchedule(true)
    api
      .catchupSchedule(selectedChannelId, selectedDate)
      .then((data) => {
        setScheduleData(data)
        setLoadingSchedule(false)
      })
      .catch(() => {
        setScheduleData(null)
        setLoadingSchedule(false)
      })
  }, [selectedChannelId, selectedDate])

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
    const next = new URLSearchParams(params)
    next.set('date', date)
    setParams(next, { replace: true })
  }

  const handleSelectChannel = (chId: string) => {
    setSelectedChannelId(chId)
    const next = new URLSearchParams(params)
    next.set('channel', chId)
    setParams(next, { replace: true })
  }

  const handlePlayReplay = async (prog: CatchupProgram) => {
    if (!scheduleData?.channel) return
    if (prog.catchup_status === 'unavailable' || prog.catchup_status === 'outside_window') {
      setSelectedProgram(prog)
      return
    }

    try {
      const res = await api.resolveCatchup(scheduleData.channel.id, prog.start, prog.stop)
      if (res.playback_url) {
        const replayStream: Stream = {
          id: 999999,
          url: res.playback_url,
          title: `Replay: ${prog.title}`,
          feed_id: null,
          quality: '1080p',
          referrer: null,
          user_agent: null,
          labels: ['catchup', res.status],
        }
        setActiveReplayStream({
          stream: replayStream,
          program: prog,
          channel: scheduleData.channel,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        setSelectedProgram(prog)
      }
    } catch {
      setSelectedProgram(prog)
    }
  }

  const handleDownloadProgram = async (prog: CatchupProgram) => {
    if (!scheduleData?.channel) return
    try {
      await api.queueDownload({
        channel_id: scheduleData.channel.id,
        title: prog.title,
        start: prog.start,
        stop: prog.stop,
        programme_id: prog.id,
        description: prog.description || undefined,
        stream_url: prog.catchup_url || undefined,
      })
      setRecordFeedback(`Downloading "${prog.title}" to offline library...`)
      setTimeout(() => setRecordFeedback(null), 4000)
    } catch (e) {
      setRecordFeedback(`Download failed: ${(e as Error).message}`)
      setTimeout(() => setRecordFeedback(null), 4000)
    }
  }

  // Filter channels in sidebar
  const filteredChannels = useMemo(() => {
    if (!channelSearch.trim()) return channels
    const q = channelSearch.toLowerCase()
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.categories.some((cat) => cat.toLowerCase().includes(q))
    )
  }, [channels, channelSearch])

  return (
    <div className="space-y-6">
      {/* Title & Overview Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-indigo-500 text-white shadow-md">
              <History size={20} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">7-Day Catch-Up TV (Last 168 Hours)</h1>
          </div>
          <p className="mt-1 text-sm text-mute">
            Directly stream available broadcasts from the rolling 168-hour provider archive without continuous local recording, or download programs for offline viewing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/downloads"
            className="flex items-center gap-1.5 rounded-xl bg-ink-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-ink-700 hover:text-white border border-white/5"
          >
            <Download size={14} className="text-accent" /> Download Manager & Offline Library
          </Link>
        </div>

        {recordFeedback && (
          <div className="w-full rounded-xl bg-ink-800 px-4 py-2 text-sm font-semibold text-emerald-400 border border-emerald-500/20 shadow-lg animate-fade-in">
            {recordFeedback}
          </div>
        )}
      </div>

      {/* Active Replay Player Section */}
      {activeReplayStream && (
        <div className="rounded-2xl bg-ink-900/90 p-4 border border-white/10 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChannelLogo
                src={activeReplayStream.channel.logo}
                name={activeReplayStream.channel.name}
                size={36}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-base">
                    {activeReplayStream.program.title}
                  </span>
                  <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent border border-accent/30">
                    REPLAY
                  </span>
                </div>
                <p className="text-xs text-mute">
                  {activeReplayStream.channel.name} · {fmtRange(activeReplayStream.program.start, activeReplayStream.program.stop)} (
                  {fmtDuration(activeReplayStream.program.stop - activeReplayStream.program.start)})
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveReplayStream(null)}
              className="rounded-lg p-2 text-mute hover:bg-white/10 hover:text-white"
              title="Close Replay Player"
            >
              <X size={18} />
            </button>
          </div>

          <Player
            streams={[activeReplayStream.stream]}
            isLive={false}
            overlay={
              <span className="text-xs font-semibold text-slate-200">
                {activeReplayStream.program.title} (Replay)
              </span>
            }
          />
        </div>
      )}

      {/* Rolling 14-Day Horizontal Strip */}
      <div className="relative">
        <div className="scroll-thin flex items-center gap-2 overflow-x-auto pb-2 pt-1">
          {days.map((d) => {
            const isSelected = d.date === selectedDate
            return (
              <button
                key={d.date}
                onClick={() => handleSelectDate(d.date)}
                className={`flex shrink-0 flex-col items-center rounded-xl px-4 py-2.5 text-center transition-all ${
                  isSelected
                    ? 'bg-gradient-to-b from-accent-strong to-indigo-600 text-white shadow-lg shadow-accent/20 scale-105 font-bold'
                    : 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white'
                }`}
              >
                <span className="text-xs uppercase tracking-wider opacity-80">
                  {d.days_ago === 0 ? 'Today' : d.days_ago === 1 ? 'Yesterday' : d.day_name.slice(0, 3)}
                </span>
                <span className="text-sm font-semibold">{d.label}</span>
                <span className="text-[10px] opacity-60">
                  {d.days_ago === 0 ? 'Live & Past' : `${d.days_ago}d ago`}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Grid: Channel List (Left) + Program Schedule (Right) */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Left: Channels Sidebar */}
        <div className="space-y-3 rounded-2xl bg-ink-800/80 p-4 border border-white/5">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              value={channelSearch}
              onChange={(e) => setChannelSearch(e.target.value)}
              placeholder="Filter channels..."
              className="w-full rounded-xl bg-ink-700 py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-accent text-white"
            />
          </div>

          <div className="scroll-thin max-h-[600px] space-y-1 overflow-y-auto pr-1">
            {filteredChannels.map((c) => {
              const isSelected = c.id === selectedChannelId
              const isFav = favoriteIds.has(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectChannel(c.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-ink-600 text-white font-semibold'
                      : 'hover:bg-ink-700/60 text-slate-300'
                  }`}
                >
                  <ChannelLogo src={c.logo} name={c.name} size={28} />
                  <div className="min-w-0 flex-1 truncate">
                    <div className="truncate text-xs">{c.name}</div>
                    <div className="text-[10px] text-mute truncate">
                      {c.categories[0] || 'General'}
                    </div>
                  </div>
                  {isFav && <span className="text-rose-400 text-xs">★</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: Selected Channel Schedule for Chosen Day */}
        <div className="space-y-4">
          {scheduleData?.channel && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ink-800/80 p-4 border border-white/5">
              <div className="flex items-center gap-3">
                <ChannelLogo
                  src={scheduleData.channel.logo}
                  name={scheduleData.channel.name}
                  size={44}
                />
                <div>
                  <h2 className="text-lg font-bold text-white">{scheduleData.channel.name}</h2>
                  <p className="text-xs text-mute">
                    Schedule for {selectedDate} · {scheduleData.programmes.length} programs listed
                  </p>
                </div>
              </div>

              <Link
                to={`/watch/${encodeURIComponent(scheduleData.channel.id)}`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink-600"
              >
                <Play size={14} /> Watch Live Now
              </Link>
            </div>
          )}

          {loadingSchedule ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          ) : !scheduleData || scheduleData.programmes.length === 0 ? (
            <Empty title="No Schedule for Selected Date">
              This channel does not have archived program data for this day.
            </Empty>
          ) : (
            <div className="space-y-2.5">
              {scheduleData.programmes.map((prog) => {
                const isCurrent = prog.start <= now && now < prog.stop
                const isPlayable =
                  prog.catchup_status === 'provider_archive' ||
                  prog.catchup_status === 'local_dvr' ||
                  prog.catchup_status === 'downloaded'

                return (
                  <div
                    key={`${prog.channel_id}-${prog.start}`}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl p-3.5 transition-all border ${
                      isCurrent
                        ? 'bg-ink-800/90 border-accent/30 ring-1 ring-accent/20'
                        : 'bg-ink-800/50 border-white/5 hover:bg-ink-800 hover:border-white/10'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-400 flex items-center gap-1">
                          <Clock size={12} />
                          {fmtRange(prog.start, prog.stop)}
                        </span>
                        {isCurrent && (
                          <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
                            ON AIR
                          </span>
                        )}
                        <AvailabilityBadge status={prog.catchup_status} />
                        {prog.expiry_text && prog.catchup_status === 'provider_archive' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/20">
                            ⏳ {prog.expiry_text}
                          </span>
                        )}
                      </div>

                      <h3 className="font-semibold text-sm text-white">{prog.title}</h3>
                      {prog.description && (
                        <p className="line-clamp-2 text-xs text-mute">{prog.description}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
                      {isPlayable ? (
                        <button
                          onClick={() => handlePlayReplay(prog)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 shadow-sm"
                          title={
                            prog.catchup_status === 'downloaded'
                              ? 'Play offline from local storage'
                              : 'Stream directly from provider archive (no local recording)'
                          }
                        >
                          <Play size={13} className="translate-x-0.5" /> Watch
                        </button>
                      ) : (
                        <button
                          onClick={() => setSelectedProgram(prog)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-ink-600 hover:text-white"
                        >
                          <Info size={13} /> Details
                        </button>
                      )}

                      {/* On-Demand Download Button for permitted programs */}
                      {(isPlayable || prog.can_download) && prog.catchup_status !== 'downloaded' && (
                        <button
                          onClick={() => handleDownloadProgram(prog)}
                          title="Save program to offline library"
                          className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-ink-600 hover:text-white"
                        >
                          <Download size={13} /> Download
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Program Details & Replay Info Modal */}
      {selectedProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl bg-ink-800 p-6 border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <AvailabilityBadge status={selectedProgram.catchup_status} />
                <h2 className="mt-2 text-lg font-bold text-white">{selectedProgram.title}</h2>
                <p className="text-xs text-mute font-mono">
                  {fmtRange(selectedProgram.start, selectedProgram.stop)} (
                  {fmtDuration(selectedProgram.stop - selectedProgram.start)})
                </p>
              </div>
              <button
                onClick={() => setSelectedProgram(null)}
                className="rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {selectedProgram.description ? (
              <p className="text-xs leading-relaxed text-slate-300">{selectedProgram.description}</p>
            ) : (
              <p className="text-xs italic text-mute">No synopsis provided by program guide.</p>
            )}

            <div className="rounded-xl bg-ink-900/80 p-3 text-xs space-y-1.5 text-slate-300 border border-white/5">
              <div className="font-semibold text-accent">Availability & Expiry</div>
              <p className="text-mute">{selectedProgram.catchup_label}</p>
              {selectedProgram.expiry_text && (
                <p className="text-[11px] text-amber-300">
                  ⏳ Upstream window: {selectedProgram.expiry_text}
                </p>
              )}
              {selectedProgram.catchup_status === 'unavailable' && (
                <p className="text-[11px] text-slate-400 pt-1">
                  This channel's IPTV provider does not retain a 168-hour server archive for this
                  broadcast slot.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSelectedProgram(null)}
                className="rounded-xl bg-ink-700 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-600"
              >
                Close
              </button>
              {(selectedProgram.catchup_status === 'provider_archive' ||
                selectedProgram.catchup_status === 'local_dvr' ||
                selectedProgram.catchup_status === 'downloaded') && (
                <button
                  onClick={() => {
                    handlePlayReplay(selectedProgram)
                    setSelectedProgram(null)
                  }}
                  className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:brightness-110"
                >
                  Watch
                </button>
              )}
              {(selectedProgram.catchup_status === 'provider_archive' || selectedProgram.can_download) &&
                selectedProgram.catchup_status !== 'downloaded' && (
                  <button
                    onClick={() => {
                      handleDownloadProgram(selectedProgram)
                      setSelectedProgram(null)
                    }}
                    className="rounded-xl bg-ink-600 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-500"
                  >
                    Download Program
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
