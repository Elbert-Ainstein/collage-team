import { useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { TableData } from '../types'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const DragIndicatorIcon = mIcon('drag_indicator')
const AddIcon = mIcon('add')
const CloseIcon = mIcon('close')

const MAX_DATA_ROWS = 9
const MAX_COLUMNS = 6

/** Skeleton pill widths per row (Figma Table Block/State/generate, 3513:1934). */
const SKELETON_ROWS = [
  [60, 110, 90],
  [60, 40, 50],
  [70, 60, 50],
  [65, 30, 50],
  [80, 45, 70],
  [40, 30, 50],
]

function TableSkeleton(): ReactElement {
  return (
    <div className="rounded-lg border border-line bg-cream-300 px-2 shadow-2xs">
      {SKELETON_ROWS.map((widths, ri) => (
        <div
          key={ri}
          className={`flex items-center gap-8 pl-10 ${ri === 0 ? 'h-10' : 'h-[37px]'} ${ri < SKELETON_ROWS.length - 1 ? 'border-b border-line' : ''}`}
        >
          {widths.map((w, ci) => (
            <div key={ci} className="h-3.5 animate-pulse rounded bg-line" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function TableBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<TableData>): ReactElement {
  const [activeRow, setActiveRow] = useState<number | null>(null)
  const [dragRow, setDragRow] = useState<number | null>(null)
  const editing = viewMode === 'edit'
  const rows = data.rows
  const columnCount = rows[0]?.length ?? 0

  if (status === 'generating') return <TableSkeleton />
  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const setCell = (r: number, c: number, value: string): void => {
    const next = rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row))
    onChange({ ...data, rows: next })
  }
  const addRow = (): void => onChange({ ...data, rows: [...rows, Array<string>(columnCount).fill('')] })
  const deleteRow = (r: number): void => onChange({ ...data, rows: rows.filter((_, ri) => ri !== r) })
  const addColumn = (): void => onChange({ ...data, rows: rows.map((row) => [...row, '']) })
  const deleteColumn = (c: number): void =>
    onChange({ ...data, rows: rows.map((row) => row.filter((_, ci) => ci !== c)) })
  const moveRow = (from: number, to: number): void => {
    if (from === to) return
    const body = rows.slice(1)
    const [moved] = body.splice(from - 1, 1)
    body.splice(to - 1, 0, moved)
    onChange({ ...data, rows: [rows[0], ...body] })
  }

  if (!editing) {
    return (
      <div className="rounded-lg border border-line bg-cream-100 shadow-2xs">
        {rows.map((row, r) => (
          <div key={r} className={`flex ${r < rows.length - 1 ? 'border-b border-line' : ''}`}>
            {row.map((cell, c) => (
              <div
                key={c}
                className={`min-w-0 flex-1 whitespace-pre-wrap break-words px-2 py-2.5 text-center text-sm leading-5 text-neutral-950 ${r === 0 ? 'font-semibold' : c === 0 ? 'font-medium' : ''}`}
              >
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-cream-300 px-2 py-2 transition-shadow focus-within:shadow-md">
      <div className="rounded-md">
        {/* header row */}
        <div className="flex items-center border-b border-line">
          <div className="w-10 shrink-0 px-2" />
          {rows[0]?.map((cell, c) => (
            <div key={c} className="min-w-0 flex-1 px-2">
              <input
                value={cell}
                placeholder={`Column ${c + 1}`}
                onChange={(e) => setCell(0, c, e.target.value)}
                className="h-10 w-full bg-transparent text-center text-sm font-semibold leading-5 text-neutral-950 outline-none placeholder:text-black/30"
              />
            </div>
          ))}
          <div className="flex w-10 shrink-0 items-center justify-center px-2">
            {columnCount < MAX_COLUMNS && (
              <button type="button" onClick={addColumn} title="Add column" className="text-neutral-600 hover:text-navy">
                <AddIcon size={20} />
              </button>
            )}
          </div>
        </div>

        {/* data rows */}
        {rows.slice(1).map((row, i) => {
          const r = i + 1
          const active = activeRow === r
          return (
            <div
              key={r}
              className={`group/row flex items-center border-b border-line ${active ? 'bg-cream-100' : ''}`}
              onDragOver={(e) => {
                if (dragRow !== null) e.preventDefault()
              }}
              onDrop={() => {
                if (dragRow !== null) moveRow(dragRow, r)
                setDragRow(null)
              }}
            >
              <div
                className="flex w-10 shrink-0 cursor-grab items-center justify-center px-2 text-neutral-400"
                draggable
                onDragStart={(e) => {
                  e.stopPropagation()
                  setDragRow(r)
                }}
                onDragEnd={() => setDragRow(null)}
                title="Drag to reorder row"
              >
                <DragIndicatorIcon size={20} />
              </div>
              {row.map((cell, c) => (
                <div key={c} className="min-w-0 flex-1 px-2">
                  <input
                    value={cell}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    onFocus={() => setActiveRow(r)}
                    onBlur={() => setActiveRow(null)}
                    className={`h-[37px] w-full bg-transparent text-center text-sm leading-5 text-neutral-950 outline-none ${c === 0 ? 'font-medium' : ''}`}
                  />
                </div>
              ))}
              <div className="flex w-10 shrink-0 items-center justify-center px-2">
                <button
                  type="button"
                  onClick={() => deleteRow(r)}
                  title="Delete row"
                  className={`transition-opacity group-hover/row:opacity-100 ${active ? 'text-red-600 opacity-100' : 'text-neutral-500 opacity-0 hover:text-red-600'}`}
                >
                  <CloseIcon size={20} />
                </button>
              </div>
            </div>
          )
        })}

        {/* footer row: add row + delete columns */}
        <div className="group/foot flex h-10 items-center border-b border-line">
          <div className="flex w-10 shrink-0 items-center justify-center px-2">
            {rows.length - 1 < MAX_DATA_ROWS && (
              <button type="button" onClick={addRow} title="Add row" className="text-neutral-600 hover:text-navy">
                <AddIcon size={20} />
              </button>
            )}
          </div>
          {rows[0]?.map((_, c) => (
            <div key={c} className="flex min-w-0 flex-1 items-center justify-center px-2">
              {columnCount > 1 && (
                <button
                  type="button"
                  onClick={() => deleteColumn(c)}
                  title="Delete column"
                  className="text-neutral-500 opacity-0 transition-opacity hover:text-red-600 group-hover/foot:opacity-100"
                >
                  <CloseIcon size={20} />
                </button>
              )}
            </div>
          ))}
          <div className="w-10 shrink-0 px-2" />
        </div>
      </div>
    </div>
  )
}
