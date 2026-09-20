// OPNduck plugin entry contract:
//   - Default export a component: (props: { feature }) => a React element.
//   - No bundler assumed on your end — write plain React.createElement calls
//     (or transpile your own JSX before shipping the file; either way the
//     entry file itself must be plain, already-runnable JS).
//   - Use the HOST app's own React instance via window.OPNduck.React —
//     never `import react` yourself, or you'll end up with two copies of
//     React in the same page, which breaks hooks in hard-to-debug ways.
//   - Style with the same CSS custom properties the rest of the app uses
//     (--text, --text-dim, --input-bg, ...) and the existing utility
//     classes (glass-btn, glass-input, ...) so your card matches whichever
//     theme (Glass/Monochrome) the user has picked — don't hardcode colors.
//
// See PLUGINS.md at the repo root for the full manifest schema and current
// loading status (this contract is locked; the loader that actually reads
// plugin.json from disk and runs this file lands with the Tauri desktop
// shell — see that doc for why).

export default function HelloWorldCard({ feature }) {
  const { React } = window.OPNduck
  const [count, setCount] = React.useState(0)

  return React.createElement(
    'div',
    { className: 'flex flex-col gap-3' },
    React.createElement(
      'p',
      { className: 'text-sm text-[var(--text-dim)]' },
      `Hello from the "${feature.title}" plugin.`,
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'glass-btn',
        onClick: () => setCount((c) => c + 1),
      },
      `Clicked ${count} time${count === 1 ? '' : 's'}`,
    ),
  )
}
