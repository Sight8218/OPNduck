import { Suspense, lazy, useState } from 'react'
import { IconArrowLeft } from '@tabler/icons-react'

const GAMES = [
  { id: 'flappyduck', name: 'FlappyDuck', emoji: '🦆', blurb: 'Flap through the pipes.', Component: lazy(() => import('../features/games/FlappyDuck')) },
  { id: 'ducksweeper', name: 'Ducksweeper', emoji: '🚩', blurb: 'Find the hidden ducks.', Component: lazy(() => import('../features/games/Ducksweeper')) },
  { id: '2048', name: '2048', emoji: '🔢', blurb: 'Slide and merge the tiles.', Component: lazy(() => import('../features/games/Game2048')) },
  { id: 'tetris', name: 'Tetris', emoji: '🧱', blurb: 'Stack and clear lines.', Component: lazy(() => import('../features/games/Tetris')) },
  { id: 'snake', name: 'Snake', emoji: '🐍', blurb: 'Eat bread, don\'t eat yourself.', Component: lazy(() => import('../features/games/Snake')) },
  { id: 'duckmatch', name: 'Duck Match', emoji: '🃏', blurb: 'Find all the pairs.', Component: lazy(() => import('../features/games/DuckMatch')) },
]

// @category: pages/arcade
/** The secret Arcade: small classic games. Reached by clicking the OPNduck name; pinned to the menu from Settings. */
export default function Arcade() {
  const [playing, setPlaying] = useState<string | null>(null)
  const game = GAMES.find((g) => g.id === playing)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-extrabold">Arcade 🦆</h1>
        <p className="text-sm text-[var(--text-dim)]">You found the secret. Take a break while your jobs run.</p>
      </div>
      {game ? (
        <div className="glass rounded-3xl p-5">
          <div className="mb-4 flex items-center gap-3">
            <button type="button" className="glass-btn flex items-center gap-1" onClick={() => setPlaying(null)}>
              <IconArrowLeft size={16} aria-hidden="true" />
              All games
            </button>
            <h2 className="text-base font-bold">{game.name}</h2>
          </div>
          <Suspense fallback={<p className="py-10 text-center text-sm text-[var(--text-dim)]">Loading…</p>}>
            <game.Component />
          </Suspense>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {GAMES.map((g) => (
            <button key={g.id} type="button" onClick={() => setPlaying(g.id)} className="glass flex flex-col items-start gap-1 rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5">
              <span className="text-3xl" aria-hidden="true">
                {g.emoji}
              </span>
              <span className="text-sm font-bold">{g.name}</span>
              <span className="text-xs text-[var(--text-dim)]">{g.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
// --- end: pages/arcade ---
