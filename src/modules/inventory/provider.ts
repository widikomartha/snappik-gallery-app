export const MAX_BYTES = 50 * 1024 * 1024;
export const FOLDER = "application/vnd.google-apps.folder";
export const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const providerId = (id: string) => /^[A-Za-z0-9_-]{10,200}$/.test(id);
export type SourceScope = { studioId: string; projectId: string; rootId: string };
export type ProviderFile = {
  id: string; name: string; parentId: string | null; mime: string; size: number;
  version: string; trashed?: boolean;
};
// Credentials/resource keys belong inside a future approved adapter, never its DTOs.
// Each call must authorize the supplied scope and refuse shortcuts/off-root content.
export interface InventoryProvider {
  readonly origin: "synthetic" | "google_public";
  folder(scope: SourceScope, id: string, signal: AbortSignal): Promise<ProviderFile>;
  list(scope: SourceScope, id: string, cursor: string | null, signal: AbortSignal): Promise<{ files: ProviderFile[]; next: string | null }>;
  read(scope: SourceScope, file: ProviderFile, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface ScopedInventorySource {
  readonly origin: InventoryProvider["origin"];
  forScope(scope: SourceScope): InventoryProvider;
}
export class SourceError extends Error {
  constructor(public code: string, public retryable = false, public retryAfterSeconds = 0) { super(code); }
}
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new SourceError("SCAN_CANCELLED");
}
export type ScanSummary = { photos: number; skipped: { unsupported: number; trashed: number; oversize: number; invalid_content: number }; folders: number };
export async function traverse(provider: InventoryProvider, scope: SourceScope, nested: boolean, signal: AbortSignal,
  visit: (file: ProviderFile, folderPath: string, ancestry: string[]) => Promise<void>): Promise<ScanSummary> {
  if (!providerId(scope.rootId)) throw new SourceError("INVALID_SOURCE");
  const root = await provider.folder(scope, scope.rootId, signal);
  if (root.id !== scope.rootId || root.mime !== FOLDER || root.trashed) throw new SourceError("INVALID_SOURCE");
  const summary: ScanSummary = { photos: 0, skipped: { unsupported: 0, trashed: 0, oversize: 0, invalid_content: 0 }, folders: 1 };
  const folders = [{ id: root.id, path: "", depth: 0, ancestry:[root.id] }]; const seen = new Set([root.id]);
  let entries = 0, pages = 0;
  for (let index = 0; index < folders.length; index++) {
    const folder = folders[index]; let cursor: string | null = null; const cursors = new Set<string>();
    do {
      checkAbort(signal);
      if (++pages > 10000) throw new SourceError("SCAN_PAGE_LIMIT");
      const page = await provider.list(scope, folder.id, cursor, signal);
      if (page.files.length > 1000) throw new SourceError("INVALID_PROVIDER_PAGE");
      for (const file of page.files) {
        checkAbort(signal);
        if (++entries > 20000) throw new SourceError("SCAN_ENTRY_LIMIT");
        if (!providerId(file.id) || file.parentId !== folder.id || !file.name || file.name.length > 1024 || file.name.includes("\0") || !file.version || file.version.length > 256) throw new SourceError("INVALID_PROVIDER_METADATA");
        // Ambiguous/cyclic ancestry cannot silently publish a partial inventory.
        if (seen.has(file.id)) throw new SourceError("DUPLICATE_PROVIDER_ID");
        seen.add(file.id);
        if (file.trashed) { summary.skipped.trashed++; continue; }
        if (file.mime === FOLDER) {
          if (!nested) continue;
          if (folder.depth >= 10) throw new SourceError("SCAN_DEPTH_LIMIT");
          if (++summary.folders > 2000) throw new SourceError("SCAN_FOLDER_LIMIT");
          folders.push({ id: file.id, path: folder.path ? `${folder.path}/${file.name}` : file.name, depth: folder.depth + 1, ancestry:[...folder.ancestry,file.id] }); continue;
        }
        if (!PHOTO_MIMES.has(file.mime)) { summary.skipped.unsupported++; continue; }
        if (!Number.isSafeInteger(file.size) || file.size < 0) throw new SourceError("INVALID_PROVIDER_METADATA");
        if (file.size > MAX_BYTES) { summary.skipped.oversize++; continue; }
        if (++summary.photos > 5000) throw new SourceError("SCAN_PHOTO_LIMIT");
        await visit(file, folder.path, folder.ancestry);
      }
      if (page.next !== null && (typeof page.next !== "string" || !page.next || page.next.length > 2048 || cursors.has(page.next))) throw new SourceError("INVALID_PROVIDER_CURSOR");
      if (page.next) cursors.add(page.next);
      cursor = page.next;
    } while (cursor !== null);
  }
  checkAbort(signal); return summary;
}
