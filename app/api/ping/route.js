import { ok } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return ok({
    ok: true,
    status: "alive"
  });
}
