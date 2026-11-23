import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { readMarkdown, resolveCandidates, statMarkdown, writeMarkdown } from "../server/files";

const workspaces: string[] = [];
after(() => workspaces.forEach((root) => rmSync(root, { recursive: true, force: true })));

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "mdviewer-"));
  workspaces.push(root);
  mkdirSync(path.join(root, "docs/guide"), { recursive: true });
  mkdirSync(path.join(root, "pkg"), { recursive: true });
  mkdirSync(path.join(root, "node_modules/dep"), { recursive: true });
  writeFileSync(path.join(root, "README.md"), "# root");
  writeFileSync(path.join(root, "pkg/README.md"), "# pkg");
  writeFileSync(path.join(root, "docs/guide/setup.md"), "# setup");
  writeFileSync(path.join(root, "node_modules/dep/unique-in-deps.md"), "# dep");
  writeFileSync(path.join(root, "notes.txt"), "plain");
  return root;
}

test("refuses oversized UTF-8 replacements before changing the original or making temp files", async () => {
  const limit = 20 * 1024 * 1024;
  for (const [name, original, value] of [
    ["ascii", "# original", "A".repeat(limit + 1)],
    ["multibyte", "# original", "한".repeat(Math.floor(limit / 3) + 1)],
    ["bom", "\uFEFF# original", "A".repeat(limit - 2)],
  ]) {
    const file = path.join(workspace(), "README.md");
    writeFileSync(file, original);
    const before = await readMarkdown(file);
    assert.equal(before.status, "ok");
    if (before.status !== "ok") continue;
    assert.deepEqual(await writeMarkdown(file, value, undefined, before.version), { status: "problem", problem: "too_large" }, name);
    assert.deepEqual(await writeMarkdown(file, value), { status: "problem", problem: "too_large" }, `${name}: explicit overwrite`);
    assert.equal(readFileSync(file, "utf8"), original, name);
    assert.equal((await readMarkdown(file)).status, "ok", name);
    assert.deepEqual(readdirSync(path.dirname(file)).filter((entry) => entry.endsWith(".tmp")), [], name);
    // Rejection must release the per-file queue, including for a subsequent explicit overwrite.
    assert.equal((await writeMarkdown(file, "# retry")).status, "ok", name);
  }
});

test("saves and reopens exactly 20 MiB including a preserved UTF-8 BOM", async () => {
  const limit = 20 * 1024 * 1024;
  for (const bom of [false, true]) {
    const file = path.join(workspace(), "README.md");
    writeFileSync(file, (bom ? "\uFEFF" : "") + "# original");
    const value = "A".repeat(limit - (bom ? 3 : 0));
    assert.equal((await writeMarkdown(file, value)).status, "ok");
    assert.equal(statSync(file).size, limit);
    const reopened = await readMarkdown(file);
    assert.equal(reopened.status, "ok");
    if (reopened.status === "ok") assert.ok(reopened.text === value, "boundary save must round-trip");
  }
});

test("resolves relative, absolute and line-numbered paths", () => {
  const root = workspace();
  const { files } = resolveCandidates(["docs/guide/setup.md", path.join(root, "pkg/README.md"), "docs/guide/setup.md:3"], root);
  assert.deepEqual(files, [
    { input: "docs/guide/setup.md", path: path.join(root, "docs/guide/setup.md"), line: undefined },
    { input: path.join(root, "pkg/README.md"), path: path.join(root, "pkg/README.md"), line: undefined },
    { input: "docs/guide/setup.md:3", path: path.join(root, "docs/guide/setup.md"), line: 3 },
  ]);
});

test("finds a bare name only when exactly one file matches", () => {
  const root = workspace();
  const one = resolveCandidates(["setup.md", "guide/setup.md"], root).files.map((f) => f.path);
  assert.deepEqual(one, [path.join(root, "docs/guide/setup.md")]);
  // README.md exists at the root, so the direct path wins; pkg/README.md is not guessed.
  assert.deepEqual(resolveCandidates(["README.md"], root).files[0].path, path.join(root, "README.md"));
  assert.deepEqual(resolveCandidates(["README.md"], path.join(root, "docs")).files, []);
});

test("skips missing files, other file types and dependency folders", () => {
  const root = workspace();
  assert.deepEqual(resolveCandidates(["nope.md", "notes.txt", "unique-in-deps.md"], root).files, []);
});

