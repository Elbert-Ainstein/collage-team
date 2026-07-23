/** Block types available in the inline editor. */
export const BLOCK_TYPES = [
  'header',
  'card',
  'image',
  'video',
  'audio',
  'callout',
  'code',
  'table',
  'flashcard',
  'graph',
  'equation',
  'question',
  'mindmap',
  'interactive',
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]

/** Slash-menu grouping per PRD §1.2. */
export const BLOCK_GROUPS = ['Content', 'Interactive', 'Media', 'Data & Code'] as const
export type BlockGroup = (typeof BLOCK_GROUPS)[number]

/** Shared block lifecycle states per PRD §1.4. */
export const BLOCK_STATUSES = [
  'empty',
  'idle',
  'saving',
  'save-failed',
  'generating',
  'generation-failed',
] as const
export type BlockStatus = (typeof BLOCK_STATUSES)[number]

/** Faculty edit vs student preview rendering. */
export type ViewMode = 'edit' | 'preview'

export interface TextNode {
  kind: 'text'
  id: string
  /** Sanitized rich-text HTML for the paragraph run. */
  html: string
}

export interface BlockNode {
  kind: 'block'
  id: string
  type: BlockType
  status: BlockStatus
  data: BlockData
}

export type DocNode = TextNode | BlockNode

/* ---------------------------------- per-block data ---------------------------------- */

export interface HeaderData {
  block: 'header'
  text: string
  /** Optional learning objective shown under the header. */
  learningObjective: string
}

export interface CardItem {
  id: string
  title: string
  description: string
  imageUrl: string | null
  caption: string
  imageFailed: boolean
  generating: boolean
}

export interface CardData {
  block: 'card'
  cards: CardItem[]
}

export const IMAGE_SOURCES = ['upload', 'url', 'search', 'generate'] as const
export type ImageSource = (typeof IMAGE_SOURCES)[number]

export interface ImageData {
  block: 'image'
  url: string | null
  caption: string
  altText: string
  /** Which acquisition path is in progress or failed, for distinct states. */
  source: ImageSource | null
  failed: boolean
}

export interface VideoData {
  block: 'video'
  url: string | null
  caption: string
  loadFailed: boolean
}

export const AUDIO_SPEEDS = [1, 1.5, 2] as const
export type AudioSpeed = (typeof AUDIO_SPEEDS)[number]

export interface AudioData {
  block: 'audio'
  url: string | null
  title: string
  description: string
  failed: boolean
}

export const CALLOUT_KINDS = ['info', 'tip', 'warning', 'important'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export interface CalloutData {
  block: 'callout'
  kind: CalloutKind
  text: string
}

export interface CodeData {
  block: 'code'
  language: string
  code: string
}

export interface TableData {
  block: 'table'
  /** rows[r][c]; row 0 is the header row. */
  rows: string[][]
}

export interface FlashcardSide {
  text: string
  imageUrl: string | null
  altText: string
}

export interface FlashcardItem {
  id: string
  front: FlashcardSide
  back: FlashcardSide
}

export interface FlashcardData {
  block: 'flashcard'
  cards: FlashcardItem[]
}

export const GRAPH_KINDS = ['bar', 'line', 'scatter', 'area'] as const
export type GraphKind = (typeof GRAPH_KINDS)[number]

export interface GraphPoint {
  id: string
  label: string
  /** Y value (bar height / line-point / scatter y). */
  value: number
  /** X coordinate — used by the scatter chart. */
  x: number
}

export interface GraphData {
  block: 'graph'
  kind: GraphKind
  title: string
  xLabel: string
  yLabel: string
  points: GraphPoint[]
}

export interface EquationData {
  block: 'equation'
  latex: string
  explanation: string
  invalid: boolean
}

export const QUESTION_KINDS = ['multiple-choice', 'fill-blank', 'short-answer', 'open-ended'] as const
export type QuestionKind = (typeof QUESTION_KINDS)[number]

export interface McqOption {
  id: string
  text: string
  correct: boolean
}

export interface Criterion {
  id: string
  text: string
  weight: number
  locked: boolean
}

export interface QuestionData {
  block: 'question'
  qKind: QuestionKind
  prompt: string
  points: number
  /* multiple choice */
  options: McqOption[]
  explanation: string
  /* fill in the blank / short answer */
  answer: string
  /* open ended */
  criteria: Criterion[]
}

export const MINDMAP_COLORS = ['#dca2fd', '#a2c5fd', '#a2fdc5', '#fdd7a2', '#fda2a2'] as const
export type MindmapColor = (typeof MINDMAP_COLORS)[number]

export interface MindmapNode {
  id: string
  text: string
  x: number
  y: number
  color: MindmapColor
  collapsed: boolean
}

export interface MindmapEdge {
  id: string
  from: string
  to: string
}

export interface MindmapData {
  block: 'mindmap'
  nodes: MindmapNode[]
  edges: MindmapEdge[]
}

export interface InteractiveData {
  block: 'interactive'
  title: string
}

export type BlockData =
  | HeaderData
  | CardData
  | ImageData
  | VideoData
  | AudioData
  | CalloutData
  | CodeData
  | TableData
  | FlashcardData
  | GraphData
  | EquationData
  | QuestionData
  | MindmapData
  | InteractiveData
