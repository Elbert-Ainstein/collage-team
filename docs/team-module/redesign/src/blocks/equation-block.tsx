import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import katex from 'katex'
import { mIcon } from '../components/m-icon'
import { MathKeyboardCard } from '../components/math-keyboard'
import type { EquationData } from '../types'
import { Error404Card, ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const ErrorIcon = mIcon('error')

function renderLatex(latex: string): { html: string; ok: boolean } {
  try {
    return { html: katex.renderToString(latex, { throwOnError: true, displayMode: true }), ok: true }
  } catch {
    return { html: '', ok: false }
  }
}

export function EquationBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<EquationData>): ReactElement {
  const [keyboardOpen, setKeyboardOpen] = useState(status === 'empty')
  const [emptyError, setEmptyError] = useState(false)
  const editing = viewMode === 'edit'

  const rendered = useMemo(() => renderLatex(data.latex), [data.latex])

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />
  if (data.latex === '' && !editing) return <Error404Card />

  const press = (key: string): void => {
    // LaTeX commands need a trailing space so the next token doesn't fuse
    const insert = key.startsWith('\\') ? `${key} ` : key
    onChange({ ...data, latex: data.latex + insert })
    setEmptyError(false)
  }

  const backspace = (): void => {
    // remove a whole trailing command, otherwise a single character
    const trimmed = data.latex.trimEnd()
    const next = /\\[a-zA-Z]+(\{[^}]*\})*$/.test(trimmed)
      ? trimmed.replace(/\\[a-zA-Z]+(\{[^}]*\})*$/, '')
      : trimmed.slice(0, -1)
    onChange({ ...data, latex: next })
  }

  const done = (): void => {
    if (data.latex.trim() === '') {
      setEmptyError(true)
      return
    }
    setKeyboardOpen(false)
  }

  return (
    <div
      className={`flex flex-col items-center gap-4 rounded-lg bg-cream-300 p-4 ${editing ? 'transition-shadow focus-within:shadow-md' : ''}`}
    >
      {/* equation display — you type directly into the serif line (Figma 3620:1349) */}
      {editing && keyboardOpen ? (
        <div className="flex w-full flex-col items-center gap-1">
          <input
            value={data.latex}
            placeholder="Add an equation"
            autoFocus
            onChange={(e) => {
              onChange({ ...data, latex: e.target.value })
              setEmptyError(false)
            }}
            className="w-full bg-transparent text-center font-serif text-4xl leading-10 text-muted-fg outline-none placeholder:text-[#57534e]"
          />
          {emptyError && (
            <p className="flex items-center gap-1.5 text-center text-sm text-red-600">
              <ErrorIcon size={16} /> Please enter an equation before done
            </p>
          )}
        </div>
      ) : rendered.ok && data.latex !== '' ? (
        <button
          type="button"
          disabled={!editing}
          onClick={() => setKeyboardOpen(true)}
          title={editing ? 'Click to edit equation' : undefined}
          className={`font-serif text-4xl leading-10 text-black/60 ${editing ? 'cursor-text' : 'cursor-default'}`}
          dangerouslySetInnerHTML={{ __html: rendered.html }}
        />
      ) : (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-neutral-950">{data.latex}</p>
          <p className="flex items-center gap-1.5 text-sm text-red-600">
            <ErrorIcon size={16} /> Equation rendering failed , showing raw syntax
          </p>
          {editing && (
            <button type="button" onClick={() => setKeyboardOpen(true)} className="text-xs text-navy underline">
              Edit equation
            </button>
          )}
        </div>
      )}

      {/* math keyboard */}
      {editing && keyboardOpen && (
        <MathKeyboardCard
          onKey={(k) => press(k.tex)}
          onBackspace={backspace}
          onDone={done}
          onClose={() => setKeyboardOpen(false)}
        />
      )}

      {/* explanation */}
      {editing ? (
        <input
          value={data.explanation}
          placeholder="Equation explanation (optional)"
          onChange={(e) => onChange({ ...data, explanation: e.target.value })}
          className="w-full truncate bg-transparent text-sm leading-5 text-black/70 outline-none placeholder:text-muted-fg"
        />
      ) : (
        data.explanation && <p className="w-full truncate text-sm leading-5 text-black/70">{data.explanation}</p>
      )}
    </div>
  )
}
