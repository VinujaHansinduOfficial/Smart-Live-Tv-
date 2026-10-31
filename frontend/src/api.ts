import type {
  AiDiscoveryResponse, AiSummaryResponse, CatchupDay, CatchupProgram, CatchupResolveResponse, CatchupScheduleResponse,
  Channel, ChannelDetail, ContinueItem, DeviceCommand, DownloadItem, DownloadStorageInfo, DvrStorage, EpgSource, GuideChannel,
  HistoryEntry, IptvSource, Meta, MultiviewPreset, PairCodeResponse, Profile, ProfileSummary,
  Programme, ProgrammeHit, RecommendationsResponse, Recording, RecordingRule, Reminder, VoiceCommandResponse,
  VodContinueItem, VodDetail, VodFeaturedResponse, VodItem, WatchParty, WatchlistItem, WorldCountry, WorldCountryDetail,
} from './types'

const TOKEN_KEY = 'smarttv.token'

function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

let token: string | null = readToken()

export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable: keep in memory */ }
}
export const getToken = () => token

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

function qs(params?: Params) {
  if (!params) return ''
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    s.set(k, String(v))
  }
  const str = s.toString()
  return str ? `?${str}` : ''
}

const listeners = new Set<() => void>()
/** Called when the server says the session is gone (e.g. profile deleted). */
export const onUnauthorized = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

