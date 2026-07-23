import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { CardData, CardItem } from '../types'
import { uid } from '../editor/uid'
import { ErrorGenerateCard, GenerateImagePanel } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const DragIndicatorIcon = mIcon('drag_indicator')
const LinkIcon = mIcon('link')
const AddIcon = mIcon('add')
const AutoAwesomeIcon = mIcon('auto_awesome')
const UploadIcon = mIcon('upload')
const CloseIcon = mIcon('close')

type CardMode = 'default' | 'link' | 'generate'

interface SingleCardProps {
  card: CardItem
  editing: boolean
  onUpdate: (card: CardItem) => void
  onDelete: () => void
  onDragStart: () => void
  onDropOn: () => void
  canDelete: boolean
}

function SingleCard({ card, editing, onUpdate, onDelete, onDragStart, onDropOn, canDelete }: SingleCardProps): ReactElement {
  const [mode, setMode] = useState<CardMode>('default')
  const [linkValue, setLinkValue] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-col gap-6 rounded-lg border border-line px-2 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
        {card.imageUrl && (
          <div>
            <div className="rounded-lg border border-neutral-200 px-1 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
              <img src={card.imageUrl} alt={card.title} className="h-48 w-full rounded-lg object-cover" />
            </div>
            {card.caption && (
              <p className="mt-1 text-center text-[11px] leading-[14px] text-[#bbbbbb]">{card.caption}</p>
            )}
          </div>
        )}
        <div className="flex flex-1 flex-col gap-1.5 px-2">
          {card.title && (
            <p className="border-b border-line pb-1 pt-[3px] text-sm font-medium leading-5 text-black/80">{card.title}</p>
          )}
          {card.description && <p className="text-xs leading-4 text-black/80">{card.description}</p>}
        </div>
      </div>
    )
  }

  return (
    <div
      className="group/card flex min-w-0 flex-col gap-2 rounded-lg border border-line px-2 py-3 shadow-2xs transition-shadow focus-within:border-[#d9d9d9] focus-within:shadow-md"
      style={{ backgroundColor: '#fffaec' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropOn}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpdate({ ...card, imageUrl: URL.createObjectURL(file), imageFailed: false })
          e.target.value = ''
        }}
      />

      {/* per-card header: drag handle + delete */}
      <div className="flex items-center justify-between">
        <span className="cursor-grab text-neutral-400" draggable onDragStart={onDragStart} title="Drag to reorder card">
          <DragIndicatorIcon size={20} className="rotate-90" />
        </span>
        {canDelete && (
          <button type="button" onClick={onDelete} title="Delete card" className="text-neutral-700 opacity-0 transition-opacity hover:text-red-600 group-hover/card:opacity-100">
            <CloseIcon size={20} />
          </button>
        )}
      </div>

      {/* media area */}
      {card.generating ? (
        <div className="flex h-48 items-center justify-center rounded-lg bg-cream-300">
          <div className="h-3 w-2/3 animate-pulse rounded-md bg-neutral-300/70" />
        </div>
      ) : card.imageUrl ? (
        <div className="group/cardimg relative rounded-lg border border-neutral-200 px-1 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
          <img src={card.imageUrl} alt={card.title} className="h-48 w-full rounded-lg object-cover" />
          <div className="absolute right-2 top-2 hidden overflow-hidden rounded-lg border border-line bg-page shadow-xs group-hover/cardimg:flex">
            <button
              type="button"
              title="Generate with AI"
              onClick={() => {
                onUpdate({ ...card, imageUrl: null })
                setMode('generate')
              }}
              className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300"
            >
              <AutoAwesomeIcon size={16} />
            </button>
            <button type="button" title="Replace image" onClick={() => fileRef.current?.click()} className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300">
              <UploadIcon size={16} />
            </button>
            <button type="button" title="Change URL" onClick={() => { onUpdate({ ...card, imageUrl: null }); setMode('link') }} className="flex h-8 w-9 items-center justify-center hover:bg-cream-300">
              <LinkIcon size={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          {mode === 'default' && (
            <div
              className="flex h-48 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-1 py-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const file = e.dataTransfer.files?.[0]
                if (file) onUpdate({ ...card, imageUrl: URL.createObjectURL(file), imageFailed: false })
              }}
            >
              <UploadIcon size={20} className="text-neutral-500" />
              <p className="text-center text-xs font-medium text-neutral-950">
                Drag and drop or{' '}
                <button type="button" className="text-navy underline" onClick={() => fileRef.current?.click()}>
                  upload a file
                </button>
              </p>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                <button type="button" onClick={() => setMode('link')} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300">
                  <LinkIcon size={16} /> Paste link
                </button>
                <button type="button" onClick={() => setMode('generate')} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300">
                  <AutoAwesomeIcon size={16} /> Generate
                </button>
              </div>
            </div>
          )}

          {mode === 'generate' && (
            <GenerateImagePanel
              tileClass="h-16"
              onBack={() => setMode('default')}
              onPick={(url) => {
                onUpdate({ ...card, imageUrl: url, imageFailed: false })
                setMode('default')
              }}
            />
          )}

          {mode === 'link' && (
            <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-3">
              <button type="button" onClick={() => setMode('default')} title="Back">
                <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
              </button>
              <input
                value={linkValue}
                placeholder="https://example.com/photo.jpg"
                onChange={(e) => setLinkValue(e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-xs outline-none placeholder:text-black/30"
              />
              <button
                type="button"
                onClick={() => {
                  if (/^https?:\/\//i.test(linkValue)) {
                    onUpdate({ ...card, imageUrl: linkValue, imageFailed: false })
                    setMode('default')
                  }
                }}
                className="h-8 rounded-lg bg-navy px-3 text-sm font-medium text-cream hover:bg-navy-deep"
              >
                Add
              </button>
            </div>
          )}

        </>
      )}

      {card.imageUrl && (
        <input
          value={card.caption}
          placeholder="Fig 1.1 Add caption here"
          onChange={(e) => onUpdate({ ...card, caption: e.target.value })}
          className="w-full bg-transparent text-center text-[11px] leading-[14px] text-[#bbbbbb] outline-none placeholder:text-black/20"
        />
      )}

      {/* text section */}
      <div className="flex flex-1 flex-col gap-1.5 px-2">
        <input
          value={card.title}
          placeholder="Card Heading"
          onChange={(e) => onUpdate({ ...card, title: e.target.value })}
          className="border-b border-line bg-transparent pb-1 pt-[3px] text-sm font-medium leading-5 text-black/80 outline-none placeholder:text-[#bbbbbb]"
        />
        <textarea
          value={card.description}
          placeholder="Card body text"
          rows={8}
          onChange={(e) => onUpdate({ ...card, description: e.target.value })}
          className="flex-1 resize-none bg-transparent text-xs leading-4 text-black/80 outline-none placeholder:text-[#bbbbbb]"
        />
      </div>
    </div>
  )
}

