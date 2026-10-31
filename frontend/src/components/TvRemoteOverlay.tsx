import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Grid,
  HelpCircle,
  Home,
  LayoutGrid,
  Mic,
  Monitor,
  Sparkles,
  Tv,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  dispatchChannelDelta,
  dispatchOpenAi,
  dispatchPlaybackCommand,
  dispatchTriggerVoice,
  isTvMode,
  setTvMode,
} from '../lib/tvNav'

export default function TvRemoteOverlay() {
  const [openDock, setOpenDock] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [tvModeActive, setTvModeActive] = useState(isTvMode())
  const nav = useNavigate()

  useEffect(() => {
    // Initialize tv-mode class on body
    if (tvModeActive) {
      document.documentElement.classList.add('tv-mode')
    } else {
      document.documentElement.classList.remove('tv-mode')
    }
  }, [tvModeActive])

  // Global keyboard shortcuts for TV navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return

      if (e.key === '?') {
        e.preventDefault()
        setShowHelp((prev) => !prev)
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        dispatchTriggerVoice()
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        dispatchOpenAi()
      } else if (e.key === 'g' || e.key === 'G') {
        e.preventDefault()
        nav('/guide')
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        dispatchPlaybackCommand('toggle_mute')
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        dispatchPlaybackCommand('fullscreen')
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        dispatchPlaybackCommand('toggle_play')
      } else if (e.key === 'ArrowUp') {
        // Spatial navigation up
      } else if (e.key === 'ArrowDown') {
        // Spatial navigation down
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nav])

  const toggleTvMode = () => {
    const next = !tvModeActive
    setTvModeActive(next)
    setTvMode(next)
  }

  return (
    <>
      {/* Remote & TV Mode floating dock button */}
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2">
        <button
          onClick={toggleTvMode}
          title={tvModeActive ? 'Exit 10-Foot TV Mode' : 'Switch to 10-Foot TV Mode'}
          className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold shadow-xl backdrop-blur transition-all ${
            tvModeActive
              ? 'bg-accent text-white ring-2 ring-accent-strong shadow-accent/40'
              : 'bg-ink-800/90 text-slate-300 hover:bg-ink-700 hover:text-white'
          }`}
        >
          <Monitor size={15} />
          <span className="hidden sm:inline">{tvModeActive ? 'TV Mode ON' : 'TV Mode'}</span>
        </button>

        <button
          onClick={() => setOpenDock((prev) => !prev)}
          title="Virtual TV Remote"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-800/95 text-slate-200 shadow-xl backdrop-blur hover:bg-ink-700 hover:text-white ring-1 ring-white/10"
        >
          <Tv size={18} />
        </button>
      </div>

      {/* Virtual Remote Control Dock */}
      {openDock && (
        <div className="fixed bottom-16 right-4 z-50 w-72 rounded-3xl border border-white/10 bg-ink-900/95 p-5 shadow-2xl backdrop-blur animate-fade-in">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-strong text-white">
                <Tv size={12} />
              </span>
              <span className="text-xs font-bold text-white uppercase tracking-wider">Smart Remote</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowHelp(true)}
                title="Shortcuts guide"
                className="p-1 text-mute hover:text-white"
              >
                <HelpCircle size={15} />
              </button>
              <button
                onClick={() => setOpenDock(false)}
                className="p-1 text-mute hover:text-white"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Quick Nav Row */}
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            <button
              onClick={() => nav('/')}
              className="flex flex-col items-center justify-center rounded-xl bg-ink-800 py-2 text-[10px] text-mute hover:bg-ink-700 hover:text-white"
            >
              <Home size={14} /> Home
            </button>
            <button
              onClick={() => nav('/guide')}
              className="flex flex-col items-center justify-center rounded-xl bg-ink-800 py-2 text-[10px] text-mute hover:bg-ink-700 hover:text-white"
            >
              <LayoutGrid size={14} /> Guide
            </button>
            <button
              onClick={() => nav('/multiview')}
              className="flex flex-col items-center justify-center rounded-xl bg-ink-800 py-2 text-[10px] text-mute hover:bg-ink-700 hover:text-white"
            >
              <Grid size={14} /> Multi
            </button>
            <button
              onClick={() => nav('/world')}
              className="flex flex-col items-center justify-center rounded-xl bg-ink-800 py-2 text-[10px] text-mute hover:bg-ink-700 hover:text-white"
            >
              <Compass size={14} /> World
            </button>
          </div>

          {/* D-Pad */}
          <div className="mt-5 flex flex-col items-center">
            <button
              onClick={() => dispatchChannelDelta(-1)}
              className="flex h-9 w-14 items-center justify-center rounded-t-xl bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white active:scale-95"
            >
              <ChevronUp size={18} />
            </button>
            <div className="flex items-center gap-1">
              <button
                onClick={() => dispatchPlaybackCommand('volume_down')}
                className="flex h-14 w-9 items-center justify-center rounded-l-xl bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white active:scale-95"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => dispatchPlaybackCommand('toggle_play')}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-strong text-white font-bold text-xs hover:bg-accent active:scale-90 shadow-md shadow-accent/30"
              >
                OK
              </button>
              <button
                onClick={() => dispatchPlaybackCommand('volume_up')}
                className="flex h-14 w-9 items-center justify-center rounded-r-xl bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white active:scale-95"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              onClick={() => dispatchChannelDelta(1)}
              className="flex h-9 w-14 items-center justify-center rounded-b-xl bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white active:scale-95"
            >
              <ChevronDown size={18} />
            </button>
          </div>

          {/* Volume & Channel controls */}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-2xl bg-ink-800 p-2 text-center">
              <span className="text-[10px] font-bold text-mute uppercase">Volume</span>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => dispatchPlaybackCommand('volume_down')}
                  className="rounded-lg bg-ink-700 p-2 hover:bg-ink-600 hover:text-white"
                >
                  -
                </button>
                <button
                  onClick={() => dispatchPlaybackCommand('toggle_mute')}
                  className="rounded-lg bg-ink-700 p-2 hover:bg-ink-600 hover:text-white"
                >
                  <VolumeX size={14} />
                </button>
                <button
                  onClick={() => dispatchPlaybackCommand('volume_up')}
                  className="rounded-lg bg-ink-700 p-2 hover:bg-ink-600 hover:text-white"
                >
                  +
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-2xl bg-ink-800 p-2 text-center">
              <span className="text-[10px] font-bold text-mute uppercase">Channel</span>
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={() => dispatchChannelDelta(-1)}
                  className="flex-1 rounded-lg bg-ink-700 py-2 text-xs font-bold hover:bg-ink-600 hover:text-white"
                >
                  CH-
                </button>
                <button
                  onClick={() => dispatchChannelDelta(1)}
                  className="flex-1 rounded-lg bg-ink-700 py-2 text-xs font-bold hover:bg-ink-600 hover:text-white"
                >
                  CH+
                </button>
              </div>
            </div>
          </div>

          {/* Voice & AI Discovery Row */}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => dispatchTriggerVoice()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500 shadow-md shadow-rose-600/30"
            >
              <Mic size={14} /> Voice
            </button>
            <button
              onClick={() => dispatchOpenAi()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-strong py-2 text-xs font-bold text-white hover:bg-accent shadow-md shadow-accent/30"
            >
              <Sparkles size={14} /> AI Find
            </button>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Cheatsheet Modal */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
            <button
              onClick={() => setShowHelp(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-strong text-white">
                <Tv size={16} />
              </span>
              <h3 className="text-base font-bold text-white">TV Remote & Keyboard Shortcuts</h3>
            </div>
            <div className="mt-4 divide-y divide-white/5 text-xs text-slate-300">
              <div className="flex justify-between py-2">
                <span>Play / Pause</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">Space</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>Mute / Unmute</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">M</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>Full Screen</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">F</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>Voice Command</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">V</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>AI TV Assistant</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">A</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>TV Guide</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">G</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span>Next / Previous Channel</span>
                <kbd className="rounded bg-ink-800 px-2 py-0.5 font-mono text-white">CH+ / CH-</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
