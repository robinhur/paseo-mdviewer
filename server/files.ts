import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_BYTES = 20 * 1024 * 1024;
export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".mdown", ".mkd"]);

export function expandPath(input: string, cwd?: string): string {
  let value = input.trim().replace(/^file:\/\//, "");
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw path.
  }
  if (value.startsWith("~/")) value = path.join(process.env.HOME ?? "", value.slice(2));
  if (!path.isAbsolute(value)) value = path.resolve(cwd ?? process.env.HOME ?? "/", value);
  return path.normalize(value);
}

/** Splits `file.md:12`, `file.md#L12` and `file.md:12-20` into a path and a line. */
export function splitLine(input: string): { file: string; line?: number } {
  const match = /^(.*?\.[A-Za-z0-9]+)(?::(\d+)(?:[-:]\d+)?|#L(\d+)(?:-L?\d+)?)$/.exec(input.trim());
  if (!match) return { file: input.trim() };
  const line = Number(match[2] ?? match[3]);
  return { file: match[1], line: Number.isFinite(line) ? line : undefined };
}

export function isMarkdown(file: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export async function readMarkdown(file: string) {
  try {
    const info = await stat(file);
    if (!info.isFile()) return { status: "missing" as const, path: file };
    if (info.size > MAX_BYTES) return { status: "error" as const, path: file, message: "File is larger than 20 MB" };
    const text = (await readFile(file, "utf8")).replace(/^﻿/, "");
    return { status: "ok" as const, path: file, text, mtime: info.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" as const, path: file };
    return { status: "error" as const, path: file, message: (error as Error).message };
  }
}

export async function statMarkdown(file: string) {
  try {
    const info = await stat(file);
    return { exists: info.isFile(), mtime: info.mtimeMs };
  } catch {
    return { exists: false, mtime: 0 };
  }
}

export async function writeMarkdown(file: string, text: string, expectedMtime?: number) {
  try {
    if (expectedMtime !== undefined && existsSync(file)) {
      const current = statSync(file).mtimeMs;
      if (Math.abs(current - expectedMtime) > 1) return { status: "conflict" as const, mtime: current };
    }
    await writeFile(file, text, "utf8");
    return { status: "ok" as const, mtime: (await stat(file)).mtimeMs };
  } catch (error) {
    return { status: "error" as const, message: (error as Error).message };
  }
}

export function resolveCandidates(candidates: string[], cwd?: string) {
  const seen = new Set<string>();
  const files: { input: string; path: string; line?: number }[] = [];
  let index: string[] | undefined;
  for (const input of candidates) {
    const { file, line } = splitLine(input);
    if (!isMarkdown(file)) continue;
    let resolved: string | undefined = expandPath(file, cwd);
    if (!isFile(resolved)) {
      // A bare or partial path: look it up under the working directory.
      resolved = undefined;
      if (cwd && !path.isAbsolute(file) && !file.startsWith("~/")) {
        index ??= listMarkdown(cwd);
        const suffix = "/" + file.replace(/^\.\//, "");
        const matches = index.filter((p) => p.endsWith(suffix));
        if (matches.length >= 1) resolved = newest(matches);
      }
    }
    const key = `${resolved}:${line ?? ""}`;
    if (!resolved || seen.has(key)) continue;
    seen.add(key);
    files.push({ input, path: resolved, line });
  }
  return { files };
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function newest(paths: string[]): string {
  let best = paths[0];
  let bestTime = -1;
  for (const p of paths) {
    try {
      const time = statSync(p).mtimeMs;
      if (time > bestTime) {
        best = p;
        bestTime = time;
      }
    } catch {
      // Skip unreadable entries.
    }
  }
  return best;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", "DerivedData", "Library"]);
const indexCache = new Map<string, { at: number; paths: string[] }>();

/** Markdown files under `root`, depth- and size-limited, cached for 30 seconds. */
function listMarkdown(root: string): string[] {
  const cached = indexCache.get(root);
  if (cached && Date.now() - cached.at < 30_000) return cached.paths;
  const paths: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length && visited < 4000 && paths.length < 20000) {
    const { dir, depth } = queue.shift()!;
    visited++;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 8 && !SKIP_DIRS.has(entry.name)) queue.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && isMarkdown(entry.name)) {
        paths.push(full);
      }
    }
  }
  indexCache.set(root, { at: Date.now(), paths });
  return paths;
}
