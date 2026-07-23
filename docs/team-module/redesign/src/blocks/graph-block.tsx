import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { GraphData, GraphKind, GraphPoint } from '../types'
import { GRAPH_KINDS } from '../types'
import { uid } from '../editor/uid'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const KeyboardArrowDownIcon = mIcon('keyboard_arrow_down')
const CloseIcon = mIcon('close')

const KIND_LABELS: Record<GraphKind, string> = {
  bar: 'Bar Chart',
  line: 'Line Chart',
  scatter: 'Scatter Chart',
  area: 'Area Chart',
}

/** Series colors from the Graph Figma page (3265:983). */
const SERIES_COLORS: Record<GraphKind, string> = {
  bar: '#0382ed',
  line: '#0e3354',
  scatter: '#dca2fd',
  area: '#ff6713',
}

const PLOT_W = 640
const PLOT_H = 206
const VIEW_H = PLOT_H + 20

function niceMax(values: number[]): number {
  const max = Math.max(0, ...values.filter(Number.isFinite))
  if (max <= 0) return 100
  const raw = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = Math.ceil(raw / magnitude) * magnitude
  return step * 4
}

interface Scales {
  y: (v: number) => number
  cx: (p: GraphPoint, i: number) => number
}

function makeScales(kind: GraphKind, slots: number, yMax: number, xMax: number): Scales {
  const n = Math.max(slots, 1)
  const slotW = PLOT_W / n
  return {
    y: (v) => PLOT_H - (Math.max(0, v) / yMax) * PLOT_H,
    cx: (p, i) =>
      kind === 'scatter' ? 16 + (Math.max(0, p.x) / xMax) * (PLOT_W - 48) : slotW * i + slotW / 2,
  }
}

