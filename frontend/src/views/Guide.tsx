import { BellRing, CalendarDays, ChevronLeft, ChevronRight, Heart } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import ProgrammeModal from '../components/ProgrammeModal'
import { Button, ChannelLogo, Chip, Empty, Spinner } from '../components/ui'
import { fmtDay, fmtTime } from '../lib/time'
import { useNow, useSession } from '../session'
import type { GuideChannel, Programme } from '../types'

const PX_PER_MIN = 5
const WINDOW_H = 4
const STEP_S = 2 * 3600
const ROW_H = 64
const CH_COL = 180
const PAGE = 30

export default function Guide() {
  const now = useNow(30_000)
  const nav = useNavigate()
  const { meta, reminders } = useSession()
  const [start, setStart] = useState(() => Math.floor(Date.now() / 1000 / 1800) * 1800 - 1800)
  const [category, setCategory] = useState('')
  const [favorites, setFavorites] = useState(false)
  const [channels, setChannels] = useState<GuideChannel[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selected, setSelected] = useState<{ p: Programme; c: GuideChannel } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const end = start + WINDOW_H * 3600
  const width = WINDOW_H * 60 * PX_PER_MIN

  useEffect(() => {
    let alive = true
    setChannels(null)
    api.grid({ start, hours: WINDOW_H, category, favorites, limit: PAGE })
      .then((g) => { if (alive) { setChannels(g.channels); setTotal(g.total) } })
      .catch(() => { if (alive) setChannels([]) })
    return () => { alive = false }
  }, [start, category, favorites])

  const loadMore = async () => {
    if (!channels) return
    setLoadingMore(true)
    try {
      const g = await api.grid({ start, hours: WINDOW_H, category, favorites, limit: PAGE, offset: channels.length })
      setChannels([...channels, ...g.channels])
    } finally { setLoadingMore(false) }
  }

  const slots = useMemo(() => {
    const out: number[] = []
    for (let t = start; t < end; t += 1800) out.push(t)
    return out
  }, [start, end])

  const reminded = useMemo(() => new Set(reminders.map((r) => `${r.channel_id}|${r.start}`)), [reminders])
  const nowX = (now - start) / 60 * PX_PER_MIN
  const categories = meta?.categories ?? []

  if (meta && meta.epg.programmes === 0) {
    return (
      <Empty icon={<CalendarDays size={28} />} title="No programme guide loaded yet">
        Add a guide source in <Link className="text-accent" to="/settings">Settings</Link> — there you can download
        a channel list for the iptv-org/epg grabber and load the guide it produces.
      </Empty>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">TV Guide</h1>
          <p className="text-sm text-mute">{fmtDay(start)} · {fmtTime(start)} – {fmtTime(end)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" aria-label="Earlier" onClick={() => setStart(start - STEP_S)}><ChevronLeft size={16} /></Button>
          <Button variant="ghost" onClick={() => setStart(Math.floor(Date.now() / 1000 / 1800) * 1800 - 1800)}>Now</Button>
          <Button variant="ghost" aria-label="Later" onClick={() => setStart(start + STEP_S)}><ChevronRight size={16} /></Button>
        </div>
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        <Chip active={favorites} onClick={() => setFavorites(!favorites)}>
          <span className="inline-flex items-center gap-1"><Heart size={12} /> Favourites</span>
        </Chip>
        <Chip active={!category} onClick={() => setCategory('')}>All</Chip>
        {categories.slice(0, 14).map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</Chip>
        ))}
      </div>

      {channels === null ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : channels.length === 0 ? (
        <Empty title="No channels with guide data match these filters" />
      ) : (
        <div ref={scroller} className="scroll-thin overflow-x-auto rounded-xl bg-ink-850 ring-1 ring-white/5">
          <div style={{ width: CH_COL + width }} className="relative">
            {/* time header */}
            <div className="sticky top-0 z-20 flex h-9 border-b border-white/5 bg-ink-850">
              <div className="sticky left-0 z-30 shrink-0 bg-ink-850" style={{ width: CH_COL }} />
              {slots.map((t) => (
                <div key={t} className="shrink-0 border-l border-white/5 px-2 pt-2 text-xs text-mute" style={{ width: 30 * PX_PER_MIN }}>
                  {fmtTime(t)}
                </div>
              ))}
            </div>

            {channels.map((c) => (
              <div key={c.id} className="flex border-b border-white/5" style={{ height: ROW_H }}>
                <button onClick={() => nav(`/watch/${encodeURIComponent(c.id)}`)}
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-white/5 bg-ink-850 px-2 text-left hover:bg-ink-800"
                  style={{ width: CH_COL }} title={`Watch ${c.name}`}>
                  <ChannelLogo src={c.logo} name={c.name} size={36} />
                  <span className="line-clamp-2 text-xs font-semibold">{c.name}</span>
                </button>
                <div className="relative shrink-0" style={{ width }}>
                  {c.programmes.map((p) => {
                    const s = Math.max(p.start, start)
                    const e = Math.min(p.stop, end)
                    const left = (s - start) / 60 * PX_PER_MIN
                    const w = Math.max((e - s) / 60 * PX_PER_MIN - 2, 2)
                    const airing = p.start <= now && now < p.stop
                    const past = p.stop <= now
                    return (
                      <button key={p.id} onClick={() => setSelected({ p, c })}
                        className={`absolute top-1 bottom-1 overflow-hidden rounded-md px-2 py-1 text-left transition-colors ${
                          airing ? 'bg-accent-strong/30 ring-1 ring-accent/60 hover:bg-accent-strong/40'
                            : past ? 'bg-ink-800/60 text-slate-500 hover:bg-ink-800'
                              : 'bg-ink-700 hover:bg-ink-600'}`}
                        style={{ left: left + 1, width: w }} title={`${p.title} · ${fmtTime(p.start)}`}>
                        <p className="flex items-center gap-1 truncate text-xs font-semibold">
                          {reminded.has(`${c.id}|${p.start}`) && <BellRing size={10} className="shrink-0 text-accent" />}
                          {p.title}
                        </p>
                        {w > 70 && <p className="truncate text-[11px] text-mute">{fmtTime(p.start)} – {fmtTime(p.stop)}</p>}
                      </button>
                    )
                  })}
                  {c.programmes.length === 0 && (
                    <div className="absolute inset-1 flex items-center rounded-md border border-dashed border-white/10 px-2 text-xs text-mute">
                      No listings in this time window
                    </div>
                  )}
                </div>
              </div>
            ))}

            {nowX > 0 && nowX < width && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-live/90"
                style={{ left: CH_COL + nowX }} aria-hidden />
            )}
          </div>
        </div>
      )}

      {channels && channels.length < total && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Show more channels (${total - channels.length} more)`}
          </Button>
        </div>
      )}

      {selected && <ProgrammeModal programme={selected.p} channel={selected.c} onClose={() => setSelected(null)} />}
    </div>
  )
}