test("reads only Markdown files", async () => {
  const root = workspace();
  const ok = await readMarkdown(path.join(root, "README.md"));
  assert.equal(ok.status, "ok");
  assert.deepEqual(await readMarkdown(path.join(root, "notes.txt")), {
    status: "problem",
    path: path.join(root, "notes.txt"),
    problem: "not_markdown",
  });
  assert.deepEqual(await readMarkdown(path.join(root, "gone.md")), {
    status: "problem",
    path: path.join(root, "gone.md"),
    problem: "missing",
  });
  assert.deepEqual(await statMarkdown(path.join(root, "notes.txt")), { exists: false, mtime: 0 });
});

// A regression must not hang the test runner: special-file probes run in a killable child.
function probeSpecialFile(file: string) {
  const moduleUrl = pathToFileURL(path.resolve("server/files.ts")).href;
  const script = `
    const imported = await import(${JSON.stringify(moduleUrl)});
    const { readMarkdown, writeMarkdown, statMarkdown } = imported.default ?? imported;
    const file = ${JSON.stringify(file)};
    console.log(JSON.stringify({ read: await readMarkdown(file), write: await writeMarkdown(file, "# no"), stat: await statMarkdown(file) }));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 3000, killSignal: "SIGKILL",
  });
  assert.equal(result.status, 0, `special-file operation must finish, not block: ${result.error ?? result.stderr}`);
  const observed = JSON.parse(result.stdout);
  assert.notEqual(observed.read.status, "ok");
  assert.notEqual(observed.write.status, "ok");
  assert.equal(observed.stat.exists, false);
}

test("refuses a named pipe without waiting for a writer", { skip: process.platform === "win32" }, () => {
  const fifo = path.join(workspace(), "pipe.md");
  execFileSync("mkfifo", [fifo]);
  probeSpecialFile(fifo);
});

test("refuses directories and Unix sockets without blocking", { skip: process.platform === "win32" }, async () => {
  const root = workspace();
  const directory = path.join(root, "dir.md");
  mkdirSync(directory);
  probeSpecialFile(directory);
  const socket = path.join(root, "s.md");
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  try {
    probeSpecialFile(socket);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("writes only existing Markdown files and detects outside changes", async () => {
  const root = workspace();
  const file = path.join(root, "README.md");
  const before = await readMarkdown(file);
  assert.equal(before.status, "ok");
  const mtime = before.status === "ok" ? before.mtime : 0;

  const saved = await writeMarkdown(file, "# changed", mtime);
  assert.equal(saved.status, "ok");
  assert.equal(readFileSync(file, "utf8"), "# changed");

  assert.equal((await writeMarkdown(file, "# stale", mtime - 5000)).status, "conflict");
  assert.equal(readFileSync(file, "utf8"), "# changed");

  assert.deepEqual(await writeMarkdown(path.join(root, "notes.txt"), "x"), { status: "problem", problem: "not_markdown" });
  assert.equal(readFileSync(path.join(root, "notes.txt"), "utf8"), "plain");
  assert.deepEqual(await writeMarkdown(path.join(root, "new.md"), "x"), { status: "problem", problem: "missing" });
});

test("reads a content version from the same bytes as the displayed text", async () => {
  const file = path.join(workspace(), "README.md");
  writeFileSync(file, "\uFEFF# original");
  const before = await readMarkdown(file);
  assert.equal(before.status, "ok");
  if (before.status !== "ok") return;
  assert.equal(before.text, "# original");
  assert.equal(before.version, createHash("sha256").update(readFileSync(file)).digest("hex"));
  const same = await readMarkdown(file);
  assert.equal(same.status === "ok" && same.version, before.version);
  const saved = await writeMarkdown(file, "# changed", undefined, before.version);
  assert.equal(saved.status, "ok");
  assert.equal(readFileSync(file, "utf8"), "\uFEFF# changed");
  const after = await readMarkdown(file);
  assert.equal(after.status === "ok" && after.version, saved.status === "ok" && saved.version);
});

test("concurrent stale saves allow one whole write and reject the other", async () => {
  const file = path.join(workspace(), "README.md");
  const before = await readMarkdown(file);
  assert.equal(before.status, "ok");
  if (before.status !== "ok") return;
  const values = ["A".repeat(1024 * 1024), "B".repeat(10)];
  const results = await Promise.all(values.map((value) => writeMarkdown(file, value, undefined, before.version)));
  assert.deepEqual(results.map((result) => result.status).sort(), ["conflict", "ok"]);
  const winner = results.findIndex((result) => result.status === "ok");
  assert.equal(readFileSync(file, "utf8"), values[winner]);
  assert.deepEqual(readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp")), []);
});

test("forced simultaneous saves remain complete and preserve file permissions", async () => {
  const file = path.join(workspace(), "README.md");
  chmodSync(file, 0o640);
  const values = ["A".repeat(1024 * 1024), "B".repeat(10), "C".repeat(1000)];
  const results = await Promise.all(values.map((value) => writeMarkdown(file, value)));
  assert.ok(results.every((result) => result.status === "ok"));
  assert.ok(values.includes(readFileSync(file, "utf8")), "the file must equal one complete save, never mixed bytes");
  assert.equal(statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp")), []);
});

test("content versions detect external edits even when mtime is preserved", async () => {
  const file = path.join(workspace(), "README.md");
  const before = await readMarkdown(file);
  assert.equal(before.status, "ok");
  if (before.status !== "ok") return;
  const info = statSync(file);
  writeFileSync(file, "# external");
  utimesSync(file, info.atime, info.mtime);
  const result = await writeMarkdown(file, "# stale draft", undefined, before.version);
  assert.equal(result.status, "conflict");
  assert.equal(readFileSync(file, "utf8"), "# external");
});

test("Markdown aliases share the save queue without replacing the symlink", async () => {
  const root = workspace();
  const file = path.join(root, "README.md");
  const alias = path.join(root, "alias.md");
  symlinkSync(file, alias);
  const before = await readMarkdown(alias);
  assert.equal(before.status, "ok");
  if (before.status !== "ok") return;
  const results = await Promise.all([
    writeMarkdown(alias, "# through alias", undefined, before.version),
    writeMarkdown(file, "# through target", undefined, before.version),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["conflict", "ok"]);
  assert.ok(lstatSync(alias).isSymbolicLink());
  assert.equal(readFileSync(alias, "utf8"), readFileSync(file, "utf8"));
});

test("refuses Markdown symlinks to other file types in read, stat and write", async () => {
  const root = workspace();
  const alias = path.join(root, "alias.md");
  symlinkSync(path.join(root, "notes.txt"), alias);
  assert.equal((await readMarkdown(alias)).status, "problem");
  assert.deepEqual(await statMarkdown(alias), { exists: false, mtime: 0 });
  assert.deepEqual(await writeMarkdown(alias, "overwrite"), { status: "problem", problem: "not_markdown" });
  assert.equal(readFileSync(path.join(root, "notes.txt"), "utf8"), "plain");
});

test("failed temp-file writes leave the original and no temporary files", async () => {
  const file = path.join(workspace(), "README.md");
  const result = await writeMarkdown(file, undefined as unknown as string);
  assert.equal(result.status, "error");
  assert.equal(readFileSync(file, "utf8"), "# root");
  assert.deepEqual(readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp")), []);
  assert.equal((await writeMarkdown(file, "# recovered")).status, "ok", "a failed write must release the queue");
});

test("external edits or deletion during temp writes are not overwritten or recreated", async (context) => {
  for (const externalChange of ["edit", "delete"] as const) {
    await context.test(externalChange, async () => {
      const file = path.join(workspace(), "README.md");
      const before = await readMarkdown(file);
      assert.equal(before.status, "ok");
      if (before.status !== "ok") return;
      const open = fsPromises.open;
      const intercepted = mock.method(fsPromises, "open", async (...args: Parameters<typeof open>) => {
        const handle = await open(...args);
        if (String(args[0]).endsWith(".tmp")) {
          const write = handle.writeFile.bind(handle);
          mock.method(handle, "writeFile", async (...writeArgs: Parameters<typeof write>) => {
            await write(...writeArgs);
            if (externalChange === "edit") writeFileSync(file, "# external while saving");
            else rmSync(file);
          });
        }
        return handle;
      });
      syncBuiltinESMExports();
      try {
        const result = await writeMarkdown(file, "# draft", undefined, before.version);
        assert.equal(result.status, externalChange === "edit" ? "conflict" : "problem");
        if (externalChange === "edit") assert.equal(readFileSync(file, "utf8"), "# external while saving");
        else assert.throws(() => statSync(file), { code: "ENOENT" });
        assert.deepEqual(readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp")), []);
      } finally {
        intercepted.mock.restore();
        syncBuiltinESMExports();
      }
    });
  }
});

test("legacy mtime checks reject even sub-millisecond changes", async () => {
  const file = path.join(workspace(), "README.md");
  const before = await readMarkdown(file);
  assert.equal(before.status, "ok");
  if (before.status !== "ok") return;
  assert.equal((await writeMarkdown(file, "# stale", before.mtime - 0.5)).status, "conflict");
  assert.equal(readFileSync(file, "utf8"), "# root");
});
