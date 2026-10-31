import { SOCIALS } from '../lib/nav'

/**
 * Social quick-links in the top bar. Opens each of the brand pages in a new
 * window. Uses the brand PNGs the user provided — deliberately shown without a
 * surrounding box so they sit cleanly next to the hamburger menu.
 */
export default function SocialLinks({ spacing = 'gap-11' }: { spacing?: string }) {
  return (
    <div className={`flex h-7 flex-wrap items-center overflow-hidden ${spacing}`}>
      {SOCIALS.map((s) => (
        <button
          key={s.url}
          type="button"
          title={s.label}
          aria-label={`Open ${s.label}`}
          onClick={() => window.open(s.url, '_blank', 'noopener,noreferrer')}
          className="rounded-md text-[var(--text-dim)] transition-all duration-150 hover:text-[var(--accent)]"
        >
          {/* Recolored via mask-image + currentColor instead of a hardcoded
              white invert() — so these brand PNGs actually retint per-theme
              (and on hover) instead of always rendering flat white. */}
          <span
            aria-hidden="true"
            className="block h-7 w-7 bg-current"
            style={{
              WebkitMaskImage: `url(${s.icon})`,
              maskImage: `url(${s.icon})`,
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
        </button>
      ))}
    </div>
  )
}