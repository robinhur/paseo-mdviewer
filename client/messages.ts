import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import type { ShellStrings } from "./shell";

export const messages = defineTranslations({ resources: { en, ko } });

/** Translated text for the preview frame. */
export function useFrameStrings(): ShellStrings {
  const { t } = useTranslation(messages);
  return {
    copy: t("frame.copy"),
    copied: t("frame.copied"),
    contents: t("frame.contents"),
    onThisPage: t("frame.onThisPage"),
    noHeadings: t("frame.noHeadings"),
    findPlaceholder: t("frame.findPlaceholder"),
    previous: t("frame.previous"),
    next: t("frame.next"),
    close: t("frame.close"),
    zoomIn: t("frame.zoomIn"),
    zoomOut: t("frame.zoomOut"),
    reset: t("frame.reset"),
    enlarge: t("frame.enlarge"),
    zoomHint: t("frame.zoomHint"),
    diagramError: t("frame.diagramError"),
    sanitizerMissing: t("frame.sanitizerMissing"),
  };
}
