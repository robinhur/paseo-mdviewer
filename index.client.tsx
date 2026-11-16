import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CARD_KIND, cardSchema, FILES_KIND, filesSchema, logRpc, recentRpc, resolveRpc } from "./shared/rpc";
import { FilesRow, MarkdownCard } from "./client/chat";
import { FILLED_BOOK } from "./client/icons";
import { MarkdownFilePanel } from "./client/file-panel";
import { ensurePanel, openMarkdown, setClient, VIEWER_PANEL_ID } from "./client/state";
import { SettingsScreen } from "./client/settings-screen";
import { makeDocPanel, MarkdownViewerPanel } from "./client/viewer-panel";

export default function contribute(client: PluginClientContext) {
  setClient(client, makeDocPanel);
  // Re-register tabs for files opened before, so restored tabs find their panels.
  void client
    .rpc(recentRpc, {})
    .then(({ paths }) => paths.forEach((path) => ensurePanel(path)))
    .catch(() => undefined);
  const cleanups: PluginCleanup[] = [];
  const register = (name: string, add: () => PluginCleanup) => {
    try {
      cleanups.push(add());
    } catch (error) {
      void client.rpc(logRpc, { message: `register ${name} failed: ${(error as Error).message}` }).catch(() => undefined);
    }
  };

  register("file-panel", () =>
    client.addFilePanel({
      id: "markdown",
      title: "MDViewer",
      icon: FILLED_BOOK,
      files: { extensions: ["md", "markdown", "mdx", "mdown", "mkd"] },
      Component: MarkdownFilePanel,
    }),
  );
  register("viewer-panel", () =>
    client.addWorkspacePanel({ id: VIEWER_PANEL_ID, title: "MDViewer", icon: FILLED_BOOK, Component: MarkdownViewerPanel }),
  );
  register("files-row", () =>
    client.addTimelineRenderer({ kind: FILES_KIND, version: 1, schema: filesSchema, Component: FilesRow }),
  );
  register("card", () =>
    client.addTimelineRenderer({ kind: CARD_KIND, version: 1, schema: cardSchema, Component: MarkdownCard }),
  );
  register("slash", () =>
    client.addSlashCommand({
      name: "mdv",
      description: "Open a Markdown file in MDViewer",
      argumentHint: "path/to/file.md[:line]",
      context: "workspace",
      async onSubmit({ args, workspace, rpc }) {
        if (!args.trim()) throw new Error("Usage: /mdv path/to/file.md[:line]");
        const { files } = await rpc(resolveRpc, { candidates: [args.trim()], cwd: workspace.directory });
        const file = files[0];
        if (!file) throw new Error(`No Markdown file at ${args.trim()}`);
        openMarkdown(workspace.id, file.path, file.line);
      },
    }),
  );
  register("settings", () =>
    client.addSettingsScreen({ id: "preferences", title: "Settings", icon: "Settings", Component: SettingsScreen }),
  );
  register("command", () =>
    client.addCommandCenterItem({
      id: "open-viewer",
      title: "Open MDViewer",
      icon: FILLED_BOOK,
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(VIEWER_PANEL_ID);
      },
    }),
  );

  return () => {
    cleanups.forEach((cleanup) => void cleanup());
    setClient(null);
  };
}
