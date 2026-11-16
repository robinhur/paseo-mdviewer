import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Loading, Markdown, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { renderRpc, runtimeRpc } from "../shared/rpc";
import { buildShell, type FrameMessage, type ShellTheme } from "./shell";
import { PathBar } from "./path-bar";
import { usePreferences } from "./preferences";
import { isHovered } from "./pressable";
import type { ViewState } from "./state";
import { mountFrame, openExternal, supportsFrame, type MountedFrame } from "./web";

export type SaveResult = { status: "ok" } | { status: "conflict" } | { status: "error"; message: string };

export interface DocumentViewProps {
  path: string;
  /** Latest text on disk; undefined while loading. */
  text: string | undefined;
  error?: string;
  save(text: string, force?: boolean): Promise<SaveResult>;
  reload(): void;
  view: ViewState;
  setView(next: ViewState): void;
  /** Line to reveal; `lineKey` changes when the same line is requested again. */
  line?: number | null;
  lineKey?: number;
  theme: PluginTheme;
  compact: boolean;
  setModified(modified: boolean): void;
  onOpen(path: string, line?: number): void;
  navigation?: ReactNode;
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

let shellCache: Promise<string> | null = null;

function useShell() {
  const runtime = useRpc(runtimeRpc);
  return useQuery({
    queryKey: ["mdviewer-shell"],
    queryFn: () => {
      shellCache ??= runtime({}).then((r) => buildShell(r.script, r.css));
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

function toggleTaskLine(text: string, line: number): string | null {
  const lines = text.split("\n");
  for (let i = line; i < Math.min(lines.length, line + 3); i++) {
    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/.exec(lines[i]);
    if (match) {
      lines[i] = match[1] + (match[2] === " " ? "x" : " ") + match[3];
      return lines.join("\n");
    }
  }
  return null;
}

function lineAt(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export function DocumentView(props: DocumentViewProps) {
  const { path, text, view, setView, theme, compact } = props;
  const toast = useToast();
  const prefs = usePreferences();
  const render = useRpc(renderRpc);
  const shell = useShell();
  const colors = useMemo(() => shellTheme(theme), [theme]);
  const c = theme.colors;

  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  draftRef.current = draft;
  const editing = view.mode !== "preview";

  // A file switch discards the in-memory draft of the previous file.
  useEffect(() => {
    setDraft(null);
    setSaveState("idle");
    props.setModified(false);
  }, [path]);

  const source = draft ?? text;
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
    async (value: string, force = false) => {
      setSaveState("saving");
      const result = await props.save(value, force);
      if (result.status === "ok") {
        if (draftRef.current === value) {
          setSaveState("saved");
          props.setModified(false);
        }
      } else if (result.status === "conflict") {
        setSaveState("conflict");
      } else {
        setSaveState("error");
        setSaveError(result.message);
      }
    },
    [props.save, props.setModified],
  );

  // Autosave shortly after typing stops.
  useEffect(() => {
    if (!prefs.autosave || draft === null || saveState !== "dirty") return;
    const timer = setTimeout(() => void doSave(draft), 700);
    return () => clearTimeout(timer);
  }, [draft, saveState, doSave, prefs.autosave]);

  // When the disk catches up with the draft, drop the draft so outside edits flow in again.
  useEffect(() => {
    if (draft !== null && text === draft && saveState === "saved" && !editing) setDraft(null);
  }, [text, draft, saveState, editing]);

  const edit = useCallback(
    (value: string) => {
      setDraft(value);
      setSaveState("dirty");
      props.setModified(true);
    },
    [props.setModified],
  );

  // Preview frame.
  const [host, setHost] = useState<View | null>(null);
  const frameRef = useRef<MountedFrame | null>(null);
  const [ready, setReady] = useState(false);
  const showPreview = view.mode !== "source";
  const handlers = useRef({ edit, onOpen: props.onOpen, source, view, setView });
  handlers.current = { edit, onOpen: props.onOpen, source, view, setView };

  useEffect(() => {
    if (!shell.data || !showPreview) return;
    if (!host) return;
    const frame = mountFrame(host, shell.data, (data) => {
      const message = data as FrameMessage;
      switch (message.type) {
        case "ready":
          setReady(true);
          break;
        case "open":
          handlers.current.onOpen(message.path, message.line);
          break;
        case "external":
          if (/^(https?|mailto):/i.test(message.href)) void openExternal(message.href);
          break;
        case "copy":
          copyText(message.text).then(
            () => toast.show("Copied"),
            () => toast.error("Copy failed"),
          );
          break;
        case "toggleTask": {
          const current = handlers.current.source;
          if (current === undefined) break;
          const next = toggleTaskLine(current, message.line);
          if (next !== null) handlers.current.edit(next);
          break;
        }
        case "scale":
          handlers.current.setView({ ...handlers.current.view, scale: message.scale });
          break;
        case "log":
          console.warn("[mdviewer]", message.message);
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
    if (ready) {
      frameRef.current?.post({
        type: "settings",
        scale: view.scale,
        outline: view.outline && !compact,
        wide: view.wide,
        narrow: prefs.width === "narrow" && !view.wide,
      });
    }
  }, [ready, view.scale, view.outline, view.wide, compact, prefs.width]);

  useEffect(() => {
    if (ready && rendered.data) frameRef.current?.post({ type: "render", html: rendered.data.html, theme: colors });
  }, [ready, rendered.data, colors]);

  useEffect(() => {
    if (ready && props.line != null) frameRef.current?.post({ type: "scrollToLine", line: Math.max(0, props.line - 1), smooth: false });
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
      name: { color: c.foreground, fontSize: 13, fontWeight: "600" as const, flexShrink: 1 },
      status: { color: c.foregroundMuted, fontSize: 12, marginLeft: 6 },
      segment: { flexDirection: "row" as const, backgroundColor: c.surface1, borderRadius: 8, padding: 2, marginLeft: "auto" as const },
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
    saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Edited" : saveState === "saved" ? "Saved" : "";
  const toolbar = (
    <View style={styles.bar}>
      {props.navigation}
      <PathBar path={path} theme={theme} compact={compact} />
      {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
      {!prefs.autosave && draft !== null && (saveState === "dirty" || saveState === "error") ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save"
          onPress={() => void doSave(draft)}
          style={{ marginLeft: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: c.accent }}
        >
          <Text style={{ color: c.accentForeground, fontSize: 12, fontWeight: "600" }}>Save</Text>
        </Pressable>
      ) : null}
      <View style={styles.segment}>
        {modeButton("preview", "Eye", "View")}
        {modeButton("split", "Columns2", "Split")}
        {modeButton("source", "Code", "Source")}
      </View>
      {showPreview && supportsFrame ? (
        <>
          {compact ? null : button("outline", "ListTree", "Outline", () => setView({ ...view, outline: !view.outline }), view.outline)}
          {button("find", "Search", "Find", () => frameRef.current?.post({ type: "find" }))}
          {compact ? null : button("wide", "MoveHorizontal", "Full width", () => setView({ ...view, wide: !view.wide }), view.wide)}
        </>
      ) : null}
      {button("smaller", "AArrowDown", "Smaller text", () => setView({ ...view, scale: Math.max(0.7, +(view.scale - 0.1).toFixed(2)) }))}
      {button("larger", "AArrowUp", "Larger text", () => setView({ ...view, scale: Math.min(1.8, +(view.scale + 0.1).toFixed(2)) }))}
    </View>
  );

  let banner: ReactNode = null;
  if (saveState === "conflict") {
    banner = (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>The file changed on disk while you were editing.</Text>
        <Pressable onPress={() => { setDraft(null); setSaveState("idle"); props.setModified(false); props.reload(); }}>
          <Text style={{ color: c.accent, fontSize: 12 }}>Discard my edits</Text>
        </Pressable>
        <Pressable onPress={() => draft !== null && void doSave(draft, true)}>
          <Text style={{ color: c.statusDanger, fontSize: 12 }}>Overwrite</Text>
        </Pressable>
      </View>
    );
  } else if (saveState === "error") {
    banner = (
      <View style={styles.banner}>
        <Text style={[styles.bannerText, { color: c.statusDanger }]}>Save failed: {saveError}</Text>
        <Pressable onPress={() => draft !== null && void doSave(draft)}>
          <Text style={{ color: c.accent, fontSize: 12 }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (props.error) {
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
      placeholder="Write Markdown…"
      placeholderTextColor={c.foregroundMuted}
    />
  ) : null;

  let preview: ReactNode = null;
  if (showPreview) {
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
      {banner}
      {editor}
      {editor && preview ? <View key="divider" style={styles.divider} /> : null}
      {preview}
    </View>
  );
}
