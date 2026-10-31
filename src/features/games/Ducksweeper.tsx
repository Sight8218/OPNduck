import { useEffect, useState } from 'react'
import { useBest } from './kit'

const ROWS = 9
const COLS = 9
const MINES = 10
const NUM_COLORS = ['', '#60a5fa', '#4ade80', '#f87171', '#a78bfa', '#fb923c', '#22d3ee', '#e5e7eb', '#9ca3af']

interface Cell {
  duck: boolean
  open: boolean
  flag: boolean
  near: number
}

const neighbours = (r: number, c: number) => {
  const out: [number, number][] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr
      const nc = c + dc
      if ((dr || dc) && nr >= 0 && nc >= 0 && nr < ROWS && nc < COLS) out.push([nr, nc])
    }
  return out
}

const blank = (): Cell[][] => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ duck: false, open: false, flag: false, near: 0 })))

/** Hides the ducks after the first click so that click (and its neighbours) is always safe. */
function seed(board: Cell[][], safeR: number, safeC: number): Cell[][] {
  const b = board.map((row) => row.map((c) => ({ ...c })))
  const banned = new Set([`${safeR},${safeC}`, ...neighbours(safeR, safeC).map(([r, c]) => `${r},${c}`)])
  let placed = 0
  while (placed < MINES) {
    const r = Math.floor(Math.random() * ROWS)
    const c = Math.floor(Math.random() * COLS)
    if (b[r][c].duck || banned.has(`${r},${c}`)) continue
    b[r][c].duck = true
    placed++
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) b[r][c].near = neighbours(r, c).filter(([nr, nc]) => b[nr][nc].duck).length
  return b
}

function flood(b: Cell[][], r: number, c: number) {
  const stack: [number, number][] = [[r, c]]
  while (stack.length) {
    const [cr, cc] = stack.pop()!
    const cell = b[cr][cc]
    if (cell.open || cell.flag) continue
    cell.open = true
    if (cell.near === 0 && !cell.duck) stack.push(...neighbours(cr, cc))
  }
}

// @category: games/ducksweeper
export default function Ducksweeper() {
  const [board, setBoard] = useState(blank)
  const [started, setStarted] = useState(false)
  const [state, setState] = useState<'play' | 'won' | 'lost'>('play')
  const [flagMode, setFlagMode] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [best, reportBest] = useBest('ducksweeper', true)

  useEffect(() => {
    if (!started || state !== 'play') return
    const t = setInterval(() => setSeconds((s) => Math.min(999, s + 1)), 1000)
    return () => clearInterval(t)
  }, [started, state])

  function reset() {
    setBoard(blank())
    setStarted(false)
    setState('play')
    setSeconds(0)
  }

  function open(r: number, c: number) {
    if (state !== 'play') return
    let b = board
    if (!started) {
      b = seed(board, r, c)
      setStarted(true)
    } else b = board.map((row) => row.map((cell) => ({ ...cell })))
    const cell = b[r][c]
    if (cell.flag || cell.open) return
    if (cell.duck) {
      b.forEach((row) => row.forEach((x) => x.duck && (x.open = true)))
      setBoard(b)
      setState('lost')
      return
    }
    flood(b, r, c)
    setBoard(b)
    if (b.every((row) => row.every((x) => x.duck || x.open))) {
      setState('won')
      reportBest(seconds)
    }
  }

  function toggleFlag(r: number, c: number) {
    if (state !== 'play' || board[r][c].open) return
    setBoard(board.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? { ...cell, flag: !cell.flag } : cell))))
  }

  const flags = board.flat().filter((c) => c.flag).length
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-[288px] items-center justify-between text-xs text-[var(--text-dim)]">
        <span>🦆 {MINES - flags}</span>
        <button type="button" className="glass-btn" onClick={reset}>
          {state === 'lost' ? '😵 Again' : state === 'won' ? '🏆 Again' : '🦆 New'}
        </button>
        <span>⏱ {seconds}s</span>
      </div>
      <div className="grid gap-0.5 rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] p-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, 1.9rem)` }}>
        {board.map((row, r) =>
          row.map((cell, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              onClick={() => (flagMode ? toggleFlag(r, c) : open(r, c))}
              onContextMenu={(e) => {
                e.preventDefault()
                toggleFlag(r, c)
              }}
              className="flex h-[1.9rem] w-[1.9rem] items-center justify-center rounded-md text-sm font-bold"
              style={{
                background: cell.open ? 'color-mix(in srgb, var(--text) 5%, transparent)' : 'color-mix(in srgb, var(--accent) 35%, var(--bg-solid))',
                color: NUM_COLORS[cell.near],
              }}
            >
              {cell.open ? (cell.duck ? '🦆' : cell.near || '') : cell.flag ? '🚩' : ''}
            </button>
          )),
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-dim)]">
        <input type="checkbox" className="accent-[var(--accent)]" checked={flagMode} onChange={(e) => setFlagMode(e.target.checked)} />
        Flag mode (or right-click)
      </label>
      <span className="text-xs text-[var(--text-dim)]">
        {state === 'won' ? `Cleared in ${seconds}s!` : state === 'lost' ? 'A duck got you.' : 'Find the hidden ducks.'} Best {best != null ? `${best}s` : '–'}
      </span>
    </div>
  )
}
