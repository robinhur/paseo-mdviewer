import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { Script } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { changedMarkdown, createTurnFileTracker, scanMarkdown, type MarkdownSnapshot } from "../server/turn-files";

type Tracker = ReturnType<typeof createTurnFileTracker>;
interface Card { data: { source: string; files: { path: string; name: string }[] } }

function fixture(context: TestContext) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mdviewer-turn-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function host() {
  const cards: { agentId: string; card: Card }[] = [];
  const paseo = { agents: { ref: (agentId: string) => ({ timeline: {
    refetch() { throw new Error("turn cards must not inspect reply text, including AGENTS.md mentions"); },
    async append(card: Card) { cards.push({ agentId, card }); },
  } }) } } as unknown as Parameters<Tracker["finish"]>[0];
  return { cards, paseo };
}

function snapshot(root: string, files: Record<string, number>, complete = true): MarkdownSnapshot {
  return { root, complete, directoryEntries: new Map(), files: new Map(Object.entries(files).map(([name, revision]) => [path.join(root, name), { size: revision, mtimeMs: revision, ctimeMs: revision }])) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test("an unchanged AGENTS.md produces no card and does not require reading the reply", async (context) => {
  const cwd = fixture(context);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# instructions");
  const tracker = createTurnFileTracker();
  const agent = { id: "codex", cwd };
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn");
  await tracker.finish(paseo, agent, "turn");
  assert.equal(cards.length, 0);
});

test("a new Markdown document gets a card without a mention in the reply", async (context) => {
  const cwd = fixture(context);
  const agent = { id: "claude", cwd };
  const tracker = createTurnFileTracker();
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn");
  writeFileSync(path.join(cwd, "unmentioned-report.md"), "# report");
  await tracker.finish(paseo, agent, "turn");
  assert.deepEqual(cards.map(({ card }) => card.data), [{ source: "turn-changes", files: [{ path: path.join(cwd, "unmentioned-report.md"), name: "unmentioned-report.md" }] }]);
});

test("an actually changed AGENTS.md remains eligible regardless of its filename", async (context) => {
  const cwd = fixture(context);
  const file = path.join(cwd, "AGENTS.md");
  writeFileSync(file, "old");
  const tracker = createTurnFileTracker();
  const agent = { id: "agent", cwd };
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn");
  writeFileSync(file, "changed instructions");
  await tracker.finish(paseo, agent, "turn");
  assert.deepEqual(cards[0]?.card.data.files, [{ path: file, name: "AGENTS.md" }]);
});

test("deleted documents and non-Markdown files do not create buttons", async (context) => {
  const cwd = fixture(context);
  const file = path.join(cwd, "removed.md");
  writeFileSync(file, "old");
  const before = await scanMarkdown(cwd);
  rmSync(file);
  writeFileSync(path.join(cwd, "report.txt"), "not Markdown");
  assert.deepEqual(changedMarkdown(before, await scanMarkdown(cwd)), []);
});

test("the scan skips hidden, dependency, build and symlink entries", async (context) => {
  const cwd = fixture(context);
  for (const dir of [".hidden", "node_modules", "build", "dist"]) {
    mkdirSync(path.join(cwd, dir));
    writeFileSync(path.join(cwd, dir, "ignored.md"), "ignored");
  }
  writeFileSync(path.join(cwd, ".hidden.md"), "hidden");
  const outside = fixture(context);
  writeFileSync(path.join(outside, "outside.md"), "outside");
  symlinkSync(path.join(outside, "outside.md"), path.join(cwd, "linked.md"));
  symlinkSync(outside, path.join(cwd, "linked-dir"), "dir");
  writeFileSync(path.join(cwd, "included.markdown"), "include");
  const scan = await scanMarkdown(cwd);
  assert.deepEqual([...scan.files.keys()], [path.join(cwd, "included.markdown")]);
});

test("an entry budget marks the snapshot incomplete instead of claiming a full scan", async (context) => {
  const cwd = fixture(context);
  for (let index = 0; index < 4; index++) writeFileSync(path.join(cwd, `${index}.md`), "file");
  const scan = await scanMarkdown(cwd, 2);
  assert.equal(scan.complete, false);
  assert.ok(scan.files.size <= 2);
  assert.equal(scan.directoryEntries.has(cwd), false);
});

test("an incomplete baseline suppresses unknown new files but retains proven changes", () => {
  const before = snapshot("/workspace", { "known.md": 1 }, false);
  const after = snapshot("/workspace", { "known.md": 2, "unknown.md": 3 });
  assert.deepEqual(changedMarkdown(before, after), [{ path: "/workspace/known.md", name: "known.md" }]);
});

test("a completed folder keeps new documents eligible when another folder exhausts the scan", () => {
  const before = Object.assign(snapshot("/workspace", { "data/wiki/log.md": 1 }, false), {
    directoryEntries: new Map([["/workspace/output/daily", new Set<string>()]]),
  });
  const after = snapshot("/workspace", {
    "data/wiki/log.md": 2,
    "output/daily/briefing.md": 3,
    "unscanned/existing.md": 4,
  });
  assert.deepEqual(changedMarkdown(before, after).map(({ name }) => name), ["briefing.md", "log.md"]);
});

test("new folders are proven by an absent ancestor, not by an unscanned existing folder", () => {
  const before = Object.assign(snapshot("/workspace", {}, false), {
    directoryEntries: new Map([["/workspace", new Set(["existing", "unstamped.md"])]]),
  });
  const after = snapshot("/workspace", {
    "new/deeper/report.md": 3,
    "existing/old.md": 2,
    "unstamped.md": 1,
  });
  assert.deepEqual(changedMarkdown(before, after), [{ path: "/workspace/new/deeper/report.md", name: "report.md" }]);
});

for (const provider of ["codex", "claude"]) {
  test(`${provider}: a partial filesystem scan publishes the new briefing and changed wiki only`, async (context) => {
    const cwd = fixture(context);
    const daily = path.join(cwd, "output", "daily");
    const wiki = path.join(cwd, "data", "wiki", "log.md");
    const noise = path.join(cwd, "other", "nested", "noise");
    mkdirSync(daily, { recursive: true });
    mkdirSync(path.dirname(wiki), { recursive: true });
    mkdirSync(noise, { recursive: true });
    writeFileSync(wiki, "old log");
    writeFileSync(path.join(cwd, "AGENTS.md"), "unchanged instructions");
    for (let i = 0; i < 64; i++) writeFileSync(path.join(noise, `${i}.txt`), "noise");
    const scan = (root: string) => scanMarkdown(root, 24);
    const baseline = await scan(cwd);
    assert.equal(baseline.complete, false);
    const tracker = createTurnFileTracker(scan);
    const agent = { id: provider, cwd };
    const { cards, paseo } = host();
    await tracker.begin(agent, "briefing-turn");
    writeFileSync(path.join(daily, "briefing.md"), "# daily briefing");
    writeFileSync(wiki, "updated log");
    await tracker.finish(paseo, agent, "briefing-turn");
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0].card.data.files.map(({ name }) => name).sort(), ["briefing.md", "log.md"]);
  });
}

