import { useCallback, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'

const FormatAlignCenterIcon = mIcon('format_align_center')
const FormatAlignLeftIcon = mIcon('format_align_left')
const FormatAlignRightIcon = mIcon('format_align_right')
const DoNotDisturbIcon = mIcon('do_not_disturb')
const FormatBoldIcon = mIcon('format_bold')
const CodeIcon = mIcon('code')
const BorderColorIcon = mIcon('border_color')
const FormatItalicIcon = mIcon('format_italic')
const LinkIcon = mIcon('link')
const FormatListBulletedIcon = mIcon('format_list_bulleted')
const FormatListNumberedIcon = mIcon('format_list_numbered')
const StrikethroughIcon = mIcon('strikethrough_s')
const FormatQuoteIcon = mIcon('format_quote')
const FormatUnderlinedIcon = mIcon('format_underlined')

const HIGHLIGHT_COLORS = ['#ffe770', '#d5efff', '#adddc0', '#f6cee7'] as const

type ExclusiveHeading = 'h1' | 'h2' | 'h3' | null

interface ToolbarState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  align: 'left' | 'center' | 'right'
  heading: ExclusiveHeading
  bulletList: boolean
  numberList: boolean
  blockquote: boolean
  code: boolean
}

function closestTag(tags: string[]): string | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  let node: Node | null = sel.getRangeAt(0).startContainer
  while (node) {
    if (node instanceof Element && tags.includes(node.tagName)) return node.tagName
    if (node instanceof Element && node.hasAttribute('contenteditable')) break
    node = node.parentNode
  }
  return null
}

function readToolbarState(): ToolbarState {
  const headingTag = closestTag(['H1', 'H2', 'H3'])
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strike: document.queryCommandState('strikeThrough'),
    align: document.queryCommandState('justifyCenter')
      ? 'center'
      : document.queryCommandState('justifyRight')
        ? 'right'
        : 'left',
    heading: (headingTag?.toLowerCase() as ExclusiveHeading) ?? null,
    bulletList: document.queryCommandState('insertUnorderedList'),
    numberList: document.queryCommandState('insertOrderedList'),
    blockquote: closestTag(['BLOCKQUOTE']) !== null,
    code: closestTag(['CODE']) !== null,
  }
}

function Cell({
  active,
  onClick,
  title,
  children,
  first,
  last,
}: {
  active?: boolean
  onClick: () => void
  title: string
  children: ReactNode
  first?: boolean
  last?: boolean
}): ReactElement {
  return (
    <button
      type="button"
      title={title}
      className={`flex h-9 w-[34px] items-center justify-center border border-r-0 border-line px-2 ${last ? 'rounded-r-lg border-r' : ''} ${first ? 'rounded-l-lg' : ''} ${active ? 'bg-cream-400' : 'hover:bg-cream-300'}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

interface FormatToolbarProps {
  /** Viewport rect of the current selection the toolbar floats above. */
  anchor: { x: number; y: number }
  /** Called after a command runs so the host can persist the edited HTML. */
  onApplied: () => void
}

/** Floating text-format toolbar ("Format strip", Figma node 3305:4794). */
export function FormatToolbar({ anchor, onApplied }: FormatToolbarProps): ReactElement {
  const [state, setState] = useState<ToolbarState>(readToolbarState)
  const [showHighlighter, setShowHighlighter] = useState(false)

  useEffect(() => {
    const refresh = (): void => setState(readToolbarState())
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
  }, [])

  const run = useCallback(
    (command: string, value?: string) => {
      document.execCommand(command, false, value)
      setState(readToolbarState())
      onApplied()
    },
    [onApplied],
  )

  const setHeading = useCallback(
    (level: ExclusiveHeading) => {
      // exclusive group: clicking the active heading reverts to paragraph
      run('formatBlock', state.heading === level ? '<div>' : `<${level}>`)
    },
    [run, state.heading],
  )

  const toggleQuote = useCallback(() => {
    run('formatBlock', state.blockquote ? '<div>' : '<blockquote>')
  }, [run, state.blockquote])

  const insertLink = useCallback(() => {
    const url = window.prompt('Link URL')
    if (url && /^https?:\/\//i.test(url)) run('createLink', url)
  }, [run])

  const toggleInlineCode = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    if (state.code) {
      run('removeFormat')
    } else {
      const text = sel.toString()
      run('insertHTML', `<code>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`)
    }
  }, [run, state.code])

  const width = 544
  const left = Math.max(8, Math.min(anchor.x - width / 2, window.innerWidth - width - 8))

  return (
    <div
      className="fixed z-50 flex flex-col items-center gap-1"
      style={{ left, top: Math.max(8, anchor.y - (showHighlighter ? 88 : 48)) }}
      data-testid="format-toolbar"
    >
      {showHighlighter && (
        <div className="flex rounded-lg bg-page shadow-xs">
          <Cell first title="Remove highlight" onClick={() => run('hiliteColor', 'transparent')}>
            <DoNotDisturbIcon size={20} className="text-black/60" strokeWidth={1.75} />
          </Cell>
          {HIGHLIGHT_COLORS.map((color, i) => (
            <Cell
              key={color}
              last={i === HIGHLIGHT_COLORS.length - 1}
              title={`Highlight ${color}`}
              onClick={() => run('hiliteColor', color)}
            >
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
            </Cell>
          ))}
        </div>
      )}
      <div className="flex rounded-lg bg-page shadow-xs">
        <Cell first title="Bold" active={state.bold} onClick={() => run('bold')}>
          <FormatBoldIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Italic" active={state.italic} onClick={() => run('italic')}>
          <FormatItalicIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Underline" active={state.underline} onClick={() => run('underline')}>
          <FormatUnderlinedIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Strikethrough" active={state.strike} onClick={() => run('strikeThrough')}>
          <StrikethroughIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Align left" active={state.align === 'left'} onClick={() => run('justifyLeft')}>
          <FormatAlignLeftIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Align center" active={state.align === 'center'} onClick={() => run('justifyCenter')}>
          <FormatAlignCenterIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Align right" active={state.align === 'right'} onClick={() => run('justifyRight')}>
          <FormatAlignRightIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell
          title="Highlight"
          active={showHighlighter}
          onClick={() => setShowHighlighter((v) => !v)}
        >
          <BorderColorIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Heading 1" active={state.heading === 'h1'} onClick={() => setHeading('h1')}>
          <span className="text-base font-medium leading-6">H1</span>
        </Cell>
        <Cell title="Heading 2" active={state.heading === 'h2'} onClick={() => setHeading('h2')}>
          <span className="text-base font-medium leading-6">H2</span>
        </Cell>
        <Cell title="Heading 3" active={state.heading === 'h3'} onClick={() => setHeading('h3')}>
          <span className="text-base font-medium leading-6">H3</span>
        </Cell>
        <Cell
          title="Bulleted list"
          active={state.bulletList}
          onClick={() => run('insertUnorderedList')}
        >
          <FormatListBulletedIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell
          title="Numbered list"
          active={state.numberList}
          onClick={() => run('insertOrderedList')}
        >
          <FormatListNumberedIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Block quote" active={state.blockquote} onClick={toggleQuote}>
          <FormatQuoteIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell title="Insert link" onClick={insertLink}>
          <LinkIcon size={16} strokeWidth={2} />
        </Cell>
        <Cell last title="Inline code" active={state.code} onClick={toggleInlineCode}>
          <CodeIcon size={16} strokeWidth={2} />
        </Cell>
      </div>
    </div>
  )
}
