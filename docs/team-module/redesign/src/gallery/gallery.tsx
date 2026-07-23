import type { ComponentType, ReactElement, ReactNode } from 'react'
import type {
  BlockData,
  BlockNode,
  BlockStatus,
  BlockType,
  CalloutKind,
  EquationData,
  FlashcardData,
  GraphData,
  GraphKind,
  QuestionKind,
  TableData,
  ViewMode,
} from '../types'
import { BlockRenderer } from '../blocks/block-renderer'
import { Error404Card, ErrorGenerateCard } from '../blocks/shared'
import { mIcon } from '../components/m-icon'
import { MathKeyboardCard } from '../components/math-keyboard'
import { defaultBlockData } from '../editor/block-defaults'
import { sampleBlockData } from '../editor/sample-content'

export type GalleryMode = 'generative' | 'errors'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')
const ContentCopyIcon = mIcon('content_copy')
const SearchIcon = mIcon('search')
const SearchOffIcon = mIcon('search_off')
const LinkIcon = mIcon('link')
const LinkOffIcon = mIcon('link_off')
const ImageIcon = mIcon('image')
const HideImageIcon = mIcon('hide_image')
const VideocamOffIcon = mIcon('videocam_off')
const UploadIcon = mIcon('upload')
const ErrorIcon = mIcon('error')
const CheckIcon = mIcon('check')
const ChecklistIcon = mIcon('checklist')
const FunctionsIcon = mIcon('functions')
const CloseIcon = mIcon('close')
const AutoAwesomeIcon = mIcon('auto_awesome')
const DragIndicatorIcon = mIcon('drag_indicator')
const DeleteForeverIcon = mIcon('delete_forever')
const InfoIcon = mIcon('info')
const VolumeUpIcon = mIcon('volume_up')
const BackspaceIcon = mIcon('backspace')

const noop = (): void => {}

/* ------------------------------- primitives ------------------------------- */

let seq = 0
function node(type: BlockType, status: BlockStatus, data: BlockData): BlockNode {
  seq += 1
  return { kind: 'block', id: `gal-${seq}`, type, status, data }
}

/** One labelled specimen frame on the gallery canvas. */
function Specimen({ label, note, children }: { label: string; note?: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{label}</span>
        {note && <span className="text-xs text-neutral-400">{note}</span>}
      </div>
      <div className="rounded-lg border border-dashed border-line bg-white/40 p-3">{children}</div>
    </div>
  )
}

/** Render a block node read-only-ish (no-op handlers), with generating shimmer. */
function Block({
  n,
  viewMode = 'edit',
  shimmer = true,
}: {
  n: BlockNode
  viewMode?: ViewMode
  /** Suppress the modify shimmer for lazy-load skeletons (State/generate has none). */
  shimmer?: boolean
}): ReactElement {
  return (
    <div className="relative">
      <BlockRenderer
        node={n}
        viewMode={viewMode}
        selected={false}
        onChange={() => {}}
        onGenerate={() => {}}
        onExitDown={() => {}}
      />
      {n.status === 'generating' && shimmer && (
        <div className="shimmer-overlay pointer-events-none absolute inset-0 rounded-lg" />
      )}
    </div>
  )
}

/** A block-by-block section wrapper — specimens stack vertically like the canvas. */
function BlockSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="border-b border-line pb-1 font-serif text-xl text-black/80">{title}</h3>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  )
}

/* ------------------------------ data helpers ------------------------------ */

const filled = (t: BlockType, qKind?: QuestionKind): BlockData => sampleBlockData(t, qKind)
const empty = (t: BlockType): BlockData => defaultBlockData(t)

function callout(kind: CalloutKind): BlockData {
  return { ...(filled('callout') as BlockData & { block: 'callout' }), kind }
}
function graph(kind: GraphKind): BlockData {
  return { ...(filled('graph') as GraphData), kind }
}
function question(qKind: QuestionKind): BlockData {
  return filled('question', qKind)
}

/* --------------------------- error-screen pieces --------------------------- */
/* Display-only specimens for Figma error frames that only exist as designs
   (upload/link/search failures, 404s, keyboard failure, student wrong states). */

type MIconComponent = ComponentType<{ size?: number; className?: string }>

/** Media card shell (Figma card/image/video error frames). `narrow` = the 365×417.67 card frame. */
function MediaCard({ children, narrow = false }: { children: ReactNode; narrow?: boolean }): ReactElement {
  return (
    <div
      className={`w-full rounded-lg border border-line px-2.5 py-3 shadow-2xs ${narrow ? 'max-w-[365px]' : ''}`}
      style={{ backgroundColor: '#fffaec', ...(narrow ? { height: 417.67 } : {}) }}
    >
      <div className={`flex flex-col gap-2 ${narrow ? 'h-full' : ''}`}>{children}</div>
    </div>
  )
}

