// Runs the real preview document in Chromium. Needs CHROME_PATH pointing at a Chromium binary;
// without it these tests are skipped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { buildShell, DEFAULT_STRINGS } from "../client/shell";
import { renderMarkdown } from "../server/generated/engine.js";
import { loadRuntime } from "../server/runtime";

const executablePath = process.env.CHROME_PATH;
const skip = executablePath ? false : "set CHROME_PATH to run browser tests";
const THEME = {
  dark: true,
  background: "#1d1f24",
  foreground: "#e6e7ea",
  muted: "#9aa0a8",
  border: "#33363d",
  accent: "#5b9bff",
  surface: "#25282e",
  raised: "#2c2f36",
  success: "#3fb950",
  warning: "#d29922",
  danger: "#f85149",
};

let browser: Browser;
const shell = buildShell(loadRuntime());

before(async () => {
  if (!skip) browser = await chromium.launch({ executablePath });
});
after(async () => {
  await browser?.close();
});

/** Loads the preview document and renders `markdown` in it, recording what it posts to its parent. */
async function open(markdown: string, docPath = "/tmp/doc.md"): Promise<{ page: Page; posted: { type: string }[] }> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const posted: { type: string }[] = [];
  await page.exposeFunction("__posted", (message: { type: string }) => posted.push(message));
  await page.setContent(shell, { waitUntil: "load" });
  const html = renderMarkdown(markdown, docPath).html;
  await page.evaluate(
    ({ html, theme }) => {
      window.addEventListener("message", (event) => {
        if (event.data && typeof event.data.type === "string" && event.data.type !== "render") {
          (window as unknown as { __posted(m: unknown): void }).__posted(event.data);
        }
      });
      window.postMessage({ type: "render", html, theme }, "*");
    },
    { html, theme: THEME },
  );
  await page.waitForFunction(() => document.querySelector("#mdv-content")?.childElementCount, null, { timeout: 15_000 });
  return { page, posted };
}

test("the document carries a content security policy and loads its sanitizer", { skip }, async () => {
  const { page } = await open("# hello");
  const state = await page.evaluate(() => ({
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "",
    purify: typeof (window as unknown as { DOMPurify?: unknown }).DOMPurify,
    mermaid: typeof (window as unknown as { mermaid?: unknown }).mermaid,
  }));
  assert.match(state.csp, /default-src 'none'/);
  assert.match(state.csp, /script-src 'nonce-[a-z0-9]+'/);
  assert.match(state.csp, /connect-src 'none'/);
  assert.doesNotMatch(state.csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.equal(state.purify, "function");
  assert.equal(state.mermaid, "object");
  await page.close();
});

test("a malformed raw checkbox cannot hang task-line handling", { skip }, async () => {
  const { page } = await open('<input class="task-list-item-checkbox" data-line="-10000000000000000" type="checkbox">');
  try {
    await page.evaluate(() => {
      const state = window as unknown as { checkboxLine?: number };
      window.addEventListener("message", (event) => {
        if (event.data?.type === "toggleTask") state.checkboxLine = event.data.line;
      });
    });
    await page.click("input.task-list-item-checkbox");
    await page.waitForFunction(() => (window as unknown as { checkboxLine?: number }).checkboxLine !== undefined);
    const line = await page.evaluate(() => (window as unknown as { checkboxLine: number }).checkboxLine);
    assert.equal(line, -1e16);
    // Exercise the actual parent helper in a child so a regression cannot freeze the runner.
    const checked = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      const { toggleTaskLine } = require('./shared/text-edit.ts');
      if (toggleTaskLine('- [ ] task', ${JSON.stringify(line)}) !== null) process.exit(1);
      console.log('hostile checkbox ignored');
    `], { encoding: "utf8", timeout: 3000, killSignal: "SIGKILL" });
    assert.equal(checked.status, 0, String(checked.error ?? checked.stderr));
    assert.match(checked.stdout, /hostile checkbox ignored/);
  } finally {
    await page.close();
  }
});

test("HTML in a document cannot run script or message the panel", { skip }, async () => {
  const hostile = [
    "# title",
    "",
    `<img src="x" onerror="window.__ran = 1; parent.postMessage({ type: 'copy', text: 'stolen' }, '*')">`,
    "",
    "<script>window.__script = 1</script>",
    "",
    `<a href="javascript:window.__link = 1" id="js">link</a>`,
    "",
    `<svg><a xlink:href="javascript:window.__svg = 1"><text>x</text></a></svg>`,
    "",
    `<iframe src="https://example.com"></iframe>`,
    "",
    `<form action="https://example.com"><input name="q"></form>`,
    "",
    `<style>#mdv-content { display: none }</style>`,
    "",
    `<div onclick="window.__click = 1" id="clickme">click</div>`,
  ].join("\n");
  const { page, posted } = await open(hostile);
  await page.click("#clickme");
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const content = document.querySelector("#mdv-content")!;
    return {
      ran: w.__ran,
      script: w.__script,
      link: w.__link,
      svg: w.__svg,
      click: w.__click,
      handlers: content.querySelectorAll("[onerror], [onclick]").length,
      forbidden: content.querySelectorAll("script, iframe, form, style").length,
      jsLinks: [...content.querySelectorAll("a")].filter((a) => /^javascript:/i.test(a.getAttribute("href") ?? "")).length,
      visible: getComputedStyle(content).display !== "none",
    };
  });
  assert.deepEqual(state, {
    ran: undefined,
    script: undefined,
    link: undefined,
    svg: undefined,
    click: undefined,
    handlers: 0,
    forbidden: 0,
    jsLinks: 0,
    visible: true,
  });
  assert.deepEqual(
    posted.filter((message) => message.type === "copy"),
    [],
  );
  await page.close();
});

