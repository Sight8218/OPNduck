import { useEffect, useRef, useState } from 'react'
import { Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { NAV_ITEMS, swipeFor } from '../lib/nav'

function indexOf(pathname: string): number {
  const match = NAV_ITEMS.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)))
  return match?.index ?? 0
}

/**
 * Page swipe transition for the top-bar menu. The incoming page enters sliding
 * from the direction the menu moved and, when replaced, exits toward the
 * direction of travel. Speed adapts to menu distance, and the moving page gets
 * a soft blur that clears as it lands (a lightweight motion-blur feel).
 *
 * The previous menu index lives in a ref we write in an effect; reading it
 * during render is the standard framer transition idiom and is safe here.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const { pathname } = location
  const next = indexOf(pathname)
  const prevRef = useRef(next)
  // `filter: blur(0px)` is NOT the same as `filter: none` to the browser —
  // a non-none filter on an ancestor creates a new containing block for
  // position: sticky/fixed descendants, exactly like `transform` does. Left
  // permanently at blur(0px), this silently broke sticky elements on every
  // page (e.g. the Settings category rail never actually followed scroll).
  // Settle to a real `none` once the enter animation finishes; reset to the
  // blurred starting point on every navigation so the effect still plays.
  const [settled, setSettled] = useState(false)

  const swipe = swipeFor(prevRef.current, next)

  useEffect(() => {
    prevRef.current = next
    setSettled(false)
  }, [next])

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: swipe.direction * 40, filter: 'blur(6px)' }}
        animate={{
          opacity: 1,
          x: 0,
          filter: settled ? 'none' : 'blur(0px)',
          transition: {
            duration: swipe.inDuration,
            ease: [0.22, 1, 0.36, 1],
          },
        }}
        exit={{
          opacity: 0,
          x: -swipe.direction * swipe.outDistance,
          filter: 'blur(6px)',
          transition: { duration: swipe.outDuration, ease: [0.22, 1, 0.36, 1] },
        }}
        onAnimationComplete={() => setSettled(true)}
        // Framer Motion keeps a real `transform` (e.g. translateX(0px)) applied
        // even when x has animated back to 0 — it never resets to a literal
        // `none`, since it's built for repeated GPU-accelerated animation.
        // Same containing-block problem as the filter fix above: any non-none
        // transform on an ancestor breaks position: sticky/fixed descendants.
        // Force it to a true `none` once settled; let Framer generate it
        // normally while the enter/exit animation is actually running.
        transformTemplate={(_, generated) => (settled ? 'none' : generated)}
      >
        {/* Routes normally always reflects the *live* current URL — even
            inside a motion.div that's still mid-exit-animation, since
            AnimatePresence only freezes this subtree's own props, not the
            router context. That caused a flash of the destination page
            (unanimated) before the old wrapper's exit had even started.
            Pinning `location` here freezes it to whatever was current when
            this motion.div was created, matching its key. */}
        <Routes location={location}>{children}</Routes>
      </motion.div>
    </AnimatePresence>
  )
}