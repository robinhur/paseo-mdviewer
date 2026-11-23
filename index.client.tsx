import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FilesRow, MarkdownCard } from "./client/chat";
import { makeDocPanel } from "./client/doc-panel";
import { MarkdownFilePanel } from "./client/file-panel";
import { FILLED_BOOK } from "./client/icons";
import { messages } from "./client/messages";
import { SettingsScreen } from "./client/settings-screen";
import { ensurePanel, openMarkdown, setClient } from "./client/state";
import { MARKDOWN_EXTENSIONS } from "./shared/paths";
import { CARD_KIND, cardSchema, FILES_KIND, filesSchema, recentRpc, reportRpc, resolveRpc } from "./shared/rpc";

const SETTINGS_ID = "preferences";

export default function contribute(client: PluginClientContext) {
  setClient(client, makeDocPanel);
  const report = (message: string) => void client.rpc(reportRpc, { message }).catch(() => undefined);

  // Re-register the tabs of files opened before, so tabs Paseo restores find their panels.
  client.rpc(recentRpc, {}).then(
    ({ paths }) => paths.forEach((path) => ensurePanel(path)),
    (error: Error) => report(`could not restore document tabs: ${error.message}`),
  );

  const cleanups: PluginCleanup[] = [];
  const register = (name: string, add: () => PluginCleanup) => {
    try {
      cleanups.push(add());
    } catch (error) {
      report(`could not register ${name}: ${(error as Error).message}`);
    }
  };

  register("file panel", () =>
    client.addFilePanel({
      id: "markdown",
      title: "MDViewer",
      icon: FILLED_BOOK,
      files: { extensions: [...MARKDOWN_EXTENSIONS] },
      Component: MarkdownFilePanel,
    }),
  );
  register("reply buttons", () =>
    client.addTimelineRenderer({ kind: FILES_KIND, version: 1, schema: filesSchema, Component: FilesRow }),
  );
  register("agent card", () =>
    client.addTimelineRenderer({ kind: CARD_KIND, version: 1, schema: cardSchema, Component: MarkdownCard }),
  );
  register("/mdv", () =>
    client.addSlashCommand({
      name: "mdv",
      description: messages.message("command.description"),
      argumentHint: messages.message("command.hint"),
      context: "agent",
      async onSubmit({ args, workspace, agent, rpc }) {
        const input = args.trim();
        if (!input) throw new Error(client.i18n.t(messages, "command.usage"));
        const { files } = await rpc(resolveRpc, { candidates: [input], cwd: agent.cwd || workspace.directory });
        const file = files[0];
        if (!file) throw new Error(client.i18n.t(messages, "command.notFound", { path: input }));
        openMarkdown({ workspaceId: workspace.id, agentId: agent.id, path: file.path, line: file.line });
      },
    }),
  );
  register("settings screen", () =>
    client.addSettingsScreen({
      id: SETTINGS_ID,
      title: messages.message("settings.title"),
      icon: "Settings",
      Component: SettingsScreen,
    }),
  );
  register("settings command", () =>
    client.addCommandCenterItem({
      id: "settings",
      title: messages.message("command.settings"),
      icon: FILLED_BOOK,
      context: "global",
      onSelect({ openSettings }) {
        openSettings(SETTINGS_ID);
      },
    }),
  );

  return () => {
    cleanups.forEach((cleanup) => void cleanup());
    setClient(null);
  };
}
