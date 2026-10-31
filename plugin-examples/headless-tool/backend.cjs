// A backend-only plugin: no UI, one tool. Shows up as `headless-tool__file_size` for MCP
// clients and in the TUI. Needs the "tools" and "files:read" permissions.

exports.activate = async (opnduck) => {
  opnduck.tools.handle('file_size', async ({ inputPath }) => {
    const data = await opnduck.files.read(inputPath)
    return { bytes: data.length }
  })
}
