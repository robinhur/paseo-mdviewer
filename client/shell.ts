export interface ShellTheme {
  dark: boolean;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  surface: string;
  raised: string;
  success: string;
  warning: string;
  danger: string;
}

/** Messages the preview frame sends to the panel. */
export type FrameMessage =
  | { type: "ready" }
  | { type: "open"; path: string; line?: number }
  | { type: "external"; href: string }
  | { type: "copy"; text: string }
  | { type: "toggleTask"; line: number }
  | { type: "line"; line: number }
  | { type: "scale"; scale: number }
  | { type: "log"; message: string };

const BOOT = String.raw`
(function () {
  var content = document.getElementById("content");
  var outline = document.getElementById("outline");
  var overlay = document.getElementById("overlay");
  var stage = document.getElementById("stage");
  var findBar = document.getElementById("find");
  var findInput = document.getElementById("find-input");
  var findCount = document.getElementById("find-count");
  var dark = false;
  var diagramCache = new Map();
  var diagramSeq = 0;
  var pendingLine = null;
  var renderToken = 0;

  function send(message) { parent.postMessage(message, "*"); }

  function setTheme(theme) {
    dark = !!theme.dark;
    var root = document.documentElement;
    var map = { bg: theme.background, fg: theme.foreground, muted: theme.muted, border: theme.border,
      accent: theme.accent, surface: theme.surface, raised: theme.raised, success: theme.success,
      warning: theme.warning, danger: theme.danger };
    Object.keys(map).forEach(function (k) { if (map[k]) root.style.setProperty("--" + k, map[k]); });
    root.dataset.theme = dark ? "dark" : "light";
  }

  function diagramKey(code) { return (dark ? "d:" : "l:") + code; }

  async function drawDiagrams(token) {
    var nodes = Array.prototype.slice.call(content.querySelectorAll("pre.mermaid"));
    if (!nodes.length || !window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default",
      fontFamily: getComputedStyle(document.body).fontFamily,
      themeVariables: { fontSize: "14px" },
    });
    for (var i = 0; i < nodes.length; i++) {
      if (token !== renderToken) return;
      var node = nodes[i];
      var code = node.textContent;
      var key = diagramKey(code);
      var svg = diagramCache.get(key);
      if (!svg) {
        try {
          var result = await window.mermaid.render("mdv-diagram-" + (++diagramSeq), code);
          svg = result.svg;
          diagramCache.set(key, svg);
          if (diagramCache.size > 200) diagramCache.delete(diagramCache.keys().next().value);
        } catch (error) {
          var box = document.createElement("div");
          box.className = "diagram-error";
          box.textContent = "Diagram error: " + (error && error.message ? error.message : String(error));
          node.replaceWith(box);
          var stray = document.getElementById("dmdv-diagram-" + diagramSeq);
          if (stray) stray.remove();
          continue;
        }
      }
      if (token !== renderToken) return;
      var holder = document.createElement("div");
      holder.className = "diagram-svg";
      holder.innerHTML = svg;
      holder.title = "Click to enlarge";
      node.replaceWith(holder);
    }
  }

  function buildOutline() {
    var heads = content.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
    var html = "";
    heads.forEach(function (h) {
      var text = h.textContent.replace(/^#\s*/, "");
      html += '<a class="ol-' + h.tagName.toLowerCase() + '" href="#' + encodeURIComponent(h.id) + '" data-target="' + h.id + '">' + escapeHtml(text) + "</a>";
    });
    outline.querySelector(".ol-items").innerHTML = html || '<div class="ol-empty">No headings</div>';
    spy();
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; });
  }

  function spy() {
    var heads = content.querySelectorAll("h1[id], h2[id], h3[id], h4[id]");
    var current = null;
    heads.forEach(function (h) { if (h.getBoundingClientRect().top < 120) current = h.id; });
    outline.querySelectorAll("a").forEach(function (a) {
      a.classList.toggle("active", a.dataset.target === current);
    });
  }

  function lineElements() { return content.querySelectorAll("[data-line]"); }

  function scrollToLine(line, smooth) {
    var best = null;
    lineElements().forEach(function (el) {
      var n = Number(el.getAttribute("data-line"));
      if (n <= line && (!best || n >= Number(best.getAttribute("data-line")))) best = el;
    });
    if (best) {
      best.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      best.classList.add("flash");
      setTimeout(function () { best.classList.remove("flash"); }, 1400);
    }
  }

  var lastReported = -1;
  function reportLine() {
    var top = null;
    lineElements().forEach(function (el) {
      if (top === null && el.getBoundingClientRect().bottom > 8) top = el;
    });
    var line = top ? Number(top.getAttribute("data-line")) : 0;
    if (line !== lastReported) { lastReported = line; send({ type: "line", line: line }); }
  }

  var scrollTimer = null;
  window.addEventListener("scroll", function () {
    spy();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(reportLine, 120);
  }, { passive: true });

  // Zoom overlay for diagrams and images: pinch or Ctrl+scroll zooms at the pointer, scroll or drag pans.
  var zoom = 1, panX = 0, panY = 0, dragging = null, baseW = 1, baseH = 1, fitZoom = 1;
  function applyView() { stage.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")"; }
  function fit() {
    var vw = overlay.clientWidth, vh = overlay.clientHeight;
    fitZoom = Math.min((vw * 0.9) / baseW, (vh * 0.84) / baseH, 6);
    zoom = fitZoom;
    panX = (vw - baseW * zoom) / 2; panY = (vh - baseH * zoom) / 2;
    applyView();
  }
  function zoomAt(x, y, next) {
    next = Math.min(fitZoom * 16, Math.max(fitZoom * 0.25, next));
    panX = x - (x - panX) * (next / zoom); panY = y - (y - panY) * (next / zoom);
    zoom = next; applyView();
  }
  function openOverlay(source) {
    var node, w, h;
    if (source.tagName === "IMG") {
      node = source.cloneNode(true); node.removeAttribute("loading");
      w = source.naturalWidth || source.width; h = source.naturalHeight || source.height;
    } else {
      var svg = source.querySelector("svg");
      if (!svg) return;
      node = svg.cloneNode(true);
      var box = svg.viewBox && svg.viewBox.baseVal;
      var rect = svg.getBoundingClientRect();
      w = box && box.width ? box.width : rect.width; h = box && box.height ? box.height : rect.height;
      node.removeAttribute("style");
    }
    if (!w || !h) return;
    baseW = w; baseH = h;
    node.setAttribute("width", String(w)); node.setAttribute("height", String(h));
    node.style.width = w + "px"; node.style.height = h + "px"; node.style.maxWidth = "none";
    stage.innerHTML = "";
    stage.appendChild(node);
    overlay.hidden = false;
    fit();
  }
  function closeOverlay() { overlay.hidden = true; stage.innerHTML = ""; }
  overlay.addEventListener("wheel", function (event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoomAt(event.clientX, event.clientY, zoom * Math.exp(-event.deltaY * 0.01));
    else { panX -= event.deltaX; panY -= event.deltaY; applyView(); }
  }, { passive: false });
  overlay.addEventListener("mousedown", function (event) {
    if (event.target.closest(".ov-tools")) return;
    dragging = { x: event.clientX - panX, y: event.clientY - panY };
  });
  overlay.addEventListener("dblclick", function (event) {
    if (event.target.closest(".ov-tools")) return;
    zoomAt(event.clientX, event.clientY, Math.abs(zoom - fitZoom) < 0.01 ? zoom * 2.5 : fitZoom);
  });
  window.addEventListener("mousemove", function (event) {
    if (!dragging) return;
    panX = event.clientX - dragging.x; panY = event.clientY - dragging.y; applyView();
  });
  window.addEventListener("mouseup", function () { dragging = null; });
  var touch = null;
  function touchInfo(list) {
    if (list.length === 1) return { x: list[0].clientX, y: list[0].clientY, d: 0 };
    var a = list[0], b = list[1];
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  }
  overlay.addEventListener("touchstart", function (event) { touch = touchInfo(event.touches); }, { passive: true });
  overlay.addEventListener("touchmove", function (event) {
    if (!touch) return;
    event.preventDefault();
    var now = touchInfo(event.touches);
    panX += now.x - touch.x; panY += now.y - touch.y;
    if (now.d && touch.d) zoomAt(now.x, now.y, zoom * (now.d / touch.d)); else applyView();
    touch = now;
  }, { passive: false });
  overlay.addEventListener("touchend", function (event) { touch = event.touches.length ? touchInfo(event.touches) : null; });
  function centerZoom(factor) { zoomAt(overlay.clientWidth / 2, overlay.clientHeight / 2, zoom * factor); }
  document.getElementById("ov-close").addEventListener("click", closeOverlay);
  document.getElementById("ov-in").addEventListener("click", function () { centerZoom(1.3); });
  document.getElementById("ov-out").addEventListener("click", function () { centerZoom(1 / 1.3); });
  document.getElementById("ov-reset").addEventListener("click", fit);
  window.addEventListener("resize", function () { if (!overlay.hidden) fit(); });

  // Pinch (Ctrl+scroll) on the document changes the text size; the panel stores the result.
  var scale = 1, scaleTimer = null;
  window.addEventListener("wheel", function (event) {
    if (!overlay.hidden || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    scale = Math.min(1.8, Math.max(0.7, scale * Math.exp(-event.deltaY * 0.006)));
    document.documentElement.style.setProperty("--scale", scale.toFixed(3));
    clearTimeout(scaleTimer);
    scaleTimer = setTimeout(function () { send({ type: "scale", scale: Math.round(scale * 100) / 100 }); }, 250);
  }, { passive: false });

  // Find in page.
  function openFind() { findBar.hidden = false; findInput.focus(); findInput.select(); }
  function closeFind() { findBar.hidden = true; clearMarks(); }
  function clearMarks() {
    content.querySelectorAll("mark.mdv-hit").forEach(function (m) {
      var parent = m.parentNode; parent.replaceChild(document.createTextNode(m.textContent), m); parent.normalize();
    });
    hits = []; hitIndex = -1; findCount.textContent = "";
  }
  var hits = [], hitIndex = -1;
  function runFind() {
    clearMarks();
    var query = findInput.value;
    if (!query) return;
    var lower = query.toLowerCase();
    var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.closest("svg, script, style, .katex-mathml")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue, low = text.toLowerCase(), at = low.indexOf(lower);
      if (at < 0) return;
      var frag = document.createDocumentFragment(), last = 0;
      while (at >= 0) {
        frag.appendChild(document.createTextNode(text.slice(last, at)));
        var m = document.createElement("mark"); m.className = "mdv-hit"; m.textContent = text.slice(at, at + query.length);
        frag.appendChild(m); hits.push(m);
        last = at + query.length; at = low.indexOf(lower, last);
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    step(1);
  }
  function step(dir) {
    if (!hits.length) { findCount.textContent = findInput.value ? "0/0" : ""; return; }
    if (hitIndex >= 0) hits[hitIndex].classList.remove("current");
    hitIndex = (hitIndex + dir + hits.length) % hits.length;
    hits[hitIndex].classList.add("current");
    hits[hitIndex].scrollIntoView({ block: "center" });
    findCount.textContent = (hitIndex + 1) + "/" + hits.length;
  }
  var findTimer = null;
  findInput.addEventListener("input", function () { clearTimeout(findTimer); findTimer = setTimeout(runFind, 150); });
  findInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === "Escape") closeFind();
  });
  document.getElementById("find-next").addEventListener("click", function () { step(1); });
  document.getElementById("find-prev").addEventListener("click", function () { step(-1); });
  document.getElementById("find-close").addEventListener("click", closeFind);

  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") { event.preventDefault(); openFind(); }
    if (event.key === "Escape") { if (!overlay.hidden) closeOverlay(); else if (!findBar.hidden) closeFind(); }
  });

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (data.type === "render") {
      if (data.theme) setTheme(data.theme);
      var token = ++renderToken;
      var y = window.scrollY;
      var findOpen = !findBar.hidden && findInput.value;
      content.innerHTML = data.html;
      content.querySelectorAll(".task-list-item-checkbox").forEach(function (box) {
        box.removeAttribute("disabled");
        var li = box.closest("li");
        if (li) li.classList.toggle("done-item", box.checked);
      });
      buildOutline();
      drawDiagrams(token).then(function () {
        if (token !== renderToken) return;
        if (pendingLine !== null) { scrollToLine(pendingLine, false); pendingLine = null; }
        else window.scrollTo(0, y);
        if (findOpen) runFind();
      });
      window.scrollTo(0, y);
    } else if (data.type === "theme") {
      setTheme(data.theme);
    } else if (data.type === "settings") {
      scale = data.scale || 1;
      document.documentElement.style.setProperty("--scale", String(scale));
      document.body.classList.toggle("with-outline", !!data.outline);
      document.body.classList.toggle("wide", !!data.wide);
      document.body.classList.toggle("narrow", !!data.narrow);
    } else if (data.type === "scrollToLine") {
      if (content.childElementCount) scrollToLine(data.line, !!data.smooth); else pendingLine = data.line;
    } else if (data.type === "find") {
      openFind();
    }
  });

  document.addEventListener("click", function (event) {
    var target = event.target;
    var copy = target.closest && target.closest("button.copy");
    if (copy) {
      var code = copy.parentElement.querySelector("pre code") || copy.parentElement.querySelector("pre");
      send({ type: "copy", text: code ? code.textContent : "" });
      copy.textContent = "Copied"; copy.classList.add("done");
      setTimeout(function () { copy.textContent = "Copy"; copy.classList.remove("done"); }, 1200);
      return;
    }
    var box = target.closest && target.closest("input.task-list-item-checkbox");
    if (box) {
      event.preventDefault();
      var item = box.closest("[data-line]");
      if (item) send({ type: "toggleTask", line: Number(item.getAttribute("data-line")) });
      return;
    }
    var diagram = target.closest && target.closest(".diagram-svg");
    if (diagram && !target.closest("a")) { openOverlay(diagram); return; }
    var image = target.closest && target.closest("#content img");
    if (image && !target.closest("a")) { openOverlay(image); return; }
    var link = target.closest && target.closest("a[href]");
    if (!link) return;
    var href = link.getAttribute("href");
    if (href.charAt(0) === "#") {
      event.preventDefault();
      var id = decodeURIComponent(href.slice(1));
      var el = document.getElementById(id) || document.getElementsByName(id)[0];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    event.preventDefault();
    if (link.dataset.path) {
      send({ type: "open", path: link.dataset.path, line: link.dataset.targetLine ? Number(link.dataset.targetLine) : undefined });
    } else {
      send({ type: "external", href: link.href });
    }
  });

  send({ type: "ready" });
})();
`;

