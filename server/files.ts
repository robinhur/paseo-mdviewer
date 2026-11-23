import { createHash, randomUUID } from "node:crypto";
import { constants, readdirSync, statSync, type Dirent } from "node:fs";
import { open, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isMarkdownPath } from "../shared/paths";

const MAX_BYTES = 20 * 1024 * 1024;
const pendingWrites = new Map<string, Promise<void>>();

class FileProblem extends Error {
  constructor(readonly problem: "missing" | "not_markdown" | "too_large") {
    super(problem);
  }
}

function problemFor(error: unknown) {
  if (error instanceof FileProblem) return error.problem;
  if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return "missing" as const;
}

async function markdownTarget(file: string) {
  if (!isMarkdown(file)) throw new FileProblem("not_markdown");
  const target = await realpath(file);
  if (!isMarkdown(target)) throw new FileProblem("not_markdown");
  return target;
}

/** Read bytes, version and metadata through one handle, including when another editor replaces the path. */
async function snapshot(file: string) {
  // A .md path can be a FIFO: open non-blocking so fstat can refuse it before reading.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new FileProblem("missing");
    if (info.size > MAX_BYTES) throw new FileProblem("too_large");
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) throw new FileProblem("too_large");
    const version = createHash("sha256").update(bytes).digest("hex");
    return { info, bytes, version };
  } finally {
    await handle.close();
  }
}

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
  return isMarkdownPath(file);
}

/** Reads a Markdown file. Other file types are refused: this plugin only handles Markdown. */
export async function readMarkdown(file: string) {
  try {
    const { info, bytes, version } = await snapshot(await markdownTarget(file));
    const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
    return { status: "ok" as const, path: file, text, mtime: info.mtimeMs, version };
  } catch (error) {
    const problem = problemFor(error);
    if (problem) return { status: "problem" as const, path: file, problem };
    return { status: "error" as const, path: file, message: (error as Error).message };
  }
}

export async function statMarkdown(file: string) {
  try {
    const info = await stat(await markdownTarget(file));
    return { exists: info.isFile(), mtime: info.mtimeMs };
  } catch {
    return { exists: false, mtime: 0 };
  }
}

/** Writes an existing Markdown file. It never creates files or writes other file types. */
export async function writeMarkdown(file: string, text: string, expectedMtime?: number, expectedVersion?: string) {
  try {
    const target = await markdownTarget(file);
    const previous = pendingWrites.get(target);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    pendingWrites.set(target, pending);
    await previous;
    let temporary: string | undefined;
    try {
      const current = await snapshot(target);
      if ((await markdownTarget(file)) !== target ||
          (expectedMtime !== undefined && current.info.mtimeMs !== expectedMtime) ||
          (expectedVersion !== undefined && current.version !== expectedVersion)) {
        return { status: "conflict" as const, mtime: current.info.mtimeMs };
      }

      const hasBom = current.bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
      if (Buffer.byteLength(text, "utf8") + (hasBom ? 3 : 0) > MAX_BYTES) {
        return { status: "problem" as const, problem: "too_large" as const };
      }
      const content = hasBom ? "\uFEFF" + text : text;
      temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
      const handle = await open(temporary, "wx", current.info.mode & 0o777);
      try {
        await handle.chmod(current.info.mode & 0o777);
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Re-check after preparing the replacement. Other applications do not share our queue.
      const latest = await snapshot(target);
      if ((await markdownTarget(file)) !== target || latest.version !== current.version ||
          latest.info.ino !== current.info.ino || latest.info.dev !== current.info.dev ||
          latest.info.mtimeMs !== current.info.mtimeMs) {
        return { status: "conflict" as const, mtime: latest.info.mtimeMs };
      }
      await rename(temporary, target);
      temporary = undefined;
      return {
        status: "ok" as const,
        mtime: (await stat(target)).mtimeMs,
        version: createHash("sha256").update(content, "utf8").digest("hex"),
      };
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
      release();
      if (pendingWrites.get(target) === pending) pendingWrites.delete(target);
    }
  } catch (error) {
    const problem = problemFor(error);
    if (problem) return { status: "problem" as const, problem };
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
      // A bare or partial path: look it up under the working directory, and use it only when
      // exactly one file matches. Common names such as README.md match many files, and a guess
      // would open the wrong one.
      resolved = undefined;
      if (cwd && !path.isAbsolute(file) && !file.startsWith("~/")) {
        index ??= listMarkdown(cwd);
        const suffix = "/" + file.replace(/^\.\//, "");
        const matches = index.filter((p) => p.endsWith(suffix));
        if (matches.length === 1) resolved = matches[0];
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
