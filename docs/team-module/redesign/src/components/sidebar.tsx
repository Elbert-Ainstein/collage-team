import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { mIcon } from './m-icon'
import type { MIconComponent } from './m-icon'

/* Material Symbols icons, matching the Figma sidebar components */
const BiotechIcon = mIcon('biotech')
const BotIcon = mIcon('smart_toy')
const CodeIcon = mIcon('code')
const LibraryIcon = mIcon('local_library')
const AssignmentIcon = mIcon('assignment')
const ArrowUpIcon = mIcon('keyboard_arrow_up')
const ArrowDownIcon = mIcon('keyboard_arrow_down')
const ArrowRightIcon = mIcon('keyboard_arrow_right')
const UnfoldIcon = mIcon('unfold_more')
const ViewSidebarIcon = mIcon('view_sidebar')
const DragIcon = mIcon('drag_indicator')
const AddIcon = mIcon('add')
const DeleteIcon = mIcon('delete')
const LightModeIcon = mIcon('light_mode')
const DarkModeIcon = mIcon('dark_mode')
const AddCircleIcon = mIcon('add_circle')
const AnalyticsIcon = mIcon('analytics')
const LibraryBooksIcon = mIcon('library_books')

/** Primary nav shown while the Universal Wizard is open (Create is active). */
const WIZARD_NAV: ReadonlyArray<{ icon: MIconComponent; label: string; active?: boolean }> = [
  { icon: AddCircleIcon, label: 'Create', active: true },
  { icon: AnalyticsIcon, label: 'Analytics' },
  { icon: BotIcon, label: 'AI tutor' },
  { icon: LibraryBooksIcon, label: 'Library' },
]

/** One row of the lesson outline shown in the Blocks section. */
export interface OutlineItem {
  id: string
  label: string
  icon: MIconComponent
}

interface SidebarProps {
  outline: OutlineItem[]
  onBlockClick: (id: string) => void
  /** Open the slash menu at the end of the canvas ("+" on the Blocks header). */
  onAddBlock: () => void
  /** Delete a block from the lesson via its outline row. */
  onBlockDelete: (id: string) => void
  /** Move a block so it sits before another block (drag reorder in the outline). */
  onBlockMove: (dragId: string, beforeId: string) => void
  /** Show the wizard's primary nav (Create/Analytics/AI tutor/Library) instead of the lesson tree. */
  wizardNav?: boolean
  /** Dashboard shell: light palette sitting directly on the page background (no panel of its own). */
  onCanvas?: boolean
}