export function CardBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<CardData>): ReactElement {
  const dragIndex = useRef<number | null>(null)
  const editing = viewMode === 'edit'

  if (status === 'generation-failed')
    return <ErrorGenerateCard onRetry={onGenerate} message="We couldn't generate your card. Please try again." />

  const updateCard = (index: number) => (card: CardItem) => {
    onChange({ ...data, cards: data.cards.map((c, i) => (i === index ? card : c)) })
  }
  const moveCard = (from: number, to: number): void => {
    if (from === to) return
    const cards = [...data.cards]
    const [moved] = cards.splice(from, 1)
    cards.splice(to, 0, moved)
    onChange({ ...data, cards })
  }

  return (
    /* 2×N card grid; the ghost add slot occupies the next free cell */
    <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2">
      {data.cards.map((card, i) => (
        <SingleCard
          key={card.id}
          card={card}
          editing={editing}
          onUpdate={updateCard(i)}
          onDelete={() => onChange({ ...data, cards: data.cards.filter((_, ci) => ci !== i) })}
          onDragStart={() => {
            dragIndex.current = i
          }}
          onDropOn={() => {
            if (dragIndex.current !== null) moveCard(dragIndex.current, i)
            dragIndex.current = null
          }}
          canDelete={data.cards.length > 1}
        />
      ))}
      {editing && (
        <button
          type="button"
          title="Add card"
          onClick={() =>
            onChange({
              ...data,
              cards: [
                ...data.cards,
                { id: uid('cd'), title: '', description: '', imageUrl: null, caption: '', imageFailed: false, generating: false },
              ],
            })
          }
          // beside a card it stretches to match; on its own row it's a slim bar
          className={`flex items-center justify-center rounded-lg border border-dashed border-neutral-300 text-neutral-400 transition-colors hover:bg-cream-100 hover:text-neutral-600 ${data.cards.length % 2 === 0 ? 'h-12 self-start' : 'min-h-[200px]'}`}
        >
          <AddIcon size={data.cards.length % 2 === 0 ? 22 : 28} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}
