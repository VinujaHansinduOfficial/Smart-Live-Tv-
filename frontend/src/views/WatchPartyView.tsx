import {
  MessageSquare,
  Plus,
  Send,
  Share2,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import Player from '../components/Player'
import { ChannelLogo, Empty, Spinner } from '../components/ui'
import type { Channel, WatchParty } from '../types'

export default function WatchPartyView() {
  const [params, setParams] = useSearchParams()
  const partyId = params.get('room')

  const [party, setParty] = useState<WatchParty | null>(null)
  const [loading, setLoading] = useState(false)
  const [msgInput, setMsgInput] = useState('')
  const [createModal, setCreateModal] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.channels({ limit: 60 }).then((res) => {
      setChannels(res.items)
      if (res.items.length > 0) setSelectedChannelId(res.items[0].id)
    })
  }, [])

  // Poll room updates every 2.5s if in party
  useEffect(() => {
    if (!partyId) {
      setParty(null)
      return
    }
    setLoading(true)
    let active = true

    const fetchParty = () => {
      api
        .getWatchParty(partyId)
        .then((res) => {
          if (active) {
            setParty(res)
            setLoading(false)
          }
        })
        .catch(() => {
          if (active) {
            setParty(null)
            setLoading(false)
          }
        })
    }

    fetchParty()
    const timer = setInterval(fetchParty, 2500)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [partyId])

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomName.trim()) return
    try {
      const res = await api.createWatchParty(roomName, selectedChannelId || undefined)
      setCreateModal(false)
      setRoomName('')
      const next = new URLSearchParams(params)
      next.set('room', res.party_id)
      setParams(next, { replace: true })
    } catch {
      // ignore
    }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!partyId || !msgInput.trim()) return
    const text = msgInput.trim()
    setMsgInput('')
    try {
      await api.sendWatchPartyMessage(partyId, text)
      // Instant reload
      const res = await api.getWatchParty(partyId)
      setParty(res)
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-accent to-pink-500 text-white shadow-md">
              <Users size={20} />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Virtual Watch Parties</h1>
          </div>
          <p className="mt-1 text-sm text-mute">
            Watch live broadcasts simultaneously with friends and family with synchronized playback and chat.
          </p>
        </div>

        {!party && (
          <button
            onClick={() => setCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:brightness-110"
          >
            <Plus size={16} /> Create Watch Room
          </button>
        )}
      </div>

      {!partyId ? (
        <div className="rounded-3xl bg-ink-800/80 p-8 border border-white/5 text-center space-y-4 max-w-xl mx-auto my-12">
          <div className="flex justify-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Users size={32} />
            </span>
          </div>
          <h2 className="text-xl font-bold text-white">No Active Watch Party Room</h2>
          <p className="text-sm text-mute">
            Create a watch room to stream live television together, or ask your friend for their 6-character room code.
          </p>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => setCreateModal(true)}
              className="rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-white shadow-md hover:brightness-110"
            >
              Host a Room
            </button>
          </div>
        </div>
      ) : loading && !party ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : !party ? (
        <Empty title="Watch Party Room Not Found">
          This room may have ended or the code is incorrect.
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Main Player Screen */}
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-ink-800/80 p-4 border border-white/5">
              <div className="flex items-center gap-3">
                {party.channel_logo && (
                  <ChannelLogo src={party.channel_logo} name={party.channel_name || ''} size={40} />
                )}
                <div>
                  <h2 className="font-bold text-base text-white">{party.name}</h2>
                  <p className="text-xs text-mute">
                    Room Code: <span className="font-mono font-bold text-accent">{party.party_id}</span> · {party.channel_name || 'Shared Stream'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href)
                    alert('Watch party link copied to clipboard!')
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-ink-600 hover:text-white"
                >
                  <Share2 size={13} /> Invite Link
                </button>
                <button
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.delete('room')
                    setParams(next, { replace: true })
                  }}
                  className="rounded-xl p-1.5 text-mute hover:bg-white/10 hover:text-white"
                  title="Leave Room"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {party.stream_url ? (
              <Player
                streams={[
                  {
                    id: 999988,
                    url: party.stream_url,
                    title: party.name,
                    feed_id: null,
                    quality: '1080p',
                    referrer: null,
                    user_agent: null,
                    labels: ['party'],
                  },
                ]}
                overlay={
                  <span className="text-xs font-semibold text-slate-200">
                    Watch Party: {party.name}
                  </span>
                }
              />
            ) : (
              <div className="aspect-video w-full rounded-2xl bg-ink-800 flex items-center justify-center text-mute text-sm">
                Host has not selected a stream yet.
              </div>
            )}
          </div>

          {/* Room Live Chat */}
          <div className="flex flex-col h-[550px] rounded-2xl bg-ink-800 border border-white/5 overflow-hidden">
            <div className="p-3.5 border-b border-white/5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-mute flex items-center gap-1.5">
                <MessageSquare size={14} /> Room Chat
              </span>
              <span className="text-[10px] text-accent font-semibold">Live Room</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-thin">
              {party.messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-mute">
                  No messages yet. Say hello to the party!
                </div>
              ) : (
                party.messages.map((m) => (
                  <div key={m.id} className="space-y-0.5 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white" style={{ color: m.user_color || '#3b82f6' }}>
                        {m.user_name}
                      </span>
                      <span className="text-[10px] text-mute">
                        {new Date(m.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-200 leading-relaxed bg-ink-700/60 p-2 rounded-xl border border-white/5">
                      {m.message}
                    </p>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="p-2.5 border-t border-white/5 flex gap-2">
              <input
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                placeholder="Message room..."
                className="flex-1 rounded-xl bg-ink-700 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="submit"
                disabled={!msgInput.trim()}
                className="rounded-xl bg-accent px-3 py-2 text-white hover:brightness-110 disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create Room Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateRoom}
            className="max-w-md w-full rounded-2xl bg-ink-800 p-6 border border-white/10 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Create Virtual Watch Party</h2>
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="rounded-lg p-1 text-mute hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300">Room Name</label>
                <input
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g. Saturday Movie Night"
                  required
                  className="mt-1 w-full rounded-xl bg-ink-700 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Broadcast Channel</label>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="mt-1 w-full rounded-xl bg-ink-700 px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-accent"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="rounded-xl bg-ink-700 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-accent px-4 py-2 text-xs font-bold text-white hover:brightness-110 shadow-md"
              >
                Start Party
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
