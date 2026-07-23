import type { BlockData, BlockType } from '../types'
import { uid } from './uid'

/** Fresh empty data for a just-inserted block of the given type. */
export function defaultBlockData(type: BlockType): BlockData {
  switch (type) {
    case 'header':
      return { block: 'header', text: '', learningObjective: '' }
    case 'card':
      return {
        block: 'card',
        cards: [
          {
            id: uid('cd'),
            title: '',
            description: '',
            imageUrl: null,
            caption: '',
            imageFailed: false,
            generating: false,
          },
        ],
      }
    case 'image':
      return { block: 'image', url: null, caption: '', altText: '', source: null, failed: false }
    case 'video':
      return { block: 'video', url: null, caption: '', loadFailed: false }
    case 'audio':
      return { block: 'audio', url: null, title: '', description: '', failed: false }
    case 'callout':
      return { block: 'callout', kind: 'info', text: '' }
    case 'code':
      return { block: 'code', language: 'python', code: '' }
    case 'table':
      return {
        block: 'table',
        rows: [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
      }
    case 'flashcard':
      return {
        block: 'flashcard',
        cards: [
          {
            id: uid('fc'),
            front: { text: '', imageUrl: null, altText: '' },
            back: { text: '', imageUrl: null, altText: '' },
          },
        ],
      }
    case 'graph':
      return {
        block: 'graph',
        kind: 'bar',
        title: '',
        xLabel: '',
        yLabel: '',
        points: [
          { id: uid('pt'), label: 'A', value: 4, x: 20 },
          { id: uid('pt'), label: 'B', value: 7, x: 50 },
          { id: uid('pt'), label: 'C', value: 3, x: 80 },
        ],
      }
    case 'equation':
      return { block: 'equation', latex: '', explanation: '', invalid: false }
    case 'question':
      return {
        block: 'question',
        qKind: 'multiple-choice',
        prompt: '',
        points: 1,
        options: [
          { id: uid('op'), text: '', correct: true },
          { id: uid('op'), text: '', correct: false },
        ],
        explanation: '',
        answer: '',
        criteria: [],
      }
    case 'mindmap':
      return {
        block: 'mindmap',
        nodes: [{ id: uid('mn'), text: 'Central idea', x: 400, y: 160, color: '#dca2fd', collapsed: false }],
        edges: [],
      }
    case 'interactive':
      return { block: 'interactive', title: '' }
  }
}
