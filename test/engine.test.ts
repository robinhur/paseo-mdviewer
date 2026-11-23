import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { renderMarkdown } from "../server/generated/engine.js";

test("renders GitHub-flavored Markdown", () => {
  const { html } = renderMarkdown(
    [
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- [x] done",
      "- [ ] open",
      "",
      "> [!WARNING]",
      "> careful",
      "",
      "Text[^1] with ~~strike~~, ==mark==, H~2~O and :rocket:",
      "",
      "[^1]: note",
    ].join("\n"),
  );
  assert.match(html, /<div class="table-wrap"><table/);
  assert.match(html, /task-list-item-checkbox/);
  assert.match(html, /markdown-alert-warning/);
  assert.match(html, /class="footnotes"/);
  assert.match(html, /<s>strike<\/s>/);
  assert.match(html, /<mark>mark<\/mark>/);
  assert.match(html, /<sub>2<\/sub>/);
  assert.match(html, /🚀/);
});

test("highlights code and marks Mermaid and math blocks", () => {
  const { html } = renderMarkdown(
    ["```ts", "const x: number = 1;", "```", "", "```mermaid", "flowchart LR", "  A --> B", "```", "", "$E = mc^2$"].join("\n"),
  );
  assert.match(html, /hljs-keyword/);
  assert.match(html, /<span class="code-lang">ts<\/span>/);
  assert.match(html, /<pre class="mermaid">flowchart LR/);
  assert.match(html, /class="katex/);
});

test("escapes Mermaid source so it cannot inject HTML", () => {
  const { html } = renderMarkdown(["```mermaid", 'A["<img src=x onerror=alert(1)>"]', "```"].join("\n"));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&#60;img src=x/);
});

test("turns front matter into a card and keeps line numbers", () => {
  const { html, title, headings } = renderMarkdown(["---", "title: Hello", "tags: [a, b]", "---", "", "# Heading", "", "Body"].join("\n"));
  assert.match(html, /class="front-matter"/);
  assert.match(html, /<span class="chip">a<\/span>/);
  assert.equal(title, "Heading");
  assert.deepEqual(headings, [{ level: 1, text: "Heading", id: "heading", line: 5 }]);
  assert.match(html, /<h1[^>]*data-line="5"/);
});

test("replaces a contents marker with a table of contents", () => {
  for (const marker of ["[[_TOC_]]", "[TOC]"]) {
    const { html } = renderMarkdown(["# Doc", "", "Intro paragraph.", "", marker, "", "## First", "", "## Second"].join("\n"));
    assert.match(html, /<nav class="toc-inline">/);
    assert.match(html, /<a href="#first">First<\/a>/);
    assert.match(html, /<p[^>]*>Intro paragraph\.<\/p>/);
  }
});

test("gives headings ids that work for non-Latin text", () => {
  const { headings } = renderMarkdown("## 8. 표\n\n## Hello, World!");
  assert.deepEqual(
    headings.map((h) => h.id),
    ["8-표", "hello-world"],
  );
});

test("inlines local images from Markdown and raw HTML, and leaves remote ones", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mdviewer-"));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  writeFileSync(path.join(dir, "a.png"), png);
  const doc = path.join(dir, "doc.md");
  const { html } = renderMarkdown(
    ["![one](a.png)", "", '<img src="a.png" width="10">', "", "![remote](https://example.com/x.png)", "", "![gone](missing.png)"].join("\n"),
    doc,
  );
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length, 2);
  assert.match(html, /src="https:\/\/example\.com\/x\.png"/);
  assert.match(html, /src="missing\.png"/);
});

test("marks links to local files with their resolved path", () => {
  const { html } = renderMarkdown("[other](sub/other.md#L12) and [site](https://example.com)", "/docs/readme.md");
  assert.match(html, /data-path="\/docs\/sub\/other\.md"/);
  assert.match(html, /data-target-line="12"/);
  assert.match(html, /data-external="true"/);
});
