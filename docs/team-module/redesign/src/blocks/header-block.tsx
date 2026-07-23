import { useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { HeaderData } from '../types'
import type { BlockProps } from './shared'

const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')

/**
 * Header Block — chrome-less serif title row with an optional collapsible
 * Learning Objectives card (Figma page 3265:975).
 */
export function HeaderBlock({ data, viewMode, onChange, onExitDown }: BlockProps<HeaderData>): ReactElement {
  const [loOpen, setLoOpen] = useState(false)
  const editing = viewMode === 'edit'
  const objectives = data.learningObjective
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <div className="flex flex-col gap-2.5 py-1">
      <div className="flex items-center gap-2">
        {editing ? (
          <input
            value={data.text}
            placeholder="Header"
            onChange={(e) => onChange({ ...data, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onExitDown?.()
              }
            }}
            className="min-w-0 flex-1 bg-transparent font-serif text-3xl font-semibold leading-9 text-black/80 outline-none placeholder:text-black/30"
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-serif text-3xl font-semibold leading-9 text-black/80">
            {data.text || 'Untitled'}
          </h2>
        )}
      </div>

      {objectives.length > 0 && (
        <div className="rounded-lg border border-line bg-page px-3 py-2 shadow-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between"
            onClick={() => setLoOpen((v) => !v)}
          >
            <span className="text-base font-semibold leading-6 text-black/80">
              Learning Objectives <span className="text-muted-fg">({objectives.length})</span>
            </span>
            <KeyboardArrowDownIcon size={16} className={`transition-transform ${loOpen ? 'rotate-180' : ''}`} />
          </button>
          {loOpen && (
            <ul className="mt-4 flex flex-col gap-2 pb-1">
              {objectives.map((objective, i) => (
                <li key={i} className="truncate text-sm leading-5 text-black/80">
                  {objective}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
