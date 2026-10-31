export interface Programme {
  id: number
  channel_id: string
  start: number
  stop: number
  title: string
  sub_title: string | null
  description: string | null
  categories: string[]
  episode: string | null
  rating: string | null
  icon: string | null
}

export interface Channel {
  id: string
  name: string
  logo: string | null
  country: string | null
  network: string | null
  categories: string[]
  languages: string[]
  stream_count: number
  has_guide: boolean
  is_favorite: boolean
  now?: Programme | null
  next?: Programme | null
}

export interface Stream {
  id: number
  url: string
  title: string | null
  feed_id: string | null
  quality: string | null
  referrer: string | null
  user_agent: string | null
  labels: string[]
}

export interface ChannelDetail extends Channel {
  website: string | null
  alt_names: string[]
  streams: Stream[]
}

export interface ProfileSummary {
  id: number
  name: string
  color: string
  is_kids: boolean
  has_pin: boolean
}

export interface Profile extends ProfileSummary {
  allowed_categories: string[] | null
  blocked_categories: string[]
  preferred_countries: string[]
  preferred_languages: string[]
  last_channel_id: string | null
}

export interface Meta {
  categories: { id: string; name: string; channels: number }[]
  countries: { code: string; name: string; flag: string | null; channels: number }[]
  languages: { code: string; name: string; channels: number }[]
  stats: { channels: number; catalog_synced_at: number | null }
  epg: { sources: number; programmes: number; channels: number; indexed_at: number | null }
  now: number
}

export interface ProgrammeHit extends Programme {
  channel: { id: string; name: string; logo: string | null; country: string | null }
  airing: boolean
}

export interface GuideChannel extends Channel {
  programmes: Programme[]
}

export interface HistoryEntry {
  id: number
  channel_id: string
  channel_name: string
  channel_logo: string | null
  programme_title: string | null
  started_at: number
  last_seen_at: number
  duration_s: number
  available: boolean
}

export interface ContinueItem extends Channel {
  last_watched_at: number
  watched_s: number
}

export interface Reminder {
  id: number
  programme_id: number | null
  channel_id: string
  channel_name: string | null
  channel_logo: string | null
  title: string
  start: number
  stop: number
  notify_before_min: number
  status: 'upcoming' | 'airing' | 'ended'
}

export interface EpgSource {
  id: number
  location: string
  label: string | null
  enabled: number
  last_loaded_at: number | null
  last_status: string | null
  last_error: string | null
  programme_count: number
  mapped_channels: number
  unmapped_channels: number
}

// ------------------------------------------------------------- Phase 4 & 5 Types

export interface RecommendationsResponse {
  recommended: Channel[]
  because_you_watched: { channel: { id: string; name: string; country: string | null; categories: string[] }; items: Channel[] } | null
  live_now: Channel[]
  popular_in_country: { country: string | null; items: Channel[] }
  top_categories: string[]
}

export interface AiDiscoveryResponse {
  reply: string
  channels: Channel[]
  programmes: ProgrammeHit[]
  source: string
}

export interface VoiceCommandResponse {
  action: string
  feedback: string
  route?: string
  channel_id?: string
  channel_name?: string
  query?: string
  ai_result?: AiDiscoveryResponse
}

export interface WorldCountry {
  code: string
  name: string
  flag: string | null
  channels: number
  with_guide: number
  total_streams: number
  region: string
}

export interface WorldCountryDetail {
  country: { code: string; name: string; flag: string | null; region: string }
  total_channels: number
  categories: { id: string; name: string; channels: number }[]
  live_now: { id: number; channel_id: string; channel_name: string; channel_logo: string | null; title: string; start: number; stop: number; categories: string[] }[]
  channels: Channel[]
}

export interface MultiviewPreset {
  id: number
  name: string
  layout: 'dual' | 'triple' | 'quad' | 'focus'
  channel_ids: string[]
  created_at: number
}

export interface PairCodeResponse {
  code: string
  profile_id: number
  profile_name: string
  expires_in: number
  expires_at: number
}

export interface DeviceCommand {
  id: number
  command: string
  payload: Record<string, unknown>
  created_at: number
}

// ------------------------------------------------------------- 7-Day (168-Hour) Catch-Up TV Replay & Downloads

export type CatchupStatus = 'downloaded' | 'provider_archive' | 'local_dvr' | 'unavailable' | 'outside_window'

export interface CatchupDay {
  date: string
  label: string
  day_name: string
  start: number
  end: number
  is_today: boolean
  days_ago: number
}