const CSS = String.raw`
:root {
  color-scheme: light dark;
  --scale: 1;
  --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --border: #d1d9e0; --accent: #0969da;
  --surface: #f6f8fa; --raised: #ffffff; --success: #1a7f37; --warning: #9a6700; --danger: #d1242f;
  --note: #0969da; --tip: #1a7f37; --important: #8250df; --caution: #d1242f;
  --code-bg: color-mix(in srgb, var(--surface) 82%, var(--fg) 4%);
  --radius: 10px;
  --content-width: 860px;
  --font: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", "Noto Sans KR", sans-serif;
  --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
}
[data-theme="dark"] { --note: #4493f8; --tip: #3fb950; --important: #ab7df8; --caution: #f85149; }
* { box-sizing: border-box; }
html { scroll-padding-top: 24px; }
html, body { margin: 0; background: var(--bg); color: var(--fg); }
body {
  font: calc(15.5px * var(--scale)) / 1.75 var(--font);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  font-feature-settings: "ss01", "ss02", "tnum" 0;
  word-break: keep-all; overflow-wrap: anywhere;
}
::selection { background: color-mix(in srgb, var(--accent) 28%, transparent); }
#content { max-width: var(--content-width); margin: 0 auto; padding: 40px 48px 120px; transition: margin .2s ease; }
body.wide #content { max-width: none; }
body.narrow #content { max-width: 700px; }
body.with-outline #content { margin-right: max(260px, calc((100vw - var(--content-width)) / 2)); }

/* Headings */
h1, h2, h3, h4, h5, h6 { position: relative; line-height: 1.32; margin: 2em 0 .7em; font-weight: 700; letter-spacing: -0.012em; scroll-margin-top: 20px; }
#content > :first-child, #content > .front-matter + h1 { margin-top: 0; }
h1 { font-size: 2.05em; letter-spacing: -0.022em; margin-bottom: .8em; }
h2 { font-size: 1.5em; padding-bottom: .35em; border-bottom: 1px solid var(--border); }
h3 { font-size: 1.24em; }
h4 { font-size: 1.06em; }
h5 { font-size: .95em; }
h6 { font-size: .9em; color: var(--muted); }
.anchor { position: absolute; left: -1.1em; padding-right: .3em; color: var(--muted); opacity: 0; font-weight: 500; text-decoration: none !important; transition: opacity .15s; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor, h5:hover .anchor, h6:hover .anchor { opacity: .55; }

p, ul, ol, dl, blockquote, .table-wrap, .code-block, .diagram, details, .markdown-alert { margin: 0 0 1.05em; }
a { color: var(--accent); text-decoration: none; text-underline-offset: 3px; }
a:hover { text-decoration: underline; }
a[data-path]::after { content: "↗"; font-size: .72em; margin-left: .15em; opacity: .6; }
strong { font-weight: 700; }
hr { height: 1px; border: 0; background: var(--border); margin: 2.2em 0; }
img { max-width: 100%; height: auto; border-radius: 8px; cursor: zoom-in; }
mark { background: color-mix(in srgb, var(--warning) 30%, transparent); color: inherit; padding: 0 .15em; border-radius: 3px; }
ins { text-decoration-color: var(--success); }
kbd {
  font: .82em var(--mono); padding: .12em .45em; border-radius: 6px; background: var(--surface);
  border: 1px solid var(--border); box-shadow: inset 0 -1px 0 var(--border); white-space: nowrap;
}
sub, sup { font-size: .75em; }

/* Lists */
ul, ol { padding-left: 1.6em; }
li { margin: .25em 0; }
li > ul, li > ol { margin: .25em 0 0; }
li::marker { color: var(--muted); }
.task-list-item { list-style: none; position: relative; }
.task-list-item > label { cursor: pointer; }
.contains-task-list { padding-left: 1.25em; }
.task-list-item-checkbox {
  appearance: none; width: 1.05em; height: 1.05em; margin: 0 .55em 0 -1.4em; vertical-align: -.15em;
  border: 1.5px solid var(--muted); border-radius: 5px; cursor: pointer; position: relative; background: var(--bg);
  transition: background .15s, border-color .15s;
}
.task-list-item-checkbox:checked { background: var(--accent); border-color: var(--accent); }
.task-list-item-checkbox:checked::after {
  content: ""; position: absolute; left: .3em; top: .08em; width: .28em; height: .56em;
  border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
}
.task-list-item.done-item > label { color: var(--muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent); }

/* Quotes and alerts */
blockquote { padding: .15em 1.1em; color: var(--muted); border-left: 3px solid var(--border); }
blockquote > :last-child { margin-bottom: 0; }
.markdown-alert {
  --tone: var(--note);
  padding: .75em 1.1em; border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--tone) 35%, transparent);
  background: color-mix(in srgb, var(--tone) 9%, transparent);
}
.markdown-alert > :last-child { margin-bottom: 0; }
.markdown-alert-title { display: flex; align-items: center; gap: .45em; font-weight: 650; color: var(--tone); margin-bottom: .3em; }
.markdown-alert-title svg { fill: currentColor; }
.markdown-alert-tip { --tone: var(--tip); }
.markdown-alert-important { --tone: var(--important); }
.markdown-alert-warning { --tone: var(--warning); }
.markdown-alert-caution { --tone: var(--caution); }

/* Code */
code {
  font: .86em/1.5 var(--mono); padding: .14em .42em; border-radius: 6px;
  color: color-mix(in srgb, var(--accent) 78%, var(--fg));
  background: color-mix(in srgb, var(--accent) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
}
a code { color: inherit; }
.code-block { position: relative; }
.code-block pre {
  margin: 0; background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 16px 18px; overflow: auto; line-height: 1.6; tab-size: 2;
}
.code-block pre code { background: none; border: 0; padding: 0; font-size: .84em; color: var(--fg); }
.code-lang {
  position: absolute; top: 9px; right: 64px; font: 600 .68em var(--mono); text-transform: uppercase;
  letter-spacing: .06em; color: var(--muted); opacity: .8; pointer-events: none;
}
button.copy {
  position: absolute; top: 6px; right: 8px; font: 600 .7em var(--font); color: var(--muted);
  background: var(--raised); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px;
  cursor: pointer; opacity: 0; transition: opacity .15s;
}
.code-block:hover button.copy, button.copy.done { opacity: 1; }
button.copy.done { color: var(--success); border-color: var(--success); }

/* Syntax colors (GitHub palette) */
.hljs-comment, .hljs-quote { color: #6e7781; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-type, .hljs-meta .hljs-keyword, .hljs-doctag { color: #cf222e; }
.hljs-string, .hljs-regexp, .hljs-meta .hljs-string { color: #0a3069; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-attr, .hljs-selector-attr { color: #0550ae; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #8250df; }
.hljs-title.class_, .hljs-built_in { color: #953800; }
.hljs-name, .hljs-tag, .hljs-selector-id, .hljs-selector-class { color: #116329; }
.hljs-addition { color: #116329; background: #dafbe1; }
.hljs-deletion { color: #82071e; background: #ffebe9; }
.hljs-symbol, .hljs-bullet, .hljs-link { color: #0550ae; }
.hljs-meta { color: #6e7781; }
.hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }
[data-theme="dark"] .hljs-comment, [data-theme="dark"] .hljs-quote { color: #8b949e; }
[data-theme="dark"] .hljs-keyword, [data-theme="dark"] .hljs-selector-tag, [data-theme="dark"] .hljs-type, [data-theme="dark"] .hljs-doctag { color: #ff7b72; }
[data-theme="dark"] .hljs-string, [data-theme="dark"] .hljs-regexp { color: #a5d6ff; }
[data-theme="dark"] .hljs-number, [data-theme="dark"] .hljs-literal, [data-theme="dark"] .hljs-variable, [data-theme="dark"] .hljs-attr, [data-theme="dark"] .hljs-selector-attr, [data-theme="dark"] .hljs-symbol, [data-theme="dark"] .hljs-bullet, [data-theme="dark"] .hljs-link { color: #79c0ff; }
[data-theme="dark"] .hljs-title, [data-theme="dark"] .hljs-section { color: #d2a8ff; }
[data-theme="dark"] .hljs-title.class_, [data-theme="dark"] .hljs-built_in { color: #ffa657; }
[data-theme="dark"] .hljs-name, [data-theme="dark"] .hljs-tag, [data-theme="dark"] .hljs-selector-id, [data-theme="dark"] .hljs-selector-class { color: #7ee787; }
[data-theme="dark"] .hljs-addition { color: #aff5b4; background: #033a16; }
[data-theme="dark"] .hljs-deletion { color: #ffdcd7; background: #67060c; }

/* Tables */
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table { border-collapse: collapse; width: 100%; font-size: .94em; font-variant-numeric: tabular-nums; }
th, td { padding: 9px 14px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
th { background: var(--surface); font-weight: 650; font-size: .92em; }
tr:last-child td { border-bottom: 0; }
tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface) 55%, transparent); }
tbody tr:hover td { background: color-mix(in srgb, var(--accent) 7%, transparent); }

/* Front matter, contents, footnotes, details */
.front-matter { margin: 0 0 1.8em; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.front-matter table { font-size: .86em; }
.front-matter th { width: 1%; white-space: nowrap; color: var(--muted); background: transparent; font-weight: 600; }
.front-matter td, .front-matter th { border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); padding: 6px 14px; }
.front-matter tbody tr:nth-child(even) td { background: transparent; }
.front-matter pre { margin: 0; padding: 12px 14px; font: .82em var(--mono); }
.chip { display: inline-block; margin: 0 .35em .2em 0; padding: .05em .6em; border-radius: 999px; background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-size: .92em; }
.toc-inline { border: 1px solid var(--border); border-radius: var(--radius); padding: .8em 1.2em; margin: 0 0 1.6em; background: var(--surface); }
.toc-inline .toc-title { font-weight: 650; font-size: .85em; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: .3em; }
.toc-inline ul { list-style: none; padding: 0; margin: 0; columns: 2 220px; column-gap: 2em; }
.toc-inline li { margin: .1em 0; break-inside: avoid; }
.toc-inline .toc-l3 { padding-left: 1em; font-size: .94em; }
.toc-inline .toc-l4 { padding-left: 2em; font-size: .9em; }
.footnotes { margin-top: 3em; font-size: .88em; color: var(--muted); }
.footnotes-sep { margin-top: 3em; }
.footnote-ref a { font-weight: 600; }
details { border: 1px solid var(--border); border-radius: var(--radius); padding: .55em 1em; background: var(--surface); }
details[open] { padding-bottom: .2em; }
summary { cursor: pointer; font-weight: 600; outline: none; }
details[open] > summary { margin-bottom: .6em; }
dt { font-weight: 650; }
dd { margin: 0 0 .6em 1.4em; color: var(--muted); }

/* Diagrams and math */
.diagram {
  display: flex; justify-content: center; padding: 18px; border: 1px solid var(--border);
  border-radius: var(--radius); background: color-mix(in srgb, var(--surface) 55%, var(--bg)); overflow-x: auto;
}
.diagram pre.mermaid { margin: 0; color: var(--muted); font: .8em var(--mono); white-space: pre-wrap; opacity: .5; }
.diagram-svg { cursor: zoom-in; max-width: 100%; }
.diagram-svg svg { max-width: 100%; height: auto; }
.diagram-error { color: var(--danger); font: .82em var(--mono); white-space: pre-wrap; }
.katex-display { overflow-x: auto; overflow-y: hidden; padding: .4em 0; }
.math-block { text-align: center; }

/* Highlights */
.flash { animation: flash 1.4s ease; border-radius: 6px; }
@keyframes flash { 0%, 40% { background: color-mix(in srgb, var(--accent) 20%, transparent); } 100% { background: transparent; } }
mark.mdv-hit { background: color-mix(in srgb, var(--warning) 45%, transparent); }
mark.mdv-hit.current { background: var(--warning); color: var(--bg); }

/* Outline */
#outline {
  position: fixed; top: 0; right: 0; bottom: 0; width: 240px; padding: 28px 18px 28px 14px;
  border-left: 1px solid var(--border); background: var(--bg); overflow-y: auto; display: none; font-size: .82em;
}
body.with-outline #outline { display: block; }
#outline .ol-title { font-weight: 650; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-size: .85em; margin: 0 0 .8em .6em; }
#outline a { display: block; padding: .28em .6em; border-radius: 6px; color: var(--muted); line-height: 1.4; border-left: 2px solid transparent; }
#outline a:hover { color: var(--fg); background: var(--surface); text-decoration: none; }
#outline a.active { color: var(--accent); border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
#outline .ol-h1 { font-weight: 650; color: var(--fg); }
#outline .ol-h3 { padding-left: 1.5em; }
#outline .ol-h4 { padding-left: 2.4em; font-size: .95em; }
#outline .ol-empty { color: var(--muted); padding: .3em .6em; }

/* Find bar */
#find {
  position: fixed; top: 12px; right: 18px; z-index: 20; display: flex; align-items: center; gap: 4px;
  padding: 6px 6px 6px 10px; border-radius: 10px; background: var(--raised); border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0,0,0,.18); font-size: 13px;
}
#find[hidden] { display: none; }
#find input { width: 180px; border: 0; outline: none; background: transparent; color: var(--fg); font: inherit; }
#find-count { color: var(--muted); min-width: 3.4em; text-align: right; font-variant-numeric: tabular-nums; }
#find button, .ov-tools button {
  border: 0; background: transparent; color: var(--fg); width: 28px; height: 28px; border-radius: 7px; cursor: pointer; font-size: 14px;
}
#find button:hover, .ov-tools button:hover { background: var(--surface); }

/* Zoom overlay */
#overlay { position: fixed; inset: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: blur(6px); overflow: hidden; cursor: grab; }
#overlay[hidden] { display: none; }
#overlay:active { cursor: grabbing; }
#stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
#stage > * { display: block; }
#stage img { cursor: grab; border-radius: 4px; }
.ov-tools {
  position: absolute; top: 14px; right: 14px; display: flex; gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--raised); border: 1px solid var(--border); box-shadow: 0 8px 24px rgba(0,0,0,.18); z-index: 2;
}
.ov-hint { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); color: var(--muted); font-size: 12px; }

@media (max-width: 700px) {
  #content { padding: 22px 18px 80px; }
  body.with-outline #outline { display: none; }
  body.with-outline #content { margin-right: auto; }
  .anchor { display: none; }
}
@media print {
  #outline, #find, #overlay, button.copy { display: none !important; }
  #content { max-width: none; padding: 0; }
}
`;

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script");
}

