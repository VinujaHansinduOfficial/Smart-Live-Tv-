import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Grid,
  Home,
  LayoutGrid,
  Maximize,
  Mic,
  Power,
  Sparkles,
  Tv,
  VolumeX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'

export default function RemoteCompanion() {
  const [params] = useSearchParams()
  const initialCode = params.get('code') || ''

  const [code, setCode] = useState(initialCode)
  const [pairedCode, setPairedCode] = useState<string | null>(null)
  const [pairedName, setPairedName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [voiceListening, setVoiceListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Auto-connect if ?code= is provided in URL
  useEffect(() => {
    if (initialCode && !pairedCode) {
      connectWithCode(initialCode)
    }
  }, [initialCode])

  const showToast = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 2000)
  }

  const connectWithCode = async (c: string) => {
    if (!c.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.pairDevice(c.trim().toUpperCase(), 'Mobile Companion')
      setPairedCode(res.code)
      setPairedName(res.profile_name)
      showToast(`Connected to TV!`)
    } catch (err: any) {
      setError(err.message || 'Failed to connect. Check code.')
    } finally {
      setLoading(false)
    }
  }

  const send = async (command: string, payload: Record<string, unknown> = {}) => {
    if (!pairedCode) return
    try {
      // Vibrate if supported for tactile feedback
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(35)
      }
      await api.sendCommand(pairedCode, command, payload)
      showToast(`Sent: ${command}`)
    } catch {
      showToast('Failed to reach TV')
    }
  }

  // Voice command from phone
  const togglePhoneVoice = () => {
    const win = window as any
    const SpeechClass = win.SpeechRecognition || win.webkitSpeechRecognition
    if (!SpeechClass) {
      alert('Speech recognition is not available in this mobile browser.')
      return
    }

    if (voiceListening) {
      recognitionRef.current?.stop()
      setVoiceListening(false)
      return
    }

    const rec = new SpeechClass()
    rec.continuous = false
    rec.lang = 'en-US'
    rec.onstart = () => setVoiceListening(true)
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript
      if (text) {
        send('voice_command', { text })
        showToast(`Voice: "${text}"`)
      }
    }
    rec.onerror = () => setVoiceListening(false)
    rec.onend = () => setVoiceListening(false)
    recognitionRef.current = rec
    rec.start()
  }

  if (!pairedCode) {
    return (
      <div className="mx-auto max-w-sm px-4 py-8">
        <div className="flex flex-col items-center rounded-3xl border border-white/10 bg-ink-850 p-6 text-center shadow-2xl">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-lg shadow-accent/30 mb-4">
            <Tv size={32} />
          </div>
          <h2 className="text-xl font-bold text-white">Smart TV Remote</h2>
          <p className="mt-1 text-xs text-mute">
            Enter the 6-character code displayed on your TV screen to pair this phone.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              connectWithCode(code)
            }}
            className="mt-6 w-full space-y-4"
          >
            <input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. TV-8492"
              className="w-full text-center font-mono text-2xl font-bold tracking-widest rounded-xl bg-ink-800 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent uppercase"
              maxLength={10}
            />
            {error && <p className="text-xs font-semibold text-rose-400">{error}</p>}
            <button
              type="submit"
              disabled={!code.trim() || loading}
              className="w-full rounded-xl bg-accent-strong py-3 text-sm font-bold text-white hover:bg-accent disabled:opacity-40 transition-colors"
            >
              {loading ? 'Connecting...' : 'Connect to TV'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xs px-2 py-4 select-none">
      {/* Remote Chassis */}
      <div className="flex flex-col rounded-[2.5rem] border border-white/10 bg-ink-900 p-5 shadow-2xl">
        {/* Connection Bar */}
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-bold text-white">{pairedName ? `${pairedName} (${pairedCode})` : pairedCode}</span>
          </div>
          <button
            onClick={() => setPairedCode(null)}
            className="text-[11px] text-mute hover:text-white"
          >
            Disconnect
          </button>
        </div>

        {/* Top Control Bar */}
        <div className="mt-4 flex items-center justify-between px-2">
          <button
            onClick={() => send('power')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600/20 text-rose-400 active:scale-90 transition-transform"
          >
            <Power size={18} />
          </button>
          <button
            onClick={() => send('toggle_mute')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-800 text-slate-300 active:scale-90 transition-transform"
          >
            <VolumeX size={18} />
          </button>
          <button
            onClick={() => send('fullscreen')}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-800 text-slate-300 active:scale-90 transition-transform"
          >
            <Maximize size={18} />
          </button>
        </div>

        {/* Quick Apps Grid */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          <button
            onClick={() => send('navigate', { route: '/' })}
            className="flex flex-col items-center justify-center rounded-2xl bg-ink-800 py-2.5 text-[10px] text-mute active:bg-ink-700 active:text-white"
          >
            <Home size={16} /> Home
          </button>
          <button
            onClick={() => send('navigate', { route: '/guide' })}
            className="flex flex-col items-center justify-center rounded-2xl bg-ink-800 py-2.5 text-[10px] text-mute active:bg-ink-700 active:text-white"
          >
            <LayoutGrid size={16} /> Guide
          </button>
          <button
            onClick={() => send('navigate', { route: '/multiview' })}
            className="flex flex-col items-center justify-center rounded-2xl bg-ink-800 py-2.5 text-[10px] text-mute active:bg-ink-700 active:text-white"
          >
            <Grid size={16} /> Multi
          </button>
          <button
            onClick={() => send('navigate', { route: '/world' })}
            className="flex flex-col items-center justify-center rounded-2xl bg-ink-800 py-2.5 text-[10px] text-mute active:bg-ink-700 active:text-white"
          >
            <Compass size={16} /> World
          </button>
        </div>

        {/* Tactile D-Pad Navigation Circle */}
        <div className="mt-6 flex flex-col items-center">
          <button
            onClick={() => send('channel_up')}
            className="flex h-12 w-20 items-center justify-center rounded-t-2xl bg-ink-800 text-slate-300 active:bg-ink-700 active:text-white active:scale-95"
          >
            <ChevronUp size={24} />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => send('volume_down')}
              className="flex h-20 w-12 items-center justify-center rounded-l-2xl bg-ink-800 text-slate-300 active:bg-ink-700 active:text-white active:scale-95"
            >
              <ChevronLeft size={24} />
            </button>
            <button
              onClick={() => send('toggle_play')}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-strong text-white font-extrabold text-sm shadow-xl shadow-accent/40 active:scale-90"
            >
              OK
            </button>
            <button
              onClick={() => send('volume_up')}
              className="flex h-20 w-12 items-center justify-center rounded-r-2xl bg-ink-800 text-slate-300 active:bg-ink-700 active:text-white active:scale-95"
            >
              <ChevronRight size={24} />
            </button>
          </div>
          <button
            onClick={() => send('channel_down')}
            className="flex h-12 w-20 items-center justify-center rounded-b-2xl bg-ink-800 text-slate-300 active:bg-ink-700 active:text-white active:scale-95"
          >
            <ChevronDown size={24} />
          </button>
        </div>

        {/* Volume & Channel Rockers */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center rounded-2xl bg-ink-800 p-2">
            <span className="text-[10px] font-bold uppercase text-mute mb-1">Vol</span>
            <button
              onClick={() => send('volume_up')}
              className="flex h-10 w-full items-center justify-center rounded-xl bg-ink-700 text-sm font-bold text-white active:scale-95"
            >
              +
            </button>
            <button
              onClick={() => send('volume_down')}
              className="mt-1 flex h-10 w-full items-center justify-center rounded-xl bg-ink-700 text-sm font-bold text-white active:scale-95"
            >
              -
            </button>
          </div>

          <div className="flex flex-col items-center rounded-2xl bg-ink-800 p-2">
            <span className="text-[10px] font-bold uppercase text-mute mb-1">Channel</span>
            <button
              onClick={() => send('channel_up')}
              className="flex h-10 w-full items-center justify-center rounded-xl bg-ink-700 text-xs font-bold text-white active:scale-95"
            >
              CH +
            </button>
            <button
              onClick={() => send('channel_down')}
              className="mt-1 flex h-10 w-full items-center justify-center rounded-xl bg-ink-700 text-xs font-bold text-white active:scale-95"
            >
              CH -
            </button>
          </div>
        </div>

        {/* Mobile Voice & AI Buttons */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            onClick={togglePhoneVoice}
            className={`flex items-center justify-center gap-2 rounded-2xl py-3 text-xs font-bold text-white shadow-lg transition-all ${
              voiceListening
                ? 'bg-rose-600 animate-pulse ring-2 ring-rose-400'
                : 'bg-rose-500/80 active:scale-95'
            }`}
          >
            <Mic size={16} />
            <span>{voiceListening ? 'Speaking...' : 'Voice Mic'}</span>
          </button>

          <button
            onClick={() => send('open_ai')}
            className="flex items-center justify-center gap-2 rounded-2xl bg-accent-strong py-3 text-xs font-bold text-white shadow-lg shadow-accent/20 active:scale-95"
          >
            <Sparkles size={16} />
            <span>AI Discover</span>
          </button>
        </div>
      </div>

      {/* Floating feedback toast */}
      {feedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink-900/90 px-4 py-1.5 text-xs font-medium text-accent border border-white/10 shadow-xl backdrop-blur">
          {feedback}
        </div>
      )}
    </div>
  )
}
