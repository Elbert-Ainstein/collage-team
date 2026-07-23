import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'
import { NavyButton } from '../blocks/shared'
import { FLOATING } from '../theme'

const MenuBookIcon = mIcon('menu_book')
const CheckIcon = mIcon('check')
const UploadIcon = mIcon('upload')
const PictureAsPdfIcon = mIcon('picture_as_pdf')
const CloseIcon = mIcon('close')
const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')
const AutoAwesomeIcon = mIcon('auto_awesome')
const ChecklistIcon = mIcon('checklist')
const CategoryIcon = mIcon('category')
const FlagIcon = mIcon('flag')
const AddIcon = mIcon('add')
const SendIcon = mIcon('send')
const ArrowForwardIcon = mIcon('arrow_forward')
const TextIcon = mIcon('notes')
const ImageIcon = mIcon('image')
const QuizIcon = mIcon('quiz')

/* --------------------------------- content --------------------------------- */

/** Sample sources cycled by "Add sample PDF". */
const SAMPLE_PDFS = [
  { name: 'States-of-Matter.pdf', pages: 12 },
  { name: 'Phase-Transitions-Notes.pdf', pages: 6 },
  { name: 'Lab-Handout-Density.pdf', pages: 3 },
]

const OBJECTIVES = [
  'Describe the particle arrangement of solids, liquids, and gases',
  'Explain how energy drives phase transitions between states',
  'Classify real-world samples by their observable properties',
]

/** Pool the "Generate with AI" action draws from, in order. */
const EXTRA_OBJECTIVES = [
  'Predict how temperature and pressure changes shift a sample between states',
  'Interpret heating curves to identify phase changes in a substance',
  'Relate particle energy to macroscopic properties like shape and volume',
]

interface Concept {
  id: string
  title: string
  summary: string
  blocks: string[]
}

const CONCEPTS: Concept[] = [
  {
    id: 'c1',
    title: 'Particle Arrangement & States',
    summary: 'How particle packing and motion define solids, liquids, and gases.',
    blocks: ['Text', 'Image', 'Callout'],
  },
  {
    id: 'c2',
    title: 'Energy & Phase Transitions',
    summary: 'Melting, freezing, evaporation — energy moving matter between states.',
    blocks: ['Text', 'Graph', 'Video'],
  },
  {
    id: 'c3',
    title: 'Measuring Matter',
    summary: 'Mass, volume, and temperature — the SI units behind every observation.',
    blocks: ['Text', 'Equation', 'Table'],
  },
  {
    id: 'c4',
    title: 'Classifying Samples',
    summary: 'Applying the framework to everyday materials and edge cases.',
    blocks: ['Text', 'Cards', 'Mind Map'],
  },
]

const EXERCISE_KINDS = [
  'Multiple choice',
  'Open ended',
  'Short answer',
  'Fill in the blank',
  'Example → Concept',
  'Concept → Example',
] as const

/* ---------------------------------- state ---------------------------------- */

type Phase =
  | 'source'
  | 'objectives-gen'
  | 'objectives'
  | 'concepts-gen'
  | 'concepts'
  | 'scaffold-gen'
  | 'scaffold'

const PHASE_ORDER: Phase[] = [
  'source', 'objectives-gen', 'objectives', 'concepts-gen', 'concepts', 'scaffold-gen', 'scaffold',
]

interface SourceFile {
  id: number
  name: string
  pages: number
  /** 0-100; 100 = read and ready. */
  pct: number
}

/** True once the wizard has reached (or passed) the given phase. */
function reached(phase: Phase, current: Phase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(phase)
}

type ChatActionId = 'gen-objectives' | 'gen-concepts' | 'gen-scaffold'

interface ChatAction {
  id: ChatActionId
  label: string
}

interface ChatMessage {
  id: number
  role: 'assistant' | 'user'
  text: string
  /** Optional generate button rendered under the bubble — the chat drives the flow. */
  action?: ChatAction
  actionUsed?: boolean
}

/* --------------------------------- pieces ---------------------------------- */