function RailButton({ icon: Icon, active, onClick, title }: { icon: MIconComponent; active?: boolean; onClick?: () => void; title?: string }): ReactElement {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/90 transition-colors hover:bg-sidebar-foreground/10 ${active ? 'bg-sidebar-foreground/15' : ''}`}
    >
      <Icon size={18} />
    </button>
  )
}

/** Collage AI wordmark (logo-color-light recreated in CSS — see README note). */
function CollageLogo(): ReactElement {
  return (
    <span className="select-none font-serif text-[19px] leading-[25px] tracking-tight text-sidebar-foreground">
      Collage
      <span className="font-semibold">
        <span
          className="bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(115deg, #ff8bd2 10%, #c77dff 90%)' }}
        >
          {'Λ'}
        </span>
        <span
          className="bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(115deg, #7db9ff 10%, #38a2ff 90%)' }}
        >
          I
        </span>
      </span>
    </span>
  )
}

/** Small gradient lockup shown in the collapsed icon rail. */
function LogoMark(): ReactElement {
  return (
    <span className="select-none font-serif text-lg font-semibold leading-none">
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: 'linear-gradient(115deg, #ff8bd2 10%, #c77dff 90%)' }}
      >
        {'Λ'}
      </span>
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: 'linear-gradient(115deg, #7db9ff 10%, #38a2ff 90%)' }}
      >
        I
      </span>
    </span>
  )
}

/**
 * Left navigation with the three Figma states (node 3106:423):
 * - Open: the courses/blocks panel on its own
 * - course view: the icon rail alongside the panel (opened from "My courses")
 * - Closed: the icon rail on its own; hovering the logo mark reveals the
 *   view-sidebar icon to expand it back
 */
export function Sidebar({ outline, onBlockClick, onAddBlock, onBlockDelete, onBlockMove, wizardNav = false, onCanvas = false }: SidebarProps): ReactElement {
  interface Concept {
    id: string
    name: string
    open: boolean
    exercises: string[]
  }
  const [concepts, setConcepts] = useState<Concept[]>([
    {
      id: 'c1',
      name: 'Matter, Energy and M.',
      open: true,
      exercises: ['Classifying Sample f..', 'Boiling Point of Met..'],
    },
    { id: 'c2', name: 'Atomic Structure and .', open: false, exercises: [] },
  ])
  const addConcept = (): void =>
    setConcepts((prev) => [
      ...prev,
      { id: `c${Date.now()}`, name: `New Concept ${prev.length + 1}`, open: true, exercises: [] },
    ])
  const addExercise = (conceptId: string): void =>
    setConcepts((prev) =>
      prev.map((c) =>
        c.id === conceptId
          ? { ...c, open: true, exercises: [...c.exercises, `New Exercise ${c.exercises.length + 1}`] }
          : c,
      ),
    )

  const [light, setLight] = useState(onCanvas)
  const [panelOpen, setPanelOpen] = useState(true)
  const [railOpen, setRailOpen] = useState(false)
  const dragOutlineId = useRef<string | null>(null)

  // Blocks section height: null = fill (touch the last exercise); a number
  // once the user drags the divider, resizable up and down between the limits.
  const [blocksHeight, setBlocksHeight] = useState<number | null>(null)
  const blocksRef = useRef<HTMLDivElement>(null)
  const resize = useRef<{ startY: number; startH: number } | null>(null)

  const onDividerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    resize.current = { startY: e.clientY, startH: blocksRef.current?.offsetHeight ?? 240 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onDividerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resize.current) return
    // dragging up grows the Blocks section, down shrinks it
    const next = resize.current.startH + (resize.current.startY - e.clientY)
    const panelH = blocksRef.current?.closest('.w-56')?.clientHeight ?? 800
    // leave room for the header, a bit of tree, and the footer
    setBlocksHeight(Math.max(120, Math.min(Math.round(panelH - 220), next)))
  }, [])

  // the sidebar toggle collapses the panel to the rail, and expands it back
  const toggleSidebar = useCallback(() => {
    setPanelOpen((open) => {
      const next = !open
      setRailOpen(!next) // collapsed → rail shows; expanded → rail hides
      return next
    })
  }, [])

  const railVisible = railOpen || !panelOpen

  return (
    <div className={`flex h-full shrink-0 ${light ? 'sidebar-light' : ''} ${onCanvas && light ? 'sidebar-on-canvas' : ''}`}>
      {/* icon rail — shown in course view and closed states */}
      {railVisible && (
        <div className="flex w-12 flex-col items-center gap-1 border-r border-sidebar-border bg-sidebar p-2">
          {panelOpen ? (
            <div className="mb-2 flex h-8 w-8 items-center justify-center">
              <LogoMark />
            </div>
          ) : (
            /* collapsed: hovering the logo reveals the expand affordance */
            <button
              type="button"
              onClick={toggleSidebar}
              title="Open sidebar"
              className="group/logo mb-2 flex h-8 w-8 items-center justify-center rounded-lg hover:bg-sidebar-foreground/10"
            >
              <span className="group-hover/logo:hidden">
                <LogoMark />
              </span>
              <span className="hidden text-sidebar-foreground/90 group-hover/logo:inline-flex">
                <ViewSidebarIcon size={20} />
              </span>
            </button>
          )}
          <RailButton icon={BiotechIcon} active title="Science" />
          <RailButton icon={BotIcon} title="AI codesigner" />
          <RailButton icon={CodeIcon} title="Developer" />
          <div className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple text-sm font-semibold text-navy">
            D
          </div>
        </div>
      )}

      {/* courses / blocks panel — Open + course view states */}
      {panelOpen && (
        <div className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">
          <div className="flex items-center gap-2 p-4 pb-2">
            <div className="min-w-0 flex-1">
              <CollageLogo />
            </div>
            <button
              type="button"
              onClick={() => setLight((v) => !v)}
              title={light ? 'Switch to dark sidebar' : 'Switch to light sidebar'}
              className="text-sidebar-foreground/80 hover:text-sidebar-foreground"
            >
              {light ? <DarkModeIcon size={20} /> : <LightModeIcon size={20} />}
            </button>
            <button type="button" onClick={toggleSidebar} title="Collapse sidebar" className="text-sidebar-foreground/80 hover:text-sidebar-foreground">
              <ViewSidebarIcon size={22} />
            </button>
          </div>

          {wizardNav && (
            <nav className="flex flex-col gap-1 p-2">
              {WIZARD_NAV.map(({ icon: Icon, label, active }) => (
                <button
                  key={label}
                  type="button"
                  className={`flex h-8 w-full items-center gap-2 rounded-lg p-2 text-sm text-sidebar-foreground ${active ? 'bg-sidebar-foreground/15 font-medium' : 'hover:bg-sidebar-foreground/10'}`}
                >
                  <Icon size={16} />
                  <span className="min-w-0 flex-1 truncate text-left">{label}</span>
                </button>
              ))}
            </nav>
          )}

          {!wizardNav && (
          <div className={`flex flex-col p-2 ${blocksHeight === null ? 'shrink-0' : 'sidebar-scroll min-h-0 flex-1 overflow-y-auto'}`}>
            <div className="group/course flex h-8 items-center px-2 text-sm text-sidebar-foreground/70">
              <span className="min-w-0 flex-1 truncate">States of Matter</span>
              <button
                type="button"
                title="Add concept"
                onClick={addConcept}
                className="opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/course:opacity-100"
              >
                <AddIcon size={16} />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {concepts.map((concept, ci) => (
                <div key={concept.id}>
                  <div
                    className={`group/concept flex h-8 w-full items-center gap-2 rounded-lg p-2 text-sm text-sidebar-foreground ${ci === 0 ? 'bg-sidebar-foreground/15 font-medium' : 'hover:bg-sidebar-foreground/10'}`}
                  >
                    <LibraryIcon size={16} />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() =>
                        setConcepts((prev) => prev.map((c) => (c.id === concept.id ? { ...c, open: !c.open } : c)))
                      }
                    >
                      {concept.name}
                    </button>
                    <button
                      type="button"
                      title="Add exercise"
                      onClick={() => addExercise(concept.id)}
                      className="opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/concept:opacity-100"
                    >
                      <AddIcon size={16} />
                    </button>
                    {concept.open ? <ArrowUpIcon size={16} /> : <ArrowDownIcon size={16} />}
                  </div>
                  {concept.open && concept.exercises.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1 pl-4">
                      {concept.exercises.map((exercise, ei) => (
                        <button
                          key={ei}
                          type="button"
                          className={`flex h-7 w-full items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground hover:bg-sidebar-foreground/10 ${ci === 0 && ei === 0 ? 'bg-sidebar-foreground/15' : ''}`}
                        >
                          <AssignmentIcon size={16} />
                          <span className="min-w-0 flex-1 truncate text-left">{exercise}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )}

          {/* Blocks section: fills by default, drag the handle to resize up/down */}
          {!wizardNav && (
          <div
            ref={blocksRef}
            className={`flex flex-col ${blocksHeight === null ? 'min-h-0 flex-1' : 'shrink-0'}`}
            style={blocksHeight === null ? undefined : { height: blocksHeight }}
          >
            <div
              className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center border-t border-navy-deep"
              title="Drag to resize"
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={() => {
                resize.current = null
              }}
            >
              <div className="h-[3px] w-9 rounded-full bg-muted/30 transition-colors group-hover:bg-muted/70" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
              <div className="group/blocks flex h-8 shrink-0 items-center gap-1 px-2 text-xs text-sidebar-foreground/70">
                <span className="min-w-0 flex-1">Blocks</span>
                <button
                  type="button"
                  title="Add a block (opens the slash menu)"
                  onClick={onAddBlock}
                  className="opacity-0 transition-opacity hover:text-sidebar-foreground group-hover/blocks:opacity-100"
                >
                  <AddIcon size={16} />
                </button>
              </div>
              {(
                <div className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                  {outline.length === 0 ? (
                    <p className="px-2 py-1 text-xs leading-4 text-sidebar-foreground/50">
                      No blocks yet — type / in the lesson to add one.
                    </p>
                  ) : (
                    outline.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={() => {
                          dragOutlineId.current = item.id
                        }}
                        onDragEnd={() => {
                          dragOutlineId.current = null
                        }}
                        onDragOver={(e) => {
                          if (dragOutlineId.current && dragOutlineId.current !== item.id) e.preventDefault()
                        }}
                        onDrop={() => {
                          if (dragOutlineId.current && dragOutlineId.current !== item.id) {
                            onBlockMove(dragOutlineId.current, item.id)
                          }
                          dragOutlineId.current = null
                        }}
                        className="group/outline flex h-8 w-full shrink-0 cursor-grab items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground hover:bg-sidebar-foreground/10"
                      >
                        <DragIcon size={16} className="opacity-0 transition-opacity group-hover/outline:opacity-60" />
                        <button
                          type="button"
                          onClick={() => onBlockClick(item.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title={`Jump to ${item.label}`}
                        >
                          <item.icon size={16} />
                          <span className="truncate">{item.label}</span>
                        </button>
                        <button
                          type="button"
                          title="Delete block"
                          onClick={() => onBlockDelete(item.id)}
                          className="opacity-0 transition-opacity group-hover/outline:opacity-100"
                        >
                          <DeleteIcon size={14} className="text-sidebar-foreground/70 hover:text-red-400" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-navy-deep p-2">
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                title={railOpen ? 'Close course switcher' : 'Show course switcher'}
                className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
              >
                <span className="flex-1 text-left">My courses</span>
                <ArrowRightIcon size={16} className={`transition-transform ${railOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className="flex items-center gap-2 p-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-purple text-sm font-semibold text-navy">
                  D
                </div>
                <div className="min-w-0 flex-1 text-sidebar-foreground">
                  <p className="truncate text-sm font-semibold leading-5">Devanshu</p>
                  <p className="truncate text-xs leading-4">devanshu@collage-ai.com</p>
                </div>
                <UnfoldIcon size={16} className="text-sidebar-foreground" />
              </div>
          </div>
        </div>
      )}
    </div>
  )
}
