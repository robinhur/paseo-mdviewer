import path from "node:path";
import { defineAgentTool } from "@getpaseo/plugin/server";
import { z } from "zod";
import { CARD_KIND, type CardData } from "../shared/rpc";
import { expandPath, readMarkdown, splitLine } from "./files";
import { renderMarkdown } from "./generated/engine.js";

const PROBLEMS = {
  missing: "does not exist",
  not_markdown: "is not a Markdown file",
  too_large: "is larger than 20 MB",
} as const;

/** Lets an agent point the user at a document it wrote, as a card with an Open button. */
export const showMarkdownTool = defineAgentTool({
  name: "show_markdown",
  title: "Show Markdown",
  description:
    "Show a Markdown file to the user in MDViewer. Posts a card in this conversation with an Open button. " +
    "Use it after writing or updating a report, plan or document the user should read. " +
    "Accepts an absolute path, a path relative to your working directory, or `file.md:LINE` to jump to a line.",
  input: z.object({
    path: z.string().min(1).describe("Markdown file path. Relative paths resolve against your working directory."),
    line: z.number().int().positive().optional().describe("1-based line to scroll to."),
  }),
  async execute({ path: input, line }, { agent, paseo }) {
    const parts = splitLine(input);
    const file = expandPath(parts.file, agent.cwd);
    const read = await readMarkdown(file);
    if (read.status === "problem") return { text: `${file} ${PROBLEMS[read.problem]}.`, isError: true };
    if (read.status === "error") return { text: read.message, isError: true };
    const rendered = renderMarkdown(read.text, file);
    const data: CardData = {
      path: file,
      name: path.basename(file),
      title: rendered.title,
      line: line ?? parts.line,
      headings: rendered.headings
        .filter((h) => h.level === 2)
        .slice(0, 6)
        .map((h) => h.text),
    };
    await paseo.agents.ref(agent.id).timeline.append({
      type: "plugin",
      id: `card-${file}`,
      kind: CARD_KIND,
      version: 1,
      data,
    });
    return {
      text: `Posted an MDViewer card for ${file}. The user can open it from the conversation.`,
      structuredContent: { path: file },
    };
  },
});
