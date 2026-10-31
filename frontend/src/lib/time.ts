const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

export const fmtTime = (ts: number) => timeFmt.format(new Date(ts * 1000))

export function fmtDay(ts: number): string {
  const d = new Date(ts * 1000)
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1)
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return dayFmt.format(d)
}

export const fmtRange = (start: number, stop: number) => `${fmtTime(start)} – ${fmtTime(stop)}`

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? '<1 min' : '0 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function fmtRelative(ts: number, now = Date.now() / 1000): string {
  const diff = Math.round(ts - now)
  const abs = Math.abs(diff)
  if (abs < 60) return diff >= 0 ? 'in under a minute' : 'just now'
  const mins = Math.round(abs / 60)
  if (mins < 60) return diff >= 0 ? `in ${mins} min` : `${mins} min ago`
  const hrs = Math.round(abs / 3600)
  if (hrs < 24) return diff >= 0 ? `in ${hrs} h` : `${hrs} h ago`
  return `${fmtDay(ts)}, ${fmtTime(ts)}`
}

export const nowSec = () => Math.floor(Date.now() / 1000)

export function fmtSeconds(sec: number): string {
  if (isNaN(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const remS = s % 60
  if (m < 60) {
    return `${m}:${remS.toString().padStart(2, '0')}`
  }
  const h = Math.floor(m / 60)
  const remM = m % 60
  return `${h}:${remM.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`
}

export function fmtBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function progress(start: number, stop: number, now = nowSec()): number {
  if (now <= start) return 0
  if (now >= stop) return 1
  return (now - start) / (stop - start)
}