export function buildShell(runtimeScript: string, runtimeCss: string): string {
  return [
    '<!doctype html><html data-theme="light"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${runtimeCss}</style>`,
    `<style>${CSS}</style>`,
    "</head><body>",
    '<main id="content"></main>',
    '<nav id="outline" aria-label="Outline"><div class="ol-title">On this page</div><div class="ol-items"></div></nav>',
    '<div id="find" hidden><input id="find-input" type="search" placeholder="Find in document" aria-label="Find in document">',
    '<span id="find-count"></span><button id="find-prev" title="Previous (Shift+Enter)">↑</button>',
    '<button id="find-next" title="Next (Enter)">↓</button><button id="find-close" title="Close (Esc)">✕</button></div>',
    '<div id="overlay" hidden><div class="ov-tools"><button id="ov-out" title="Zoom out">−</button>',
    '<button id="ov-reset" title="Reset">⟲</button><button id="ov-in" title="Zoom in">+</button>',
    '<button id="ov-close" title="Close (Esc)">✕</button></div><div id="stage"></div>',
    '<div class="ov-hint">Pinch or Ctrl+scroll to zoom · drag or scroll to pan · double-click to zoom · Esc to close</div></div>',
    `<script>${escapeScript(runtimeScript)}</script>`,
    `<script>${BOOT}</script>`,
    "</body></html>",
  ].join("");
}