test("the policy blocks an inline handler even if one reached the page", { skip }, async () => {
  const { page } = await open("# hello");
  const ran = await page.evaluate(async () => {
    const img = document.createElement("img");
    img.setAttribute("onerror", "window.__bypass = 1");
    img.src = "data:image/png;base64,broken";
    document.body.appendChild(img);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return (window as unknown as { __bypass?: number }).__bypass;
  });
  assert.equal(ran, undefined);
  await page.close();
});

test("keeps what a document needs: math, alerts, checkboxes, anchors and data attributes", { skip }, async () => {
  const { page } = await open(
    ["## Section", "", "- [x] done", "", "> [!NOTE]", "> note", "", "$E = mc^2$", "", "```js", "let a = 1;", "```", "", "[next](other.md#L3)"].join("\n"),
    "/docs/readme.md",
  );
  const state = await page.evaluate(() => {
    const content = document.querySelector("#mdv-content")!;
    return {
      headingId: content.querySelector("h2")?.id,
      checkbox: content.querySelectorAll("input.task-list-item-checkbox:checked").length,
      alert: content.querySelectorAll(".markdown-alert-note svg").length,
      katex: content.querySelectorAll(".katex .mord").length > 0,
      styled: content.querySelectorAll(".katex [style]").length > 0,
      code: content.querySelectorAll(".hljs-keyword").length,
      copy: content.querySelector("button.copy")?.textContent,
      path: content.querySelector("a[data-path]")?.getAttribute("data-path"),
      line: content.querySelector("[data-line]") !== null,
    };
  });
  assert.deepEqual(state, {
    headingId: "section",
    checkbox: 1,
    alert: 1,
    katex: true,
    styled: true,
    code: 1,
    copy: DEFAULT_STRINGS.copy,
    path: "/docs/other.md",
    line: true,
  });
  await page.close();
});

test("a heading named like a viewer element does not take over its styling", { skip }, async () => {
  const { page } = await open("## Outline\n\n## Find\n\n## Content\n\ntext");
  const state = await page.evaluate(() => ({
    headings: [...document.querySelectorAll("#mdv-content h2")].map((h) => getComputedStyle(h).position),
    outlineHidden: getComputedStyle(document.querySelector("#mdv-outline")!).display,
  }));
  assert.deepEqual(state.headings, ["relative", "relative", "relative"]);
  assert.equal(state.outlineHidden, "none");
  await page.close();
});

test("draws every Mermaid diagram type under the policy", { skip }, async () => {
  const source = readFileSync(path.join(import.meta.dirname, "fixtures/diagrams.md"), "utf8");
  const expected = (source.match(/```mermaid/g) ?? []).length;
  const { page } = await open(source);
  await page.waitForFunction(() => document.querySelectorAll("pre.mermaid").length === 0, null, { timeout: 60_000 });
  const state = await page.evaluate(() => ({
    drawn: document.querySelectorAll(".diagram-svg svg").length,
    errors: [...document.querySelectorAll(".diagram-error")].map((e) => e.textContent),
    empty: [...document.querySelectorAll(".diagram-svg svg")].filter((svg) => svg.getBoundingClientRect().width < 20).length,
  }));
  assert.equal(expected, 9);
  assert.deepEqual(state, { drawn: 9, errors: [], empty: 0 });
  await page.close();
});

test("shows translated text sent by the panel", { skip }, async () => {
  const { page } = await open("[[_TOC_]]\n\n## One\n\n```js\nlet a;\n```");
  await page.evaluate(() =>
    window.postMessage({ type: "strings", strings: { copy: "복사", contents: "목차", onThisPage: "이 문서의 목차" } }, "*"),
  );
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => ({
    copy: document.querySelector("button.copy")?.textContent,
    contents: document.querySelector(".toc-title")?.textContent,
    outline: document.querySelector("#mdv-outline .ol-title")?.textContent,
  }));
  assert.deepEqual(state, { copy: "복사", contents: "목차", outline: "이 문서의 목차" });
  await page.close();
});