/** Inner preview panel with a centered icon + message lines. `wide` flattens it for full-canvas rows. */
function PanelMsg({ icon: Icon, lines, wide = false }: { icon: MIconComponent; lines: [string, string?]; wide?: boolean }): ReactElement {
  return (
    <div className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-cream-300 shadow-[0_1px_5px_rgba(0,0,0,0.06)] ${wide ? 'aspect-video' : 'aspect-[4/3]'}`}>
      <Icon size={26} className="text-black/30" />
      <p className="px-4 text-center text-sm font-medium text-black/30">{lines[0]}</p>
      {lines[1] && <p className="px-4 text-center text-xs text-black/25">{lines[1]}</p>}
    </div>
  )
}

/** Filename + progress bar + navy re-upload button (Image/Video file errors). */
function UploadFooter({ filename }: { filename: string }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-cream-100">
        <ImageIcon size={16} className="text-neutral-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-neutral-400">{filename}</p>
        <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-300/60" />
      </div>
      <button type="button" title="Re-upload" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-cream hover:bg-navy-deep">
        <UploadIcon size={16} />
      </button>
    </div>
  )
}

/** Back chevron + search input + "Not Found" panel (Error/ImageNotFound). */
function SearchNotFound({ query, label, wide = false }: { query: string; label: string; wide?: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-cream-300 p-2">
      <div className="flex items-center gap-1.5">
        <KeyboardArrowLeftIcon size={20} className="shrink-0 text-neutral-600" />
        <div className="relative min-w-0 flex-1">
          <input readOnly value={query} className="h-8 w-full rounded-lg border border-line bg-white px-2 pr-8 text-xs outline-none" />
          <SearchIcon size={14} className="absolute right-2 top-2 text-neutral-500" />
        </div>
      </div>
      <PanelMsg icon={SearchOffIcon} lines={[label]} wide={wide} />
    </div>
  )
}

/** Back chevron + red URL input + gray Add + "Link Broken" panel. */
function LinkBroken({ label, wide = false }: { label: string; wide?: boolean }): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-cream-300 p-2">
      <div className="flex items-center gap-1.5">
        <KeyboardArrowLeftIcon size={20} className="shrink-0 text-neutral-600" />
        <input
          readOnly
          value="https://www.vecteezy.com/image"
          className="h-8 min-w-0 flex-1 rounded-lg border border-[#dc2626] bg-[#fef2f2] px-2 text-xs text-[#b91c1c] outline-none"
        />
        <button type="button" className="h-8 shrink-0 rounded-lg bg-[#737373] px-4 text-sm font-medium text-cream">
          Add
        </button>
      </div>
      <PanelMsg icon={LinkOffIcon} lines={[label]} wide={wide} />
    </div>
  )
}

/** "Card Title / Card body text" placeholder footer (Card error frames). */
function CardTitleBody(): ReactElement {
  return (
    <div className="flex flex-col">
      <p className="border-b border-line pb-1 text-sm font-medium text-black/80">Card Title</p>
      <p className="mt-1 text-xs text-[#bbbbbb]">Card body text</p>
    </div>
  )
}

/** Full-width navy "Re Upload Image" (Card file errors). */
function ReUploadButton(): ReactElement {
  return (
    <button type="button" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-navy text-sm font-medium text-cream hover:bg-navy-deep">
      <UploadIcon size={16} /> Re Upload Image
    </button>
  )
}

/** Card with title only — "Add card body text" validation (Error/onlytitle). */
function CardMissingBody(): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-4">
        <UploadIcon size={18} className="text-neutral-500" />
        <p className="text-center text-[11px] text-neutral-600">
          Drag and drop or <span className="font-medium text-navy">upload a file (x MB)</span>
        </p>
        <div className="mt-1 flex gap-1.5">
          <span className="flex h-7 w-8 items-center justify-center rounded-lg border border-line bg-page text-neutral-600">
            <LinkIcon size={14} />
          </span>
          <span className="flex h-7 w-8 items-center justify-center rounded-lg border border-line bg-page text-neutral-600">
            <AutoAwesomeIcon size={14} />
          </span>
        </div>
      </div>
      <p className="border-b border-line pb-1 text-sm font-medium text-black/80">Aurora Borealis</p>
      <p className="flex items-center gap-1 text-xs text-[#b91c1c]">
        <ErrorIcon size={14} /> Add card body text
      </p>
    </div>
  )
}

/** Slim audio error bar: red badge + message + progress + re-upload. */
function AudioErrorRow({ message }: { message: string }): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
      <div className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-lg border-2 border-[#b91c1c] bg-[#fef2f2]">
        <ErrorIcon size={22} className="text-[#b91c1c]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-500">{message}</p>
        <div className="mt-2 h-2 w-full rounded-full bg-navy/15" />
      </div>
      <button type="button" title="Re-upload" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-cream hover:bg-navy-deep">
        <UploadIcon size={16} />
      </button>
    </div>
  )
}

/** Slim centered 404 (Audio Block/Error/404). */
function Slim404(): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-line py-4 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
      <p className="font-serif text-xl leading-7 text-black/30">404</p>
      <p className="text-xs font-medium text-black/30">Something went wrong</p>
    </div>
  )
}

/** 404 inside the code block's navy chrome (Code Block/Error/404). */
function Code404(): ReactElement {
  return (
    <div className="overflow-hidden rounded-[14px] border border-navy-deep shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
      <div className="flex items-center justify-between bg-navy-deep px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm leading-5 text-cream">
          Python <KeyboardArrowDownIcon size={20} />
        </span>
        <span className="flex items-center gap-1.5 rounded-md border border-[#898887] px-2.5 py-1 text-sm font-medium text-cream">
          <ContentCopyIcon size={14} /> Copy
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-1 bg-navy py-10">
        <p className="font-mono text-2xl font-bold text-cream/40">404</p>
        <p className="text-xs text-cream/40">Something went wrong</p>
      </div>
    </div>
  )
}

/** Equation strip with an inline error line under the expression. */
function EquationStrip({ eq, tone, text }: { eq: string; tone: 'red' | 'gray'; text: string }): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-cream-300 px-4 py-4 shadow-2xs">
      <p className="text-center font-serif text-2xl text-black/80">{eq}</p>
      <p className={`flex items-center gap-1.5 text-xs ${tone === 'red' ? 'text-[#b91c1c]' : 'text-neutral-600'}`}>
        <ErrorIcon size={14} /> {text}
      </p>
      <p className="text-xs text-black/30">Equation explanation (optional)</p>
    </div>
  )
}

/** "Please enter an equation before done" above the math keyboard. */
function EmptyEquation(): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-cream-300 px-4 py-4 shadow-2xs">
      <p className="text-sm font-medium text-[#b91c1c]">Please enter an equation before done</p>
      <div className="w-full max-w-[540px]">
        <MathKeyboardCard onKey={noop} onBackspace={noop} onDone={noop} onClose={noop} />
      </div>
      <p className="w-full text-xs text-black/30">Equation explanation (optional)</p>
    </div>
  )
}

/** Equation keyboard failed to load (node 3620:2366). */
function KeyboardFailed(): ReactElement {
  return (
    <div className="w-full max-w-[540px] rounded-lg border border-line bg-cream-100 p-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <p className="text-xs text-black/30">Type, or tap a symbol — names like &quot;pi&quot; autocomplete</p>
        <CloseIcon size={16} className="text-neutral-500" />
      </div>
      <div className="flex gap-5 border-b border-line px-1 py-2 text-sm text-black/30">
        <span>123</span>
        <span>fx</span>
        <span>αβγ</span>
        <span>&lt;=</span>
      </div>
      <div className="flex flex-col items-center gap-1.5 py-8">
        <ErrorIcon size={24} className="text-[#dc2626]" />
        <p className="text-sm font-semibold text-neutral-900">Keyboard failed to load</p>
        <p className="text-xs text-neutral-500">Check your connection and try again</p>
        <button type="button" className="mt-2 h-8 rounded-lg bg-navy px-4 text-sm font-medium text-cream hover:bg-navy-deep">
          Reload
        </button>
      </div>
    </div>
  )
}

/* --------------------- question student-error specimens -------------------- */

const Q_BADGES: Record<QuestionKind, string> = {
  'multiple-choice': 'Multiple Choice question',
  'fill-blank': 'Fill in the blanks',
  'short-answer': 'Short answer',
  'open-ended': 'Open ended',
}

/** Red "Incorrect / This is what you did wrong" feedback callout. */
function IncorrectCallout({ heading = 'Incorrect' }: { heading?: string }): ReactElement {
  return (
    <div className="rounded-lg border border-[#dc2626] bg-[#fef2f2] px-4 py-3 shadow-2xs">
      <p className="text-sm font-medium leading-5 text-[#b91c1c]">{heading}</p>
      <p className="mt-1.5 text-xs leading-4 text-neutral-950">This is what you did wrong</p>
    </div>
  )
}

/** Static question chrome + body + submit/try-again + incorrect callout. */
function QMock({
  kind,
  prompt,
  action,
  children,
}: {
  kind: QuestionKind
  prompt: string
  action: 'try-again' | 'submit'
  children?: ReactNode
}): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-cream-300 p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold leading-5 text-[#9405e6]"
          style={{ backgroundColor: 'rgba(124,58,237,0.1)' }}
        >
          <ChecklistIcon size={14} />
          {Q_BADGES[kind]}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs">
            5 pts
          </span>
          <span className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs">
            <FunctionsIcon size={14} /> Math keyboard
          </span>
        </div>
      </div>
      <p className="text-lg font-semibold leading-7 text-black/80">{prompt}</p>
      {children}
      {action === 'try-again' ? (
        <button type="button" className="h-10 w-full rounded-lg border border-line text-sm font-medium text-navy shadow-xs hover:bg-cream-300">
          Try Again
        </button>
      ) : (
        <button type="button" className="h-10 w-full rounded-lg bg-navy text-sm font-medium text-cream shadow-xs hover:bg-navy-deep">
          Submit Answer
        </button>
      )}
      <IncorrectCallout />
    </div>
  )
}

/** Multiple-choice option row; `wrong` renders the red selected state. */
function McRow({ text, wrong }: { text: string; wrong?: boolean }): ReactElement {
  return (
    <div className={`flex h-12 items-center gap-2.5 rounded-lg border px-3 ${wrong ? 'border-[#dc2626] bg-[#fef2f2]' : 'border-line bg-white'}`}>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
          wrong ? 'border-[#dc2626] bg-[#fef2f2] text-[#b91c1c]' : 'border-neutral-400 bg-white'
        }`}
      >
        {wrong && <CheckIcon size={14} />}
      </span>
      <span className={`text-sm ${wrong ? 'text-[#b91c1c]' : 'text-black/80'}`}>{text}</span>
    </div>
  )
}

