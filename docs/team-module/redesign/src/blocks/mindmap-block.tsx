import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { MindmapData, MindmapNode } from '../types'
import { uid } from '../editor/uid'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const FullscreenIcon = mIcon('fullscreen')
const FullscreenExitIcon = mIcon('fullscreen_exit')
const RemoveIcon = mIcon('remove')
const AddIcon = mIcon('add')
const CloseIcon = mIcon('close')

const NODE_W = 112
const NODE_H = 36

type Anchor = 'top' | 'bottom' | 'left' | 'right'
const ANCHORS: Anchor[] = ['top', 'bottom', 'left', 'right']

function anchorOffset(anchor: Anchor): { dx: number; dy: number } {
  switch (anchor) {
    case 'top':
      return { dx: 0, dy: -90 }
    case 'bottom':
      return { dx: 0, dy: 90 }
    case 'left':
      return { dx: -180, dy: 0 }
    case 'right':
      return { dx: 180, dy: 0 }
  }
}

export function MindmapBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<MindmapData>): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const dragState = useRef<{ nodeId: string | null; startX: number; startY: number; panStart?: { x: number; y: number } } | null>(null)
  const editing = viewMode === 'edit'

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const nodes = data.nodes
  const mainId = nodes[0]?.id

  const updateNode = (id: string, patch: Partial<MindmapNode>): void =>
    onChange({ ...data, nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })

  const deleteNode = (id: string): void => {
    if (id === mainId) return
    onChange({
      ...data,
      nodes: nodes.filter((n) => n.id !== id),
      edges: data.edges.filter((e) => e.from !== id && e.to !== id),
    })
    setSelectedId(null)
  }

  const addChild = (parentId: string, anchor: Anchor): void => {
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) return
    const { dx, dy } = anchorOffset(anchor)
    const id = uid('mn')
    onChange({
      ...data,
      nodes: [...nodes, { id, text: 'New node', x: parent.x + dx, y: parent.y + dy, color: '#dca2fd', collapsed: false }],
      edges: [...data.edges, { id: uid('me'), from: parentId, to: id }],
    })
    setSelectedId(id)
  }

  const onNodePointerDown = (e: ReactPointerEvent, nodeId: string): void => {
    e.stopPropagation()
    setSelectedId(nodeId)
    if (!editing) return
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    dragState.current = { nodeId, startX: e.clientX - node.x * zoom, startY: e.clientY - node.y * zoom }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onCanvasPointerDown = (e: ReactPointerEvent): void => {
    setSelectedId(null)
    setEditingId(null)
    dragState.current = { nodeId: null, startX: e.clientX, startY: e.clientY, panStart: { ...pan } }
  }

  const onPointerMove = (e: ReactPointerEvent): void => {
    const drag = dragState.current
    if (!drag) return
    if (drag.nodeId) {
      updateNode(drag.nodeId, {
        x: (e.clientX - drag.startX) / zoom,
        y: (e.clientY - drag.startY) / zoom,
      })
    } else if (drag.panStart) {
      setPan({ x: drag.panStart.x + (e.clientX - drag.startX), y: drag.panStart.y + (e.clientY - drag.startY) })
    }
  }

  const canvas = (
    <div
      className={`relative overflow-hidden rounded-lg border border-line shadow-2xs ${fullscreen ? 'h-full' : 'h-[345px]'}`}
      style={{
        backgroundColor: '#fcf8ec',
        backgroundImage: 'radial-gradient(circle, rgba(120,110,90,0.18) 1.2px, transparent 1.2px)',
        backgroundSize: '40px 40px',
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        dragState.current = null
      }}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
      >
        {/* edges */}
        <svg className="pointer-events-none absolute overflow-visible" width={1} height={1}>
          {data.edges.map((edge) => {
            const from = nodes.find((n) => n.id === edge.from)
            const to = nodes.find((n) => n.id === edge.to)
            if (!from || !to) return null
            return (
              <line
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#d6d0c2"
                strokeWidth={1.5}
              />
            )
          })}
        </svg>

        {/* nodes */}
        {nodes.map((node) => {
          const isMain = node.id === mainId
          const active = selectedId === node.id
          return (
            <div
              key={node.id}
              className="absolute"
              style={{ left: node.x, top: node.y, transform: 'translate(-50%, -50%)' }}
            >
              <div
                className={`relative rounded-lg ${active ? 'border border-[#0382ed] p-0.5' : 'p-[3px]'}`}
                onPointerDown={(e) => onNodePointerDown(e, node.id)}
                onPointerMove={onPointerMove}
                onPointerUp={() => {
                  dragState.current = null
                }}
                onDoubleClick={() => editing && setEditingId(node.id)}
              >
                <div
                  className={`flex min-h-[${NODE_H}px] min-w-[${NODE_W}px] cursor-grab items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium leading-5 shadow-xs ${isMain ? 'bg-navy text-cream' : 'bg-cream-300 text-navy'}`}
                >
                  {editingId === node.id ? (
                    <input
                      autoFocus
                      value={node.text}
                      onChange={(e) => updateNode(node.id, { text: e.target.value })}
                      onBlur={() => setEditingId(null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setEditingId(null)
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={`w-28 bg-transparent text-center outline-none ${isMain ? 'text-cream' : 'text-navy'}`}
                    />
                  ) : (
                    node.text
                  )}
                </div>

                {/* connection anchors + delete on selected node (editor) */}
                {editing && active && (
                  <>
                    {ANCHORS.map((anchor) => {
                      const pos: Record<Anchor, string> = {
                        top: 'left-1/2 -top-1.5 -translate-x-1/2',
                        bottom: 'left-1/2 -bottom-1.5 -translate-x-1/2',
                        left: '-left-1.5 top-1/2 -translate-y-1/2',
                        right: '-right-1.5 top-1/2 -translate-y-1/2',
                      }
                      return (
                        <button
                          key={anchor}
                          type="button"
                          title="Add connected node"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => addChild(node.id, anchor)}
                          className={`absolute h-2 w-2 rounded-full bg-[#0382ed] hover:scale-150 ${pos[anchor]}`}
                        />
                      )
                    })}
                    {!isMain && (
                      <button
                        type="button"
                        title="Delete node"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => deleteNode(node.id)}
                        className="absolute -right-2.5 -top-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-white text-neutral-600 shadow-xs hover:text-red-600"
                      >
                        <CloseIcon size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* orientation toolbar */}
      <div className="absolute left-3 top-4 flex flex-col overflow-hidden rounded-lg border border-line bg-page shadow-xs">
        <button type="button" title="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.2))} className="flex h-9 w-9 items-center justify-center border-b border-line hover:bg-cream-300">
          <AddIcon size={20} />
        </button>
        <button type="button" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="flex h-9 w-9 items-center justify-center border-b border-line hover:bg-cream-300">
          <RemoveIcon size={20} />
        </button>
        <button type="button" title={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={() => setFullscreen((v) => !v)} className="flex h-9 w-9 items-center justify-center hover:bg-cream-300">
          {fullscreen ? <FullscreenExitIcon size={22} /> : <FullscreenIcon size={22} />}
        </button>
      </div>

    </div>
  )

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 bg-black/30 p-8">{canvas}</div>
  }
  return canvas
}
