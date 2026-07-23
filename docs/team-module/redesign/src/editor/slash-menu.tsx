import { useEffect, useMemo, useRef } from 'react'
import type { ReactElement } from 'react'
import { GROUP_LABELS, SLASH_MENU_ENTRIES } from '../constants/block-registry'
import type { SlashMenuEntry } from '../constants/block-registry'
import { BLOCK_GROUPS } from '../types'

/** Strict-prefix filter per PRD §1.2 — "C" matches only titles starting with "C". */
export function filterSlashEntries(query: string): SlashMenuEntry[] {
  const q = query.toLowerCase()
  return SLASH_MENU_ENTRIES.filter((e) => e.label.toLowerCase().startsWith(q))
}

interface SlashMenuProps {
  /** Viewport coordinates of the caret the menu anchors to. */
  anchor: { x: number; y: number }
  query: string
  activeIndex: number
  onSelect: (entry: SlashMenuEntry) => void
  onHover: (index: number) => void
}

/** The slash command menu ("Slash Dialog Box", Figma node 3291:733). */
export function SlashMenu({ anchor, query, activeIndex, onSelect, onHover }: SlashMenuProps): ReactElement {
  const entries = useMemo(() => filterSlashEntries(query), [query])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // keep the menu on-screen: flip above the caret if there is no room below
  const maxHeight = 384
  const openUp = anchor.y + 24 + maxHeight > window.innerHeight && anchor.y > maxHeight

  return (
    <div
      ref={listRef}
      data-testid="slash-menu"
      className="fixed z-50 flex w-[237px] flex-col gap-1 overflow-y-auto rounded-lg border border-line bg-cream-100 px-2 py-3 shadow-2xs"
      style={{
        left: Math.min(anchor.x, window.innerWidth - 247),
        ...(openUp ? { bottom: window.innerHeight - anchor.y + 4 } : { top: anchor.y + 24 }),
        maxHeight,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {entries.length === 0 ? (
        <div className="px-2 py-1.5 text-sm text-muted-fg">Couldn&apos;t find anything…</div>
      ) : (
        BLOCK_GROUPS.map((group) => {
          const groupEntries = entries.filter((e) => e.group === group)
          if (groupEntries.length === 0) return null
          return (
            <div key={group} className="flex flex-col gap-1">
              <div className="border-b border-line pb-1 pt-[3px] text-sm font-medium leading-5 text-muted-fg">
                {GROUP_LABELS[group]}
              </div>
              {groupEntries.map((entry) => {
                const index = entries.indexOf(entry)
                const active = index === activeIndex
                return (
                  <button
                    key={entry.id}
                    type="button"
                    data-active={active}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg p-2 text-left text-sm leading-5 text-secondary-fg ${active ? 'bg-cream-400' : ''}`}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onSelect(entry)}
                  >
                    <entry.icon size={16} strokeWidth={1.75} className="shrink-0 text-black/80" />
                    <span className="truncate">{entry.label}</span>
                  </button>
                )
              })}
            </div>
          )
        })
      )}
    </div>
  )
}
