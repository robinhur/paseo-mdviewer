import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { revealRpc } from "../shared/rpc";
import { messages } from "./messages";
import { isHovered } from "./pressable";
import { onContextMenu } from "./web";

function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+(?=\/|$)/, "~").replace(/^\/home\/[^/]+(?=\/|$)/, "~");
}

interface MenuItem {
  key: string;
  icon: string;
  label: string;
  run(): Promise<void> | void;
}

/** The document's full path, with a copy and reveal menu on click or right-click. */
export function PathBar({ path, theme, compact }: { path: string; theme: PluginTheme; compact: boolean }) {
  const c = theme.colors;
  const { t } = useTranslation(messages);
  const toast = useToast();
  const reveal = useRpc(revealRpc);
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState<View | null>(null);

  useEffect(() => onContextMenu(node, () => setOpen(true)), [node]);

  const copy = (value: string, done: string) =>
    copyText(value).then(
      () => toast.show(done),
      () => toast.error(t("toast.copyFailed")),
    );
  const host = async (action: "reveal" | "open" | "folder") => {
    const result = await reveal({ path, action });
    if (!result.ok) toast.error(t("toast.openFailed"));
  };
  const name = path.split("/").pop() ?? path;
  const folder = path.slice(0, path.length - name.length - 1) || "/";

  const items: (MenuItem | "separator")[] = [
    { key: "copy-path", icon: "Copy", label: t("menu.copyPath"), run: () => copy(path, t("toast.pathCopied")) },
    { key: "copy-name", icon: "FileText", label: t("menu.copyName"), run: () => copy(name, t("toast.nameCopied")) },
    { key: "copy-folder", icon: "Folder", label: t("menu.copyFolder"), run: () => copy(folder, t("toast.folderCopied")) },
    "separator",
    { key: "reveal", icon: "FolderSearch", label: t("menu.reveal"), run: () => host("reveal") },
    { key: "open", icon: "ExternalLink", label: t("menu.openDefault"), run: () => host("open") },
    { key: "folder", icon: "FolderOpen", label: t("menu.openFolder"), run: () => host("folder") },
  ];

  return (
    <View style={{ flexShrink: 1, minWidth: 0, zIndex: 20 }}>
      <Pressable
        ref={setNode}
        accessibilityRole="button"
        accessibilityLabel={t("menu.label", { path })}
        onPress={() => setOpen((value) => !value)}
        style={(state) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 6,
          paddingVertical: 4,
          borderRadius: 6,
          backgroundColor: open || isHovered(state) ? c.surface1 : "transparent",
          minWidth: 0,
        })}
      >
        <Text
          style={{ color: c.foreground, fontSize: 12.5, fontWeight: "600", flexShrink: 1 }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {compact ? name : displayPath(path)}
        </Text>
        <Icon name="ChevronDown" size={13} color={c.foregroundMuted} />
      </Pressable>
      {open ? (
        <>
          <Pressable
            accessibilityLabel={t("menu.close")}
            onPress={() => setOpen(false)}
            style={{ position: "fixed" as "absolute", top: -2000, left: -2000, right: -2000, bottom: -2000, zIndex: 1 }}
          />
          <View
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
              minWidth: 230,
              zIndex: 2,
              paddingVertical: 4,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface2,
              shadowColor: "#000",
              shadowOpacity: 0.25,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
            }}
          >
            {items.map((item, index) =>
              item === "separator" ? (
                <View key={`sep-${index}`} style={{ height: 1, marginVertical: 4, backgroundColor: c.border }} />
              ) : (
                <Pressable
                  key={item.key}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    setOpen(false);
                    void item.run();
                  }}
                  style={(state) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    marginHorizontal: 4,
                    borderRadius: 6,
                    backgroundColor: isHovered(state) ? c.surface1 : "transparent",
                  })}
                >
                  <Icon name={item.icon} size={14} color={c.foregroundMuted} />
                  <Text style={{ color: c.foreground, fontSize: 13 }}>{item.label}</Text>
                </Pressable>
              ),
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}
