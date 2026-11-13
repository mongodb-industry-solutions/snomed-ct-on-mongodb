import { translateCode } from '@/lib/terminology-translation';
import { ok, fail, parseJson } from '@/lib/http';
export const runtime = 'nodejs';
export async function POST(request) {
  try { return ok(await translateCode(await parseJson(request))); }
  catch (error) { return fail(error.message, 400); }
}
