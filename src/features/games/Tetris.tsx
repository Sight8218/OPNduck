import { useEffect, useRef, useState } from 'react'
import { readPalette, setupCanvas, useBest, useFrameLoop, useKeys, type Palette } from './kit'

const COLS = 10
const ROWS = 20
const CELL = 22
const W = COLS * CELL
const H = ROWS * CELL

const SHAPES: Record<string, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
}
const COLORS: Record<string, string> = { I: '#22d3ee', O: '#facc15', T: '#a78bfa', S: '#4ade80', Z: '#f87171', J: '#60a5fa', L: '#fb923c' }
const LINE_POINTS = [0, 100, 300, 500, 800]

interface Piece {
  type: string
  m: number[][]
  x: number
  y: number
}

const rotateCW = (m: number[][]) => m[0].map((_, c) => m.map((row) => row[c]).reverse())

function fresh() {
  return { board: Array.from({ length: ROWS }, () => Array<string>(COLS).fill('')), piece: null as Piece | null, bag: [] as string[], next: '' as string, acc: 0, score: 0, lines: 0, mode: 'ready' as 'ready' | 'play' | 'paused' | 'dead' }
}

function collides(board: string[][], m: number[][], x: number, y: number) {
  for (let r = 0; r < m.length; r++)
    for (let c = 0; c < m[r].length; c++) {
      if (!m[r][c]) continue
      const bx = x + c
      const by = y + r
      if (bx < 0 || bx >= COLS || by >= ROWS) return true
      if (by >= 0 && board[by][bx]) return true
    }
  return false
}

