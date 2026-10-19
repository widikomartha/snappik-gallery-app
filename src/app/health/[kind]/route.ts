import { health } from "@/modules/health";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  return health((await params).kind);
}
