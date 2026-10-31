import {
  Bookmark,
  CalendarDays,
  Film,
  Play,
  Trash2,
  Tv,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Empty, Spinner } from '../components/ui'
import type { WatchlistItem } from '../types'

export default function Watchlist() {
  const [items, setItems] = useState<WatchlistItem[]>([])
  const [filter, setFilter] = useState<'all' | 'channel' | 'programme' | 'vod'>('all')
  const [loading, setLoading] = useState(true)
  const nav = useNavigate()

  const load = () => {
    setLoading(true)
    api
      .watchlist(filter === 'all' ? undefined : filter)
      .then((res) => {
        setItems(res)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [filter])

  const handleRemove = async (id: number) => {
    await api.removeFromWatchlist(id)
    load()
  }

  const handleOpenItem = (item: WatchlistItem) => {
    if (item.item_type === 'channel') {
      nav(`/watch/${encodeURIComponent(item.item_id)}`)
    } else if (item.item_type === 'vod') {
      nav('/vod')
    } else if (item.item_type === 'programme') {
      const chId = item.metadata?.channel_id as string | undefined
      if (chId) nav(`/catchup?channel=${encodeURIComponent(chId)}`)
      else nav('/guide')
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-md">
              <Bookmark size={20} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Universal Watchlist</h1>
          </div>
          <p className="mt-1 text-sm text-mute">
            Your personal collection of saved live channels, upcoming broadcasts, and on-demand media.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="inline-flex rounded-xl bg-ink-800 p-1 border border-white/5 text-xs font-semibold">
          {(
            [
              { id: 'all', label: 'All Items' },
              { id: 'channel', label: 'Channels' },
              { id: 'programme', label: 'Programmes' },
              { id: 'vod', label: 'Movies & Series' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`rounded-lg px-3 py-1.5 transition-colors ${
                filter === t.id ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty
          title="Your Watchlist is Empty"
        >
          Bookmark channels, programs from the TV Guide, or movies to access them quickly here.
        </Empty>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-ink-800/60 p-4 border border-white/5 hover:bg-ink-800 transition-all shadow-sm"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-700 text-accent">
                  {item.item_type === 'channel' ? (
                    <Tv size={20} />
                  ) : item.item_type === 'vod' ? (
                    <Film size={20} />
                  ) : (
                    <CalendarDays size={20} />
                  )}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-white truncate">{item.title}</h3>
                    <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent uppercase tracking-wider">
                      {item.item_type}
                    </span>
                  </div>
                  <p className="text-xs text-mute truncate">
                    {item.metadata?.channel_name
                      ? String(item.metadata.channel_name)
                      : `Saved on ${new Date(item.created_at * 1000).toLocaleDateString()}`}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => handleOpenItem(item)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 shadow-sm"
                >
                  <Play size={13} className="translate-x-0.5" /> Watch
                </button>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="rounded-xl p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                  title="Remove from watchlist"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
