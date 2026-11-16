import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const LIMIT = 300;
const file = path.join(process.env.PASEO_HOME ?? path.join(process.env.HOME ?? "", ".paseo"), "plugin-data", "paseo-mdviewer", "recent.json");

function load(): string[] {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a file opened in its own tab, most recent last. */
export function remember(target: string) {
  const list = load().filter((p) => p !== target);
  list.push(target);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list.slice(-LIMIT)));
  return {};
}

export function recent() {
  return { paths: load() };
}
