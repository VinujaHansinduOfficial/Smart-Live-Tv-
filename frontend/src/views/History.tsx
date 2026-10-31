import { RotateCcwClock, Trash } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, ChannelLogo, Empty, Spinner } from '../components/ui'
import { fmtDay, fmtDuration, fmtTime } from '../lib/time'
import type { HistoryEntry } from '../types'

export default function History() {
  const nav = useNavigate()
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => { api.history(200).then(setItems).catch(() => setItems([])) }, [])

  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>()
    for (const h of items ?? []) {
      const key = fmtDay(h.started_at)
      map.set(key, [...(map.get(key) ?? []), h])
    }
    return [...map.entries()]
  }, [items])

  const total = (items ?? []).reduce((s, h) => s + h.duration_s, 0)

  const remove = async (id: number) => {
    setItems((xs) => xs?.filter((x) => x.id !== id) ?? null)
    await api.deleteHistory(id).catch(() => undefined)
  }
  const clearAll = async () => {
    await api.clearHistory()
    setItems([])
    setConfirm(false)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Watch history</h1>
          {items && items.length > 0 && <p className="text-sm text-mute">{fmtDuration(total)} watched across {items.length} sessions</p>}
        </div>
        {items && items.length > 0 && (confirm ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-mute">Clear all history for this profile?</span>
            <Button variant="danger" onClick={clearAll}>Clear</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirm(true)}><Trash size={14} /> Clear history</Button>
        ))}
      </div>

      {items === null ? <div className="flex justify-center py-12"><Spinner /></div>
        : items.length === 0 ? (
          <Empty icon={<RotateCcwClock size={28} />} title="Nothing watched yet">Channels you watch show up here.</Empty>
        ) : groups.map(([day, entries]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mute">{day}</h2>
            <ul className="space-y-1">
              {entries.map((h) => (
                <li key={h.id} className="group flex items-center gap-3 rounded-lg p-2 hover:bg-ink-800">
                  <button disabled={!h.available} onClick={() => nav(`/watch/${encodeURIComponent(h.channel_id)}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50">
                    <ChannelLogo src={h.channel_logo} name={h.channel_name} size={40} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{h.channel_name}</p>
                      <p className="truncate text-xs text-mute">
                        {fmtTime(h.started_at)} · {fmtDuration(h.duration_s)}
                        {h.programme_title && ` · ${h.programme_title}`}
                        {!h.available && ' · no longer available'}
                      </p>
                    </div>
                  </button>
                  <button onClick={() => remove(h.id)} aria-label="Remove from history"
                    className="rounded p-1.5 text-mute opacity-0 hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100">
                    <Trash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
