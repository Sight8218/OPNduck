import { useEffect, useRef, useState } from 'react'
import { readPalette, setupCanvas, useBest, useFrameLoop, useKeys, type Palette } from './kit'

const N = 20
const CELL = 16
const SIZE = N * CELL
const DIRS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }

type P = [number, number]

function freshState() {
  return { snake: [[10, 10], [9, 10], [8, 10]] as P[], dir: [1, 0] as P, queue: [] as P[], food: [15, 10] as P, acc: 0, mode: 'ready' as 'ready' | 'play' | 'dead', score: 0 }
}

function placeFood(snake: P[]): P {
  for (;;) {
    const f: P = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]
    if (!snake.some(([x, y]) => x === f[0] && y === f[1])) return f
  }
}

// @category: games/snake
export default function Snake() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ctx = useRef<CanvasRenderingContext2D | null>(null)
  const pal = useRef<Palette | null>(null)
  const g = useRef(freshState())
  const [best, reportBest] = useBest('snake')
  const [score, setScore] = useState(0)

  useEffect(() => {
    ctx.current = setupCanvas(canvas.current!, SIZE, SIZE)
    pal.current = readPalette()
  }, [])

  useKeys((key) => {
    const s = g.current
    const d = DIRS[key]
    if (d) {
      if (s.mode === 'dead') return
      const ref = s.queue.length ? s.queue[s.queue.length - 1] : s.dir
      if (d[0] === -ref[0] && d[1] === -ref[1]) return // can't reverse into yourself
      if (d[0] === ref[0] && d[1] === ref[1]) return
      if (s.queue.length < 3) s.queue.push(d)
      s.mode = 'play'
    } else if (key === ' ' || key === 'Enter') {
      if (s.mode === 'dead') {
        g.current = freshState()
        setScore(0)
      }
    }
  })

  useFrameLoop((dt) => {
    const c = ctx.current
    const p = pal.current
    if (!c || !p) return
    const s = g.current
    if (s.mode === 'play') {
      s.acc += dt
      const interval = Math.max(0.06, 0.13 - s.score * 0.002)
      while (s.acc >= interval && s.mode === 'play') {
        s.acc -= interval
        if (s.queue.length) s.dir = s.queue.shift()!
        const head: P = [s.snake[0][0] + s.dir[0], s.snake[0][1] + s.dir[1]]
        const eats = head[0] === s.food[0] && head[1] === s.food[1]
        const body = eats ? s.snake : s.snake.slice(0, -1)
        if (head[0] < 0 || head[1] < 0 || head[0] >= N || head[1] >= N || body.some(([x, y]) => x === head[0] && y === head[1])) {
          s.mode = 'dead'
          reportBest(s.score)
          break
        }
        s.snake.unshift(head)
        if (eats) {
          s.score += 1
          setScore(s.score)
          s.food = placeFood(s.snake)
        } else s.snake.pop()
      }
    }
    c.fillStyle = p.bg
    c.fillRect(0, 0, SIZE, SIZE)
    c.fillStyle = p.accent
    s.snake.forEach(([x, y], i) => {
      c.globalAlpha = i === 0 ? 1 : 0.75
      c.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
    })
    c.globalAlpha = 1
    c.font = '14px sans-serif'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText('🍞', s.food[0] * CELL + CELL / 2, s.food[1] * CELL + CELL / 2 + 1)
    c.fillStyle = p.text
    c.font = '13px monospace'
    if (s.mode === 'ready') c.fillText('Arrow keys or WASD to start', SIZE / 2, SIZE / 2 + 40)
    if (s.mode === 'dead') {
      c.font = 'bold 20px monospace'
      c.fillText('Game over', SIZE / 2, SIZE / 2 - 8)
      c.font = '13px monospace'
      c.fillText('Press Space to play again', SIZE / 2, SIZE / 2 + 16)
    }
  })

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} className="rounded-xl border border-[var(--glass-border)]" />
      <span className="text-xs text-[var(--text-dim)]">Bread {score} · Best {best ?? 0}</span>
    </div>
  )
}
