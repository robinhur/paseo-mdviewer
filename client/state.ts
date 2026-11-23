import type { PluginAgentPanelProps, PluginClientContext } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { z } from "zod";
import { rememberRpc } from "../shared/rpc";
import { FILLED_BOOK } from "./icons";

export const viewStateSchema = z.object({
  mode: z.enum(["preview", "split", "source"]),
  outline: z.boolean(),
  scale: z.number(),
  wide: z.boolean(),
});
export type ViewState = z.infer<typeof viewStateSchema>;

type PanelFactory = (path: string) => ComponentType<PluginAgentPanelProps>;

let client: PluginClientContext | null = null;
let factory: PanelFactory | null = null;
const registered = new Map<string, () => void>();
const pendingLines = new Map<string, number>();
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

/**
 * Registers the tab panel for `path` once per client session. Document tabs are agent panels:
 * Paseo lists workspace panels in the new-tab menu, and one entry per opened file would flood it.
 */
export function ensurePanel(path: string): string {
  const id = panelIdFor(path);
  if (!registered.has(id) && client && factory) {
    const title = path.split("/").pop() ?? path;
    registered.set(id, client.addAgentPanel({ id, title, icon: FILLED_BOOK, Component: factory(path) }));
  }
  return id;
}

export interface OpenRequest {
  workspaceId: string;
  /** The conversation the tab belongs to. */
  agentId: string;
  path: string;
  line?: number;
}

/** Opens a Markdown file in its own tab. */
export function openMarkdown({ workspaceId, agentId, path, line }: OpenRequest) {
  if (!client) return;
  const id = ensurePanel(path);
  if (line != null) pendingLines.set(id, line);
  listeners.forEach((listener) => listener(id));
  client.openPanel(id, { workspaceId, agentId });
  void client.rpc(rememberRpc, { path }).catch(() => undefined);
}

/**
 * Opens a Markdown file from a place that has no conversation of its own, such as a Paseo file
 * tab, using the workspace's most recently updated conversation. Resolves false when there is none.
 */
export async function openFromWorkspace(workspaceId: string, path: string, line?: number): Promise<boolean> {
  if (!client) return false;
  const { entries } = await client.paseo.agents.list();
  const agents = entries
    .map((entry) => entry.agent as { id: string; workspaceId?: string; updatedAt?: string; archivedAt?: string | null })
    .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const agent = agents[0];
  if (!agent) return false;
  openMarkdown({ workspaceId, agentId: agent.id, path, line });
  return true;
}

export function takePendingLine(panelId: string): number | undefined {
  const line = pendingLines.get(panelId);
  pendingLines.delete(panelId);
  return line;
}

export function onPendingLine(listener: (panelId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