/** Short answer / fill-in-the-blank input; red border when wrong. */
function AnswerField({ value, wrong }: { value: string; wrong?: boolean }): ReactElement {
  return (
    <div className={`flex h-12 items-center rounded-lg border bg-white px-3 text-sm text-muted-fg ${wrong ? 'border-[#dc2626]' : 'border-line'}`}>
      {value}
    </div>
  )
}

const MC_OPTION = 'Connects all three examples to matter & energy'
const OE_FEEDBACK =
  "While you mention some relevant scientific terms and hint at the types of processes involved (like energy transfer and state change), you don't specifically describe how each example demonstrates the concept of matter and energy…"

/* ------------------------ lazy-load (State/generate) ------------------------ */
/* Display specimens for each block page's State/generate lazy-load frame. */

/** Blinking text cursor (Figma Blinking cursor 3265:2430). */
function BlinkCursor(): ReactElement {
  return <span className="cursor-blink font-light">|</span>
}

/** Header Block/State/generate — heading streams in with a blinking cursor. */
function HeaderStreaming(): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <DragIndicatorIcon size={20} className="shrink-0 text-neutral-400" />
      <h2 className="min-w-0 flex-1 font-serif text-3xl leading-9 text-black/80">
        Matter, Energy, and Measurement in Chemistry
        <BlinkCursor />
      </h2>
      <DeleteForeverIcon size={20} className="shrink-0 text-red-500" />
    </div>
  )
}

/** Text Block/Generate View — paragraph streams in with a blinking cursor. */
function TextStreaming(): ReactElement {
  return (
    <p className="text-sm leading-5 text-black/80">
      Matter is anything that has mass and occupies space, and it exists in three primary states:
      solid, liquid, and gas. Solids have a definite shape and volume, liquids have a definite
      volume but take the shape of their container, and gases have neither definite shape nor
      volume. <BlinkCursor />
    </p>
  )
}

/** Skeleton shapes shared by Image/Card/Video State/generate: navy at 15%. */
function MediaSkeletonShapes(): ReactElement {
  return (
    <div className="flex animate-pulse flex-col gap-2">
      <div className="h-[125px] w-full rounded-lg bg-navy/15" />
      <div className="h-4 w-[250px] max-w-full rounded-full bg-navy/15" />
      <div className="h-4 w-[200px] max-w-full rounded-full bg-navy/15" />
    </div>
  )
}

/** Image Block/State/generate card (3473:2605). */
function ImageLazy(): ReactElement {
  return (
    <div className="w-full max-w-[365px] rounded-lg border border-line px-3 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
      <MediaSkeletonShapes />
    </div>
  )
}

/** Card Block/State/generate card (3465:471) — skeleton + blurred streaming text. */
function CardLazy(): ReactElement {
  return (
    <div className="w-full max-w-[365px] rounded-lg border border-line px-3 py-2 shadow-2xs" style={{ backgroundColor: '#fffaec', height: 417.67 }}>
      <div className="flex items-center justify-between text-neutral-400">
        <DragIndicatorIcon size={18} className="rotate-90" />
        <CloseIcon size={18} />
      </div>
      <div className="mt-1">
        <MediaSkeletonShapes />
      </div>
      <div className="mt-3" style={{ filter: 'blur(2.5px)' }}>
        <p className="text-sm font-medium text-black/80">Aurora Borealis</p>
        <p className="mt-1 text-xs leading-4 text-black/60">
          The aurora borealis, or northern lights, is a natural atmospheric phenomenon of glowing,
          dynamic waves of light in the night sky. It is caused by charged particles from the Sun
          colliding with gases (like oxygen and nitrogen) in Earth&apos;s upper atmosphere
        </p>
      </div>
    </div>
  )
}

/** Video Block/State/generate (3265:2947) — skeleton + "68% complete" progress. */
function VideoLazy(): ReactElement {
  return (
    <div className="w-full max-w-[365px] rounded-lg border border-[#bbbbbb] px-3 py-3 shadow-md" style={{ backgroundColor: '#fffaec' }}>
      <div className="rounded-lg border border-dashed border-line p-2">
        <MediaSkeletonShapes />
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-navy/15">
        <div className="h-full w-[52%] rounded-l-full bg-navy" />
      </div>
      <p className="mt-1 text-right text-sm text-black/30">68% complete</p>
    </div>
  )
}

/** Audio Block/Audio/Loading (3498:5741) — spinner replaces the play button. */
function AudioLoading(): ReactElement {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line px-3 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-navy border-t-transparent" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-navy">User Research Transcript.mp3</p>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-neutral-300/70">
          <div className="h-full w-[12%] bg-navy" />
        </div>
      </div>
      <span className="shrink-0 text-xs text-neutral-400">1:22/2:77</span>
      <VolumeUpIcon size={18} className="shrink-0 text-navy" />
      <span className="shrink-0 text-sm font-medium text-navy">1X</span>
    </div>
  )
}

