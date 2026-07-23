import { useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { mIcon } from '../components/m-icon'
import type { Criterion, McqOption, QuestionData, QuestionKind } from '../types'
import { uid } from '../editor/uid'
import { toggleMathKeyboard } from '../components/math-keyboard'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const CheckIcon = mIcon('check')
const InfoIcon = mIcon('info')
const ChecklistIcon = mIcon('checklist')
const LockIcon = mIcon('lock')
const LockOpenIcon = mIcon('lock_open')
const AddIcon = mIcon('add')
const RotateLeftIcon = mIcon('rotate_left')
const FunctionsIcon = mIcon('functions')
const AutoAwesomeIcon = mIcon('auto_awesome')
const RefreshIcon = mIcon('refresh')
const CloseIcon = mIcon('close')

const BADGE_LABELS: Record<QuestionKind, string> = {
  'multiple-choice': 'Multiple Choice question',
  'fill-blank': 'Fill in the blanks',
  'short-answer': 'Short answer',
  'open-ended': 'Open ended',
}

const SA_LIMIT = 300
const OE_LIMIT = 5000

type StudentPhase = 'idle' | 'loading' | 'correct' | 'wrong' | 'improve'

function Banner({ phase, explanation }: { phase: StudentPhase; explanation: string }): ReactElement | null {
  if (phase !== 'correct' && phase !== 'wrong' && phase !== 'improve') return null
  const style =
    phase === 'correct'
      ? { bg: '#f0fdf4', border: '#86efac', title: '#15803d', label: 'Correct' }
      : phase === 'wrong'
        ? { bg: '#fef2f2', border: '#dc2626', title: '#b91c1c', label: 'Incorrect' }
        : { bg: '#fefce8', border: '#422006', title: '#854d0e', label: 'Feedback' }
  return (
    <div className="rounded-lg border px-4 py-3 shadow-2xs" style={{ backgroundColor: style.bg, borderColor: style.border }}>
      <p className="text-sm font-medium leading-5" style={{ color: style.title }}>
        {style.label}
      </p>
      <p className="mt-1.5 text-xs leading-4 text-neutral-950">
        {phase === 'correct'
          ? explanation || 'Nice work — that is the right answer.'
          : phase === 'wrong'
            ? explanation || 'That is not quite right. Review the section above and try again.'
            : 'Good start — add more detail on how particle energy changes to earn full credit.'}
      </p>
    </div>
  )
}

function SubmitButton({
  phase,
  disabled,
  onSubmit,
  onTryAgain,
}: {
  phase: StudentPhase
  disabled: boolean
  onSubmit: () => void
  onTryAgain: () => void
}): ReactElement | null {
  if (phase === 'correct') return null
  if (phase === 'loading') {
    return (
      <div className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-navy-deep text-sm font-medium text-cream">
        <RefreshIcon size={16} className="animate-spin" /> Checking your answer
      </div>
    )
  }
  if (phase === 'wrong' || phase === 'improve') {
    return (
      <button
        type="button"
        onClick={onTryAgain}
        className="h-10 w-full rounded-lg border border-line text-sm font-medium text-navy shadow-xs hover:bg-cream-300"
      >
        Try Again
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSubmit}
      className="h-10 w-full rounded-lg bg-navy text-sm font-medium text-cream shadow-xs hover:bg-navy-deep disabled:bg-black/30"
    >
      Submit Answer
    </button>
  )
}

export function QuestionBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<QuestionData>): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [studentAnswer, setStudentAnswer] = useState('')
  const [phase, setPhase] = useState<StudentPhase>('idle')
  const editing = viewMode === 'edit'

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const accepted = data.answer
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)

  const grade = (): void => {
    setPhase('loading')
    window.setTimeout(() => {
      if (data.qKind === 'multiple-choice') {
        const correctIds = new Set(data.options.filter((o) => o.correct).map((o) => o.id))
        const isRight = correctIds.size === selected.size && [...selected].every((id) => correctIds.has(id))
        setPhase(isRight ? 'correct' : 'wrong')
      } else if (data.qKind === 'fill-blank' || data.qKind === 'short-answer') {
        const isRight = accepted.some((a) => studentAnswer.trim().toLowerCase().includes(a))
        setPhase(isRight ? 'correct' : 'wrong')
      } else {
        setPhase(studentAnswer.trim().length > 80 ? 'correct' : 'improve')
      }
    }, 1000)
  }

  const tryAgain = (): void => {
    setSelected(new Set())
    if (data.qKind !== 'multiple-choice') setStudentAnswer('')
    setPhase('idle')
  }

  const setOption = (i: number, option: McqOption): void =>
    onChange({ ...data, options: data.options.map((o, oi) => (oi === i ? option : o)) })
  const setCriterion = (i: number, criterion: Criterion): void =>
    onChange({ ...data, criteria: data.criteria.map((c, ci) => (ci === i ? criterion : c)) })

  const resetWeights = (): void => {
    const unlocked = data.criteria.filter((c) => !c.locked)
    if (unlocked.length === 0) return
    const lockedTotal = data.criteria.filter((c) => c.locked).reduce((sum, c) => sum + c.weight, 0)
    const even = Math.floor(Math.max(0, 100 - lockedTotal) / unlocked.length)
    let assigned = 0
    let seen = 0
    onChange({
      ...data,
      criteria: data.criteria.map((c) => {
        if (c.locked) return c
        seen += 1
        const weight = seen === unlocked.length ? Math.max(0, 100 - lockedTotal) - assigned : even
        assigned += weight
        return { ...c, weight }
      }),
    })
  }

  /* ---------- shared chrome ---------- */
  const chrome = (children: ReactNode): ReactElement => (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-cream-300 p-5 shadow-xs transition-shadow focus-within:shadow-md">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-semibold leading-5 text-[#9405e6]" style={{ backgroundColor: 'rgba(124,58,237,0.1)' }}>
          <ChecklistIcon size={14} />
          {BADGE_LABELS[data.qKind]}
        </span>
        <div className="flex items-center gap-2">
          <span className="flex h-7 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs">
            {editing ? (
              <input
                value={String(data.points)}
                onChange={(e) => {
                  const points = Number(e.target.value)
                  onChange({ ...data, points: Number.isFinite(points) ? points : 0 })
                }}
                className="w-5 bg-transparent text-right outline-none"
              />
            ) : (
              data.points
            )}
            pts
          </span>
          <button
            type="button"
            title="Open the math keyboard (types into the focused field)"
            onClick={toggleMathKeyboard}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-muted-fg shadow-xs hover:bg-cream-300"
          >
            <FunctionsIcon size={14} /> Math keyboard
          </button>
        </div>
      </div>
      {children}
    </div>
  )

  const questionText = editing ? (
    <textarea
      value={data.prompt}
      placeholder={
        data.qKind === 'fill-blank' ? 'Write a sentence using ____ for the blank' : 'Write your question here'
      }
      rows={1}
      onChange={(e) => onChange({ ...data, prompt: e.target.value })}
      onInput={(e) => {
        const el = e.currentTarget
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
      }}
      className="w-full resize-none bg-transparent text-lg font-semibold leading-7 text-black/80 outline-none placeholder:text-black/30"
    />
  ) : (
    <p className="text-lg font-semibold leading-7 text-black/80">{data.prompt}</p>
  )

  /* ---------- multiple choice ---------- */
  if (data.qKind === 'multiple-choice') {
    return chrome(
      <>
        {questionText}
        <p className="text-sm font-semibold leading-5 text-black/60">
          {editing ? 'Select all the correct answers' : 'Select all that apply'}
        </p>
        <div className="flex flex-col gap-2.5">
          {data.options.map((option, i) => {
            const isSelected = selected.has(option.id)
            const showResult = phase === 'correct' || phase === 'wrong'
            let rowStyle = 'border-line bg-white'
            let labelColor = 'text-black/80'
            if (!editing && showResult && isSelected) {
              rowStyle = option.correct ? 'border-[#16a34a] bg-[#f0fdf4]' : 'border-[#dc2626] bg-[#fef2f2]'
              labelColor = option.correct ? 'text-[#15803d]' : 'text-[#b91c1c]'
            } else if (!editing && isSelected) {
              rowStyle = 'border-navy-deep bg-[#f5f8fa]'
            } else if (editing && option.correct) {
              rowStyle = 'border-[#15803d] bg-white'
            }
            return (
              <div key={option.id} className="group/opt flex items-center gap-2.5">
                <div className={`flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-lg border px-3 ${rowStyle}`}>
                  <button
                    type="button"
                    title={editing ? 'Mark as correct answer' : 'Select answer'}
                    disabled={!editing && (phase === 'loading' || phase === 'correct')}
                    onClick={() => {
                      if (editing) {
                        setOption(i, { ...option, correct: !option.correct })
                      } else {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(option.id)) next.delete(option.id)
                          else next.add(option.id)
                          return next
                        })
                        if (phase === 'wrong') setPhase('idle')
                      }
                    }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      (editing && option.correct) || (!editing && isSelected)
                        ? 'border-navy bg-navy text-cream'
                        : 'border-neutral-400 bg-white'
                    }`}
                  >
                    {((editing && option.correct) || (!editing && isSelected)) && <CheckIcon size={14} />}
                  </button>
                  {editing ? (
                    <input
                      value={option.text}
                      placeholder={`Option ${i + 1}`}
                      onChange={(e) => setOption(i, { ...option, text: e.target.value })}
                      className="min-w-0 flex-1 bg-transparent text-sm leading-5 text-black/80 outline-none placeholder:text-black/30"
                    />
                  ) : (
                    <span className={`text-sm leading-5 ${labelColor}`}>{option.text}</span>
                  )}
                </div>
                {editing && data.options.length > 2 && (
                  <button
                    type="button"
                    title="Remove option"
                    onClick={() => onChange({ ...data, options: data.options.filter((_, oi) => oi !== i) })}
                    className="text-neutral-500 opacity-0 transition-opacity hover:text-red-600 group-hover/opt:opacity-100"
                  >
                    <CloseIcon size={24} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {editing ? (
          <>
            <button
              type="button"
              onClick={() =>
                onChange({ ...data, options: [...data.options, { id: uid('op'), text: '', correct: false }] })
              }
              className="flex items-center gap-2 pb-2 pt-1 text-sm font-medium leading-5 text-muted-fg hover:text-navy"
            >
              <AddIcon size={24} /> Add Option
            </button>
            <div>
              <p className="mb-1.5 text-sm font-semibold leading-5 text-black/60">Explanation</p>
              <textarea
                value={data.explanation}
                placeholder="Write your explanation for the correct answer here..."
                rows={2}
                onChange={(e) => onChange({ ...data, explanation: e.target.value })}
                className="w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm leading-5 text-black/60 shadow-xs outline-none placeholder:text-black/30"
              />
            </div>
          </>
        ) : (
          <>
            <SubmitButton phase={phase} disabled={selected.size === 0} onSubmit={grade} onTryAgain={tryAgain} />
            <Banner phase={phase} explanation={data.explanation} />
          </>
        )}
      </>,
    )
  }

  /* ---------- fill in the blank / short answer ---------- */
  if (data.qKind === 'fill-blank' || data.qKind === 'short-answer') {
    const missingAnswer = editing && data.prompt.trim() !== '' && data.answer.trim() === ''
    return chrome(
      <>
        {questionText}
        {editing && data.qKind === 'fill-blank' && (
          <p className="-mt-3 flex items-center gap-1 text-[10px] leading-[13px] text-black/20">
            <InfoIcon size={12} /> Use &quot;____&quot; where the blank goes.
          </p>
        )}
        {editing ? (
          <div>
            <p className={`mb-1.5 text-sm font-semibold leading-5 ${missingAnswer ? 'text-[#dc2626]' : 'text-black/60'}`}>
              Correct answer(s)
            </p>
            <input
              value={data.answer}
              placeholder="Answer one, Answer two"
              onChange={(e) => onChange({ ...data, answer: e.target.value })}
              className={`h-10 w-full rounded-lg border bg-white px-3 text-sm leading-5 text-black/60 shadow-xs outline-none placeholder:text-black/30 ${missingAnswer ? 'border-[#dc2626]' : 'border-line'}`}
            />
            <p className="mt-1.5 text-xs leading-4 text-muted-fg">
              Separate accepted answers with commas. Any match counts as correct.
            </p>
          </div>
        ) : (
          <>
            {data.qKind === 'fill-blank' ? (
              <input
                value={studentAnswer}
                placeholder="Write your answer here"
                disabled={phase === 'loading' || phase === 'correct'}
                onChange={(e) => {
                  setStudentAnswer(e.target.value)
                  if (phase === 'wrong') setPhase('idle')
                }}
                className={`h-10 w-full rounded-lg border bg-white px-3 text-sm leading-5 shadow-xs outline-none placeholder:text-black/30 ${phase === 'wrong' ? 'border-[#dc2626]' : 'border-line'}`}
              />
            ) : (
              <div>
                <textarea
                  value={studentAnswer}
                  placeholder="Write answer here"
                  maxLength={SA_LIMIT}
                  disabled={phase === 'loading' || phase === 'correct'}
                  onChange={(e) => {
                    setStudentAnswer(e.target.value)
                    if (phase === 'wrong') setPhase('idle')
                  }}
                  className={`h-[94px] w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm leading-5 shadow-xs outline-none placeholder:text-black/30 ${phase === 'wrong' ? 'border-[#dc2626]' : 'border-line'}`}
                />
                <p className="text-right text-[11px] text-neutral-400">
                  {studentAnswer.length} / {SA_LIMIT}
                </p>
              </div>
            )}
            <SubmitButton phase={phase} disabled={studentAnswer.trim() === ''} onSubmit={grade} onTryAgain={tryAgain} />
            <Banner phase={phase} explanation={data.explanation} />
          </>
        )}
      </>,
    )
  }

  /* ---------- open ended ---------- */
  const totalWeight = data.criteria.reduce((sum, c) => sum + c.weight, 0)
  const noCriteria = editing && data.criteria.length === 0
  return chrome(
    <>
      {questionText}
      {editing ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between py-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">Grading criteria</p>
            <button type="button" onClick={resetWeights} className="flex items-center gap-1 text-sm font-medium leading-5 text-muted-fg hover:text-navy">
              <RotateLeftIcon size={18} /> Reset weights
            </button>
          </div>
          {noCriteria && <p className="text-xs text-[#dc2626]">Add relevant grading criteria</p>}
          {data.criteria.map((criterion, i) => (
            <div key={criterion.id} className="group/crit flex items-center gap-2">
              <input
                value={criterion.text}
                placeholder={`Grading Criteria ${i + 1}`}
                onChange={(e) => setCriterion(i, { ...criterion, text: e.target.value })}
                className="h-12 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm leading-5 text-black/80 outline-none placeholder:text-black/30"
              />
              <button
                type="button"
                title={criterion.locked ? 'Unlock weight' : 'Lock weight'}
                onClick={() => setCriterion(i, { ...criterion, locked: !criterion.locked })}
                className="text-neutral-500 hover:text-navy"
              >
                {criterion.locked ? <LockIcon size={22} /> : <LockOpenIcon size={22} />}
              </button>
              <span className="flex h-12 w-[95px] items-center gap-1 rounded-lg bg-white px-3 shadow-xs">
                <input
                  value={String(criterion.weight)}
                  onChange={(e) => {
                    const weight = Number(e.target.value)
                    setCriterion(i, { ...criterion, weight: Number.isFinite(weight) ? weight : 0 })
                  }}
                  className="w-8 bg-transparent text-sm leading-5 text-black/80 outline-none"
                />
                <span className="text-sm text-muted-fg">%</span>
              </span>
              <button
                type="button"
                title="Delete criterion"
                onClick={() => onChange({ ...data, criteria: data.criteria.filter((_, ci) => ci !== i) })}
                className="text-neutral-500 opacity-0 transition-opacity hover:text-red-600 group-hover/crit:opacity-100"
              >
                <CloseIcon size={22} />
              </button>
            </div>
          ))}
          {data.criteria.length > 0 && totalWeight !== 100 && (
            <p className="text-xs text-[#dc2626]">Weights total {totalWeight}% — they must add up to 100%.</p>
          )}
          <div className="flex items-center gap-4 pb-1 pt-2">
            <button
              type="button"
              onClick={() =>
                onChange({ ...data, criteria: [...data.criteria, { id: uid('cr'), text: '', weight: data.criteria.length === 0 ? 100 : 0, locked: false }] })
              }
              className="flex items-center gap-1.5 text-sm font-medium leading-5 text-muted-fg hover:text-navy"
            >
              <AddIcon size={18} /> New criteria
            </button>
            <span className="text-line">│</span>
            <button
              type="button"
              title="Generate criteria with AI"
              onClick={() =>
                onChange({
                  ...data,
                  criteria: [
                    { id: uid('cr'), text: 'Identifies the correct phase change', weight: 40, locked: false },
                    { id: uid('cr'), text: 'Explains the energy transfer involved', weight: 40, locked: false },
                    { id: uid('cr'), text: 'Uses correct scientific vocabulary', weight: 20, locked: false },
                  ],
                })
              }
              className="flex items-center gap-1.5 text-sm font-medium leading-5 text-muted-fg hover:text-navy"
            >
              <AutoAwesomeIcon size={16} /> Generate
            </button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <textarea
              value={studentAnswer}
              placeholder="Write answer here"
              maxLength={OE_LIMIT}
              disabled={phase === 'loading' || phase === 'correct'}
              onChange={(e) => {
                setStudentAnswer(e.target.value)
                if (phase === 'wrong' || phase === 'improve') setPhase('idle')
              }}
              className="h-[119px] w-full resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm leading-5 shadow-xs outline-none placeholder:text-black/30"
            />
            <p className="text-right text-[11px] text-neutral-400">
              {studentAnswer.length} / {OE_LIMIT}
            </p>
          </div>
          <SubmitButton phase={phase} disabled={studentAnswer.trim() === ''} onSubmit={grade} onTryAgain={tryAgain} />
          <Banner phase={phase} explanation={data.explanation} />
        </>
      )}
    </>,
  )
}
