/* OPNduck lightweight CMS + hidden dev panel.
   - OPNduckCMS.load() -> Promise<content>  (fetches content.json, falls back to {})
   - Dev panel opens with ?dev in the URL or Ctrl+Shift+D. It edits the whole
     content object and exports a fresh content.json you commit to publish. */
(function () {
  const FONT_MONO = "'JetBrains Mono',monospace";
  const state = { content: null, promise: null };

  function load() {
    if (state.promise) return state.promise;
    state.promise = fetch('content.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then(c => { state.content = c || {}; return state.content; });
    return state.promise;
  }

  /* ---------- small DOM helpers ---------- */
  function el(tag, style, props) {
    const n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (props) Object.assign(n, props);
    return n;
  }
  const L = "font-family:" + FONT_MONO + ";font-size:10px;letter-spacing:1px;color:#8a7c68;text-transform:uppercase;display:block;margin:14px 0 5px;";
  const INP = "width:100%;box-sizing:border-box;background:#0f0c0a;border:1px solid rgba(225,137,47,0.25);border-radius:6px;color:#ede6d9;font-family:'IBM Plex Sans',sans-serif;font-size:13px;padding:8px 10px;";
  const CARD = "border:1px solid rgba(225,137,47,0.18);border-radius:9px;padding:14px;margin-bottom:12px;background:rgba(255,255,255,0.02);";
  const H = "font-family:" + FONT_MONO + ";font-size:12px;letter-spacing:1.5px;color:#e1892f;margin:26px 0 4px;border-top:1px solid rgba(225,137,47,0.15);padding-top:20px;";
  const BTN = "font-family:" + FONT_MONO + ";font-size:11px;font-weight:700;border:none;border-radius:6px;padding:7px 12px;cursor:pointer;";

  function field(label, value, oninput, multiline) {
    const wrap = el('div');
    wrap.appendChild(el('label', L, { textContent: label }));
    const input = el(multiline ? 'textarea' : 'input', INP + (multiline ? 'resize:vertical;min-height:' + (multiline === 'tall' ? '120px' : '60px') + ';line-height:1.5;' : ''));
    input.value = value == null ? '' : value;
    input.addEventListener('input', () => oninput(input.value));
    wrap.appendChild(input);
    return wrap;
  }
  function heading(t) { return el('div', H, { textContent: t }); }
  function smallBtn(t, bg, fg, onclick) {
    const b = el('button', BTN + 'background:' + bg + ';color:' + fg + ';', { textContent: t });
    b.addEventListener('click', onclick);
    return b;
  }

  /* ---------- panel ---------- */
  function buildPanel() {
    const c = state.content || (state.content = {});
    c.hero = c.hero || {}; c.gallery = c.gallery || []; c.roadmap = c.roadmap || {};
    c.roadmap.shipped = c.roadmap.shipped || []; c.roadmap.planned = c.roadmap.planned || [];
    c.blog = c.blog || []; c.downloads = c.downloads || {}; c.downloads.links = c.downloads.links || [];
    c.github = c.github || {};

    const backdrop = el('div', 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);');
    const panel = el('div', 'position:fixed;top:0;right:0;bottom:0;z-index:99999;width:min(440px,94vw);background:#16110d;border-left:1px solid rgba(225,137,47,0.3);box-shadow:-20px 0 60px rgba(0,0,0,0.6);overflow-y:auto;color:#ede6d9;');
    const pad = el('div', 'padding:20px 22px 60px;');
    panel.appendChild(pad);

    // header
    const top = el('div', 'display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;background:#16110d;margin:-20px -22px 6px;padding:16px 22px;border-bottom:1px solid rgba(225,137,47,0.2);z-index:2;');
    const title = el('div', 'display:flex;align-items:center;gap:9px;');
    title.appendChild(el('span', 'font-family:' + FONT_MONO + ';font-weight:800;font-size:14px;color:#f0a63b;', { textContent: 'DEV MODE' }));
    title.appendChild(el('span', 'font-family:' + FONT_MONO + ';font-size:10px;color:#7d7364;', { textContent: 'content.json' }));
    top.appendChild(title);
    const lockBtn = smallBtn('🔒 lock', 'rgba(237,230,217,0.1)', '#ede6d9', () => { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} close(); });
    top.appendChild(lockBtn);
    pad.appendChild(top);

    pad.appendChild(el('p', 'font-size:12px;line-height:1.55;color:#8a7c68;margin:6px 0 4px;', { textContent: 'Edit below, then Export. Commit the downloaded content.json to publish. Changes here are live preview only until you reload.' }));

    /* GitHub */
    pad.appendChild(heading('GITHUB'));
    pad.appendChild(field('Repo (owner/name)', c.github.repo, v => c.github.repo = v));

    /* Hero */
    pad.appendChild(heading('HOMEPAGE HERO'));
    pad.appendChild(field('Eyebrow', c.hero.eyebrow, v => c.hero.eyebrow = v));
    pad.appendChild(field('Title (use \\n line breaks — Enter)', c.hero.title, v => c.hero.title = v, true));
    pad.appendChild(field('Subtitle', c.hero.subtitle, v => c.hero.subtitle = v, 'tall'));

    /* Gallery */
    pad.appendChild(heading('GALLERY CAPTIONS'));
    c.gallery.forEach((g, i) => {
      const card = el('div', CARD);
      card.appendChild(el('div', 'font-family:' + FONT_MONO + ';font-size:10px;color:#7d7364;margin-bottom:4px;', { textContent: g.img || ('shot ' + (i + 1)) }));
      card.appendChild(field('Title', g.title, v => g.title = v));
      card.appendChild(field('Caption', g.caption, v => g.caption = v, true));
      pad.appendChild(card);
    });

    /* Roadmap */
    pad.appendChild(heading('ROADMAP — SHIPPED'));
    pad.appendChild(field('One item per line', c.roadmap.shipped.join('\n'), v => c.roadmap.shipped = v.split('\n').map(s => s.trim()).filter(Boolean), 'tall'));
    pad.appendChild(heading('ROADMAP — PLANNED'));
    const planWrap = el('div');
    function drawPlanned() {
      planWrap.innerHTML = '';
      c.roadmap.planned.forEach((p, i) => {
        const row = el('div', 'display:flex;gap:8px;align-items:center;margin-bottom:8px;');
        const inp = el('input', INP + 'flex:1;'); inp.value = p.name || '';
        inp.addEventListener('input', () => p.name = inp.value);
        row.appendChild(inp);
        const ip = smallBtn(p.inProgress ? 'IN PROGRESS' : 'PLANNED', p.inProgress ? 'rgba(240,166,59,0.9)' : 'rgba(237,230,217,0.08)', p.inProgress ? '#17130f' : '#a89a86', () => { p.inProgress = !p.inProgress; drawPlanned(); });
        row.appendChild(ip);
        row.appendChild(smallBtn('✕', 'rgba(200,60,40,0.15)', '#e08a72', () => { c.roadmap.planned.splice(i, 1); drawPlanned(); }));
        planWrap.appendChild(row);
      });
      planWrap.appendChild(smallBtn('+ add planned item', 'rgba(225,137,47,0.15)', '#f0a63b', () => { c.roadmap.planned.push({ name: '', inProgress: false }); drawPlanned(); }));
    }
    drawPlanned();
    pad.appendChild(planWrap);

    /* Downloads */
    pad.appendChild(heading('DOWNLOADS'));
    pad.appendChild(field('Version label', c.downloads.version, v => c.downloads.version = v));
    pad.appendChild(field('Release page URL', c.downloads.releaseUrl, v => c.downloads.releaseUrl = v));
    const dlWrap = el('div');
    function drawDl() {
      dlWrap.innerHTML = '';
      c.downloads.links.forEach((d, i) => {
        const card = el('div', CARD);
        const rmv = smallBtn('✕ remove', 'rgba(200,60,40,0.15)', '#e08a72', () => { c.downloads.links.splice(i, 1); drawDl(); });
        rmv.style.cssText += 'float:right;';
        card.appendChild(rmv);
        card.appendChild(field('Platform', d.platform, v => d.platform = v));
        card.appendChild(field('URL', d.url, v => d.url = v));
        dlWrap.appendChild(card);
      });
      dlWrap.appendChild(smallBtn('+ add download', 'rgba(225,137,47,0.15)', '#f0a63b', () => { c.downloads.links.push({ platform: '', url: '' }); drawDl(); }));
    }
    drawDl();
    pad.appendChild(dlWrap);

    /* Blog */
    pad.appendChild(heading('BLOG POSTS'));
    const blogWrap = el('div');
    function drawBlog() {
      blogWrap.innerHTML = '';
      c.blog.forEach((b, i) => {
        const card = el('div', CARD);
        const rmv = smallBtn('✕ remove', 'rgba(200,60,40,0.15)', '#e08a72', () => { c.blog.splice(i, 1); drawBlog(); });
        rmv.style.cssText += 'float:right;';
        card.appendChild(rmv);
        card.appendChild(field('Title', b.title, v => b.title = v));
        card.appendChild(field('Slug (url id, no spaces)', b.slug, v => b.slug = v));
        card.appendChild(field('Date (YYYY-MM-DD)', b.date, v => b.date = v));
        card.appendChild(field('Author', b.author, v => b.author = v));
        card.appendChild(field('Tag', b.tag, v => b.tag = v));
        card.appendChild(field('Excerpt', b.excerpt, v => b.excerpt = v, true));
        card.appendChild(field('Body (blank line = new paragraph)', b.body, v => b.body = v, 'tall'));
        blogWrap.appendChild(card);
      });
      blogWrap.appendChild(smallBtn('+ add post', 'rgba(225,137,47,0.15)', '#f0a63b', () => { c.blog.unshift({ slug: 'new-post', title: 'New post', date: new Date().toISOString().slice(0, 10), author: 'Ducky', tag: 'UPDATE', excerpt: '', body: '' }); drawBlog(); }));
    }
    drawBlog();
    pad.appendChild(blogWrap);

    /* Export */
    const exportBar = el('div', 'position:sticky;bottom:0;background:#16110d;margin:24px -22px 0;padding:14px 22px;border-top:1px solid rgba(225,137,47,0.25);display:flex;gap:10px;');
    const exp = smallBtn('⬇ Export content.json', 'linear-gradient(160deg,#f0a63b,#d97a25)', '#17130f', () => {
      const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'content.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
    exp.style.cssText += 'flex:1;padding:11px;font-size:12px;';
    const copy = smallBtn('Copy JSON', 'rgba(237,230,217,0.1)', '#ede6d9', () => {
      navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(c, null, 2));
      copy.textContent = 'Copied ✓'; setTimeout(() => copy.textContent = 'Copy JSON', 1400);
    });
    copy.style.cssText += 'padding:11px 14px;font-size:12px;';
    exportBar.appendChild(exp); exportBar.appendChild(copy);
    pad.appendChild(exportBar);

    backdrop.addEventListener('click', close);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    state._panel = [backdrop, panel];
  }

  function open() { if (state._panel) return; load().then(buildPanel); }
  function close() { if (state._panel) { state._panel.forEach(n => n.remove()); state._panel = null; } }

  /* ---------- passphrase gate ----------
     The panel opens ONLY when someone supplies a passphrase whose SHA-256
     matches DEV_HASH. The plaintext passphrase is never stored anywhere in
     this file — only its hash — so reading the source does not reveal it.
     To change the passphrase, compute the SHA-256 of your new phrase and
     replace DEV_HASH below. */
  const DEV_HASH = '5552bd486f86d5cdaab1f0839bcf5cd4be79006c07c8845167abb8d6b1ced6ed';
  const SESSION_KEY = 'opnduck_dev';

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function verify(pass) {
    if (!pass) return false;
    try { return (await sha256(pass)) === DEV_HASH; } catch (e) { return false; }
  }
  // Unlock from anywhere: OPNduckCMS.unlock('your-passphrase')
  async function unlock(pass) {
    if (await verify(pass)) {
      try { sessionStorage.setItem(SESSION_KEY, DEV_HASH); } catch (e) {}
      open();
      return true;
    }
    return false;
  }

  async function initTriggers() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    // 1) ?unlock=<passphrase> on ANY page — verified, then scrubbed from the URL.
    if (params && params.has('unlock')) {
      const ok = await verify(params.get('unlock'));
      params.delete('unlock');
      const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
      try { history.replaceState(null, '', clean); } catch (e) {}
      if (ok) { try { sessionStorage.setItem(SESSION_KEY, DEV_HASH); } catch (e) {} setTimeout(open, 60); return; }
    }
    // 2) Already unlocked earlier this tab session — stay open across pages.
    try { if (sessionStorage.getItem(SESSION_KEY) === DEV_HASH) setTimeout(open, 60); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTriggers);
  else initTriggers();

  window.OPNduckCMS = { load, open, close, unlock };
})();
