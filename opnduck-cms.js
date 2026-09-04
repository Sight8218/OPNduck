/* OPNduck lightweight content loader.
   - OPNduckCMS.load() -> Promise<content>  (fetches content.json, falls back to {})
   To change site content (hero text, gallery captions, roadmap, blog posts,
   download links), edit content.json directly and git push. */
(function () {
  const state = { content: null, promise: null };

  function load() {
    if (state.promise) return state.promise;
    state.promise = fetch('content.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(c => { state.content = c || {}; return state.content; });
    return state.promise;
  }

  window.OPNduckCMS = { load };
})();