test("snapshots from different workspace roots cannot produce a change card", () => {
  assert.deepEqual(changedMarkdown(snapshot("/old", {}), snapshot("/new", { "report.md": 1 })), []);
});

test("change buttons are capped at the twelve most recent documents", () => {
  const files = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`${index}.md`, index + 1]));
  const changed = changedMarkdown(snapshot("/workspace", {}), snapshot("/workspace", files));
  assert.equal(changed.length, 12);
  assert.equal(changed[0].name, "14.md");
  assert.equal(changed.at(-1)?.name, "3.md");
});

test("two agents in one workspace keep independent turn baselines", async (context) => {
  const cwd = fixture(context);
  const tracker = createTurnFileTracker();
  const first = { id: "codex", cwd };
  const second = { id: "claude", cwd };
  const { cards, paseo } = host();
  await tracker.begin(first, "one");
  writeFileSync(path.join(cwd, "earlier.md"), "earlier");
  await tracker.begin(second, "two");
  writeFileSync(path.join(cwd, "later.md"), "later");
  await tracker.finish(paseo, first, "one");
  await tracker.finish(paseo, second, "two");
  assert.deepEqual(cards.find(({ agentId }) => agentId === "codex")?.card.data.files.map(({ name }) => name).sort(), ["earlier.md", "later.md"]);
  assert.deepEqual(cards.find(({ agentId }) => agentId === "claude")?.card.data.files.map(({ name }) => name), ["later.md"]);
});

