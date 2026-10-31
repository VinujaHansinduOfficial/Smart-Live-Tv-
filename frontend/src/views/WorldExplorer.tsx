import {
  ArrowLeft,
  ChevronRight,
  Clock,
  Globe,
  Heart,
  Play,
  Plus,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { ChannelLogo, LiveBadge, ProgressBar, Spinner } from '../components/ui'
import { fmtRange } from '../lib/time'
import { useNow, useSession } from '../session'
import type { WorldCountry, WorldCountryDetail } from '../types'

const REGIONS = ['All', 'Europe', 'Americas', 'Asia', 'Middle East', 'Africa', 'Oceania']

export default function WorldExplorer() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const now = useNow(30_000)
  const { favoriteIds, toggleFavorite } = useSession()

  const selectedCode = params.get('country')
  const [countries, setCountries] = useState<WorldCountry[]>([])
  const [loading, setLoading] = useState(true)
  const [region, setRegion] = useState('All')
  const [search, setSearch] = useState('')

  // Selected country detail
  const [detail, setDetail] = useState<WorldCountryDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [category, setCategory] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.worldCountries()
      .then((data) => {
        if (alive) {
          setCountries(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!selectedCode) {
      setDetail(null)
      return
    }
    let alive = true
    setDetailLoading(true)
    api.worldCountry(selectedCode, category || undefined)
      .then((d) => {
        if (alive) {
          setDetail(d)
          setDetailLoading(false)
        }
      })
      .catch(() => {
        if (alive) setDetailLoading(false)
      })
    return () => { alive = false }
  }, [selectedCode, category])

  const filteredCountries = useMemo(() => {
    return countries.filter((c) => {
      const matchRegion = region === 'All' || c.region === region
      const matchSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toLowerCase().includes(search.toLowerCase())
      return matchRegion && matchSearch
    })
  }, [countries, region, search])

  const selectCountry = (code: string | null) => {
    const next = new URLSearchParams(params)
    if (code) next.set('country', code)
    else next.delete('country')
    setCategory('')
    setParams(next)
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-r from-ink-850 via-ink-800 to-indigo-950/40 p-6 md:p-8">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/20 px-3 py-1 text-xs font-bold text-accent mb-3">
              <Globe size={14} /> World TV Explorer
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              {detail ? (
                <span className="flex items-center gap-3">
                  <span>{detail.country.flag}</span>
                  <span>{detail.country.name} Television</span>
                </span>
              ) : (
                'Explore Live TV Around the Globe'
              )}
            </h1>
            <p className="mt-2 text-sm text-mute">
              {detail
                ? `Browsing ${detail.total_channels} channels broadcasting from ${detail.country.name} (${detail.country.region}).`
                : 'Discover national broadcasters, local news, sports, and culture from over 150 countries.'}
            </p>
          </div>

          {selectedCode && (
            <button
              onClick={() => selectCountry(null)}
              className="inline-flex items-center gap-2 rounded-xl bg-ink-700 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-ink-600 hover:text-white"
            >
              <ArrowLeft size={14} /> Back to World Map
            </button>
          )}
        </div>
      </div>

      {/* Selected Country View */}
      {selectedCode ? (
        <div className="space-y-6">
          {detailLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          ) : detail ? (
            <>
              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-2 no-scrollbar">
                <button
                  onClick={() => setCategory('')}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    !category
                      ? 'bg-accent-strong text-white'
                      : 'border border-white/5 bg-ink-800 text-mute hover:text-white'
                  }`}
                >
                  All Channels ({detail.total_channels})
                </button>
                {detail.categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategory(cat.id)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      category === cat.id
                        ? 'bg-accent-strong text-white'
                        : 'border border-white/5 bg-ink-800 text-mute hover:text-white'
                    }`}
                  >
                    {cat.name} ({cat.channels})
                  </button>
                ))}
              </div>

              {/* Live Now in Country */}
              {detail.live_now.length > 0 && !category && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <LiveBadge />
                    <h3 className="text-sm font-bold text-white">Live Now in {detail.country.name}</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                    {detail.live_now.map((prog) => (
                      <div
                        key={prog.id}
                        onClick={() => nav(`/watch/${prog.channel_id}`)}
                        className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-ink-850 p-3 hover:border-accent/40 hover:bg-ink-800 transition-all"
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="truncate text-xs font-bold text-white group-hover:text-accent">
                            {prog.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mute">
                            <span className="truncate">{prog.channel_name}</span>
                            <span>•</span>
                            <span className="flex items-center gap-0.5">
                              <Clock size={10} /> {fmtRange(prog.start, prog.stop)}
                            </span>
                          </div>
                        </div>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-strong text-white">
                          <Play size={12} fill="currentColor" />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Channel Grid */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">Channels ({detail.channels.length})</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {detail.channels.map((ch) => {
                    const isFav = favoriteIds.has(ch.id)
                    return (
                      <div
                        key={ch.id}
                        className="group flex flex-col justify-between rounded-2xl border border-white/5 bg-ink-850 p-4 hover:border-accent/30 hover:bg-ink-800 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <ChannelLogo src={ch.logo} name={ch.name} size={48} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-white group-hover:text-accent">
                              {ch.name}
                            </div>
                            {ch.now ? (
                              <div className="mt-1">
                                <div className="flex items-center gap-1 text-xs text-slate-300 truncate">
                                  <LiveBadge />
                                  <span className="truncate">{ch.now.title}</span>
                                </div>
                                <ProgressBar start={ch.now.start} stop={ch.now.stop} now={now} />
                              </div>
                            ) : (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {ch.categories.slice(0, 3).map((c) => (
                                  <span
                                    key={c}
                                    className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-mute"
                                  >
                                    {c}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                          <button
                            onClick={() => toggleFavorite(ch.id)}
                            className={`p-1 hover:text-rose-400 ${
                              isFav ? 'text-rose-400' : 'text-mute'
                            }`}
                            title={isFav ? 'Remove favorite' : 'Add favorite'}
                          >
                            <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
                          </button>
                          <div className="flex gap-2">
                            <button
                              onClick={() => nav(`/multiview?add=${ch.id}`)}
                              className="flex items-center gap-1 rounded-lg bg-ink-700 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-ink-600 hover:text-white"
                            >
                              <Plus size={12} /> Multi-View
                            </button>
                            <button
                              onClick={() => nav(`/watch/${ch.id}`)}
                              className="flex items-center gap-1 rounded-lg bg-accent-strong px-3 py-1 text-xs font-bold text-white hover:bg-accent"
                            >
                              <Play size={11} fill="currentColor" /> Watch
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="py-12 text-center text-sm text-mute">Country not found</div>
          )}
        </div>
      ) : (
        /* Countries Directory & Region Tabs */
        <div className="space-y-5">
          {/* Controls: Region Tabs + Search */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 overflow-x-auto no-scrollbar">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRegion(r)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    region === r
                      ? 'bg-accent-strong text-white'
                      : 'border border-white/5 bg-ink-800 text-mute hover:text-white'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country..."
                className="w-full rounded-xl bg-ink-800 py-1.5 pl-8 pr-3 text-xs text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>

          {/* Countries Grid */}
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredCountries.map((c) => (
                <button
                  key={c.code}
                  onClick={() => selectCountry(c.code)}
                  className="group flex flex-col items-start justify-between rounded-2xl border border-white/5 bg-ink-850 p-4 text-left hover:border-accent/40 hover:bg-ink-800 hover:shadow-lg transition-all"
                >
                  <div className="w-full">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{c.flag || '🌐'}</span>
                      <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[10px] font-bold text-mute group-hover:bg-accent-strong group-hover:text-white transition-colors">
                        {c.code}
                      </span>
                    </div>
                    <div className="mt-3 truncate text-sm font-bold text-white group-hover:text-accent">
                      {c.name}
                    </div>
                    <div className="text-[11px] text-mute">{c.region}</div>
                  </div>

                  <div className="mt-4 flex w-full items-center justify-between border-t border-white/5 pt-2 text-[11px]">
                    <span className="font-semibold text-slate-300">{c.channels} channels</span>
                    <ChevronRight size={14} className="text-mute group-hover:translate-x-1 group-hover:text-white transition-transform" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
