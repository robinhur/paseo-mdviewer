import path from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { findMarkdownPaths } from "../shared/paths";
import { FILES_KIND, type FilesData } from "../shared/rpc";
import { resolveCandidates } from "./files";

interface TextItem {
  type: string;
  text: string;
}

/** Collects user and assistant text items from a timeline payload, in order. */
function collectTextItems(value: unknown, out: TextItem[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 8) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectTextItems(entry, out, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if ((record.type === "assistant_message" || record.type === "user_message") && typeof record.text === "string") {
    out.push({ type: record.type, text: record.text });
    return;
  }
  for (const child of Object.values(record)) collectTextItems(child, out, depth + 1);
}

/** After a turn, appends Open buttons for the existing Markdown files the turn's replies mention. */
export async function appendTurnFiles(
  paseo: PaseoApi,
  agent: { id: string; cwd: string; workspaceId: string | null },
  turnId: string | null,
): Promise<void> {
  const ref = paseo.agents.ref(agent.id);
  const payload = await ref.timeline.refetch({ direction: "tail", limit: 60 });
  const items: TextItem[] = [];
  collectTextItems(payload, items);
  const lastUser = items.map((i) => i.type).lastIndexOf("user_message");
  const replies = items.slice(lastUser + 1).filter((i) => i.type === "assistant_message");
  const candidates = findMarkdownPaths(replies.map((r) => r.text).join("\n"), 40);
  const { files } = candidates.length ? resolveCandidates(candidates, agent.cwd) : { files: [] };
  console.log(
    `[mdviewer] turn ${turnId ?? "?"} agent=${agent.id.slice(0, 8)} items=${items.length} lastUser=${lastUser} replies=${replies.length} candidates=${candidates.length} files=${files.length}`,
  );
  if (!files.length) return;
  const data: FilesData = {
    workspaceId: agent.workspaceId,
    files: files.slice(0, 12).map((f) => ({ path: f.path, name: path.basename(f.path), line: f.line })),
  };
  await ref.timeline.append({
    type: "plugin",
    id: `files-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: FILES_KIND,
    version: 1,
    data,
  });
}
