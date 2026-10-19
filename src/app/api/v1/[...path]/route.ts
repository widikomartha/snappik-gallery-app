import { ownerHandler } from "@/modules/onboarding/service";
import { failure } from "@/modules/http";
import { galleryHandler } from "@/modules/gallery/service";
import { operationsHandler } from "@/modules/operations/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    return await (path.startsWith("/api/v1/ops/") ? operationsHandler(request) : path.startsWith("/api/v1/g/") ? galleryHandler(request) : ownerHandler(request));
  } catch (error) { return failure(error); }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
