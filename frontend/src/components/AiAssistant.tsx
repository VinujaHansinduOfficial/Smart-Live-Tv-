import { Clock, Heart, Loader2, Play, Plus, Send, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { ChannelLogo, LiveBadge, ProgressBar } from '../components/ui'
import { fmtRange } from '../lib/time'
import { useNow, useSession } from '../session'
import type { AiDiscoveryResponse, Channel, ProgrammeHit } from '../types'

const PROMPT_SUGGESTIONS = [
  'What science & nature documentaries are on now?',
  'Find live sports events airing right now',
  'Show international breaking news in English',
  'Find kids cartoons and animated movies',
  'Top music channels around the world',
]

interface Message {
  role: 'user' | 'assistant'
  content: string
  channels?: Channel[]
  programmes?: ProgrammeHit[]
  source?: string
}

export default function AiAssistant({
  open,
  onClose,
  initialPrompt,
}: {
  open: boolean
  onClose: () => void
  initialPrompt?: string
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hi! I am your Smart TV AI Assistant. Ask me to find any channels, live sports, documentaries, or programmes currently airing across the world.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()
  const now = useNow(30_000)
  const { favoriteIds, toggleFavorite } = useSession()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendPrompt = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q || loading) return
      setInput('')
      const userMsg: Message = { role: 'user', content: q }
      setMessages((prev) => [...prev, userMsg])
      setLoading(true)

      try {
        const history = messages.slice(-4).map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          content: m.content,
        }))
        const res: AiDiscoveryResponse = await api.discover(q, history)
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: res.reply,
            channels: res.channels,
            programmes: res.programmes,
            source: res.source,
          },
        ])
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Sorry, I encountered an issue: ${err.message || 'Please try again.'}`,
          },
        ])
      } finally {
        setLoading(false)
      }
    },
    [loading, messages]
  )

  useEffect(() => {
    if (open && initialPrompt) {
      sendPrompt(initialPrompt)
    }
  }, [open, initialPrompt, sendPrompt])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-ink-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 bg-ink-850">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-accent-strong to-indigo-500 text-white shadow-md shadow-accent/20">
              <Sparkles size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">AI TV Discovery</h3>
                <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                  Gemini Grounded
                </span>
              </div>
              <p className="text-[11px] text-mute">Searches live IPTV catalog & real-time schedules</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-mute hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${
                  m.role === 'user'
                    ? 'bg-accent-strong text-white'
                    : 'border border-white/5 bg-ink-800 text-slate-200'
                }`}
              >
                {m.content}
              </div>

              {/* Matched Channel Cards */}
              {m.channels && m.channels.length > 0 && (
                <div className="mt-3 w-full space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-mute">
                    Playable Channels ({m.channels.length})
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {m.channels.map((ch) => {
                      const isFav = favoriteIds.has(ch.id)
                      return (
                        <div
                          key={ch.id}
                          className="group relative flex flex-col justify-between rounded-xl border border-white/5 bg-ink-850 p-3 hover:border-accent/40 hover:bg-ink-800 transition-all"
                        >
                          <div className="flex items-start gap-2.5">
                            <ChannelLogo src={ch.logo} name={ch.name} size={40} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-bold text-white">{ch.name}</span>
                                {ch.country && (
                                  <span className="shrink-0 text-[10px] text-mute">{ch.country}</span>
                                )}
                              </div>
                              {ch.now ? (
                                <div className="mt-1">
                                  <div className="flex items-center gap-1 text-[11px] text-slate-300 truncate">
                                    <LiveBadge />
                                    <span className="truncate">{ch.now.title}</span>
                                  </div>
                                  <ProgressBar start={ch.now.start} stop={ch.now.stop} now={now} />
                                </div>
                              ) : (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {ch.categories.slice(0, 2).map((cat) => (
                                    <span
                                      key={cat}
                                      className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] text-mute"
                                    >
                                      {cat}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                            <button
                              onClick={() => toggleFavorite(ch.id)}
                              className={`p-1 hover:text-rose-400 ${
                                isFav ? 'text-rose-400' : 'text-mute'
                              }`}
                              title={isFav ? 'Remove favorite' : 'Add favorite'}
                            >
                              <Heart size={14} fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  onClose()
                                  nav(`/multiview?add=${ch.id}`)
                                }}
                                className="flex items-center gap-1 rounded bg-ink-700 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-ink-600 hover:text-white"
                                title="Add to Multi-View"
                              >
                                <Plus size={11} /> Multi-View
                              </button>
                              <button
                                onClick={() => {
                                  onClose()
                                  nav(`/watch/${ch.id}`)
                                }}
                                className="flex items-center gap-1 rounded bg-accent-strong px-2.5 py-1 text-[10px] font-bold text-white hover:bg-accent"
                              >
                                <Play size={10} fill="currentColor" /> Watch
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Matched Programme Cards */}
              {m.programmes && m.programmes.length > 0 && (
                <div className="mt-3 w-full space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-mute">
                    Scheduled Programmes ({m.programmes.length})
                  </div>
                  <div className="space-y-1.5">
                    {m.programmes.map((p) => {
                      const isAiring = p.start <= now && now < p.stop
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-xl border border-white/5 bg-ink-850 p-2.5 hover:bg-ink-800 transition-colors"
                        >
                          <div className="min-w-0 flex-1 pr-3">
                            <div className="flex items-center gap-2">
                              {isAiring && <LiveBadge />}
                              <span className="truncate text-xs font-bold text-white">{p.title}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-mute">
                              <span>{p.channel.name}</span>
                              <span>•</span>
                              <span className="flex items-center gap-0.5">
                                <Clock size={10} /> {fmtRange(p.start, p.stop)}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              onClose()
                              nav(`/watch/${p.channel.id}`)
                            }}
                            className="flex shrink-0 items-center gap-1 rounded bg-accent-strong px-2.5 py-1 text-[10px] font-bold text-white hover:bg-accent"
                          >
                            <Play size={10} fill="currentColor" /> Tune
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-ink-800/80 p-3 text-xs text-mute">
              <Loader2 size={16} className="animate-spin text-accent" />
              <span>Searching channel catalog and live programme guides...</span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Suggestion Chips */}
        <div className="border-t border-white/5 px-4 py-2 bg-ink-900/60 overflow-x-auto no-scrollbar">
          <div className="flex gap-1.5 whitespace-nowrap">
            {PROMPT_SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                onClick={() => sendPrompt(s)}
                className="rounded-full border border-white/10 bg-ink-800 px-3 py-1 text-[11px] text-slate-300 hover:border-accent hover:text-white transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendPrompt(input)
          }}
          className="border-t border-white/10 p-3 bg-ink-850 flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about live channels, shows, topics, countries..."
            className="flex-1 rounded-xl bg-ink-800 px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-strong text-white hover:bg-accent disabled:opacity-40 transition-colors"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