test("overlapping turn ids for one agent do not consume each other's baseline", async (context) => {
  const cwd = fixture(context);
  const agent = { id: "agent", cwd };
  const tracker = createTurnFileTracker();
  const { cards, paseo } = host();
  await tracker.begin(agent, "older");
  writeFileSync(path.join(cwd, "older.md"), "older");
  await tracker.begin(agent, "newer");
  writeFileSync(path.join(cwd, "newer.md"), "newer");
  await tracker.finish(paseo, agent, "mismatched");
  assert.equal(cards.length, 0);
  await tracker.finish(paseo, agent, "older");
  await tracker.finish(paseo, agent, "newer");
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[1].card.data.files.map(({ name }) => name), ["newer.md"]);
});

test("duplicate start and finish events do not reset or repeat a known turn", async (context) => {
  const cwd = fixture(context);
  const agent = { id: "agent", cwd };
  const tracker = createTurnFileTracker();
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn");
  writeFileSync(path.join(cwd, "report.md"), "report");
  await tracker.begin(agent, "turn");
  await Promise.all([tracker.finish(paseo, agent, "turn"), tracker.finish(paseo, agent, "turn")]);
  assert.equal(cards.length, 1);
});

test("sequential turns without provider turn ids do not reuse old changes", async (context) => {
  const cwd = fixture(context);
  const agent = { id: "agent", cwd };
  const tracker = createTurnFileTracker();
  const { cards, paseo } = host();
  for (const name of ["first.md", "second.md"]) {
    await tracker.begin(agent, null);
    writeFileSync(path.join(cwd, name), "new");
    await tracker.finish(paseo, agent, null);
  }
  assert.deepEqual(cards.map(({ card }) => card.data.files.map(({ name }) => name)), [["first.md"], ["second.md"]]);
});

test("an end event waits for its delayed start baseline instead of creating an orphan", async () => {
  const enabled = deferred<boolean>();
  let scans = 0;
  const scan = async () => ++scans === 1 ? snapshot("/workspace", {}) : snapshot("/workspace", { "report.md": 1 });
  const tracker = createTurnFileTracker(scan);
  const agent = { id: "agent", cwd: "/workspace" };
  const { cards, paseo } = host();
  const beginning = tracker.begin(agent, "turn", () => enabled.promise);
  const ending = tracker.finish(paseo, agent, "turn");
  enabled.resolve(true);
  await Promise.all([beginning, ending]);
  await tracker.finish(paseo, agent, "turn");
  assert.equal(cards.length, 1);
});

test("disabled turn cards do not scan the workspace", async () => {
  let scans = 0;
  const tracker = createTurnFileTracker(async () => { scans++; return snapshot("/workspace", {}); });
  const agent = { id: "agent", cwd: "/workspace" };
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn", () => false);
  await tracker.finish(paseo, agent, "turn");
  assert.equal(scans, 0);
  assert.equal(cards.length, 0);
});

for (const stop of ["disabled-at-end", "forget", "clear"] as const) {
  test(`${stop} prevents a pending turn card from being appended`, async (context) => {
    const cwd = fixture(context);
    const agent = { id: "agent", cwd };
    const tracker = createTurnFileTracker();
    const { cards, paseo } = host();
    await tracker.begin(agent, "turn");
    writeFileSync(path.join(cwd, "report.md"), "report");
    if (stop === "forget") tracker.forget(agent.id);
    if (stop === "clear") tracker.clear();
    await tracker.finish(paseo, agent, "turn", () => stop !== "disabled-at-end");
    assert.equal(cards.length, 0);
  });
}

test("an end event without a captured baseline cannot claim pre-existing files", async () => {
  let scans = 0;
  const tracker = createTurnFileTracker(async () => { scans++; return snapshot("/workspace", { "AGENTS.md": 1 }); });
  const { cards, paseo } = host();
  await tracker.finish(paseo, { id: "agent", cwd: "/workspace" }, "unknown");
  assert.equal(cards.length, 0);
  assert.equal(scans, 0);
});

test("overlapping unnamed turns are suppressed instead of guessing a baseline", async (context) => {
  const cwd = fixture(context);
  const agent = { id: "agent", cwd };
  const tracker = createTurnFileTracker();
  const { cards, paseo } = host();
  await tracker.begin(agent, null);
  writeFileSync(path.join(cwd, "report.md"), "report");
  await tracker.begin(agent, null);
  await tracker.finish(paseo, agent, null);
  assert.equal(cards.length, 0);
});

