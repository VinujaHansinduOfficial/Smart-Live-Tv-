import { Mic, MicOff, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import {
  dispatchChannelDelta,
  dispatchNavigate,
  dispatchOpenAi,
  dispatchPlaybackCommand,
  dispatchTuneChannel,
} from '../lib/tvNav'

// Type declaration for browser SpeechRecognition
interface IWindow extends Window {
  webkitSpeechRecognition?: any
  SpeechRecognition?: any
}

export default function VoiceControl() {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const [textFallbackOpen, setTextFallbackOpen] = useState(false)
  const [manualText, setManualText] = useState('')
  const recognitionRef = useRef<any>(null)
  const nav = useNavigate()
  const feedbackTimer = useRef<number | undefined>(undefined)

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 3500)
  }

  const executeVoiceCommand = useCallback(async (text: string) => {
    if (!text.trim()) return
    try {
      const res = await api.voiceCommand(text.trim())
      showFeedback(res.feedback || `Executed: ${text}`)

      if (res.action === 'play_channel' && res.channel_id) {
        dispatchTuneChannel(res.channel_id)
        nav(`/watch/${res.channel_id}`)
      } else if (res.action === 'navigate' && res.route) {
        dispatchNavigate(res.route)
        nav(res.route)
      } else if (res.action === 'next_channel') {
        dispatchChannelDelta(1)
      } else if (res.action === 'prev_channel') {
        dispatchChannelDelta(-1)
      } else if (['play', 'pause', 'mute', 'unmute', 'volume_up', 'volume_down', 'fullscreen'].includes(res.action)) {
        dispatchPlaybackCommand(res.action as any)
      } else if (res.action === 'ai_query') {
        dispatchOpenAi(res.query || text)
      } else if (res.action === 'search' && res.query) {
        nav(`/search?q=${encodeURIComponent(res.query)}`)
      }
    } catch {
      showFeedback(`Command failed: ${text}`)
    }
  }, [nav])

  useEffect(() => {
    const win = window as unknown as IWindow
    const SpeechClass = win.SpeechRecognition || win.webkitSpeechRecognition
    if (!SpeechClass) {
      setSupported(false)
      return
    }

    const rec = new SpeechClass()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onstart = () => {
      setListening(true)
      setTranscript('')
      setInterim('')
    }

    rec.onresult = (e: any) => {
      let finalStr = ''
      let interimStr = ''
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalStr += e.results[i][0].transcript
        } else {
          interimStr += e.results[i][0].transcript
        }
      }
      if (interimStr) setInterim(interimStr)
      if (finalStr) {
        setTranscript(finalStr)
        executeVoiceCommand(finalStr)
      }
    }

    rec.onerror = (e: any) => {
      setListening(false)
      if (e.error !== 'no-speech') {
        showFeedback(`Voice error: ${e.error}`)
      }
    }

    rec.onend = () => {
      setListening(false)
    }

    recognitionRef.current = rec

    const handleExternalTrigger = () => {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.start()
        }
      } catch {
        recognitionRef.current?.stop()
      }
    }

    window.addEventListener('smarttv:trigger_voice', handleExternalTrigger)
    return () => {
      window.removeEventListener('smarttv:trigger_voice', handleExternalTrigger)
      try {
        rec.abort()
      } catch { /* ignore */ }
    }
  }, [executeVoiceCommand])

  const toggleListening = () => {
    if (!supported) {
      setTextFallbackOpen(true)
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
    } else {
      try {
        recognitionRef.current?.start()
      } catch {
        recognitionRef.current?.stop()
      }
    }
  }

  return (
    <>
      <button
        onClick={toggleListening}
        title={listening ? 'Listening... click to stop' : 'Voice control (or press V)'}
        aria-label="Voice control"
        className={`relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all ${
          listening
            ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 ring-2 ring-rose-400 animate-pulse'
            : 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white'
        }`}
      >
        {listening ? <Mic className="animate-bounce" size={15} /> : <Mic size={15} />}
        <span className="hidden sm:inline">{listening ? 'Listening...' : 'Voice'}</span>
      </button>

      {/* Voice feedback toast */}
      {feedback && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/95 px-4 py-2.5 text-sm font-medium text-white shadow-2xl backdrop-blur animate-fade-in">
          <Sparkles size={16} className="text-accent" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Listening HUD Modal */}
      {listening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative mx-4 flex max-w-md flex-col items-center rounded-2xl border border-white/10 bg-ink-900/95 p-8 text-center shadow-2xl">
            <button
              onClick={() => {
                recognitionRef.current?.stop()
                setListening(false)
              }}
              className="absolute right-3 top-3 rounded-lg p-1.5 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 ring-4 ring-rose-500/30 animate-pulse">
              <Mic size={36} />
              <div className="absolute inset-0 rounded-full border-2 border-rose-500/50 animate-ping" />
            </div>

            <h3 className="text-lg font-bold text-white">Listening...</h3>
            <p className="mt-1 text-xs text-mute">
              Say commands like &ldquo;Play BBC News&rdquo;, &ldquo;TV Guide&rdquo;, &ldquo;Mute&rdquo;, or &ldquo;Find science documentaries&rdquo;
            </p>

            <div className="mt-6 flex h-10 items-center justify-center gap-1.5">
              {[40, 70, 95, 60, 85, 50, 90, 65].map((h, i) => (
                <span
                  key={i}
                  className="w-1 rounded-full bg-accent transition-all duration-150 animate-pulse"
                  style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }}
                />
              ))}
            </div>

            <div className="mt-4 min-h-6 text-sm font-semibold text-accent">
              {transcript || interim || 'Listening to your voice...'}
            </div>
          </div>
        </div>
      )}

      {/* Text fallback dialog for browsers without Web Speech */}
      {textFallbackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
            <button
              onClick={() => setTextFallbackOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2 text-base font-bold text-white">
              <MicOff size={18} className="text-amber-400" />
              <span>Voice Command Input</span>
            </div>
            <p className="mt-1 text-xs text-mute">
              Speech recognition is not active in this browser. You can type commands directly (e.g. &ldquo;play BBC News&rdquo;, &ldquo;guide&rdquo;, &ldquo;mute&rdquo;).
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                executeVoiceCommand(manualText)
                setManualText('')
                setTextFallbackOpen(false)
              }}
              className="mt-4 space-y-3"
            >
              <input
                autoFocus
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Type a voice command..."
                className="w-full rounded-xl bg-ink-800 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTextFallbackOpen(false)}
                  className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-mute hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-accent-strong px-4 py-1.5 text-xs font-semibold text-white hover:bg-accent"
                >
                  Run Command
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
