import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { ImageData } from '../types'
import { ErrorGenerateCard, GenerateImagePanel, placeholderImage } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const ImageIcon = mIcon('image')
const LinkIcon = mIcon('link')
const AutoAwesomeIcon = mIcon('auto_awesome')
const UploadIcon = mIcon('upload')
const CloseIcon = mIcon('close')

type ImageMode = 'default' | 'link' | 'prompt' | 'uploading'

/** Secondary cream button used in the dashed upload zone. */
function ZoneButton({ icon, label, onClick }: { icon: ReactElement; label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
    >
      {icon}
      {label}
    </button>
  )
}

export function ImageBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<ImageData>): ReactElement {
  const [mode, setMode] = useState<ImageMode>('default')
  const [linkValue, setLinkValue] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadPct, setUploadPct] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTimer = useRef<number | null>(null)
  const editing = viewMode === 'edit'

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const resolvedUrl = data.url === 'sample' ? placeholderImage('States of Matter') : data.url

  const startUpload = (file: File): void => {
    setUploadName(file.name)
    setUploadPct(0)
    setMode('uploading')
    const objectUrl = URL.createObjectURL(file)
    let pct = 0
    const tick = (): void => {
      pct += 20
      setUploadPct(pct)
      if (pct >= 100) {
        onChange({ ...data, url: objectUrl, source: 'upload', failed: false })
        setMode('default')
      } else {
        uploadTimer.current = window.setTimeout(tick, 250)
      }
    }
    uploadTimer.current = window.setTimeout(tick, 250)
  }

  const cancelUpload = (): void => {
    if (uploadTimer.current !== null) window.clearTimeout(uploadTimer.current)
    setMode('default')
  }

  /* ---------- student view ---------- */
  if (!editing) {
    return (
      <div className="rounded-lg border border-line bg-cream-100 px-2 py-3 shadow-2xs">
        {resolvedUrl ? (
          <div className="rounded-lg border border-neutral-200 px-2 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
            <img src={resolvedUrl} alt={data.altText} className="w-full rounded-lg object-cover" />
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg bg-cream-300">
            <div className="flex h-[50px] w-[50px] items-center justify-center rounded-lg border-2 border-line bg-cream-100">
              <ImageIcon size={20} className="text-neutral-400" />
            </div>
          </div>
        )}
        {data.caption && <p className="mt-1 text-center text-[11px] leading-[14px] text-[#bbbbbb]">{data.caption}</p>}
      </div>
    )
  }

  /* ---------- editor ---------- */
  const backChevron = (
    <button type="button" onClick={() => setMode('default')} title="Back">
      <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
    </button>
  )

  const inputRow = (children: ReactElement): ReactElement => (
    <div className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-3">
      {backChevron}
      {children}
    </div>
  )

  return (
    <div className="rounded-lg border border-line bg-cream-200 px-2 py-3 shadow-2xs transition-shadow focus-within:shadow-md" style={{ backgroundColor: '#fffaec' }}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) startUpload(file)
          e.target.value = ''
        }}
      />

      {resolvedUrl ? (
        <div className="flex flex-col gap-1">
          <div className="group/img relative rounded-lg border border-neutral-200 px-2 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
            <img src={resolvedUrl} alt={data.altText} className="w-full rounded-lg object-cover" />
            {/* hover toolbar: AI / replace / link */}
            <div className="absolute right-4 top-2 hidden overflow-hidden rounded-lg border border-line bg-page shadow-xs group-hover/img:flex">
              <button
                type="button"
                title="Generate with AI"
                onClick={() => {
                  onChange({ ...data, url: null })
                  setMode('prompt')
                }}
                className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300"
              >
                <AutoAwesomeIcon size={16} />
              </button>
              <button
                type="button"
                title="Replace image"
                onClick={() => fileRef.current?.click()}
                className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300"
              >
                <UploadIcon size={16} />
              </button>
              <button
                type="button"
                title="Paste image link"
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
            value={data.altText}
            placeholder="Alt text here"
            onChange={(e) => onChange({ ...data, altText: e.target.value })}
            className="h-8 w-full rounded-lg border border-line bg-white px-2 text-xs shadow-xs outline-none placeholder:text-black/30"
          />
          <input
            value={data.caption}
            placeholder="Add a caption"
            onChange={(e) => onChange({ ...data, caption: e.target.value })}
            className="w-full bg-transparent text-center text-[11px] leading-[14px] text-[#bbbbbb] outline-none placeholder:text-black/20"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {mode === 'default' && (
            <>
              <div
                className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-1 py-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const file = e.dataTransfer.files?.[0]
                  if (file) startUpload(file)
                }}
              >
                <UploadIcon size={20} className="text-neutral-500" />
                <p className="text-xs font-medium text-neutral-950">
                  Drag and drop or{' '}
                  <button type="button" className="text-navy underline" onClick={() => fileRef.current?.click()}>
                    upload a file
                  </button>
                </p>
                <div className="mt-1 flex items-center gap-1.5">
                  <ZoneButton icon={<LinkIcon size={16} />} label="Paste link" onClick={() => setMode('link')} />
                  <ZoneButton icon={<AutoAwesomeIcon size={16} />} label="Generate" onClick={() => setMode('prompt')} />
                </div>
              </div>
              <input
                value={data.altText}
                placeholder="Alt text here"
                onChange={(e) => onChange({ ...data, altText: e.target.value })}
                className="h-8 w-full rounded-lg border border-line bg-white px-2 text-xs shadow-xs outline-none placeholder:text-black/30"
              />
            </>
          )}

          {mode === 'link' &&
            inputRow(
              <>
                <input
                  value={linkValue}
                  placeholder="https://example.com/photo.jpg"
                  onChange={(e) => setLinkValue(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-xs outline-none placeholder:text-black/30"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (/^https?:\/\//i.test(linkValue)) {
                      onChange({ ...data, url: linkValue, source: 'url', failed: false })
                      setMode('default')
                    }
                  }}
                  className="h-8 rounded-lg bg-navy px-4 text-sm font-medium text-cream hover:bg-navy-deep"
                >
                  Add
                </button>
              </>,
            )}

          {mode === 'prompt' && (
            <GenerateImagePanel
              onBack={() => setMode('default')}
              onPick={(url) => {
                onChange({ ...data, url, source: 'generate', failed: false })
                setMode('default')
              }}
            />
          )}

          {mode === 'uploading' && (
            <div className="flex w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-cream-100">
                <ImageIcon size={16} className="text-neutral-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 truncate text-xs text-[#bbbbbb]">{uploadName}</p>
                <div className="h-2 w-full rounded-full bg-navy/15">
                  <div className="h-2 rounded-full bg-navy transition-all" style={{ width: `${uploadPct}%` }} />
                </div>
              </div>
              <button type="button" onClick={cancelUpload} title="Cancel upload">
                <CloseIcon size={20} className="text-neutral-500" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