async function request<T>(method: string, path: string, body?: unknown, params?: Params): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers['X-Profile-Token'] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`/api${path}${qs(params)}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const data = await res.json()
      msg = typeof data.detail === 'string' ? data.detail
        : Array.isArray(data.detail) ? data.detail.map((d: { msg: string }) => d.msg).join(', ') : msg
    } catch { /* not JSON */ }
    if (res.status === 401 && token) listeners.forEach((fn) => fn())
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as T
  const type = res.headers.get('content-type') || ''
  return (type.includes('json') ? res.json() : res.text()) as Promise<T>
}

export const api = {
  // profiles
  profiles: () => request<ProfileSummary[]>('GET', '/profiles'),
  createProfile: (body: Partial<Profile> & { name: string; pin?: string }) =>
    request<Profile>('POST', '/profiles', body),
  openSession: (id: number, pin?: string) =>
    request<{ token: string; profile: Profile }>('POST', `/profiles/${id}/session`, { pin }),
  closeSession: () => request<void>('DELETE', '/session'),
  me: () => request<Profile>('GET', '/me'),
  updateProfile: (id: number, body: Record<string, unknown>) => request<Profile>('PATCH', `/profiles/${id}`, body),
  deleteProfile: (id: number) => request<void>('DELETE', `/profiles/${id}`),

  // catalog
  meta: () => request<Meta>('GET', '/meta'),
  channels: (p: Params) => request<{ items: Channel[]; total: number }>('GET', '/channels', undefined, p),
  channel: (id: string) => request<ChannelDetail>('GET', `/channels/${encodeURIComponent(id)}`),

  // guide
  grid: (p: Params) =>
    request<{ start: number; end: number; now: number; total: number; channels: GuideChannel[] }>(
      'GET', '/guide/grid', undefined, p),
  schedule: (id: string, p?: Params) =>
    request<{ channel_id: string; now: number; programmes: Programme[] }>(
      'GET', `/guide/channel/${encodeURIComponent(id)}`, undefined, p),
  searchProgrammes: (p: Params) =>
    request<{ items: ProgrammeHit[]; total: number; now: number }>('GET', '/programmes/search', undefined, p),
  programme: (id: number) => request<Programme & { channel: Channel }>('GET', `/programmes/${id}`),

  // me
  favorites: () => request<Channel[]>('GET', '/me/favorites'),
  addFavorite: (id: string) => request<void>('PUT', `/me/favorites/${encodeURIComponent(id)}`),
  removeFavorite: (id: string) => request<void>('DELETE', `/me/favorites/${encodeURIComponent(id)}`),
  startWatching: (channel_id: string, stream_url?: string) =>
    request<{ id: number; resumed: boolean }>('POST', '/me/history', { channel_id, stream_url }),
  heartbeat: (id: number, stream_url?: string) => request<void>('POST', `/me/history/${id}/heartbeat`, { stream_url }),
  history: (limit = 100) => request<HistoryEntry[]>('GET', '/me/history', undefined, { limit }),
  clearHistory: () => request<void>('DELETE', '/me/history'),
  deleteHistory: (id: number) => request<void>('DELETE', `/me/history/${id}`),
  continueWatching: () => request<ContinueItem[]>('GET', '/me/continue'),
  reminders: () => request<Reminder[]>('GET', '/me/reminders'),
  dueReminders: () => request<Reminder[]>('GET', '/me/reminders/due'),
  addReminder: (programme_id: number, notify_before_min = 5) =>
    request<Reminder>('POST', '/me/reminders', { programme_id, notify_before_min }),
  dismissReminder: (id: number) => request<void>('POST', `/me/reminders/${id}/dismiss`),
  deleteReminder: (id: number) => request<void>('DELETE', `/me/reminders/${id}`),

  // admin
  epgSources: () => request<EpgSource[]>('GET', '/admin/epg/sources'),
  addEpgSource: (location: string, label?: string) =>
    request<{ id: number }>('POST', '/admin/epg/sources', { location, label }),
  deleteEpgSource: (id: number) => request<void>('DELETE', `/admin/epg/sources/${id}`),
  refreshEpg: () => request<void>('POST', '/admin/epg/refresh'),
  loadDemoGuide: () => request<void>('POST', '/admin/epg/demo'),
  syncCatalog: () => request<void>('POST', '/admin/sync'),
  jobs: () => request<{ running: string | null; last: { job: string; status: string; error?: string } | null }>(
    'GET', '/admin/jobs'),
  channelsXmlUrl: (p: Params) => `/api/admin/epg/channels-xml${qs(p)}`,
  downloadChannelsXml: async (p: Params) => {
    const res = await fetch(`/api/admin/epg/channels-xml${qs(p)}`, {
      headers: token ? { 'X-Profile-Token': token } : {},
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({ detail: res.statusText }))
      throw new ApiError(res.status, data.detail)
    }
    return { blob: await res.blob(), count: Number(res.headers.get('X-Channel-Count') || 0) }
  },

  // phase 4: AI & Recommendations
  aiStatus: () => request<{ gemini_enabled: boolean; models: string[] }>('GET', '/ai/status'),
  discover: (prompt: string, history?: { role: string; content: string }[]) =>
    request<AiDiscoveryResponse>('POST', '/ai/discover', { prompt, history }),
  voiceCommand: (text: string) => request<VoiceCommandResponse>('POST', '/ai/voice', { text }),
  recommendations: () => request<RecommendationsResponse>('GET', '/me/recommendations'),

  // phase 5: World Explorer, Multi-View, Device Sync & Remote
  worldCountries: () => request<WorldCountry[]>('GET', '/world/countries'),
  worldCountry: (code: string, category?: string) =>
    request<WorldCountryDetail>('GET', `/world/country/${encodeURIComponent(code)}`, undefined, { category }),
  multiviewPresets: () => request<MultiviewPreset[]>('GET', '/me/multiview'),
  createMultiviewPreset: (body: { name: string; layout: string; channel_ids: string[] }) =>
    request<MultiviewPreset>('POST', '/me/multiview', body),
  deleteMultiviewPreset: (id: number) => request<void>('DELETE', `/me/multiview/${id}`),
  createPairCode: (name?: string) => request<PairCodeResponse>('POST', '/sync/code', undefined, { name }),
  pairDevice: (code: string, device_name?: string) =>
    request<{ paired: boolean; token: string; profile_id: number; profile_name: string; code: string }>('POST', '/sync/pair', { code, device_name }),
  sendCommand: (code: string, command: string, payload?: Record<string, unknown>) =>
    request<{ ok: boolean; command_id: number }>('POST', '/sync/command', { code, command, payload }),
  pollCommands: (code: string, since = 0) => request<DeviceCommand[]>('GET', '/sync/poll', undefined, { code, since }),
  backupData: () => request<Record<string, unknown>>('GET', '/sync/backup'),
  restoreData: (data: Record<string, unknown>) =>
    request<{ restored: boolean; favorites_added: number; presets_added: number }>('POST', '/sync/restore', data),

  // 14-Day Catch-Up TV Replay
  catchupDays: () => request<CatchupDay[]>('GET', '/catchup/days'),
  catchupSchedule: (channel_id: string, date?: string) =>
    request<CatchupScheduleResponse>('GET', `/catchup/schedule/${encodeURIComponent(channel_id)}`, undefined, { date }),
  catchupProgram: (id: number) => request<CatchupProgram & { channel: Channel }>('GET', `/catchup/program/${id}`),
  resolveCatchup: (channel_id: string, start: number, stop: number) =>
    request<CatchupResolveResponse>('POST', '/catchup/resolve', { channel_id, start, stop }),

  // VOD (Movies & Series)
  vodFeatured: () => request<VodFeaturedResponse>('GET', '/vod/featured'),
  vodMovies: (params?: Params) => request<{ items: VodItem[]; total: number }>('GET', '/vod/movies', undefined, params),
  vodSeries: (params?: Params) => request<{ items: VodItem[]; total: number }>('GET', '/vod/series', undefined, params),
  vodItem: (id: string) => request<VodDetail>('GET', `/vod/item/${encodeURIComponent(id)}`),
  vodContinue: () => request<VodContinueItem[]>('GET', '/vod/continue'),
  saveVodProgress: (item_id: string, watched_s: number, total_s: number, completed = false, series_id?: string) =>
    request<void>('POST', '/vod/progress', { item_id, series_id, watched_s, total_s, completed }),

  // Local DVR & Recordings
  recordings: (status?: string) => request<Recording[]>('GET', '/recordings', undefined, { status }),
  recordInstant: (channel_id: string, duration_min = 60, title?: string) =>
    request<Recording>('POST', '/recordings/record', { channel_id, duration_min, title }),
  scheduleRecording: (body: { channel_id: string; title: string; start: number; stop: number; programme_id?: number; description?: string }) =>
    request<Recording>('POST', '/recordings/schedule', body),
  deleteRecording: (id: number) => request<void>('DELETE', `/recordings/${id}`),
  dvrStorage: () => request<DvrStorage>('GET', '/recordings/storage'),
  cleanupRecordings: () => request<{ deleted_count: number; cleaned_at: number }>('POST', '/recordings/cleanup'),

  // IPTV Sources
  sources: () => request<IptvSource[]>('GET', '/sources'),
  addSource: (body: {
    name: string
    type: string
    url: string
    username?: string
    password?: string
    mac_address?: string
    headers?: Record<string, string>
    epg_url?: string
    catchup_type?: string
    catchup_days?: number
    catchup_source?: string
  }) => request<IptvSource>('POST', '/sources', body),
  deleteSource: (id: number) => request<void>('DELETE', `/sources/${id}`),

  // Universal Watchlist (Feature 40)
  watchlist: (item_type?: string) => request<WatchlistItem[]>('GET', '/me/watchlist', undefined, { item_type }),
  checkWatchlist: (item_type: string, item_id: string) =>
    request<{ in_watchlist: boolean; watchlist_id: number | null }>('GET', '/me/watchlist/check', undefined, { item_type, item_id }),
  addToWatchlist: (body: { item_type: string; item_id: string; title: string; metadata?: Record<string, unknown> }) =>
    request<WatchlistItem>('POST', '/me/watchlist', body),
  removeFromWatchlist: (id: number) => request<void>('DELETE', `/me/watchlist/${id}`),

  // Smart Recording Rules (Features 4 & 5)
  recordingRules: () => request<RecordingRule[]>('GET', '/recordings/rules'),
  addRecordingRule: (body: { rule_type: string; query: string; channel_id?: string }) =>
    request<RecordingRule>('POST', '/recordings/rules', body),
  deleteRecordingRule: (id: number) => request<void>('DELETE', `/recordings/rules/${id}`),

  // Virtual Watch Parties (Feature 44)
  createWatchParty: (name: string, channel_id?: string, stream_url?: string) =>
    request<{ party_id: string; name: string; channel_id: string | null; stream_url: string | null; created_at: number }>(
      'POST', '/party/create', { name, channel_id, stream_url }),
  getWatchParty: (party_id: string) => request<WatchParty>('GET', `/party/${encodeURIComponent(party_id)}`),
  syncWatchParty: (party_id: string, playback_time: number, is_playing: boolean) =>
    request<{ synced: boolean }>('POST', `/party/${encodeURIComponent(party_id)}/sync`, { playback_time, is_playing }),
  sendWatchPartyMessage: (party_id: string, message: string) =>
    request<{ sent: boolean }>('POST', `/party/${encodeURIComponent(party_id)}/message`, { message }),

  // AI Summaries & Translation (Features 15 & 18)
  aiSummarize: (title: string, description?: string | null, channel_name?: string | null, categories?: string[] | null) =>
    request<AiSummaryResponse>('POST', '/ai/summarize', { title, description, channel_name, categories }),
  aiTranslate: (text: string, target_lang: string) =>
    request<{ text: string; translated: string; target_lang: string }>('POST', '/ai/translate', { text, target_lang }),

  // On-Demand Download Manager & Offline Playback (168-Hour Architecture)
  downloads: (status?: string) => request<DownloadItem[]>('GET', '/downloads', undefined, { status }),
  queueDownload: (body: {
    channel_id: string
    title: string
    start: number
    stop: number
    programme_id?: number
    description?: string
    stream_url?: string
  }) =>
    request<{ id: number; title: string; channel_id: string; status: string; progress: number; message: string }>(
      'POST',
      '/downloads',
      body,
    ),
  pauseDownload: (id: number) => request<{ id: number; status: string }>('POST', `/downloads/${id}/pause`),
  resumeDownload: (id: number) => request<{ id: number; status: string }>('POST', `/downloads/${id}/resume`),
  cancelDownload: (id: number) => request<{ id: number; status: string }>('POST', `/downloads/${id}/cancel`),
  retryDownload: (id: number) => request<{ id: number; status: string }>('POST', `/downloads/${id}/retry`),
  deleteDownload: (id: number) => request<void>('DELETE', `/downloads/${id}`),
  updateDownloadProgress: (id: number, position_s: number) =>
    request<{ id: number; playback_position_s: number }>('POST', `/downloads/${id}/progress`, { position_s }),
  downloadStorage: () => request<DownloadStorageInfo>('GET', '/downloads/storage'),
  updateDownloadStorage: (body: { download_folder?: string; max_storage_gb?: number; auto_delete_enabled?: boolean }) =>
    request<{ message: string }>('POST', '/downloads/storage', body),
  cleanupDownloads: () =>
    request<{ cleaned_count: number; cleaned_bytes: number; remaining_bytes: number }>('POST', '/downloads/cleanup'),
}
