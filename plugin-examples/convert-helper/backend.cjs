// Backend half of the Convert Helper example. Runs in a worker; every call on `opnduck`
// is checked against the permissions in plugin.json.

exports.activate = async (opnduck) => {
  // The one function both the card and the command palette use.
  async function convert(inputPath) {
    const mode = (await opnduck.settings.get('mode')) ?? 'transcode'
    const id = await opnduck.jobs.start('convert', { inputPath, container: 'MP4', mode })
    opnduck.log(`started job ${id} for ${inputPath}`)
    return { id }
  }

  opnduck.rpc.handle('convert', ({ path }) => convert(path))
  opnduck.commands.handle('convert-helper.run', async () => {
    const path = await opnduck.files.pick({})
    if (path) await convert(path)
  })

  // Needs the "hooks" and "notify" permissions.
  opnduck.on('job:finished', (job) => {
    opnduck.notify({ title: 'Convert Helper', body: `${job.label ?? 'Job'} finished` })
  })
}

exports.deactivate = async () => {}
