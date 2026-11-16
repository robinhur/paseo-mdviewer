import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { z } from "zod";
import { rememberRpc } from "../shared/rpc";
import { FILLED_BOOK } from "./icons";

export const VIEWER_PANEL_ID = "viewer";

export const viewStateSchema = z.object({
  mode: z.enum(["preview", "split", "source"]),
  outline: z.boolean(),
  scale: z.number(),
  wide: z.boolean(),
});
export type ViewState = z.infer<typeof viewStateSchema>;
export const DEFAULT_VIEW: ViewState = { mode: "preview", outline: false, scale: 1, wide: false };

export const viewerTabSchema = z.object({
  view: viewStateSchema,
  path: z.string().nullable(),
  line: z.number().nullable(),
  back: z.array(z.string()),
  forward: z.array(z.string()),
});
export type ViewerTabState = z.infer<typeof viewerTabSchema>;
export const DEFAULT_VIEWER_TAB: ViewerTabState = { view: DEFAULT_VIEW, path: null, line: null, back: [], forward: [] };

type PanelFactory = (path: string) => ComponentType<PluginWorkspacePanelProps>;

let client: PluginClientContext | null = null;
let factory: PanelFactory | null = null;
const registered = new Map<string, () => void>();
const pending = new Map<string, number>();
const listeners = new Set<(panelId: string) => void>();

export function setClient(value: PluginClientContext | null, makePanel?: PanelFactory) {
  client = value;
  factory = makePanel ?? null;
  if (!value) {
    registered.forEach((remove) => remove());
    registered.clear();
  }
}

/** Stable panel id for a file, so each file gets its own tab and reopening focuses it. */
export function panelIdFor(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `doc-${hash.toString(36)}`;
}

/** Registers the tab panel for `path` once per client session. */
export function ensurePanel(path: string): string {
  const id = panelIdFor(path);
  if (!registered.has(id) && client && factory) {
    const title = path.split("/").pop() ?? path;
    registered.set(id, client.addWorkspacePanel({ id, title, icon: FILLED_BOOK, Component: factory(path) }));
  }
  return id;
}

/** Opens a Markdown file in its own tab in this workspace. */
export function openMarkdown(workspaceId: string, path: string, line?: number) {
  if (!client) return;
  const id = ensurePanel(path);
  if (line != null) pending.set(id, line);
  listeners.forEach((listener) => listener(id));
  client.openPanel(id, { workspaceId });
  void client.rpc(rememberRpc, { path }).catch(() => undefined);
}

export function takePendingLine(panelId: string): number | undefined {
  const line = pending.get(panelId);
  pending.delete(panelId);
  return line;
}

export function onPending(listener: (panelId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
