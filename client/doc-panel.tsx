import { useRpc, useTabState, useTranslation, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useEffect, useState, type ComponentType } from "react";
import { reportRpc } from "../shared/rpc";
import { PanelBoundary } from "./boundary";
import { DocumentView } from "./document";
import { messages } from "./messages";
import { defaultView, usePreferences } from "./preferences";
import { onPendingLine, openMarkdown, panelIdFor, takePendingLine, viewStateSchema } from "./state";
import { useMarkdownFile } from "./use-markdown-file";

/**
 * Builds the tab component for one file. The file is read and written through the daemon and
 * re-read when it changes on disk.
 */
export function makeDocPanel(path: string): ComponentType<PluginAgentPanelProps> {
  const panelId = panelIdFor(path);

  function DocPanel({ tab, theme, layout, workspaceId, params, revision }: PluginAgentPanelProps) {
    const { t } = useTranslation(messages);
    const prefs = usePreferences();
    const [view, setView] = useTabState(tab, viewStateSchema, defaultView(prefs));
    const [line, setLine] = useState<number | null>(null);
    const [lineKey, setLineKey] = useState(0);

    useEffect(() => {
      const consume = () => {
        const next = takePendingLine(panelId);
        if (next != null) {
          setLine(next);
          setLineKey((key) => key + 1);
        }
      };
      consume();
      return onPendingLine((id) => {
        if (id === panelId) consume();
      });
    }, [revision]);

    const document = useMarkdownFile(path);

    return (
      <DocumentView
        path={path}
        {...document}
        view={view}
        setView={setView}
        line={line}
        lineKey={lineKey}
        theme={theme}
        compact={layout.compact}
        setModified={tab.setModified}
        onOpen={(target, targetLine) =>
          openMarkdown({ workspaceId, agentId: params.agentId, path: target, line: targetLine })
        }
      />
    );
  }

  return function GuardedDocPanel(props: PluginAgentPanelProps) {
    const report = useRpc(reportRpc);
    const { t } = useTranslation(messages);
    return (
      <PanelBoundary
        name={`document tab ${path}`}
        report={(message) => void report({ message }).catch(() => undefined)}
        describe={(message) => t("file.failed", { message })}
        color={props.theme.colors.statusDanger}
      >
        <DocPanel {...props} />
      </PanelBoundary>
    );
  };
}
