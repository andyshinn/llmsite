import { SETTING_KEYS, type SettingKey, settingSchemas } from "@radar/core";

export type FieldKind = "number" | "integer" | "text" | "lines" | "weights" | "reasoning";

export interface SettingField {
  key: SettingKey;
  label: string;
  help: string;
  kind: FieldKind;
}

/** How each setting is edited on /admin/settings, in display order. */
export const SETTING_FIELDS: SettingField[] = [
  { key: "review_threshold", label: "Review threshold", help: "Posts at or above this confidence publish automatically. 1 sends everything to review.", kind: "number" },
  { key: "model_id", label: "Classifier model", help: "Workers AI model ID. Score a model with the Eval workflow before switching.", kind: "text" },
  { key: "model_reasoning_effort", label: "Reasoning effort", help: "For reasoning models. Empty sends none.", kind: "reasoning" },
  { key: "categories", label: "Categories", help: 'One per line, lowercase with hyphens. Must include "other".', kind: "lines" },
  { key: "prefilter_keywords", label: "Pre-filter keywords", help: "One per line. A post needs at least one hit (or a GitHub link, Show HN, or an AI tag on lobste.rs) to be classified.", kind: "lines" },
  { key: "max_fewshot", label: "Few-shot examples", help: "Most review decisions marked as examples that go into the prompt.", kind: "integer" },
  { key: "github_topics", label: "GitHub topics", help: "One per line. Repos with any of these topics are searched daily.", kind: "lines" },
  { key: "github_min_stars", label: "GitHub minimum stars", help: "Repos need at least this many stars to be classified.", kind: "integer" },
  { key: "trending_weights", label: "Trending weights", help: "Source weight, engagement weight, star-growth weight and gravity exponent.", kind: "weights" },
];

// Keep the page in sync with the schema: every setting must have a field.
for (const key of SETTING_KEYS) {
  if (!SETTING_FIELDS.some((f) => f.key === key)) throw new Error(`No admin field for setting ${key}`);
}

export const REASONING_LEVELS = ["", "none", "low", "medium", "high"] as const;
export const WEIGHT_KEYS = ["w_s", "w_e", "w_g", "g"] as const;

export async function loadSettings(db: D1Database): Promise<Record<string, unknown>> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key, JSON.parse(r.value)]));
}

/** Form fields for one setting -> its JSON value (before validation). */
export function parseSettingForm(field: SettingField, form: FormData): unknown {
  const str = (name = "value") => String(form.get(name) ?? "").trim();
  switch (field.kind) {
    case "number":
    case "integer":
      return str() === "" ? NaN : Number(str());
    case "text":
    case "reasoning":
      return str();
    case "lines":
      return str()
        .split(/[\n,]/)
        .map((l) => l.trim())
        .filter(Boolean);
    case "weights":
      return Object.fromEntries(WEIGHT_KEYS.map((k) => [k, str(k) === "" ? NaN : Number(str(k))]));
  }
}

export class SettingError extends Error {}

/** Validates with the same schema the Worker uses, then saves. */
export async function saveSetting(db: D1Database, key: string, form: FormData): Promise<void> {
  const field = SETTING_FIELDS.find((f) => f.key === key);
  if (!field) throw new SettingError("Unknown setting.");
  const parsed = settingSchemas[field.key].safeParse(parseSettingForm(field, form));
  if (!parsed.success) throw new SettingError(parsed.error.issues.map((i) => i.message).join("; "));
  if (field.kind === "integer" && !Number.isInteger(parsed.data)) throw new SettingError("Must be a whole number.");
  if (field.kind === "reasoning" && !(REASONING_LEVELS as readonly string[]).includes(parsed.data as string)) {
    throw new SettingError(`Must be one of: ${REASONING_LEVELS.filter(Boolean).join(", ")}, or empty.`);
  }
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(field.key, JSON.stringify(parsed.data))
    .run();
}
