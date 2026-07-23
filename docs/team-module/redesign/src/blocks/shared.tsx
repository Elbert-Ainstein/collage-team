import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'
import type { BlockStatus, ViewMode } from '../types'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const AutoAwesomeIcon = mIcon('auto_awesome')

/** Props every block component receives from the editor. */
export interface BlockProps<D> {
  data: D
  status: BlockStatus
  viewMode: ViewMode
  selected: boolean
  onChange: (data: D) => void
  /** Simulated AI generation; pass true (Shift-click) to demo the failure path. */
  onGenerate: (fail: boolean) => void
  /** Move the caret to the text after this block (Enter at end of a single-line block). */
  onExitDown?: () => void
}

/** Primary navy button used across block CTAs ("Generate Again", "Add", …). */
export function NavyButton({
  children,
  onClick,
  fullWidth,
  disabled,
}: {
  children: ReactNode
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  fullWidth?: boolean
  disabled?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-cream shadow-xs transition-colors hover:bg-navy-deep disabled:bg-black/30 ${fullWidth ? 'w-full' : ''}`}
    >
      {children}
    </button>
  )
}

/** Cream card chrome shared by most block bodies. */
export function CreamCard({
  children,
  className = '',
  bg = 'bg-cream-300',
}: {
  children: ReactNode
  className?: string
  bg?: string
}): ReactElement {
  return <div className={`rounded-lg border border-line ${bg} shadow-2xs ${className}`}>{children}</div>
}

/** Skeleton bars shown while a block is generating (pill skeleton pattern). */
export function GeneratingSkeleton({ label, bars = 3 }: { label: string; bars?: number }): ReactElement {
  return (
    <CreamCard className="flex flex-col gap-3 px-4 py-4">
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse rounded-md bg-neutral-300/60"
          style={{ width: `${90 - i * 18}%` }}
        />
      ))}
      <p className="text-xs text-neutral-500">{label}</p>
    </CreamCard>
  )
}

/**
 * Brand "disconnected hands" error illustration (Figma asset 3406:1223) —
 * two OK-gesture hands reaching for a spark, redrawn as inline SVG.
 */
export function ErrorHands({ width = 110 }: { width?: number }): ReactElement {
  const outline = '#002341'
  const skin = '#fcf6e8'
  // an outlined capsule = wide navy stroke with a narrower cream stroke on top
  const limb = (d: string, w: number): ReactElement[] => [
    <path key={`${d}-o`} d={d} stroke={outline} strokeWidth={w} strokeLinecap="round" fill="none" />,
    <path key={`${d}-i`} d={d} stroke={skin} strokeWidth={w - 5.5} strokeLinecap="round" fill="none" />,
  ]
  return (
    <svg width={width} viewBox="0 0 226 126" fill="none" aria-hidden="true">
      {/* backdrop shapes */}
      <circle cx={24} cy={62} r={24} fill={outline} />
      <circle cx={198} cy={66} r={27} fill="#dca2fd" />
      {/* left arm + fingers + OK loop */}
      {limb('M 8 84 Q 40 84 62 68', 26)}
      {limb('M 66 58 L 50 24', 11)}
      {limb('M 76 54 L 68 18', 11)}
      {limb('M 86 52 L 86 16', 11)}
      <circle cx={90} cy={60} r={11} stroke={outline} strokeWidth={11} fill="none" />
      <circle cx={90} cy={60} r={11} stroke={skin} strokeWidth={5.5} fill="none" />
      {/* right arm + fingers + OK loop (mirrored) */}
      {limb('M 218 84 Q 186 84 164 68', 26)}
      {limb('M 160 58 L 176 24', 11)}
      {limb('M 150 54 L 158 18', 11)}
      {limb('M 140 52 L 140 16', 11)}
      <circle cx={136} cy={60} r={11} stroke={outline} strokeWidth={11} fill="none" />
      <circle cx={136} cy={60} r={11} stroke={skin} strokeWidth={5.5} fill="none" />
      {/* spark */}
      <rect x={107} y={52} width={11} height={11} rx={2.5} fill="#3b82f6" transform="rotate(8 112.5 57.5)" />
      <path d="M 104 40 L 99 31" stroke={outline} strokeWidth={3} strokeLinecap="round" />
      <path d="M 113 38 L 113 28" stroke={outline} strokeWidth={3} strokeLinecap="round" />
      <path d="M 122 40 L 127 31" stroke={outline} strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
}

/** "Something went wrong … Generate Again" failure card (Error/generate). */
export function ErrorGenerateCard({
  onRetry,
  message = "We couldn't generate your block. Please try again.",
  fill = false,
}: {
  onRetry: (fail: boolean) => void
  /** Per-block copy, e.g. "We couldn't generate your card. Please try again." */
  message?: string
  /** Stretch to the parent's fixed height (365×417.67 card frames). */
  fill?: boolean
}): ReactElement {
  return (
    <CreamCard className={`px-2 py-3 ${fill ? 'flex h-full flex-col' : ''}`}>
      <div className={`flex flex-col gap-4 px-4 py-3 ${fill ? 'flex-1 justify-center' : ''}`}>
        <ErrorHands />
        <div>
          <div className="border-b border-line pb-1.5">
            <p className="text-sm font-medium leading-5 text-black/80">Something went wrong</p>
          </div>
          <p className="mt-1.5 text-xs leading-4 text-black/80">{message}</p>
        </div>
        <div>
          <NavyButton onClick={(e) => onRetry(e.shiftKey)}>Generate Again</NavyButton>
        </div>
      </div>
    </CreamCard>
  )
}

/** Centered "404 / Something went wrong" missing-content card (Error/404). */
export function Error404Card({
  actionLabel,
  onAction,
  fill = false,
}: {
  /** Optional CTA under the panel (Card page: "Generate Again"; Image page: "Reload"). */
  actionLabel?: string
  onAction?: () => void
  /** Stretch to the parent's fixed height (365×417.67 card frames). */
  fill?: boolean
} = {}): ReactElement {
  return (
    <CreamCard bg="bg-cream-100" className={`px-2 py-3 ${fill ? 'flex h-full flex-col' : ''}`}>
      <div className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-neutral-200 bg-cream-300 py-10 shadow-2xs ${fill ? 'flex-1' : ''}`}>
        <p className="font-serif text-2xl leading-8 text-black/30">404</p>
        <p className="text-sm font-medium leading-5 text-black/30">Something went wrong</p>
      </div>
      {actionLabel && (
        <div className="mt-2">
          <NavyButton fullWidth onClick={onAction}>
            {actionLabel}
          </NavyButton>
        </div>
      )}
    </CreamCard>
  )
}

