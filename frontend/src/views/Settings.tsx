import { Download, Lock, Plus, RefreshCw, Trash, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Button, Spinner } from '../components/ui'
import { fmtRelative } from '../lib/time'
import { useSession } from '../session'
import type { EpgSource, IptvSource, Profile, ProfileSummary } from '../types'
import { Avatar, PROFILE_COLORS } from './ProfilePicker'

const inputCls = 'w-full rounded-lg bg-ink-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent'

function Card({ title, sub, children, action }: { title: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{title}</h2>
          {sub && <p className="text-sm text-mute">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function TagPicker({ label, values, options, onChange }: {
  label: string; values: string[]; options: { value: string; label: string }[]; onChange: (v: string[]) => void
}) {
  const remaining = options.filter((o) => !values.includes(o.value))
  return (
    <div>
      <p className="mb-1.5 text-sm">{label}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-ink-600 px-2.5 py-1 text-xs">
            {options.find((o) => o.value === v)?.label ?? v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><X size={12} /></button>
          </span>
        ))}
        <select value="" aria-label={`Add ${label}`} onChange={(e) => e.target.value && onChange([...values, e.target.value])}
          className="rounded-full bg-ink-700 px-2.5 py-1 text-xs outline-none">
          <option value="">+ Add</option>
          {remaining.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  )
}

function MyProfile() {
  const { profile, meta, refreshProfile, refreshMeta } = useSession()
  const [name, setName] = useState(profile?.name ?? '')
  const [saved, setSaved] = useState(false)
  if (!profile) return null
  const save = async (body: Record<string, unknown>) => {
    await api.updateProfile(profile.id, body)
    await refreshProfile()
    await refreshMeta()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <Card title="Your profile" sub="Preferred countries and languages rank first in search and channel lists."
      action={saved ? <span className="text-xs text-emerald-400">Saved</span> : undefined}>
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <Avatar name={profile.name} color={profile.color} size={64} />
        <div className="space-y-4">
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} aria-label="Name" maxLength={40} />
            <Button variant="ghost" disabled={!name.trim() || name === profile.name} onClick={() => save({ name })}>Rename</Button>
          </div>
          <div className="flex gap-2">
            {PROFILE_COLORS.map((c) => (
              <button key={c} onClick={() => save({ color: c })} aria-label={`Colour ${c}`}
                className={`h-7 w-7 rounded-full ${profile.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-ink-800' : ''}`}
                style={{ background: c }} />
            ))}
          </div>
          <TagPicker label="Preferred countries" values={profile.preferred_countries}
            options={(meta?.countries ?? []).map((c) => ({ value: c.code, label: `${c.flag ?? ''} ${c.name}` }))}
            onChange={(v) => save({ preferred_countries: v })} />
          <TagPicker label="Preferred languages" values={profile.preferred_languages}
            options={(meta?.languages ?? []).map((l) => ({ value: l.code, label: l.name }))}
            onChange={(v) => save({ preferred_languages: v })} />
        </div>
      </div>
    </Card>
  )
}

function ProfileEditor({ p, categories, onChanged }: {
  p: Profile | ProfileSummary; categories: { id: string; name: string }[]; onChanged: () => void
}) {
  const { profile: me } = useSession()
  const [full, setFull] = useState<Profile | null>('allowed_categories' in p ? p : null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const patch = async (body: Record<string, unknown>) => {
    setError(null)
    try {
      setFull(await api.updateProfile(p.id, body))
      onChanged()
    } catch (e) { setError((e as Error).message) }
  }
  const expand = async () => {
    setOpen(!open)
    if (!full) {
      try { setFull(await api.updateProfile(p.id, {})) } catch (e) { setError((e as Error).message) }
    }
  }
  const allowed = full?.allowed_categories
  const blocked = full?.blocked_categories ?? []
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  return (
    <li className="rounded-xl bg-ink-700/50 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={p.name} color={p.color} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold">{p.name}
            {p.has_pin && <Lock size={12} className="text-mute" />}
            {p.is_kids && <span className="rounded-full bg-amber-500/20 px-2 text-[10px] font-bold text-amber-300">KIDS</span>}
            {me?.id === p.id && <span className="text-xs font-normal text-mute">(you)</span>}
          </p>
        </div>
        <Button variant="ghost" onClick={expand}>{open ? 'Close' : 'Edit'}</Button>
      </div>
      {open && (
        <div className="mt-4 space-y-4 border-t border-white/5 pt-4">
          {!full ? <Spinner /> : (
            <>
              {me?.id !== p.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={full.is_kids} onChange={(e) => patch({ is_kids: e.target.checked })} />
                  Kids profile <span className="text-mute">— only allowed categories are visible; can't change settings</span>
                </label>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-sm">Allowed categories {allowed === null && <span className="text-mute">— everything</span>}</p>
                  {allowed !== null
                    ? <button className="text-xs text-accent" onClick={() => patch({ clear_allowed_categories: true })}>Allow everything</button>
                    : <button className="text-xs text-accent" onClick={() => patch({ allowed_categories: ['kids', 'animation', 'family', 'education'] })}>Restrict</button>}
                </div>
                {allowed !== null && (
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((c) => (
                      <button key={c.id} onClick={() => patch({ allowed_categories: toggle(allowed ?? [], c.id) })}
                        className={`rounded-full px-2.5 py-1 text-xs ${allowed?.includes(c.id) ? 'bg-emerald-600/30 text-emerald-200 ring-1 ring-emerald-500/50' : 'bg-ink-700 text-mute'}`}>
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-sm">Blocked categories</p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button key={c.id} onClick={() => patch({ blocked_categories: toggle(blocked, c.id) })}
                      className={`rounded-full px-2.5 py-1 text-xs ${blocked.includes(c.id) ? 'bg-red-600/30 text-red-200 ring-1 ring-red-500/50' : 'bg-ink-700 text-mute'}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} type="password"
                  inputMode="numeric" placeholder="New PIN (4–8 digits)" className={`${inputCls} max-w-48`} aria-label="New PIN" />
                <Button variant="ghost" disabled={pin.length < 4} onClick={() => { patch({ pin }); setPin('') }}>Set PIN</Button>
                {full.has_pin && <Button variant="ghost" onClick={() => patch({ pin: '' })}>Remove PIN</Button>}
                {me?.id !== p.id && (
                  <Button variant="danger" className="ml-auto" onClick={async () => {
                    if (!confirm(`Delete ${p.name}? Their favourites, history and reminders are removed too.`)) return
                    try { await api.deleteProfile(p.id); onChanged() } catch (e) { setError((e as Error).message) }
                  }}><Trash size={14} /> Delete</Button>
                )}
              </div>
            </>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}
    </li>
  )
}

function Household() {
  const { meta } = useSession()
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kids, setKids] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => { api.profiles().then(setProfiles) }, [])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setError(null)
    try {
      await api.createProfile({ name, is_kids: kids, color: PROFILE_COLORS[(profiles.length + 1) % PROFILE_COLORS.length] })
      setName(''); setAdding(false); load()
    } catch (e) { setError((e as Error).message) }
  }
  const categories = (meta?.categories ?? []).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card title="Household profiles" sub="Each profile has its own favourites, history and reminders. Kids profiles only see allowed categories."
      action={<Button variant="ghost" onClick={() => setAdding(!adding)}><Plus size={14} /> Add profile</Button>}>
      {adding && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-ink-700/50 p-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${inputCls} max-w-56`} autoFocus />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={kids} onChange={(e) => setKids(e.target.checked)} /> Kids profile</label>
          <Button disabled={!name.trim()} onClick={add}>Create</Button>
          {error && <p className="w-full text-sm text-red-400">{error}</p>}
        </div>
      )}
      <ul className="space-y-2">
        {profiles.map((p) => <ProfileEditor key={p.id} p={p} categories={categories} onChanged={load} />)}
      </ul>
    </Card>
  )
}

function GuideSources() {
  const { meta, refreshMeta } = useSession()
  const [sources, setSources] = useState<EpgSource[] | null>(null)
  const [location, setLocation] = useState('')
  const [label, setLabel] = useState('')
  const [job, setJob] = useState<{ running: string | null; last: { job: string; status: string; error?: string } | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<{ country: string; category: string; favorites: boolean }>({ country: '', category: '', favorites: false })
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setSources(await api.epgSources())
    setJob(await api.jobs())
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!job?.running) return
    const id = setInterval(async () => {
      const j = await api.jobs()
      setJob(j)
      if (!j.running) { load(); refreshMeta() }
    }, 1500)
    return () => clearInterval(id)
  }, [job?.running, load, refreshMeta])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn(); setJob(await api.jobs()) } catch (e) { setError((e as Error).message) }
  }
  const exportXml = async () => {
    setExportMsg(null); setError(null)
    try {
      const { blob, count } = await api.downloadChannelsXml(scope)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'custom.channels.xml'
      a.click()
      URL.revokeObjectURL(a.href)
      setExportMsg(`Downloaded ${count} channels.`)
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <Card title="Programme guide" sub={meta ? `${meta.epg.programmes.toLocaleString()} programmes for ${meta.epg.channels.toLocaleString()} channels` : undefined}
      action={<div className="flex gap-2">
        <Button variant="ghost" disabled={!!job?.running || !sources?.length} onClick={() => run(api.refreshEpg)}><RefreshCw size={14} /> Reload all</Button>
      </div>}>
      {job?.running && <p className="mb-3 flex items-center gap-2 text-sm text-accent"><Spinner /> {job.running}…</p>}
      {job?.last?.status === 'error' && !job.running && <p className="mb-3 text-sm text-red-400">{job.last.job} failed: {job.last.error}</p>}

      {sources === null ? <Spinner /> : sources.length === 0 ? (
        <p className="mb-4 text-sm text-mute">No guide sources yet.</p>
      ) : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-mute"><tr>
              <th className="py-1.5 pr-3 font-medium">Source</th><th className="pr-3 font-medium">Programmes</th>
              <th className="pr-3 font-medium">Channels matched</th><th className="pr-3 font-medium">Loaded</th><th />
            </tr></thead>
            <tbody className="divide-y divide-white/5">
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="max-w-xs py-2 pr-3">
                    <p className="truncate font-medium">{s.label || s.location}</p>
                    {s.label && <p className="truncate text-xs text-mute">{s.location}</p>}
                    {s.last_status === 'error' && <p className="truncate text-xs text-red-400" title={s.last_error ?? ''}>{s.last_error}</p>}
                  </td>
                  <td className="pr-3 tabular-nums">{s.programme_count.toLocaleString()}</td>
                  <td className="pr-3 tabular-nums">{s.mapped_channels}{s.unmapped_channels > 0 && <span className="text-mute"> ({s.unmapped_channels} unmatched)</span>}</td>
                  <td className="pr-3 text-mute">{s.last_loaded_at ? fmtRelative(s.last_loaded_at) : '—'}</td>
                  <td className="text-right">
                    <button aria-label="Remove source" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white"
                      onClick={() => run(async () => { await api.deleteEpgSource(s.id); await load(); await refreshMeta() })}><Trash size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="XMLTV URL, or a file name in backend/data/epg"
          className={`${inputCls} min-w-64 flex-1`} aria-label="Guide location" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className={`${inputCls} max-w-44`} aria-label="Label" />
        <Button disabled={!location.trim() || !!job?.running} onClick={() => run(async () => { await api.addEpgSource(location.trim(), label || undefined); setLocation(''); setLabel(''); await load() })}>
          <Plus size={14} /> Add &amp; load
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-6 rounded-xl bg-ink-700/40 p-4">
        <h3 className="font-semibold">Get guide data with the iptv-org/epg grabber</h3>
        <p className="mt-1 text-sm text-mute">
          Pick which channels you want listings for. This downloads a channel file that tells the grabber which TV-listing
          site to read for each channel, already matched to this app's channel IDs.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={scope.country} onChange={(e) => setScope({ ...scope, country: e.target.value })} className={`${inputCls} max-w-56`} aria-label="Country">
            <option value="">Any country</option>
            {meta?.countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
          </select>
          <select value={scope.category} onChange={(e) => setScope({ ...scope, category: e.target.value })} className={`${inputCls} max-w-48`} aria-label="Category">
            <option value="">Any category</option>
            {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scope.favorites} onChange={(e) => setScope({ ...scope, favorites: e.target.checked })} /> My favourites</label>
          <Button variant="ghost" onClick={exportXml}><Download size={14} /> custom.channels.xml</Button>
          {exportMsg && <span className="text-xs text-emerald-400">{exportMsg}</span>}
        </div>
        <pre className="scroll-thin mt-3 overflow-x-auto rounded-lg bg-ink-950 p-3 text-xs leading-relaxed text-slate-300">{`git clone --depth 1 https://github.com/iptv-org/epg.git && cd epg && npm install
npm run grab --- --channels=custom.channels.xml --output=guide.xml --days=2 --maxConnections=5
# then copy guide.xml into backend/data/epg/ and add "guide.xml" above`}</pre>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute">
          Just trying the app?
          <Button variant="ghost" disabled={!!job?.running} onClick={() => run(async () => { await api.loadDemoGuide(); await load() })}>Load demo guide</Button>
          <span className="text-xs">(made-up listings for ~190 channels — remove it once a real guide is loaded)</span>
        </div>
      </div>
    </Card>
  )
}

function IptvSourcesSection() {
  const [sources, setSources] = useState<IptvSource[]>([])
  const [openAdd, setOpenAdd] = useState(false)
  const [type, setType] = useState<'m3u' | 'xtream' | 'stalker'>('m3u')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [macAddress, setMacAddress] = useState('')
  const [catchupType, setCatchupType] = useState('append')
  const [catchupDays, setCatchupDays] = useState(14)
  const [catchupSource, setCatchupSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { refreshMeta } = useSession()

  const load = useCallback(() => {
    api.sources().then(setSources).catch(() => undefined)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.addSource({
        name,
        type,
        url,
        username: username || undefined,
        password: password || undefined,
        mac_address: macAddress || undefined,
        catchup_type: catchupType,
        catchup_days: catchupDays,
        catchup_source: catchupSource || undefined,
      })
      setOpenAdd(false)
      setName('')
      setUrl('')
      setUsername('')
      setPassword('')
      setMacAddress('')
      load()
      refreshMeta()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this IPTV source and all its imported channels?')) return
    await api.deleteSource(id)
    load()
    refreshMeta()
  }

  return (
    <Card
      title="IPTV Sources & Playlists"
      sub="Import external M3U/M3U8 playlists (URL or pasted text), Xtream Codes accounts, or Stalker portals with 14-day catch-up replay."
      action={
        <Button variant="ghost" onClick={() => setOpenAdd(!openAdd)}>
          {openAdd ? <X size={14} /> : <Plus size={14} />} {openAdd ? 'Cancel' : 'Add Source'}
        </Button>
      }
    >
      {openAdd && (
        <form onSubmit={handleAdd} className="mb-4 space-y-3 rounded-xl bg-ink-900/60 p-4 border border-white/5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-300">Source Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as any)}
                className={`mt-1 ${inputCls}`}
              >
                <option value="m3u">Extended M3U / M3U8 Playlist</option>
                <option value="xtream">Xtream Codes Account</option>
                <option value="stalker">Stalker / Ministra Portal</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">Friendly Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Premium Playlist"
                required
                className={`mt-1 ${inputCls}`}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300">
              {type === 'm3u' ? 'M3U URL or Raw Playlist Text' : 'Server / Portal URL'}
            </label>
            {type === 'm3u' ? (
              <textarea
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                rows={3}
                placeholder="https://example.com/playlist.m3u8 or paste #EXTM3U..."
                required
                className={`mt-1 font-mono text-xs ${inputCls}`}
              />
            ) : (
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://server.domain:8080"
                required
                className={`mt-1 font-mono text-xs ${inputCls}`}
              />
            )}
          </div>

          {type === 'xtream' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-semibold text-slate-300">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`mt-1 ${inputCls}`}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-300">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`mt-1 ${inputCls}`}
                />
              </div>
            </div>
          )}

          {type === 'stalker' && (
            <div>
              <label className="text-xs font-semibold text-slate-300">MAC Address</label>
              <input
                value={macAddress}
                onChange={(e) => setMacAddress(e.target.value)}
                placeholder="00:1A:79:XX:XX:XX"
                className={`mt-1 font-mono text-xs ${inputCls}`}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-300">Catch-Up Type</label>
              <select
                value={catchupType}
                onChange={(e) => setCatchupType(e.target.value)}
                className={`mt-1 ${inputCls}`}
              >
                <option value="append">Append (?utc=...)</option>
                <option value="shift">Shift (?timeshift=...)</option>
                <option value="flv">FLV Archive</option>
                <option value="default">Default</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">Catch-Up Days</label>
              <input
                type="number"
                min={1}
                max={30}
                value={catchupDays}
                onChange={(e) => setCatchupDays(Number(e.target.value))}
                className={`mt-1 ${inputCls}`}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300">Catch-Up Template (Optional)</label>
              <input
                value={catchupSource}
                onChange={(e) => setCatchupSource(e.target.value)}
                placeholder="?start=${utc}&end=${lutc}"
                className={`mt-1 font-mono text-xs ${inputCls}`}
              />
            </div>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpenAdd(false)}>
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? <Spinner /> : <Plus size={14} />} Ingest & Sync Source
            </Button>
          </div>
        </form>
      )}

      {sources.length === 0 ? (
        <p className="text-sm text-mute">No external IPTV sources configured. You are currently viewing the default iptv-org public channel index.</p>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl bg-ink-700/60 p-3 border border-white/5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">{s.name}</span>
                  <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent uppercase">
                    {s.type}
                  </span>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {s.catchup_days}d Catch-Up
                  </span>
                </div>
                <p className="text-xs text-mute truncate pt-0.5">
                  {s.channel_count} channels imported · {s.url}
                </p>
              </div>

              <button
                onClick={() => handleDelete(s.id)}
                className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
                title="Delete source"
              >
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Catalog() {
  const { meta, refreshMeta } = useSession()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const sync = async () => {
    setBusy(true); setMsg(null)
    try {
      await api.syncCatalog()
      for (; ;) {
        await new Promise((r) => setTimeout(r, 1500))
        const j = await api.jobs()
        if (!j.running) {
          setMsg(j.last?.status === 'ok' ? 'Channel list updated.' : `Sync failed: ${j.last?.error}`)
          break
        }
      }
      await refreshMeta()
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Card title="Channel list" sub={meta ? `${meta.stats.channels.toLocaleString()} channels from iptv-org${meta.stats.catalog_synced_at ? `, updated ${fmtRelative(meta.stats.catalog_synced_at)}` : ''}` : undefined}
      action={<Button variant="ghost" disabled={busy} onClick={sync}>{busy ? <Spinner /> : <RefreshCw size={14} />} Update now</Button>}>
      <p className="text-sm text-mute">Blocklisted (DMCA/NSFW) and adult channels are excluded. Channels without any stream are hidden.</p>
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

export default function Settings() {
  const { profile } = useSession()
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-xl font-bold">Settings</h1>
      <MyProfile />
      {profile && !profile.is_kids ? (
        <>
          <Household />
          <IptvSourcesSection />
          <GuideSources />
          <Catalog />
        </>
      ) : (
        <p className="text-sm text-mute">Ask a grown-up to change other settings.</p>
      )}
    </div>
  )
}
