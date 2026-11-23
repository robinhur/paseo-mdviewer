import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { splitLine } from "../server/files";
import { findMarkdownPaths, isMarkdownPath } from "../shared/paths";
import { lineAt, toggleTaskLine } from "../shared/text-edit";

test("finds Markdown paths in a reply", () => {
  const text = [
    "I wrote `docs/plan.md` and updated /abs/path/notes.markdown.",
    "See [the report](output/report.md:42) and ~/work/todo.md#L7.",
    "Not files: https://example.com/readme.md, config.json, mdfile.",
  ].join("\n");
  assert.deepEqual(findMarkdownPaths(text), [
    "docs/plan.md",
    "/abs/path/notes.markdown",
    "output/report.md:42",
    "~/work/todo.md#L7",
  ]);
});

test("finds each path once and respects the limit", () => {
  assert.deepEqual(findMarkdownPaths("a.md a.md b.md c.md", 2), ["a.md", "b.md"]);
});

test("finds paths with non-Latin names", () => {
  assert.deepEqual(findMarkdownPaths("정리한 문서는 `문서/계획서.md`입니다."), ["문서/계획서.md"]);
});

test("recognizes Markdown extensions", () => {
  for (const name of ["a.md", "A.MD", "x.markdown", "x.mdx", "x.mdown", "x.mkd"]) assert.ok(isMarkdownPath(name), name);
  for (const name of ["a.txt", "md", "a.md.bak", "a.mdz", "/etc/passwd"]) assert.ok(!isMarkdownPath(name), name);
});

test("splits a line number off a path", () => {
  assert.deepEqual(splitLine("a/b.md:12"), { file: "a/b.md", line: 12 });
  assert.deepEqual(splitLine("a/b.md:12-20"), { file: "a/b.md", line: 12 });
  assert.deepEqual(splitLine("a/b.md#L7"), { file: "a/b.md", line: 7 });
  assert.deepEqual(splitLine("a/b.md"), { file: "a/b.md" });
});

test("toggles the task on a line and leaves other lines alone", () => {
  const text = ["# Tasks", "- [ ] one", "- [x] two", "plain"].join("\n");
  assert.equal(toggleTaskLine(text, 1), ["# Tasks", "- [x] one", "- [x] two", "plain"].join("\n"));
  assert.equal(toggleTaskLine(text, 2), ["# Tasks", "- [ ] one", "- [ ] two", "plain"].join("\n"));
  assert.equal(toggleTaskLine(text, 3), null);
  assert.equal(toggleTaskLine("1. [ ] numbered", 0), "1. [x] numbered");
});

test("rejects invalid checkbox line numbers without hanging", () => {
  // The original -1e16 case never advances i++; keep that regression in a killable child.
  const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `
    const assert = require('node:assert/strict');
    const { toggleTaskLine } = require('./shared/text-edit.ts');
    for (const line of [-1e16, -Infinity, Infinity, NaN, -1, 0.5, 1, Number.MAX_SAFE_INTEGER, '0', null, undefined]) {
      assert.equal(toggleTaskLine('- [ ] task', line), null, String(line));
    }
    console.log('invalid lines rejected');
  `], { encoding: "utf8", timeout: 3000, killSignal: "SIGKILL" });
  assert.equal(result.status, 0, `checkbox validation must finish: ${result.error ?? result.stderr}`);
  assert.match(result.stdout, /invalid lines rejected/);
});

test("maps a character offset to its line", () => {
  assert.equal(lineAt("a\nb\nc", 0), 0);
  assert.equal(lineAt("a\nb\nc", 2), 1);
  assert.equal(lineAt("a\nb\nc", 99), 2);
});
