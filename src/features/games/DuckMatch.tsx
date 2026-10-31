import { useRef, useState } from 'react'
import { useBest } from './kit'

const FACES = ['🦆', '🐥', '🦢', '🪿', '🍞', '🐟', '🌊', '🥚']

function deal(): string[] {
  const cards = [...FACES, ...FACES]
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

// @category: games/duckmatch
export default function DuckMatch() {
  const [cards, setCards] = useState(deal)
  const [up, setUp] = useState<number[]>([])
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const [moves, setMoves] = useState(0)
  const [best, reportBest] = useBest('duckmatch', true)
  const lock = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  function reset() {
    clearTimeout(timer.current)
    lock.current = false
    setCards(deal())
    setUp([])
    setMatched(new Set())
    setMoves(0)
  }

  function flip(i: number) {
    if (lock.current || up.includes(i) || matched.has(i)) return
    const next = [...up, i]
    setUp(next)
    if (next.length < 2) return
    const total = moves + 1
    setMoves(total)
    if (cards[next[0]] === cards[next[1]]) {
      const m = new Set(matched).add(next[0]).add(next[1])
      setMatched(m)
      setUp([])
      if (m.size === cards.length) reportBest(total)
    } else {
      lock.current = true
      timer.current = setTimeout(() => {
        setUp([])
        lock.current = false
      }, 700)
    }
  }

  const done = matched.size === cards.length
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-[272px] items-center justify-between text-xs text-[var(--text-dim)]">
        <span>Moves {moves} · Best {best ?? '–'}</span>
        <button type="button" className="glass-btn" onClick={reset}>
          New game
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--input-bg)] p-2">
        {cards.map((face, i) => {
          const shown = up.includes(i) || matched.has(i)
          return (
            <button
              key={i}
              type="button"
              onClick={() => flip(i)}
              aria-label={shown ? face : 'Hidden card'}
              className="flex h-14 w-14 items-center justify-center rounded-lg text-2xl transition-colors"
              style={{ background: shown ? 'color-mix(in srgb, var(--text) 8%, transparent)' : 'color-mix(in srgb, var(--accent) 35%, var(--bg-solid))', opacity: matched.has(i) ? 0.6 : 1 }}
            >
              {shown ? face : ''}
            </button>
          )
        })}
      </div>
      <span className="text-xs text-[var(--text-dim)]">{done ? `All pairs found in ${moves} moves!` : 'Find all the pairs.'}</span>
    </div>
  )
}
