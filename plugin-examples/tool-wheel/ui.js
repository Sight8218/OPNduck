// Tool Wheel: a selector plugin (manifest ui.slot "selector"). It draws every tool on Home as a card on a
// ring. Nothing picked: the ring turns slowly and every card is dimmed and soft. Picked: the ring eases
// round to that card, which comes forward and lights up. Click the front card again to let go.
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
  const latest = React.useRef(app)
  latest.current = app

  React.useEffect(() => {
    const TAU = Math.PI * 2
    const stageWidth = () => stage.current?.clientWidth || 900
    const RY = 62 // the ring is seen from a little above: far cards sit higher
    const DEPTH = 150
    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { features, selected } = latest.current
      const n = features.length || 1
      const RX = Math.min(330, Math.max(60, stageWidth() / 2 - 135)) // how wide the ring is, kept inside the stage
      const step = TAU / n
      const v = view.current
      const idx = features.findIndex((f) => f.id === selected)
      if (idx >= 0) {
        // Ease round the short way so that card ends up at the front (angle 0).
        const diff = ((((-idx * step - v.angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI
        v.angle += diff * (1 - Math.exp(-dt * 5))
        v.focus += (1 - v.focus) * (1 - Math.exp(-dt * 6))
      } else {
        // Nothing picked: drift slowly (and stop while the pointer is over the ring), cards fade back.
        v.speed += ((hover.current ? 0 : 0.12) - v.speed) * (1 - Math.exp(-dt * 3))
        v.angle += v.speed * dt
        v.focus += (0 - v.focus) * (1 - Math.exp(-dt * 4))
      }
      features.forEach((f, i) => {
        const el = cards.current[i]
        if (!el) return
        const theta = v.angle + i * step
        const depth = (Math.cos(theta) + 1) / 2 // 1 at the front, 0 at the back
        const mine = f.id === selected
        const dim = 0.28 + 0.3 * depth // the unfocused look: faint and a little blurred
        const opacity = mine ? dim + (1 - dim) * v.focus : dim * (1 - 0.35 * v.focus)
        const blur = mine ? 1.4 * (1 - v.focus) : 1.4 + 0.5 * v.focus
        const scale = 0.62 + 0.38 * depth + (mine ? 0.12 * v.focus : 0)
        el.style.transform = `translate(-50%, -50%) translate3d(${Math.sin(theta) * RX}px, ${(0.5 - depth) * 2 * RY}px, ${Math.cos(theta) * DEPTH}px) scale(${scale})`
        el.style.opacity = String(Math.max(0.05, Math.min(1, opacity)))
        el.style.filter = `blur(${blur.toFixed(2)}px) grayscale(${mine ? 1 - v.focus : 0.7})`
        el.style.zIndex = String(Math.round(depth * 100) + (mine ? 100 : 0))
        el.style.borderColor = mine && v.focus > 0.5 ? 'var(--accent)' : ''
      })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const stageStyle = { position: 'relative', height: 270, perspective: 900, overflow: 'hidden', width: '100%' }
  const card = {
    position: 'absolute', left: '50%', top: '50%', width: 230, display: 'flex', alignItems: 'center', gap: 12,
    padding: 12, textAlign: 'left', cursor: 'pointer', borderRadius: 16, willChange: 'transform, opacity, filter',
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
        h('span', { className: 'glass', style: { display: 'flex', width: 40, height: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, dangerouslySetInnerHTML: { __html: f.iconSvg } }),
        h(
          'span',
          { style: { minWidth: 0 } },
          h('span', { style: { display: 'block', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, f.title),
          h('span', { style: { display: 'block', fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, f.tagline),
        ),
      ),
    ),
  )
}
