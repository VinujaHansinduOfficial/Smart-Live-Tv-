import {
  Calendar,
  CheckCircle2,
  CircleDot,
  Clock,
  Download,
  HardDrive,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Player from '../components/Player'
import { ChannelLogo, Empty, Spinner } from '../components/ui'
import { fmtDuration, fmtRange } from '../lib/time'
import type { Channel, DvrStorage, Recording } from '../types'

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${Math.round(mb * 10) / 10} MB`
  return `${Math.round((mb / 1024) * 10) / 10} GB`
}

export default function Recordings() {
  const [tab, setTab] = useState<'recorded' | 'scheduled'>('recorded')
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [storage, setStorage] = useState<DvrStorage | null>(null)
  const [loading, setLoading] = useState(true)
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null)

  // Instant record modal
  const [recordModalOpen, setRecordModalOpen] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [durationMin, setDurationMin] = useState(60)
  const [customTitle, setCustomTitle] = useState('')
  const [recordingBusy, setRecordingBusy] = useState(false)

  // Active playback
  const [activePlayRecording, setActivePlayRecording] = useState<Recording | null>(null)

  const loadData = () => {
    setLoading(true)
    Promise.all([api.recordings(), api.dvrStorage()])
      .then(([recs, stor]) => {
        setRecordings(recs)
        setStorage(stor)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    loadData()
    api.channels({ limit: 100 }).then((res) => {
      setChannels(res.items)
      if (res.items.length > 0) setSelectedChannelId(res.items[0].id)
    })
  }, [])

  const handleDelete = async (id: number) => {
    try {
      await api.deleteRecording(id)
      if (activePlayRecording?.id === id) setActivePlayRecording(null)
      loadData()
    } catch {
      // ignore
    }
  }

  const handleCleanup = async () => {
    try {
      const res = await api.cleanupRecordings()
      setCleanupMsg(`Cleanup complete. Purged ${res.deleted_count} expired recordings.`)
      setTimeout(() => setCleanupMsg(null), 3500)
      loadData()
    } catch {
      // ignore
    }
  }

  const handleStartInstant = async () => {
    if (!selectedChannelId) return
    setRecordingBusy(true)
    try {
      await api.recordInstant(selectedChannelId, durationMin, customTitle.trim() || undefined)
      setRecordModalOpen(false)
      setCustomTitle('')
      setRecordingBusy(false)
      loadData()
    } catch {
      setRecordingBusy(false)
    }
  }

  const recordedItems = recordings.filter((r) => r.status === 'completed' || r.status === 'recording')
  const scheduledItems = recordings.filter((r) => r.status === 'scheduled')

  const diskUsedPercent = storage ? Math.min(100, Math.round(((storage.disk_total_gb - storage.disk_free_gb) / (storage.disk_total_gb || 1)) * 100)) : 0

  return (
    <div className="space-y-6">
      {/* Header and Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent-strong to-indigo-600 text-white shadow-md">
              <HardDrive size={20} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Local DVR & Recordings</h1>
          </div>
          <p className="mt-1 text-sm text-mute">
            Manage captured TV broadcasts and scheduled recordings with 14-day automatic retention.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/downloads"
            className="inline-flex items-center gap-1.5 rounded-xl bg-ink-800 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-ink-700 hover:text-white border border-white/5"
          >
            <Download size={15} className="text-accent" /> Downloads & Offline Library
          </Link>
          <button
            onClick={() => setRecordModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-strong px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-accent/20 hover:brightness-110"
          >
            <Plus size={16} /> Instant Record Channel
          </button>
        </div>
      </div>

      {/* Storage and Retention Dashboard */}
      {storage && (
        <div className="rounded-2xl bg-ink-800/80 p-5 border border-white/5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                <CircleDot size={22} />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">DVR Storage & 14-Day Retention</h3>
                <p className="text-xs text-mute">
                  {storage.completed_count} completed · {storage.scheduled_count} scheduled · {formatBytes(storage.recordings_bytes)} captured
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {cleanupMsg && <span className="text-xs text-emerald-400 font-semibold">{cleanupMsg}</span>}
              <button
                onClick={handleCleanup}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-ink-600 hover:text-white transition-colors"
                title="Purge recordings older than 14 days"
              >
                <RefreshCw size={13} /> Clean Expired
              </button>
            </div>
          </div>

          {/* Disk Meter */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Disk Space ({diskUsedPercent}% used)</span>
              <span>
                {storage.disk_free_gb} GB free of {storage.disk_total_gb} GB
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-ink-700 overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all rounded-full"
                style={{ width: `${diskUsedPercent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Active DVR Playback */}
      {activePlayRecording && (
        <div className="rounded-2xl bg-ink-900/90 p-4 border border-white/10 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChannelLogo
                src={activePlayRecording.channel_logo}
                name={activePlayRecording.channel_name}
                size={36}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-bold text-white text-base">{activePlayRecording.title}</h2>
                  <span className="rounded bg-sky-500/20 px-2 py-0.5 text-xs font-semibold text-sky-400 border border-sky-500/30">
                    DVR PLAYBACK
                  </span>
                </div>
                <p className="text-xs text-mute">
                  {activePlayRecording.channel_name} · {fmtDuration(activePlayRecording.duration_s)} · {formatBytes(activePlayRecording.file_size_bytes)}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActivePlayRecording(null)}
              className="rounded-lg p-2 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <Player
            streams={[
              {
                id: activePlayRecording.id,
                url: activePlayRecording.playback_url || '',
                title: activePlayRecording.title,
                feed_id: null,
                quality: '1080p',
                referrer: null,
                user_agent: null,
                labels: ['dvr'],
              },
            ]}
            isLive={false}
            overlay={<span className="text-xs font-semibold text-slate-200">{activePlayRecording.title}</span>}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex rounded-xl bg-ink-800 p-1 border border-white/5">
        <button
          onClick={() => setTab('recorded')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'recorded' ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
          }`}
        >
          <HardDrive size={15} /> Recorded ({recordedItems.length})
        </button>
        <button
          onClick={() => setTab('scheduled')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            tab === 'scheduled' ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
          }`}
        >
          <Calendar size={15} /> Scheduled ({scheduledItems.length})
        </button>
      </div>

      {/* Recordings List */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : tab === 'recorded' ? (
        recordedItems.length === 0 ? (
          <Empty title="No Recorded Programs">
            Record live broadcasts with the instant record button or the 14-day catch-up schedule.
          </Empty>
        ) : (
          <div className="space-y-3">
            {recordedItems.map((r) => (
              <div
                key={r.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-ink-800/60 p-4 border border-white/5 hover:bg-ink-800 transition-all shadow-sm"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <ChannelLogo src={r.channel_logo} name={r.channel_name} size={42} />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-sm text-white truncate">{r.title}</h3>
                      {r.status === 'recording' ? (
                        <span className="flex items-center gap-1 rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 animate-pulse">
                          <CircleDot size={10} /> RECORDING
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                          <CheckCircle2 size={10} /> COMPLETED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-mute flex items-center gap-2">
                      <span>{r.channel_name}</span>
                      <span>·</span>
                      <span>{fmtDuration(r.duration_s)}</span>
                      <span>·</span>
                      <span>{formatBytes(r.file_size_bytes)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
                  {r.playback_url && (
                    <button
                      onClick={() => {
                        setActivePlayRecording(r)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:brightness-110 shadow-sm"
                    >
                      <Play size={13} className="translate-x-0.5" /> Play
                    </button>
                  )}

                  {r.playback_url && (
                    <a
                      href={r.playback_url}
                      download
                      className="rounded-xl p-2 text-slate-300 hover:bg-ink-700 hover:text-white"
                      title="Download recording"
                    >
                      <Download size={15} />
                    </a>
                  )}

                  <button
                    onClick={() => handleDelete(r.id)}
                    className="rounded-xl p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                    title="Delete recording"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : scheduledItems.length === 0 ? (
        <Empty title="No Scheduled Recordings">
          Schedule future broadcast recordings from the TV Guide or 14-day schedule.
        </Empty>
      ) : (
        <div className="space-y-3">
          {scheduledItems.map((r) => (
            <div
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-ink-800/60 p-4 border border-white/5 hover:bg-ink-800 transition-all shadow-sm"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <ChannelLogo src={r.channel_logo} name={r.channel_name} size={42} />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-sm text-white truncate">{r.title}</h3>
                    <span className="flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-400">
                      <Clock size={10} /> SCHEDULED
                    </span>
                  </div>
                  <p className="text-xs text-mute flex items-center gap-2">
                    <span>{r.channel_name}</span>
                    <span>·</span>
                    <span>{fmtRange(r.start, r.stop)}</span>
                    <span>·</span>
                    <span>{fmtDuration(r.duration_s)}</span>
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
                <button
                  onClick={() => handleDelete(r.id)}
                  className="rounded-xl p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                  title="Cancel scheduled recording"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Instant Recording Modal */}
      {recordModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl bg-ink-800 p-6 border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CircleDot size={18} className="text-rose-400" />
                <h2 className="text-lg font-bold text-white">Record Live Channel</h2>
              </div>
              <button
                onClick={() => setRecordModalOpen(false)}
                className="rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300">Select Channel</label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-ink-700 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Recording Duration</label>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {[15, 30, 60, 120].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => setDurationMin(min)}
                      className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                        durationMin === min
                          ? 'bg-accent text-white'
                          : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
                      }`}
                    >
                      {min} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Custom Title (Optional)</label>
                <input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. Football Championship Match"
                  className="mt-1 w-full rounded-xl bg-ink-700 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRecordModalOpen(false)}
                className="rounded-xl bg-ink-700 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-600"
              >
                Cancel
              </button>
              <button
                onClick={handleStartInstant}
                disabled={recordingBusy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:brightness-110 shadow-md"
              >
                {recordingBusy ? <Spinner /> : <CircleDot size={14} />} Start Recording
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