test("a failed start scan logs only a diagnostic and does not publish existing files", async (context) => {
  let scans = 0;
  const logged = context.mock.method(console, "error", () => {});
  const tracker = createTurnFileTracker(async () => {
    if (++scans === 1) throw new Error("synthetic file content must not appear in logs");
    return snapshot("/workspace", { "AGENTS.md": 1 });
  });
  const agent = { id: "agent", cwd: "/workspace" };
  const { cards, paseo } = host();
  await tracker.begin(agent, "turn");
  await tracker.finish(paseo, agent, "turn");
  assert.equal(cards.length, 0);
  assert.equal(scans, 1);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /baseline/);
  assert.doesNotMatch(JSON.stringify(logged.mock.calls[0].arguments), /synthetic file content/);
});

for (const stop of ["forget", "clear"] as const) {
  test(`${stop} prevents a delayed start settings check from triggering a scan`, async () => {
    const checked = deferred<void>();
    const enabled = deferred<boolean>();
    let scans = 0;
    const tracker = createTurnFileTracker(async () => { scans++; return snapshot("/workspace", {}); });
    const agent = { id: "agent", cwd: "/workspace" };
    const beginning = tracker.begin(agent, "turn", () => { checked.resolve(); return enabled.promise; });
    await checked.promise;
    if (stop === "forget") tracker.forget(agent.id);
    else tracker.clear();
    enabled.resolve(true);
    await beginning;
    assert.equal(scans, 0);
  });
}

for (const operation of ["creation", "modification with preserved mtime"] as const) {
  test(`a file's ${operation} after the turn ends cannot leak into a delayed end card`, async (context) => {
    const cwd = fixture(context);
    const file = path.join(cwd, "later.md");
    if (operation !== "creation") writeFileSync(file, "original");
    const before = operation !== "creation" ? statSync(file) : undefined;
    const tracker = createTurnFileTracker();
    const agent = { id: "agent", cwd };
    const { cards, paseo } = host();
    await tracker.begin(agent, "turn");
    const checked = deferred<void>();
    const enabled = deferred<boolean>();
    const ending = tracker.finish(paseo, agent, "turn", () => { checked.resolve(); return enabled.promise; });
    await checked.promise;
    // Keep the actual filesystem's ctime strictly beyond the millisecond-resolution cutoff.
    await delay(20);
    writeFileSync(file, "created or changed after the end event");
    if (before) utimesSync(file, before.atime, before.mtime);
    enabled.resolve(true);
    await ending;
    assert.equal(cards.length, 0);
  });
}

test("the explicit end cutoff also excludes a later ctime when mtime was preserved", () => {
  const before = snapshot("/workspace", { "report.md": 1 });
  const after = snapshot("/workspace", { "report.md": 2 });
  after.files.get("/workspace/report.md")!.mtimeMs = 1;
  after.files.get("/workspace/report.md")!.ctimeMs = 101;
  assert.deepEqual(changedMarkdown(before, after, 100), []);
});

for (const stop of ["forget", "clear"] as const) {
  test(`${stop} also suppresses a card while its end scan is in flight`, async () => {
    let scans = 0;
    const endStarted = deferred<void>();
    const endResult = deferred<MarkdownSnapshot>();
    const tracker = createTurnFileTracker(async () => {
      if (++scans === 1) return snapshot("/workspace", {});
      endStarted.resolve();
      return endResult.promise;
    });
    const agent = { id: "agent", cwd: "/workspace" };
    const { cards, paseo } = host();
    await tracker.begin(agent, "turn");
    const ending = tracker.finish(paseo, agent, "turn");
    await endStarted.promise;
    if (stop === "forget") tracker.forget(agent.id);
    else tracker.clear();
    endResult.resolve(snapshot("/workspace", { "report.md": 1 }));
    await ending;
    assert.equal(cards.length, 0);
  });
}

