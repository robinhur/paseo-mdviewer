import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import footnote from "markdown-it-footnote";
import alerts from "markdown-it-github-alerts";
import { full as emoji } from "markdown-it-emoji";
import deflist from "markdown-it-deflist";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import katex from "@vscode/markdown-it-katex";
import hljs from "highlight.js";
import * as yaml from "js-yaml";

export interface RenderEnv {
  [key: string]: unknown;
  /** Absolute path of the document, used to resolve relative links and images. */
  docPath?: string;
  frontMatter?: string;
  headings: { level: number; text: string; id: string; line: number }[];
}

const IMAGE_LIMIT = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

export function slugify(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section"
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function highlight(code: string, lang: string): string {
  const language = lang.toLowerCase();
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // Fall through to plain text.
  }
  return escapeHtml(code);
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

function resolveLocal(href: string, env: RenderEnv): string | undefined {
  if (!href || href.startsWith("#") || isExternal(href)) return undefined;
  const [raw] = href.split(/[?#]/);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw path.
  }
  if (decoded.startsWith("~/")) return path.join(process.env.HOME ?? "", decoded.slice(2));
  if (path.isAbsolute(decoded)) return decoded;
  if (!env.docPath) return undefined;
  return path.resolve(path.dirname(env.docPath), decoded);
}

function inlineImage(src: string, env: RenderEnv): string | undefined {
  const file = resolveLocal(src, env);
  if (!file) return undefined;
  const type = IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()];
  if (!type || !existsSync(file)) return undefined;
  try {
    if (statSync(file).size > IMAGE_LIMIT) return undefined;
    return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  } catch {
    return undefined;
  }
}

type Parser = ReturnType<typeof MarkdownIt>;

function createParser(): Parser {
  const md: Parser = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight: (code, lang) => highlight(code, lang),
  });

  md.use(anchor, {
    slugify,
    permalink: anchor.permalink.linkInsideHeader({ symbol: "#", placement: "before", class: "anchor", ariaHidden: true }),
    callback: (item: { tag: string; map: [number, number] | null }, info: { slug: string; title: string }) => {
      if (!currentEnv) return;
      const line = item.map ? item.map[0] : 0;
      currentEnv.headings.push({ level: Number(item.tag.slice(1)), text: info.title, id: info.slug, line });
    },
  });
  md.use(taskLists, { enabled: true, label: true });
  md.use(footnote);
  md.use(alerts);
  md.use(emoji);
  md.use(deflist);
  md.use(sub);
  md.use(sup);
  md.use(mark);
  md.use(ins);
  md.use(katex, { throwOnError: false, output: "htmlAndMathml" });

  // Source line numbers on block elements, for line jumps, scroll sync and task toggling.
  md.core.ruler.push("source_lines", (state) => {
    for (const item of state.tokens) {
      if (item.map && item.nesting !== -1 && item.block) {
        item.attrSet("data-line", String(item.map[0]));
      }
    }
  });

  const rules = md.renderer.rules;
  const defaultFence = rules.fence!;
  rules.fence = (items, idx, options, env, self) => {
    const item = items[idx];
    const info = item.info.trim();
    const lang = info.split(/\s+/)[0] ?? "";
    const line = item.map ? ` data-line="${item.map[0]}"` : "";
    if (lang === "mermaid") {
      return `<div class="diagram"${line}><pre class="mermaid">${escapeHtml(item.content)}</pre></div>`;
    }
    if (lang === "math" || lang === "latex" || lang === "tex") {
      return `<div class="math-block"${line}>${md.render(`$$\n${item.content}\n$$`)}</div>`;
    }
    const body = defaultFence(items, idx, options, env, self);
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : "";
    return `<div class="code-block"${line}>${label}<button class="copy" type="button" aria-label="Copy code">Copy</button>${body}</div>`;
  };

  const defaultImage = rules.image!;
  rules.image = (items, idx, options, env, self) => {
    const item = items[idx];
    const src = String(item.attrGet("src") ?? "");
    const inlined = inlineImage(src, (env ?? { headings: [] }) as unknown as RenderEnv);
    if (inlined) item.attrSet("src", inlined);
    item.attrSet("loading", "lazy");
    return defaultImage(items, idx, options, env, self);
  };

  const defaultLinkOpen = rules.link_open ?? ((items, idx, options, _env, self) => self.renderToken(items, idx, options));
  rules.link_open = (items, idx, options, env, self) => {
    const item = items[idx];
    const href = String(item.attrGet("href") ?? "");
    const local = resolveLocal(href, (env ?? { headings: [] }) as unknown as RenderEnv);
    if (local) {
      item.attrSet("data-path", local);
      const lineMatch = /#L(\d+)/i.exec(href);
      if (lineMatch) item.attrSet("data-target-line", lineMatch[1]);
    } else if (isExternal(href)) {
      item.attrSet("data-external", "true");
    }
    return defaultLinkOpen(items, idx, options, env, self);
  };

  const defaultTable = rules.table_open ?? ((items, idx, options, _env, self) => self.renderToken(items, idx, options));
  rules.table_open = (items, idx, options, env, self) =>
    `<div class="table-wrap">${defaultTable(items, idx, options, env, self)}`;
  rules.table_close = () => "</table></div>";

  return md;
}

