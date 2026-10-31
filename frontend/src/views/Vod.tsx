import {
  Clapperboard,
  Film,
  Info,
  Play,
  RotateCcw,
  Search,
  Star,
  Tv,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import Player from '../components/Player'
import { Empty, Spinner } from '../components/ui'
import type {
  Stream,
  VodContinueItem,
  VodDetail,
  VodEpisode,
  VodFeaturedResponse,
  VodItem,
} from '../types'

const GENRES = [
  'All',
  'Action',
  'Sci-Fi',
  'Animation',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Classic',
  'Thriller',
  'Family',
]

export default function Vod() {
  const [tab, setTab] = useState<'movies' | 'series'>('movies')
  const [featured, setFeatured] = useState<VodFeaturedResponse | null>(null)
  const [continueItems, setContinueItems] = useState<VodContinueItem[]>([])
  const [selectedGenre, setSelectedGenre] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [items, setItems] = useState<VodItem[]>([])
  const [loading, setLoading] = useState(false)

  // Active detail modal & playback
  const [selectedDetail, setSelectedDetail] = useState<VodDetail | null>(null)
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1)
  const [playingItem, setPlayingItem] = useState<{
    stream: Stream
    title: string
    itemId: string
    seriesId?: string
    initialTime?: number
  } | null>(null)

  // 1. Load featured & continue watching
  useEffect(() => {
    api.vodFeatured().then(setFeatured).catch(() => undefined)
    api.vodContinue().then(setContinueItems).catch(() => undefined)
  }, [])

  // 2. Load movies or series based on tab, genre, and search
  useEffect(() => {
    setLoading(true)
    const genreParam = selectedGenre === 'All' ? undefined : selectedGenre
    const qParam = searchQuery.trim() || undefined

    const promise =
      tab === 'movies'
        ? api.vodMovies({ genre: genreParam, q: qParam, limit: 60 })
        : api.vodSeries({ genre: genreParam, q: qParam, limit: 60 })

    promise
      .then((res) => {
        setItems(res.items)
        setLoading(false)
      })
      .catch(() => {
        setItems([])
        setLoading(false)
      })
  }, [tab, selectedGenre, searchQuery])

  // Open item detail
  const handleOpenDetail = async (item: VodItem) => {
    try {
      const detail = await api.vodItem(item.id)
      setSelectedDetail(detail)
      if (detail.seasons && detail.seasons.length > 0) {
        setSelectedSeasonNum(detail.seasons[0].season_num)
      }
    } catch {
      // fallback
    }
  }

  // Play movie or episode
  const handlePlayMedia = (
    mediaId: string,
    title: string,
    streamUrl: string,
    seriesId?: string,
    resumeSec = 0
  ) => {
    const stream: Stream = {
      id: 888888,
      url: streamUrl,
      title,
      feed_id: null,
      quality: '1080p',
      referrer: null,
      user_agent: null,
      labels: ['vod'],
    }
    setPlayingItem({
      stream,
      title,
      itemId: mediaId,
      seriesId,
      initialTime: resumeSec,
    })
    setSelectedDetail(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Progress update callback to persist watch position
  const handleProgress = useCallback(
    (currentTime: number, duration: number) => {
      if (!playingItem || duration <= 0) return
      // Update backend every ~10s or upon completion
      const completed = duration > 0 && currentTime / duration > 0.92
      api
        .saveVodProgress(
          playingItem.itemId,
          Math.floor(currentTime),
          Math.floor(duration),
          completed,
          playingItem.seriesId
        )
        .catch(() => undefined)
    },
    [playingItem]
  )

  const hero = featured?.hero

  return (
    <div className="space-y-8">
      {/* Active Player if playing a movie/episode */}
      {playingItem && (
        <div className="rounded-2xl bg-ink-900/90 p-4 border border-white/10 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-md">
                <Clapperboard size={18} />
              </span>
              <div>
                <h2 className="font-bold text-white text-base">{playingItem.title}</h2>
                <p className="text-xs text-mute">Playing On-Demand Video</p>
              </div>
            </div>

            <button
              onClick={() => {
                setPlayingItem(null)
                // Refresh continue watching list
                api.vodContinue().then(setContinueItems).catch(() => undefined)
              }}
              className="rounded-lg p-2 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          <Player
            streams={[playingItem.stream]}
            isLive={false}
            initialTime={playingItem.initialTime}
            onProgress={handleProgress}
            overlay={<span className="text-xs font-semibold text-slate-200">{playingItem.title}</span>}
          />
        </div>
      )}

      {/* Hero Banner Showcase */}
      {hero && !playingItem && (
        <div className="relative overflow-hidden rounded-3xl bg-ink-800 border border-white/5 shadow-2xl">
          {hero.backdrop && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30 mix-blend-luminosity blur-[1px]"
              style={{ backgroundImage: `url(${hero.backdrop})` }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/80 to-transparent" />
          <div className="relative z-10 max-w-2xl p-6 sm:p-10 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-strong px-3 py-1 text-xs font-bold text-white shadow-md">
                FEATURED {hero.type.toUpperCase()}
              </span>
              {hero.rating && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-300 border border-amber-500/30">
                  <Star size={12} className="fill-amber-300" /> {hero.rating}
                </span>
              )}
              {hero.genre.map((g) => (
                <span key={g} className="text-xs text-slate-300 opacity-80">
                  {g}
                </span>
              ))}
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              {hero.title}
            </h1>

            {hero.overview && (
              <p className="line-clamp-3 text-sm text-slate-300 leading-relaxed">
                {hero.overview}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {hero.stream_url && (
                <button
                  onClick={() => handlePlayMedia(hero.id, hero.title, hero.stream_url!)}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent-strong px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/20 hover:brightness-110 transition-transform hover:scale-105"
                >
                  <Play size={16} className="fill-white" /> Play Now
                </button>
              )}
              <button
                onClick={() => handleOpenDetail(hero)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/20 backdrop-blur"
              >
                <Info size={16} /> More Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Continue Watching Row */}
      {continueItems.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <RotateCcw size={18} className="text-accent" />
            <h2 className="text-lg font-bold text-white">Continue Watching</h2>
          </div>

          <div className="scroll-thin flex gap-4 overflow-x-auto pb-2">
            {continueItems.map((item) => {
              const progPercent = Math.min(100, Math.round((item.watched_s / (item.total_s || 1)) * 100))
              return (
                <div
                  key={item.item_id}
                  onClick={() => {
                    if (item.stream_url) {
                      handlePlayMedia(
                        item.item_id,
                        item.title,
                        item.stream_url,
                        item.series_id || undefined,
                        item.watched_s
                      )
                    }
                  }}
                  className="group relative w-60 shrink-0 cursor-pointer overflow-hidden rounded-xl bg-ink-800 border border-white/5 hover:border-accent/40 transition-all hover:scale-[1.02] shadow-lg"
                >
                  <div className="relative aspect-video w-full bg-ink-900 overflow-hidden">
                    {item.backdrop || item.poster ? (
                      <img
                        src={item.backdrop || item.poster || ''}
                        alt={item.title}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-mute">
                        <Film size={28} />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-xl">
                        <Play size={20} className="fill-white translate-x-0.5" />
                      </span>
                    </div>
                  </div>

                  {/* Progress Meter Bar */}
                  <div className="h-1 w-full bg-white/10">
                    <div className="h-full bg-accent" style={{ width: `${progPercent}%` }} />
                  </div>

                  <div className="p-3">
                    <h3 className="truncate text-xs font-bold text-white">{item.title}</h3>
                    <div className="flex items-center justify-between text-[11px] text-mute pt-1">
                      <span>{progPercent}% watched</span>
                      {item.duration_min && <span>{item.duration_min} min</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Main Browse Section */}
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Movies vs TV Series Tabs */}
          <div className="inline-flex rounded-xl bg-ink-800 p-1 border border-white/5">
            <button
              onClick={() => setTab('movies')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === 'movies' ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
              }`}
            >
              <Film size={16} /> Movies
            </button>
            <button
              onClick={() => setTab('series')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                tab === 'series' ? 'bg-ink-600 text-white shadow' : 'text-mute hover:text-white'
              }`}
            >
              <Tv size={16} /> TV Series
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${tab === 'movies' ? 'movies' : 'series'}…`}
              className="w-full rounded-xl bg-ink-800 py-2.5 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-accent text-white border border-white/5"
            />
          </div>
        </div>

        {/* Genre Chips */}
        <div className="scroll-thin flex items-center gap-2 overflow-x-auto pb-1">
          {GENRES.map((g) => {
            const isSelected = selectedGenre === g
            return (
              <button
                key={g}
                onClick={() => setSelectedGenre(g)}
                className={`shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  isSelected
                    ? 'bg-accent text-white shadow-sm'
                    : 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white border border-white/5'
                }`}
              >
                {g}
              </button>
            )
          })}
        </div>

        {/* Media Grid */}
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <Empty title={`No ${tab === 'movies' ? 'movies' : 'TV series'} found`}>
            Try selecting another genre or clearing the search filter.
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <div
                key={item.id}
                onClick={() => handleOpenDetail(item)}
                className="group relative cursor-pointer overflow-hidden rounded-2xl bg-ink-800 border border-white/5 hover:border-accent/40 transition-all hover:scale-[1.02] shadow-lg flex flex-col"
              >
                <div className="relative aspect-[2/3] w-full bg-ink-900 overflow-hidden">
                  {item.poster ? (
                    <img
                      src={item.poster}
                      alt={item.title}
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-mute">
                      <Film size={36} />
                    </div>
                  )}

                  {/* Rating Tag */}
                  {item.rating && (
                    <span className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
                      <Star size={10} className="fill-amber-300" /> {item.rating}
                    </span>
                  )}

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-xl">
                      <Play size={20} className="fill-white translate-x-0.5" />
                    </span>
                  </div>
                </div>

                <div className="p-3 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="truncate text-xs font-bold text-white group-hover:text-accent transition-colors">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-2 pt-1 text-[11px] text-mute">
                      {item.release_date && <span>{item.release_date.slice(0, 4)}</span>}
                      {item.duration_min && <span>{item.duration_min} min</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Media Detail & Season/Episode Modal */}
      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md overflow-y-auto">
          <div className="max-w-3xl w-full rounded-3xl bg-ink-800 border border-white/10 shadow-2xl overflow-hidden my-8">
            {/* Header backdrop */}
            <div className="relative h-56 sm:h-72 w-full bg-ink-900 overflow-hidden">
              {selectedDetail.backdrop && (
                <img
                  src={selectedDetail.backdrop}
                  alt={selectedDetail.title}
                  className="h-full w-full object-cover opacity-40 mix-blend-luminosity"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-800 via-ink-800/60 to-transparent" />
              <button
                onClick={() => setSelectedDetail(null)}
                className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black/90 backdrop-blur"
              >
                <X size={18} />
              </button>

              <div className="absolute bottom-4 left-6 right-6 flex items-end justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-bold text-accent border border-accent/30 uppercase">
                      {selectedDetail.type}
                    </span>
                    {selectedDetail.rating && (
                      <span className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                        <Star size={11} className="fill-amber-300" /> {selectedDetail.rating}
                      </span>
                    )}
                    {selectedDetail.release_date && (
                      <span className="text-xs text-mute">{selectedDetail.release_date.slice(0, 4)}</span>
                    )}
                    {selectedDetail.duration_min && (
                      <span className="text-xs text-mute">{selectedDetail.duration_min} min</span>
                    )}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                    {selectedDetail.title}
                  </h2>
                </div>

                {selectedDetail.type === 'movie' && selectedDetail.stream_url && (
                  <button
                    onClick={() =>
                      handlePlayMedia(
                        selectedDetail.id,
                        selectedDetail.title,
                        selectedDetail.stream_url!,
                        undefined,
                        selectedDetail.progress?.watched_s || 0
                      )
                    }
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-accent-strong px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:brightness-110"
                  >
                    <Play size={14} className="fill-white" />
                    {selectedDetail.progress && !selectedDetail.progress.completed
                      ? 'Resume Movie'
                      : 'Play Movie'}
                  </button>
                )}
              </div>
            </div>

            {/* Modal Body: Overview & Genres */}
            <div className="p-6 space-y-5">
              <div className="flex flex-wrap gap-1.5">
                {selectedDetail.genre.map((g) => (
                  <span
                    key={g}
                    className="rounded-full bg-ink-700 px-3 py-1 text-xs font-semibold text-slate-300"
                  >
                    {g}
                  </span>
                ))}
              </div>

              {selectedDetail.overview && (
                <p className="text-sm leading-relaxed text-slate-200">
                  {selectedDetail.overview}
                </p>
              )}

              {/* Series Seasons and Episodes */}
              {selectedDetail.type === 'series' && selectedDetail.seasons && (
                <div className="space-y-4 pt-3 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-white text-sm">Episodes</h3>
                    {selectedDetail.seasons.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        {selectedDetail.seasons.map((s) => (
                          <button
                            key={s.season_num}
                            onClick={() => setSelectedSeasonNum(s.season_num)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                              selectedSeasonNum === s.season_num
                                ? 'bg-accent text-white'
                                : 'bg-ink-700 text-slate-300 hover:bg-ink-600'
                            }`}
                          >
                            Season {s.season_num}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin pr-1">
                    {selectedDetail.seasons
                      .find((s) => s.season_num === selectedSeasonNum)
                      ?.episodes.map((ep: VodEpisode) => (
                        <div
                          key={ep.id}
                          onClick={() =>
                            handlePlayMedia(
                              ep.id,
                              `${selectedDetail.title} - S${ep.season_num}E${ep.episode_num}: ${ep.title}`,
                              ep.stream_url,
                              selectedDetail.id
                            )
                          }
                          className="flex items-center justify-between gap-3 rounded-xl bg-ink-700/60 p-3 hover:bg-ink-700 cursor-pointer border border-white/5 hover:border-accent/30 transition-all group"
                        >
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-accent">
                                E{ep.episode_num}
                              </span>
                              <h4 className="text-xs font-bold text-white truncate">{ep.title}</h4>
                            </div>
                            {ep.overview && (
                              <p className="line-clamp-1 text-[11px] text-mute">{ep.overview}</p>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-3">
                            {ep.duration_min && (
                              <span className="text-[11px] text-mute">{ep.duration_min} min</span>
                            )}
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 group-hover:bg-accent text-white transition-colors">
                              <Play size={12} className="fill-white translate-x-0.5" />
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
