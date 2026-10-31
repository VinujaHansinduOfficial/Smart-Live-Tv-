import { Bell, Trash } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { Button, ChannelLogo, Empty, LiveBadge } from '../components/ui'
import { fmtDay, fmtRange, fmtRelative } from '../lib/time'
import { useNow, useSession } from '../session'

export default function Reminders() {
  const { reminders, refreshReminders } = useSession()
  const now = useNow(30_000)
  const nav = useNavigate()
  useEffect(() => { refreshReminders().catch(() => undefined) }, [refreshReminders])

  const notifState = 'Notification' in window ? Notification.permission : 'unsupported'

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Reminders</h1>
        <p className="text-sm text-mute">You'll get an alert in the app before each programme starts.</p>
      </div>
      {notifState === 'default' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-800 p-3 text-sm ring-1 ring-white/5">
          <span>Allow system notifications to be alerted when this tab is in the background.</span>
          <Button variant="ghost" onClick={() => Notification.requestPermission().then(() => refreshReminders())}>Allow</Button>
        </div>
      )}
      {reminders.length === 0 ? (
        <Empty icon={<Bell size={28} />} title="No reminders set">
          Open a programme from the <Link to="/guide" className="text-accent">TV Guide</Link> or{' '}
          <Link to="/search?tab=programmes" className="text-accent">programme search</Link> and choose “Remind me”.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => {
            const airing = r.start <= now && now < r.stop
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-ink-800 p-3 ring-1 ring-white/5">
                <ChannelLogo src={r.channel_logo} name={r.channel_name ?? r.channel_id} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-mute">
                    {airing && <LiveBadge />}
                    {r.channel_name ?? r.channel_id} · {fmtDay(r.start)} {fmtRange(r.start, r.stop)}
                  </p>
                  {!airing && <p className="text-xs text-accent">Starts {fmtRelative(r.start, now)} · alert {r.notify_before_min ? `${r.notify_before_min} min before` : 'at start'}</p>}
                </div>
                {airing && <Button onClick={() => nav(`/watch/${encodeURIComponent(r.channel_id)}`)}>Watch</Button>}
                <button aria-label="Delete reminder" onClick={async () => { await api.deleteReminder(r.id); refreshReminders() }}
                  className="rounded p-2 text-mute hover:bg-white/10 hover:text-white"><Trash size={16} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
