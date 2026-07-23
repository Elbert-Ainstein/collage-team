import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { FlashcardData, FlashcardItem, FlashcardSide } from '../types'
import { uid } from '../editor/uid'
import { ErrorGenerateCard, placeholderImage, SEARCH_RESULTS } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowLeftIcon = mIcon('keyboard_arrow_left')
const KeyboardArrowRightIcon = mIcon('keyboard_arrow_right')
const LinkIcon = mIcon('link')
const AddIcon = mIcon('add')
const SearchIcon = mIcon('search')
const ImageSearchIcon = mIcon('image_search')
const UploadIcon = mIcon('upload')
const CloseIcon = mIcon('close')
const WarningIcon = mIcon('warning')

const CHAR_LIMIT = 500

type MediaMode = 'default' | 'link' | 'search'

function emptySide(): FlashcardSide {
  return { text: '', imageUrl: null, altText: '' }
}

/** Image dropzone + alt input at the top of the editor card face (Figma FlashCard/Front/Empty). */
function SideMedia({ side, onUpdate }: { side: FlashcardSide; onUpdate: (side: FlashcardSide) => void }): ReactElement {
  const [mode, setMode] = useState<MediaMode>('default')
  const [linkValue, setLinkValue] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [searched, setSearched] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex w-full flex-col gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpdate({ ...side, imageUrl: URL.createObjectURL(file) })
          e.target.value = ''
        }}
      />

      {side.imageUrl ? (
        <div className="group/fcimg relative mx-auto rounded-lg border border-neutral-200 px-1 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
          <img src={side.imageUrl} alt={side.altText} className="max-h-44 rounded-lg object-cover" />
          <div className="absolute right-2 top-2 hidden overflow-hidden rounded-lg border border-line bg-page shadow-xs group-hover/fcimg:flex">
            <button
              type="button"
              title="Replace image"
              onClick={() => fileRef.current?.click()}
              className="flex h-8 w-9 items-center justify-center border-r border-line hover:bg-cream-300"
            >
              <UploadIcon size={16} />
            </button>
            <button
              type="button"
              title="Remove image"
              onClick={() => onUpdate({ ...side, imageUrl: null })}
              className="flex h-8 w-9 items-center justify-center hover:bg-cream-300"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
      ) : mode === 'default' ? (
        <div
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-line bg-cream-300 px-1 py-2"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) onUpdate({ ...side, imageUrl: URL.createObjectURL(file) })
          }}
        >
          <UploadIcon size={20} className="text-neutral-500" />
          <p className="text-xs font-medium text-neutral-950">
            Drag and drop or{' '}
            <button type="button" className="text-navy underline" onClick={() => fileRef.current?.click()}>
              upload a file
            </button>
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('link')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
            >
              <LinkIcon size={16} /> Paste link
            </button>
            <button
              type="button"
              onClick={() => setMode('search')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-page px-2.5 text-xs font-medium text-black/60 shadow-xs hover:bg-cream-300"
            >
              <ImageSearchIcon size={16} /> Search Image
            </button>
          </div>
        </div>
      ) : mode === 'link' ? (
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
                onUpdate({ ...side, imageUrl: linkValue })
                setMode('default')
              }
            }}
            className="h-8 rounded-lg bg-navy px-3 text-sm font-medium text-cream hover:bg-navy-deep"
          >
            Add
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-line bg-cream-300 px-2 py-3">
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setMode('default')} title="Back">
              <KeyboardArrowLeftIcon size={20} className="text-neutral-600" />
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                value={searchValue}
                placeholder="Search free images"
                onChange={(e) => setSearchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSearched(true)
                }}
                className="h-8 w-full rounded-lg border border-line bg-white px-2 pr-8 text-xs outline-none placeholder:text-black/30"
              />
              <button type="button" title="Search" onClick={() => setSearched(true)} className="absolute right-2 top-1.5 text-neutral-500">
                <SearchIcon size={16} />
              </button>
            </div>
          </div>
          {searched && (
            <div className="grid grid-cols-3 gap-2">
              {SEARCH_RESULTS.map(([label, from, to]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    onUpdate({ ...side, imageUrl: placeholderImage(label, from, to) })
                    setMode('default')
                  }}
                  className="overflow-hidden rounded-lg border border-line"
                >
                  <img src={placeholderImage(label, from, to)} alt={label} className="h-16 w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <input
        value={side.altText}
        placeholder="Alt text here"
        onChange={(e) => onUpdate({ ...side, altText: e.target.value })}
        className="h-8 w-full rounded-lg border border-line bg-white px-2 text-xs shadow-xs outline-none placeholder:text-black/30"
      />
    </div>
  )
}

export function FlashcardBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<FlashcardData>): ReactElement {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const editing = viewMode === 'edit'

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const cards = data.cards
  const card: FlashcardItem | undefined = cards[Math.min(index, cards.length - 1)]
  if (!card) return <ErrorGenerateCard onRetry={onGenerate} />

  const side = flipped ? card.back : card.front
  const updateSide = (next: FlashcardSide): void => {
    const nextCard: FlashcardItem = flipped ? { ...card, back: next } : { ...card, front: next }
    onChange({ ...data, cards: cards.map((c) => (c.id === card.id ? nextCard : c)) })
  }

  const atLimit = side.text.length >= CHAR_LIMIT
  const hint = editing
    ? flipped
      ? 'Tap to edit question'
      : 'Tap to edit answer'
    : flipped
      ? 'Tap to view question'
      : 'Tap to view answer'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line px-2 py-3 shadow-2xs" style={{ backgroundColor: '#fffaec' }}>
      {/* card face — the whole face is the flip target */}
      <div style={{ perspective: 1200 }}>
        <div
          className="relative transition-transform duration-500 [transform-style:preserve-3d]"
          style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
        >
          <div
            className={`flex cursor-pointer flex-col gap-6 overflow-hidden rounded-lg border border-line p-8 [backface-visibility:hidden] transition-shadow focus-within:shadow-md ${editing ? 'min-h-[347px]' : 'min-h-[280px] items-center justify-center'}`}
            style={{ backgroundColor: '#fffaec', transform: flipped ? 'rotateY(180deg)' : undefined }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('textarea,button,input,img')) return
              setFlipped((v) => !v)
            }}
          >
            {editing ? (
              <>
                {/* Figma FlashCard/Error/no answer + no question — amber banner when this side is empty */}
                {side.text === '' && !side.imageUrl && (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-[#eab308] px-4 py-2">
                    <WarningIcon size={16} className="shrink-0 text-neutral-900" />
                    <p className="text-sm font-medium text-[#b45309]">
                      {flipped ? 'This card has no answer' : 'This card has no question'}
                    </p>
                  </div>
                )}
                <SideMedia key={`${card.id}-${flipped ? 'back' : 'front'}`} side={side} onUpdate={updateSide} />
                <div className="flex flex-1 flex-col justify-center">
                  <textarea
                    value={side.text}
                    maxLength={CHAR_LIMIT}
                    placeholder={flipped ? 'Add your FlashCard Answer here' : 'Add your FlashCard Question here'}
                    onChange={(e) => updateSide({ ...side, text: e.target.value })}
                    rows={2}
                    className="w-full resize-none bg-transparent text-center text-lg font-semibold leading-7 text-neutral-900 outline-none placeholder:text-muted-fg"
                  />
                  <span className={`text-right text-[11px] font-medium leading-4 ${atLimit ? 'text-[#b91c1c]' : 'text-neutral-400'}`}>
                    {side.text.length} / {CHAR_LIMIT}
                  </span>
                </div>
              </>
            ) : (
              <>
                {side.imageUrl && (
                  <div className="rounded-lg border border-neutral-200 px-1 py-px shadow-[0_1px_5px_rgba(0,0,0,0.06)]">
                    <img src={side.imageUrl} alt={side.altText} className="max-h-48 rounded-lg object-cover" />
                  </div>
                )}
                <p className="text-center text-lg font-semibold leading-7 text-neutral-900">{side.text}</p>
              </>
            )}

            <p className="text-center text-xs font-light leading-4 text-muted-fg">{hint}</p>
          </div>
        </div>
      </div>

      {/* tab strip */}
      <div className="flex h-8 items-stretch overflow-hidden rounded-lg border border-line bg-cream-300">
        <button
          type="button"
          title="Previous card"
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1))
            setFlipped(false)
          }}
          className="flex w-10 items-center justify-center border-r border-line hover:bg-cream-100"
        >
          <KeyboardArrowLeftIcon size={22} />
        </button>

        {/* tab segments, left-aligned next to the prev chevron */}
        <div className="flex flex-1 items-stretch justify-start">
          <div className="flex items-stretch divide-x divide-line border-r border-line">
            {cards.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setIndex(i)
                  setFlipped(false)
                }}
                className={`group/tab flex items-center gap-2 px-4 text-sm text-neutral-900 hover:bg-cream-100 ${i === index ? 'bg-cream-100' : ''}`}
              >
                {i + 1}
                {editing && cards.length > 1 && (
                  <span
                    title="Delete card"
                    className="opacity-0 transition-opacity group-hover/tab:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      const nextCards = cards.filter((cc) => cc.id !== c.id)
                      onChange({ ...data, cards: nextCards })
                      setIndex((cur) => Math.min(cur, nextCards.length - 1))
                    }}
                  >
                    <CloseIcon size={14} className="text-neutral-500 hover:text-red-600" />
                  </span>
                )}
              </button>
            ))}
            {editing && (
              <button
                type="button"
                title="Add card"
                onClick={() => {
                  const nextCards = [...cards, { id: uid('fc'), front: emptySide(), back: emptySide() }]
                  onChange({ ...data, cards: nextCards })
                  setIndex(nextCards.length - 1)
                  setFlipped(false)
                }}
                className="flex w-12 items-center justify-center hover:bg-cream-100"
              >
                <AddIcon size={20} />
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          title="Next card"
          onClick={() => {
            setIndex((i) => Math.min(cards.length - 1, i + 1))
            setFlipped(false)
          }}
          className="flex w-10 items-center justify-center border-l border-line hover:bg-cream-100"
        >
          <KeyboardArrowRightIcon size={22} />
        </button>
      </div>
    </div>
  )
}
