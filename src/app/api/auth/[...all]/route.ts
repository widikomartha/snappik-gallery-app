import { authHandler } from "@/modules/auth/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = authHandler;
export const POST = authHandler;
