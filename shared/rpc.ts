import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const heading = z.object({ level: z.number(), text: z.string(), id: z.string(), line: z.number() });

/** Markdown to HTML. The client sanitizes the result before showing it. */
export const renderRpc = defineRpc({
  name: "mdviewer.render",
  input: z.object({ text: z.string(), path: z.string().optional() }),
  output: z.object({ html: z.string(), title: z.string(), headings: z.array(heading) }),
});

/** Browser runtimes for the preview frame: Mermaid, DOMPurify and the KaTeX stylesheet. */
export const runtimeRpc = defineRpc({
  name: "mdviewer.runtime",
  input: z.object({}),
  output: z.object({ script: z.string(), purify: z.string(), css: z.string(), version: z.string() }),
});

/** Why a file could not be read or written, for the client to translate. */
const fileProblem = z.enum(["missing", "not_markdown", "too_large"]);

export const readRpc = defineRpc({
  name: "mdviewer.read",
  input: z.object({ path: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), path: z.string(), text: z.string(), mtime: z.number(), version: z.string() }),
    z.object({ status: z.literal("problem"), path: z.string(), problem: fileProblem }),
    z.object({ status: z.literal("error"), path: z.string(), message: z.string() }),
  ]),
});

export const statRpc = defineRpc({
  name: "mdviewer.stat",
  input: z.object({ path: z.string() }),
  output: z.object({ exists: z.boolean(), mtime: z.number() }),
});

export const writeRpc = defineRpc({
  name: "mdviewer.write",
  input: z.object({ path: z.string(), text: z.string(), expectedMtime: z.number().optional(), expectedVersion: z.string().optional() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), mtime: z.number(), version: z.string() }),
    z.object({ status: z.literal("conflict"), mtime: z.number() }),
    z.object({ status: z.literal("problem"), problem: fileProblem }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});

/** Finds which of the mentioned paths are existing Markdown files. */
export const resolveRpc = defineRpc({
  name: "mdviewer.resolve",
  input: z.object({ candidates: z.array(z.string()).max(50), cwd: z.string().optional() }),
  output: z.object({
    files: z.array(z.object({ input: z.string(), path: z.string(), line: z.number().optional() })),
  }),
});

/** Files opened in their own tabs, so the tabs can be restored after a restart. */
export const rememberRpc = defineRpc({
  name: "mdviewer.remember",
  input: z.object({ path: z.string() }),
  output: z.object({}),
});

export const recentRpc = defineRpc({
  name: "mdviewer.recent",
  input: z.object({}),
  output: z.object({ paths: z.array(z.string()) }),
});

/** Reveals a file in the host file manager, or opens a Markdown file or its folder there. */
export const revealRpc = defineRpc({
  name: "mdviewer.reveal",
  input: z.object({ path: z.string(), action: z.enum(["reveal", "open", "folder"]) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

/** Sends a client-side failure to the plugin log, where `paseo plugin logs` shows it. */
export const reportRpc = defineRpc({
  name: "mdviewer.report",
  input: z.object({ message: z.string().max(2000) }),
  output: z.object({}),
});

/** Timeline card an agent posts with the `show_markdown` tool. */
export const cardSchema = z.object({
  path: z.string(),
  name: z.string(),
  title: z.string(),
  line: z.number().optional(),
  headings: z.array(z.string()),
});
export type CardData = z.infer<typeof cardSchema>;
export const CARD_KIND = "mdviewer-card";

/** Row the daemon appends for Markdown files created or changed during a turn. */
export const filesSchema = z.object({
  // Optional so older timeline rows still parse; the client hides rows without this provenance.
  source: z.literal("turn-changes").optional(),
  files: z.array(z.object({ path: z.string(), name: z.string(), line: z.number().optional() })),
});
export type FilesData = z.infer<typeof filesSchema>;
export const FILES_KIND = "mdviewer-files";
