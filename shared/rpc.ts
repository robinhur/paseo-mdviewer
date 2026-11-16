import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const heading = z.object({ level: z.number(), text: z.string(), id: z.string(), line: z.number() });

export const renderRpc = defineRpc({
  name: "mdviewer.render",
  input: z.object({ text: z.string(), path: z.string().optional() }),
  output: z.object({ html: z.string(), title: z.string(), headings: z.array(heading) }),
});

export const runtimeRpc = defineRpc({
  name: "mdviewer.runtime",
  input: z.object({}),
  output: z.object({ script: z.string(), css: z.string(), version: z.string() }),
});

export const readRpc = defineRpc({
  name: "mdviewer.read",
  input: z.object({ path: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), path: z.string(), text: z.string(), mtime: z.number() }),
    z.object({ status: z.literal("missing"), path: z.string() }),
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
  input: z.object({ path: z.string(), text: z.string(), expectedMtime: z.number().optional() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), mtime: z.number() }),
    z.object({ status: z.literal("conflict"), mtime: z.number() }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});

export const resolveRpc = defineRpc({
  name: "mdviewer.resolve",
  input: z.object({ candidates: z.array(z.string()).max(50), cwd: z.string().optional() }),
  output: z.object({
    files: z.array(z.object({ input: z.string(), path: z.string(), line: z.number().optional() })),
  }),
});

/** Timeline card an agent posts with the `show_markdown` tool. */
export const cardSchema = z.object({
  path: z.string(),
  name: z.string(),
  title: z.string(),
  line: z.number().optional(),
  headings: z.array(z.string()),
  workspaceId: z.string().nullable(),
});
export type CardData = z.infer<typeof cardSchema>;
export const CARD_KIND = "mdviewer-card";

/** Row the daemon appends after a turn, listing the Markdown files that turn's replies mention. */
export const filesSchema = z.object({
  workspaceId: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), name: z.string(), line: z.number().optional() })),
});
export type FilesData = z.infer<typeof filesSchema>;
export const FILES_KIND = "mdviewer-files";

/** Client diagnostics, written to the plugin log. */
export const logRpc = defineRpc({
  name: "mdviewer.log",
  input: z.object({ message: z.string().max(2000) }),
  output: z.object({}),
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

/** Reveals a file in the host file manager, or opens it or its folder there. */
export const revealRpc = defineRpc({
  name: "mdviewer.reveal",
  input: z.object({ path: z.string(), action: z.enum(["reveal", "open", "folder"]) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});
