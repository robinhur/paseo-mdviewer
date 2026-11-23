// Component wiring tests, not a React renderer or live Paseo UI test. The real DocumentView
// and JSX runtime run with explicit hook/host doubles and a real save session. No DOM is used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";
import { build } from "esbuild";
import type { DocumentViewProps } from "../client/document";
import { createSaveSession, type SaveResult } from "../client/save-session";

type Session = ReturnType<typeof createSaveSession>;
type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
type Timer = { delay: number; callback: () => void; cancelled: boolean };

const modules: Record<string, string> = {
  react: `const h=globalThis.__documentHarness;
    export const useCallback=f=>f, useMemo=f=>f(), useRef=v=>({current:v});
    export const useState=v=>[typeof v==='function'?v():v,()=>{}];
    export const useSyncExternalStore=(_subscribe,get)=>get();
    export const useEffect=f=>{h.effects.push(f)};`,
  "react-native": `export const View='View', Text='Text', Pressable='Pressable';`,
  "@getpaseo/plugin/client": `export const useRpc=()=>async()=>({});
    export const useTranslation=()=>({t:key=>key});`,
  "@getpaseo/plugin/client/ui": `export const Icon='Icon', Loading='Loading', Markdown='Markdown', ScrollView='ScrollView', TextInput='TextInput';
    export const copyText=async()=>{}, useToast=()=>({show(){},error(){}});`,
  "@tanstack/react-query": `export const useQuery=()=>({});`,
  "./save-session": `export const createSaveSession=()=>globalThis.__documentHarness.session;`,
  "./preferences": `export const usePreferences=()=>({autosave:globalThis.__documentHarness.autosave,width:'normal'});`,
  "./messages": `export const messages={}, useFrameStrings=()=>({});`,
  "./path-bar": `export const PathBar='PathBar';`,
  "./shell": `export const buildShell=()=>'';`,
  "./web": `export const supportsFrame=false, mountFrame=()=>null, openExternal=async()=>{};`,
  "../shared/rpc": `export const renderRpc={}, revealRpc={}, runtimeRpc={};`,
};

const compiled = build({
  entryPoints: [path.resolve("client/document.tsx")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  external: ["react/jsx-runtime"],
  plugins: [{
    name: "document-host-doubles",
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => args.path in modules ? { path: args.path, namespace: "host-double" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "host-double" }, (args) => ({ contents: modules[args.path], loader: "js" }));
    },
  }],
});

async function renderDocument(session: Session, options: { error?: string; autosave?: boolean; save?: DocumentViewProps["save"] } = {}) {
  const effects: (() => undefined | (() => void))[] = [];
  const timers: Timer[] = [];
  const module = { exports: {} as { DocumentView: (props: DocumentViewProps) => Element } };
  const bundle = await compiled;
  new Script(bundle.outputFiles[0].text).runInNewContext({
    module,
    exports: module.exports,
    require: createRequire(path.resolve("package.json")),
    __documentHarness: { session, effects, autosave: options.autosave ?? true },
    setTimeout(callback: () => void, delay: number) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer: Timer) { timer.cancelled = true; },
  });
  const colors = Object.fromEntries(["surface0", "surface1", "surface2", "foreground", "foregroundMuted", "border", "accent", "accentForeground", "statusSuccess", "statusWarning", "statusDanger"].map((key) => [key, "#202020"]));
  const props: DocumentViewProps = {
    path: "/test/document.md",
    text: undefined,
    version: undefined,
    error: options.error,
    save: options.save ?? (async () => ({ status: "ok", version: "saved" })),
    reload() {},
    view: { mode: "source", outline: false, scale: 1, wide: false },
    setView() {},
    theme: { colors } as DocumentViewProps["theme"],
    compact: false,
    setModified() {},
    onOpen() {},
  };
  const tree = module.exports.DocumentView(props);
  return {
    tree,
    timers,
    runEffects() {
      const cleanups = effects.map((effect) => effect());
      return () => cleanups.forEach((cleanup) => cleanup?.());
    },
  };
}

function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as Element;
  return [element, ...elements(element.props.children)];
}

function text(tree: unknown): string {
  if (typeof tree === "string") return tree;
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return tree && typeof tree === "object" && "props" in tree ? text((tree as Element).props.children) : "";
}

function button(tree: Element, label: string) {
  return elements(tree).find((element) => element.type === "Pressable" && text(element).includes(label));
}

function editedSession() {
  const session = createSaveSession();
  session.receive("disk", "v1");
  session.edit("recoverable draft");
  return session;
}

test("a missing file and failed save keep the source draft and Retry action visible", async () => {
  const session = editedSession();
  await session.save(async () => ({ status: "error", message: "missing" }));
  const { tree } = await renderDocument(session, { error: "File missing" });
  const editor = elements(tree).find((element) => element.type === "TextInput");
  assert.equal(editor?.props.value, "recoverable draft");
  assert.ok(button(tree, "banner.retry"));
  assert.match(text(tree), /File missing/);
});

test("a read error does not hide the conflict choices or editable draft", async () => {
  const session = editedSession();
  session.receive("external", "v2");
  const { tree } = await renderDocument(session, { error: "Read failed" });
  assert.equal(elements(tree).find((element) => element.type === "TextInput")?.props.value, "recoverable draft");
  assert.ok(button(tree, "banner.discard"));
  assert.ok(button(tree, "banner.overwrite"));
});

test("a missing clean file shows its error without a source editor", async () => {
  const { tree } = await renderDocument(createSaveSession(), { error: "File missing" });
  assert.equal(elements(tree).some((element) => element.type === "TextInput"), false);
  assert.match(text(tree), /File missing/);
});

test("a dirty document schedules its real save callback after 700ms and cancels on cleanup", async () => {
  const session = editedSession();
  let calls = 0;
  const rendered = await renderDocument(session, { save: async (value, force, version) => {
    calls++;
    assert.equal(value, "recoverable draft");
    assert.equal(force, false);
    assert.equal(version, "v1");
    return { status: "ok", version: "v2" };
  } });
  const cleanup = rendered.runEffects();
  const saves = rendered.timers.filter((timer) => timer.delay === 700);
  assert.equal(saves.length, 1);
  assert.equal(calls, 0);
  saves[0].callback();
  assert.equal(calls, 1);
  cleanup();
  assert.equal(saves[0].cancelled, true);
});

for (const state of ["disabled", "saving", "conflict", "error"] as const) {
  test(`autosave does not schedule a write when ${state}`, async () => {
    const session = editedSession();
    let release!: (result: SaveResult) => void;
    let pending: Promise<void> | undefined;
    if (state === "saving") pending = session.save(() => new Promise<SaveResult>((resolve) => { release = resolve; }));
    if (state === "conflict") session.receive("external", "v2");
    if (state === "error") await session.save(async () => ({ status: "error", message: "offline" }));
    const rendered = await renderDocument(session, { autosave: state !== "disabled" });
    const cleanup = rendered.runEffects();
    assert.equal(rendered.timers.some((timer) => timer.delay === 700), false);
    cleanup();
    if (pending) {
      release({ status: "ok", version: "v2" });
      await pending;
    }
  });
}
