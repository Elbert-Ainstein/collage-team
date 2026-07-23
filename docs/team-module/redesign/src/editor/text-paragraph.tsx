import { useEffect, useRef, useState } from 'react'
import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { TextNode } from '../types'
import { sanitizeHtml } from './sanitize-html'

export interface SlashSession {
  /** Text node id the session lives in. */
  nodeId: string
  query: string
  anchor: { x: number; y: number }
  /** Remove the "/query" text and split the paragraph at that point. */
  consume: () => SplitHalves | null
  /** Close the session; dead=true prevents the same "/" from reopening. */
  close: (dead: boolean) => void
}

interface SplitHalves {
  before: string
  after: string
}

interface TextParagraphProps {
  node: TextNode
  readOnly: boolean
  onChange: (html: string) => void
  /** Enter at caret — split this paragraph. */
  onSplit: (halves: SplitHalves) => void
  /** Backspace with caret at the very start. */
  onBackspaceAtStart: () => void
  /** ArrowUp at start / ArrowDown at end — move focus across neighbors. */
  onNavigate: (direction: 'up' | 'down') => void
  /** Slash session lifecycle, reported upward; menu + selection live in the editor. */
  onSlashChange: (session: SlashSession | null) => void
  /** Menu-owned keys (arrows/enter/escape) while a slash session is open. */
  slashKeyHandler: ((e: ReactKeyboardEvent) => boolean) | null
  registerEl: (id: string, el: HTMLDivElement | null) => void
  /** Always-visible placeholder (used on the single empty-document line). */
  placeholder?: string
  /** Hint shown only while this (empty) paragraph has focus. */
  focusPlaceholder?: string
}

function serializeRange(range: Range): string {
  const div = document.createElement('div')
  div.appendChild(range.cloneContents())
  return div.innerHTML
}

/** Split the element's content at the caret into before/after HTML. */
export function splitAtCaret(el: HTMLElement): SplitHalves | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const caret = sel.getRangeAt(0)
  const before = document.createRange()
  before.selectNodeContents(el)
  before.setEnd(caret.startContainer, caret.startOffset)
  const after = document.createRange()
  after.selectNodeContents(el)
  after.setStart(caret.endContainer, caret.endOffset)
  return { before: serializeRange(before), after: serializeRange(after) }
}

function caretRect(el: HTMLElement): { x: number; y: number } {
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0)
    const rects = range.getClientRects()
    if (rects.length > 0) return { x: rects[0].left, y: rects[0].top }
    const rect = range.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0 || rect.top > 0) return { x: rect.left, y: rect.top }
  }
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.top }
}

function caretAtStart(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0).cloneRange()
  range.selectNodeContents(el)
  range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
  return range.toString().length === 0
}

function caretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0).cloneRange()
  range.selectNodeContents(el)
  range.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset)
  return range.toString().length === 0
}

interface SlashRef {
  domNode: Text
  offset: number
  dead: boolean
}

/**
 * One editable paragraph run of the inline document. Uncontrolled
 * contenteditable — the sanitized HTML is pushed up on input, and external
 * changes (undo, heal) are written back only when they differ.
 */
