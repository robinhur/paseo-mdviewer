import type { PluginServerContext } from "@getpaseo/plugin/server";
import { expandPath, readMarkdown, resolveCandidates, statMarkdown, writeMarkdown } from "./server/files";
import { renderMarkdown } from "./server/generated/engine.js";
import { recent, remember } from "./server/recent";
import { reveal } from "./server/reveal";
import { loadRuntime } from "./server/runtime";
import { showMarkdownTool } from "./server/tool";
import { createTurnFileTracker } from "./server/turn-files";
import {
  readRpc,
  recentRpc,
  rememberRpc,
  renderRpc,
  reportRpc,
  resolveRpc,
  revealRpc,
  runtimeRpc,
  statRpc,
  writeRpc,
} from "./shared/rpc";
import { DEFAULT_PREFERENCES, preferences, type Preferences } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const current = async (): Promise<Preferences> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_PREFERENCES;
  };

  server.handle(renderRpc, ({ text, path }) => renderMarkdown(text, path));
  server.handle(runtimeRpc, () => loadRuntime());
  server.handle(readRpc, ({ path }) => readMarkdown(expandPath(path)));
  server.handle(statRpc, ({ path }) => statMarkdown(expandPath(path)));
  server.handle(writeRpc, ({ path, text, expectedMtime, expectedVersion }) => writeMarkdown(expandPath(path), text, expectedMtime, expectedVersion));
  server.handle(resolveRpc, ({ candidates, cwd }) => resolveCandidates(candidates, cwd));
  server.handle(rememberRpc, ({ path }) => remember(expandPath(path)));
  server.handle(recentRpc, () => recent());
  server.handle(revealRpc, ({ path, action }) => reveal(expandPath(path), action));
  server.handle(reportRpc, ({ message }) => {
    console.error(`[mdviewer] client: ${message}`);
    return {};
  });

  const removeTool = server.addHook("agent.open.before", async ({ request }) => {
    if (request.purpose !== "interactive" || !(await current()).agentTool) return;
    return { ...request, tools: [...request.tools, showMarkdownTool] };
  });

  const turnFiles = createTurnFileTracker();
  const removeStart = server.addHook("agent.turn.before", ({ agent, turnId }) =>
    turnFiles.begin(agent, turnId, async () => (await current()).turnButtons),
  );
  const removeTurn = server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    try {
      await turnFiles.finish(paseo, agent, turnId, async () => outcome.kind !== "canceled" && (await current()).turnButtons);
    } catch (error) {
      console.error("[mdviewer] could not list files for turn", error);
    }
  });
  const removeClose = server.addHook("agent.close.after", async ({ agent }) => turnFiles.forget(agent.id));
  const removeArchive = server.addHook("agent.archive.after", async ({ agent }) => turnFiles.forget(agent.id));

  return () => {
    removeTool();
    removeStart();
    removeTurn();
    removeClose();
    removeArchive();
    turnFiles.clear();
  };
}
