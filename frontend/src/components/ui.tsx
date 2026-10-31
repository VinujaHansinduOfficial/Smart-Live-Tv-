import { Tv } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { progress } from '../lib/time'

export function ChannelLogo({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  return (
    <div
      className="shrink-0 rounded-lg bg-ink-700/70 ring-1 ring-white/5 flex items-center justify-center overflow-hidden"
      style={{ width: size, height: size }}
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          className="max-w-[82%] max-h-[82%] object-contain" />
      ) : initials ? (
        <span className="text-[11px] font-semibold text-mute">{initials}</span>
      ) : (
        <Tv size={size * 0.45} className="text-mute" />
      )}
    </div>
  )
}

export function ProgressBar({ start, stop, now, className = '' }: { start: number; stop: number; now: number; className?: string }) {
  const pct = Math.round(progress(start, stop, now) * 100)
  return (
    <div className={`h-1 rounded-full bg-white/10 overflow-hidden ${className}`} role="progressbar"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function LiveBadge() {
  return <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">LIVE</span>
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'bg-accent-strong text-white' : 'bg-ink-700 text-slate-200 hover:bg-ink-600'
      }`}
    >
      {children}
    </button>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-base font-bold">{children}</h2>
      {action}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-600 p-8 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-mute">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-mute">{children}</div>}
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-accent-strong hover:bg-accent text-white',
    ghost: 'bg-ink-700 hover:bg-ink-600 text-slate-100',
    danger: 'bg-red-600/90 hover:bg-red-600 text-white',
  }[variant]
  return (
    <button {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles} ${className}`} />
  )
}

export function Spinner() {
  return <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent" aria-label="Loading" />
}
