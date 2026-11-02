// Tool Wheel: a stage plugin (manifest ui.slot "stage"). It fills the area under Home's tool tiles with a
// carousel of big card faces on a ring that lies flat and tips towards you, like a turntable seen from
// above. The tool you pick spins round to the front, then the app fades its real card in on top, so the
// middle is the live tool and the others wait at the sides. With nothing picked every face is dimmed and
// soft and the ring turns slowly. Click a face (or a tile above) to spin to it; click the front one to let go.
export default function ToolWheel({ api }) {
  const { React } = window.OPNduck
  const h = React.createElement
  const read = () => ({ features: api.app.features(), selected: api.app.selected() })
  const [app, setApp] = React.useState(read)
  React.useEffect(() => api.app.subscribe(() => setApp(read())), [])

  const view = React.useRef({ angle: 0, speed: 0.12, focus: 0 }) // radians, radians/second, 0..1
  const cards = React.useRef([])
  const hover = React.useRef(false)
  const stage = React.useRef(null)
  const sent = React.useRef(-1) // the last card opacity we told the app
  const lastSelected = React.useRef(null)
  const latest = React.useRef(app)
  latest.current = app

  React.useEffect(() => {
    const TAU = Math.PI * 2
    const stageWidth = () => stage.current?.clientWidth || 900
    const ANCHOR = 250 // the ring's centre, measured from the top of the stage
    const RY = 110 // how far the ring tips towards you: far cards sit this much higher, near ones lower
    const DEPTH = 180
    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { features, selected } = latest.current
      const n = features.length || 1
      const RX = Math.min(560, Math.max(120, stageWidth() * 0.4)) // how wide the ring is
      if (lastSelected.current !== selected) {
        lastSelected.current = selected
        sent.current = -1 // a new pick: tell the app its card should be hidden until we have settled
      }
      let settle = 0
      const step = TAU / n
      const v = view.current
      const idx = features.findIndex((f) => f.id === selected)
      if (idx >= 0) {
        // Ease round the short way so that card ends up at the front (angle 0).
        const diff = ((((-idx * step - v.angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI
        settle = Math.max(0, 1 - Math.abs(diff) / 0.1)
        v.angle += diff * (1 - Math.exp(-dt * 5))
        v.focus += (1 - v.focus) * (1 - Math.exp(-dt * 6))
      } else {
        // Nothing picked: drift slowly (and stop while the pointer is over the ring), cards fade back.
        v.speed += ((hover.current ? 0 : 0.12) - v.speed) * (1 - Math.exp(-dt * 3))
        v.angle += v.speed * dt
        v.focus += (0 - v.focus) * (1 - Math.exp(-dt * 4))
      }
      // The real card shows once the picked face has landed in front (ease so it is not abrupt).
      const cardOp = settle * settle * (3 - 2 * settle)
      if (Math.abs(cardOp - sent.current) > 0.01) {
        sent.current = cardOp
        api.app.setCardOpacity(cardOp)
      }
      features.forEach((f, i) => {
        const el = cards.current[i]
        if (!el) return
        const theta = v.angle + i * step
        const depth = (Math.cos(theta) + 1) / 2 // 1 at the front, 0 at the back
        const mine = f.id === selected
        const dim = 0.28 + 0.3 * depth // the unfocused look: faint and a little blurred
        const opacity = (mine ? dim + (1 - dim) * v.focus : dim * (1 - 0.35 * v.focus)) * (mine ? 1 - cardOp : 1)
        const blur = mine ? 1.4 * (1 - v.focus) : 1.4 + 0.5 * v.focus
        const scale = 0.5 + 0.5 * depth + (mine ? 0.14 * v.focus : 0)
        el.style.top = ANCHOR + 'px'
        el.style.transform = `translate(-50%, -50%) translate3d(${Math.sin(theta) * RX}px, ${(depth - 0.5) * 2 * RY}px, ${Math.cos(theta) * DEPTH}px) scale(${scale})`
        el.style.opacity = String(Math.max(0, Math.min(1, opacity)))
        el.style.filter = `blur(${blur.toFixed(2)}px) grayscale(${mine ? 1 - v.focus : 0.7})`
        el.style.zIndex = String(Math.round(depth * 100) + (mine ? 100 : 0))
        el.style.borderColor = mine && v.focus > 0.5 ? 'var(--accent)' : ''
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stageStyle = { position: 'relative', height: '100%', perspective: 900, overflow: 'hidden', width: '100%' }
  const card = {
    position: 'absolute', left: '50%', top: 250, width: 320, display: 'flex', flexDirection: 'column', gap: 10,
    padding: 16, textAlign: 'left', cursor: 'pointer', borderRadius: 16, willChange: 'transform, opacity, filter',
  }
  return h(
    'div',
    { ref: stage, style: stageStyle, onPointerEnter: () => (hover.current = true), onPointerLeave: () => (hover.current = false) },
    app.features.map((f, i) =>
      h(
        'button',
        {
          key: f.id,
          type: 'button',
          className: 'glass',
          style: card,
          ref: (el) => (cards.current[i] = el),
          'aria-pressed': f.id === app.selected,
          onClick: () => api.app.select(f.id === app.selected ? null : f.id),
        },
        h(
          'span',
          { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('span', { className: 'glass', style: { display: 'flex', width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, dangerouslySetInnerHTML: { __html: f.iconSvg } }),
          h(
            'span',
            { style: { minWidth: 0 } },
            h('span', { style: { display: 'block', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, f.title),
            h('span', { style: { display: 'block', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, f.tagline),
          ),
        ),
        h('span', { style: { display: 'block', fontSize: 12, lineHeight: 1.45, color: 'var(--text-dim)', maxHeight: 52, overflow: 'hidden' } }, f.description),
      ),
    ),
  )
}
