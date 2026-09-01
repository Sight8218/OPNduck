import { SOCIALS } from '../lib/nav'

/**
 * Social quick-links in the top bar. Opens each of the brand pages in a new
 * window. Uses the brand PNGs the user provided — deliberately shown without a
 * surrounding box so they sit cleanly next to the hamburger menu.
 */
export default function SocialLinks({ spacing = 'gap-11' }: { spacing?: string }) {
  return (
    <div className={`flex items-center ${spacing}`}>
      {SOCIALS.map((s) => (
        <button
          key={s.url}
          type="button"
          title={s.label}
          aria-label={`Open ${s.label}`}
          onClick={() => window.open(s.url, '_blank', 'noopener,noreferrer')}
          className="rounded-md transition-all duration-150 hover:scale-110"
          style={{ filter: 'drop-shadow(0 0 9px rgba(179, 90, 45, 0.18))' }}
        >
          <img
            src={s.icon}
            alt=""
            aria-hidden="true"
            className="h-7 w-7 object-contain"
            style={{ filter: 'invert(1)' }}
          />
        </button>
      ))}
    </div>
  )
}