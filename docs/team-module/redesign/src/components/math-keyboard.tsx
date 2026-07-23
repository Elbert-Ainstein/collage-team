import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import katex from 'katex'
import { mIcon } from './m-icon'

const BackspaceIcon = mIcon('backspace')
const CloseIcon = mIcon('close')

export const KEYBOARD_TABS = ['123', 'fx', 'αβγ', '<='] as const
export type KeyboardTab = (typeof KEYBOARD_TABS)[number]

/**
 * A key carries both forms: `tex` for LaTeX-native fields (the equation block,
 * rendered with KaTeX) and `uni` — the real Unicode symbol — for plain text
 * fields so they show β / ≤ / × rather than the raw \commands.
 */
export interface MKey {
  tex: string
  uni: string
}
const K = (tex: string, uni: string): MKey => ({ tex, uni })

/** Key layouts; the 123 tab layout is exact from Figma (3617:9661). */
export const KEY_ROWS: Record<KeyboardTab, MKey[][]> = {
  '123': [
    [K('7', '7'), K('8', '8'), K('9', '9'), K('/', '/')],
    [K('4', '4'), K('5', '5'), K('6', '6'), K('\\times', '×')],
    [K('1', '1'), K('2', '2'), K('3', '3'), K('-', '−')],
    [K('0', '0'), K('.', '.'), K('=', '='), K('+', '+')],
  ],
  fx: [
    [K('\\frac{a}{b}', '/'), K('\\sqrt{x}', '√'), K('x^2', '²'), K('x_n', 'ₙ')],
    [K('\\sum', '∑'), K('\\int', '∫'), K('\\lim', 'lim'), K('\\log', 'log')],
    [K('\\sin', 'sin'), K('\\cos', 'cos'), K('\\tan', 'tan'), K('\\infty', '∞')],
  ],
  'αβγ': [
    [K('\\alpha', 'α'), K('\\beta', 'β'), K('\\gamma', 'γ'), K('\\delta', 'δ')],
    [K('\\theta', 'θ'), K('\\lambda', 'λ'), K('\\mu', 'μ'), K('\\pi', 'π')],
    [K('\\sigma', 'σ'), K('\\phi', 'φ'), K('\\omega', 'ω'), K('\\Delta', 'Δ')],
  ],
  '<=': [
    [K('<', '<'), K('>', '>'), K('\\leq', '≤'), K('\\geq', '≥')],
    [K('=', '='), K('\\neq', '≠'), K('\\approx', '≈'), K('\\pm', '±')],
    [K('\\times', '×'), K('\\div', '÷'), K('\\cdot', '·'), K('\\rightarrow', '→')],
  ],
}

function KeyCap({ k, onPress }: { k: MKey; onPress: (k: MKey) => void }): ReactElement {
  const isLatex = k.tex.includes('\\') || k.tex.includes('^') || k.tex.includes('_')
  const rendered = useMemo(() => {
    if (!isLatex) return null
    try {
      return katex.renderToString(k.tex, { throwOnError: false })
    } catch {
      return null
    }
  }, [isLatex, k.tex])
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPress(k)}
      className="flex h-8 flex-1 items-center justify-center rounded-lg border border-line bg-page px-3 py-1 text-sm leading-5 text-muted-fg shadow-xs hover:bg-cream-400"
    >
      {rendered ? <span dangerouslySetInnerHTML={{ __html: rendered }} /> : k.uni}
    </button>
  )
}

interface MathKeyboardCardProps {
  onKey: (key: MKey) => void
  onBackspace: () => void
  onDone: () => void
  onClose: () => void
  className?: string
}

/** The math keyboard card (Figma Equation Keyboard, 3617:9661). */
export function MathKeyboardCard({ onKey, onBackspace, onDone, onClose, className = '' }: MathKeyboardCardProps): ReactElement {
  const [tab, setTab] = useState<KeyboardTab>('123')
  return (
    <div className={`w-full max-w-[541px] rounded-lg border border-line bg-cream-300 shadow-md ${className}`}>
      <div className="flex items-center justify-between rounded-t-lg border-b border-line bg-cream-100 px-2 py-2.5">
        <p className="text-sm leading-5 text-muted-fg">
          Type, or tap a symbol — names like &quot;pi&quot; autocomplete
        </p>
        <button type="button" onClick={onClose} title="Close keyboard">
          <CloseIcon size={20} className="text-neutral-600" />
        </button>
      </div>
      <div className="flex px-2 pt-1">
        {KEYBOARD_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTab(t)}
            className={`h-[37px] w-20 text-center text-sm ${tab === t ? 'border-b-2 border-navy-deep font-medium text-neutral-950' : 'text-neutral-950'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-2">
        {KEY_ROWS[tab].map((row, ri) => (
          <div key={ri} className="flex gap-2">
            {row.map((k) => (
              <KeyCap key={k.uni} k={k} onPress={onKey} />
            ))}
          </div>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onBackspace}
            title="Backspace"
            className="flex h-8 w-20 items-center justify-center rounded-lg border border-line bg-page shadow-xs hover:bg-cream-400"
          >
            <BackspaceIcon size={16} className="text-muted-fg" />
          </button>
          <button
            type="button"
            onClick={onDone}
            className="h-8 flex-1 rounded-lg bg-navy-deep/90 px-4 text-sm font-medium text-cream shadow-xs hover:bg-navy-deep"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------- global keyboard store ------------------------- */

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement
function isEditable(el: Element | null): el is Editable {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

let openState = false
let lastField: Editable | null = null
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

// remember the most recent editable field so keys still target it after the
// user clicks a keyboard button or the Σ toggle (which steal focus)
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', () => {
    if (isEditable(document.activeElement)) lastField = document.activeElement as Editable
  })
}

/** Toggle the app-wide math keyboard from anywhere (top bar Σ, block chip). */
export function toggleMathKeyboard(): void {
  openState = !openState
  emit()
}

export function closeMathKeyboard(): void {
  openState = false
  emit()
}

/** Subscribe a component to the keyboard's open state. */
export function useMathKeyboardOpen(): boolean {
  const [, force] = useState(0)
  useEffect(() => {
    const l = (): void => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return openState
}

/** The doc-node id the keyboard should dock under (the focused text/block). */
export function focusedFieldNodeId(): string | null {
  const el = isEditable(document.activeElement) ? document.activeElement : lastField
  return el?.closest?.('[data-doc-node]')?.getAttribute('data-doc-node') ?? null
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function activeField(): Editable | null {
  if (isEditable(document.activeElement)) return document.activeElement as Editable
  if (lastField && lastField.isConnected) return lastField
  return null
}

/** Insert literal text (a Unicode symbol) at the caret of the focused field. */
export function insertToken(text: string): void {
  const el = activeField()
  if (!el) return
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end))
    el.setSelectionRange(start + text.length, start + text.length)
  } else {
    document.execCommand('insertText', false, text)
  }
}

export function backspaceToken(): void {
  const el = activeField()
  if (!el) return
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    if (start === 0 && end === 0) return
    const from = start === end ? start - 1 : start
    setNativeValue(el, el.value.slice(0, from) + el.value.slice(end))
    el.setSelectionRange(from, from)
  } else {
    document.execCommand('delete')
  }
}
