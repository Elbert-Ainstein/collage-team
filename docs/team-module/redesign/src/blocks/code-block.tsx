import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { CodeData } from '../types'
import type { BlockProps } from './shared'

const CheckIcon = mIcon('check')
const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')
const ContentCopyIcon = mIcon('content_copy')

/** Language menu order from the Figma "Code language" component (3202:816). */
const LANGUAGES = ['python', 'typescript', 'c', 'c++', 'markdown', 'ruby', 'php'] as const

const KEYWORDS =
  /\b(def|if|elif|else|return|print|for|while|in|import|from|class|const|let|var|function|export|interface|type|new|async|await|end|do|puts|echo|foreach|public|private|void|int|float|str|bool|None|True|False|null|undefined|true|false)\b/g

interface Token {
  text: string
  color: string
}

/** Tiny regex highlighter matching the Figma syntax palette. */
function highlightLine(line: string): Token[] {
  const commentMatch = line.match(/^(\s*)(#.*|\/\/.*)$/)
  if (commentMatch) return [{ text: line, color: '#64748b' }]

  const tokens: Token[] = []
  // strings first, then keywords/numbers in the remainder
  const stringRe = /("""[\s\S]*?"""|"[^"]*"|'[^']*')/g
  let last = 0
  let match = stringRe.exec(line)
  const pushPlain = (segment: string): void => {
    let cursor = 0
    const combined = new RegExp(`${KEYWORDS.source}|\\b\\d+(?:\\.\\d+)?\\b`, 'g')
    let m = combined.exec(segment)
    while (m) {
      if (m.index > cursor) tokens.push({ text: segment.slice(cursor, m.index), color: '#e2e8f0' })
      tokens.push({ text: m[0], color: /^\d/.test(m[0]) ? '#fde68a' : '#7dd3fc' })
      cursor = m.index + m[0].length
      m = combined.exec(segment)
    }
    if (cursor < segment.length) tokens.push({ text: segment.slice(cursor), color: '#e2e8f0' })
  }
  while (match) {
    if (match.index > last) pushPlain(line.slice(last, match.index))
    tokens.push({ text: match[0], color: '#a5f3fc' })
    last = match.index + match[0].length
    match = stringRe.exec(line)
  }
  if (last < line.length) pushPlain(line.slice(last))
  return tokens
}

export function CodeBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<CodeData>): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editingCode, setEditingCode] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const editing = viewMode === 'edit'

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const copy = (): void => {
    void navigator.clipboard.writeText(data.code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const languageLabel = data.language.charAt(0).toUpperCase() + data.language.slice(1)
  const lines = data.code === '' ? [] : data.code.split('\n')

  return (
    <div className="overflow-hidden rounded-[14px] border border-navy-deep shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
      {/* header bar */}
      <div className="flex items-center justify-between bg-navy-deep px-4 py-2.5">
        <div className="relative" ref={menuRef}>
          {editing ? (
            <button
              type="button"
              className="flex items-center gap-2 text-sm leading-5 text-cream"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {languageLabel}
              <KeyboardArrowDownIcon size={20} />
            </button>
          ) : (
            <span className="text-sm leading-5 text-cream">{languageLabel}</span>
          )}
          {menuOpen && (
            <div className="absolute left-0 top-7 z-20 w-28 rounded-lg border border-[#898887] bg-navy-deep p-1 shadow-xs">
              {LANGUAGES.map((lang, i) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => {
                    onChange({ ...data, language: lang })
                    setMenuOpen(false)
                  }}
                  className={`block w-full px-2 py-1 text-left text-sm leading-5 text-cream hover:bg-navy ${i < LANGUAGES.length - 1 ? 'border-b border-navy' : ''}`}
                >
                  {lang.charAt(0).toUpperCase() + lang.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex items-center gap-1.5 rounded-md border border-[#898887] px-2.5 py-1 text-sm font-medium text-cream hover:bg-navy"
          >
            {copied ? <CheckIcon size={16} /> : <ContentCopyIcon size={16} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* body */}
      {status === 'generation-failed' ? (
        <div className="flex flex-col items-start gap-2 bg-navy px-8 py-6">
          <p className="text-sm font-medium text-cream">Something went wrong</p>
          <p className="text-sm leading-5 text-cream/60">
            We couldn&apos;t generate your code block. Please try again.
          </p>
          <button
            type="button"
            onClick={(e) => onGenerate(e.shiftKey)}
            className="mt-2 h-8 rounded-lg bg-cream px-4 text-sm font-medium text-navy hover:bg-cream-400"
          >
            Generate Again
          </button>
        </div>
      ) : status === 'generating' ? (
        <div className="flex h-[200px] flex-col justify-center gap-6 bg-navy p-8">
          <div className="flex flex-col gap-3">
            <div className="h-3 w-[70%] animate-pulse rounded-md bg-[#6b7280]" />
            <div className="h-3 w-[50%] animate-pulse rounded-md bg-[#6b7280]" />
            <div className="h-3 w-[80%] animate-pulse rounded-md bg-[#6b7280]" />
          </div>
          <p className="text-sm leading-5 text-cream/60">Generating code...</p>
        </div>
      ) : editing && (editingCode || lines.length === 0) ? (
        <textarea
          autoFocus={editingCode}
          value={data.code}
          placeholder="# Write or generate code…"
          spellCheck={false}
          onChange={(e) => onChange({ ...data, code: e.target.value })}
          onBlur={() => setEditingCode(false)}
          rows={Math.max(6, lines.length + 1)}
          className="block w-full resize-y bg-navy py-3.5 pl-[55px] pr-4 font-mono text-[13px] leading-[21.45px] text-[#e2e8f0] outline-none placeholder:text-cream/40"
        />
      ) : (
        <div
          className={`bg-navy py-3.5 ${editing ? 'cursor-text' : ''}`}
          onClick={editing ? () => setEditingCode(true) : undefined}
          title={editing ? 'Click to edit code' : undefined}
        >
          <pre className="overflow-x-auto font-mono text-[13px] leading-[21.45px]">
            {lines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-[41.5px] shrink-0 select-none pr-3.5 text-right text-[#334155]">
                  {i + 1}
                </span>
                <span className="whitespace-pre">
                  {highlightLine(line).map((token, j) => (
                    <span key={j} style={{ color: token.color }}>
                      {token.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}
