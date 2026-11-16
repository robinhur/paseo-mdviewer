import { useSettings } from "@getpaseo/plugin/client";
import { DEFAULT_PREFERENCES, preferences, type Preferences } from "../shared/settings";
import type { ViewState } from "./state";

/** Saved preferences, or the defaults while they load. */
export function usePreferences(): Preferences {
  const settings = useSettings(preferences);
  return settings.status === "ready" ? settings.values : DEFAULT_PREFERENCES;
}

/** How a newly opened document starts, from the preferences. */
export function defaultView(prefs: Preferences): ViewState {
  return { mode: prefs.defaultMode, outline: false, scale: prefs.fontScale, wide: prefs.width === "full" };
}
