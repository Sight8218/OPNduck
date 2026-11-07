/** Removes `user:password@` from any link inside a piece of text: `http://bob:pw@host/x` becomes `http://host/x`.
 *  Used on everything that is logged, shown or saved, so a login typed into a link never lands in a log or on disk. */
const LINK_LOGIN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"'\\]+@/gi
function stripLinkLogin(text) {
  return typeof text === 'string' ? text.replace(LINK_LOGIN, '$1') : text
}
/** Same, over every string inside a JSON-able value (a saved task or request). */
function stripLinkLoginDeep(value) {
  return JSON.parse(stripLinkLogin(JSON.stringify(value)))
}
module.exports = { stripLinkLogin, stripLinkLoginDeep }
