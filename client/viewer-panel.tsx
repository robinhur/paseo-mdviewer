import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTabState, type PluginTab, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import type { z } from "zod";
import { readRpc, statRpc, writeRpc } from "../shared/rpc";
import { DocumentView, type SaveResult } from "./document";
import { defaultView, usePreferences } from "./preferences";
import {

  DEFAULT_VIEWER_TAB,
  onPending,
  openMarkdown,
  panelIdFor,
  takePendingLine,
  viewerTabSchema,
  viewStateSchema,
} from "./state";

interface PathDocumentProps {
  path: string;
  workspaceId: string;
  tab: PluginTab;
  theme: PluginTheme;
  compact: boolean;
  view: z.infer<typeof viewStateSchema>;
  setView(next: z.infer<typeof viewStateSchema>): void;
  line: number | null;
  lineKey: number;
}


/** A Markdown file read and written through the daemon, following changes on disk. */
function PathDocument({ path, workspaceId, tab, theme, compact, view, setView, line, lineKey }: PathDocumentProps) {
  const read = useRpc(readRpc);
  const stat = useRpc(statRpc);
  const write = useRpc(writeRpc);
  const queryClient = useQueryClient();

  const doc = useQuery({ queryKey: ["mdviewer-read", path], queryFn: () => read({ path }) });
  const mtime = doc.data?.status === "ok" ? doc.data.mtime : 0;

  const watch = useQuery({
    queryKey: ["mdviewer-stat", path],
    queryFn: () => stat({ path }),
    refetchInterval: 1500,
  });
  useEffect(() => {
    if (watch.data && doc.data && watch.data.mtime !== mtime) void doc.refetch();
  }, [watch.data?.mtime]);

  const save = useCallback(
    async (text: string, force = false): Promise<SaveResult> => {
      const result = await write({ path, text, expectedMtime: force ? undefined : mtime || undefined });
      if (result.status === "ok") {
        queryClient.setQueryData(["mdviewer-read", path], { status: "ok", path, text, mtime: result.mtime });
        return { status: "ok" };
      }
      return result.status === "conflict" ? { status: "conflict" } : { status: "error", message: result.message };
    },
    [path, mtime, write, queryClient],
  );

  const data = doc.data;
  return (
    <DocumentView
      path={path}
      text={data?.status === "ok" ? data.text : undefined}
      error={
        data?.status === "missing" ? `File not found: ${path}` : data?.status === "error" ? data.message : doc.error ? String(doc.error) : undefined
      }
      save={save}
      reload={() => void doc.refetch()}
      view={view}
      setView={setView}
      line={line}
      lineKey={lineKey}
      theme={theme}
      compact={compact}
      setModified={tab.setModified}
      onOpen={(target, targetLine) => openMarkdown(workspaceId, target, targetLine)}
    />
  );
}

/** Builds the tab component for one file; each file is its own workspace panel. */
export function makeDocPanel(path: string): ComponentType<PluginWorkspacePanelProps> {
  const panelId = panelIdFor(path);
  return function DocPanel({ tab, theme, layout, workspaceId, revision }: PluginWorkspacePanelProps) {
    const prefs = usePreferences();
  const [view, setView] = useTabState(tab, viewStateSchema, defaultView(prefs));
    const [line, setLine] = useState<number | null>(null);
    const [lineKey, setLineKey] = useState(0);
    useEffect(() => {
      const consume = () => {
        const next = takePendingLine(panelId);
        if (next != null) {
          setLine(next);
          setLineKey((k) => k + 1);
        }
      };
      consume();
      return onPending((id) => {
        if (id === panelId) consume();
      });
    }, [revision]);
    return (
      <PathDocument
        path={path}
        workspaceId={workspaceId}
        tab={tab}
        theme={theme}
        compact={layout.compact}
        view={view}
        setView={setView}
        line={line}
        lineKey={lineKey}
      />
    );
  };
}

/** The earlier single viewer tab; still opens whatever file it last showed. */
export function MarkdownViewerPanel({ tab, theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const [state, setState] = useTabState(tab, viewerTabSchema, DEFAULT_VIEWER_TAB);
  const c = theme.colors;
  if (!state.path) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24, backgroundColor: c.surface0 }}>
        <Icon name="BookOpen" size={28} color={c.foregroundMuted} />
        <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "600" }}>MDViewer</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 13, textAlign: "center" }}>
          Open a Markdown file from the chat buttons, or type /mdv path/to/file.md
        </Text>
      </View>
    );
  }
  return (
    <PathDocument
      path={state.path}
      workspaceId={workspaceId}
      tab={tab}
      theme={theme}
      compact={layout.compact}
      view={state.view}
      setView={(view) => setState({ ...state, view })}
      line={state.line}
      lineKey={0}
    />
  );
}
