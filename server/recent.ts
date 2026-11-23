import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMarkdown } from "./files";

const LIMIT = 100;
const file = path.join(
  process.env.PASEO_HOME ?? path.join(process.env.HOME ?? "", ".paseo"),
  "plugin-data",
  "paseo-mdviewer",
  "recent.json",
);

function load(): string[] {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a Markdown file opened in its own tab, most recent last. */
export function remember(target: string) {
  if (!isMarkdown(target)) return {};
  const list = load().filter((p) => p !== target);
  list.push(target);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list.slice(-LIMIT)));
  return {};
}

/** Files opened before that still exist, so their restored tabs can find a panel. */
export function recent() {
  return { paths: load().filter((p) => isMarkdown(p) && existsSync(p)) };
}
