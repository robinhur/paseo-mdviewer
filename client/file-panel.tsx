import { PluginFileConflictError, useFileText, useRpc, useTabState, type PluginFilePanelProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect } from "react";
import { logRpc } from "../shared/rpc";
import { PanelBoundary } from "./boundary";
import { DocumentView, type SaveResult } from "./document";
import { defaultView, usePreferences } from "./preferences";
import { openMarkdown, viewStateSchema } from "./state";

/** Renders a Markdown file inside Paseo's own file tab. */
export function MarkdownFilePanel(props: PluginFilePanelProps) {
  const log = useRpc(logRpc);
  const report = (message: string) => void log({ message }).catch(() => undefined);
  useEffect(() => {
    report(`file panel mounted ${props.file.path}`);
  }, [props.file.path]);
  return (
    <PanelBoundary name="file panel" report={report} color={props.theme.colors.statusDanger}>
      <FilePanelBody {...props} />
    </PanelBoundary>
  );
}

function FilePanelBody({ file, tab, theme, layout, params, revision, workspaceId }: PluginFilePanelProps) {
  const text = useFileText(file);
  const prefs = usePreferences();
  const [view, setView] = useTabState(tab, viewStateSchema, defaultView(prefs));

  const save = useCallback(
    async (value: string, force = false): Promise<SaveResult> => {
      try {
        await file.writeText(value, force ? { force: true } : undefined);
        return { status: "ok" };
      } catch (error) {
        if (error instanceof PluginFileConflictError) return { status: "conflict" };
        return { status: "error", message: (error as Error).message };
      }
    },
    [file],
  );

  const onOpen = useCallback(
    (path: string, line?: number) => {
      if (path === file.path) return;
      openMarkdown(workspaceId, path, line);
    },
    [file.path, workspaceId],
  );

  return (
    <DocumentView
      path={file.path}
      text={text.status === "ready" ? text.text : undefined}
      error={text.status === "error" ? text.error.message : undefined}
      save={save}
      reload={() => undefined}
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
