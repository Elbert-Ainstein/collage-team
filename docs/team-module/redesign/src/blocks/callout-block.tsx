import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { MIconComponent } from '../components/m-icon'
import type { CalloutData, CalloutKind } from '../types'
import { AutoTextarea, ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')
const InfoIcon = mIcon('info')
const LightbulbIcon = mIcon('lightbulb')
const WarningAmberIcon = mIcon('warning_amber')
const ReportIcon = mIcon('report')

interface CalloutStyle {
  label: string
  icon: MIconComponent
  bg: string
  fg: string
}

/** Type colorways from the Callout Figma page (3265:988). */
const CALLOUT_STYLES: Record<CalloutKind, CalloutStyle> = {
  info: { label: 'Info', icon: InfoIcon, bg: '#f4faff', fg: '#0382ed' },
  tip: { label: 'Tip', icon: LightbulbIcon, bg: '#f0fdf4', fg: '#15803d' },
  warning: { label: 'Warning', icon: WarningAmberIcon, bg: '#fefce8', fg: '#854d0e' },
  important: { label: 'Important', icon: ReportIcon, bg: '#fef2f2', fg: '#b91c1c' },
}

/** Dropdown order matches the Figma menu (Info, Warning, Tip, Important). */
const DROPDOWN_ORDER: CalloutKind[] = ['info', 'warning', 'tip', 'important']

export function CalloutBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<CalloutData>): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const editing = viewMode === 'edit'
  const style = CALLOUT_STYLES[data.kind]
  const Icon = style.icon

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  if (!editing) {
    return (
      <div
        className="rounded-lg border border-line px-2 py-2 shadow-2xs"
        style={{ backgroundColor: style.bg }}
      >
        <div className="flex flex-col gap-1 px-4 py-1">
          <div className="flex items-center gap-2" style={{ color: style.fg }}>
            <Icon size={22} strokeWidth={1.75} />
            <span className="text-base font-medium leading-6">{style.label}</span>
          </div>
          <p className="text-base leading-5" style={{ color: style.fg }}>
            {data.text}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border border-line px-2 py-2 shadow-2xs transition-shadow focus-within:shadow-md"
      style={{ backgroundColor: style.bg }}
    >
      <div className="flex flex-col gap-2 px-4 py-1">
        <div className="relative flex items-start justify-between" ref={menuRef}>
          {/* switch-callout pill (Figma 3202:720) */}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-[152px] items-center justify-between rounded-lg border border-line bg-white/70 py-2 pl-1.5 pr-1.5"
          >
            <span className="flex items-center gap-2">
              <Icon size={24} strokeWidth={1.75} style={{ color: style.fg }} />
              <span className="text-base font-medium leading-6 text-muted-fg">{style.label}</span>
            </span>
            <KeyboardArrowDownIcon size={20} className="text-muted-fg" />
          </button>


          {menuOpen && (
            <div className="absolute left-0 top-[54px] z-20 w-[152px] rounded-lg border border-line bg-page p-1 shadow-xs">
              {DROPDOWN_ORDER.map((kind, i) => {
                const item = CALLOUT_STYLES[kind]
                const ItemIcon = item.icon
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      onChange({ ...data, kind })
                      setMenuOpen(false)
                    }}
                    className={`flex w-full items-center gap-2.5 p-2 text-left hover:bg-cream-300 ${i < DROPDOWN_ORDER.length - 1 ? 'border-b border-line' : ''}`}
                  >
                    <ItemIcon size={24} strokeWidth={1.75} style={{ color: item.fg }} />
                    <span className="text-base font-medium leading-6 text-muted-fg">{item.label}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <AutoTextarea
          value={data.text}
          placeholder="Write Callout here"
          onChange={(text) => onChange({ ...data, text })}
          className="text-base font-medium leading-6"
          style={{ color: style.fg }}
        />
      </div>
    </div>
  )
}

export { CALLOUT_STYLES }
