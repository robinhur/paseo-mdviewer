// Component wiring tests: the real FilesRow and JSX runtime, with host hooks as explicit doubles.
// This does not exercise a live Paseo app or the React renderer lifecycle.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";
import { build } from "esbuild";

interface Element { type: unknown; props: Record<string, unknown> & { children?: unknown } }
const modules: Record<string, string> = {
  "react-native": `export const View='View', Text='Text', Pressable='Pressable';`,
  "@getpaseo/plugin/client": `export const useAgent=()=>globalThis.__turnHarness.workspaceId; export const useTranslation=()=>({t:key=>key});`,
  "@getpaseo/plugin/client/ui": `export const Icon='Icon';`,
  "./messages": `export const messages={};`,
  "./state": `export const openMarkdown=request=>globalThis.__turnHarness.opened.push(request);`,
};
const compiled = build({
  entryPoints: [path.resolve("client/chat.tsx")], bundle: true, write: false,
  platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"],
  plugins: [{ name: "turn-card-host-doubles", setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => args.path in modules ? { path: args.path, namespace: "host-double" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "host-double" }, (args) => ({ contents: modules[args.path], loader: "js" }));
  } }],
});

async function render(data: unknown, workspaceId: string | null = "workspace") {
  const opened: unknown[] = [];
  const module = { exports: {} as { FilesRow: (props: unknown) => Element | null } };
  const bundle = await compiled;
  new Script(bundle.outputFiles[0].text).runInNewContext({
    module, exports: module.exports, require: createRequire(path.resolve("package.json")),
    __turnHarness: { opened, workspaceId },
  });
  const tree = module.exports.FilesRow({ agentId: "agent", item: { data }, theme: { colors: { foregroundMuted: "#888" } } });
  return { tree, opened };
}

function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}

test("legacy mention-only rows are hidden without deleting their timeline data", async () => {
  const data = { files: [{ path: "/workspace/AGENTS.md", name: "AGENTS.md" }] };
  const { tree } = await render(data);
  assert.equal(tree, null);
  assert.equal(data.files.length, 1);
});

test("new change cards have a turn-scoped title and retain the document open target", async () => {
  const data = { source: "turn-changes", files: [{ path: "/workspace/report.md", name: "report.md" }] };
  const { tree, opened } = await render(data);
  const all = elements(tree);
  assert.ok(all.some((element) => element.type === "Text" && element.props.children === "chat.changedThisTurn"));
  const chip = all.find((element) => typeof element.type === "function");
  assert.ok(chip);
  (chip.props.onPress as () => void)();
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{ workspaceId: "workspace", agentId: "agent", path: "/workspace/report.md" }]);
});

test("an empty change card renders no heading or buttons", async () => {
  assert.equal((await render({ source: "turn-changes", files: [] })).tree, null);
});

test("a card without a live workspace cannot expose an unusable open action", async () => {
  assert.equal((await render({ source: "turn-changes", files: [{ path: "/workspace/report.md", name: "report.md" }] }, null)).tree, null);
});
