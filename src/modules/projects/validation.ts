import { z } from "zod";

const label = z.string().trim().refine(v => [...v].length >= 1 && [...v].length <= 100);
const phone = z.string().regex(/^\+[1-9]\d{1,14}$/).nullable();
// A candidate identifier only. EPIC-03 must validate provider access before publishing inventory.
export const folderId = z.string().regex(/^[A-Za-z0-9_-]{10,200}$/);
const workflow = z.object({ enabled: z.boolean().optional(), quota: z.number().int().min(1).max(500).nullable().optional(), expires_at: z.iso.datetime({ offset: true }).nullable().optional(), password: z.string().min(8).max(128).nullable().optional() }).strict();
const download = workflow.omit({ quota: true });
const fields = {
  client_label: label, client_phone: phone.optional(), admin_phone: phone.optional(),
  detect_subfolders: z.boolean().optional(), notes_enabled: z.boolean().optional(), layout: z.literal("grid").optional(),
  main: workflow.optional(), download: download.optional(),
};
export const projectCreate = z.object({ ...fields, drive_folder_id: folderId }).strict();
export const projectPatch = z.object(fields).partial().extend({ expected_revision: z.number().int().positive() }).strict()
  .refine(v => Object.keys(v).length > 1);
export const revisionInput = z.object({ expected_revision: z.number().int().positive() }).strict();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
