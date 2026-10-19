import { z } from "zod";

export const locale = z.enum(["id", "en"]);
export const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Choose a valid IANA timezone");
export const profile = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().min(3).max(63).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locale, timezone,
}).strict();
export const studioPatch = profile.pick({ name: true, slug: true }).partial().extend({ expected_revision: z.number().int().positive() }).strict().refine(v => v.name !== undefined || v.slug !== undefined);
export const defaults = z.object({
  detect_subfolders: z.boolean(), notes_enabled: z.boolean(), layout: z.literal("grid"),
  main: z.object({ enabled: z.literal(true), quota: z.number().int().min(1).max(500), expires_at: z.null() }).strict(),
  download: z.object({ enabled: z.boolean(), expires_at: z.null() }).strict(),
}).strict();
export const initialDefaults = {
  detect_subfolders: true, notes_enabled: true, layout: "grid" as const,
  main: { enabled: true as const, quota: 20, expires_at: null },
  download: { enabled: false, expires_at: null },
};
export const settingsPatch = z.object({ expected_revision: z.number().int().positive(), locale: locale.optional(), timezone: timezone.optional(), defaults: defaults.optional() }).strict().refine(v => v.locale !== undefined || v.timezone !== undefined || v.defaults !== undefined);
