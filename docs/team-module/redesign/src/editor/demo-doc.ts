import type { BlockType, DocNode, QuestionKind } from '../types'
import { sampleBlockData } from './sample-content'
import { uid } from './uid'

interface DemoStep {
  type: BlockType
  intro: string
  qKind?: QuestionKind
}

const DEMO_SEQUENCE: DemoStep[] = [
  { type: 'header', intro: '' },
  { type: 'card', intro: 'Matter exists in three common states, each with a distinct particle arrangement:' },
  { type: 'callout', intro: 'Energy is what drives matter between these states.' },
  { type: 'image', intro: 'Water is the classic example — all three phases occur at everyday temperatures.' },
  { type: 'video', intro: 'Watch how particles behave during each phase change:' },
  { type: 'audio', intro: 'Prefer listening? Here is the lecture recap:' },
  { type: 'equation', intro: 'The energy needed to melt a solid is given by the latent-heat equation:' },
  { type: 'table', intro: 'Melting and boiling points vary widely between substances:' },
  { type: 'graph', intro: 'Compare the boiling points visually:' },
  { type: 'code', intro: 'We can model the phase of water with a simple function:' },
  { type: 'mindmap', intro: 'Here is how the concepts connect:' },
  { type: 'flashcard', intro: 'Review the key terms with flashcards:' },
  { type: 'interactive', intro: 'Explore particle motion yourself:' },
  { type: 'question', intro: 'Check your understanding — multiple choice:', qKind: 'multiple-choice' },
  { type: 'question', intro: 'Fill in the blank:', qKind: 'fill-blank' },
  { type: 'question', intro: 'Short answer:', qKind: 'short-answer' },
  { type: 'question', intro: 'Open ended — graded against criteria:', qKind: 'open-ended' },
]

/** Pre-filled "States of Matter" document showing every block type inline. */
export function buildDemoDoc(): DocNode[] {
  const nodes: DocNode[] = []
  for (const { type, intro, qKind } of DEMO_SEQUENCE) {
    if (intro) nodes.push({ kind: 'text', id: uid('tx'), html: intro })
    nodes.push({ kind: 'block', id: uid('bk'), type, status: 'idle', data: sampleBlockData(type, qKind) })
  }
  nodes.push({
    kind: 'text',
    id: uid('tx'),
    html: 'That wraps up the tour — type <b>/</b> anywhere to add your own blocks.',
  })
  return nodes
}
