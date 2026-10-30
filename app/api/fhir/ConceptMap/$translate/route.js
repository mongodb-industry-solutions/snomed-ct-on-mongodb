import { translateCode } from '@/lib/terminology-translation';
export const runtime = 'nodejs';
async function respond(body) {
  try {
    if (body.resourceType === 'Parameters') body = Object.fromEntries((body.parameter || []).map(p => [p.name, p.valueCode ?? p.valueUri ?? p.valueString ?? p.valueBoolean]));
    const result = await translateCode(body);
    return Response.json(result.fhir, { headers: { 'content-type': 'application/fhir+json' } });
  } catch (error) { return Response.json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: error.message }] }, { status: 400, headers: { 'content-type': 'application/fhir+json' } }); }
}
export async function POST(request) { return respond(await request.json()); }
export async function GET(request) { return respond(Object.fromEntries(new URL(request.url).searchParams)); }
