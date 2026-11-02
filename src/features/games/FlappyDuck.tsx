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

// The duck from the startup screen (index.html), drawn from the same 64x64 paths.
const DUCK_BODY = typeof Path2D === 'undefined' ? null : new Path2D('M10 38c0-8 7-13 15-13h4c-2-9 3-17 12-17 8 0 13 6 13 13 0 0-1 0-2 0l7 3-7 3c-1 14-8 23-18 23H26C16 49 10 45 10 38z')
const DUCK_BELLY = typeof Path2D === 'undefined' ? null : new Path2D('M24 38c0 5 5 8 11 8 7 0 12-3 13-8-5 2-10 2-14 1-4-1-7-3-10-1z')
const DUCK_SCALE = 0.62

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
    c.fillStyle = p.accentSoft
    c.globalAlpha = 0.4
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
    c.rotate(Math.max(-0.12, Math.min(0.3, s.vy / 1800))) // a gentle tilt, not a swing
    c.scale(DUCK_SCALE, DUCK_SCALE)
    c.translate(-34, -28) // the duck's centre in its 64x64 drawing
    if (DUCK_BODY && DUCK_BELLY) {
      c.fillStyle = p.accent
      c.fill(DUCK_BODY)
      c.globalAlpha = 0.55
      c.fill(DUCK_BELLY)
      c.globalAlpha = 1
      c.fillStyle = p.bg
      c.beginPath()
      c.arc(45, 17, 2.4, 0, Math.PI * 2)
      c.fill()
    }
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