function StepLabel({ children }: { children: ReactNode }): ReactElement {
  return <p className="text-xs font-semibold uppercase tracking-wide text-muted-fg">{children}</p>
}

function Step({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-2.5">
      <StepLabel>{label}</StepLabel>
      {children}
    </section>
  )
}

/** Pulsing skeleton rows shown while a step generates. */
function GenRows({ label, rows = 3 }: { label: string; rows?: number }): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream-100 px-4 py-4 shadow-2xs">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-md bg-neutral-300/60" style={{ width: `${88 - i * 16}%` }} />
      ))}
      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
        <AutoAwesomeIcon size={13} className="text-brand-purple" /> {label}
      </p>
    </div>
  )
}

/** Upload/progress row per Figma 3466:811 — file tile, name, 8px bar, close. */
function SourceFileRow({ file, onRemove }: { file: SourceFile; onRemove: () => void }): ReactElement {
  const done = file.pct >= 100
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-line p-0.5" style={{ backgroundColor: '#fffaec' }}>
        <PictureAsPdfIcon size={16} className="text-[#b91c1c]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] leading-[14px] text-black/30">{file.name}</p>
          {done && (
            <span className="flex shrink-0 items-center gap-0.5 text-[11px] leading-[14px] text-[#15803d]">
              <CheckIcon size={12} /> {file.pages} pages · read
            </span>
          )}
        </div>
        <div className="relative h-2 w-full">
          <div className="absolute inset-0 rounded-full bg-navy/15" />
          <div
            className={`absolute inset-y-0 left-0 bg-navy transition-all ${done ? 'rounded-full' : 'rounded-l-full'}`}
            style={{ width: `${file.pct}%` }}
          />
        </div>
      </div>
      <button type="button" title="Remove source" onClick={onRemove} className="p-1">
        <CloseIcon size={20} className="text-neutral-500 hover:text-red-600" />
      </button>
    </div>
  )
}

/* ---------------------------------- wizard --------------------------------- */