export function TextParagraph({
  node,
  readOnly,
  onChange,
  onSplit,
  onBackspaceAtStart,
  onNavigate,
  onSlashChange,
  slashKeyHandler,
  registerEl,
  placeholder,
  focusPlaceholder,
}: TextParagraphProps): ReactElement {
  const [focused, setFocused] = useState(false)
  const elRef = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string>(node.html)
  const slashRef = useRef<SlashRef | null>(null)
  const mounted = useRef(false)

  // The contenteditable DOM is the source of truth while typing; React never
  // rewrites innerHTML on re-render (that would reset the caret). Content is
  // set on mount and again only when an external change (undo, merge) arrives.
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    if (!mounted.current) {
      mounted.current = true
      el.innerHTML = sanitizeHtml(node.html)
      return
    }
    if (node.html !== lastEmitted.current && el.innerHTML !== node.html) {
      el.innerHTML = node.html
      lastEmitted.current = node.html
    }
  }, [node.html])

  useEffect(() => {
    registerEl(node.id, elRef.current)
    return () => registerEl(node.id, null)
  }, [node.id, registerEl])

  const closeSlash = (markDead: boolean): void => {
    if (slashRef.current && markDead) slashRef.current.dead = true
    else slashRef.current = null
    onSlashChange(null)
  }

  /** Re-derive the slash query from the DOM; close the session if it broke. */
  const syncSlash = (): void => {
    const el = elRef.current
    const session = slashRef.current
    if (!el || !session || session.dead) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return closeSlash(false)
    const { domNode, offset } = session
    if (!el.contains(domNode) || domNode.data[offset] !== '/') return closeSlash(false)
    const caret = sel.getRangeAt(0)
    if (caret.startContainer !== domNode || caret.startOffset <= offset) return closeSlash(false)
    const query = domNode.data.slice(offset + 1, caret.startOffset)
    if (query.includes(' ')) return closeSlash(true) // space closes for good (PRD §1.2)
    onSlashChange({
      nodeId: node.id,
      query,
      anchor: caretRect(el),
      consume: consumeSlash,
      close: closeSlash,
    })
  }

  const handleInput = (): void => {
    const el = elRef.current
    if (!el) return
    const html = sanitizeHtml(el.innerHTML)
    lastEmitted.current = html
    onChange(html)

    // open a slash session when "/" is typed at line start or after whitespace
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && sel.isCollapsed && !slashRef.current) {
      const caret = sel.getRangeAt(0)
      const container = caret.startContainer
      if (container.nodeType === Node.TEXT_NODE) {
        const textNode = container as Text
        const offset = caret.startOffset
        if (offset > 0 && textNode.data[offset - 1] === '/') {
          const beforeChar = offset >= 2 ? textNode.data[offset - 2] : null
          const lineStart = offset === 1 && (!textNode.previousSibling || textNode.previousSibling.nodeName === 'BR')
          if (lineStart || beforeChar === ' ' || beforeChar === ' ' || beforeChar === null) {
            slashRef.current = { domNode: textNode, offset: offset - 1, dead: false }
          }
        }
      }
    }
    syncSlash()
  }

  /** Remove the "/query" text and return the paragraph split at that point. */
  const consumeSlash = (): SplitHalves | null => {
    const el = elRef.current
    const session = slashRef.current
    if (!el || !session) return null
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const kill = document.createRange()
    kill.setStart(session.domNode, session.offset)
    kill.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset)
    kill.deleteContents()
    slashRef.current = null
    return splitAtCaret(el)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const el = elRef.current
    if (!el) return

    if (slashKeyHandler && slashKeyHandler(e)) {
      // don't let the same key reach the document-level block shortcuts
      e.stopPropagation()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // let lists/quotes keep their native Enter behavior
      const sel = window.getSelection()
      let inNested = false
      let cursor: Node | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null
      while (cursor && cursor !== el) {
        if (cursor instanceof Element && ['LI', 'UL', 'OL', 'BLOCKQUOTE'].includes(cursor.tagName)) {
          inNested = true
          break
        }
        cursor = cursor.parentNode
      }
      if (!inNested) {
        e.preventDefault()
        const halves = splitAtCaret(el)
        if (halves) {
          el.innerHTML = halves.before
          lastEmitted.current = sanitizeHtml(halves.before)
          onSplit({ before: lastEmitted.current, after: sanitizeHtml(halves.after) })
        }
      }
      return
    }

    if (e.key === 'Backspace' && caretAtStart(el)) {
      e.preventDefault()
      onBackspaceAtStart()
      return
    }

    if (e.key === 'ArrowUp' && caretAtStart(el)) {
      e.preventDefault()
      onNavigate('up')
      return
    }
    if (e.key === 'ArrowDown' && caretAtEnd(el)) {
      e.preventDefault()
      onNavigate('down')
      return
    }
  }

  if (readOnly) {
    return (
      <div
        className="doc-text min-h-6 text-base leading-7 text-neutral-900"
        // sanitized rich text authored in this editor
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(node.html) }}
      />
    )
  }

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      className="doc-text min-h-6 text-base leading-7 text-neutral-900 outline-none"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        closeSlash(false)
      }}
      data-placeholder={placeholder ?? (focused ? focusPlaceholder : undefined)}
      data-node-id={node.id}
    />
  )
}

export { serializeRange }
export type { SplitHalves }