function Chart({
  kind,
  points,
  yMax,
  xMax,
  showValues,
  onAddPoint,
}: {
  kind: GraphKind
  points: GraphPoint[]
  yMax: number
  xMax: number
  /** Render value labels inside the SVG (read-only views). */
  showValues: boolean
  /** Render the dashed ghost add slot at the end of the series (editor). */
  onAddPoint?: () => void
}): ReactElement {
  const color = SERIES_COLORS[kind]
  const slots = points.length + (onAddPoint ? 1 : 0)
  const { y, cx } = makeScales(kind, slots, yMax, xMax)
  const n = Math.max(slots, 1)
  const slotW = PLOT_W / n

  return (
    <svg viewBox={`0 0 ${PLOT_W} ${VIEW_H}`} className="w-full">
      {/* dashed gridlines at quarters */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={0}
          x2={PLOT_W}
          y1={PLOT_H * f}
          y2={PLOT_H * f}
          stroke="#e5e5e5"
          strokeWidth={1}
          strokeDasharray={kind === 'line' ? undefined : '4 4'}
        />
      ))}
      {/* scatter gets a full grid with vertical lines too */}
      {kind === 'scatter' &&
        [0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PLOT_W * f}
            x2={PLOT_W * f}
            y1={0}
            y2={PLOT_H}
            stroke="#e5e5e5"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}

      {kind === 'bar' &&
        points.map((p, i) => {
          const barW = Math.min(slotW - 40, 130)
          const top = y(p.value)
          return (
            <g key={p.id}>
              <path
                d={`M${cx(p, i) - barW / 2},${PLOT_H} V${top + 8} Q${cx(p, i) - barW / 2},${top} ${cx(p, i) - barW / 2 + 8},${top} H${cx(p, i) + barW / 2 - 8} Q${cx(p, i) + barW / 2},${top} ${cx(p, i) + barW / 2},${top + 8} V${PLOT_H} Z`}
                fill={color}
              />
              {showValues && (
                <text x={cx(p, i)} y={top - 6} textAnchor="middle" fontSize={11} fill="#737373">
                  {p.value}
                </text>
              )}
            </g>
          )
        })}

      {(kind === 'line' || kind === 'area') && points.length > 0 && (
        <>
          {kind === 'area' && (
            <polygon
              points={`${cx(points[0], 0)},${PLOT_H} ${points.map((p, i) => `${cx(p, i)},${y(p.value)}`).join(' ')} ${cx(points[points.length - 1], points.length - 1)},${PLOT_H}`}
              fill={color}
              opacity={0.38}
            />
          )}
          <polyline
            points={points.map((p, i) => `${cx(p, i)},${y(p.value)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
          {points.map((p, i) => (
            <g key={p.id}>
              <circle cx={cx(p, i)} cy={y(p.value)} r={5} fill={color} />
              {showValues && (
                <text x={cx(p, i)} y={y(p.value) - 10} textAnchor="middle" fontSize={11} fill="#737373">
                  {p.value}
                </text>
              )}
            </g>
          ))}
        </>
      )}

      {kind === 'scatter' &&
        points.map((p, i) => {
          // a point missing its Y value sits hollow-red on the x-axis (Error/value missing)
          const missing = !Number.isFinite(p.value)
          const cy = missing ? PLOT_H : y(p.value)
          return (
            <g key={p.id}>
              <circle
                cx={cx(p, i)}
                cy={cy}
                r={5}
                fill={missing ? 'none' : color}
                stroke={missing ? '#dc2626' : undefined}
                strokeWidth={missing ? 2 : undefined}
              />
              {showValues && (
                <text x={cx(p, i)} y={cy - 10} textAnchor="middle" fontSize={11} fill={missing ? '#b91c1c' : '#737373'}>
                  {p.x}, {missing ? 'y' : p.value}
                </text>
              )}
            </g>
          )
        })}


      {/* ghost add slot — dashed bar / circle at the end of the series (Figma State/Empty) */}
      {onAddPoint && (() => {
        const gi = points.length
        const gx = kind === 'scatter' ? 16 + 0.88 * (PLOT_W - 48) : slotW * gi + slotW / 2
        const gy = kind === 'scatter' ? PLOT_H * 0.45 : PLOT_H
        if (kind === 'bar') {
          const barW = Math.min(slotW - 40, 130)
          const ghostH = 77
          return (
            <g className="cursor-pointer" onClick={onAddPoint}>
              <text x={gx} y={PLOT_H - ghostH - 8} textAnchor="middle" fontSize={11} fill="#737373">
                value
              </text>
              <rect
                x={gx - barW / 2}
                y={PLOT_H - ghostH}
                width={barW}
                height={ghostH}
                rx={8}
                fill="#fcf8ec"
                stroke="#d6d0c2"
                strokeWidth={1}
                strokeDasharray="5 4"
              />
              <text x={gx} y={PLOT_H - ghostH / 2 + 5} textAnchor="middle" fontSize={17} fill="#737373">
                +
              </text>
            </g>
          )
        }
        return (
          <g className="cursor-pointer" onClick={onAddPoint}>
            {kind === 'scatter' && (
              <text x={gx} y={gy - 16} textAnchor="middle" fontSize={11} fill="#737373">
                x, y
              </text>
            )}
            <circle
              cx={gx}
              cy={kind === 'scatter' ? gy : y(points[points.length - 1]?.value ?? yMax / 2)}
              r={9}
              fill="#fcf8ec"
              stroke={kind === 'scatter' ? '#dca2fd' : '#d6d0c2'}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={gx}
              y={(kind === 'scatter' ? gy : y(points[points.length - 1]?.value ?? yMax / 2)) + 4}
              textAnchor="middle"
              fontSize={12}
              fill="#737373"
            >
              +
            </text>
          </g>
        )
      })()}

      {/* x axis: numeric ticks for scatter, item labels otherwise */}
      {kind === 'scatter'
        ? [0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={16 + f * (PLOT_W - 48)} y={PLOT_H + 14} textAnchor="middle" fontSize={11} fill="rgba(0,0,0,0.3)">
              {Math.round(xMax * f)}
            </text>
          ))
        : onAddPoint
          ? null /* editor: labels are editable HTML inputs overlaid below the plot */
          : points.map((p, i) => (
              <text key={p.id} x={cx(p, i)} y={PLOT_H + 14} textAnchor="middle" fontSize={11} fill="#737373">
                {p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}
              </text>
            ))}
    </svg>
  )
}

export function GraphBlock({ data, status, viewMode, onChange, onGenerate }: BlockProps<GraphData>): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
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

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const yMax = niceMax(data.points.map((p) => p.value))
  const xMax = niceMax(data.points.map((p) => p.x))
  const missingLabel = data.kind !== 'scatter' && data.points.some((p) => p.label.trim() === '')
  const missingValue = data.kind === 'scatter' && data.points.some((p) => !Number.isFinite(p.value))
  const setPoint = (i: number, point: GraphPoint): void =>
    onChange({ ...data, points: data.points.map((p, pi) => (pi === i ? point : p)) })

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f))
  const editorSlots = data.points.length + (editing ? 1 : 0)
  const { y, cx } = makeScales(data.kind, editorSlots, yMax, xMax)

  const addPoint = (): void =>
    onChange({
      ...data,
      points: [
        ...data.points,
        {
          id: uid('pt'),
          label: '',
          value: Math.max(1, Math.round(yMax / 4)),
          x: Math.round(Math.min(xMax, (data.points.length + 1) * (xMax / 5))),
        },
      ],
    })

  /* value editing happens directly on the chart via a % positioned overlay */
  const chartArea = (
    <div className="relative">
      <Chart kind={data.kind} points={data.points} yMax={yMax} xMax={xMax} showValues={!editing} onAddPoint={editing ? addPoint : undefined} />
      {editing && (
        <div className="pointer-events-none absolute inset-0">
          {data.points.map((p, i) => {
            const leftPct = Math.min(93, Math.max(5, (cx(p, i) / PLOT_W) * 100))
            const pointY = Number.isFinite(p.value) ? y(p.value) : PLOT_H
            const topPct = (Math.max(0, pointY - 22) / VIEW_H) * 100
            return (
              <div
                key={p.id}
                className="group/pt pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5"
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              >
                {data.kind === 'scatter' && (
                  <>
                    <input
                      value={String(p.x)}
                      title="Edit x coordinate"
                      onChange={(e) => {
                        const x = Number(e.target.value)
                        setPoint(i, { ...p, x: Number.isFinite(x) ? x : 0 })
                      }}
                      className="w-8 rounded border border-transparent bg-transparent text-center text-[11px] text-muted-fg outline-none focus:border-line focus:bg-white"
                    />
                    <span className="text-[11px] text-muted-fg">,</span>
                  </>
                )}
                <input
                  value={Number.isFinite(p.value) ? String(p.value) : ''}
                  placeholder="y"
                  title={data.kind === 'scatter' ? 'Edit y coordinate' : 'Edit value'}
                  onChange={(e) => {
                    const value = Number(e.target.value)
                    setPoint(i, { ...p, value: Number.isFinite(value) ? value : 0 })
                  }}
                  className="w-9 rounded border border-transparent bg-transparent text-center text-[11px] text-muted-fg outline-none focus:border-line focus:bg-white"
                />
                {data.kind === 'scatter' && (
                  <button
                    type="button"
                    title="Delete point"
                    onClick={() => onChange({ ...data, points: data.points.filter((_, pi) => pi !== i) })}
                    className="opacity-0 transition-opacity group-hover/pt:opacity-100"
                  >
                    <CloseIcon size={14} className="text-neutral-500 hover:text-red-600" />
                  </button>
                )}
              </div>
            )
          })}
          {/* editable x-axis item titles, sitting above the axis title */}
          {data.kind !== 'scatter' &&
            data.points.map((p, i) => {
              const leftPct = Math.min(93, Math.max(5, (cx(p, i) / PLOT_W) * 100))
              return (
                <div
                  key={p.id}
                  className="group/lbl pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5"
                  style={{ left: `${leftPct}%`, top: `${((PLOT_H + 3) / VIEW_H) * 100}%` }}
                >
                  <input
                    value={p.label}
                    placeholder="Edit Item here"
                    onChange={(e) => setPoint(i, { ...p, label: e.target.value })}
                    className={`w-20 rounded border border-transparent bg-transparent text-center text-[11px] leading-[14px] outline-none placeholder:text-black/30 focus:border-line focus:bg-white ${p.label.trim() === '' ? 'text-[#c53030]' : 'text-muted-fg'}`}
                    title={p.label}
                  />
                  <button
                    type="button"
                    title="Delete item"
                    onClick={() => onChange({ ...data, points: data.points.filter((_, pi) => pi !== i) })}
                    className="opacity-0 transition-opacity group-hover/lbl:opacity-100"
                  >
                    <CloseIcon size={14} className="text-neutral-500 hover:text-red-600" />
                  </button>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )

  const chartWithAxes = (
    <div className="flex w-full items-stretch gap-2">
      <div className="flex items-center gap-2">
        <span className="-rotate-90 whitespace-nowrap text-[11px] leading-[14px] text-muted-fg">
          {editing ? (
            <input
              value={data.yLabel}
              placeholder="Y- axis title here"
              onChange={(e) => onChange({ ...data, yLabel: e.target.value })}
              className="w-24 bg-transparent text-center text-[11px] outline-none placeholder:text-black/30"
            />
          ) : (
            data.yLabel
          )}
        </span>
        <div className="flex h-[206px] flex-col justify-between text-right text-[11px] leading-[14px] text-black/30">
          {[...yTicks].reverse().map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {chartArea}
        <p className="mt-1 text-center text-[11px] leading-[14px] text-muted-fg">
          {editing ? (
            <input
              value={data.xLabel}
              placeholder="X - axis title here"
              onChange={(e) => onChange({ ...data, xLabel: e.target.value })}
              className="w-40 bg-transparent text-center text-[11px] outline-none placeholder:text-black/30"
            />
          ) : (
            data.xLabel
          )}
        </p>
      </div>
    </div>
  )

  if (!editing) {
    return (
      <div className="px-2 py-2">
        {data.title && <p className="mb-3 text-center font-serif text-2xl leading-8 text-black/80">{data.title}</p>}
        {chartWithAxes}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-line bg-cream-300 p-2.5 shadow-2xs transition-shadow focus-within:shadow-md">
      <div className="flex w-full items-start justify-between">
        {/* chart-type switcher */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-[152px] items-center justify-between rounded-lg border border-line bg-page px-3 py-2 shadow-xs"
          >
            <span className="text-sm font-medium leading-5 text-muted-fg">{KIND_LABELS[data.kind]}</span>
            <KeyboardArrowDownIcon size={22} className="text-muted-fg" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-11 z-20 w-[152px] rounded-lg border border-line bg-page p-1 shadow-xs">
              {GRAPH_KINDS.map((kind, i) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => {
                    onChange({ ...data, kind })
                    setMenuOpen(false)
                  }}
                  className={`block w-full p-2 text-left text-sm font-medium leading-5 text-muted-fg hover:bg-cream-300 ${i < GRAPH_KINDS.length - 1 ? 'border-b border-line' : ''}`}
                >
                  {KIND_LABELS[kind]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        value={data.title}
        placeholder="Chart title"
        onChange={(e) => onChange({ ...data, title: e.target.value })}
        className="w-full bg-transparent text-center font-serif text-2xl leading-8 text-black/80 outline-none placeholder:text-muted-fg"
      />

      {/* validation banners (Figma Error/item missing, Error/value missing) */}
      {missingLabel && (
        <div className="w-full rounded-md border border-[#fca5a5] bg-[#fee2e2] px-3 py-1.5 text-[11px] text-[#b91c1c]">
          Item title is required
        </div>
      )}
      {missingValue && (
        <div className="w-full rounded-md border border-[#fca5a5] bg-[#fee2e2] px-3 py-1.5 text-[11px] text-[#b91c1c]">
          Missing Y coordinate value required
        </div>
      )}

      {chartWithAxes}

    </div>
  )
}
