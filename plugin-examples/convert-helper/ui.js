// UI half of the Convert Helper example. Plain JS, host React, theme classes only.

export default function ConvertHelperCard({ feature }) {
  const { React, api } = window.OPNduck
  const [status, setStatus] = React.useState('')

  async function pickAndConvert() {
    const path = await api.files.pick({})
    if (!path) return
    setStatus('Starting…')
    try {
      const { id } = await api.rpc.call('convert', { path })
      setStatus(`Started job ${id}. Follow it in the Queue.`)
    } catch (err) {
      setStatus(`Failed: ${err.message}`)
    }
  }

  return React.createElement(
    'div',
    { className: 'flex flex-col gap-3' },
    React.createElement('p', { className: 'text-sm text-[var(--text-dim)]' }, feature.description),
    React.createElement('button', { type: 'button', className: 'glass-btn', onClick: pickAndConvert }, 'Choose a file'),
    status && React.createElement('p', { className: 'text-xs text-[var(--text-dim)]' }, status),
  )
}
