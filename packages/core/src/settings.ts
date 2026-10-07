import { z } from "zod";

// Every tunable value lives in the `settings` table as JSON. Defaults are
// seeded by migrations, never hard-coded in Worker code.
export const settingSchemas = {
  review_threshold: z.number().min(0).max(1),
  trending_weights: z.object({
    w_s: z.number(),
    w_e: z.number(),
    w_g: z.number(),
    g: z.number(),
  }),
  categories: z.array(z.string().min(1)).min(1),
  prefilter_keywords: z.array(z.string().min(1)),
  model_id: z.string().min(1),
  max_fewshot: z.number().int().min(0),
  // GitHub adapter: repos with any of these topics and at least this many stars.
  github_topics: z.array(z.string().min(1)).min(1),
  github_min_stars: z.number().int().min(0),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export const SETTING_KEYS = Object.keys(settingSchemas) as SettingKey[];

export function parseSetting<K extends SettingKey>(key: K, raw: string): SettingValue<K> {
  return settingSchemas[key].parse(JSON.parse(raw)) as SettingValue<K>;
}

export async function getSetting<K extends SettingKey>(db: D1Database, key: K): Promise<SettingValue<K>> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  if (!row) throw new Error(`Missing setting: ${key}`);
  return parseSetting(key, row.value);
}