/** Callout Block/State/Generate (3513:4545) — text streams in brand blue. */
function CalloutStreaming(): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3 shadow-2xs" style={{ backgroundColor: '#f4faff' }}>
      <div className="flex w-[152px] items-center justify-between rounded-lg border border-line px-2.5 py-1.5" style={{ backgroundColor: '#f4faff' }}>
        <span className="flex items-center gap-1.5 text-base font-medium text-muted-fg">
          <InfoIcon size={16} className="text-[#0382ed]" /> Info
        </span>
        <KeyboardArrowDownIcon size={18} className="text-neutral-500" />
      </div>
      <p className="text-base font-medium leading-6 text-[#0382ed]">
        The SI (International System of Units) is the standard system for scientific measurement.
        Key units include the meter (m) for length, kilogram (kg) for mass, and liter (L) for
        volume. Prefixes like kilo- (10³), centi- (10⁻²), and milli- (10⁻³) help express larger or
        smaller quantities.
        <BlinkCursor />
      </p>
    </div>
  )
}

/** Equation Block/State/generating (3551:4239) — two muted bars. */
function EquationLazy(): ReactElement {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-lg border border-line bg-cream-300 p-4 shadow-2xs">
      <div className="h-[18px] w-[600px] max-w-full rounded bg-[#737373]/35" />
      <div className="h-3.5 w-[180px] rounded bg-[#737373]/35" />
    </div>
  )
}

