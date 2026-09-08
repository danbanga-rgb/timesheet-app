// Thin Claude helper for edge functions. Same "prompt → parsed JSON" shape as
// the prior callGroq so migration is a one-line swap in every call site.
//
// Plain fetch (no SDK dep) — Anthropic's Messages API is stable and small.
// Retries once on 429 / 5xx; never on 4xx (client error).

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export interface CallOpts {
  system?: string;
  model?: string;
  maxTokens?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAnthropic(body: unknown): Promise<Response> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// Robust JSON extraction — strips <think> tags, markdown fences, prose bleed.
export function parseLLMJson(raw: string): Record<string, unknown> | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const CHAT_SYSTEM_DEFAULT =
  'You extract structured data and write natural replies. Reply ONLY with a single valid JSON object — no prose, no code fences, no thinking tags. Keep the "reply" field concise (1-3 sentences).';

// Call Claude with a text prompt. Retries once on 5xx (2s wait) or 429 (8s wait).
// Returns parsed JSON or null (drop-in for prior callGroq).
export async function callClaude(
  prompt: string,
  opts?: CallOpts,
): Promise<Record<string, unknown> | null> {
  const body = {
    model: opts?.model ?? CLAUDE_MODEL,
    max_tokens: opts?.maxTokens ?? 1500,
    system: opts?.system ?? CHAT_SYSTEM_DEFAULT,
    messages: [{ role: 'user', content: prompt }],
  };

  let res = await fetchAnthropic(body);
  if (res.status === 429 || res.status >= 500) {
    await sleep(res.status === 429 ? 8000 : 2000);
    res = await fetchAnthropic(body);
  }
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 400);
    throw new Error(`Anthropic ${res.status}: ${errText}`);
  }
  const data = await res.json();
  const raw = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('');
  return parseLLMJson(raw);
}
