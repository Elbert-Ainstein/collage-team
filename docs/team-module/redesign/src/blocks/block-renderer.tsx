import type { ReactElement } from 'react'
import type {
  AudioData,
  BlockData,
  BlockNode,
  CalloutData,
  CardData,
  CodeData,
  EquationData,
  FlashcardData,
  GraphData,
  HeaderData,
  ImageData,
  InteractiveData,
  MindmapData,
  QuestionData,
  TableData,
  VideoData,
  ViewMode,
} from '../types'
import { AudioBlock } from './audio-block'
import { CalloutBlock } from './callout-block'
import { CardBlock } from './card-block'
import { CodeBlock } from './code-block'
import { EquationBlock } from './equation-block'
import { FlashcardBlock } from './flashcard-block'
import { GraphBlock } from './graph-block'
import { HeaderBlock } from './header-block'
import { ImageBlock } from './image-block'
import { InteractiveBlock } from './interactive-block'
import { MindmapBlock } from './mindmap-block'
import { QuestionBlock } from './question-block'
import { TableBlock } from './table-block'
import { VideoBlock } from './video-block'

interface BlockRendererProps {
  node: BlockNode
  viewMode: ViewMode
  selected: boolean
  onChange: (data: BlockData) => void
  onGenerate: (fail: boolean) => void
  onExitDown: () => void
}

/** Dispatches a block node to its type's component. */
export function BlockRenderer({ node, viewMode, selected, onChange, onGenerate, onExitDown }: BlockRendererProps): ReactElement {
  const common = { status: node.status, viewMode, selected, onGenerate, onExitDown }
  switch (node.type) {
    case 'header':
      return <HeaderBlock {...common} data={node.data as HeaderData} onChange={onChange} />
    case 'card':
      return <CardBlock {...common} data={node.data as CardData} onChange={onChange} />
    case 'image':
      return <ImageBlock {...common} data={node.data as ImageData} onChange={onChange} />
    case 'video':
      return <VideoBlock {...common} data={node.data as VideoData} onChange={onChange} />
    case 'audio':
      return <AudioBlock {...common} data={node.data as AudioData} onChange={onChange} />
    case 'callout':
      return <CalloutBlock {...common} data={node.data as CalloutData} onChange={onChange} />
    case 'code':
      return <CodeBlock {...common} data={node.data as CodeData} onChange={onChange} />
    case 'table':
      return <TableBlock {...common} data={node.data as TableData} onChange={onChange} />
    case 'flashcard':
      return <FlashcardBlock {...common} data={node.data as FlashcardData} onChange={onChange} />
    case 'graph':
      return <GraphBlock {...common} data={node.data as GraphData} onChange={onChange} />
    case 'equation':
      return <EquationBlock {...common} data={node.data as EquationData} onChange={onChange} />
    case 'question':
      return <QuestionBlock {...common} data={node.data as QuestionData} onChange={onChange} />
    case 'mindmap':
      return <MindmapBlock {...common} data={node.data as MindmapData} onChange={onChange} />
    case 'interactive':
      return <InteractiveBlock {...common} data={node.data as InteractiveData} onChange={onChange} />
  }
}
