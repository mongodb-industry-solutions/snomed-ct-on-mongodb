import { getRuntimeLlmConfig } from "@/lib/runtime-llm-config";
import { publicLlmConfig } from "@/lib/llm-models";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const response = ok(publicLlmConfig(await getRuntimeLlmConfig()));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
