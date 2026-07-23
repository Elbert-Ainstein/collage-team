import type { DragEvent, ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'
import type { BlockNode, ViewMode } from '../types'

const DragIndicatorIcon = mIcon('drag_indicator')
const AutoAwesomeIcon = mIcon('auto_awesome')
const DeleteForeverIcon = mIcon('delete_forever')
const RefreshIcon = mIcon('refresh')
const EditIcon = mIcon('edit')
const WarningAmberIcon = mIcon('warning_amber')

interface BlockShellProps {
  node: BlockNode
  viewMode: ViewMode
  onSelect: () => void
  onDelete: () => void
  /** Simulated AI generation for the whole block (Shift-click demos failure). */
  onGenerate: (fail: boolean) => void
  onRetryGeneration: () => void
  onEditManually: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  children: ReactNode
}

/**
 * Inline chrome shared by every block: drag handle + delete on hover
 * (Lesson Inline Edit skeleton), shimmer while generating, and in-place
 * failure states per PRD §1.4. Editing shadows live on block surfaces.
 */
export function BlockShell({
  node,
  viewMode,
  onSelect,
  onDelete,
  onGenerate,
  onRetryGeneration,
  onEditManually,
  onDragStart,
  onDragEnd,
  children,
}: BlockShellProps): ReactElement {
  const editable = viewMode === 'edit'
  const generating = node.status === 'generating'
  const generationFailed = node.status === 'generation-failed'

  if (!editable) {
    return <div className="my-2">{children}</div>
  }

  return (
    <div
      className="group/block relative my-2 flex items-start gap-1"
      data-block-id={node.id}
      onMouseDown={onSelect}
    >
      <div className="flex w-5 shrink-0 flex-col items-center gap-2 opacity-0 transition-opacity group-hover/block:opacity-100">
        <div
          className="mt-1 flex cursor-grab items-center justify-center text-neutral-400 active:cursor-grabbing"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          data-testid="drag-handle"
        >
          <DragIndicatorIcon size={20} strokeWidth={1.75} />
        </div>
        <button
          type="button"
          title="Generate with AI (Shift-click to demo failure)"
          onClick={(e) => onGenerate(e.shiftKey)}
          className="flex items-center justify-center text-neutral-400 hover:text-brand-purple"
          data-testid="generate-block"
        >
          <AutoAwesomeIcon size={16} strokeWidth={1.75} />
        </button>
      </div>

      {/* editing shadows live on each block's own surface (focus-within) */}
      <div className="relative min-w-0 flex-1 rounded-lg">
        {children}

        {generating && (
          <div className="shimmer-overlay pointer-events-none absolute inset-0 z-10" data-testid="shimmer" />
        )}

        {generationFailed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50/95 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-red-700">
              <WarningAmberIcon size={16} />
              Generation failed
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onRetryGeneration}
                className="flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-sm font-medium text-cream hover:bg-navy-deep"
              >
                <RefreshIcon size={14} /> Retry
              </button>
              <button
                type="button"
                onClick={onEditManually}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-cream-300"
              >
                <EditIcon size={14} /> Edit manually
              </button>
              <button
                type="button"
                onClick={onDelete}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                <DeleteForeverIcon size={14} /> Delete
              </button>
            </div>
          </div>
        )}

      </div>

      <button
        type="button"
        className="mt-1 flex w-5 shrink-0 items-center justify-center text-neutral-400 opacity-0 transition-all hover:text-red-500 group-hover/block:opacity-100"
        onClick={onDelete}
        title="Delete block"
        data-testid="delete-block"
      >
        <DeleteForeverIcon size={18} strokeWidth={1.75} />
      </button>
    </div>
  )
}
