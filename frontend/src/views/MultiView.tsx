import {
  Bookmark,
  Columns,
  Grid,
  Grid2X2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Player from '../components/Player'
import { ChannelLogo, Spinner } from '../components/ui'
import type { Channel, ChannelDetail, MultiviewPreset } from '../types'

type LayoutType = 'dual' | 'triple' | 'quad' | 'focus'

interface Slot {
  channel: ChannelDetail | null
  loading: boolean
}

export default function MultiView() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [layout, setLayout] = useState<LayoutType>('quad')
  const [slots, setSlots] = useState<Slot[]>([
    { channel: null, loading: false },
    { channel: null, loading: false },
    { channel: null, loading: false },
    { channel: null, loading: false },
  ])
  const [activeAudioSlot, setActiveAudioSlot] = useState<number>(0)
  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null)
  const [presets, setPresets] = useState<MultiviewPreset[]>([])
  const [presetModal, setPresetModal] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [fullscreenSlot, setFullscreenSlot] = useState<number | null>(null)

  // Channel Picker search states
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerChannels, setPickerChannels] = useState<Channel[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)

  // Load presets
  const loadPresets = useCallback(async () => {
    try {
      const p = await api.multiviewPresets()
      setPresets(p)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  // Helper to load channel detail into a slot
  const loadChannelIntoSlot = useCallback(async (index: number, channelId: string) => {
    setSlots((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], loading: true }
      return next
    })
    try {
      const detail = await api.channel(channelId)
      setSlots((prev) => {
        const next = [...prev]
        next[index] = { channel: detail, loading: false }
        return next
      })
    } catch {
      setSlots((prev) => {
        const next = [...prev]
        next[index] = { channel: null, loading: false }
        return next
      })
    }
  }, [])

  // Check ?add=channel_id query param
  useEffect(() => {
    const addId = searchParams.get('add')
    if (addId) {
      // Find first empty slot
      const emptyIdx = slots.findIndex((s) => !s.channel)
      const targetIdx = emptyIdx >= 0 ? emptyIdx : 0
      loadChannelIntoSlot(targetIdx, addId)
      // Clean query param
      searchParams.delete('add')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams, slots, loadChannelIntoSlot])

  // Auto-populate default slots if completely empty
  useEffect(() => {
    const hasAny = slots.some((s) => s.channel !== null)
    if (!hasAny) {
      api.channels({ limit: 4 }).then((r) => {
        if (r.items.length >= 1) loadChannelIntoSlot(0, r.items[0].id)
        if (r.items.length >= 2) loadChannelIntoSlot(1, r.items[1].id)
        if (r.items.length >= 3) loadChannelIntoSlot(2, r.items[2].id)
        if (r.items.length >= 4) loadChannelIntoSlot(3, r.items[3].id)
      }).catch(() => undefined)
    }
  }, [loadChannelIntoSlot, slots])

  // Channel picker search
  useEffect(() => {
    if (pickerSlotIndex === null) return
    let alive = true
    setPickerLoading(true)
    api.channels({ q: pickerQuery, limit: 30 })
      .then((r) => {
        if (alive) {
          setPickerChannels(r.items)
          setPickerLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setPickerChannels([])
          setPickerLoading(false)
        }
      })
    return () => { alive = false }
  }, [pickerSlotIndex, pickerQuery])

  const selectChannelForSlot = (channelId: string) => {
    if (pickerSlotIndex !== null) {
      loadChannelIntoSlot(pickerSlotIndex, channelId)
      setPickerSlotIndex(null)
      setPickerQuery('')
    }
  }

  const clearSlot = (index: number) => {
    setSlots((prev) => {
      const next = [...prev]
      next[index] = { channel: null, loading: false }
      return next
    })
  }

  const applyPreset = async (preset: MultiviewPreset) => {
    setLayout(preset.layout as LayoutType)
    // Clear slots first
    setSlots([
      { channel: null, loading: false },
      { channel: null, loading: false },
      { channel: null, loading: false },
      { channel: null, loading: false },
    ])
    for (let i = 0; i < preset.channel_ids.length && i < 4; i++) {
      loadChannelIntoSlot(i, preset.channel_ids[i])
    }
  }

  const saveCurrentPreset = async () => {
    if (!presetName.trim()) return
    const ids = slots.filter((s) => s.channel).map((s) => s.channel!.id)
    if (ids.length === 0) return
    try {
      await api.createMultiviewPreset({
        name: presetName.trim(),
        layout,
        channel_ids: ids,
      })
      setPresetName('')
      setPresetModal(false)
      loadPresets()
    } catch { /* ignore */ }
  }

  const deletePreset = async (id: number) => {
    try {
      await api.deleteMultiviewPreset(id)
      loadPresets()
    } catch { /* ignore */ }
  }

  // Determine slot count per layout
  const activeCount = layout === 'dual' ? 2 : layout === 'triple' ? 3 : 4

  // CSS grid layout class
  const getGridClass = () => {
    if (fullscreenSlot !== null) return 'grid-cols-1'
    switch (layout) {
      case 'dual':
        return 'grid-cols-1 md:grid-cols-2'
      case 'triple':
        return 'grid-cols-1 md:grid-cols-3'
      case 'focus':
        return 'grid-cols-1 md:grid-cols-3'
      case 'quad':
      default:
        return 'grid-cols-1 md:grid-cols-2'
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-850 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-strong text-white shadow-md shadow-accent/20">
            <Grid size={20} />
          </span>
          <div>
            <h2 className="text-base font-bold text-white">Multi-View Television</h2>
            <p className="text-xs text-mute">Watch up to 4 simultaneous live streams • Click any slot for audio</p>
          </div>
        </div>

        {/* Layout Selectors & Presets */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout switches */}
          <div className="inline-flex rounded-xl bg-ink-800 p-1">
            <button
              onClick={() => { setLayout('dual'); setFullscreenSlot(null) }}
              title="Dual Screen (2 channels)"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                layout === 'dual' ? 'bg-ink-600 text-white' : 'text-mute hover:text-white'
              }`}
            >
              <Columns size={14} /> Dual
            </button>
            <button
              onClick={() => { setLayout('triple'); setFullscreenSlot(null) }}
              title="Triple Screen (3 channels)"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                layout === 'triple' ? 'bg-ink-600 text-white' : 'text-mute hover:text-white'
              }`}
            >
              <Grid size={14} /> Triple
            </button>
            <button
              onClick={() => { setLayout('quad'); setFullscreenSlot(null) }}
              title="Quad Screen (4 channels)"
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                layout === 'quad' ? 'bg-ink-600 text-white' : 'text-mute hover:text-white'
              }`}
            >
              <Grid2X2 size={14} /> Quad
            </button>
          </div>

          <button
            onClick={() => setPresetModal(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-ink-700 hover:text-white"
          >
            <Bookmark size={14} /> Save Preset
          </button>
        </div>
      </div>

      {/* Preset Pills */}
      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-mute">Saved Presets:</span>
          {presets.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-800 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-accent hover:text-white"
            >
              <button onClick={() => applyPreset(p)} className="flex items-center gap-1">
                <span>{p.name}</span>
                <span className="rounded bg-ink-700 px-1 text-[10px] text-mute uppercase">{p.layout}</span>
              </button>
              <button
                onClick={() => deletePreset(p.id)}
                className="hidden text-mute hover:text-rose-400 group-hover:block"
                title="Delete preset"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Multi-View Grid */}
      <div className={`grid gap-3.5 ${getGridClass()}`}>
        {slots.slice(0, activeCount).map((slot, idx) => {
          if (fullscreenSlot !== null && fullscreenSlot !== idx) return null
          const isAudioActive = activeAudioSlot === idx

          return (
            <div
              key={idx}
              onClick={() => setActiveAudioSlot(idx)}
              className={`relative flex flex-col overflow-hidden rounded-2xl border transition-all ${
                isAudioActive
                  ? 'border-accent shadow-xl shadow-accent/15 ring-2 ring-accent/30'
                  : 'border-white/5 bg-ink-850 hover:border-white/20'
              }`}
            >
              {/* Slot Header / Controls */}
              <div className="flex items-center justify-between border-b border-white/5 bg-ink-900/90 px-3.5 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`flex h-2.5 w-2.5 rounded-full ${
                      isAudioActive ? 'bg-accent animate-ping' : 'bg-slate-600'
                    }`}
                  />
                  {slot.channel ? (
                    <div className="flex items-center gap-2 truncate">
                      <ChannelLogo src={slot.channel.logo} name={slot.channel.name} size={24} />
                      <span className="truncate text-xs font-bold text-white">{slot.channel.name}</span>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-mute">Slot {idx + 1} • Empty</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Audio Status Indicator */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveAudioSlot(idx)
                    }}
                    className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                      isAudioActive
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-ink-800 text-mute hover:text-slate-200'
                    }`}
                    title={isAudioActive ? 'Audio playing' : 'Click to hear audio from this channel'}
                  >
                    {isAudioActive ? <Volume2 size={12} /> : <VolumeX size={12} />}
                    <span>{isAudioActive ? 'Audio Active' : 'Muted'}</span>
                  </button>

                  {/* Switch channel */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPickerSlotIndex(idx)
                    }}
                    title="Change channel"
                    className="rounded-md bg-ink-800 p-1 text-mute hover:bg-ink-700 hover:text-white"
                  >
                    <RefreshCw size={12} />
                  </button>

                  {/* Fullscreen single slot */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setFullscreenSlot(fullscreenSlot === idx ? null : idx)
                    }}
                    title={fullscreenSlot === idx ? 'Exit slot fullscreen' : 'Maximize slot'}
                    className="rounded-md bg-ink-800 p-1 text-mute hover:bg-ink-700 hover:text-white"
                  >
                    {fullscreenSlot === idx ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </button>

                  {/* Clear slot */}
                  {slot.channel && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        clearSlot(idx)
                      }}
                      title="Clear slot"
                      className="rounded-md bg-ink-800 p-1 text-mute hover:bg-rose-950 hover:text-rose-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Player Body */}
              <div className="relative aspect-video w-full bg-black">
                {slot.channel ? (
                  <Player
                    key={`${slot.channel.id}-${idx}`}
                    streams={slot.channel.streams}
                    autoPlay
                    overlay={
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white drop-shadow">{slot.channel.name}</span>
                        {slot.channel.now && (
                          <span className="text-[10px] text-slate-300 truncate drop-shadow">
                            • {slot.channel.now.title}
                          </span>
                        )}
                      </div>
                    }
                  />
                ) : slot.loading ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Spinner />
                  </div>
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-800 text-mute">
                      <Tv size={24} />
                    </div>
                    <p className="text-xs text-mute">No channel selected in this slot</p>
                    <button
                      onClick={() => setPickerSlotIndex(idx)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-accent-strong px-3.5 py-1.5 text-xs font-bold text-white hover:bg-accent"
                    >
                      <Plus size={14} /> Choose Channel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Channel Picker Modal */}
      {pickerSlotIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="relative mx-4 flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-ink-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4 bg-ink-850">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-strong text-white">
                  <Plus size={16} />
                </span>
                <h3 className="text-sm font-bold text-white">
                  Choose Channel for Slot {pickerSlotIndex + 1}
                </h3>
              </div>
              <button
                onClick={() => setPickerSlotIndex(null)}
                className="rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Search Input */}
            <div className="border-b border-white/5 p-3">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search channels by name, network..."
                  className="w-full rounded-xl bg-ink-800 py-2 pl-9 pr-3 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            {/* Channel List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {pickerLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Spinner />
                </div>
              ) : pickerChannels.length === 0 ? (
                <div className="py-8 text-center text-xs text-mute">No channels found</div>
              ) : (
                pickerChannels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => selectChannelForSlot(c.id)}
                    className="flex w-full items-center justify-between rounded-xl p-2.5 text-left hover:bg-ink-800 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo src={c.logo} name={c.name} size={36} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-white">{c.name}</div>
                        <div className="text-[11px] text-mute truncate">
                          {c.country || 'Global'} • {c.categories.join(', ')}
                        </div>
                      </div>
                    </div>
                    <span className="rounded-lg bg-accent-strong px-2.5 py-1 text-[11px] font-bold text-white">
                      Select
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Preset Modal */}
      {presetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
            <button
              onClick={() => setPresetModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
            <h3 className="text-base font-bold text-white">Save Multi-View Preset</h3>
            <p className="mt-1 text-xs text-mute">
              Save your current combination of channels and layout to easily recall anytime.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveCurrentPreset()
              }}
              className="mt-4 space-y-4"
            >
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset Name (e.g. News Wall, Sports Night)"
                className="w-full rounded-xl bg-ink-800 px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPresetModal(false)}
                  className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-mute hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!presetName.trim()}
                  className="rounded-lg bg-accent-strong px-4 py-1.5 text-xs font-bold text-white hover:bg-accent disabled:opacity-40"
                >
                  Save Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
