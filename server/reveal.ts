import { execFile } from "node:child_process";
import path from "node:path";

export type RevealAction = "reveal" | "open" | "folder";

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10_000 }, (error) => (error ? reject(error) : resolve()));
  });
}

/** Shows a file in the host's file manager, or opens it or its folder with the default app. */
export async function reveal(file: string, action: RevealAction) {
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
