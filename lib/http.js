export function ok(data, status = 200) {
  return Response.json(data, { status });
}

export function fail(message, status = 400, extra = {}) {
  return Response.json(
    {
      ok: false,
      error: message,
      ...extra
    },
    { status }
  );
}

export async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function elapsedMs(startTime) {
  return Number(process.hrtime.bigint() - startTime) / 1_000_000;
}

// Normalize token usage across OpenAI Responses ({input_tokens,output_tokens})
// and chat-completions ({prompt_tokens,completion_tokens}) shapes.
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? input + output) || input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}
