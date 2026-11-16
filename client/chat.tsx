import { useAgent, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import type { CardData, FilesData } from "../shared/rpc";
import { FILLED_BOOK } from "./icons";
import { isHovered } from "./pressable";
import { openMarkdown } from "./state";

type Theme = PluginTimelineItemProps["theme"];

function FileChip({ name, detail, onPress, theme }: { name: string; detail: string; onPress(): void; theme: Theme }) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${name} in MDViewer`}
      onPress={onPress}
      style={(state) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isHovered(state) ? c.accent : c.border,
        backgroundColor: c.surface1,
        maxWidth: "100%",
      })}
    >
      <Icon icon={FILLED_BOOK} size={14} color={c.accent} />
      <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>
        {name}
      </Text>
      {detail ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Open buttons for the Markdown files a finished turn mentioned. */
export function FilesRow({ agentId, item, theme }: PluginTimelineItemProps<FilesData>) {
  const workspaceId = useAgent(agentId, (a) => a.workspaceId);
  const target = item.data.workspaceId ?? workspaceId;
  if (!target || !item.data.files.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {item.data.files.map((file) => {
        const parts = file.path.split("/");
        return (
          <FileChip
            key={file.path + (file.line ?? "")}
            theme={theme}
            name={parts[parts.length - 1]}
            detail={(file.line ? `:${file.line} · ` : "") + parts.slice(-3, -1).join("/")}
            onPress={() => openMarkdown(target, file.path, file.line)}
          />
        );
      })}
    </View>
  );
}

/** The card an agent posts with the `show_markdown` tool. */
export function MarkdownCard({ agentId, item, theme }: PluginTimelineItemProps<CardData>) {
  const workspaceId = useAgent(agentId, (a) => a.workspaceId);
  const c = theme.colors;
  const data = item.data;
  const target = data.workspaceId ?? workspaceId;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${data.name} in MDViewer`}
      onPress={() => target && openMarkdown(target, data.path, data.line)}
      style={(state) => ({
        borderWidth: 1,
        borderColor: isHovered(state) ? c.accent : c.border,
        borderRadius: 12,
        backgroundColor: c.surface1,
        padding: 14,
        gap: 8,
        maxWidth: 560,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: c.surface2 }}>
          <Icon name="BookOpen" size={17} color={c.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }} numberOfLines={1}>
            {data.title}
          </Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
            {data.name}
            {data.line ? ` · line ${data.line}` : ""}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: c.accent }}>
          <Text style={{ color: c.accentForeground, fontSize: 12, fontWeight: "600" }}>Open</Text>
        </View>
      </View>
      {data.headings.length ? (
        <View style={{ gap: 2, paddingLeft: 42 }}>
          {data.headings.map((heading, index) => (
            <Text key={index} style={{ color: c.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
              · {heading}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}
