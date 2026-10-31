import { Delete, Lock, Tv } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Button } from '../components/ui'
import { useSession } from '../session'
import type { ProfileSummary } from '../types'

export const PROFILE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899']

export function Avatar({ name, color, size = 96 }: { name: string; color: string; size?: number }) {
  return (
    <div className="flex items-center justify-center rounded-2xl font-bold text-white shadow-lg"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}>
      {name.trim().charAt(0).toUpperCase()}
    </div>
  )
}

export function PinPad({ onSubmit, error, busy }: { onSubmit: (pin: string) => void; error?: string | null; busy?: boolean }) {
  const [pin, setPin] = useState('')
  useEffect(() => { if (error) setPin('') }, [error])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 8 ? p + e.key : p))
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter' && pin.length >= 4) onSubmit(pin)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pin, onSubmit])
  const press = (d: string) => setPin((p) => (p.length < 8 ? p + d : p))
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-6 gap-2" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-accent' : 'bg-ink-600'}`} />
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} className="h-14 w-14 rounded-xl bg-ink-700 text-lg font-semibold hover:bg-ink-600">{d}</button>
        ))}
        <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete digit"
          className="flex h-14 w-14 items-center justify-center rounded-xl bg-ink-800 hover:bg-ink-700"><Delete size={18} /></button>
        <button onClick={() => press('0')} className="h-14 w-14 rounded-xl bg-ink-700 text-lg font-semibold hover:bg-ink-600">0</button>
        <button onClick={() => onSubmit(pin)} disabled={pin.length < 4 || busy}
          className="h-14 w-14 rounded-xl bg-accent-strong text-sm font-bold hover:bg-accent disabled:opacity-40">OK</button>
      </div>
    </div>
  )
}

function FirstProfile({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [color, setColor] = useState(PROFILE_COLORS[0])
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.createProfile({ name, color, pin: pin || undefined })
      onCreated()
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-ink-800 p-6 ring-1 ring-white/5">
      <div>
        <h2 className="text-lg font-bold">Create your profile</h2>
        <p className="text-sm text-mute">This is the grown-up profile. You can add family and kids profiles later.</p>
      </div>
      <label className="block text-sm">Name
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus
          className="mt-1 w-full rounded-lg bg-ink-700 px-3 py-2 outline-none focus:ring-2 focus:ring-accent" />
      </label>
      <label className="block text-sm">PIN <span className="text-mute">(optional, 4–8 digits — protects settings and parental controls)</span>
        <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric"
          type="password" className="mt-1 w-full rounded-lg bg-ink-700 px-3 py-2 outline-none focus:ring-2 focus:ring-accent" />
      </label>
      <div className="flex gap-2">
        {PROFILE_COLORS.map((c) => (
          <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
            className={`h-8 w-8 rounded-full ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-800' : ''}`}
            style={{ background: c }} />
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={!name.trim() || (pin.length > 0 && pin.length < 4)}>Continue</Button>
    </form>
  )
}

export default function ProfilePicker() {
  const { signIn } = useSession()
  const [profiles, setProfiles] = useState<ProfileSummary[] | null>(null)
  const [pinFor, setPinFor] = useState<ProfileSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.profiles().then(setProfiles).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const open = async (p: ProfileSummary, pin?: string) => {
    setBusy(true); setError(null)
    try {
      const { token, profile } = await api.openSession(p.id, pin)
      signIn(token, profile)
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-strong"><Tv size={20} /></span>
        <span className="text-xl font-bold tracking-tight">SMART TV</span>
      </div>
      {profiles === null ? null : profiles.length === 0 ? (
        <FirstProfile onCreated={load} />
      ) : pinFor ? (
        <div className="flex flex-col items-center gap-5">
          <Avatar name={pinFor.name} color={pinFor.color} size={72} />
          <p className="font-semibold">Enter PIN for {pinFor.name}</p>
          <PinPad onSubmit={(pin) => open(pinFor, pin)} error={error} busy={busy} />
          <button className="text-sm text-mute hover:text-white" onClick={() => { setPinFor(null); setError(null) }}>Back</button>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Who's watching?</h1>
          <div className="flex flex-wrap justify-center gap-6">
            {profiles.map((p) => (
              <button key={p.id} onClick={() => (p.has_pin ? setPinFor(p) : open(p))}
                className="group flex flex-col items-center gap-2 rounded-2xl p-2">
                <div className="transition-transform group-hover:scale-105 group-focus-visible:scale-105">
                  <Avatar name={p.name} color={p.color} />
                </div>
                <span className="flex items-center gap-1 text-sm font-medium text-slate-300 group-hover:text-white">
                  {p.name}{p.has_pin && <Lock size={12} className="text-mute" />}
                </span>
                {p.is_kids && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">KIDS</span>}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </div>
  )
}
