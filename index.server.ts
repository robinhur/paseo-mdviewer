import type { PluginServerContext } from "@getpaseo/plugin/server";
import { expandPath, readMarkdown, resolveCandidates, statMarkdown, writeMarkdown } from "./server/files";
import { renderMarkdown } from "./server/generated/engine.js";
import { recent, remember } from "./server/recent";
import { reveal } from "./server/reveal";
import { loadRuntime } from "./server/runtime";
import { showMarkdownTool } from "./server/tool";
import { appendTurnFiles } from "./server/turn-files";
import { logRpc, readRpc, recentRpc, rememberRpc, renderRpc, resolveRpc, revealRpc, runtimeRpc, statRpc, writeRpc } from "./shared/rpc";
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
  server.handle(writeRpc, ({ path, text, expectedMtime }) => writeMarkdown(expandPath(path), text, expectedMtime));
  server.handle(resolveRpc, ({ candidates, cwd }) => resolveCandidates(candidates, cwd));
  server.handle(rememberRpc, ({ path }) => remember(expandPath(path)));
  server.handle(recentRpc, () => recent());
  server.handle(revealRpc, ({ path, action }) => reveal(expandPath(path), action));
  server.handle(logRpc, ({ message }) => {
    console.log(`[mdviewer client] ${message}`);
    return {};
  });

  const removeTool = server.addHook("agent.open.before", async ({ request }) => {
    if (request.purpose !== "interactive" || !(await current()).agentTool) return;
    return { ...request, tools: [...request.tools, showMarkdownTool] };
  });

  const removeTurn = server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
    if (outcome.kind === "canceled" || !(await current()).turnButtons) return;
    try {
      await appendTurnFiles(paseo, agent, turnId);
    } catch (error) {
      console.error("[mdviewer] could not list files for turn", error);
    }
  });

  return () => {
    removeTool();
    removeTurn();
  };
}