/** Whether block chrome (drag handle, selectors, inputs) should render. */
export function isEditing(viewMode: ViewMode): boolean {
  return viewMode === 'edit'
}

/** Borderless textarea that grows with its content. */
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  className = '',
  style,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  // resize on any value change, including programmatic ones (AI generation)
  useEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      className={`w-full resize-none bg-transparent outline-none placeholder:text-black/30 ${className}`}
    />
  )
}

/** Demo image-search results: label + gradient stops for placeholder tiles. */
export const SEARCH_RESULTS: ReadonlyArray<readonly [string, string, string]> = [
  ['Sunset', '#fdd7a2', '#fda2a2'],
  ['Forest', '#a2fdc5', '#a2c5fd'],
  ['Ocean', '#a2c5fd', '#d5efff'],
  ['Desert', '#efdfad', '#fdd7a2'],
  ['Mountains', '#dca2fd', '#a2c5fd'],
  ['City', '#c2e5ff', '#dca2fd'],
]

/** Pending-tile colors from the Figma search-loading grid (State/search loading). */
const PENDING_TILE_COLORS = ['#cfdce7', '#cfdce7', '#afc6d9', '#e7eef3', '#cfdce7', '#afc6d9'] as const

/**
 * AI image generation panel: type a prompt, press enter, pick one of the
 * generated results (Image and Card blocks' Generate flow).
 */
export function GenerateImagePanel({
  onPick,
  onBack,
  tileClass = 'h-20',
}: {
  onPick: (url: string) => void
  onBack: () => void
  tileClass?: string
}): ReactElement {
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const run = (): void => {
    if (!prompt.trim()) return
    setPhase('loading')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase('done'), 900)
  }
  const label = prompt.trim().slice(0, 40) || 'Generated'
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-3">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onBack} title="Back">
          <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            value={prompt}
            placeholder="Describe the image to generate"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run()
            }}
            className="h-8 w-full rounded-lg border border-line bg-white px-2 pr-8 text-xs outline-none placeholder:text-black/30"
          />
          <button type="button" title="Generate images" onClick={run} className="absolute right-2 top-1.5 text-neutral-500 hover:text-brand-purple">
            <AutoAwesomeIcon size={16} />
          </button>
        </div>
      </div>
      {phase === 'loading' && (
        <div className="grid grid-cols-3 gap-2">
          {PENDING_TILE_COLORS.map((color, i) => (
            <div key={i} className={`${tileClass} animate-pulse rounded-lg`} style={{ backgroundColor: color }} />
          ))}
        </div>
      )}
      {phase === 'done' && (
        <div className="grid grid-cols-3 gap-2">
          {SEARCH_RESULTS.map(([, from, to], i) => (
            <button
              key={i}
              type="button"
              title="Use this image"
              onClick={() => onPick(placeholderImage(label, from, to))}
              className="overflow-hidden rounded-lg border border-line transition-shadow hover:shadow-md"
            >
              <img src={placeholderImage(label, from, to)} alt={label} className={`${tileClass} w-full object-cover`} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Inline SVG placeholder used for demo/sample images (network-free). */
export function placeholderImage(label: string, from = '#dca2fd', to = '#a2c5fd'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><text x="400" y="232" font-family="Georgia, serif" font-size="30" fill="rgba(0,35,65,0.7)" text-anchor="middle">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
