import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { mIcon } from '../components/m-icon'
import type { InteractiveData } from '../types'
import { ErrorGenerateCard } from './shared'
import type { BlockProps } from './shared'

const FullscreenIcon = mIcon('fullscreen')
const FullscreenExitIcon = mIcon('fullscreen_exit')
const AutoAwesomeIcon = mIcon('auto_awesome')

const PHASES = ['Solid', 'Liquid', 'Gas'] as const
type Phase = (typeof PHASES)[number]

const PHASE_SPEED: Record<Phase, number> = { Solid: 0.15, Liquid: 0.8, Gas: 2.4 }

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  homeX: number
  homeY: number
}

/** Demo interactive: a small particle-motion simulator rendered on canvas. */
function ParticleSimulator({ interactive }: { interactive: boolean }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phase, setPhase] = useState<Phase>('Liquid')
  const phaseRef = useRef<Phase>(phase)
  phaseRef.current = phase

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const particles: Particle[] = []
    const cols = 8
    const rows = 4
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const homeX = 60 + c * 60
        const homeY = 60 + r * 55
        particles.push({ x: homeX, y: homeY, vx: 0, vy: 0, homeX, homeY })
      }
    }

    let raf = 0
    const step = (): void => {
      const { width, height } = canvas
      const speed = PHASE_SPEED[phaseRef.current]
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        if (phaseRef.current === 'Solid') {
          // vibrate around lattice position
          p.x = p.homeX + (Math.random() - 0.5) * 3
          p.y = p.homeY + (Math.random() - 0.5) * 3
        } else {
          p.vx += (Math.random() - 0.5) * speed
          p.vy += (Math.random() - 0.5) * speed
          const damping = phaseRef.current === 'Liquid' ? 0.92 : 0.99
          p.vx *= damping
          p.vy *= damping
          p.x += p.vx
          p.y += p.vy
          if (p.x < 10 || p.x > width - 10) p.vx *= -1
          if (p.y < 10 || p.y > height - 10) p.vy *= -1
          p.x = Math.max(10, Math.min(width - 10, p.x))
          p.y = Math.max(10, Math.min(height - 10, p.y))
        }
        ctx.beginPath()
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
        ctx.fillStyle = '#0382ed'
        ctx.globalAlpha = 0.85
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="text-sm font-medium text-neutral-900">Particle Motion Simulator</p>
        <div className="flex overflow-hidden rounded-lg border border-line bg-page shadow-xs">
          {PHASES.map((p) => (
            <button
              key={p}
              type="button"
              disabled={!interactive}
              onClick={() => setPhase(p)}
              className={`px-3 py-1 text-xs font-medium ${phase === p ? 'bg-navy text-cream' : 'text-neutral-700 hover:bg-cream-300'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} width={560} height={270} className="h-full w-full flex-1" />
    </div>
  )
}

export function InteractiveBlock({ data, status, viewMode, onGenerate }: BlockProps<InteractiveData>): ReactElement {
  const [fullscreen, setFullscreen] = useState(false)
  const editing = viewMode === 'edit'

  if (status === 'generation-failed') return <ErrorGenerateCard onRetry={onGenerate} />

  const hasContent = data.title !== ''

  const frame = (
    <div className={`relative overflow-hidden rounded-lg border border-line shadow-2xs ${fullscreen ? 'h-full' : 'h-[345px]'}`} style={{ backgroundColor: '#fcf8ec' }}>
      {hasContent ? (
        <ParticleSimulator interactive />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <AutoAwesomeIcon size={24} className="text-neutral-400" />
          <p className="text-sm text-muted-fg">
            {editing
              ? 'Interactive content is generated with AI — use the ✦ next to the block'
              : 'Interactive content is generated with AI'}
          </p>
        </div>
      )}

      {hasContent && (
        <button
          type="button"
          title={fullscreen ? 'Exit full screen' : 'View full screen'}
          onClick={() => setFullscreen((v) => !v)}
          className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-page shadow-xs hover:bg-cream-300"
        >
          {fullscreen ? <FullscreenExitIcon size={20} /> : <FullscreenIcon size={20} />}
        </button>
      )}
    </div>
  )

  if (fullscreen) {
    return <div className="fixed inset-0 z-50 bg-black/30 p-8">{frame}</div>
  }
  return frame
}