export interface CatchupProgram extends Programme {
  catchup_status: CatchupStatus
  catchup_label: string
  catchup_url: string | null
  catchup_source_type: string | null
  can_download?: boolean
  expiry_s?: number
  expiry_text?: string | null
  download_id?: number | null
}

export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface DownloadItem {
  id: number
  programme_id: number | null
  channel_id: string
  channel_name: string
  channel_logo?: string | null
  title: string
  description?: string | null
  start: number
  stop: number
  duration_s: number
  source_url: string
  file_path?: string | null
  file_size_bytes: number
  bytes_downloaded: number
  progress: number
  status: DownloadStatus
  resumable: boolean
  error?: string | null
  playback_position_s: number
  created_at: number
  completed_at?: number | null
  playback_url?: string | null
}

export interface DownloadStorageInfo {
  download_folder: string
  total_files: number
  completed_count: number
  active_count: number
  used_bytes: number
  used_gb: number
  max_storage_gb: number
  disk_free_gb: number
  disk_total_gb: number
  auto_delete_enabled: boolean
  catchup_window_hours: number
}

export interface CatchupScheduleResponse {
  channel: ChannelDetail
  date: string
  start: number
  stop: number
  days_ago: number
  programmes: CatchupProgram[]
}

export interface CatchupResolveResponse {
  status: CatchupStatus
  label: string
  playback_url: string | null
  source_type: string | null
  catchup_type?: string
  dvr_recording_id?: number
}

// ------------------------------------------------------------- VOD (Movies, Series & On-Demand)

export interface VodItem {
  id: string
  type: 'movie' | 'series'
  title: string
  original_title?: string | null
  overview: string | null
  poster: string | null
  backdrop: string | null
  release_date: string | null
  genre: string[]
  rating: number | null
  duration_min: number | null
  trailer_url?: string | null
  stream_url?: string | null
}

export interface VodEpisode {
  id: string
  season_num: number
  episode_num: number
  title: string
  overview: string | null
  still_path: string | null
  duration_min: number | null
  stream_url: string
  rating: number | null
}

export interface VodSeason {
  season_num: number
  episodes: VodEpisode[]
}

export interface VodDetail extends VodItem {
  seasons?: VodSeason[]
  progress?: {
    watched_s: number
    total_s: number
    completed: boolean
  } | null
}

export interface VodFeaturedResponse {
  hero: VodItem | null
  movies: VodItem[]
  series: VodItem[]
}

export interface VodContinueItem {
  item_id: string
  series_id: string | null
  watched_s: number
  total_s: number
  completed: boolean
  updated_at: number
  title: string
  type: 'movie' | 'series'
  poster: string | null
  backdrop: string | null
  duration_min: number | null
  stream_url?: string | null
}

// ------------------------------------------------------------- DVR & Recordings

export interface Recording {
  id: number
  channel_id: string
  channel_name: string
  channel_logo: string | null
  programme_id: number | null
  title: string
  description: string | null
  start: number
  stop: number
  duration_s: number
  file_size_bytes: number
  status: 'scheduled' | 'recording' | 'completed' | 'failed'
  error: string | null
  expires_at: number
  created_at: number
  playback_url: string | null
}

export interface DvrStorage {
  recordings_count: number
  completed_count: number
  scheduled_count: number
  recordings_bytes: number
  retention_days: number
  disk_free_gb: number
  disk_total_gb: number
}

// ------------------------------------------------------------- IPTV Sources

export interface IptvSource {
  id: number
  name: string
  type: 'm3u' | 'xtream' | 'stalker'
  url: string
  channel_count: number
  catchup_days: number
  last_synced_at: number | null
  created_at: number
}

// ------------------------------------------------------------- 50 Advanced Features Additions

export interface WatchlistItem {
  id: number
  item_type: 'channel' | 'programme' | 'vod'
  item_id: string
  title: string
  metadata: Record<string, unknown>
  created_at: number
}

export interface WatchPartyMessage {
  id: number
  user_name: string
  user_color: string | null
  message: string
  created_at: number
}

export interface WatchParty {
  party_id: string
  name: string
  channel_id: string | null
  channel_name: string | null
  channel_logo: string | null
  stream_url: string | null
  playback_time: number
  is_playing: boolean
  last_updated_at: number
  messages: WatchPartyMessage[]
}

export interface RecordingRule {
  id: number
  rule_type: 'series' | 'keyword'
  query: string
  channel_id: string | null
  enabled: boolean
  created_at: number
}

export interface AiSummaryResponse {
  title: string
  summary: string
  source: string
}



