import { Check, Copy, Download, RefreshCw, Smartphone, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import {
  dispatchChannelDelta,
  dispatchNavigate,
  dispatchOpenAi,
  dispatchPlaybackCommand,
  dispatchTuneChannel,
} from '../lib/tvNav'
import type { PairCodeResponse } from '../types'

export default function SyncModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [pairData, setPairData] = useState<PairCodeResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [polling, setPolling] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const lastCmdId = useRef(0)
  const nav = useNavigate()
  const pollTimer = useRef<number | undefined>(undefined)

  const loadPairCode = async () => {
    try {
      const res = await api.createPairCode('Smart TV Display')
      setPairData(res)
      lastCmdId.current = 0
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (open) {
      loadPairCode()
      setPolling(true)
    } else {
      setPolling(false)
      window.clearInterval(pollTimer.current)
    }
  }, [open])

  const handleRemoteCommand = useCallback((command: string, payload: any) => {
    if (command === 'tune_channel' && payload?.channel_id) {
      dispatchTuneChannel(payload.channel_id)
      nav(`/watch/${payload.channel_id}`)
    } else if (command === 'channel_up') {
      dispatchChannelDelta(1)
    } else if (command === 'channel_down') {
      dispatchChannelDelta(-1)
    } else if (['play', 'pause', 'toggle_play', 'mute', 'unmute', 'toggle_mute', 'volume_up', 'volume_down', 'fullscreen'].includes(command)) {
      dispatchPlaybackCommand(command as any)
    } else if (command === 'navigate' && payload?.route) {
      dispatchNavigate(payload.route)
      nav(payload.route)
    } else if (command === 'open_ai') {
      dispatchOpenAi(payload?.query)
    } else if (command === 'voice_command' && payload?.text) {
      api.voiceCommand(payload.text).then((res) => {
        if (res.action === 'play_channel' && res.channel_id) {
          dispatchTuneChannel(res.channel_id)
          nav(`/watch/${res.channel_id}`)
        } else if (res.action === 'navigate' && res.route) {
          dispatchNavigate(res.route)
          nav(res.route)
        }
      })
    }
  }, [nav])

  // Poll for remote commands from paired mobile devices
  useEffect(() => {
    if (!polling || !pairData?.code) return

    pollTimer.current = window.setInterval(async () => {
      try {
        const cmds = await api.pollCommands(pairData.code, lastCmdId.current)
        for (const c of cmds) {
          if (c.id > lastCmdId.current) {
            lastCmdId.current = c.id
            handleRemoteCommand(c.command, c.payload)
          }
        }
      } catch { /* ignore */ }
    }, 1000)

    return () => window.clearInterval(pollTimer.current)
  }, [polling, pairData?.code, handleRemoteCommand])

  const copyUrl = () => {
    if (!pairData) return
    const url = `${window.location.origin}/remote?code=${pairData.code}`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleBackupExport = async () => {
    try {
      const data = await api.backupData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `smarttv-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setBackupMsg('Household data exported successfully!')
      setTimeout(() => setBackupMsg(null), 3000)
    } catch (e: any) {
      setBackupMsg(`Export failed: ${e.message}`)
    }
  }

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const res = await api.restoreData(json)
      setBackupMsg(`Restored! Added ${res.favorites_added} favorites and ${res.presets_added} presets.`)
      setTimeout(() => setBackupMsg(null), 4000)
    } catch (err: any) {
      setBackupMsg(`Restore error: ${err.message}`)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="relative mx-4 w-full max-w-lg rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-mute hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-strong text-white">
            <Smartphone size={20} />
          </span>
          <div>
            <h3 className="text-base font-bold text-white">Pair Phone & Companion Remote</h3>
            <p className="text-xs text-mute">Control your TV from your phone or sync across screens</p>
          </div>
        </div>

        {/* Pairing Code Box */}
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-accent/20 bg-ink-850 p-6 text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">TV Pairing Code</span>
          <div className="my-2 select-all font-mono text-4xl font-extrabold tracking-widest text-white">
            {pairData?.code || '••••••'}
          </div>
          <p className="max-w-xs text-xs text-mute">
            Open <span className="font-semibold text-slate-200">/remote</span> on your phone and enter this code, or use the direct link below.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={copyUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-ink-600 hover:text-white"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              <span>{copied ? 'Link Copied!' : 'Copy Mobile Link'}</span>
            </button>
            <button
              onClick={loadPairCode}
              title="Refresh code"
              className="rounded-lg bg-ink-700 p-1.5 text-mute hover:bg-ink-600 hover:text-white"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Status pill */}
        <div className="mt-4 flex items-center justify-between rounded-lg bg-ink-800/80 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-slate-300">Listening for remote commands...</span>
          </div>
          <span className="text-mute">Active Session</span>
        </div>

        {/* Household Sync Backup / Restore */}
        <div className="mt-6 border-t border-white/5 pt-4">
          <div className="text-xs font-bold uppercase tracking-wider text-mute mb-2">
            Household Data Sync
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackupExport}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-ink-800 py-2 text-xs font-medium text-slate-200 hover:bg-ink-700 hover:text-white"
            >
              <Download size={14} /> Export Backup
            </button>
            <label className="flex-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-ink-800 py-2 text-xs font-medium text-slate-200 hover:bg-ink-700 hover:text-white">
              <Upload size={14} /> Import Backup
              <input type="file" accept=".json" onChange={handleBackupImport} className="hidden" />
            </label>
          </div>
          {backupMsg && (
            <p className="mt-2 text-center text-xs font-medium text-emerald-400">{backupMsg}</p>
          )}
        </div>
      </div>
    </div>
  )
}
