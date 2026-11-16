import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferencesSchema = z.object({
  /** Append Open buttons for the Markdown files a finished turn mentions. */
  turnButtons: z.boolean().default(true),
  /** Give agents the `show_markdown` card tool. */
  agentTool: z.boolean().default(false),
  /** Mode a newly opened document starts in. */
  defaultMode: z.enum(["preview", "split", "source"]).default("preview"),
  /** Reading width of the preview. */
  width: z.enum(["narrow", "normal", "full"]).default("normal"),
  /** Text size a newly opened document starts at. */
  fontScale: z.number().min(0.7).max(1.8).default(1),
  /** Save edits automatically shortly after typing stops. */
  autosave: z.boolean().default(true),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: preferencesSchema,
});
