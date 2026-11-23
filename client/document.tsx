import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useTranslation } from "@getpaseo/plugin/client";
import { copyText, Icon, Loading, Markdown, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { isMarkdownPath } from "../shared/paths";
import { renderRpc, revealRpc, runtimeRpc } from "../shared/rpc";
import { lineAt, toggleTaskLine } from "../shared/text-edit";
import { messages, useFrameStrings } from "./messages";
import { createSaveSession, type SaveResult } from "./save-session";
import { PathBar } from "./path-bar";
import { usePreferences } from "./preferences";
import { isHovered } from "./pressable";
import { buildShell, type FrameMessage, type ShellTheme } from "./shell";
import type { ViewState } from "./state";
import { mountFrame, openExternal, supportsFrame, type MountedFrame } from "./web";

export interface DocumentViewProps {
  path: string;
  /** Latest text on disk; undefined while loading. */
  text: string | undefined;
  version: string | undefined;
  error?: string;
  save(text: string, force: boolean, expectedVersion: string): Promise<SaveResult>;
  reload(): void;
  view: ViewState;
  setView(next: ViewState): void;
  /** 1-based line to reveal; `lineKey` changes when the same line is requested again. */
  line?: number | null;
  lineKey?: number;
  theme: PluginTheme;
  compact: boolean;
  setModified(modified: boolean): void;
  /** Opens another Markdown file the document links to. */
  onOpen(path: string, line?: number): void;
}

function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => parseInt(v, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function shellTheme(theme: PluginTheme): ShellTheme {
  const c = theme.colors;
  return {
    dark: isDark(c.surface0),
    background: c.surface0,
    foreground: c.foreground,
    muted: c.foregroundMuted,
    border: c.border,
    accent: c.accent,
    surface: c.surface1,
    raised: c.surface2,
    success: c.statusSuccess,
    warning: c.statusWarning,
    danger: c.statusDanger,
  };
}

// The preview document embeds Mermaid, so it is built once and shared by every tab.
let shellCache: Promise<string> | null = null;

function useShell() {
  const runtime = useRpc(runtimeRpc);
  return useQuery({
    queryKey: ["mdviewer-shell"],
    queryFn: () => {
      shellCache ??= runtime({}).then((r) => buildShell(r));
      shellCache.catch(() => {
        shellCache = null;
      });
      return shellCache;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: supportsFrame,
  });
}

function useDebounced<T>(value: T, delay: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return current;
}

/** One Markdown document: toolbar, optional source editor and the preview frame. */
export function DocumentView(props: DocumentViewProps) {
  const { path, text, view, setView, theme, compact } = props;
  const { t } = useTranslation(messages);
  const frameStrings = useFrameStrings();
  const toast = useToast();
  const prefs = usePreferences();
  const render = useRpc(renderRpc);
  const reveal = useRpc(revealRpc);
  const shell = useShell();
  const colors = useMemo(() => shellTheme(theme), [theme]);
  const c = theme.colors;

  const session = useMemo(() => createSaveSession(), [path]);
  const { draft, text: diskText, status: saveState, error: saveError } = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const editing = view.mode !== "preview";
  useEffect(() => {
    if (text !== undefined && props.version !== undefined) session.receive(text, props.version);
  }, [session, text, props.version]);
  useEffect(() => {
    props.setModified(draft !== null);
  }, [draft, props.setModified]);
  useEffect(() => () => props.setModified(false), [session, props.setModified]);

  const source = draft ?? diskText;
  const renderSource = useDebounced(source, draft === null ? 0 : 140);
  const rendered = useQuery({
    queryKey: ["mdviewer-render", path, renderSource],
    queryFn: () => render({ text: renderSource ?? "", path }),
    enabled: renderSource !== undefined && supportsFrame,
    placeholderData: (previous) => previous,
    staleTime: Infinity,
    gcTime: 30_000,
  });

  const doSave = useCallback(
    (force = false) => session.save(props.save, force),
    [session, props.save],
  );

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (!prefs.autosave || draft === null || saveState !== "dirty") return;
    const timer = setTimeout(() => void doSave(), 700);
    return () => clearTimeout(timer);
  }, [draft, saveState, doSave, prefs.autosave]);

  const edit = session.edit;

  // A link to a local file: Markdown opens in MDViewer, anything else is shown in the file manager.
  const openLocal = useCallback(
    (target: string, line?: number) => {
      if (isMarkdownPath(target)) {
        props.onOpen(target, line);
        return;
      }
      reveal({ path: target, action: "reveal" }).then(
        (result) => {
          if (!result.ok) toast.error(t("toast.openFailed"));
        },
        () => toast.error(t("toast.openFailed")),
      );
    },
    [props.onOpen, reveal, toast, t],
  );

  // Preview frame. Its handlers read the latest values through a ref so the frame is not remounted.
  const [host, setHost] = useState<View | null>(null);
  const frameRef = useRef<MountedFrame | null>(null);
  const [ready, setReady] = useState(false);
  const showPreview = view.mode !== "source";
  const latest = useRef({ edit, openLocal, source, view, setView, toast, t });
  latest.current = { edit, openLocal, source, view, setView, toast, t };

  useEffect(() => {
    if (!shell.data || !showPreview || !host) return;
    const frame = mountFrame(host, shell.data, (data) => {
      const message = data as FrameMessage;
      const now = latest.current;
      switch (message.type) {
        case "ready":
          setReady(true);
          break;
        case "open":
          if (typeof message.path === "string") now.openLocal(message.path, message.line);
          break;
        case "external":
          if (typeof message.href === "string" && /^(https?|mailto):/i.test(message.href)) void openExternal(message.href);
          break;
        case "copy":
          copyText(String(message.text)).then(
            () => now.toast.show(now.t("toast.copied")),
            () => now.toast.error(now.t("toast.copyFailed")),
          );
          break;
        case "toggleTask": {
          if (now.source === undefined) break;
          const next = toggleTaskLine(now.source, Number(message.line));
          if (next !== null) now.edit(next);
          break;
        }
        case "scale":
          if (Number.isFinite(message.scale)) {
            now.setView({ ...now.view, scale: Math.min(1.8, Math.max(0.7, message.scale)) });
          }
          break;
      }
    });
    frameRef.current = frame;
    return () => {
      frame?.destroy();
      frameRef.current = null;
      setReady(false);
    };
  }, [shell.data, showPreview, host]);

  useEffect(() => {
    if (ready) frameRef.current?.post({ type: "strings", strings: frameStrings });
  }, [ready, JSON.stringify(frameStrings)]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.post({
      type: "settings",
      scale: view.scale,
      outline: view.outline && !compact,
      wide: view.wide,
      narrow: prefs.width === "narrow" && !view.wide,
    });
  }, [ready, view.scale, view.outline, view.wide, compact, prefs.width]);

  useEffect(() => {
    if (ready && rendered.data) frameRef.current?.post({ type: "render", html: rendered.data.html, theme: colors });
  }, [ready, rendered.data, colors]);

  useEffect(() => {
    if (ready && props.line != null) {
      frameRef.current?.post({ type: "scrollToLine", line: Math.max(0, props.line - 1), smooth: false });
    }
  }, [ready, props.line, props.lineKey]);

  const onSelection = useCallback(
    (offset: number) => {
      if (view.mode !== "split" || source === undefined) return;
      frameRef.current?.post({ type: "scrollToLine", line: lineAt(source, offset), smooth: true });
    },
    [view.mode, source],
  );

  const styles = useMemo(
    () => ({
      root: { flex: 1, backgroundColor: c.surface0 },
      bar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
        backgroundColor: c.surface0,
        zIndex: 10,
        position: "relative" as const,
      },
      status: { color: c.foregroundMuted, fontSize: 12, marginLeft: 6 },
      segment: {
        flexDirection: "row" as const,
        backgroundColor: c.surface1,
        borderRadius: 8,
        padding: 2,
        marginLeft: "auto" as const,
      },
      editor: {
        flex: 1,
        color: c.foreground,
        backgroundColor: c.surface0,
        fontFamily: "Menlo, SF Mono, monospace",
        fontSize: 13 * view.scale,
        lineHeight: 20 * view.scale,
        padding: compact ? 12 : 18,
        textAlignVertical: "top" as const,
      },
      divider: { height: 1, backgroundColor: c.border },
      banner: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: c.surface1,
        borderBottomWidth: 1,
        borderBottomColor: c.border,
      },
      bannerText: { color: c.statusWarning, fontSize: 12, flex: 1 },
      bannerAction: { color: c.accent, fontSize: 12 },
    }),
    [c, compact, view.scale],
  );

  const button = (key: string, icon: string, label: string, onPress: () => void, active = false) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={(state) => ({
        paddingHorizontal: 7,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: active ? c.surface2 : isHovered(state) ? c.surface1 : "transparent",
      })}
    >
      <Icon name={icon} size={15} color={active ? c.accent : c.foregroundMuted} />
    </Pressable>
  );

  const modeButton = (mode: ViewState["mode"], icon: string, label: string) => (
    <Pressable
      key={mode}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: view.mode === mode }}
      onPress={() => setView({ ...view, mode })}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: compact ? 8 : 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: view.mode === mode ? c.surface0 : "transparent",
      }}
    >
      <Icon name={icon} size={14} color={view.mode === mode ? c.foreground : c.foregroundMuted} />
      {compact ? null : (
        <Text style={{ fontSize: 12, color: view.mode === mode ? c.foreground : c.foregroundMuted }}>{label}</Text>
      )}
    </Pressable>
  );

  const statusText =
    saveState === "saving"
      ? t("status.saving")
      : saveState === "dirty"
        ? t("status.edited")
        : saveState === "saved"
          ? t("status.saved")
          : "";
  const canSaveByHand = draft !== null && (saveState === "dirty" || saveState === "error");
  const smaller = () => setView({ ...view, scale: Math.max(0.7, +(view.scale - 0.1).toFixed(2)) });
  const larger = () => setView({ ...view, scale: Math.min(1.8, +(view.scale + 0.1).toFixed(2)) });

  const toolbar = (
    <View style={styles.bar}>
      <PathBar path={path} theme={theme} compact={compact} />
      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
      {canSaveByHand ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("toolbar.save")}
          onPress={() => void doSave()}
          style={{ marginLeft: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: c.accent }}
        >
          <Text style={{ color: c.accentForeground, fontSize: 12, fontWeight: "600" }}>{t("toolbar.save")}</Text>
        </Pressable>
      ) : null}
      <View style={styles.segment}>
        {modeButton("preview", "Eye", t("mode.view"))}
        {modeButton("split", "Columns2", t("mode.split"))}
        {modeButton("source", "Code", t("mode.source"))}
      </View>
      {showPreview && supportsFrame ? (
        <>
          {compact
            ? null
            : button("outline", "ListTree", t("toolbar.outline"), () => setView({ ...view, outline: !view.outline }), view.outline)}
          {button("find", "Search", t("toolbar.find"), () => frameRef.current?.post({ type: "find" }))}
          {compact
            ? null
            : button("wide", "MoveHorizontal", t("toolbar.fullWidth"), () => setView({ ...view, wide: !view.wide }), view.wide)}
        </>
      ) : null}
      {button("smaller", "AArrowDown", t("toolbar.smaller"), smaller)}
      {button("larger", "AArrowUp", t("toolbar.larger"), larger)}
    </View>
  );

  let banner: ReactNode = null;
  if (saveState === "conflict") {
    const discard = () => {
      session.discard();
      props.reload();
    };
    banner = (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>{t("banner.conflict")}</Text>
        <Pressable accessibilityRole="button" onPress={discard}>
          <Text style={styles.bannerAction}>{t("banner.discard")}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void doSave(true)}>
          <Text style={[styles.bannerAction, { color: c.statusDanger }]}>{t("banner.overwrite")}</Text>
        </Pressable>
      </View>
    );
  } else if (saveState === "error") {
    banner = (
      <View style={styles.banner}>
        <Text style={[styles.bannerText, { color: c.statusDanger }]}>
          {t("banner.saveFailed", { message: saveError ?? "" })}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void doSave()}>
          <Text style={styles.bannerAction}>{t("banner.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  // Losing the disk file must not hide the user's recoverable in-memory draft.
  if (props.error && draft === null) {
    return (
      <View style={styles.root}>
        {toolbar}
        <View style={{ padding: 24 }}>
          <Text style={{ color: c.statusDanger }}>{props.error}</Text>
        </View>
      </View>
    );
  }

  if (source === undefined) return <Loading />;

  const editor = editing ? (
    <TextInput
      key="editor"
      multiline
      value={source}
      onChangeText={edit}
      onSelectionChange={(event) => onSelection(event.nativeEvent.selection.start)}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      scrollEnabled
      style={styles.editor}
      placeholder={t("editor.placeholder")}
      placeholderTextColor={c.foregroundMuted}
    />
  ) : null;

  let preview: ReactNode = null;
  if (showPreview) {
    // Clients without a web view show the document with Paseo's own Markdown renderer.
    preview = supportsFrame ? (
      <View key="preview" style={{ flex: 1 }}>
        <View ref={setHost} style={{ flex: 1 }} />
        {!ready || !rendered.data ? (
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            <Loading />
          </View>
        ) : null}
      </View>
    ) : (
      <ScrollView key="preview" style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Markdown>{source}</Markdown>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      {toolbar}
      {props.error ? (
        <View style={styles.banner}>
          <Text style={[styles.bannerText, { color: c.statusDanger }]}>{props.error}</Text>
        </View>
      ) : null}
      {banner}
      {editor}
      {editor && preview ? <View key="divider" style={styles.divider} /> : null}
      {preview}
    </View>
  );
}