export function WizardView({ onFinish }: { onFinish: () => void }): ReactElement {
  const [phase, setPhase] = useState<Phase>('source')
  const [files, setFiles] = useState<SourceFile[]>([])
  const fileSeq = useRef(1)
  const sampleSeq = useRef(0)
  const removedFiles = useRef<Set<number>>(new Set())
  const startedObjectives = useRef(false)
  const [loOpen, setLoOpen] = useState(true)
  const [objectives, setObjectives] = useState<string[]>(OBJECTIVES)
  const [loGenerating, setLoGenerating] = useState(false)
  const extraObjective = useRef(0)
  const [included, setIncluded] = useState<Set<string>>(new Set(CONCEPTS.map((c) => c.id)))
  const [exerciseKinds, setExerciseKinds] = useState<Set<string>>(new Set(['Multiple choice', 'Open ended']))
  const [concepts, setConcepts] = useState<Concept[]>(CONCEPTS)
  const conceptSeq = useRef(CONCEPTS.length)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      text: "You're generating a Lesson. First, add your source material — PDFs work great. Once I've read them, I'll hand you a button here to draft the learning objectives.",
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const msgId = useRef(2)
  const timers = useRef<number[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, phase])

  const later = (ms: number, fn: () => void): void => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const say = (text: string, action?: ChatAction): void => {
    setMessages((m) => [...m, { id: msgId.current++, role: 'assistant', text, action }])
  }

  const onFileRead = (name: string): void => {
    if (!startedObjectives.current) {
      startedObjectives.current = true
      say(`Nice — I've read ${name}. Add more sources if you have them, or let me draft the learning objectives.`, {
        id: 'gen-objectives',
        label: 'Generate learning objectives',
      })
    } else {
      say(`Added ${name} to your sources — I'll fold it into the objectives and concepts.`)
    }
  }

  /** Chat action buttons drive the generation steps. */
  const runAction = (messageId: number, action: ChatAction): void => {
    if (action.id === 'gen-scaffold' && included.size === 0) {
      say('Include at least one concept first — tick it on the canvas.')
      return
    }
    setMessages((m) => m.map((msg) => (msg.id === messageId ? { ...msg, actionUsed: true } : msg)))
    if (action.id === 'gen-objectives') {
      setPhase('objectives-gen')
      later(1700, () => {
        setPhase('objectives')
        say(
          'Done — 3 objectives are on the canvas. Click any line to edit it right on the block, add your own, or have me draft more. Ready for the concepts?',
          { id: 'gen-concepts', label: 'Generate concepts' },
        )
      })
    } else if (action.id === 'gen-concepts') {
      setPhase('concepts-gen')
      later(1500, () => {
        setPhase('concepts')
        say(
          'I found 4 key concepts in your sources. Edit the titles and summaries on the blocks, untick any you don’t want — then I’ll assemble the scaffold.',
          { id: 'gen-scaffold', label: 'Generate lesson scaffold' },
        )
      })
    } else {
      setPhase('scaffold-gen')
      say('Assembling the scaffold from your concepts…')
      later(1500, () => {
        setPhase('scaffold')
        say('Here’s the lesson scaffold. Pick the exercise styles you’d like after each concept, and I’ll build the full lesson in the editor.')
      })
    }
  }

  const addFile = (realName?: string): void => {
    const sample = SAMPLE_PDFS[sampleSeq.current % SAMPLE_PDFS.length]
    if (!realName) sampleSeq.current += 1
    const file: SourceFile = {
      id: fileSeq.current++,
      name: realName ?? sample.name,
      pages: realName ? 8 : sample.pages,
      pct: 0,
    }
    setFiles((prev) => [...prev, file])
    const step = (pct: number): void => {
      if (removedFiles.current.has(file.id)) return
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, pct } : f)))
      if (pct >= 100) {
        onFileRead(file.name)
        return
      }
      later(50, () => step(Math.min(100, pct + 4)))
    }
    step(4)
  }

  const removeFile = (id: number): void => {
    removedFiles.current.add(id)
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const sendChat = (): void => {
    const text = chatInput.trim()
    if (!text) return
    setMessages((m) => [...m, { id: msgId.current++, role: 'user', text }])
    setChatInput('')
    later(700, () => say('Got it — I’ll keep that in mind while generating your lesson.'))
  }

  const setObjective = (i: number, text: string): void =>
    setObjectives((prev) => prev.map((o, oi) => (oi === i ? text : o)))
  const removeObjective = (i: number): void => setObjectives((prev) => prev.filter((_, oi) => oi !== i))
  const generateObjective = (): void => {
    setLoGenerating(true)
    later(1000, () => {
      setObjectives((prev) => [...prev, EXTRA_OBJECTIVES[extraObjective.current++ % EXTRA_OBJECTIVES.length]])
      setLoGenerating(false)
    })
  }

  const toggleConcept = (id: string): void => {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleKind = (kind: string): void => {
    setExerciseKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const setConcept = (id: string, patch: Partial<Concept>): void =>
    setConcepts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const addConcept = (): void => {
    const id = `c${++conceptSeq.current}`
    setConcepts((prev) => [...prev, { id, title: '', summary: '', blocks: ['Text'] }])
    setIncluded((prev) => new Set(prev).add(id))
  }

  const chosenConcepts = concepts.filter((c) => included.has(c.id))

  return (
    <div className={`flex min-h-0 flex-1 ${FLOATING ? 'gap-3' : ''}`}>
      {/* ------------------------------- canvas ------------------------------- */}
      <main className={`min-h-0 flex-1 overflow-y-auto bg-cream-300 ${FLOATING ? 'rounded-2xl border border-line shadow-xs' : ''}`}>
        <div className="mx-auto flex max-w-[820px] flex-col gap-8 px-5 py-8">
          <div>
            <h1 className="font-serif text-3xl font-semibold leading-9 text-black/80">New lesson</h1>
            <p className="mt-1 text-sm text-neutral-500">
              The wizard reads your source material and builds the lesson with you, step by step.
            </p>
          </div>

          {/* content type — already chosen */}
          <Step label="Content type">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-cream-100 p-4 shadow-2xs">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy text-cream">
                <MenuBookIcon size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-xl font-semibold leading-7 text-black/80">Lesson</p>
                <p className="text-xs text-neutral-500">Built from your source material, concept by concept.</p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-xs font-medium text-cream">
                <CheckIcon size={13} /> Selected
              </span>
            </div>
          </Step>

          {/* source material — multiple PDFs, each with the 3466:811 progress row */}
          <Step label="Step 1 — Source material">
            {files.length > 0 && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream-100 p-3 shadow-2xs">
                {files.map((file) => (
                  <SourceFileRow key={file.id} file={file} onRemove={() => removeFile(file.id)} />
                ))}
              </div>
            )}

            <div
              className={`flex flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-100 px-2 ${files.length === 0 ? 'py-6' : 'py-3'}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                addFile(e.dataTransfer.files?.[0]?.name)
              }}
            >
              {files.length === 0 && (
                <>
                  <UploadIcon size={20} className="text-neutral-500" />
                  <p className="text-xs font-medium text-neutral-950">
                    Drag and drop or{' '}
                    <button type="button" className="text-navy underline" onClick={() => fileRef.current?.click()}>
                      upload a file
                    </button>
                  </p>
                  <p className="text-[11px] text-neutral-400">PDFs up to 25 MB — add as many as you like</p>
                </>
              )}
              <div className={`flex items-center gap-1.5 ${files.length === 0 ? 'mt-2' : ''}`}>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
                >
                  <PictureAsPdfIcon size={16} /> {files.length === 0 ? 'Upload PDF' : 'Add another PDF'}
                </button>
                <button
                  type="button"
                  onClick={() => addFile()}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
                >
                  <AutoAwesomeIcon size={16} /> {files.length === 0 ? 'Use sample PDF' : 'Add sample PDF'}
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  Array.from(e.target.files ?? []).forEach((f) => addFile(f.name))
                  e.target.value = ''
                }}
              />
            </div>
          </Step>

          {/* learning objectives */}
          {reached('objectives-gen', phase) && (
            <Step label="Step 2 — Learning objectives">
              {phase === 'objectives-gen' ? (
                <GenRows label="Drafting objectives from your source…" />
              ) : (
                <div className="rounded-lg border border-line bg-page px-3 py-2 shadow-xs transition-shadow focus-within:shadow-md">
                  <button type="button" className="flex w-full items-center justify-between" onClick={() => setLoOpen((v) => !v)}>
                    <span className="text-base font-semibold leading-6 text-black/80">
                      Learning Objectives <span className="text-muted-fg">({objectives.length})</span>
                    </span>
                    <KeyboardArrowDownIcon size={16} className={`transition-transform ${loOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {loOpen && (
                    <div className="mt-3 flex flex-col gap-1 pb-1">
                      {objectives.map((objective, i) => (
                        <div key={i} className="group/lo flex items-center gap-2">
                          <FlagIcon size={14} className="shrink-0 text-muted-fg" />
                          <input
                            value={objective}
                            autoFocus={objective === ''}
                            placeholder="Write a learning objective"
                            onChange={(e) => setObjective(i, e.target.value)}
                            className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-sm leading-5 text-black/80 outline-none placeholder:text-black/30 focus:border-line focus:bg-white"
                          />
                          <button
                            type="button"
                            title="Remove objective"
                            onClick={() => removeObjective(i)}
                            className="opacity-0 transition-opacity group-hover/lo:opacity-100"
                          >
                            <CloseIcon size={15} className="text-neutral-500 hover:text-red-600" />
                          </button>
                        </div>
                      ))}
                      {loGenerating && (
                        <div className="flex items-center gap-2 py-1">
                          <AutoAwesomeIcon size={14} className="shrink-0 text-brand-purple" />
                          <div className="h-3 w-3/5 animate-pulse rounded-md bg-neutral-300/60" />
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-2">
                        <button
                          type="button"
                          onClick={() => setObjectives((prev) => [...prev, ''])}
                          className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-2 text-xs font-medium text-black/60 shadow-2xs hover:bg-cream-300"
                        >
                          <AddIcon size={14} /> Add objective
                        </button>
                        <button
                          type="button"
                          onClick={generateObjective}
                          disabled={loGenerating}
                          className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-2 text-xs font-medium text-black/60 shadow-2xs hover:bg-cream-300 disabled:opacity-50"
                        >
                          <AutoAwesomeIcon size={14} /> Generate with AI
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Step>
          )}

          {/* concepts */}
          {reached('concepts-gen', phase) && (
            <Step label="Step 3 — Concepts">
              {phase === 'concepts-gen' ? (
                <GenRows label="Breaking the material into concepts…" rows={4} />
              ) : (
                <div className="flex flex-col gap-2">
                  {concepts.map((concept) => {
                    const on = included.has(concept.id)
                    return (
                      <div
                        key={concept.id}
                        className={`flex items-start gap-3 rounded-lg border p-3 shadow-2xs transition-all focus-within:shadow-md ${on ? 'border-line bg-cream-100' : 'border-dashed border-line bg-cream-300 opacity-60'}`}
                      >
                        <button
                          type="button"
                          title={on ? 'Exclude from lesson' : 'Include in lesson'}
                          onClick={() => toggleConcept(concept.id)}
                          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? 'border-navy bg-navy text-cream' : 'border-neutral-400 bg-white'}`}
                        >
                          {on && <CheckIcon size={14} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <input
                            value={concept.title}
                            autoFocus={concept.title === ''}
                            placeholder="Concept title"
                            onChange={(e) => setConcept(concept.id, { title: e.target.value })}
                            className="w-full bg-transparent font-serif text-base font-semibold leading-6 text-black/80 outline-none placeholder:text-black/30"
                          />
                          <input
                            value={concept.summary}
                            placeholder="One line on what this concept covers"
                            onChange={(e) => setConcept(concept.id, { summary: e.target.value })}
                            className="w-full bg-transparent text-xs text-neutral-500 outline-none placeholder:text-black/30"
                          />
                        </div>
                        <span className="mt-1 shrink-0 rounded-full border border-line bg-white px-2 py-0.5 text-[11px] text-muted-fg">
                          {concept.blocks.length + 1} blocks
                        </span>
                      </div>
                    )
                  })}
                  <div>
                    <button
                      type="button"
                      onClick={addConcept}
                      className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-2 text-xs font-medium text-black/60 shadow-2xs hover:bg-cream-300"
                    >
                      <AddIcon size={14} /> Add concept
                    </button>
                  </div>
                </div>
              )}
            </Step>
          )}

          {/* scaffold + questionnaire */}
          {reached('scaffold-gen', phase) && (
            <Step label="Step 4 — Lesson scaffold">
              {phase === 'scaffold-gen' ? (
                <div className="relative">
                  <GenRows label="Assembling the scaffold…" rows={4} />
                  <div className="shimmer-overlay pointer-events-none absolute inset-0" />
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 rounded-lg border border-line bg-cream-100 p-4 shadow-2xs">
                    {chosenConcepts.map((concept, i) => (
                      <div key={concept.id} className={`flex flex-col gap-2 ${i > 0 ? 'border-t border-line pt-3' : ''}`}>
                        <p className="font-serif text-base font-semibold leading-6 text-black/80">
                          <span className="text-muted-fg">{i + 1} · </span>
                          {concept.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {concept.blocks.map((block) => (
                            <span key={block} className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-black/60">
                              {block === 'Image' ? <ImageIcon size={12} /> : <TextIcon size={12} />}
                              {block}
                            </span>
                          ))}
                          <ArrowForwardIcon size={13} className="text-neutral-400" />
                          <span className="flex items-center gap-1 rounded-lg bg-navy px-2 py-1 text-[11px] font-medium text-cream">
                            <QuizIcon size={12} /> Exercise
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-3 rounded-lg border border-line bg-page p-4 shadow-xs">
                    <div>
                      <p className="text-sm font-semibold text-black/80">What kinds of questions should the exercises use?</p>
                      <p className="text-xs text-neutral-500">Pick as many as you like — I’ll mix them across the concepts.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {EXERCISE_KINDS.map((kind) => {
                        const on = exerciseKinds.has(kind)
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => toggleKind(kind)}
                            className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${on ? 'border-navy bg-navy text-cream' : 'border-line bg-white text-black/60 hover:bg-cream-300'}`}
                          >
                            {on && <CheckIcon size={13} />}
                            {kind}
                          </button>
                        )
                      })}
                    </div>
                    <div className="mt-1 flex justify-end">
                      <NavyButton onClick={onFinish} disabled={exerciseKinds.size === 0}>
                        Build lesson in the editor <ArrowForwardIcon size={16} />
                      </NavyButton>
                    </div>
                  </div>
                </div>
              )}
            </Step>
          )}
        </div>
      </main>

      {/* ---------------------------- guide panel ---------------------------- */}
      <aside
        className={`flex w-[340px] shrink-0 flex-col ${FLOATING ? 'overflow-hidden rounded-2xl border border-line bg-page shadow-xs' : 'border-l border-line bg-cream-100'}`}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full text-[#9405e6]" style={{ backgroundColor: 'rgba(124,58,237,0.1)' }}>
            <AutoAwesomeIcon size={15} />
          </span>
          <p className="text-sm font-semibold text-black/80">Wizard guide</p>
        </div>

        {/* artifacts */}
        <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3">
          <StepLabel>Artifacts</StepLabel>
          {files.length === 0 && <p className="text-xs text-neutral-400">Uploads and generated material collect here.</p>}
          {files
            .filter((file) => file.pct >= 100)
            .map((file) => (
              <div key={file.id} className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 shadow-2xs">
                <PictureAsPdfIcon size={16} className="shrink-0 text-[#b91c1c]" />
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-black/80">{file.name}</p>
                <span className="text-[11px] text-neutral-400">source</span>
              </div>
            ))}
          {reached('objectives', phase) && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 shadow-2xs">
              <ChecklistIcon size={16} className="shrink-0 text-navy" />
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-black/80">Learning outcomes</p>
              <span className="text-[11px] text-neutral-400">{objectives.length} objectives</span>
            </div>
          )}
          {reached('concepts', phase) && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-2.5 py-2 shadow-2xs">
              <CategoryIcon size={16} className="shrink-0 text-navy" />
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-black/80">Concepts</p>
              <span className="text-[11px] text-neutral-400">{included.size} of {concepts.length} included</span>
            </div>
          )}
        </div>

        {/* chat log */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-2.5">
            {messages.map((message) =>
              message.role === 'assistant' ? (
                <div key={message.id} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#9405e6]" style={{ backgroundColor: 'rgba(124,58,237,0.1)' }}>
                    <AutoAwesomeIcon size={12} />
                  </span>
                  <div className="rounded-lg rounded-tl-none border border-line bg-white px-3 py-2 shadow-2xs">
                    <p className="text-xs leading-4 text-black/80">{message.text}</p>
                    {message.action && (
                      <button
                        type="button"
                        disabled={message.actionUsed}
                        onClick={() => runAction(message.id, message.action!)}
                        className="mt-2 flex h-8 items-center gap-1.5 rounded-lg bg-navy px-3 text-xs font-medium text-cream shadow-2xs hover:bg-navy-deep disabled:bg-black/20"
                      >
                        {message.actionUsed ? <CheckIcon size={14} /> : <AutoAwesomeIcon size={14} />}
                        {message.action.label}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-lg rounded-tr-none bg-navy px-3 py-2 text-xs leading-4 text-cream">{message.text}</p>
                </div>
              ),
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* chat input */}
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-1.5">
            <input
              value={chatInput}
              placeholder="Guide the wizard…"
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendChat()
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-xs outline-none placeholder:text-black/30"
            />
            <button
              type="button"
              title="Send"
              onClick={sendChat}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy text-cream hover:bg-navy-deep"
            >
              <SendIcon size={16} />
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}
