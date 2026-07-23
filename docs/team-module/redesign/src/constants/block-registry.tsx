import { mIcon } from '../components/m-icon'
import type { MIconComponent } from '../components/m-icon'
import type { BlockGroup, BlockType, QuestionKind } from '../types'

const TextFieldsIcon = mIcon('text_fields')
const CreditCardIcon = mIcon('credit_card')
const FunctionsIcon = mIcon('functions')
const InfoIcon = mIcon('info')
const QuestionMarkIcon = mIcon('question_mark')
const StyleIcon = mIcon('style')
const AutoAwesomeIcon = mIcon('auto_awesome')
const AccountTreeIcon = mIcon('account_tree')
const AudioFileIcon = mIcon('audio_file')
const ImageIcon = mIcon('image')
const VideocamIcon = mIcon('videocam')
const CodeIcon = mIcon('code')
const BarChartIcon = mIcon('bar_chart')
const TableChartIcon = mIcon('table_chart')

export interface SlashMenuEntry {
  id: string
  /** Menu label, exactly as in Figma (filtering is strict prefix on this). */
  label: string
  icon: MIconComponent
  group: BlockGroup
  type: BlockType
  /** For the four question entries, which question variant to insert. */
  qKind?: QuestionKind
}

/**
 * Slash menu inventory in the exact group/item order from the
 * "Slash Dialog Box" Figma component (Special Blocks page).
 */
export const SLASH_MENU_ENTRIES: SlashMenuEntry[] = [
  { id: 'header', label: 'Header Block', icon: TextFieldsIcon, group: 'Content', type: 'header' },
  { id: 'card', label: 'Card Block', icon: CreditCardIcon, group: 'Content', type: 'card' },
  { id: 'equation', label: 'Equation Block', icon: FunctionsIcon, group: 'Content', type: 'equation' },
  { id: 'callout', label: 'Callout Block', icon: InfoIcon, group: 'Content', type: 'callout' },
  { id: 'mcq', label: 'Multiple Choice', icon: QuestionMarkIcon, group: 'Interactive', type: 'question', qKind: 'multiple-choice' },
  { id: 'open-ended', label: 'Open Ended', icon: QuestionMarkIcon, group: 'Interactive', type: 'question', qKind: 'open-ended' },
  { id: 'short-answer', label: 'Short Answer', icon: QuestionMarkIcon, group: 'Interactive', type: 'question', qKind: 'short-answer' },
  { id: 'fill-blank', label: 'Fill in the Blank', icon: QuestionMarkIcon, group: 'Interactive', type: 'question', qKind: 'fill-blank' },
  { id: 'flashcard', label: 'Flashcard Block', icon: StyleIcon, group: 'Interactive', type: 'flashcard' },
  { id: 'interactive', label: 'Interactive Block', icon: AutoAwesomeIcon, group: 'Interactive', type: 'interactive' },
  { id: 'mindmap', label: 'Mind Map Block', icon: AccountTreeIcon, group: 'Interactive', type: 'mindmap' },
  { id: 'audio', label: 'Audio Block', icon: AudioFileIcon, group: 'Media', type: 'audio' },
  { id: 'image', label: 'Image Block', icon: ImageIcon, group: 'Media', type: 'image' },
  { id: 'video', label: 'Video Block', icon: VideocamIcon, group: 'Media', type: 'video' },
  { id: 'code', label: 'Code Block', icon: CodeIcon, group: 'Data & Code', type: 'code' },
  { id: 'graph', label: 'Graph Block', icon: BarChartIcon, group: 'Data & Code', type: 'graph' },
  { id: 'table', label: 'Table Block', icon: TableChartIcon, group: 'Data & Code', type: 'table' },
]

/** Group heading labels as rendered in the menu. */
export const GROUP_LABELS: Record<BlockGroup, string> = {
  Content: 'Content Block',
  Interactive: 'Interactive Blocks',
  Media: 'Media Blocks',
  'Data & Code': 'Data and Code',
}
