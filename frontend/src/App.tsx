import {
  Bell,
  Bookmark,
  CalendarDays,
  Command,
  Compass,
  Download,
  Film,
  Grid,
  HardDrive,
  Heart,
  History as HistoryIcon,
  LogOut,
  RotateCcwClock,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Smartphone,
  Sparkles,
  Tv,
  Users,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AiAssistant from './components/AiAssistant'
import CommandPalette from './components/CommandPalette'
import ReminderToaster from './components/ReminderToaster'
import SyncModal from './components/SyncModal'
import TvRemoteOverlay from './components/TvRemoteOverlay'
import { Spinner } from './components/ui'
import VoiceControl from './components/VoiceControl'
import { SessionProvider, useSession } from './session'
import Catchup from './views/Catchup'
import Downloads from './views/Downloads'
import Guide from './views/Guide'
import History from './views/History'
import MultiView from './views/MultiView'
import ProfilePicker, { Avatar } from './views/ProfilePicker'
import Recordings from './views/Recordings'
import Reminders from './views/Reminders'
import RemoteCompanion from './views/RemoteCompanion'
import Search from './views/Search'
import Settings from './views/Settings'
import Vod from './views/Vod'
import Watch from './views/Watch'
import Watchlist from './views/Watchlist'
import WatchPartyView from './views/WatchPartyView'
import WorldExplorer from './views/WorldExplorer'

function NavIcon({
  to,
  label,
  children,
  badge,
  active,
}: {
  to: string
  label: string
  children: ReactNode
  badge?: number
  active?: boolean
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `relative rounded-lg p-2 transition-colors ${
          active ?? isActive ? 'bg-ink-700 text-white' : 'text-slate-300 hover:bg-ink-800 hover:text-white'
        }`
      }
    >
      {children}
      {!!badge && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-strong px-1 text-[10px] font-bold">
          {badge}
        </span>
      )}
    </NavLink>
  )
}

