import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import type { QuestionData, ViewMode } from '../types'
import type { SlashMenuEntry } from '../constants/block-registry'
import { BlockRenderer } from '../blocks/block-renderer'
import { defaultBlockData } from './block-defaults'
import { sampleBlockData } from './sample-content'
import { BlockShell } from './block-shell'
import { filterSlashEntries, SlashMenu } from './slash-menu'
import { FormatToolbar } from './format-toolbar'
import { TextParagraph } from './text-paragraph'
import type { SlashSession } from './text-paragraph'
import {
  MathKeyboardCard,
  useMathKeyboardOpen,
  closeMathKeyboard,
  focusedFieldNodeId,
  insertToken,
  backspaceToken,
} from '../components/math-keyboard'
import type { DocState } from './use-doc-state'

const GENERATION_MS = 1800
const SAVE_MS = 900

/** Place the caret at a character offset inside a contenteditable element. */
function focusAt(el: HTMLElement, position: 'start' | 'end' | number): void {
  el.focus()
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  if (position === 'start') {
    range.selectNodeContents(el)
    range.collapse(true)
  } else if (position === 'end') {
    range.selectNodeContents(el)
    range.collapse(false)
  } else {
    let remaining = position
    let placed = false
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let textNode = walker.nextNode() as Text | null
    while (textNode) {
      if (remaining <= textNode.data.length) {
        range.setStart(textNode, remaining)
        range.collapse(true)
        placed = true
        break
      }
      remaining -= textNode.data.length
      textNode = walker.nextNode() as Text | null
    }
    if (!placed) {
      range.selectNodeContents(el)
      range.collapse(false)
    }
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

function htmlTextLength(html: string): number {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent?.length ?? 0
}

export interface EditorApi {
  /** Focus the end of the document and open the slash menu. */
  openSlashAtEnd: () => void
}

interface DocumentEditorProps {
  viewMode: ViewMode
  /** Document state owned by the app shell (shared with the sidebar outline). */
  doc: DocState
  onDirty: () => void
  registerApi?: (api: EditorApi) => void
}

/** The inline block document: text runs with blocks dropped into the flow. */
export function DocumentEditor({ viewMode, doc, onDirty, registerApi }: DocumentEditorProps): ReactElement {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [slash, setSlash] = useState<SlashSession | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [toolbarAnchor, setToolbarAnchor] = useState<{ x: number; y: number } | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const kbOpen = useMathKeyboardOpen()

  const paragraphEls = useRef(new Map<string, HTMLDivElement>())
  const draggingBlockId = useRef<string | null>(null)
  const timersRef = useRef(new Map<string, number>())
  const pendingFocus = useRef<{ id: string; position: 'start' | 'end' | number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const registerEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) paragraphEls.current.set(id, el)
    else paragraphEls.current.delete(id)
  }, [])

  /* focus a paragraph after the DOM settles; drop stale targets */
  useEffect(() => {
    if (!pendingFocus.current) return
    const { id, position } = pendingFocus.current
    const el = paragraphEls.current.get(id)
    if (el) {
      focusAt(el, position)
      pendingFocus.current = null
    } else if (!doc.nodes.some((n) => n.id === id)) {
      pendingFocus.current = null
    }
  })

  /* track which doc node currently holds the caret (for the math keyboard) */
  useEffect(() => {
    const onFocusIn = (): void => {
      const id = focusedFieldNodeId()
      if (id) setFocusedNodeId(id)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  /* floating toolbar: track document selection */
  useEffect(() => {
    if (viewMode !== 'edit') return
    const onSelection = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setToolbarAnchor(null)
        return
      }
      const range = sel.getRangeAt(0)
      const container = containerRef.current
      const inParagraph = [...paragraphEls.current.values()].some((el) =>
        el.contains(range.commonAncestorContainer),
      )
      if (!container || !inParagraph) {
        setToolbarAnchor(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setToolbarAnchor({ x: rect.left + rect.width / 2, y: rect.top })
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [viewMode])

  /* persist toolbar formatting back into doc state */
  const persistActiveParagraph = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    for (const [id, el] of paragraphEls.current) {
      if (el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        doc.updateText(id, el.innerHTML)
        onDirty()
        break
      }
    }
  }, [doc, onDirty])

  /* simulated autosave: mark saving briefly whenever block data changes */
  const scheduleStatus = useCallback(
    (blockId: string, ms: number, apply: () => void) => {
      const existing = timersRef.current.get(blockId)
      if (existing !== undefined) window.clearTimeout(existing)
      const timer = window.setTimeout(() => {
        timersRef.current.delete(blockId)
        apply()
      }, ms)
      timersRef.current.set(blockId, timer)
    },
    [],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [])

  const changeBlockData = useCallback(
    (blockId: string) =>
      (data: Parameters<typeof doc.updateBlockData>[1]): void => {
        doc.updateBlockData(blockId, data)
        doc.setBlockStatus(blockId, 'saving')
        onDirty()
        scheduleStatus(blockId, SAVE_MS, () => doc.setBlockStatus(blockId, 'idle'))
      },
    [doc, onDirty, scheduleStatus],
  )

  /** Enter at the end of a single-line block: jump to the text below it. */
  const exitBlockDown = useCallback(
    (blockId: string) => {
      const index = doc.nodes.findIndex((n) => n.id === blockId)
      if (index === -1) return
      setSelectedBlockId(null)
      const next = doc.nodes[index + 1]
      if (next && next.kind === 'text') {
        pendingFocus.current = { id: next.id, position: 'start' }
        const el = paragraphEls.current.get(next.id)
        if (el) focusAt(el, 'start')
      } else {
        const paraId = doc.insertParagraphAfter(blockId)
        pendingFocus.current = { id: paraId, position: 'start' }
      }
    },
    [doc],
  )

  /** Simulated AI generation. Hold Shift while clicking Generate to see the failure path. */
  const startGeneration = useCallback(
    (blockId: string, blockType: Parameters<typeof sampleBlockData>[0], fail: boolean) => {
      // question blocks generate content for their own question type
      const node = doc.nodes.find((n) => n.id === blockId)
      const qKind =
        node && node.kind === 'block' && node.type === 'question'
          ? (node.data as QuestionData).qKind
          : undefined
      doc.setBlockStatus(blockId, 'generating')
      scheduleStatus(blockId, GENERATION_MS, () => {
        if (fail) {
          doc.setBlockStatus(blockId, 'generation-failed')
        } else {
          doc.updateBlockData(blockId, sampleBlockData(blockType, qKind))
          doc.setBlockStatus(blockId, 'idle')
        }
      })
    },
    [doc, scheduleStatus],
  )

  /* imperative hook for the sidebar's "+ block" button */
  useEffect(() => {
    registerApi?.({
      openSlashAtEnd: () => {
        const last = doc.nodes[doc.nodes.length - 1]
        if (!last) return
        const targetId =
          last.kind === 'text' && last.html === '' ? last.id : doc.insertParagraphAfter(last.id)
        window.setTimeout(() => {
          const el = paragraphEls.current.get(targetId)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            focusAt(el, 'end')
            document.execCommand('insertText', false, '/')
          }
        }, 80)
      },
    })
  }, [registerApi, doc])

  /* ---------- slash menu ---------- */

  const insertFromSlash = useCallback(
    (entry: SlashMenuEntry) => {
      if (!slash) return
      const halves = slash.consume()
      const nodeId = slash.nodeId
      setSlash(null)
      setSlashIndex(0)
      if (!halves) return
      const blockId = doc.insertBlock(nodeId, entry.type, halves.before, halves.after)
      if (entry.qKind) {
        const data = defaultBlockData('question') as QuestionData
        doc.updateBlockData(blockId, { ...data, qKind: entry.qKind })
      }
      setSelectedBlockId(blockId)
      onDirty()
    },
    [doc, onDirty, slash],
  )

  const slashKeyHandler = useCallback(
    (e: ReactKeyboardEvent): boolean => {
      if (!slash) return false
      const entries = filterSlashEntries(slash.query)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (entries.length === 0 ? 0 : (i + 1) % entries.length))
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (entries.length === 0 ? 0 : (i - 1 + entries.length) % entries.length))
        return true
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const entry = entries[slashIndex] ?? entries[0]
        if (entry) insertFromSlash(entry)
        else {
          slash.close(false)
          setSlash(null)
        }
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        slash.close(false)
        setSlash(null)
        return true
      }
      return false
    },
    [insertFromSlash, slash, slashIndex],
  )

  const handleSlashChange = useCallback((session: SlashSession | null) => {
    setSlash(session)
    setSlashIndex(0)
  }, [])

  /* ---------- keyboard behavior around blocks ---------- */

  useEffect(() => {
    if (viewMode !== 'edit') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return
      const active = document.activeElement
      const typing =
        active instanceof HTMLElement &&
        (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        if (doc.canUndo) {
          e.preventDefault()
          doc.undo()
        }
        return
      }

      if (!selectedBlockId || typing) return
      const index = doc.nodes.findIndex((n) => n.id === selectedBlockId)
      if (index === -1) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        doc.removeBlock(selectedBlockId)
        setSelectedBlockId(null)
      } else if (e.key === 'Escape') {
        setSelectedBlockId(null)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const paraId = doc.insertParagraphAfter(selectedBlockId)
        setSelectedBlockId(null)
        pendingFocus.current = { id: paraId, position: 'start' }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.key === 'ArrowUp' ? -1 : 1
        const neighbor = doc.nodes[index + step]
        if (neighbor) {
          e.preventDefault()
          if (neighbor.kind === 'text') {
            setSelectedBlockId(null)
            pendingFocus.current = { id: neighbor.id, position: step === -1 ? 'end' : 'start' }
            const el = paragraphEls.current.get(neighbor.id)
            if (el) focusAt(el, step === -1 ? 'end' : 'start')
          } else {
            setSelectedBlockId(neighbor.id)
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [doc, selectedBlockId, viewMode])

  const handleBackspaceAtStart = useCallback(
    (nodeId: string) => {
      const index = doc.nodes.findIndex((n) => n.id === nodeId)
      if (index <= 0) return
      const prev = doc.nodes[index - 1]
      if (prev.kind === 'block') {
        // Backspace right after a block selects the block first (PRD §5)
        setSelectedBlockId(prev.id)
        ;(document.activeElement as HTMLElement | null)?.blur()
      } else {
        const boundary = htmlTextLength(prev.html)
        doc.mergeWithPrevious(nodeId)
        pendingFocus.current = { id: prev.id, position: boundary }
      }
    },
    [doc],
  )

  const handleNavigate = useCallback(
    (nodeId: string, direction: 'up' | 'down') => {
      const index = doc.nodes.findIndex((n) => n.id === nodeId)
      const neighbor = doc.nodes[index + (direction === 'up' ? -1 : 1)]
      if (!neighbor) return
      if (neighbor.kind === 'text') {
        pendingFocus.current = { id: neighbor.id, position: direction === 'up' ? 'end' : 'start' }
        const el = paragraphEls.current.get(neighbor.id)
        if (el) focusAt(el, direction === 'up' ? 'end' : 'start')
      } else {
        setSelectedBlockId(neighbor.id)
        ;(document.activeElement as HTMLElement | null)?.blur()
      }
    },
    [doc],
  )

  /* ---------- drag to reorder ---------- */

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!draggingBlockId.current) return
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      const rows = [...container.children] as HTMLElement[]
      let index = doc.nodes.length
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect()
        if (e.clientY < rect.top + rect.height / 2) {
          index = i
          break
        }
      }
      setDropIndex(index)
    },
    [doc.nodes.length],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const blockId = draggingBlockId.current
      if (blockId && dropIndex !== null) {
        doc.moveBlock(blockId, dropIndex)
        onDirty()
      }
      draggingBlockId.current = null
      setDropIndex(null)
    },
    [doc, dropIndex, onDirty],
  )

  /* ---------- render ---------- */

  const isEmptyDoc = doc.nodes.length === 1 && doc.nodes[0].kind === 'text' && doc.nodes[0].html === ''

  const mathKeyboardFor = (nodeId: string): ReactElement | null =>
    viewMode === 'edit' && kbOpen && focusedNodeId === nodeId ? (
      <div className="my-2 flex justify-center px-6">
        <MathKeyboardCard
          onKey={(k) => insertToken(k.uni)}
          onBackspace={backspaceToken}
          onDone={closeMathKeyboard}
          onClose={closeMathKeyboard}
        />
      </div>
    ) : null

  return (
    <div className="relative" onDragOver={handleDragOver} onDrop={handleDrop} onDragLeave={() => setDropIndex(null)}>
      <div ref={containerRef} className="flex flex-col">
        {doc.nodes.map((node, index) => {
          const dropLine =
            dropIndex === index ? <div className="pointer-events-none absolute -top-0.5 left-6 right-6 z-20 h-0.5 rounded bg-brand-purple" /> : null
          if (node.kind === 'text') {
            return (
              <div key={node.id} data-doc-node={node.id} className="relative px-6">
                {dropLine}
                <TextParagraph
                  node={node}
                  readOnly={viewMode !== 'edit'}
                  onChange={(html) => {
                    doc.updateText(node.id, html)
                    onDirty()
                  }}
                  onSplit={({ before, after }) => {
                    doc.updateText(node.id, before)
                    const paraId = doc.splitText(node.id, before, after)
                    pendingFocus.current = { id: paraId, position: 'start' }
                  }}
                  onBackspaceAtStart={() => handleBackspaceAtStart(node.id)}
                  onNavigate={(direction) => handleNavigate(node.id, direction)}
                  onSlashChange={handleSlashChange}
                  slashKeyHandler={slash && slash.nodeId === node.id ? slashKeyHandler : null}
                  registerEl={registerEl}
                  placeholder={isEmptyDoc ? 'Type / to insert a block or start writing' : undefined}
                  focusPlaceholder="Type / to insert a block"
                />
                {mathKeyboardFor(node.id)}
              </div>
            )
          }
          return (
            <div key={node.id} data-doc-node={node.id} className="relative px-1">
              {dropLine}
              <BlockShell
                node={node}
                viewMode={viewMode}
                onSelect={() => setSelectedBlockId(node.id)}
                onDelete={() => {
                  doc.removeBlock(node.id)
                  setSelectedBlockId(null)
                  onDirty()
                }}
                onGenerate={(fail) => startGeneration(node.id, node.type, fail)}
                onRetryGeneration={() => startGeneration(node.id, node.type, false)}
                onEditManually={() => doc.setBlockStatus(node.id, 'empty')}
                onDragStart={(e) => {
                  draggingBlockId.current = node.id
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', node.id)
                }}
                onDragEnd={() => {
                  draggingBlockId.current = null
                  setDropIndex(null)
                }}
              >
                <BlockRenderer
                  node={node}
                  viewMode={viewMode}
                  selected={selectedBlockId === node.id}
                  onChange={changeBlockData(node.id)}
                  onGenerate={(fail) => startGeneration(node.id, node.type, fail)}
                  onExitDown={() => exitBlockDown(node.id)}
                />
              </BlockShell>
              {mathKeyboardFor(node.id)}
            </div>
          )
        })}
      </div>

      {dropIndex === doc.nodes.length && <div className="pointer-events-none mx-6 h-0.5 rounded bg-brand-purple" />}

      {viewMode === 'edit' && slash && (
        <SlashMenu
          anchor={slash.anchor}
          query={slash.query}
          activeIndex={slashIndex}
          onSelect={insertFromSlash}
          onHover={setSlashIndex}
        />
      )}

      {viewMode === 'edit' && toolbarAnchor && !slash && (
        <FormatToolbar anchor={toolbarAnchor} onApplied={persistActiveParagraph} />
      )}
    </div>
  )
}
