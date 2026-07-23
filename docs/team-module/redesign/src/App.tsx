import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from './components/m-icon'
import { toggleMathKeyboard } from './components/math-keyboard'
import { Sidebar } from './components/sidebar'
import type { OutlineItem } from './components/sidebar'
import { DocumentEditor } from './editor/document-editor'
import type { EditorApi } from './editor/document-editor'
import { buildDemoDoc } from './editor/demo-doc'
import { useDocState } from './editor/use-doc-state'
import { GalleryView } from './gallery/gallery'
import { WizardView } from './wizard/wizard'
import { DashboardView } from './dashboard/dashboard'
import { DASH_SHELL, DASHBOARD_LANDING, FLOATING } from './theme'
import { SLASH_MENU_ENTRIES } from './constants/block-registry'
import type { QuestionData, ViewMode } from './types'

const CheckIcon = mIcon('check')
const CloudUploadIcon = mIcon('cloud_upload')
const EditIcon = mIcon('edit')
const PreviewIcon = mIcon('visibility')
const FunctionsIcon = mIcon('functions')
const PublishIcon = mIcon('publish')
const AutoAwesomeIcon = mIcon('auto_awesome')
const ErrorIcon = mIcon('error')
const ArticleIcon = mIcon('article')

type SaveState = 'saved' | 'saving'

/** Which surface the main canvas is showing. */
type CanvasView = 'lesson' | 'generative' | 'errors'

const CANVAS_VIEWS: { id: CanvasView; label: string; icon: typeof ArticleIcon }[] = [
  { id: 'lesson', label: 'Lesson', icon: ArticleIcon },
  { id: 'generative', label: 'Generative', icon: AutoAwesomeIcon },
  { id: 'errors', label: 'Errors & edge cases', icon: ErrorIcon },
]

const CANVAS_TITLES: Record<CanvasView, string> = {
  lesson: 'Classifying Sample for States of Matter',
  generative: 'Generative designs',
  errors: 'Errors & edge cases',
}

/** The preset "States of Matter" lesson loads by default; `?blank` starts empty. */
const startBlank =
  new URLSearchParams(window.location.search).has('blank') || window.location.hash === '#blank'

/** The Universal Wizard lives on its own route: /wizard (dev) or #wizard (artifact). */
const isWizardLocation = (): boolean =>
  window.location.pathname.replace(/\/$/, '').endsWith('/wizard') || window.location.hash === '#wizard'

/** The dashboard route: /dashboard or #dashboard. */
const isDashboardLocation = (): boolean =>
  window.location.pathname.replace(/\/$/, '').endsWith('/dashboard') || window.location.hash === '#dashboard'

/** The dashboard artifact lands on the dashboard, but only on first load. */
const startOnDashboard = (): boolean =>
  isDashboardLocation() || (DASHBOARD_LANDING && window.location.hash === '' && !isWizardLocation())

