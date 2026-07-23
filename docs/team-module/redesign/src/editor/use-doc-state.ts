import { useCallback, useRef, useState } from 'react'
import type { BlockData, BlockNode, BlockStatus, BlockType, DocNode, TextNode } from '../types'
import { defaultBlockData } from './block-defaults'
import { uid } from './uid'

const HISTORY_LIMIT = 100

function makeTextNode(html = ''): TextNode {
  return { kind: 'text', id: uid('tx'), html }
}

function makeBlockNode(type: BlockType, status: BlockStatus = 'empty'): BlockNode {
  return { kind: 'block', id: uid('bk'), type, status, data: defaultBlockData(type) }
}

/**
 * Normalize the document: it always ends with a text node so there is
 * somewhere to type. Adjacent text paragraphs are legitimate (Enter creates
 * them) — merging only happens explicitly, when deleting a block heals the
 * surrounding text (PRD §5).
 */
function normalize(nodes: DocNode[]): DocNode[] {
  if (nodes.length === 0 || nodes[nodes.length - 1].kind !== 'text') {
    return [...nodes, makeTextNode()]
  }
  return nodes
}

export interface DocState {
  nodes: DocNode[]
  /** Replace a text node's html (typing) — not undo-tracked per keystroke. */
  updateText: (id: string, html: string) => void
  /** Split a text node and insert a new empty block between the halves. */
  insertBlock: (textNodeId: string, type: BlockType, beforeHtml: string, afterHtml: string) => string
  /** Insert an empty paragraph after the given node (Enter after a block). */
  insertParagraphAfter: (nodeId: string) => string
  /** Split a text node into two paragraphs (Enter mid-text). */
  splitText: (textNodeId: string, beforeHtml: string, afterHtml: string) => string
  /** Merge a text node into the previous text node (Backspace at start). */
  mergeWithPrevious: (textNodeId: string) => void
  /** Remove a block and heal surrounding text. */
  removeBlock: (blockId: string) => void
  /** Move a block so it sits before the node currently at targetIndex. */
  moveBlock: (blockId: string, targetIndex: number) => void
  updateBlockData: (blockId: string, data: BlockData) => void
  setBlockStatus: (blockId: string, status: BlockStatus) => void
  undo: () => void
  canUndo: boolean
}

export function useDocState(initial?: DocNode[]): DocState {
  const [nodes, setNodes] = useState<DocNode[]>(() => normalize(initial ?? [makeTextNode()]))
  const historyRef = useRef<DocNode[][]>([])
  const [canUndo, setCanUndo] = useState(false)

  const commit = useCallback((updater: (prev: DocNode[]) => DocNode[], track = true) => {
    setNodes((prev) => {
      const next = normalize(updater(prev))
      if (track) {
        historyRef.current.push(prev)
        if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift()
        setCanUndo(true)
      }
      return next
    })
  }, [])

  const updateText = useCallback((id: string, html: string) => {
    setNodes((prev) => prev.map((n) => (n.kind === 'text' && n.id === id ? { ...n, html } : n)))
  }, [])

  const insertBlock = useCallback(
    (textNodeId: string, type: BlockType, beforeHtml: string, afterHtml: string): string => {
      const block = makeBlockNode(type)
      commit((prev) => {
        const idx = prev.findIndex((n) => n.id === textNodeId)
        if (idx === -1) return prev
        const replacement: DocNode[] = []
        if (beforeHtml !== '') replacement.push(makeTextNode(beforeHtml))
        replacement.push(block)
        replacement.push(makeTextNode(afterHtml))
        return [...prev.slice(0, idx), ...replacement, ...prev.slice(idx + 1)]
      })
      return block.id
    },
    [commit],
  )

  const insertParagraphAfter = useCallback(
    (nodeId: string): string => {
      const para = makeTextNode()
      commit((prev) => {
        const idx = prev.findIndex((n) => n.id === nodeId)
        if (idx === -1) return prev
        return [...prev.slice(0, idx + 1), para, ...prev.slice(idx + 1)]
      }, false)
      return para.id
    },
    [commit],
  )

  const splitText = useCallback(
    (textNodeId: string, beforeHtml: string, afterHtml: string): string => {
      const para = makeTextNode(afterHtml)
      commit((prev) => {
        const idx = prev.findIndex((n) => n.id === textNodeId)
        if (idx === -1) return prev
        const before = { ...(prev[idx] as TextNode), html: beforeHtml }
        return [...prev.slice(0, idx), before, para, ...prev.slice(idx + 1)]
      }, false)
      return para.id
    },
    [commit],
  )

  const mergeWithPrevious = useCallback(
    (textNodeId: string) => {
      commit((prev) => {
        const idx = prev.findIndex((n) => n.id === textNodeId)
        if (idx <= 0) return prev
        const current = prev[idx]
        const before = prev[idx - 1]
        if (current.kind !== 'text' || before.kind !== 'text') return prev
        const merged: TextNode = { ...before, html: before.html + current.html }
        return [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 1)]
      }, false)
    },
    [commit],
  )

  const removeBlock = useCallback(
    (blockId: string) => {
      commit((prev) => {
        const idx = prev.findIndex((n) => n.id === blockId)
        if (idx === -1) return prev
        const before = prev[idx - 1]
        const after = prev[idx + 1]
        // deleting a block heals the split paragraph back together (PRD §5)
        if (before && after && before.kind === 'text' && after.kind === 'text') {
          const merged: TextNode = { ...before, html: before.html + after.html }
          return [...prev.slice(0, idx - 1), merged, ...prev.slice(idx + 2)]
        }
        return prev.filter((n) => n.id !== blockId)
      })
    },
    [commit],
  )

  const moveBlock = useCallback(
    (blockId: string, targetIndex: number) => {
      commit((prev) => {
        const from = prev.findIndex((n) => n.id === blockId)
        if (from === -1) return prev
        const block = prev[from]
        const without = [...prev.slice(0, from), ...prev.slice(from + 1)]
        const to = targetIndex > from ? targetIndex - 1 : targetIndex
        return [...without.slice(0, to), block, ...without.slice(to)]
      })
    },
    [commit],
  )

  const updateBlockData = useCallback((blockId: string, data: BlockData) => {
    setNodes((prev) =>
      prev.map((n) => (n.kind === 'block' && n.id === blockId ? { ...n, data } : n)),
    )
  }, [])

  const setBlockStatus = useCallback((blockId: string, status: BlockStatus) => {
    setNodes((prev) =>
      prev.map((n) => (n.kind === 'block' && n.id === blockId ? { ...n, status } : n)),
    )
  }, [])

  const undo = useCallback(() => {
    const last = historyRef.current.pop()
    if (last) setNodes(normalize(last))
    setCanUndo(historyRef.current.length > 0)
  }, [])

  return {
    nodes,
    updateText,
    insertBlock,
    insertParagraphAfter,
    splitText,
    mergeWithPrevious,
    removeBlock,
    moveBlock,
    updateBlockData,
    setBlockStatus,
    undo,
    canUndo,
  }
}
