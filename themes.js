/* OPNduck site theme picker. Re-colours the page with any of the app's themes.
   The pages hard-code the Blarange colours, so this swaps those exact values for the chosen
   theme's. Palette tuple: [mode, accent, background, darker, lighter, foreground, dim]. */
(function () {
  var PALETTES = {"catppuccin":["dark","#89b4fa","#1e1e2e","#101019","#313244","#cdd6f4","#6c7086"],"catppuccin-latte":["light","#1e66f5","#eff1f5","#d7d8dc","#dce0e8","#4c4f69","#9ca0b0"],"ethereal":["dark","#7d82d9","#060b1e","#030610","#131a3a","#ffcead","#6d7db6"],"everforest":["dark","#7fbbb3","#2d353b","#181d20","#343f44","#d3c6aa","#4f585e"],"flexoki-light":["light","#205ea6","#fffcf0","#e5e2d8","#e6e4d9","#100f0f","#878580"],"gruvbox":["dark","#7daea3","#282828","#161616","#3c3836","#d4be98","#7c6f64"],"hackerman":["dark","#82fb9c","#0b0c16","#06060c","#151828","#ddf7ff","#6a6e95"],"jade-horse":["dark","#8bcbb1","#142620","#0a1713","#203b31","#dfede5","#91ad9f"],"kanagawa":["dark","#dcd7ba","#1f1f28","#111116","#223249","#dcd7ba","#727169"],"last-horizon":["dark","#b59790","#0c0b0c","#060606","#0c0b0c","#fafcfb","#584e51"],"lumon":["dark","#8bc9eb","#16242d","#0b1216","#1b2d40","#d6e2ee","#4d86b0"],"lupine":["light","#3264eb","#fafafa","#dedede","#f5f5f5","#212121","#757575"],"matte-black":["dark","#e68e0d","#121212","#090909","#1e1e1e","#bebebe","#555555"],"miasma":["dark","#78824b","#222222","#121212","#2c2c2c","#c2c2b0","#555555"],"nord":["dark","#81a1c1","#2e3440","#191c23","#3b4252","#d8dee9","#667080"],"osaka-jade":["dark","#509475","#111c18","#090f0d","#23372b","#c1c497","#81b8a8"],"retro-82":["dark","#faa968","#05182e","#020c17","#0a2540","#f6dcac","#3f8f8a"],"ristretto":["dark","#f38d70","#2c2525","#181414","#3d2f2a","#e6d9db","#72696a"],"rose-pine":["light","#56949f","#faf4ed","#e1dbd5","#f2e9e1","#575279","#9893a5"],"solitude":["dark","#798186","#101315","#080a0b","#101315","#cacccc","#4b4e55"],"starship":["dark","#ff9f0a","#1c1c1e","#0e0e10","#2c2c2e","#f5f5f7","#98989d"],"tokyo-night":["dark","#7aa2f7","#1a1b26","#0e0e14","#24283b","#a9b1d6","#565f89"],"vantablack":["dark","#8d8d8d","#000000","#070707","#1a1a1a","#ffffff","#505050"],"white":["light","#6e6e6e","#ffffff","#e8e8e8","#c0c0c0","#000000","#c0c0c0"]};
  PALETTES.blarange = ['dark', '#e1892f', '#131110', '#0f0d0c', '#1b1917', '#ece8e1', '#a29b90'];
  PALETTES.monochrome = ['dark', '#e8e8e8', '#141414', '#0a0a0a', '#222222', '#f4f4f4', '#a6a6a6'];
  var ORDER = ['blarange', 'monochrome'].concat(Object.keys(PALETTES).filter(function (k) { return k !== 'blarange' && k !== 'monochrome'; }));
  var KEY = 'opnduck.site.theme';
  var label = function (s) { return s.replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); };
  var mix = function (a, pa, b) { return 'color-mix(in srgb, ' + a + ' ' + pa + '%, ' + b + ')'; };

  function colorsFor(slug) {
    var p = PALETTES[slug] || PALETTES.blarange;
    var accent = p[1], bg = p[2], dark = p[3], light = p[4], fg = p[5], dim = p[6];
    if (p[0] === 'light') dim = mix(fg, 70, bg);
    return {
      accent: accent,
      map: {
        '#e1892f': accent, '#d97a25': mix(accent, 85, bg), '#c2571f': mix(accent, 70, bg),
        '#f0a63b': mix(accent, 85, 'white'), '#f2ab5c': mix(accent, 80, 'white'),
        '#17130f': bg, '#171310': light, '#120f0c': mix(bg, 55, dark), '#0f0c0a': dark,
        '#ede6d9': fg, '#c4b8a4': mix(fg, 78, bg), '#b5a793': mix(fg, 68, bg),
        '#a89a86': mix(dim, 80, bg), '#8a7c68': mix(dim, 62, bg), '#7d7364': mix(dim, 52, bg),
        '#bcae99': mix(fg, 72, bg), '#d8ccb8': mix(fg, 86, bg), '#d7e0d2': mix(fg, 88, bg), '#f0c58a': mix(accent, 70, 'white'),
        '#6f6454': mix(dim, 45, bg), '#a85a1e': mix(accent, 65, bg), '#e1a53b': mix(accent, 85, 'white'),
        '#211a13': light, '#1d1712': light, '#1a1510': mix(light, 60, bg), '#151109': bg, '#14100c': bg, '#2a1810': mix(accent, 14, bg)
      }
    };
  }

  var cur = colorsFor('blarange');
  var HEX = new RegExp('#(?:' + Object.keys(cur.map).map(function (k) { return k.slice(1); }).join('|') + ')\\b', 'gi');
  // Known site colours by rgb triple, for values the browser has re-serialised as rgb()/rgba().
  var TRIPLES = {};
  Object.keys(colorsFor('blarange').map).forEach(function (hex) {
    TRIPLES[[1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); }).join(',')] = hex;
  });
  TRIPLES['240,166,59'] = '#f0a63b';
  var RGB = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/gi;
  // Omarchy-style flat look: every gradient becomes its first colour (radial glows vanish).
  var GRAD = /(linear|radial)-gradient\((?:[^()]|\([^()]*\))*\)/gi;
  var FIRST = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i;
  function flatten(text) {
    return text.replace(GRAD, function (g, kind) {
      if (kind.toLowerCase() === 'radial') return 'linear-gradient(transparent,transparent)';
      var c = FIRST.exec(g);
      return c ? 'linear-gradient(' + c[0] + ',' + c[0] + ')' : g;
    });
  }
  function recolor(text) {
    return flatten(text)
      .replace(HEX, function (m) { return cur.map[m.toLowerCase()]; })
      .replace(RGB, function (m, r, g, b, a) {
        var hex = TRIPLES[r + ',' + g + ',' + b];
        if (!hex) return m;
        var base = cur.map[hex];
        return a === undefined || parseFloat(a) >= 1 ? base : mix(base, Math.round(parseFloat(a) * 100), 'transparent');
      });
  }

  var orig = new WeakMap();   // node -> { src, out }
  function apply(node, get, set) {
    var now = get(node), rec = orig.get(node);
    if (!rec || now !== rec.out) rec = { src: now, out: null };
    var out = recolor(rec.src);
    rec.out = out;
    orig.set(node, rec);
    if (out !== now) set(node, out);
  }
  var ATTRS = ['style', 'fill', 'stroke', 'stop-color'];
  var scratch = document.createElement('div');
  function parse(text) {
    scratch.style.cssText = text;
    var o = {};
    for (var i = 0; i < scratch.style.length; i++) { var p = scratch.style[i]; o[p] = scratch.style.getPropertyValue(p) + (scratch.style.getPropertyPriority(p) ? ' !important' : ''); }
    return o;
  }
  function join(o) { return Object.keys(o).map(function (p) { return p + ':' + o[p]; }).join(';'); }
  // The page may rewrite part of an element's style (e.g. a bar's width) after we recoloured it.
  // Keep the original source for properties it left alone and take the new value for the rest.
  function mergeSource(srcText, outText, nowText) {
    var src = parse(srcText), out = parse(outText), now = parse(nowText), next = {};
    Object.keys(now).forEach(function (p) { next[p] = out[p] === now[p] && p in src ? src[p] : now[p]; });
    return join(next);
  }
  function sweep() {
    placeLogo();
    document.querySelectorAll('[style],[fill],[stroke],[stop-color]').forEach(function (el) {
      var rec = orig.get(el) || {};
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var now = el.getAttribute(a), r = rec[a];
        if (!r) r = { src: now, out: now };
        else if (now !== r.out) r = { src: a === 'style' ? mergeSource(r.src, r.out, now) : now, out: now };
        r.out = recolor(r.src);
        rec[a] = r;
        if (r.out !== now) el.setAttribute(a, r.out);
      });
      orig.set(el, rec);
    });
    document.querySelectorAll('style:not([data-theme-skip])').forEach(function (st) {
      apply(st, function (n) { return n.textContent; }, function (n, v) { n.textContent = v; });
    });
  }

  var pending = 0;
  function schedule() { if (!pending) pending = setTimeout(function () { pending = 0; sweep(); }, 30); }
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) if (!list[i].target.closest || !list[i].target.closest('#oth-root')) return schedule();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS });


  // ---- Omarchy-style chrome: square, flat, a pixel logo and a scatter of pixels ----
  var GLYPHS = {
    O: ['01110','10001','10001','10001','10001','10001','01110'],
    P: ['11110','10001','10001','11110','10000','10000','10000'],
    N: ['10001','11001','10101','10101','10011','10001','10001'],
    D: ['11110','10001','10001','10001','10001','10001','11110'],
    U: ['10001','10001','10001','10001','10001','10001','01110'],
    C: ['01110','10001','10000','10000','10000','10001','01110'],
    K: ['10001','10010','10100','11000','10100','10010','10001']
  };
  var BANDS = [78, 62, 50, 40, 30, 22, 14]; // % of white mixed into the accent, top to bottom
  function logoSvg() {
    var cell = 8, x = 0, rects = '';
    'OPNDUCK'.split('').forEach(function (ch) {
      GLYPHS[ch].forEach(function (row, r) {
        row.split('').forEach(function (b, c) {
          if (b === '1') rects += '<rect x="' + (x + c) * cell + '" y="' + r * cell + '" width="' + cell + '" height="' + cell + '" style="fill:color-mix(in srgb,white ' + BANDS[r] + '%,var(--oth-accent))"/>';
        });
      });
      x += 6;
    });
    return '<svg class="oth-logo" viewBox="0 0 ' + (x - 1) * cell + ' ' + 7 * cell + '" role="img" aria-label="OPNduck" shape-rendering="crispEdges">' + rects + '</svg>';
  }
  function pixelField() {
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var out = '', size = 12;
    for (var i = 0; i < 260; i++) {
      var x = Math.floor(rnd() * 107), y = Math.floor(rnd() * 54);
      var edge = Math.abs(x - 53) / 53; // thicker toward the sides
      if (rnd() > 0.02 + edge * edge * 0.85) continue;
      out += '<rect x="' + x * size + '" y="' + y * size + '" width="' + size + '" height="' + size + '" opacity="' + (0.06 + rnd() * 0.16).toFixed(2) + '"/>';
    }
    return '<svg class="oth-pixels" viewBox="0 0 1284 648" preserveAspectRatio="xMidYMin slice" aria-hidden="true">' + out + '</svg>';
  }
  function chrome() {
    var st = document.createElement('style');
    st.setAttribute('data-theme-skip', '');
    st.textContent =
      '*,*::before,*::after{border-radius:0!important;box-shadow:none!important;text-shadow:none!important}' +
      '.oth-logo{display:block;width:min(100%,360px);height:auto;margin:0 0 28px}' +
      '.oth-pixels{position:absolute;top:0;left:0;width:100%;height:min(760px,100vh);pointer-events:none;z-index:1;fill:var(--oth-accent);' +
      '-webkit-mask-image:linear-gradient(#000 55%,transparent);mask-image:linear-gradient(#000 55%,transparent)}';
    document.head.appendChild(st);
    document.body.style.position = 'relative';
    var holder = document.createElement('div');
    holder.id = 'oth-pixels-holder';
    holder.innerHTML = pixelField();
    document.body.insertBefore(holder, document.body.firstChild);
  }
  function placeLogo() {
    var h = document.querySelector('[data-hero-title]');
    if (!h || h.parentElement.querySelector('.oth-logo')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = logoSvg();
    h.parentElement.insertBefore(wrap.firstChild, h.parentElement.firstChild);
  }

  function setTheme(slug) {
    cur = colorsFor(slug);
    HEX.lastIndex = 0;
    try { localStorage.setItem(KEY, slug); } catch (e) {}
    sweep();
    document.documentElement.style.colorScheme = PALETTES[slug][0];
    document.documentElement.style.setProperty('--oth-accent', PALETTES[slug][1]);
    document.querySelectorAll('.oth-item').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.slug === slug ? 'true' : 'false'); });
  }

  function ui() {
    var root = document.createElement('div');
    root.id = 'oth-root';
    root.innerHTML =
      '<style data-theme-skip>' +
      '#oth-root{position:fixed;right:18px;bottom:18px;z-index:99999;font:600 12px "JetBrains Mono",monospace}' +
      '#oth-btn{display:flex;align-items:center;gap:8px;padding:9px 13px;border:1px solid rgba(255,255,255,.18);background:#161514;color:#ece8e1;cursor:pointer;font:inherit;border-radius:3px}' +
      '#oth-btn i{width:10px;height:10px;border-radius:50%;background:var(--oth-accent,#e1892f)}' +
      '#oth-panel{display:none;position:absolute;right:0;bottom:46px;width:min(340px,calc(100vw - 36px));max-height:min(60vh,520px);overflow:auto;padding:12px;background:#161514;border:1px solid rgba(255,255,255,.18);border-radius:3px;box-shadow:0 18px 40px -12px rgba(0,0,0,.7)}' +
      '#oth-root.open #oth-panel{display:block}' +
      '#oth-panel h4{margin:0 0 10px;font:700 12px "JetBrains Mono",monospace;color:#ece8e1}' +
      '#oth-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}' +
      '.oth-item{display:block;padding:7px;border:1px solid rgba(255,255,255,.14);background:#0f0e0d;color:#ece8e1;cursor:pointer;text-align:left;font:inherit;border-radius:3px}' +
      '.oth-item[aria-pressed=true]{border-color:#e1892f;box-shadow:0 0 0 1px #e1892f}' +
      '.oth-sw{display:flex;height:16px;margin-bottom:6px;border-radius:2px;overflow:hidden}' +
      '.oth-sw span{flex:1}' +
      '</style>' +
      '<div id="oth-panel"><h4>Try a theme</h4><div id="oth-grid"></div></div>' +
      '<button id="oth-btn" type="button" aria-expanded="false"><i></i>Theme</button>';
    chrome();
    document.body.appendChild(root);
    var grid = root.querySelector('#oth-grid');
    ORDER.forEach(function (slug) {
      var p = PALETTES[slug], b = document.createElement('button');
      b.type = 'button'; b.className = 'oth-item'; b.dataset.slug = slug;
      b.innerHTML = '<div class="oth-sw">' + [p[2], p[4], p[1], p[5]].map(function (c) { return '<span style="background:' + c + '"></span>'; }).join('') + '</div>' + label(slug);
      b.onclick = function () { setTheme(slug); root.querySelector('#oth-btn i').style.setProperty('--oth-accent', p[1]); root.querySelector('#oth-btn i').style.background = p[1]; };
      grid.appendChild(b);
    });
    root.querySelector('#oth-btn').onclick = function () {
      var open = root.classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    document.addEventListener('mousedown', function (e) { if (!root.contains(e.target)) root.classList.remove('open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') root.classList.remove('open'); });
    var saved = 'gruvbox';
    try { saved = localStorage.getItem(KEY) || saved; } catch (e) {}
    if (!PALETTES[saved]) saved = 'blarange';
    setTheme(saved);
    var dot = root.querySelector('#oth-btn i'); dot.style.background = PALETTES[saved][1];
  }

  if (document.body) ui(); else document.addEventListener('DOMContentLoaded', ui);
})();
