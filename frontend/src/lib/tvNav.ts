/** TV Navigation, Remote Commands Dispatcher & Event Bus */

export interface PlaybackCommandDetail {
  action: 'play' | 'pause' | 'toggle_play' | 'mute' | 'unmute' | 'toggle_mute' | 'volume_up' | 'volume_down' | 'fullscreen'
}

export function dispatchPlaybackCommand(action: PlaybackCommandDetail['action']) {
  window.dispatchEvent(new CustomEvent<PlaybackCommandDetail>('smarttv:playback', { detail: { action } }))
}

export function dispatchNavigate(route: string) {
  window.dispatchEvent(new CustomEvent<{ route: string }>('smarttv:navigate', { detail: { route } }))
}

export function dispatchTuneChannel(channelId: string) {
  window.dispatchEvent(new CustomEvent<{ channelId: string }>('smarttv:tune', { detail: { channelId } }))
}

export function dispatchChannelDelta(delta: number) {
  window.dispatchEvent(new CustomEvent<{ delta: number }>('smarttv:channel_delta', { detail: { delta } }))
}

export function dispatchOpenAi(query?: string) {
  window.dispatchEvent(new CustomEvent<{ query?: string }>('smarttv:open_ai', { detail: { query } }))
}

export function dispatchTriggerVoice() {
  window.dispatchEvent(new CustomEvent('smarttv:trigger_voice'))
}

// TV 10-Foot Mode storage
const TV_MODE_KEY = 'smarttv.tv_mode'

export function isTvMode(): boolean {
  try {
    return localStorage.getItem(TV_MODE_KEY) === '1'
  } catch {
    return false
  }
}

export function setTvMode(enabled: boolean) {
  try {
    if (enabled) {
      localStorage.setItem(TV_MODE_KEY, '1')
      document.documentElement.classList.add('tv-mode')
    } else {
      localStorage.removeItem(TV_MODE_KEY)
      document.documentElement.classList.remove('tv-mode')
    }
  } catch { /* ignore */ }
}

