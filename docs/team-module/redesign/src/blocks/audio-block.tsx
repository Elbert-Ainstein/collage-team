import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { AudioData, AudioSpeed } from '../types'
import { AUDIO_SPEEDS } from '../types'
import type { BlockProps } from './shared'

const ErrorIcon = mIcon('error')
const AudioFileIcon = mIcon('audio_file')
const PauseIcon = mIcon('pause')
const PlayArrowIcon = mIcon('play_arrow')
const UploadIcon = mIcon('upload')
const VolumeUpIcon = mIcon('volume_up')
const VolumeOffIcon = mIcon('volume_off')

/** Tiny generated WAV (soft sine sweep) so the sample player works offline. */
function makeSampleAudio(): string {
  const rate = 8000
  const seconds = 6
  const samples = rate * seconds
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) bytes[offset + i] = s.charCodeAt(i)
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  writeStr(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true) // 8-bit
  writeStr(36, 'data')
  view.setUint32(40, samples, true)
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate
    const freq = 220 + 60 * Math.sin(t * 0.8)
    const envelope = Math.min(1, t * 4) * Math.min(1, (seconds - t) * 2)
    bytes[44 + i] = Math.round(128 + 90 * envelope * Math.sin(2 * Math.PI * freq * t) * 0.4)
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `data:audio/wav;base64,${btoa(binary)}`
}

let cachedSample: string | null = null
function sampleAudioUrl(): string {
  cachedSample ??= makeSampleAudio()
  return cachedSample
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AudioBlock({ data, status, viewMode, onChange }: BlockProps<AudioData>): ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState<AudioSpeed>(1)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const editing = viewMode === 'edit'
  void status

  const resolvedUrl = data.url === 'sample' ? sampleAudioUrl() : data.url

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = speed
  }, [speed, resolvedUrl])

  const togglePlay = (): void => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  const handleFile = (file: File): void => {
    if (!file.type.startsWith('audio/')) {
      onChange({ ...data, failed: true })
      setErrorMessage('Audio File not supported')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      onChange({ ...data, failed: true })
      setErrorMessage('Audio File size exceeded (mp3 files only, up to 10 MB)')
      return
    }
    setErrorMessage(null)
    onChange({ ...data, url: URL.createObjectURL(file), title: data.title || file.name, failed: false })
  }

  const cycleSpeed = (): void => {
    const index = AUDIO_SPEEDS.indexOf(speed)
    setSpeed(AUDIO_SPEEDS[(index + 1) % AUDIO_SPEEDS.length])
  }

  return (
    <div className="rounded-lg border border-line px-2 py-3 shadow-2xs transition-shadow focus-within:shadow-md" style={{ backgroundColor: '#fffaec' }}>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      {!resolvedUrl && !data.failed ? (
        editing ? (
          <div
            className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-1 py-10"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files?.[0]
              if (file) handleFile(file)
            }}
          >
            <AudioFileIcon size={20} className="text-neutral-600" />
            <p className="text-xs font-medium text-neutral-950">Drop audio files here</p>
            <p className="text-xs font-medium text-[#bbbbbb]">MP3 files only, up to 10 MB</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-1 flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
            >
              <UploadIcon size={16} /> Browse Files
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 py-8">
            <p className="font-serif text-2xl text-[#bbbbbb]">404</p>
            <p className="text-xs text-[#bbbbbb]">Something went wrong</p>
          </div>
        )
      ) : (
        <div className="flex items-center gap-4 bg-cream-300 px-4 py-3">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          {resolvedUrl && !data.failed && (
            <audio
              ref={audioRef}
              src={resolvedUrl}
              muted={muted}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => setPlaying(false)}
            />
          )}

          {data.failed ? (
            <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-lg border-2 border-red-600 bg-[#fdf3f2]">
              <ErrorIcon size={24} className="text-red-600" />
            </div>
          ) : (
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-lg border-2 border-line bg-cream-100 hover:bg-cream-400"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <PauseIcon size={28} /> : <PlayArrowIcon size={28} className="ml-0.5" />}
            </button>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
            {data.failed ? (
              <p className="text-sm font-medium text-neutral-950">{errorMessage ?? 'Audio failed to load'}</p>
            ) : editing ? (
              <input
                value={data.title}
                placeholder="Audio file name edit here"
                onChange={(e) => onChange({ ...data, title: e.target.value })}
                className="w-full bg-transparent text-sm font-medium leading-5 text-neutral-950 outline-none placeholder:text-muted-fg"
              />
            ) : (
              <p className="truncate text-sm font-medium leading-5 text-neutral-950">{data.title || 'Audio'}</p>
            )}
            <div className="flex items-center gap-2.5">
              <div
                className="h-2 flex-1 cursor-pointer rounded-full bg-navy/15"
                onClick={(e) => {
                  const audio = audioRef.current
                  if (!audio || !duration || data.failed) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration
                }}
              >
                <div
                  className="h-2 rounded-full bg-navy"
                  style={{ width: duration > 0 ? `${(time / duration) * 100}%` : '0%' }}
                />
              </div>
              <span className="whitespace-nowrap text-xs text-[#bbbbbb]">
                {formatTime(time)}/{formatTime(duration)}
              </span>
            </div>
          </div>

          {!data.failed && (
            <>
              <button type="button" onClick={() => setMuted((v) => !v)} title="Volume" className="text-neutral-800">
                {muted ? <VolumeOffIcon size={28} /> : <VolumeUpIcon size={28} />}
              </button>
              <button
                type="button"
                onClick={cycleSpeed}
                title="Playback speed"
                className="w-10 text-center text-base font-semibold text-neutral-800"
              >
                {speed}X
              </button>
            </>
          )}

          {editing && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Re-upload audio"
              className="rounded-lg bg-navy p-2 text-cream hover:bg-navy-deep"
            >
              <UploadIcon size={20} />
            </button>
          )}
        </div>
      )}

      {!editing && !data.failed && resolvedUrl && data.description && (
        <p className="mt-1 px-4 text-xs leading-4 text-neutral-500">{data.description}</p>
      )}
    </div>
  )
}