// @category: games/tetris
export default function Tetris() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ctx = useRef<CanvasRenderingContext2D | null>(null)
  const pal = useRef<Palette | null>(null)
  const g = useRef(fresh())
  const [best, reportBest] = useBest('tetris')
  const [hud, setHud] = useState({ score: 0, lines: 0, next: '' })
  const shown = useRef(hud)

  useEffect(() => {
    ctx.current = setupCanvas(canvas.current!, W, H)
    pal.current = readPalette()
  }, [])

  function draw7(): string {
    const s = g.current
    if (!s.bag.length) {
      s.bag = Object.keys(SHAPES)
      for (let i = s.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[s.bag[i], s.bag[j]] = [s.bag[j], s.bag[i]]
      }
    }
    return s.bag.pop()!
  }

  function spawn() {
    const s = g.current
    const type = s.next || draw7()
    s.next = draw7()
    const m = SHAPES[type].map((row) => [...row])
    s.piece = { type, m, x: Math.floor((COLS - m[0].length) / 2), y: type === 'I' ? -1 : 0 }
    if (collides(s.board, m, s.piece.x, s.piece.y)) {
      s.mode = 'dead'
      reportBest(s.score)
    }
    sync()
  }

  /** Copies score, lines and the next piece to the side panel when they changed. */
  function sync() {
    const s = g.current
    const h = shown.current
    if (h.score === s.score && h.lines === s.lines && h.next === s.next) return
    shown.current = { score: s.score, lines: s.lines, next: s.next }
    setHud(shown.current)
  }

  function lock() {
    const s = g.current
    const p = s.piece!
    p.m.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v && p.y + r >= 0) s.board[p.y + r][p.x + c] = p.type
      }),
    )
    const kept = s.board.filter((row) => row.some((v) => !v))
    const cleared = ROWS - kept.length
    if (cleared) {
      s.board = [...Array.from({ length: cleared }, () => Array<string>(COLS).fill('')), ...kept]
      s.lines += cleared
      s.score += LINE_POINTS[cleared] * (1 + Math.floor(s.lines / 10))
    }
    spawn()
  }

  function tryMove(dx: number, dy: number): boolean {
    const s = g.current
    const p = s.piece
    if (!p || collides(s.board, p.m, p.x + dx, p.y + dy)) return false
    p.x += dx
    p.y += dy
    return true
  }

  function turn() {
    const s = g.current
    const p = s.piece
    if (!p || p.type === 'O') return
    const m = rotateCW(p.m)
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(s.board, m, p.x + kick, p.y)) {
        p.m = m
        p.x += kick
        return
      }
    }
  }

  useKeys((key) => {
    const s = g.current
    if (s.mode === 'dead' || s.mode === 'ready') {
      if (key === ' ' || key === 'Enter') {
        g.current = fresh()
        g.current.mode = 'play'
        spawn()
      }
      return
    }
    if (key === 'p' || key === 'P') s.mode = s.mode === 'paused' ? 'play' : 'paused'
    if (s.mode !== 'play') return
    if (key === 'ArrowLeft') tryMove(-1, 0)
    else if (key === 'ArrowRight') tryMove(1, 0)
    else if (key === 'ArrowUp') turn()
    else if (key === 'ArrowDown') {
      if (tryMove(0, 1)) s.score += 1
    } else if (key === ' ') {
      let drop = 0
      while (tryMove(0, 1)) drop += 2
      s.score += drop
      lock()
    }
  })

  useFrameLoop((dt) => {
    const c = ctx.current
    const p = pal.current
    if (!c || !p) return
    const s = g.current
    sync()
    if (s.mode === 'play' && s.piece) {
      s.acc += dt
      const interval = Math.max(0.08, 0.8 - Math.floor(s.lines / 10) * 0.07)
      if (s.acc >= interval) {
        s.acc = 0
        if (!tryMove(0, 1)) lock()
      }
    }
    c.fillStyle = p.bg
    c.fillRect(0, 0, W, H)
    c.strokeStyle = p.dim
    c.globalAlpha = 0.12
    for (let x = 1; x < COLS; x++) {
      c.beginPath()
      c.moveTo(x * CELL, 0)
      c.lineTo(x * CELL, H)
      c.stroke()
    }
    c.globalAlpha = 1
    const block = (x: number, y: number, color: string) => {
      c.fillStyle = color
      c.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2)
    }
    s.board.forEach((row, y) => row.forEach((v, x) => v && block(x, y, COLORS[v])))
    const piece = s.piece
    if (piece && s.mode !== 'dead') {
      let gy = piece.y
      while (!collides(s.board, piece.m, piece.x, gy + 1)) gy++
      c.globalAlpha = 0.25
      piece.m.forEach((row, r) => row.forEach((v, cc) => v && gy + r >= 0 && block(piece.x + cc, gy + r, COLORS[piece.type])))
      c.globalAlpha = 1
      piece.m.forEach((row, r) => row.forEach((v, cc) => v && piece.y + r >= 0 && block(piece.x + cc, piece.y + r, COLORS[piece.type])))
    }
    c.fillStyle = p.text
    c.textAlign = 'center'
    c.font = '13px monospace'
    if (s.mode !== 'play') {
      c.globalAlpha = 0.8
      c.fillStyle = p.bg
      c.fillRect(0, H / 2 - 42, W, 84)
      c.globalAlpha = 1
      c.fillStyle = p.text
      c.font = 'bold 18px monospace'
      c.fillText(s.mode === 'dead' ? 'Stack overflow' : s.mode === 'paused' ? 'Paused' : 'Tetris', W / 2, H / 2 - 8)
      c.font = '12px monospace'
      c.fillText(s.mode === 'paused' ? 'Press P to continue' : 'Press Space to start', W / 2, H / 2 + 16)
    }
  })

  return (
    <div className="flex items-start justify-center gap-4">
      <canvas ref={canvas} style={{ width: W, height: H }} className="rounded-xl border border-[var(--glass-border)]" />
      <div className="flex w-28 flex-col gap-2 text-xs text-[var(--text-dim)]">
        <span>Score {hud.score}</span>
        <span>Lines {hud.lines}</span>
        <span>Best {best ?? 0}</span>
        <div className="mt-1 rounded-lg bg-[var(--input-bg)] p-2">
          <span className="mb-1 block">Next</span>
          <span className="text-base font-bold" style={{ color: COLORS[hud.next] }}>
            {hud.next || '–'}
          </span>
        </div>
        <span className="mt-2 text-[11px] leading-snug text-[var(--text-faint)]">
          ← → move
          <br />↑ rotate
          <br />↓ soft drop
          <br />Space hard drop
          <br />P pause
        </span>
      </div>
    </div>
  )
}
