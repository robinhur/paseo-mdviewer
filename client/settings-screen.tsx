import { useSettings, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Loading, SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { preferences, type Preferences } from "../shared/settings";
import { messages } from "./messages";

const SCALES = ["0.8", "0.9", "1", "1.1", "1.2", "1.3", "1.5"];

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
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
      <SettingsSection title={t("settings.conversation")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.turnButtons")}
            hint={t("settings.turnButtonsHint")}
            value={values.turnButtons}
            onValueChange={(value) => set("turnButtons", value)}
          />
          <SettingsSwitch
            label={t("settings.agentTool")}
            hint={t("settings.agentToolHint")}
            value={values.agentTool}
            onValueChange={(value) => set("agentTool", value)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("settings.viewer")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.defaultMode")}
            value={values.defaultMode}
            options={[
              { label: t("mode.view"), value: "preview" },
              { label: t("mode.split"), value: "split" },
              { label: t("mode.source"), value: "source" },
            ]}
            onValueChange={(value) => set("defaultMode", value as Preferences["defaultMode"])}
          />
          <SettingsSelect
            label={t("settings.width")}
            value={values.width}
            options={[
              { label: t("settings.narrow"), value: "narrow" },
              { label: t("settings.normal"), value: "normal" },
              { label: t("settings.full"), value: "full" },
            ]}
            onValueChange={(value) => set("width", value as Preferences["width"])}
          />
          <SettingsSelect
            label={t("settings.fontScale")}
            hint={t("settings.fontScaleHint")}
            value={String(values.fontScale)}
            options={SCALES.map((scale) => ({ label: `${Math.round(Number(scale) * 100)}%`, value: scale }))}
            onValueChange={(value) => set("fontScale", Number(value))}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("settings.editing")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.autosave")}
            hint={t("settings.autosaveHint")}
            value={values.autosave}
            onValueChange={(value) => set("autosave", value)}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
