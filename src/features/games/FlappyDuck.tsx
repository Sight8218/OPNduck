import { useEffect, useRef, useState } from 'react'
import { readPalette, setupCanvas, useBest, useFrameLoop, useKeys, type Palette } from './kit'

const W = 320
const H = 480
const GROUND = 40
const GRAVITY = 1400
const FLAP = -400
const SPEED = 130
const GAP = 135
const SPACING = 190
const PIPE_W = 52
const R = 12

interface Pipe {
  x: number
  gapY: number
  passed: boolean
}

// @category: games/flappyduck
export default function FlappyDuck() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ctx = useRef<CanvasRenderingContext2D | null>(null)
  const pal = useRef<Palette | null>(null)
  const g = useRef({ y: H / 2, vy: 0, pipes: [] as Pipe[], score: 0, mode: 'ready' as 'ready' | 'play' | 'dead', t: 0 })
  const [best, reportBest] = useBest('flappyduck')
  const [score, setScore] = useState(0)

  useEffect(() => {
    ctx.current = setupCanvas(canvas.current!, W, H)
    pal.current = readPalette()
  }, [])

  function reset() {
    Object.assign(g.current, { y: H / 2, vy: 0, pipes: [], score: 0, mode: 'ready', t: 0 })
    setScore(0)
  }

  function flap() {
    const s = g.current
    if (s.mode === 'dead') return reset()
    if (s.mode === 'ready') s.mode = 'play'
    s.vy = FLAP
  }

  useKeys((key) => {
    if (key === ' ' || key === 'ArrowUp') flap()
  })

  useFrameLoop((dt) => {
    const c = ctx.current
    const p = pal.current
    if (!c || !p) return
    const s = g.current
    s.t += dt
    if (s.mode === 'ready') s.y = H / 2 + Math.sin(s.t * 4) * 6
    if (s.mode === 'play') {
      s.vy += GRAVITY * dt
      s.y += s.vy * dt
      for (const pipe of s.pipes) pipe.x -= SPEED * dt
      const last = s.pipes[s.pipes.length - 1]
      if (!last || last.x < W - SPACING) s.pipes.push({ x: W + 10, gapY: 90 + Math.random() * (H - GROUND - GAP - 140), passed: false })
      if (s.pipes[0] && s.pipes[0].x < -PIPE_W) s.pipes.shift()
      const dx = 70
      for (const pipe of s.pipes) {
        if (!pipe.passed && pipe.x + PIPE_W < dx - R) {
          pipe.passed = true
          s.score += 1
          setScore(s.score)
        }
        const hitX = dx + R > pipe.x && dx - R < pipe.x + PIPE_W
        if (hitX && (s.y - R < pipe.gapY || s.y + R > pipe.gapY + GAP)) s.mode = 'dead'
      }
      if (s.y + R > H - GROUND || s.y - R < 0) s.mode = 'dead'
      if (s.mode === 'dead') reportBest(s.score)
    }

    c.fillStyle = p.bg
    c.fillRect(0, 0, W, H)
    c.fillStyle = p.accent
    c.globalAlpha = 0.85
    for (const pipe of s.pipes) {
      c.fillRect(pipe.x, 0, PIPE_W, pipe.gapY)
      c.fillRect(pipe.x, pipe.gapY + GAP, PIPE_W, H - GROUND - pipe.gapY - GAP)
      c.fillRect(pipe.x - 4, pipe.gapY - 14, PIPE_W + 8, 14)
      c.fillRect(pipe.x - 4, pipe.gapY + GAP, PIPE_W + 8, 14)
    }
    c.globalAlpha = 1
    c.fillStyle = p.accentSoft
    c.fillRect(0, H - GROUND, W, GROUND)
    c.save()
    c.translate(70, s.y)
    c.rotate(Math.max(-0.5, Math.min(1, s.vy / 600)))
    c.font = '26px sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('🦆', 0, 0)
    c.restore()
    c.fillStyle = p.text
    c.textAlign = 'center'
    c.font = 'bold 34px monospace'
    c.fillText(String(s.score), W / 2, 50)
    c.font = '14px monospace'
    if (s.mode === 'ready') c.fillText('Click or press Space to flap', W / 2, H / 2 + 60)
    if (s.mode === 'dead') {
      c.font = 'bold 22px monospace'
      c.fillText('Splash!', W / 2, H / 2 - 10)
      c.font = '14px monospace'
      c.fillText('Click or Space to try again', W / 2, H / 2 + 18)
    }
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvas} style={{ width: W, height: H }} className="cursor-pointer rounded-xl border border-[var(--glass-border)]" onPointerDown={flap} />
      <span className="text-xs text-[var(--text-dim)]">Score {score} · Best {best ?? 0}</span>
    </div>
  )
}
