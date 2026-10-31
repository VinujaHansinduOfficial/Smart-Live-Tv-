import Hls from 'hls.js'
import {
  Activity,
  Check,
  CircleDot,
  Copy,
  Ear,
  ExternalLink,
  FastForward,
  LoaderCircle,
  Maximize,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  Rewind,
  RotateCcw,
  Sliders,
  Sparkles,
  Subtitles,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { fmtSeconds } from '../lib/time'
import type { Stream } from '../types'

const STALL_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 8

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'failed'

export function browserCandidates(streams: Stream[]): { playable: Stream[]; skipped: number; total: number } {
  const httpsPage = typeof location !== 'undefined' && location.protocol === 'https:'
  const playable = streams.filter((s) => !(httpsPage && s.url.startsWith('http://')))
  playable.sort((a, b) => Number(!!(a.referrer || a.user_agent)) - Number(!!(b.referrer || b.user_agent)))
  return {
    playable: playable.slice(0, MAX_ATTEMPTS),
    skipped: streams.length - playable.length,
    total: playable.length,
  }
}

interface QualityLevel {
  index: number
  height: number
  width: number
  bitrate: number
  label: string
}

interface AudioTrack {
  id: number
  name: string
  lang?: string
}

interface SubtitleTrack {
  id: number
  name: string
  lang?: string
}

interface DiagnosticsData {
  resolution: string
  bitrateKbps: number | null
  bufferLengthSec: number
  droppedFrames: number
  totalFrames: number
  currentUrl: string
  engine: string
}

interface Props {
  streams: Stream[]
  overlay?: ReactNode
  onPlaying?: (url: string) => void
  onStopped?: () => void
  onProgress?: (currentTime: number, duration: number) => void
  autoPlay?: boolean
  initialTime?: number
  channelId?: string
  channelName?: string
  isLive?: boolean
  programmeTitle?: string
  onRestartBeginning?: () => void
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SLEEP_TIMER_OPTIONS = [0, 15, 30, 45, 60, 90]

export default function Player({
  streams,
  overlay,
  onPlaying,
  onStopped,
  onProgress,
  autoPlay = true,
  initialTime = 0,
  channelId,
  channelName,
  isLive = true,
  programmeTitle: _programmeTitle,
  onRestartBeginning,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const onPlayingRef = useRef(onPlaying)
  const onStoppedRef = useRef(onStopped)
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onPlayingRef.current = onPlaying
    onStoppedRef.current = onStopped
    onProgressRef.current = onProgress
  })

  const { playable, skipped, total } = useMemo(() => browserCandidates(streams), [streams])
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState<Status>(playable.length ? 'loading' : 'failed')
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [needsClick, setNeedsClick] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Scrubbing & Timing
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)

  // Quality, Audio, Subtitles
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([])
  const [currentQuality, setCurrentQuality] = useState<number>(-1) // -1 is Auto
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([])
  const [currentAudio, setCurrentAudio] = useState<number>(-1)
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([])
  const [currentSubtitle, setCurrentSubtitle] = useState<number>(-1) // -1 is Off

  // Menus & HUD
  const [openMenu, setOpenMenu] = useState<'quality' | 'speed' | 'audio' | 'subtitles' | 'external' | 'sleep' | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null)
  const [recordState, setRecordState] = useState<'idle' | 'recording' | 'success'>('idle')
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Advanced Playback Features (Features 25, 26, 29, 17)
  const [audioNormalized, setAudioNormalized] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [sleepTimerMin, setSleepTimerMin] = useState<number | null>(null)
  const [sleepRemainingSec, setSleepRemainingSec] = useState<number | null>(null)
  const [liveSpeechCaptions, setLiveSpeechCaptions] = useState(false)
  const [liveSubtitleText, setLiveSubtitleText] = useState('')
  const recognitionRef = useRef<any>(null)

  // Reset on stream list change
  useEffect(() => {
    setIndex(0)
    setStatus(playable.length ? 'loading' : 'failed')
  }, [playable])

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 < playable.length) return i + 1
      setStatus('failed')
      return i
    })
  }, [playable.length])

  // Sleep timer interval (Feature 29)
  useEffect(() => {
    if (!sleepTimerMin) {
      setSleepRemainingSec(null)
      return
    }
    let rem = sleepTimerMin * 60
    setSleepRemainingSec(rem)
    const t = setInterval(() => {
      rem -= 1
      if (rem <= 0) {
        clearInterval(t)
        setSleepTimerMin(null)
        setSleepRemainingSec(null)
        videoRef.current?.pause()
      } else {
        setSleepRemainingSec(rem)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [sleepTimerMin])

  // Playback engine initialization
  useEffect(() => {
    const video = videoRef.current
    const stream = playable[index]
    if (!video || !stream || status === 'failed') return
    setStatus('loading')
    setNeedsClick(false)
    let recoveredOnce = false

    const clear = () => window.clearTimeout(timerRef.current)
    const arm = () => {
      clear()
      timerRef.current = window.setTimeout(next, STALL_TIMEOUT_MS)
    }

    const handlePlaying = () => {
      clear()
      setStatus('playing')
      onPlayingRef.current?.(stream.url)
    }
    const handleError = () => next()
    const handlePause = () => {
      setStatus('paused')
      onStoppedRef.current?.()
    }
    const handleTimeUpdate = () => {
      if (!isScrubbing) {
        setCurrentTime(video.currentTime)
        setDuration(video.duration || 0)
        onProgressRef.current?.(video.currentTime, video.duration || 0)
      }
    }

    const handleLoadedMetadata = () => {
      if (initialTime > 0 && initialTime < (video.duration || Infinity)) {
        video.currentTime = initialTime
      }
    }

    video.addEventListener('playing', handlePlaying)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleError)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    arm()

    const tryPlay = () => {
      video.play().catch((err: DOMException) => {
        if (err.name === 'NotAllowedError') {
          video.muted = true
          setMuted(true)
          video.play().catch(() => {
            clear()
            setNeedsClick(true)
          })
        }
      })
    }

    const isHls = /\.m3u8($|\?)/i.test(stream.url) || !/\.(mp4|webm|ts)($|\?)/i.test(stream.url)
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 2,
        enableWorker: true,
      })
      hlsRef.current = hls

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const lvls: QualityLevel[] = data.levels.map((lvl, idx) => ({
          index: idx,
          height: lvl.height,
          width: lvl.width,
          bitrate: lvl.bitrate,
          label: lvl.height ? `${lvl.height}p` : `${Math.round(lvl.bitrate / 1000)}k`,
        }))
        setQualityLevels(lvls)

        const aTracks: AudioTrack[] = hls.audioTracks.map((t, idx) => ({
          id: idx,
          name: t.name || `Track ${idx + 1}`,
          lang: t.lang,
        }))
        setAudioTracks(aTracks)

        const sTracks: SubtitleTrack[] = hls.subtitleTracks.map((s, idx) => ({
          id: idx,
          name: s.name || `Sub ${idx + 1}`,
          lang: s.lang,
        }))
        setSubtitleTracks(sTracks)

        if (autoPlay) tryPlay()
      })

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setCurrentQuality(data.level)
      })

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
        setCurrentAudio(data.id)
      })

      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
        setCurrentSubtitle(data.id)
      })

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredOnce) {
          recoveredOnce = true
          hls.recoverMediaError()
          return
        }
        next()
      })

      hls.loadSource(stream.url)
      hls.attachMedia(video)
    } else {
      video.src = stream.url
      if (autoPlay) tryPlay()
    }

    return () => {
      clear()
      onStoppedRef.current?.()
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleError)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      hlsRef.current?.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
  }, [playable, index, attempt, next, autoPlay, initialTime, isScrubbing])

  // Diagnostics interval updater
  useEffect(() => {
    if (!showDiagnostics) return
    const id = setInterval(() => {
      const v = videoRef.current
      if (!v) return

      let bufLen = 0
      const cur = v.currentTime
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
          bufLen = Math.max(0, v.buffered.end(i) - cur)
          break
        }
      }

      let bitrate: number | null = null
      if (hlsRef.current && currentQuality >= 0 && qualityLevels[currentQuality]) {
        bitrate = Math.round(qualityLevels[currentQuality].bitrate / 1000)
      }

      const quality = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null
      setDiagnostics({
        resolution: v.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : 'Unknown',
        bitrateKbps: bitrate,
        bufferLengthSec: Math.round(bufLen * 10) / 10,
        droppedFrames: quality ? quality.droppedVideoFrames : 0,
        totalFrames: quality ? quality.totalVideoFrames : 0,
        currentUrl: playable[index]?.url || '',
        engine: hlsRef.current ? 'HLS.js (HTML5 MSE)' : 'Native HTML5',
      })
    }, 1000)

    return () => clearInterval(id)
  }, [showDiagnostics, currentQuality, qualityLevels, playable, index])

  // Audio Normalization (Feature 26)
  const toggleAudioNormalization = () => {
    const v = videoRef.current
    if (!v) return

    if (!audioCtxRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioContextClass) return
        const ctx = new AudioContextClass()
        const comp = ctx.createDynamicsCompressor()
        comp.threshold.setValueAtTime(-24, ctx.currentTime)
        comp.knee.setValueAtTime(30, ctx.currentTime)
        comp.ratio.setValueAtTime(12, ctx.currentTime)
        comp.attack.setValueAtTime(0.003, ctx.currentTime)
        comp.release.setValueAtTime(0.25, ctx.currentTime)

        const src = ctx.createMediaElementSource(v)
        src.connect(comp)
        comp.connect(ctx.destination)
        audioCtxRef.current = ctx
        setAudioNormalized(true)
      } catch {
        setAudioNormalized(false)
      }
    } else {
      if (audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend()
        setAudioNormalized(false)
      } else {
        audioCtxRef.current.resume()
        setAudioNormalized(true)
      }
    }
  }

  // Real-Time Speech Subtitles (Feature 17)
  const toggleLiveSpeechCaptions = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRec) {
      alert('Speech recognition is not available in this browser.')
      return
    }
    if (liveSpeechCaptions) {
      recognitionRef.current?.stop()
      setLiveSpeechCaptions(false)
      setLiveSubtitleText('')
    } else {
      try {
        const rec = new SpeechRec()
        rec.continuous = true
        rec.interimResults = true
        rec.lang = 'en-US'
        rec.onresult = (event: any) => {
          let transcript = ''
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript
          }
          setLiveSubtitleText(transcript)
        }
        rec.onerror = () => {
          setLiveSpeechCaptions(false)
        }
        rec.start()
        recognitionRef.current = rec
        setLiveSpeechCaptions(true)
      } catch {
        setLiveSpeechCaptions(false)
      }
    }
  }

  // Playback control functions
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    setMuted(v.muted)
  }

  const handleVolumeChange = (newVol: number) => {
    const v = videoRef.current
    if (!v) return
    v.volume = newVol
    setVolume(newVol)
    if (newVol > 0 && v.muted) {
      v.muted = false
      setMuted(false)
    }
  }

  const seek = (timeSec: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(timeSec, v.duration || Infinity))
    setCurrentTime(v.currentTime)
  }

  const jump = (deltaSec: number) => {
    const v = videoRef.current
    if (!v) return
    seek(v.currentTime + deltaSec)
  }

  const changeQuality = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex
      setCurrentQuality(levelIndex)
    }
    setOpenMenu(null)
  }

  const changeSpeed = (speed: number) => {
    const v = videoRef.current
    if (v) {
      v.playbackRate = speed
      setPlaybackSpeed(speed)
    }
    setOpenMenu(null)
  }

  const changeAudio = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id
      setCurrentAudio(id)
    }
    setOpenMenu(null)
  }

  const changeSubtitle = (id: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = id
      setCurrentSubtitle(id)
    }
    setOpenMenu(null)
  }

  const handleRecord = async () => {
    if (!channelId || recordState === 'recording') return
    setRecordState('recording')
    try {
      await api.recordInstant(channelId, 60, `${channelName || 'Live'} Broadcast`)
      setRecordState('success')
      setTimeout(() => setRecordState('idle'), 3000)
    } catch {
      setRecordState('idle')
    }
  }

  const copyUrl = () => {
    const stream = playable[index]
    if (!stream) return
    navigator.clipboard.writeText(stream.url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const pip = async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      /* unsupported */
    }
  }

  const fullscreen = () => {
    const el = videoRef.current?.parentElement
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen?.()
  }

  const retry = () => {
    setIndex(0)
    setStatus('loading')
    setAttempt((a) => a + 1)
  }

  // Global remote control event listener
  useEffect(() => {
    const handlePlayback = (e: CustomEvent<{ action: string }>) => {
      const v = videoRef.current
      if (!v) return
      const act = e.detail?.action
      if (act === 'play') v.play().catch(() => undefined)
      else if (act === 'pause') v.pause()
      else if (act === 'toggle_play') {
        if (v.paused) v.play().catch(() => undefined)
        else v.pause()
      } else if (act === 'mute') {
        v.muted = true
        setMuted(true)
      } else if (act === 'unmute') {
        v.muted = false
        setMuted(false)
      } else if (act === 'toggle_mute') {
        v.muted = !v.muted
        setMuted(v.muted)
      } else if (act === 'volume_up') {
        handleVolumeChange(Math.min(1, v.volume + 0.1))
      } else if (act === 'volume_down') {
        handleVolumeChange(Math.max(0, v.volume - 0.1))
      } else if (act === 'jump_forward') {
        jump(10)
      } else if (act === 'jump_backward') {
        jump(-10)
      } else if (act === 'fullscreen') {
        fullscreen()
      }
    }
    window.addEventListener('smarttv:playback' as any, handlePlayback)
    return () => window.removeEventListener('smarttv:playback' as any, handlePlayback)
  }, [])

  const currentStream = playable[index]
  const isVODorCatchup = !isLive || (duration > 0 && duration < 86400)

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black group select-none shadow-2xl">
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        onClick={togglePlay}
      />

      {/* Loading Overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-950/70 text-sm text-mute backdrop-blur-sm">
          <LoaderCircle className="animate-spin text-accent" size={36} />
          <span>Connecting{playable.length > 1 ? ` · source ${index + 1} of ${playable.length}` : ''}…</span>
        </div>
      )}

      {/* Autoplay blocked click-to-play overlay */}
      {needsClick && (
        <button
          onClick={() => {
            setNeedsClick(false)
            videoRef.current?.play()
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/50"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-strong shadow-lg hover:scale-105 transition-transform text-white">
            <Play size={30} className="translate-x-0.5" />
          </span>
        </button>
      )}

      {/* Playback Failed Overlay */}
      {status === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950 p-6 text-center">
          <TriangleAlert className="text-amber-400" size={36} />
          <p className="font-semibold text-lg text-white">Playback Error</p>
          <p className="max-w-md text-sm text-mute">
            {playable.length === 0
              ? skipped
                ? 'Its only sources use plain HTTP, which modern browsers block on HTTPS. Use desktop build or run over local HTTP.'
                : 'No playable streams found for this channel.'
              : `Tried ${playable.length}${total > playable.length ? ` of ${total}` : ''} sources. Stream is offline, geo-blocked, or requires external player.`}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
            {playable.length > 0 && (
              <button
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-xl bg-ink-700 px-4 py-2 text-sm font-semibold hover:bg-ink-600 text-white"
              >
                <RefreshCw size={15} /> Try again
              </button>
            )}
            {playable[0]?.url && (
              <a
                href={`vlc://${playable[0].url}`}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
              >
                <ExternalLink size={15} /> Open in VLC
              </a>
            )}
          </div>
        </div>
      )}

      {/* Live AI Speech-to-Text Subtitles (Feature 17) */}
      {liveSpeechCaptions && liveSubtitleText && (
        <div className="pointer-events-none absolute bottom-16 inset-x-8 z-30 flex justify-center animate-fade-in">
          <div className="max-w-2xl rounded-xl bg-black/85 px-4 py-2 text-center text-sm font-medium text-amber-200 border border-white/10 shadow-2xl backdrop-blur">
            {liveSubtitleText}
          </div>
        </div>
      )}

      {/* Diagnostics HUD Overlay (Feature 27) */}
      {showDiagnostics && diagnostics && (
        <div className="absolute top-4 left-4 z-20 max-w-sm rounded-xl bg-black/85 p-3.5 text-xs font-mono text-slate-200 border border-white/10 backdrop-blur shadow-2xl">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-2">
            <span className="font-bold text-accent flex items-center gap-1.5">
              <Activity size={14} /> Stream Diagnostics
            </span>
            <button
              onClick={() => setShowDiagnostics(false)}
              className="p-1 hover:text-white rounded"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-mute">Resolution:</span>
              <span className="font-semibold">{diagnostics.resolution}</span>
            </div>
            {diagnostics.bitrateKbps && (
              <div className="flex justify-between">
                <span className="text-mute">Bitrate:</span>
                <span className="font-semibold">{diagnostics.bitrateKbps} kbps</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-mute">Buffer Health:</span>
              <span className="font-semibold">{diagnostics.bufferLengthSec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">Frames Dropped:</span>
              <span className="font-semibold">
                {diagnostics.droppedFrames} / {diagnostics.totalFrames}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">Engine:</span>
              <span className="text-slate-300">{diagnostics.engine}</span>
            </div>
            <div className="pt-1 text-[10px] text-mute break-all border-t border-white/10 mt-1.5">
              {diagnostics.currentUrl}
            </div>
          </div>
        </div>
      )}

      {/* Floating Menus (Quality, Speed, Subtitles, Audio, Sleep Timer, External Launchers) */}
      {openMenu && (
        <div className="absolute bottom-16 right-4 z-30 min-w-48 rounded-xl bg-ink-900/95 p-2 text-sm text-slate-200 border border-white/10 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/10 px-2 text-xs font-bold uppercase tracking-wider text-mute">
            <span>{openMenu}</span>
            <button onClick={() => setOpenMenu(null)} className="hover:text-white">
              <X size={12} />
            </button>
          </div>

          {openMenu === 'quality' && (
            <div className="space-y-1">
              <button
                onClick={() => changeQuality(-1)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                  currentQuality === -1 ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                }`}
              >
                <span>Auto</span>
                {currentQuality === -1 && <Check size={14} />}
              </button>
              {qualityLevels.map((lvl) => (
                <button
                  key={lvl.index}
                  onClick={() => changeQuality(lvl.index)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                    currentQuality === lvl.index ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                  }`}
                >
                  <span>{lvl.label}</span>
                  {currentQuality === lvl.index && <Check size={14} />}
                </button>
              ))}
            </div>
          )}

          {openMenu === 'speed' && (
            <div className="space-y-1">
              {SPEED_OPTIONS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => changeSpeed(speed)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                    playbackSpeed === speed ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                  }`}
                >
                  <span>{speed}x</span>
                  {playbackSpeed === speed && <Check size={14} />}
                </button>
              ))}
            </div>
          )}

          {openMenu === 'sleep' && (
            <div className="space-y-1">
              {SLEEP_TIMER_OPTIONS.map((min) => (
                <button
                  key={min}
                  onClick={() => {
                    setSleepTimerMin(min === 0 ? null : min)
                    setOpenMenu(null)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                    (min === 0 && sleepTimerMin === null) || sleepTimerMin === min
                      ? 'bg-accent font-semibold text-white'
                      : 'hover:bg-white/10'
                  }`}
                >
                  <span>{min === 0 ? 'Off' : `${min} minutes`}</span>
                  {((min === 0 && sleepTimerMin === null) || sleepTimerMin === min) && <Check size={14} />}
                </button>
              ))}
            </div>
          )}

          {openMenu === 'audio' && (
            <div className="space-y-1">
              {audioTracks.length === 0 ? (
                <p className="px-2 py-1 text-xs text-mute">Default stream audio</p>
              ) : (
                audioTracks.map((tr) => (
                  <button
                    key={tr.id}
                    onClick={() => changeAudio(tr.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                      currentAudio === tr.id ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                    }`}
                  >
                    <span>{tr.name} {tr.lang ? `(${tr.lang})` : ''}</span>
                    {currentAudio === tr.id && <Check size={14} />}
                  </button>
                ))
              )}
            </div>
          )}

          {openMenu === 'subtitles' && (
            <div className="space-y-1">
              <button
                onClick={() => changeSubtitle(-1)}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                  currentSubtitle === -1 && !liveSpeechCaptions ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                }`}
              >
                <span>Off</span>
                {currentSubtitle === -1 && !liveSpeechCaptions && <Check size={14} />}
              </button>

              {/* AI Live Speech-to-Text Captions */}
              <button
                onClick={toggleLiveSpeechCaptions}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                  liveSpeechCaptions ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10 text-amber-300'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Sparkles size={12} /> AI Live Captions
                </span>
                {liveSpeechCaptions && <Check size={14} />}
              </button>

              {subtitleTracks.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => changeSubtitle(sub.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left ${
                    currentSubtitle === sub.id ? 'bg-accent font-semibold text-white' : 'hover:bg-white/10'
                  }`}
                >
                  <span>{sub.name} {sub.lang ? `(${sub.lang})` : ''}</span>
                  {currentSubtitle === sub.id && <Check size={14} />}
                </button>
              ))}
            </div>
          )}

          {openMenu === 'external' && currentStream && (
            <div className="space-y-1.5 p-1">
              <a
                href={`vlc://${currentStream.url}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/10 text-slate-200"
              >
                <ExternalLink size={14} /> Open in VLC
              </a>
              <a
                href={`mpv://${currentStream.url}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/10 text-slate-200"
              >
                <ExternalLink size={14} /> Open in MPV
              </a>
              <button
                onClick={copyUrl}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-white/10 text-slate-200 text-left"
              >
                <Copy size={14} /> {copiedUrl ? 'Copied URL!' : 'Copy Stream URL'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Player Chrome / Controls Bar */}
      {status !== 'failed' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-12 transition-opacity opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          {/* Progress / Seek Bar for VOD, Catchup & Recordings */}
          {isVODorCatchup && duration > 0 && (
            <div className="pointer-events-auto mb-2 flex items-center gap-3 text-xs text-slate-300 font-mono">
              <span>{fmtSeconds(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={1}
                value={currentTime}
                onMouseDown={() => setIsScrubbing(true)}
                onTouchStart={() => setIsScrubbing(true)}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  setCurrentTime(val)
                }}
                onMouseUp={(e) => {
                  setIsScrubbing(false)
                  seek(Number((e.target as HTMLInputElement).value))
                }}
                onTouchEnd={(e) => {
                  setIsScrubbing(false)
                  seek(Number((e.target as HTMLInputElement).value))
                }}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-accent focus:outline-none"
              />
              <span>{fmtSeconds(duration)}</span>
            </div>
          )}

          <div className="pointer-events-auto flex items-center justify-between gap-3">
            {/* Left controls: Play/Pause, Rewind, Forward, Live badge, Restart From Beginning, Volume */}
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={togglePlay}
                className="rounded-lg p-1.5 text-white hover:bg-white/10 transition-colors"
                title={status === 'playing' ? 'Pause' : 'Play'}
                aria-label={status === 'playing' ? 'Pause' : 'Play'}
              >
                {status === 'playing' ? <Pause size={18} /> : <Play size={18} />}
              </button>

              {isVODorCatchup && (
                <>
                  <button
                    onClick={() => jump(-10)}
                    className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10"
                    title="Rewind 10 seconds"
                    aria-label="Rewind 10 seconds"
                  >
                    <Rewind size={16} />
                  </button>
                  <button
                    onClick={() => jump(10)}
                    className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10"
                    title="Forward 10 seconds"
                    aria-label="Forward 10 seconds"
                  >
                    <FastForward size={16} />
                  </button>
                </>
              )}

              {/* Volume Slider & Mute Toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleMute}
                  className="rounded-lg p-1.5 text-slate-300 hover:text-white hover:bg-white/10"
                  title={muted ? 'Unmute' : 'Mute'}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="hidden md:block h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/20 accent-accent"
                  title="Volume"
                  aria-label="Volume slider"
                />
              </div>

              {/* Live Badge */}
              {isLive && !isVODorCatchup && (
                <span className="flex items-center gap-1.5 rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-400">
                  <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                  LIVE
                </span>
              )}

              {/* Watch From Beginning (Feature 3) */}
              {isLive && onRestartBeginning && (
                <button
                  onClick={onRestartBeginning}
                  className="flex items-center gap-1 rounded-lg bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent hover:bg-accent hover:text-white transition-colors"
                  title="Restart show from the beginning"
                >
                  <RotateCcw size={12} />
                  <span className="hidden lg:inline">From Beginning</span>
                </button>
              )}

              <div className="min-w-0 truncate hidden sm:block">{overlay}</div>
            </div>

            {/* Right controls: Normalizer, Record, Subtitles, Quality, Speed, Sleep Timer, Diagnostics, External, PiP, Fullscreen */}
            <div className="flex shrink-0 items-center gap-1 text-slate-300">
              {/* Audio Normalization (Feature 26) */}
              <button
                onClick={toggleAudioNormalization}
                className={`rounded-lg p-1.5 hover:bg-white/10 hover:text-white transition-colors ${
                  audioNormalized ? 'text-accent' : ''
                }`}
                title={audioNormalized ? 'Audio Normalizer ON' : 'Audio Normalizer (Compress dynamic range)'}
              >
                <Ear size={17} />
              </button>

              {/* DVR Instant Record Button */}
              {channelId && isLive && (
                <button
                  onClick={handleRecord}
                  disabled={recordState === 'recording'}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition-all ${
                    recordState === 'recording'
                      ? 'bg-rose-500 text-white animate-pulse'
                      : recordState === 'success'
                      ? 'bg-emerald-600 text-white'
                      : 'hover:bg-white/10 text-slate-300 hover:text-white'
                  }`}
                  title="Record Live Stream to DVR"
                >
                  <CircleDot size={14} className={recordState === 'recording' ? 'animate-spin' : ''} />
                  <span className="hidden md:inline">
                    {recordState === 'recording' ? 'Recording…' : recordState === 'success' ? 'Recorded!' : 'DVR Rec'}
                  </span>
                </button>
              )}

              {/* Subtitles & AI Live Captions (Features 17 & 18) */}
              <button
                onClick={() => setOpenMenu(openMenu === 'subtitles' ? null : 'subtitles')}
                className={`rounded-lg p-1.5 hover:bg-white/10 hover:text-white ${
                  currentSubtitle !== -1 || liveSpeechCaptions ? 'text-accent' : ''
                }`}
                title="Subtitles & AI Live Captions"
              >
                <Subtitles size={17} />
              </button>

              {/* Sleep Timer (Feature 29) */}
              <button
                onClick={() => setOpenMenu(openMenu === 'sleep' ? null : 'sleep')}
                className={`rounded-lg p-1.5 hover:bg-white/10 hover:text-white relative ${
                  sleepTimerMin ? 'text-accent' : ''
                }`}
                title={sleepRemainingSec ? `Sleep in ${Math.ceil(sleepRemainingSec / 60)} min` : 'Sleep Timer'}
              >
                <Moon size={17} />
                {sleepRemainingSec && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                    {Math.ceil(sleepRemainingSec / 60)}
                  </span>
                )}
              </button>

              {/* Quality Selector */}
              {qualityLevels.length > 0 && (
                <button
                  onClick={() => setOpenMenu(openMenu === 'quality' ? null : 'quality')}
                  className="rounded-lg p-1.5 text-xs font-semibold hover:bg-white/10 hover:text-white"
                  title="Quality rendition"
                >
                  {currentQuality === -1 ? 'Auto' : qualityLevels[currentQuality]?.label || 'HD'}
                </button>
              )}

              {/* Playback Speed */}
              <button
                onClick={() => setOpenMenu(openMenu === 'speed' ? null : 'speed')}
                className="rounded-lg p-1.5 text-xs font-mono font-semibold hover:bg-white/10 hover:text-white"
                title="Playback speed"
              >
                {playbackSpeed}x
              </button>

              {/* Diagnostics HUD Toggle (Feature 27) */}
              <button
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className={`rounded-lg p-1.5 hover:bg-white/10 hover:text-white ${
                  showDiagnostics ? 'text-accent' : ''
                }`}
                title="Toggle Stream Diagnostics HUD"
              >
                <Activity size={17} />
              </button>

              {/* External Players & Launchers */}
              <button
                onClick={() => setOpenMenu(openMenu === 'external' ? null : 'external')}
                className="rounded-lg p-1.5 hover:bg-white/10 hover:text-white"
                title="External Player & Stream Options"
              >
                <Sliders size={17} />
              </button>

              {/* Picture-in-Picture */}
              <button
                onClick={pip}
                className="rounded-lg p-1.5 hover:bg-white/10 hover:text-white"
                title="Picture-in-Picture"
              >
                <PictureInPicture2 size={17} />
              </button>

              {/* Fullscreen */}
              <button
                onClick={fullscreen}
                className="rounded-lg p-1.5 hover:bg-white/10 hover:text-white"
                title="Fullscreen"
              >
                <Maximize size={17} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
