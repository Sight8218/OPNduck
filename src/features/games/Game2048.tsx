import { useRef, useState } from 'react'
import { useBest, useKeys } from './kit'

type Board = number[][]
const N = 4

function empty(): Board {
  return Array.from({ length: N }, () => Array<number>(N).fill(0))
}

function addTile(b: Board): Board {
  const cells: [number, number][] = []
  b.forEach((row, r) => row.forEach((v, c) => v === 0 && cells.push([r, c])))
  if (!cells.length) return b
  const [r, c] = cells[Math.floor(Math.random() * cells.length)]
  const next = b.map((row) => [...row])
  next[r][c] = Math.random() < 0.9 ? 2 : 4
  return next
}

function start(): Board {
  return addTile(addTile(empty()))
}

/** Slides one row to the left, merging equal neighbours once. Returns the new row and the points gained. */
function slideRow(row: number[]): { row: number[]; gained: number } {
  const tiles = row.filter(Boolean)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2)
      gained += tiles[i] * 2
      i++
    } else out.push(tiles[i])
  }
  while (out.length < N) out.push(0)
  return { row: out, gained }
}

const rotate = (b: Board): Board => b[0].map((_, c) => b.map((row) => row[c]).reverse()) // 90° clockwise

/** Moves in one of 4 directions (0 left, 1 up, 2 right, 3 down) by rotating the board so it is always a left move. */
function move(b: Board, dir: number): { board: Board; gained: number; moved: boolean } {
  let turned = b
  for (let i = 0; i < dir; i++) turned = rotate(turned)
  let gained = 0
  let slid = turned.map((row) => {
    const r = slideRow(row)
    gained += r.gained
    return r.row
  })
  for (let i = 0; i < (4 - dir) % 4; i++) slid = rotate(slid)
  const moved = slid.some((row, r) => row.some((v, c) => v !== b[r][c]))
  return { board: slid, gained, moved }
}

const canMove = (b: Board) => [0, 1, 2, 3].some((d) => move(b, d).moved)

const COLORS: Record<number, string> = { 0: 'transparent', 2: '#eee4da', 4: '#ede0c8', 8: '#f2b179', 16: '#f59563', 32: '#f67c5f', 64: '#f65e3b', 128: '#edcf72', 256: '#edcc61', 512: '#edc850', 1024: '#edc53f', 2048: '#edc22e' }
const KEYS: Record<string, number> = { ArrowLeft: 0, ArrowUp: 1, ArrowRight: 2, ArrowDown: 3, a: 0, w: 1, d: 2, s: 3 }

// @category: games/2048
export default function Game2048() {
  const [board, setBoard] = useState<Board>(start)
  const [score, setScore] = useState(0)
  const [won, setWon] = useState(false)
  const [best, reportBest] = useBest('2048')
  const dead = !canMove(board)
  const touch = useRef<{ x: number; y: number } | null>(null)

  function play(dir: number) {
    if (dead) return
    const r = move(board, dir)
    if (!r.moved) return
    const next = addTile(r.board)
    const total = score + r.gained
    setBoard(next)
    setScore(total)
    reportBest(total)
    if (!won && next.some((row) => row.includes(2048))) setWon(true)
  }

  function restart() {
    setBoard(start())
    setScore(0)
    setWon(false)
  }

  useKeys((key) => {
    if (key in KEYS) play(KEYS[key])
  })

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-[272px] items-center justify-between text-xs text-[var(--text-dim)]">
        <span>Score {score} · Best {best ?? 0}</span>
        <button type="button" className="glass-btn" onClick={restart}>
          New game
        </button>
      </div>
      <div
        className="relative grid grid-cols-4 gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] p-2"
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.clientX - t.x
          const dy = e.clientY - t.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
          play(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 0 : 2) : dy < 0 ? 1 : 3)
        }}
      >
        {board.flat().map((v, i) => (
          <div
            key={i}
            className="flex h-14 w-14 items-center justify-center rounded-lg text-lg font-bold text-[#3c3a32] transition-colors"
            style={{ background: v ? COLORS[v] ?? '#3c3a32' : 'color-mix(in srgb, var(--text) 8%, transparent)', color: v > 4096 ? '#fff' : undefined, fontSize: v >= 1024 ? 15 : undefined }}
          >
            {v || ''}
          </div>
        ))}
        {(dead || won) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[var(--bg-solid)]/80 text-sm font-bold">
            <span>{dead ? 'No moves left' : 'You made 2048! 🦆'}</span>
            {won && !dead ? (
              <button type="button" className="glass-btn" onClick={() => setWon(false)}>
                Keep going
              </button>
            ) : (
              <button type="button" className="glass-btn" onClick={restart}>
                Try again
              </button>
            )}
          </div>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-faint)]">Arrow keys, WASD or swipe</span>
    </div>
  )
}
