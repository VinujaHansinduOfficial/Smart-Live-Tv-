import {
  Bookmark,
  CalendarDays,
  Compass,
  Download,
  Film,
  Grid,
  HardDrive,
  History,
  Maximize,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Tv,
  Users,
  Volume2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { Channel } from '../types'

interface CommandItem {
  id: string
  title: string
  subtitle?: string
  icon: any
  action: () => void
  category: 'Navigation' | 'Channels' | 'Actions'
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const nav = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  // Listen for Ctrl+K / Cmd+K or custom event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Focus input when open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
      if (channels.length === 0) {
        api.channels({ limit: 80 }).then((res) => setChannels(res.items)).catch(() => undefined)
      }
    }
  }, [open, channels.length])

  // Navigation commands
  const navCommands: CommandItem[] = useMemo(
    () => [
      {
        id: 'nav-watch',
        title: 'Live TV Player',
        subtitle: 'Watch live broadcast television',
        icon: Tv,
        action: () => {
          nav('/')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-catchup',
        title: '7-Day Catch-Up TV (168h)',
        subtitle: 'Stream direct from provider archives without continuous recording',
        icon: History,
        action: () => {
          nav('/catchup')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-downloads',
        title: 'Download Manager & Offline Library',
        subtitle: 'Save permitted programs and watch offline without internet',
        icon: Download,
        action: () => {
          nav('/downloads')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-vod',
        title: 'VOD: Movies & TV Series',
        subtitle: 'On-demand movies, series, and continue watching',
        icon: Film,
        action: () => {
          nav('/vod')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-recordings',
        title: 'Local DVR & Recordings',
        subtitle: 'View captured programs, storage meter, and schedules',
        icon: HardDrive,
        action: () => {
          nav('/recordings')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-watchlist',
        title: 'Universal Watchlist',
        subtitle: 'Unified bookmarks for live channels, VOD movies, and series',
        icon: Bookmark,
        action: () => {
          nav('/watchlist')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-party',
        title: 'Watch Party & Chat',
        subtitle: 'Watch synced television broadcasts with friends and family',
        icon: Users,
        action: () => {
          nav('/party')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-guide',
        title: 'Electronic Program Guide (EPG)',
        subtitle: 'Multi-channel program grid and schedule timeline',
        icon: CalendarDays,
        action: () => {
          nav('/guide')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-multiview',
        title: 'Multi-View Television',
        subtitle: 'Watch multiple channels simultaneously in dual or quad layout',
        icon: Grid,
        action: () => {
          nav('/multiview')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-world',
        title: 'World TV Explorer',
        subtitle: 'Explore television channels across 150+ countries',
        icon: Compass,
        action: () => {
          nav('/world')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-history',
        title: 'Watch History',
        subtitle: 'Recently played channels and programs',
        icon: RotateCcw,
        action: () => {
          nav('/history')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'nav-settings',
        title: 'Settings & IPTV Sources',
        subtitle: 'Manage M3U, Xtream Codes, and EPG sources',
        icon: Settings,
        action: () => {
          nav('/settings')
          setOpen(false)
        },
        category: 'Navigation',
      },
      {
        id: 'act-ai',
        title: 'AI TV Discovery Assistant',
        subtitle: 'Search television with Gemini AI assistant',
        icon: Sparkles,
        action: () => {
          window.dispatchEvent(new CustomEvent('smarttv:open_ai', { detail: {} }))
          setOpen(false)
        },
        category: 'Actions',
      },
      {
        id: 'act-mute',
        title: 'Toggle Mute',
        subtitle: 'Mute or unmute the current playback',
        icon: Volume2,
        action: () => {
          window.dispatchEvent(
            new CustomEvent('smarttv:playback', { detail: { action: 'toggle_mute' } })
          )
          setOpen(false)
        },
        category: 'Actions',
      },
      {
        id: 'act-fullscreen',
        title: 'Toggle Fullscreen',
        subtitle: 'Switch player into full screen',
        icon: Maximize,
        action: () => {
          window.dispatchEvent(
            new CustomEvent('smarttv:playback', { detail: { action: 'fullscreen' } })
          )
          setOpen(false)
        },
        category: 'Actions',
      },
    ],
    [nav]
  )

  // Channel items
  const channelCommands: CommandItem[] = useMemo(() => {
    return channels.map((c) => ({
      id: `ch-${c.id}`,
      title: c.name,
      subtitle: `${c.country || 'Global'} · ${c.categories[0] || 'General'}`,
      icon: Tv,
      action: () => {
        nav(`/watch/${encodeURIComponent(c.id)}`)
        setOpen(false)
      },
      category: 'Channels',
    }))
  }, [channels, nav])

  // Filter commands
  const filtered = useMemo(() => {
    const all = [...navCommands, ...channelCommands]
    if (!query.trim()) return all.slice(0, 20)
    const q = query.toLowerCase()
    return all
      .filter((item) => item.title.toLowerCase().includes(q) || (item.subtitle && item.subtitle.toLowerCase().includes(q)))
      .slice(0, 25)
  }, [navCommands, channelCommands, query])

  // Arrow key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + (filtered.length || 1)) % (filtered.length || 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action()
      }
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/75 p-4 backdrop-blur-md">
      <div
        className="max-w-2xl w-full rounded-2xl bg-ink-800 border border-white/10 shadow-2xl overflow-hidden animate-fade-in"
        onKeyDown={handleKeyDown}
      >
        <div className="relative border-b border-white/10 p-3 flex items-center gap-3">
          <Search size={18} className="text-mute shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Type a command, channel name, or navigation target... (Esc to close)"
            className="w-full bg-transparent text-sm text-white placeholder-mute outline-none"
          />
          <kbd className="hidden sm:inline-block rounded bg-ink-700 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-300">
            ESC
          </kbd>
        </div>

        <div className="max-h-96 overflow-y-auto scroll-thin p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-mute">
              No matching commands or channels found.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent text-white' : 'text-slate-300 hover:bg-ink-700'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-ink-700 text-slate-300'
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{item.title}</div>
                      {item.subtitle && (
                        <div
                          className={`truncate text-[10px] ${
                            isSelected ? 'text-white/80' : 'text-mute'
                          }`}
                        >
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-ink-700/60 text-mute'
                    }`}
                  >
                    {item.category}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-white/10 bg-ink-900/60 px-4 py-2 flex items-center justify-between text-[11px] text-mute">
          <div className="flex items-center gap-3">
            <span><kbd className="font-mono bg-ink-700 px-1.5 py-0.5 rounded text-[10px]">↑</kbd> <kbd className="font-mono bg-ink-700 px-1.5 py-0.5 rounded text-[10px]">↓</kbd> to navigate</span>
            <span><kbd className="font-mono bg-ink-700 px-1.5 py-0.5 rounded text-[10px]">↵</kbd> to select</span>
          </div>
          <span>SMART TV Quick Palette</span>
        </div>
      </div>
    </div>
  )
}