function Header({
  onOpenAi,
  onOpenSync,
}: {
  onOpenAi: (prompt?: string) => void
  onOpenSync: () => void
}) {
  const { profile, reminders, signOut } = useSession()
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')
  const onSearchPage = loc.pathname === '/search'
  const favPage = onSearchPage && new URLSearchParams(loc.search).get('favorites') === '1'
  const upcoming = reminders.filter((r) => r.status !== 'ended').length

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 md:flex-nowrap">
        <Link to="/" className="flex shrink-0 items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-strong text-white shadow-md shadow-accent/20">
            <Tv size={18} />
          </span>
          <span className="hidden text-base font-bold tracking-tight sm:inline">SMART TV</span>
        </Link>

        {!onSearchPage ? (
          <form
            className="relative order-last w-full md:order-none md:mx-auto md:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault()
              nav(`/search?q=${encodeURIComponent(q)}`)
              setQ('')
            }}
          >
            <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search channels, countries, genres or programmes..."
              className="w-full rounded-xl bg-ink-800 py-2.5 pl-9 pr-3 text-sm outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent"
            />
          </form>
        ) : (
          <div className="hidden flex-1 md:block" />
        )}

        <nav className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
          <NavIcon to="/guide" label="TV Guide">
            <CalendarDays size={18} />
          </NavIcon>
          <NavIcon to="/catchup" label="7-Day Catch-Up (168h)">
            <HistoryIcon size={18} />
          </NavIcon>
          <NavIcon to="/downloads" label="Downloads & Offline Library">
            <Download size={18} />
          </NavIcon>
          <NavIcon to="/vod" label="VOD: Movies & Series">
            <Film size={18} />
          </NavIcon>
          <NavIcon to="/recordings" label="DVR & Recordings">
            <HardDrive size={18} />
          </NavIcon>
          <NavIcon to="/watchlist" label="Universal Watchlist">
            <Bookmark size={18} />
          </NavIcon>
          <NavIcon to="/party" label="Watch Party">
            <Users size={18} />
          </NavIcon>
          <NavIcon to="/multiview" label="Multi-View Television">
            <Grid size={18} />
          </NavIcon>
          <NavIcon to="/world" label="World TV Explorer">
            <Compass size={18} />
          </NavIcon>
          <NavIcon to="/search?favorites=1" label="Favourites" active={favPage}>
            <Heart size={18} />
          </NavIcon>
          <NavIcon to="/history" label="History">
            <RotateCcwClock size={18} />
          </NavIcon>
          <NavIcon to="/reminders" label="Reminders" badge={upcoming}>
            <Bell size={18} />
          </NavIcon>

          {/* Command Palette Trigger */}
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
            aria-label="Command Palette (Ctrl+K)"
            title="Command Palette (Ctrl+K)"
            className="hidden lg:flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-ink-700 hover:text-white transition-colors"
          >
            <Command size={13} />
            <kbd className="font-mono text-[10px] text-mute">⌘K</kbd>
          </button>

          {/* Voice Control Button */}
          <VoiceControl />

          {/* AI Discovery Button */}
          <button
            onClick={() => onOpenAi()}
            aria-label="AI TV Discovery Assistant"
            title="AI TV Assistant (Press A)"
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-strong to-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-md shadow-accent/20 hover:brightness-110 transition-all"
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">AI Find</span>
          </button>

          {/* Device Pairing / Remote button */}
          <button
            onClick={onOpenSync}
            title="Pair Phone as Companion Remote"
            aria-label="Pair Companion Remote"
            className="rounded-lg p-2 text-slate-300 hover:bg-ink-800 hover:text-white transition-colors"
          >
            <Smartphone size={18} />
          </button>

          <NavIcon to="/settings" label="Settings">
            <SettingsIcon size={18} />
          </NavIcon>

          {profile && (
            <button
              onClick={signOut}
              title={`${profile.name} · switch profile`}
              aria-label="Switch profile"
              className="group ml-1 flex items-center gap-1 rounded-lg p-1 hover:bg-ink-800"
            >
              <Avatar name={profile.name} color={profile.color} size={28} />
              <LogOut size={14} className="hidden text-mute group-hover:block" />
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}

function Shell() {
  const { profile, ready } = useSession()
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState<string | undefined>(undefined)
  const [syncOpen, setSyncOpen] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()

  // Handle global TV event bus
  useEffect(() => {
    const handleOpenAi = (e: CustomEvent<{ query?: string }>) => {
      setAiPrompt(e.detail?.query)
      setAiOpen(true)
    }
    const handleNavigate = (e: CustomEvent<{ route: string }>) => {
      nav(e.detail.route)
    }
    window.addEventListener('smarttv:open_ai' as any, handleOpenAi)
    window.addEventListener('smarttv:navigate' as any, handleNavigate)
    return () => {
      window.removeEventListener('smarttv:open_ai' as any, handleOpenAi)
      window.removeEventListener('smarttv:navigate' as any, handleNavigate)
    }
  }, [nav])

  // Allow /remote route even if profile is not signed in yet (since it's a companion remote)
  if (loc.pathname === '/remote') {
    return <RemoteCompanion />
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!profile) return <ProfilePicker />

  return (
    <div className="min-h-full">
      <Header
        onOpenAi={(prompt) => {
          setAiPrompt(prompt)
          setAiOpen(true)
        }}
        onOpenSync={() => setSyncOpen(true)}
      />
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Routes>
          <Route path="/" element={<Watch />} />
          <Route path="/watch/:channelId" element={<Watch />} />
          <Route path="/catchup" element={<Catchup />} />
          <Route path="/catchup/:channelId" element={<Catchup />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/vod" element={<Vod />} />
          <Route path="/vod/:itemId" element={<Vod />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/party" element={<WatchPartyView />} />
          <Route path="/party/:partyId" element={<WatchPartyView />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/multiview" element={<MultiView />} />
          <Route path="/world" element={<WorldExplorer />} />
          <Route path="/remote" element={<RemoteCompanion />} />
          <Route path="/search" element={<Search />} />
          <Route path="/history" element={<History />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Watch />} />
        </Routes>
      </main>

      <ReminderToaster />
      <TvRemoteOverlay />
      <CommandPalette />
      <AiAssistant
        open={aiOpen}
        onClose={() => {
          setAiOpen(false)
          setAiPrompt(undefined)
        }}
        initialPrompt={aiPrompt}
      />
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell />
      </SessionProvider>
    </BrowserRouter>
  )
}
