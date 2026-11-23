import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { isMarkdown } from "./files";

export type RevealAction = "reveal" | "open" | "folder";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Shows a file in the host's file manager, opens its folder, or opens a Markdown file with the
 * default app. Opening is limited to Markdown so a link in a document cannot launch a program.
 */
export async function reveal(file: string, action: RevealAction) {
  if (!existsSync(file)) return { ok: false, message: "missing" };
  if (action === "open" && !isMarkdown(file)) return { ok: false, message: "not_markdown" };
  try {
    if (process.platform === "darwin") {
      if (action === "reveal") await run("open", ["-R", file]);
      else if (action === "open") await run("open", [file]);
      else await run("open", [path.dirname(file)]);
    } else if (process.platform === "win32") {
      if (action === "reveal") await run("explorer.exe", [`/select,${file}`]);
      else await run("explorer.exe", [action === "open" ? file : path.dirname(file)]);
    } else {
      await run("xdg-open", [action === "open" ? file : path.dirname(file)]);
    }
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}
