import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Loading, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { preferences, type Preferences } from "../shared/settings";

const SCALES = ["0.8", "0.9", "1", "1.1", "1.2", "1.3", "1.5"];

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  if (settings.status === "loading") return <Loading />;
  if (settings.status !== "ready") {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
      </View>
    );
  }
  const values = settings.values;
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    void settings.save({ ...values, [key]: value }, settings.revision);

  return (
    <View style={{ gap: 8 }}>
      <SettingsSection title="Conversation">
        <SettingsCard>
          <SettingsSwitch
            label="Open buttons after each reply"
            hint="Lists the Markdown files a reply mentions below it."
            value={values.turnButtons}
            onValueChange={(v) => set("turnButtons", v)}
          />
          <SettingsSwitch
            label="Agent card tool"
            hint="Lets Claude and Codex post a document card with show_markdown. Applies to sessions opened after the change."
            value={values.agentTool}
            onValueChange={(v) => set("agentTool", v)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Viewer">
        <SettingsCard>
          <SettingsSelect
            label="Open documents in"
            value={values.defaultMode}
            options={[
              { label: "View", value: "preview" },
              { label: "Split", value: "split" },
              { label: "Source", value: "source" },
            ]}
            onValueChange={(v) => set("defaultMode", v as Preferences["defaultMode"])}
          />
          <SettingsSelect
            label="Reading width"
            value={values.width}
            options={[
              { label: "Narrow", value: "narrow" },
              { label: "Normal", value: "normal" },
              { label: "Full width", value: "full" },
            ]}
            onValueChange={(v) => set("width", v as Preferences["width"])}
          />
          <SettingsSelect
            label="Text size"
            hint="Starting size for newly opened documents. Pinch or A-/A+ changes it per tab."
            value={String(values.fontScale)}
            options={SCALES.map((s) => ({ label: `${Math.round(Number(s) * 100)}%`, value: s }))}
            onValueChange={(v) => set("fontScale", Number(v))}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Editing">
        <SettingsCard>
          <SettingsSwitch
            label="Save automatically"
            hint="Off: edits stay unsaved until you press Save."
            value={values.autosave}
            onValueChange={(v) => set("autosave", v)}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
