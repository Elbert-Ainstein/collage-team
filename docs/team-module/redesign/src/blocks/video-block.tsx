import { useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { VideoData } from '../types'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const InfoIcon = mIcon('info')
const LinkIcon = mIcon('link')
const AutoAwesomeIcon = mIcon('auto_awesome')
const UploadIcon = mIcon('upload')
const VideoIcon = mIcon('videocam')
const PlayIcon = mIcon('play_arrow')
const OpenIcon = mIcon('open_in_new')

type VideoMode = 'default' | 'link' | 'generate'

/** Extract the YouTube video id from watch / youtu.be / embed URLs. */
function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/)
  return m ? m[1] : null
}

/**
 * A YouTube video renders as a poster with a play button that lazy-mounts the
 * iframe on click. That keeps it working on localhost while degrading to an
 * "Open on YouTube" link inside the sandboxed artifact (whose CSP blocks the
 * embed iframe from loading at all).
 */
function YouTubeFrame({ id }: { id: string }): ReactElement {
  const [playing, setPlaying] = useState(false)
  if (playing) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
        title="Video"
        className="aspect-video w-full rounded-lg"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    )
  }
  return (
    <div
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg"
      style={{ backgroundImage: 'linear-gradient(135deg, #0e3354, #002341)' }}
    >
      <button
        type="button"
        onClick={() => setPlaying(true)}
        title="Play video"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-navy shadow-lg transition-transform hover:scale-105"
      >
        <PlayIcon size={34} />
      </button>
      <a
        href={`https://www.youtube.com/watch?v=${id}`}
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-black/40 px-2 py-1 text-xs text-white hover:bg-black/60"
      >
        <OpenIcon size={13} /> YouTube
      </a>
    </div>
  )
}

function VideoFrame({ url, editing }: { url: string; editing: boolean }): ReactElement {
  const ytId = youtubeId(url)
  return (
    <div className="rounded-lg border border-neutral-200 bg-cream-300 px-2 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
      {ytId ? (
        <YouTubeFrame id={ytId} />
      ) : /^(https?:|blob:)/.test(url) ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={url} controls className="aspect-video w-full rounded-lg bg-black" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center">
          <div className="flex h-[50px] w-[50px] items-center justify-center rounded-lg border-2 border-line bg-cream-100">
            <VideoIcon size={20} className="text-neutral-400" />
          </div>
        </div>
      )}
      {editing && <span className="sr-only">editable video</span>}
    </div>
  )
}

export function VideoBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<VideoData>): ReactElement {
  const [mode, setMode] = useState<VideoMode>('default')
  const [linkValue, setLinkValue] = useState('')
  const editing = viewMode === 'edit'

  if (status === 'generation-failed')
    return <ErrorGenerateCard onRetry={onGenerate} message="We couldn't generate your card. Please try again." />

  if (!editing) {
    return (
      <div className="rounded-lg border border-line px-2 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
        {data.url ? (
          <VideoFrame url={data.url} editing={false} />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-cream-300">
            <div className="flex h-[50px] w-[50px] items-center justify-center rounded-lg border-2 border-line bg-cream-100">
              <VideoIcon size={20} className="text-neutral-400" />
            </div>
          </div>
        )}
        {data.caption && <p className="mt-1 text-center text-[11px] leading-[14px] text-[#bbbbbb]">{data.caption}</p>}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-line px-2 py-3 shadow-2xs transition-shadow focus-within:shadow-md" style={{ backgroundColor: '#fffaec' }}>
      {data.url ? (
        <div className="group/vid flex flex-col gap-1">
          <div className="relative">
            <VideoFrame url={data.url} editing />
            <div className="absolute right-4 top-2 hidden overflow-hidden rounded-lg border border-line bg-page shadow-xs group-hover/vid:flex">
              <button
                type="button"
                title="Regenerate with AI (Shift-click to demo failure)"
                onClick={(e) => onGenerate(e.shiftKey)}
                className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300"
              >
                <AutoAwesomeIcon size={16} />
              </button>
              <button
                type="button"
                title="Paste video link"
                onClick={() => {
                  onChange({ ...data, url: null })
                  setMode('link')
                }}
                className="flex h-8 w-9 items-center justify-center hover:bg-cream-300"
              >
                <LinkIcon size={16} />
              </button>
            </div>
          </div>
          <input
            value={data.caption}
            placeholder="Add a caption"
            onChange={(e) => onChange({ ...data, caption: e.target.value })}
            className="w-full bg-transparent text-center text-[11px] leading-[14px] text-[#bbbbbb] outline-none placeholder:text-black/20"
          />
        </div>
      ) : mode === 'default' ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-1 py-2">
          <UploadIcon size={20} className="text-neutral-500" />
          <p className="text-xs font-medium text-neutral-950">Add a video by link or generate one with AI</p>
          <div className="mt-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('link')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
            >
              <LinkIcon size={16} /> Paste link
            </button>
            <button
              type="button"
              onClick={() => setMode('generate')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
            >
              <AutoAwesomeIcon size={16} /> Generate
            </button>
          </div>
        </div>
      ) : mode === 'link' ? (
        <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-3">
          <button type="button" onClick={() => setMode('default')} title="Back">
            <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
          </button>
          <input
            value={linkValue}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => setLinkValue(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-xs outline-none placeholder:text-black/30"
          />
          <button
            type="button"
            onClick={() => {
              if (/^https?:\/\//i.test(linkValue)) {
                onChange({ ...data, url: linkValue, loadFailed: false })
                setMode('default')
              }
            }}
            className="h-8 rounded-lg bg-navy px-4 text-sm font-medium text-cream hover:bg-navy-deep"
          >
            Add
          </button>
        </div>
      ) : (
        /* "Generate video with AI" panel (Figma 3475:3561) */
        <div className="flex flex-col gap-3 p-1">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setMode('default')} title="Back">
              <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
            </button>
            <h4 className="text-base font-semibold text-neutral-950">Generate video with AI</h4>
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-[#eaf2fd] p-3">
            <InfoIcon size={16} className="mt-0.5 shrink-0 text-[#1b66c9]" />
            <p className="text-xs font-medium leading-4 text-[#1b66c9]">
              Generating the video may take a few minutes. Please stay on this page until the video is ready.
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-line p-3">
            <p className="border-b border-line pb-1.5 text-sm font-medium text-neutral-950">
              Phase Transitions of Matter
            </p>
            <p className="mt-1.5 text-xs leading-4 text-[#bbbbbb]">
              The video will be generated from this section&apos;s content: particle motion, energy
              transfer, and the six phase transitions between solid, liquid, and gas.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              title="Shift-click to demo failure"
              onClick={(e) => {
                onGenerate(e.shiftKey)
                setMode('default')
              }}
              className="h-9 rounded-lg bg-navy px-4 text-sm font-medium text-cream hover:bg-navy-deep"
            >
              Generate
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