export default function App(): ReactElement {
  const doc = useDocState(startBlank ? undefined : buildDemoDoc())
  const [viewMode, setViewMode] = useState<ViewMode>('edit')
  const [canvasView, setCanvasView] = useState<CanvasView>('lesson')
  const [showWizard, setShowWizard] = useState<boolean>(isWizardLocation)
  const [showDashboard, setShowDashboard] = useState<boolean>(startOnDashboard)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const saveTimer = useRef<number | null>(null)
  const editorApi = useRef<EditorApi | null>(null)

  const handleDirty = useCallback(() => {
    setSaveState('saving')
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => setSaveState('saved'), 1200)
  }, [])

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    },
    [],
  )

  /* /wizard and /dashboard routes: react to back/forward and hash edits */
  useEffect(() => {
    const sync = (): void => {
      setShowWizard(isWizardLocation())
      // only explicit routes re-open the dashboard — the landing flag applies to first load only
      setShowDashboard(isDashboardLocation())
    }
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  const openWizard = useCallback(() => {
    window.location.hash = 'wizard'
    setShowWizard(true)
  }, [])

  /* dashboard navigation: hand off to the wizard, lesson editor, or a gallery */
  const leaveDashboard = useCallback((next: 'lesson' | 'wizard' | 'generative' | 'errors') => {
    if (next === 'wizard') {
      window.location.hash = 'wizard'
      setShowWizard(true)
    } else {
      if (window.location.hash === '#dashboard' || isDashboardLocation()) {
        window.history.replaceState(
          null,
          '',
          window.location.pathname.replace(/\/dashboard\/?$/, '/') + window.location.search,
        )
      }
      setShowWizard(false)
      setCanvasView(next)
    }
    setShowDashboard(false)
  }, [])

  const exitWizard = useCallback(() => {
    if (window.location.hash === '#wizard') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } else if (isWizardLocation()) {
      window.history.replaceState(null, '', window.location.pathname.replace(/\/wizard\/?$/, '/') + window.location.search)
    }
    setShowWizard(false)
    setCanvasView('lesson')
  }, [])

  /* sidebar Blocks outline: one row per block in the lesson, in document order */
  const outline = useMemo<OutlineItem[]>(
    () =>
      doc.nodes.flatMap((node) => {
        if (node.kind !== 'block') return []
        const entry = SLASH_MENU_ENTRIES.find((e) =>
          node.type === 'question'
            ? e.type === 'question' && e.qKind === (node.data as QuestionData).qKind
            : e.type === node.type,
        )
        if (!entry) return []
        return [{ id: node.id, label: entry.label, icon: entry.icon }]
      }),
    [doc.nodes],
  )

  const scrollToBlock = useCallback((id: string) => {
    document
      .querySelector(`[data-doc-node="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const sidebar = (
    <Sidebar
      wizardNav={showWizard}
      onCanvas={DASH_SHELL}
      outline={outline}
      onBlockClick={scrollToBlock}
      onAddBlock={() => editorApi.current?.openSlashAtEnd()}
      onBlockDelete={(id) => {
        doc.removeBlock(id)
        handleDirty()
      }}
      onBlockMove={(dragId, beforeId) => {
        const to = doc.nodes.findIndex((n) => n.id === beforeId)
        if (to !== -1) {
          doc.moveBlock(dragId, to)
          handleDirty()
        }
      }}
    />
  )

  const topBar = (
        <header className={`flex h-12 shrink-0 items-center justify-between ${FLOATING ? 'px-4' : 'border-b border-line bg-cream-300 px-5'}`}>
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium text-neutral-900">{showWizard ? 'Universal Wizard' : CANVAS_TITLES[canvasView]}</h1>
            {showWizard && (
              <span className="flex items-center gap-1 rounded-full border border-line bg-cream-100 px-2.5 py-0.5 text-xs text-neutral-500">
                <AutoAwesomeIcon size={12} /> Generating a lesson
              </span>
            )}
            {!showWizard && canvasView === 'lesson' && (
              <span className="flex items-center gap-1 text-xs text-neutral-400">
                {saveState === 'saving' ? (
                  <>
                    <CloudUploadIcon size={14} /> Saving…
                  </>
                ) : (
                  <>
                    <CheckIcon size={14} /> Saved
                  </>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showWizard && (
              <button
                type="button"
                onClick={exitWizard}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs hover:bg-cream-300"
              >
                Exit wizard
              </button>
            )}
            {!showWizard && (
              <button
                type="button"
                title="Open the Universal Wizard (/wizard)"
                onClick={openWizard}
                className="flex items-center gap-1.5 rounded-lg border border-line bg-cream-100 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs hover:bg-cream-300"
              >
                <AutoAwesomeIcon size={14} /> Wizard
              </button>
            )}
            {/* canvas surface toggle: lesson / generative gallery / errors gallery */}
            {!showWizard && (
              <>
            <div className="flex overflow-hidden rounded-lg border border-line bg-cream-100 shadow-2xs">
              {CANVAS_VIEWS.map((v) => {
                const Icon = v.icon
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setCanvasView(v.id)}
                    className={`flex items-center gap-1.5 border-l border-line px-3 py-1.5 text-xs font-medium first:border-l-0 ${canvasView === v.id ? 'bg-navy text-cream' : 'text-neutral-700 hover:bg-cream-300'}`}
                  >
                    <Icon size={14} /> {v.label}
                  </button>
                )
              })}
            </div>
            {canvasView === 'lesson' && (
              <>
                <button
                  type="button"
                  title="Math keyboard — types into the focused field"
                  onClick={toggleMathKeyboard}
                  className="flex h-7 w-8 items-center justify-center rounded-lg border border-line bg-cream-100 text-neutral-700 shadow-2xs hover:bg-cream-300"
                >
                  <FunctionsIcon size={16} />
                </button>
                <div className="flex overflow-hidden rounded-lg border border-line bg-cream-100 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setViewMode('edit')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${viewMode === 'edit' ? 'bg-navy text-cream' : 'text-neutral-700 hover:bg-cream-300'}`}
                  >
                    <EditIcon size={14} /> Editing
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('preview')}
                    className={`flex items-center gap-1.5 border-l border-line px-3 py-1.5 text-xs font-medium ${viewMode === 'preview' ? 'bg-navy text-cream' : 'text-neutral-700 hover:bg-cream-300'}`}
                  >
                    <PreviewIcon size={14} /> Student preview
                  </button>
                </div>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-navy px-3.5 py-1.5 text-xs font-medium text-cream shadow-2xs hover:bg-navy-deep"
                >
                  <PublishIcon size={14} /> Publish
                </button>
              </>
            )}
              </>
            )}
          </div>
        </header>
  )

  const body = showWizard ? (
    <WizardView onFinish={exitWizard} />
  ) : (
        <main className={`min-h-0 flex-1 overflow-y-auto bg-cream-300 ${FLOATING ? 'rounded-2xl border border-line shadow-xs' : ''}`}>
          {canvasView === 'lesson' ? (
            <div className="mx-auto max-w-[1004px] px-5 py-5">
              <DocumentEditor
                viewMode={viewMode}
                doc={doc}
                onDirty={handleDirty}
                registerApi={(api) => {
                  editorApi.current = api
                }}
              />
            </div>
          ) : (
            <GalleryView mode={canvasView} />
          )}
        </main>
  )

  if (showDashboard) {
    return (
      <DashboardView
        onOpenWizard={() => leaveDashboard('wizard')}
        onOpenLesson={() => leaveDashboard('lesson')}
        onOpenGallery={(mode) => leaveDashboard(mode)}
      />
    )
  }

  if (FLOATING) {
    /* Floating shells on a cream-100 background: notebook wraps the navy sidebar
       in a rounded panel; the dashboard shell sits the light sidebar on the page. */
    return (
      <div className="flex h-full flex-col bg-cream-100">
        {topBar}
        <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
          {DASH_SHELL ? (
            <div className="flex shrink-0">{sidebar}</div>
          ) : (
            <div className="flex shrink-0 overflow-hidden rounded-2xl shadow-xs">{sidebar}</div>
          )}
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-page">
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {topBar}
        {body}
      </div>
    </div>
  )
}
