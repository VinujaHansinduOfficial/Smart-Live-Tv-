import { BellRing, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { fmtRelative, fmtTime } from '../lib/time'
import { useSession } from '../session'
import type { Reminder } from '../types'
import { ChannelLogo } from './ui'

const POLL_MS = 30_000

/** Polls for due reminders and shows them as toasts (plus a system notification if allowed). */
export default function ReminderToaster() {
  const { profile, refreshReminders } = useSession()
  const [due, setDue] = useState<Reminder[]>([])
  const notified = useRef(new Set<number>())
  const nav = useNavigate()

  const poll = useCallback(async () => {
    try {
      const items = await api.dueReminders()
      setDue(items)
      for (const r of items) {
        if (notified.current.has(r.id)) continue
        notified.current.add(r.id)
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
          const n = new Notification(r.title, {
            body: `${r.channel_name ?? r.channel_id} · ${r.status === 'airing' ? 'on now' : `starts ${fmtTime(r.start)}`}`,
            tag: `reminder-${r.id}`,
          })
          n.onclick = () => { window.focus(); nav(`/watch/${encodeURIComponent(r.channel_id)}`) }
        }
      }
    } catch { /* offline or signed out */ }
  }, [nav])

  useEffect(() => {
    if (!profile) return
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [profile, poll])

  const dismiss = async (r: Reminder) => {
    setDue((d) => d.filter((x) => x.id !== r.id))
    await api.dismissReminder(r.id).catch(() => undefined)
    refreshReminders().catch(() => undefined)
  }

  if (!due.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-40 flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
      {due.map((r) => (
        <div key={r.id} className="rounded-xl bg-ink-800 p-3 shadow-2xl ring-1 ring-accent/40">
          <div className="flex items-start gap-3">
            <ChannelLogo src={r.channel_logo} name={r.channel_name ?? r.channel_id} size={36} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-accent"><BellRing size={12} />
                {r.status === 'airing' ? 'On now' : `Starts ${fmtRelative(r.start)}`}</p>
              <p className="truncate font-semibold">{r.title}</p>
              <p className="truncate text-xs text-mute">{r.channel_name ?? r.channel_id} · {fmtTime(r.start)}</p>
            </div>
            <button onClick={() => dismiss(r)} aria-label="Dismiss" className="rounded p-1 text-mute hover:bg-white/10"><X size={16} /></button>
          </div>
          <button
            onClick={() => { dismiss(r); nav(`/watch/${encodeURIComponent(r.channel_id)}`) }}
            className="mt-2 w-full rounded-lg bg-accent-strong py-1.5 text-sm font-semibold hover:bg-accent">
            Tune in
          </button>
        </div>
      ))}
    </div>
  )
}
