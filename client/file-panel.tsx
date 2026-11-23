import {
  useRpc,
  useTabState,
  useTranslation,
  type PluginFilePanelProps,
} from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { reportRpc } from "../shared/rpc";
import { PanelBoundary } from "./boundary";
import { DocumentView } from "./document";
import { messages } from "./messages";
import { defaultView, usePreferences } from "./preferences";
import { openFromWorkspace, viewStateSchema } from "./state";
import { useMarkdownFile } from "./use-markdown-file";

/** Renders a Markdown file inside Paseo's own file tab. */
export function MarkdownFilePanel(props: PluginFilePanelProps) {
  const report = useRpc(reportRpc);
  const { t } = useTranslation(messages);
  return (
    <PanelBoundary
      name={`file tab ${props.file.path}`}
      report={(message) => void report({ message }).catch(() => undefined)}
      describe={(message) => t("file.failed", { message })}
      color={props.theme.colors.statusDanger}
    >
      <FilePanelBody {...props} />
    </PanelBoundary>
  );
}

function FilePanelBody({ file, tab, theme, layout, params, revision, workspaceId }: PluginFilePanelProps) {
  const { t } = useTranslation(messages);
  const toast = useToast();
  const document = useMarkdownFile(file.path);
  const prefs = usePreferences();
  const [view, setView] = useTabState(tab, viewStateSchema, defaultView(prefs));

  // A file tab has no conversation of its own, so a linked document opens beside the
  // workspace's latest conversation.
  const onOpen = useCallback(
    (path: string, line?: number) => {
      if (path === file.path) return;
      openFromWorkspace(workspaceId, path, line).then(
        (opened) => {
          if (!opened) toast.error(t("toast.noConversation"));
        },
        () => toast.error(t("toast.openFailed")),
      );
    },
    [file.path, workspaceId, toast, t],
  );

  return (
    <DocumentView
      path={file.path}
      {...document}
      view={view}
      setView={setView}
      line={params.lineStart ?? null}
      lineKey={revision}
      theme={theme}
      compact={layout.compact}
      setModified={tab.setModified}
      onOpen={onOpen}
    />
  );
}
