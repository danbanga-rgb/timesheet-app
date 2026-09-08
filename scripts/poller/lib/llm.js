// Thin Claude helper for Node scripts. Same shape on both call surfaces
// (text + vision). Uses the official @anthropic-ai/sdk that's already a
// poller dep. Retries once on 429 (8s) or 5xx (2s).

const Anthropic = require('@anthropic-ai/sdk');

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

const CHAT_SYSTEM_DEFAULT =
  'You extract structured data and write natural replies. Reply ONLY with a single valid JSON object — no prose, no code fences, no thinking tags. Keep the "reply" field concise (1-3 sentences).';

function parseLLMJson(raw) {
  let s = String(raw).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    const status = e?.status;
    if (status === 429) { await sleep(8000); return await fn(); }
    if (typeof status === 'number' && status >= 500) { await sleep(2000); return await fn(); }
    throw e;
  }
}

// Call Claude with a text prompt. Returns { text, usage, model }.
async function callClaude({
  prompt,
  system = CHAT_SYSTEM_DEFAULT,
  model = CLAUDE_MODEL,
  maxTokens = 1500,
  apiKey = process.env.ANTHROPIC_API_KEY,
}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey });
  const msg = await withRetry(() => client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
  }));
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: msg.usage || null, model: msg.model };
}

// Call Claude with an image + prompt. media_type defaults to 'image/jpeg'.
async function callClaudeVision({
  imageBase64,
  prompt,
  system = CHAT_SYSTEM_DEFAULT,
  model = CLAUDE_MODEL,
  maxTokens = 1500,
  mediaType = 'image/jpeg',
  apiKey = process.env.ANTHROPIC_API_KEY,
}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const client = new Anthropic({ apiKey });
  const msg = await withRetry(() => client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  }));
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage: msg.usage || null, model: msg.model };
}

module.exports = { callClaude, callClaudeVision, parseLLMJson, CLAUDE_MODEL };