let currentEnv: RenderEnv | undefined;
const parser = createParser();

const TOC_PATTERN = /^[ \t]*(\[\[_TOC_\]\]|\[TOC\]|\[\[TOC\]\])[ \t]*$/im;
const TOC_MARKER = "MDVIEWERTOCMARKER";

function renderToc(headings: RenderEnv["headings"]): string {
  const items = headings
    .filter((h) => h.level >= 2 && h.level <= 4)
    .map((h) => `<li class="toc-l${h.level}"><a href="#${encodeURIComponent(h.id)}">${escapeHtml(h.text)}</a></li>`)
    .join("");
  return items ? `<nav class="toc-inline"><div class="toc-title">Contents</div><ul>${items}</ul></nav>` : "";
}

function renderFrontMatter(raw: string | undefined): string {
  if (!raw?.trim()) return "";
  let data: unknown;
  try {
    data = yaml.load(raw);
  } catch {
    return `<div class="front-matter"><pre>${escapeHtml(raw)}</pre></div>`;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return `<div class="front-matter"><pre>${escapeHtml(raw)}</pre></div>`;
  }
  const rows = Object.entries(data as Record<string, unknown>)
    .map(([key, value]) => {
      const shown = Array.isArray(value)
        ? value.map((v) => `<span class="chip">${escapeHtml(String(v))}</span>`).join("")
        : escapeHtml(value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === "object" ? JSON.stringify(value) : String(value));
      return `<tr><th>${escapeHtml(key)}</th><td>${shown}</td></tr>`;
    })
    .join("");
  return `<div class="front-matter"><table>${rows}</table></div>`;
}

/** Separates a leading YAML block, keeping blank lines in its place so line numbers stay true. */
function splitFrontMatter(text: string): { frontMatter?: string; body: string } {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { body: text };
  const lines = match[0].split("\n").length - 1;
  return { frontMatter: match[1], body: "\n".repeat(lines) + text.slice(match[0].length) };
}

export interface RenderResult {
  html: string;
  title: string;
  headings: RenderEnv["headings"];
}

export function renderMarkdown(text: string, docPath?: string): RenderResult {
  const env: RenderEnv = { docPath, headings: [] };
  currentEnv = env;
  const split = splitFrontMatter(text);
  env.frontMatter = split.frontMatter;
  const hasToc = TOC_PATTERN.test(split.body);
  const source = hasToc ? split.body.replace(TOC_PATTERN, TOC_MARKER) : split.body;
  let body: string;
  try {
    body = parser.render(source, env as unknown as Record<string, unknown>);
  } finally {
    currentEnv = undefined;
  }
  if (hasToc) {
    body = body.replace(new RegExp(`<p[^>]*>\\s*${TOC_MARKER}\\s*</p>`), renderToc(env.headings));
  }
  const title = env.headings.find((h) => h.level === 1)?.text ?? (docPath ? path.basename(docPath) : "Untitled");
  return { html: renderFrontMatter(env.frontMatter) + body, title, headings: env.headings };
}
