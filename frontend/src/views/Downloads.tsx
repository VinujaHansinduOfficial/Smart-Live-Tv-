import {
  AlertCircle,
  CheckCircle2,
  Download,
  HardDrive,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sliders,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import Player from '../components/Player'
import { ChannelLogo, Empty, Spinner } from '../components/ui'
import { fmtBytes, fmtDuration, fmtRange } from '../lib/time'
import type { DownloadItem, DownloadStorageInfo, Stream } from '../types'

export default function Downloads() {
  const [items, setItems] = useState<DownloadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'completed' | 'active'>('all')
  const [storage, setStorage] = useState<DownloadStorageInfo | null>(null)
  const [playingItem, setPlayingItem] = useState<DownloadItem | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [maxGbInput, setMaxGbInput] = useState<number>(50)
  const [folderInput, setFolderInput] = useState<string>('')
  const [autoCleanupInput, setAutoCleanupInput] = useState<boolean>(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const loadData = async () => {
    try {
      const [dlList, storageInfo] = await Promise.all([
        api.downloads(),
        api.downloadStorage(),
      ])
      setItems(dlList)
      setStorage(storageInfo)
      setMaxGbInput(storageInfo.max_storage_gb)
      setFolderInput(storageInfo.download_folder)
      setAutoCleanupInput(storageInfo.auto_delete_enabled)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  // Poll active downloads periodically
  useEffect(() => {
    loadData()
    const timer = setInterval(() => {
      api.downloads().then((list) => {
        setItems(list)
        const hasActive = list.some((i) => i.status === 'downloading' || i.status === 'queued')
        if (hasActive) {
          api.downloadStorage().then(setStorage).catch(() => undefined)
        }
      }).catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  const handlePause = async (id: number) => {
    try {
      await api.pauseDownload(id)
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'paused' } : item)))
    } catch (e) {
      setFeedback(`Pause failed: ${(e as Error).message}`)
    }
  }

  const handleResume = async (id: number) => {
    try {
      await api.resumeDownload(id)
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'downloading' } : item)))
    } catch (e) {
      setFeedback(`Resume failed: ${(e as Error).message}`)
    }
  }

  const handleCancel = async (id: number) => {
    try {
      await api.cancelDownload(id)
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'cancelled' } : item)))
    } catch (e) {
      setFeedback(`Cancel failed: ${(e as Error).message}`)
    }
  }

  const handleRetry = async (id: number) => {
    try {
      await api.retryDownload(id)
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, status: 'queued', progress: 0 } : item)))
    } catch (e) {
      setFeedback(`Retry failed: ${(e as Error).message}`)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await api.deleteDownload(id)
      setItems((prev) => prev.filter((i) => i.id !== id))
      if (playingItem?.id === id) setPlayingItem(null)
      api.downloadStorage().then(setStorage).catch(() => undefined)
    } catch (e) {
      setFeedback(`Delete failed: ${(e as Error).message}`)
    }
  }

  const handlePlayOffline = (item: DownloadItem) => {
    setPlayingItem(item)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSaveSettings = async () => {
    try {
      await api.updateDownloadStorage({
        download_folder: folderInput,
        max_storage_gb: maxGbInput,
        auto_delete_enabled: autoCleanupInput,
      })
      setSettingsOpen(false)
      setFeedback('Download settings updated.')
      setTimeout(() => setFeedback(null), 3000)
      loadData()
    } catch (e) {
      setFeedback(`Failed to update settings: ${(e as Error).message}`)
    }
  }

  const handleRunCleanup = async () => {
    try {
      const res = await api.cleanupDownloads()
      setFeedback(`Cleaned up ${res.cleaned_count} oldest downloads (${fmtBytes(res.cleaned_bytes)} freed).`)
      setTimeout(() => setFeedback(null), 4000)
      loadData()
    } catch (e) {
      setFeedback(`Cleanup failed: ${(e as Error).message}`)
    }
  }

  const filteredItems = items.filter((i) => {
    if (filter === 'completed') return i.status === 'completed'
    if (filter === 'active') return i.status === 'downloading' || i.status === 'queued' || i.status === 'paused'
    return true
  })

  const offlineStream: Stream | null = playingItem
    ? {
        id: playingItem.id,
        url: playingItem.playback_url || `/api/downloads/${playingItem.id}/stream`,
        title: playingItem.title,
        quality: 'Original',
        feed_id: null,
        referrer: null,
        user_agent: null,
        labels: ['offline', 'downloaded'],
      }
    : null

  return (
    <div className="space-y-6">
      {/* Title & Storage Overview */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent-strong to-indigo-600 text-white shadow-md">
              <Download size={20} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Download Manager & Offline Library</h1>
          </div>
          <p className="mt-1 text-sm text-mute">
            Save permitted 168-hour catch-up broadcasts on demand and watch them completely offline without internet.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRunCleanup}
            className="flex items-center gap-1.5 rounded-xl bg-ink-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-ink-700 hover:text-white border border-white/5"
            title="Clean up oldest downloads"
          >
            <Trash2 size={14} /> Cleanup
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-ink-800 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-ink-700 hover:text-white border border-white/5"
          >
            <Sliders size={14} /> Storage Settings
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl bg-ink-800 px-4 py-2 text-sm font-semibold text-emerald-400 border border-emerald-500/20 shadow-lg animate-fade-in">
          {feedback}
        </div>
      )}

      {/* Storage Meter Card */}
      {storage && (
        <div className="rounded-2xl bg-ink-800/80 p-5 border border-white/5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-accent" />
              <span className="font-semibold text-white">Local Download Storage</span>
              <span className="text-xs text-mute font-mono">({storage.download_folder})</span>
            </div>
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white">{storage.used_gb} GB</span> of{' '}
              <span className="font-semibold">{storage.max_storage_gb} GB Limit</span> · {storage.disk_free_gb} GB Disk Free
            </div>
          </div>

          <div className="h-2.5 w-full rounded-full bg-ink-700 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                storage.used_gb / storage.max_storage_gb > 0.85
                  ? 'bg-rose-500'
                  : storage.used_gb / storage.max_storage_gb > 0.65
                  ? 'bg-amber-500'
                  : 'bg-accent'
              }`}
              style={{
                width: `${Math.min(100, Math.max(3, (storage.used_gb / storage.max_storage_gb) * 100))}%`,
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs text-mute pt-1">
            <span>
              {storage.completed_count} completed offline files · {storage.active_count} active transfers
            </span>
            <span>Rolling catch-up discovery: {storage.catchup_window_hours} hours (7 days)</span>
          </div>
        </div>
      )}

      {/* Active Offline Player */}
      {playingItem && offlineStream && (
        <div className="rounded-2xl bg-ink-900/90 p-4 border border-white/10 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ChannelLogo src={playingItem.channel_logo ?? null} name={playingItem.channel_name} size={36} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-base">{playingItem.title}</span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                    OFFLINE PLAYBACK
                  </span>
                </div>
                <p className="text-xs text-mute">
                  {playingItem.channel_name} · {fmtRange(playingItem.start, playingItem.stop)} (
                  {fmtDuration(playingItem.duration_s)})
                </p>
              </div>
            </div>

            <button
              onClick={() => setPlayingItem(null)}
              className="rounded-lg p-2 text-mute hover:bg-white/10 hover:text-white"
              title="Close Offline Player"
            >
              <X size={18} />
            </button>
          </div>

          <Player
            streams={[offlineStream]}
            isLive={false}
            overlay={
              <span className="text-xs font-semibold text-emerald-300">
                Offline Mode · Playing from local storage ({fmtBytes(playingItem.file_size_bytes)})
              </span>
            }
          />
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-white/5 pb-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
            filter === 'all' ? 'bg-accent text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          All Downloads ({items.length})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
            filter === 'completed' ? 'bg-accent text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Completed Offline ({items.filter((i) => i.status === 'completed').length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`rounded-xl px-4 py-1.5 text-xs font-semibold transition-colors ${
            filter === 'active' ? 'bg-accent text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Active / Paused ({items.filter((i) => i.status !== 'completed' && i.status !== 'cancelled').length})
        </button>
      </div>

      {/* Downloads List */}
      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : filteredItems.length === 0 ? (
        <Empty title="No Downloads Found">
          {filter === 'completed'
            ? 'You have not saved any programs for offline playback yet. Browse the 7-day Catch-Up schedule to download permitted programs!'
            : 'No active or queued downloads at this moment.'}
        </Empty>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isCompleted = item.status === 'completed'
            const isDownloading = item.status === 'downloading'
            const isPaused = item.status === 'paused'
            const isFailed = item.status === 'failed'

            return (
              <div
                key={item.id}
                className="rounded-2xl bg-ink-800/80 p-4 border border-white/5 hover:border-white/10 transition-all space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <ChannelLogo src={item.channel_logo ?? null} name={item.channel_name} size={40} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-white truncate">{item.title}</span>
                        {/* Status Badges */}
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 size={11} /> Offline Ready
                          </span>
                        )}
                        {isDownloading && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-400 border border-sky-500/20 animate-pulse">
                            <RefreshCw size={11} className="animate-spin" /> Downloading {item.progress}%
                          </span>
                        )}
                        {isPaused && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-400 border border-amber-500/20">
                            <Pause size={11} /> Paused
                          </span>
                        )}
                        {isFailed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400 border border-rose-500/20">
                            <AlertCircle size={11} /> Failed
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-mute">
                        {item.channel_name} · {fmtRange(item.start, item.stop)} · {fmtDuration(item.duration_s)}
                        {item.file_size_bytes > 0 && ` · ${fmtBytes(item.file_size_bytes)}`}
                      </p>

                      {item.description && (
                        <p className="line-clamp-1 text-xs text-slate-400">{item.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                    {isCompleted && (
                      <button
                        onClick={() => handlePlayOffline(item)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 shadow-sm"
                      >
                        <Play size={13} className="translate-x-0.5" /> Play Offline
                      </button>
                    )}

                    {isDownloading && (
                      <button
                        onClick={() => handlePause(item.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-ink-600 hover:text-white"
                        title="Pause download"
                      >
                        <Pause size={13} /> Pause
                      </button>
                    )}

                    {isPaused && (
                      <button
                        onClick={() => handleResume(item.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                        title="Resume download"
                      >
                        <Play size={13} /> Resume
                      </button>
                    )}

                    {isFailed && (
                      <button
                        onClick={() => handleRetry(item.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                        title="Retry download"
                      >
                        <RotateCcw size={13} /> Retry
                      </button>
                    )}

                    {!isCompleted && item.status !== 'cancelled' && (
                      <button
                        onClick={() => handleCancel(item.id)}
                        className="rounded-xl p-1.5 text-slate-400 hover:bg-ink-700 hover:text-white"
                        title="Cancel download"
                      >
                        <X size={15} />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(item.id)}
                      className="rounded-xl p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400"
                      title="Delete from disk and library"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Progress bar for active downloads */}
                {!isCompleted && item.status !== 'cancelled' && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-ink-700 overflow-hidden">
                      <div
                        className="h-full bg-sky-500 transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-mute">
                      <span>{item.progress}% downloaded</span>
                      <span>
                        {fmtBytes(item.bytes_downloaded)} / {fmtBytes(item.file_size_bytes || 45_000_000)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl bg-ink-800 p-6 border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Sliders size={18} className="text-accent" /> Download & Storage Settings
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs text-slate-300">
              <div>
                <label className="block font-semibold mb-1">Download Folder Path</label>
                <input
                  type="text"
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  className="w-full rounded-xl bg-ink-700 p-2.5 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Maximum Download Storage (GB)</label>
                <input
                  type="number"
                  min="5"
                  max="1000"
                  value={maxGbInput}
                  onChange={(e) => setMaxGbInput(Number(e.target.value))}
                  className="w-full rounded-xl bg-ink-700 p-2.5 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                />
                <p className="mt-1 text-[11px] text-mute">
                  Limits the space used by downloaded TV broadcasts on your hard disk.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div>
                  <div className="font-semibold text-white">Auto-Delete Oldest Downloads</div>
                  <div className="text-[11px] text-mute">
                    Automatically recycle oldest completed files when reaching storage limits.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoCleanupInput}
                  onChange={(e) => setAutoCleanupInput(e.target.checked)}
                  className="h-4 w-4 rounded bg-ink-700 border-white/10 text-accent focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded-xl bg-ink-700 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white hover:brightness-110"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
