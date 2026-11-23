import { lstat, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import type { PluginHookContext } from "@getpaseo/plugin/server";
import { isMarkdownPath } from "../shared/paths";
import { FILES_KIND, type FilesData } from "../shared/rpc";

const MAX_BUTTONS = 12;
const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 8;
const MAX_TRACKED_TURNS = 64;
const SKIP_DIRS = new Set(["node_modules", "venv", "__pycache__", "vendor", "target", "dist", "build", "DerivedData", "Library"]);

interface FileStamp {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}
export interface MarkdownSnapshot {
  root: string;
  files: Map<string, FileStamp>;
  /** Direct entry names, recorded only after a directory was fully enumerated. */
  directoryEntries: Map<string, Set<string>>;
  complete: boolean;
}

/** Metadata only; no file contents, symlinks, hidden paths or dependency trees are read. */
export async function scanMarkdown(cwd: string, maxEntries = MAX_ENTRIES): Promise<MarkdownSnapshot> {
  const snapshot: MarkdownSnapshot = { root: path.resolve(cwd), files: new Map(), directoryEntries: new Map(), complete: true };
  try {
    snapshot.root = await realpath(cwd);
  } catch {
    snapshot.complete = false;
    return snapshot;
  }
  const queue = [{ dir: snapshot.root, depth: 0 }];
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    const { dir, depth } = queue[index];
    try {
      // A directory replaced by a symlink during the scan must not escape the workspace.
      if (await realpath(dir) !== dir) { snapshot.complete = false; continue; }
      const entries = new Set<string>();
      for await (const entry of await opendir(dir)) {
        if (++visited > maxEntries) { snapshot.complete = false; return snapshot; }
        entries.add(entry.name);
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          if (depth < MAX_DEPTH) queue.push({ dir: file, depth: depth + 1 });
          else snapshot.complete = false;
        } else if (entry.isFile() && isMarkdownPath(entry.name)) {
          try {
            const info = await lstat(file);
            if (info.isFile()) snapshot.files.set(file, { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
            else snapshot.complete = false;
          } catch {
            snapshot.complete = false;
          }
        }
      }
      snapshot.directoryEntries.set(dir, entries);
    } catch {
      snapshot.complete = false;
    }
  }
  return snapshot;
}

/** A completed ancestor can prove a new path even when another subtree was not scanned. */
function wasAbsent(before: MarkdownSnapshot, file: string): boolean {
  for (let child = file; child !== before.root;) {
    const parent = path.dirname(child);
    if (parent === child) return false;
    const entries = before.directoryEntries.get(parent);
    if (entries) return !entries.has(path.basename(child));
    child = parent;
  }
  return false;
}

/** A mention is never evidence of a change; unknown paths still require proof of absence. */
export function changedMarkdown(before: MarkdownSnapshot, after: MarkdownSnapshot, endedAt = Infinity): FilesData["files"] {
  if (before.root !== after.root) return [];
  return [...after.files]
    .filter(([file, stamp]) => {
      // ctime is maintained by the filesystem even when a writer preserves mtime.
      if (stamp.ctimeMs >= endedAt) return false;
      const old = before.files.get(file);
      return old ? old.size !== stamp.size || old.mtimeMs !== stamp.mtimeMs || old.ctimeMs !== stamp.ctimeMs : before.complete || wasAbsent(before, file);
    })
    .sort(([a, left], [b, right]) => Math.max(right.mtimeMs, right.ctimeMs) - Math.max(left.mtimeMs, left.ctimeMs) || a.localeCompare(b))
    .slice(0, MAX_BUTTONS)
    .map(([file]) => ({ path: file, name: path.basename(file) }));
}

type Agent = { id: string; cwd: string };
type Enabled = () => boolean | Promise<boolean>;
interface TurnStart {
  agentId: string;
  cwd: string;
  baseline: Promise<MarkdownSnapshot | null>;
  finishing: boolean;
}

/** Per-agent/per-turn baselines; a missing start event never falls back to reply parsing. */
export function createTurnFileTracker(scan = scanMarkdown) {
  const turns = new Map<string, TurnStart>();
  let stopped = false;
  const keyFor = (agent: Agent, turnId: string | null) => JSON.stringify([agent.id, turnId]);
  return {
    async begin(agent: Agent, turnId: string | null, enabled: Enabled = () => true) {
      if (stopped) return;
      const key = keyFor(agent, turnId);
      const existing = turns.get(key);
      if (existing) {
        // Repeated named events are duplicates. Overlapping unnamed turns are ambiguous.
        if (turnId === null) turns.delete(key);
        else await existing.baseline;
        return;
      }
      const start: TurnStart = {
        agentId: agent.id, cwd: agent.cwd, finishing: false,
        baseline: Promise.resolve().then(enabled)
          .then((on) => on && !stopped && turns.get(key) === start ? scan(agent.cwd) : null)
          .catch(() => {
            console.error("[mdviewer] could not capture turn baseline; skipping automatic document card");
            return null;
          }),
      };
      turns.set(key, start);
      if (turns.size > MAX_TRACKED_TURNS) turns.delete(turns.keys().next().value!);
      await start.baseline;
    },
    async finish(paseo: PluginHookContext["paseo"], agent: Agent, turnId: string | null, enabled: Enabled = () => true) {
      // Capture before async settings/scan work; timestamps have millisecond resolution.
      const endedAt = Date.now() + 1;
      const key = keyFor(agent, turnId);
      const start = turns.get(key);
      if (!start || start.finishing || stopped) return;
      start.finishing = true;
      try {
        const before = await start.baseline;
        if (!before || start.cwd !== agent.cwd || !(await enabled()) || turns.get(key) !== start) return;
        const after = await scan(agent.cwd);
        if (stopped || turns.get(key) !== start) return;
        const files = changedMarkdown(before, after, endedAt);
        if (!files.length) return;
        await paseo.agents.ref(agent.id).timeline.append({
          type: "plugin",
          id: `files-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          kind: FILES_KIND,
          version: 1,
          data: { source: "turn-changes", files } satisfies FilesData,
        });
      } finally {
        if (turns.get(key) === start) turns.delete(key);
      }
    },
    forget(agentId: string) {
      for (const [key, start] of turns) if (start.agentId === agentId) turns.delete(key);
    },
    clear() {
      stopped = true;
      turns.clear();
    },
  };
}