// Exercise the actual server registration and tracker together. Only unrelated SDK/RPC services
// are doubled; these tests do not start or reload a Paseo daemon or agent.
const serverModules: Record<string, string> = {
  "./server/files": "export const expandPath=x=>x, readMarkdown=()=>{}, resolveCandidates=()=>{}, statMarkdown=()=>{}, writeMarkdown=()=>{};",
  "./server/generated/engine.js": "export const renderMarkdown=()=>{};",
  "./server/recent": "export const recent=()=>{}, remember=()=>{};",
  "./server/reveal": "export const reveal=()=>{};",
  "./server/runtime": "export const loadRuntime=()=>{};",
  "./server/tool": "export const showMarkdownTool={};",
  "./shared/settings": "export const DEFAULT_PREFERENCES={turnButtons:true,agentTool:false}, preferences={};",
  "./shared/rpc": "export const readRpc={},recentRpc={},rememberRpc={},renderRpc={},reportRpc={},resolveRpc={},revealRpc={},runtimeRpc={},statRpc={},writeRpc={};",
  "../shared/rpc": "export const FILES_KIND='mdviewer-files';",
};
const serverBundle = build({
  entryPoints: [path.resolve("index.server.ts")], bundle: true, write: false, platform: "node", format: "cjs",
  plugins: [{ name: "turn-hook-services", setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => args.path in serverModules ? { path: args.path, namespace: "service-double" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "service-double" }, (args) => ({ contents: serverModules[args.path], loader: "js" }));
  } }],
});

async function registeredHooks() {
  type Handler = (event: unknown, context: { paseo: Parameters<Tracker["finish"]>[0] }) => unknown | Promise<unknown>;
  const hooks = new Map<string, Handler>();
  const { cards, paseo } = host();
  const module = { exports: {} as { default: (server: unknown) => () => void } };
  const bundle = await serverBundle;
  new Script(bundle.outputFiles[0].text).runInNewContext({ module, exports: module.exports, require: createRequire(path.resolve("package.json")), console });
  const cleanup = module.exports.default({
    registerSettings: () => ({ read: async () => ({ status: "ready", values: { turnButtons: true, agentTool: false } }) }),
    handle() {},
    addHook(name: string, handler: Handler) { hooks.set(name, handler); return () => { hooks.delete(name); }; },
  });
  return {
    cards,
    cleanup,
    async fire(name: string, event: unknown) {
      const handler = hooks.get(name);
      assert.ok(handler, `missing hook registration ${name}`);
      await handler(event, { paseo });
    },
  };
}

for (const provider of ["codex", "claude"] as const) {
  test(`registered ${provider} turn hooks produce a change card without inspecting its reply`, async (context) => {
    const cwd = fixture(context);
    const { fire, cards, cleanup } = await registeredHooks();
    context.after(cleanup);
    const agent = { id: provider, cwd, provider };
    await fire("agent.turn.before", { agent, turnId: "turn" });
    writeFileSync(path.join(cwd, "report.md"), "report");
    await fire("agent.turn.after", { agent, turnId: "turn", outcome: { kind: "completed" } });
    assert.equal(cards.length, 1);
    assert.equal(cards[0].agentId, provider);
    assert.equal(cards[0].card.data.source, "turn-changes");
  });
}

test("the registered canceled-turn hook consumes its baseline without publishing a card", async (context) => {
  const cwd = fixture(context);
  const { fire, cards, cleanup } = await registeredHooks();
  context.after(cleanup);
  const agent = { id: "agent", cwd };
  await fire("agent.turn.before", { agent, turnId: "turn" });
  writeFileSync(path.join(cwd, "report.md"), "report");
  await fire("agent.turn.after", { agent, turnId: "turn", outcome: { kind: "canceled" } });
  await fire("agent.turn.after", { agent, turnId: "turn", outcome: { kind: "completed" } });
  assert.equal(cards.length, 0);
});

for (const hook of ["agent.close.after", "agent.archive.after"] as const) {
  test(`the registered ${hook} hook clears the agent's turn baseline`, async (context) => {
    const cwd = fixture(context);
    const { fire, cards, cleanup } = await registeredHooks();
    context.after(cleanup);
    const agent = { id: "agent", cwd };
    await fire("agent.turn.before", { agent, turnId: "turn" });
    writeFileSync(path.join(cwd, "report.md"), "report");
    await fire(hook, { agent });
    await fire("agent.turn.after", { agent, turnId: "turn", outcome: { kind: "completed" } });
    assert.equal(cards.length, 0);
  });
}