/** Equation Keyboard/loading skeleton (3620:2362) — key pills load in. */
function KeyboardLoading(): ReactElement {
  return (
    <div className="w-full max-w-[540px] rounded-lg border border-line bg-cream-100 p-3 shadow-xs">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <p className="text-xs text-black/30">Type, or tap a symbol — names like &quot;pi&quot; autocomplete</p>
        <CloseIcon size={16} className="text-neutral-500" />
      </div>
      <div className="flex gap-5 border-b border-line px-1 py-2 text-sm">
        <span className="border-b-2 border-navy-deep font-semibold text-neutral-950">123</span>
        <span className="text-muted-fg">fx</span>
        <span className="text-muted-fg">αβγ</span>
        <span className="text-muted-fg">&lt;=</span>
      </div>
      <div className="grid animate-pulse grid-cols-6 gap-2 py-3">
        {Array.from({ length: 18 }, (_, i) => (
          <div key={i} className="h-8 rounded-lg bg-[#eae6df]/60" />
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex h-8 w-20 items-center justify-center rounded-lg border border-line bg-page text-neutral-600">
          <BackspaceIcon size={16} />
        </div>
        <button type="button" className="h-8 flex-1 rounded-lg bg-navy text-sm font-medium text-cream">
          Done
        </button>
      </div>
    </div>
  )
}

/** Question-title shimmer bar (gradient baked into the fill, per the file). */
function ShimmerBar({ w }: { w: string }): ReactElement {
  return (
    <div
      className="h-[22px] rounded-md"
      style={{ width: w, background: 'linear-gradient(90deg, #e8e4dc, #f3efe7 50%, #e8e4dc)' }}
    />
  )
}

/** Flat skeleton bar (stone-200). */
function SkelBar({ w, faded }: { w: number; faded?: boolean }): ReactElement {
  return <div className="h-3 rounded bg-[#e7e5e4]" style={{ width: w, opacity: faded ? 0.6 : 1 }} />
}

/** Empty outlined input placeholder used in the question skeletons. */
function InputOutline(): ReactElement {
  return <div className="h-10 w-full rounded-lg border border-line bg-muted" />
}

/** QuestionBlock/<kind>/State/generate — per-question-type lazy skeleton. */
function QuestionLazy({ kind }: { kind: QuestionKind }): ReactElement {
  return (
    <div className="flex animate-pulse flex-col gap-4 rounded-xl border border-line bg-cream-300 p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-full bg-[#7c3aed] px-2.5 py-1 text-sm font-semibold leading-5 text-white">
          <ChecklistIcon size={14} />
          {Q_BADGES[kind]}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs">
            5 pts
          </span>
          <span className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs">
            <FunctionsIcon size={14} /> Math keyboard
          </span>
        </div>
      </div>
      <ShimmerBar w="100%" />
      {kind === 'multiple-choice' && (
        <>
          <ShimmerBar w="26%" />
          <div className="flex flex-col gap-2.5">
            {[170, 300, 200, 130].map((w) => (
              <div key={w} className="flex h-12 items-center gap-2.5 rounded-lg border border-[#e5e5e4] bg-muted px-3">
                <span className="h-4 w-4 shrink-0 rounded bg-[#e7e5e4]" />
                <SkelBar w={w} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#e7e5e4]" />
            <SkelBar w={48} />
          </div>
          <SkelBar w={64} />
          <InputOutline />
        </>
      )}
      {kind === 'open-ended' && (
        <>
          <ShimmerBar w="34%" />
          <div className="flex items-center justify-between">
            <SkelBar w={70} />
            <SkelBar w={60} />
          </div>
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-11 items-center justify-between rounded-lg border border-[#e5e5e4] bg-white px-3">
                <SkelBar w={100} />
                <span className="flex items-center gap-1.5">
                  <span className="h-4 w-4 rounded bg-[#e7e5e4]" />
                  <SkelBar w={24} />
                  <span className="text-sm text-neutral-400">%</span>
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#e7e5e4]" />
            <SkelBar w={48} />
          </div>
        </>
      )}
      {(kind === 'short-answer' || kind === 'fill-blank') && (
        <>
          <SkelBar w={kind === 'short-answer' ? 110 : 65} />
          <InputOutline />
          <SkelBar w={kind === 'short-answer' ? 380 : 225} faded />
        </>
      )}
    </div>
  )
}

const GRAPH_LAZY_LABELS: Record<GraphKind, string> = {
  bar: 'Bar Chart',
  line: 'Line Chart',
  scatter: 'Scatter Chart',
  area: 'Area Chart',
}

/** Graph Block/State/generate <kind> (3588:8811-8814) — skeleton chart marks. */
function GraphLazy({ kind }: { kind: GraphKind }): ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-line bg-cream-300 p-4 shadow-2xs">
      <div className="flex w-[152px] items-center justify-between rounded-lg border border-line bg-page px-3 py-1.5 text-sm font-medium text-muted-fg">
        {GRAPH_LAZY_LABELS[kind]} <KeyboardArrowDownIcon size={18} />
      </div>
      <div className="mx-auto h-6 w-[200px] rounded bg-[#e2e8f0]" />
      <div className="relative">
        <svg viewBox="0 0 700 210" className="w-full">
          {[0, 50, 100, 150, 200].map((y) => (
            <line key={y} x1={40} x2={700} y1={y} y2={y} stroke="#e5e5e5" strokeDasharray="4 4" />
          ))}
          {['100', '75', '50', '25', '0'].map((t, i) => (
            <text key={t} x={32} y={i * 50 + 4} textAnchor="end" fontSize={11} fill="rgba(0,0,0,0.3)">
              {t}
            </text>
          ))}
          {kind === 'bar' &&
            [60, 140, 100, 180].map((h, i) => (
              <rect key={i} x={90 + i * 155} y={200 - h} width={90} height={h} rx={4} fill="#e2e8f0" />
            ))}
          {kind === 'line' &&
            [60, 100, 140].map((y) => (
              <path
                key={y}
                d={`M 40 ${y} q 80 -25 165 0 t 165 0 t 165 0 t 165 0`}
                fill="none"
                stroke="#e2e8f0"
                strokeWidth={4}
                strokeLinecap="round"
              />
            ))}
          {kind === 'area' && <polygon points="40,200 370,50 700,200" fill="#eef1f6" />}
          {kind === 'scatter' &&
            [0, 1, 2, 3, 4].map((i) => <circle key={i} cx={90 + i * 140} cy={40 + i * 34} r={8} fill="#e2e8f0" />)}
        </svg>
        {/* white shimmer sweep designed into the graph skeletons */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3) 50%, transparent)' }}
        />
      </div>
      <p className="text-center text-[11px] text-muted-fg">X - axis title here</p>
    </div>
  )
}

/* ------------------------------- generative ------------------------------- */

const BLOCK_TITLES: Record<BlockType, string> = {
  header: 'Header', card: 'Card', callout: 'Callout', equation: 'Equation',
  question: 'Question', flashcard: 'Flashcard', interactive: 'Interactive',
  mindmap: 'Mind Map', audio: 'Audio', image: 'Image', video: 'Video',
  code: 'Code', graph: 'Graph', table: 'Table',
}

/** Empty + lazy-load (State/generate) + modify (shimmer) specimens per block. */
function GenBlock({ t, lazy, lazyNote, modify = true }: { t: BlockType; lazy?: ReactNode; lazyNote?: string; modify?: boolean }): ReactElement {
  return (
    <BlockSection title={BLOCK_TITLES[t]}>
      <Specimen label="Empty / first insert" note="awaiting AI or manual content">
        <Block n={node(t, 'empty', empty(t))} />
      </Specimen>
      {lazy && (
        <Specimen label="Lazy load" note={lazyNote}>
          {lazy}
        </Specimen>
      )}
      {modify && (
        <Specimen label="Modifying" note="State/modify — content under the pastel shimmer overlay">
          <Block n={node(t, 'generating', filled(t))} />
        </Specimen>
      )}
    </BlockSection>
  )
}

function Generative(): ReactElement {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-500">
        The generative view of each block — the empty state where AI content is requested, the
        lazy-load skeleton or streaming state while it generates (each block page&apos;s
        State/generate frame), and the modify state (pastel shimmer over existing content).
      </p>

      <BlockSection title="Text">
        <Specimen label="Lazy load" note="Text Block/Generate View — paragraph streams in with a cursor">
          <TextStreaming />
        </Specimen>
      </BlockSection>

      <GenBlock t="header" lazy={<HeaderStreaming />} lazyNote="Header Block/State/generate — heading streams in with a cursor" modify={false} />
      <GenBlock t="card" lazy={<CardLazy />} lazyNote="Card Block/State/generate card — skeleton + blurred streaming text" />
      <GenBlock t="callout" lazy={<CalloutStreaming />} lazyNote="Callout Block/State/Generate — text streams in brand blue" />
      <GenBlock
        t="equation"
        lazy={
          <div className="flex flex-col gap-6">
            <EquationLazy />
            <KeyboardLoading />
          </div>
        }
        lazyNote="Equation Block/State/generating + Equation Keyboard/loading skeleton"
      />
      <GenBlock
        t="question"
        lazy={
          <div className="flex flex-col gap-6">
            <QuestionLazy kind="multiple-choice" />
            <QuestionLazy kind="open-ended" />
            <QuestionLazy kind="short-answer" />
            <QuestionLazy kind="fill-blank" />
          </div>
        }
        lazyNote="QuestionBlock/<type>/State/generate — one skeleton per question type"
      />
      <GenBlock t="flashcard" lazyNote="no State/generate frame in the file — flashcards only have the modify shimmer" />
      <GenBlock t="interactive" />
      <GenBlock t="mindmap" lazyNote="no State/generate frame in the file" />
      <GenBlock t="audio" lazy={<AudioLoading />} lazyNote="Audio Block/Audio/Loading — spinner replaces the play button" />
      <GenBlock t="image" lazy={<ImageLazy />} lazyNote="Image Block/State/generate card — navy 15% skeleton" />
      <GenBlock t="video" lazy={<VideoLazy />} lazyNote="Video Block/State/generate — skeleton + 68% complete progress" />
      <GenBlock
        t="code"
        lazy={<Block n={node('code', 'generating', empty('code'))} shimmer={false} />}
        lazyNote="Code Block/State/generate — live block: 3 gray bars + Generating code…"
      />
      <GenBlock
        t="graph"
        lazy={
          <div className="flex flex-col gap-6">
            <GraphLazy kind="bar" />
            <GraphLazy kind="line" />
            <GraphLazy kind="area" />
            <GraphLazy kind="scatter" />
          </div>
        }
        lazyNote="Graph Block/State/generate — one skeleton per chart type"
      />
      <GenBlock
        t="table"
        lazy={<Block n={node('table', 'generating', empty('table'))} shimmer={false} />}
        lazyNote="Table Block/State/generate — live block skeleton table"
      />
    </div>
  )
}

/* --------------------------------- errors --------------------------------- */

/** Figma's 10×6 boiling-point table (Table/max rows + max columns). */
const MAX_TABLE: TableData = {
  block: 'table',
  rows: [
    ['Liquid', 'Boiling Point (in C)', 'Classification', 'Reason', 'Classification', 'Classification'],
    ['Water', '100', 'High', 'Strong hydrogen bonds', 'High', 'High'],
    ['Ethanol', '78', 'Low', 'Weaker hydrogen bonds', 'Low', 'Low'],
    ['Acetone', '56', 'Low', 'Dipole-dipole forces only', 'Low', 'Low'],
    ['Mercury', '357', 'High', 'Metallic bonding', 'High', 'High'],
    ['Benzene', '80', 'Low', 'Dispersion forces only', 'Low', 'Low'],
    ['Glycerol', '290', 'High', 'Three hydroxyl groups', 'High', 'High'],
    ['Methanol', '65', 'Low', 'Single hydroxyl group', 'Low', 'Low'],
    ['Chloroform', '61', 'Low', 'Weak dipole forces', 'Low', 'Low'],
    ['Toluene', '111', 'Low', 'Dispersion forces only', 'Low', 'Low'],
  ],
}

const FLASH_EXCEEDED_TEXT =
  'Matter exists in three primary states: solid, liquid, and gas. Each state has unique molecular properties that define its physical characteristics and behavior under varying conditions of temperature and pressure. Plasma is considered the fourth state. '

function Errors(): ReactElement {
  // '\frac{=1' genuinely fails KaTeX, so the live block shows its raw-syntax fallback
  const eqRenderFailed: EquationData = { block: 'equation', latex: '\\frac{=1', explanation: '', invalid: true }

  const graphItemMissing: GraphData = (() => {
    const g = filled('graph') as GraphData
    return { ...g, kind: 'bar', points: g.points.map((p, i) => (i === 0 ? { ...p, label: '' } : p)) }
  })()
  const graphValueMissing: GraphData = (() => {
    const g = filled('graph') as GraphData
    return { ...g, kind: 'scatter', points: g.points.map((p, i) => (i === 1 ? { ...p, value: NaN } : p)) }
  })()

  const flashNoQuestion: FlashcardData = {
    block: 'flashcard',
    cards: [{ id: 'gal-fc-1', front: { text: '', imageUrl: null, altText: '' }, back: { text: 'The answer side has content.', imageUrl: null, altText: '' } }],
  }
  const flashNoAnswer: FlashcardData = (() => {
    const f = filled('flashcard') as FlashcardData
    return { ...f, cards: [{ ...f.cards[0], back: { text: '', imageUrl: null, altText: '' } }] }
  })()
  const flashCharExceeded: FlashcardData = (() => {
    const f = filled('flashcard') as FlashcardData
    const text = FLASH_EXCEEDED_TEXT.repeat(3).slice(0, 500)
    return { ...f, cards: [{ ...f.cards[0], front: { ...f.cards[0].front, text } }] }
  })()

  return (
    <div className="flex flex-col gap-10">
      <p className="text-sm text-neutral-500">
        Every error design from the block pages, block by block — generation failures, 404s,
        upload/link/search failures, validation, and student wrong-answer states — followed by the
        edge cases.
      </p>

      {/* ================= ERRORS ================= */}
      <div className="flex flex-col gap-8">
        <h2 className="font-serif text-2xl text-black/80">Errors</h2>

        <BlockSection title="Header">
          <Specimen label="Generation failed" note="shared failure card — the file has no header-specific error frames">
            <ErrorGenerateCard onRetry={noop} />
          </Specimen>
        </BlockSection>

        <BlockSection title="Card">
          <Specimen label="Generation failed" note="Card Block/Error/Generate error">
            <div className="max-w-[365px]" style={{ height: 417.67 }}>
              <ErrorGenerateCard onRetry={noop} message="We couldn't generate your card. Please try again." fill />
            </div>
          </Specimen>
          <Specimen label="404" note="Card Block/Error/404">
            <div className="max-w-[365px]" style={{ height: 417.67 }}>
              <Error404Card actionLabel="Generate Again" onAction={noop} fill />
            </div>
          </Specimen>
          <Specimen label="Image not found" note="Card Block/Error/ImageNotFound">
            <MediaCard narrow>
              <SearchNotFound query="dfsghjashsd" label="Image Not Found" />
              <CardTitleBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Image link broken" note="Card Block/Error/ImageLinkBroken">
            <MediaCard narrow>
              <LinkBroken label="Image Link Broken" />
              <CardTitleBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Image file broken" note="Card Block/Error/ImageFileBroken">
            <MediaCard narrow>
              <PanelMsg icon={ImageIcon} lines={['Image Broken']} />
              <ReUploadButton />
              <CardTitleBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Image exceeds size limit" note="Card Block/Error/ImageFileExceed">
            <MediaCard narrow>
              <PanelMsg icon={HideImageIcon} lines={['Image exceeds size limit', 'Max size is XMB']} />
              <ReUploadButton />
              <CardTitleBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Unsupported file type" note="Card Block/Error/ImageFileUnsupported">
            <MediaCard narrow>
              <PanelMsg icon={HideImageIcon} lines={['Unsupported file type', 'Please upload a .jpg, .jpeg, .png, or .svg']} />
              <ReUploadButton />
              <CardTitleBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Missing card body (validation)" note="Card Block/Error/onlytitle">
            <MediaCard narrow>
              <CardMissingBody />
            </MediaCard>
          </Specimen>
          <Specimen label="Student view — image broken" note="Card Block/Student/imageerror (no re-upload for students)">
            <MediaCard narrow>
              <PanelMsg icon={ImageIcon} lines={['Image Broken']} />
              <div className="flex flex-col">
                <p className="border-b border-line pb-1 text-sm font-medium text-black/80">Aurora Borealis</p>
                <p className="mt-1 text-xs leading-4 text-black/80">
                  The aurora borealis, or northern lights, is a natural atmospheric phenomenon of glowing,
                  dynamic waves of light in the night sky. It is caused by charged particles from the Sun
                  colliding with gases (like oxygen and nitrogen) in Earth&apos;s upper atmosphere
                </p>
              </div>
            </MediaCard>
          </Specimen>
        </BlockSection>

        <BlockSection title="Image">
          <Specimen label="Generation failed" note="Image Block/Error/generate">
            <Block n={node('image', 'generation-failed', filled('image'))} />
          </Specimen>
          <Specimen label="404" note="Image Block/Error/404">
            <Error404Card actionLabel="Reload" onAction={noop} />
          </Specimen>
          <Specimen label="Image not found" note="Image Block/Error/ImageNotFound">
            <MediaCard>
              <SearchNotFound query="Puppies" label="Image Not Found" wide />
            </MediaCard>
          </Specimen>
          <Specimen label="Image link broken" note="Image Block/Error/ImageLinkBroken">
            <MediaCard>
              <LinkBroken label="Image Link Broken" wide />
            </MediaCard>
          </Specimen>
          <Specimen label="Image file broken" note="Image Block/Error/ImageFileBroken">
            <MediaCard>
              <PanelMsg icon={ImageIcon} lines={['Image Broken']} wide />
              <UploadFooter filename="Image.png" />
            </MediaCard>
          </Specimen>
          <Specimen label="Image exceeds size limit" note="Image Block/Error/ImageFileExceed">
            <MediaCard>
              <PanelMsg icon={HideImageIcon} lines={['Image exceeds size limit', 'Max size is XMB']} wide />
              <UploadFooter filename="Image.png" />
            </MediaCard>
          </Specimen>
          <Specimen label="Unsupported file type" note="Image Block/Error/ImageFileUnsupported">
            <MediaCard>
              <PanelMsg icon={HideImageIcon} lines={['Unsupported file type', 'Please upload a .jpg, .jpeg, .png, or .svg']} wide />
              <UploadFooter filename="Image.png" />
            </MediaCard>
          </Specimen>
        </BlockSection>

        <BlockSection title="Video">
          <Specimen label="Generation failed" note="Video Block/Error/generate">
            <Block n={node('video', 'generation-failed', filled('video'))} />
          </Specimen>
          <Specimen label="404" note="Video Block/Error/404">
            <Error404Card />
          </Specimen>
          <Specimen label="Video link broken" note="Video Block/Error/ImageLinkBroken">
            <MediaCard>
              <LinkBroken label="Video Link Broken" wide />
            </MediaCard>
          </Specimen>
          <Specimen label="Video file broken" note="Video Block/Error/VideoFileBroken">
            <MediaCard>
              <PanelMsg icon={VideocamOffIcon} lines={['Video File Broken']} wide />
              <UploadFooter filename="Video.mp4" />
            </MediaCard>
          </Specimen>
          <Specimen label="Video exceeds size limit" note="Video Block/Error/VideoFileExceed">
            <MediaCard>
              <PanelMsg icon={VideocamOffIcon} lines={['Video exceeds size limit', 'Max size is XMB']} wide />
              <UploadFooter filename="Video.mp4" />
            </MediaCard>
          </Specimen>
          <Specimen label="Unsupported file type" note="Video Block/Error/VideoFileUnsupported">
            <MediaCard>
              <PanelMsg icon={VideocamOffIcon} lines={['Unsupported file type', 'Please upload a .mov or .mp4']} wide />
              <UploadFooter filename="Video.mp4" />
            </MediaCard>
          </Specimen>
        </BlockSection>

        <BlockSection title="Audio">
          <Specimen label="File not supported" note="Audio Block/Error/unsupported">
            <AudioErrorRow message="Audio File not supported" />
          </Specimen>
          <Specimen label="File size exceeded" note="Audio Block/Error/exceed">
            <AudioErrorRow message="Audio File size exceeded (mp3 files only, up to 10 MB)" />
          </Specimen>
          <Specimen label="404" note="Audio Block/Error/404">
            <Slim404 />
          </Specimen>
        </BlockSection>

        <BlockSection title="Callout">
          <Specimen label="Generation failed" note="Callout Block/Error/generate">
            <Block n={node('callout', 'generation-failed', filled('callout'))} />
          </Specimen>
          <Specimen label="404" note="Callout Block/Error/404">
            <Error404Card />
          </Specimen>
        </BlockSection>

        <BlockSection title="Code">
          <Specimen label="Generation failed" note="Code Block/Error/generate — navy code chrome">
            <Block n={node('code', 'generation-failed', filled('code'))} />
          </Specimen>
          <Specimen label="404" note="Code Block/Error/404">
            <Code404 />
          </Specimen>
        </BlockSection>

        <BlockSection title="Equation">
          <Specimen label="Generation failed" note="Equation Block/Error/generate">
            <Block n={node('equation', 'generation-failed', filled('equation'))} />
          </Specimen>
          <Specimen label="404" note="Equation Block/Error/404">
            <Error404Card />
          </Specimen>
          <Specimen label="Incomplete equation" note="Equation Block/Error/invalid equation">
            <EquationStrip eq="PV = nRT +" tone="red" text="Incomplete equation, please complete the expression" />
          </Specimen>
          <Specimen label="Render failed — raw syntax" note="Equation Block/Error/render failed (live block)">
            <Block n={node('equation', 'idle', eqRenderFailed)} />
          </Specimen>
          <Specimen label="Empty equation" note="Equation Block/Error/empty equation">
            <EmptyEquation />
          </Specimen>
          <Specimen label="Keyboard failed to load" note="Equation Keyboard/load failed">
            <KeyboardFailed />
          </Specimen>
        </BlockSection>

        <BlockSection title="Table">
          <Specimen label="Generation failed" note="Table Block/Error/generate">
            <Block n={node('table', 'generation-failed', filled('table'))} />
          </Specimen>
          <Specimen label="404" note="Table Block/Error/404">
            <Error404Card />
          </Specimen>
        </BlockSection>

        <BlockSection title="Graph">
          <Specimen label="Generation failed" note="Graph Block/Error/generate">
            <Block n={node('graph', 'generation-failed', filled('graph'))} />
          </Specimen>
          <Specimen label="404" note="Graph Block/Error/404">
            <Error404Card />
          </Specimen>
          <Specimen label="Item title missing (validation)" note="Graph Block/Error/item missing — live block">
            <Block n={node('graph', 'idle', graphItemMissing)} />
          </Specimen>
          <Specimen label="Missing Y coordinate (validation)" note="Graph Block/Error/value missing — live block, point sits hollow-red on the axis">
            <Block n={node('graph', 'idle', graphValueMissing)} />
          </Specimen>
        </BlockSection>

        <BlockSection title="Flashcard">
          <Specimen label="Generation failed" note="FlashCard generate error">
            <Block n={node('flashcard', 'generation-failed', filled('flashcard'))} />
          </Specimen>
          <Specimen label="404" note="FlashCard/Error/404">
            <Error404Card />
          </Specimen>
          <Specimen label="Card has no question" note="FlashCard/Error/no question — amber banner (live block)">
            <Block n={node('flashcard', 'idle', flashNoQuestion)} />
          </Specimen>
          <Specimen label="Card has no answer" note="FlashCard/Error/no answer — tap the card to flip to the empty answer side">
            <Block n={node('flashcard', 'idle', flashNoAnswer)} />
          </Specimen>
          <Specimen label="Character limit exceeded" note="FlashCard/Error/char exceeded — counter turns red at 500 / 500">
            <Block n={node('flashcard', 'idle', flashCharExceeded)} />
          </Specimen>
        </BlockSection>

        <BlockSection title="Question">
          <Specimen label="Generation failed" note="Question Block/Error/generate">
            <Block n={node('question', 'generation-failed', question('multiple-choice'))} />
          </Specimen>
          <Specimen label="404" note="Question Block/Error/404">
            <Error404Card />
          </Specimen>
          <Specimen label="Multiple choice — answer selected wrong" note="Student selects incorrect options">
            <QMock kind="multiple-choice" prompt="How do the three examples relate to matter and energy?" action="try-again">
              <p className="text-sm font-semibold leading-5 text-black/60">Select all that apply</p>
              <div className="flex flex-col gap-2.5">
                <McRow text={MC_OPTION} />
                <McRow text={MC_OPTION} wrong />
                <McRow text={MC_OPTION} wrong />
                <McRow text={MC_OPTION} />
              </div>
            </QMock>
          </Specimen>
          <Specimen label="Multiple choice — try again" note="Options reset; feedback persists">
            <QMock kind="multiple-choice" prompt="How do the three examples relate to matter and energy?" action="submit">
              <p className="text-sm font-semibold leading-5 text-black/60">Select all that apply</p>
              <div className="flex flex-col gap-2.5">
                <McRow text={MC_OPTION} />
                <McRow text={MC_OPTION} />
                <McRow text={MC_OPTION} />
                <McRow text={MC_OPTION} />
              </div>
            </QMock>
          </Specimen>
          <Specimen label="Open ended — incorrect" note="Answer field turns red with AI feedback">
            <QMock kind="open-ended" prompt="Who came first, the chicken or the egg?" action="try-again">
              <div className="rounded-lg border border-[#dc2626] bg-white p-3 text-sm leading-5 text-neutral-800">
                {OE_FEEDBACK}
              </div>
            </QMock>
          </Specimen>
          <Specimen label="Open ended — try again" note="Field resets to neutral; feedback persists">
            <QMock kind="open-ended" prompt="Who came first, the chicken or the egg?" action="submit">
              <div className="rounded-lg border border-line bg-white p-3 text-sm leading-5 text-neutral-800">{OE_FEEDBACK}</div>
            </QMock>
          </Specimen>
          <Specimen label="Short answer — incorrect">
            <QMock kind="short-answer" prompt="Who came first, the chicken or the egg?" action="try-again">
              <AnswerField value="House" wrong />
            </QMock>
          </Specimen>
          <Specimen label="Short answer — try again">
            <QMock kind="short-answer" prompt="Who came first, the chicken or the egg?" action="submit">
              <AnswerField value="Chicken" />
            </QMock>
          </Specimen>
          <Specimen label="Fill in the blank — incorrect">
            <QMock kind="fill-blank" prompt="Spencer is the Chief ____ Officer for Collage AI." action="try-again">
              <AnswerField value="Happiness" wrong />
            </QMock>
          </Specimen>
          <Specimen label="Fill in the blank — try again">
            <QMock kind="fill-blank" prompt="Spencer is the Chief ____ Officer for Collage AI." action="submit">
              <AnswerField value="Happiness" />
            </QMock>
          </Specimen>
          <Specimen label="Wrong answer feedback" note="standalone feedback component (3257:409)">
            <IncorrectCallout heading="Feedback" />
          </Specimen>
        </BlockSection>

        <BlockSection title="Mind Map">
          <Specimen label="Generation failed" note="Mindmap/Error/generate">
            <Block n={node('mindmap', 'generation-failed', filled('mindmap'))} />
          </Specimen>
          <Specimen label="404" note="Mindmap/Error/404">
            <Error404Card />
          </Specimen>
        </BlockSection>

        <BlockSection title="Interactive">
          <Specimen label="Generation failed" note="shared failure card — the file has no interactive-specific error frames">
            <Block n={node('interactive', 'generation-failed', filled('interactive'))} />
          </Specimen>
        </BlockSection>
      </div>

      {/* ================= EDGE CASES ================= */}
      <div className="flex flex-col gap-8">
        <h2 className="font-serif text-2xl text-black/80">Edge cases</h2>

        <BlockSection title="Text">
          <Specimen label="Empty document placeholder">
            <p className="text-base leading-7 text-neutral-400">Type / to insert a block or start writing</p>
          </Specimen>
        </BlockSection>

        <BlockSection title="Callout — all types">
          <Specimen label="Info"><Block n={node('callout', 'idle', callout('info'))} viewMode="preview" /></Specimen>
          <Specimen label="Tip"><Block n={node('callout', 'idle', callout('tip'))} viewMode="preview" /></Specimen>
          <Specimen label="Warning"><Block n={node('callout', 'idle', callout('warning'))} viewMode="preview" /></Specimen>
          <Specimen label="Important"><Block n={node('callout', 'idle', callout('important'))} viewMode="preview" /></Specimen>
        </BlockSection>

        <BlockSection title="Graph — chart types">
          <Specimen label="Bar"><Block n={node('graph', 'idle', graph('bar'))} viewMode="preview" /></Specimen>
          <Specimen label="Line"><Block n={node('graph', 'idle', graph('line'))} viewMode="preview" /></Specimen>
          <Specimen label="Scatter (x,y)"><Block n={node('graph', 'idle', graph('scatter'))} viewMode="preview" /></Specimen>
          <Specimen label="Area"><Block n={node('graph', 'idle', graph('area'))} viewMode="preview" /></Specimen>
        </BlockSection>

        <BlockSection title="Question — all types">
          <Specimen label="Multiple choice"><Block n={node('question', 'idle', question('multiple-choice'))} /></Specimen>
          <Specimen label="Fill in the blank"><Block n={node('question', 'idle', question('fill-blank'))} /></Specimen>
          <Specimen label="Short answer"><Block n={node('question', 'idle', question('short-answer'))} /></Specimen>
          <Specimen label="Open ended (weighted criteria)"><Block n={node('question', 'idle', question('open-ended'))} /></Specimen>
        </BlockSection>

        <BlockSection title="Table">
          <Specimen label="Max rows and columns (10 × 6)" note="Table Block/Table/max rows + max columns">
            <Block n={node('table', 'idle', MAX_TABLE)} />
          </Specimen>
          <Specimen label="Student read-only (wraps long text)">
            <Block n={node('table', 'idle', filled('table'))} viewMode="preview" />
          </Specimen>
        </BlockSection>

        <BlockSection title="Cards">
          <Specimen label="Multiple cards in a row"><Block n={node('card', 'idle', filled('card'))} viewMode="preview" /></Specimen>
        </BlockSection>

        <BlockSection title="Flashcard">
          <Specimen label="Approaching character limit" note="FlashCard/State/Back/char limit — counter stays gray under 500">
            <Block n={node('flashcard', 'idle', (() => {
              const f = filled('flashcard') as FlashcardData
              const text =
                'Matter is anything that has mass and takes up space, made up of atoms and molecules. The three states are solid, liquid, and gas. In solids, molecules are tightly packed. In liquids, they flow freely. In gases, molecules spread apart and move rapidly. Temperature and pressure determine which state matter takes.'
              return { ...f, cards: [{ ...f.cards[0], front: { ...f.cards[0].front, text } }] }
            })())} />
          </Specimen>
        </BlockSection>

        <BlockSection title="Media — loaded states">
          <Specimen label="Image with caption"><Block n={node('image', 'idle', filled('image'))} viewMode="preview" /></Specimen>
          <Specimen label="Audio player"><Block n={node('audio', 'idle', filled('audio'))} viewMode="preview" /></Specimen>
        </BlockSection>

        <BlockSection title="Mind Map">
          <Specimen label="Multiple connected nodes"><Block n={node('mindmap', 'idle', filled('mindmap'))} viewMode="preview" /></Specimen>
        </BlockSection>
      </div>
    </div>
  )
}

/* --------------------------------- entry ---------------------------------- */

export function GalleryView({ mode }: { mode: GalleryMode }): ReactElement {
  return (
    <div className="mx-auto max-w-[1004px] px-5 py-6">
      <h1 className="mb-6 font-serif text-3xl text-black/80">
        {mode === 'generative' ? 'Generative designs' : 'Errors & edge cases'}
      </h1>
      {mode === 'generative' ? <Generative /> : <Errors />}
    </div>
  )
}
