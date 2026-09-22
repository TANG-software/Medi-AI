/**
 * Medi AI — multi-provider AI engine.
 * 10 providers with a uniform interface + automatic fallback:
 * if the selected provider fails, the next available one is tried.
 * All keys come from environment variables — never hardcoded.
 * Uses Node's built-in https (no external HTTP dependency).
 */
'use strict';
const https = require('https');
const http = require('http');
const { URL } = require('url');

const TIMEOUT = 60000;

/** POST JSON, resolve parsed JSON. Uses node core http/https only. */
function postJSON(urlStr, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const data = JSON.stringify(body);
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({}, headers, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }),
      timeout: TIMEOUT,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const status = res.statusCode;
        if (status < 200 || status >= 300) {
          let msg = 'HTTP ' + status;
          try {
            const j = JSON.parse(buf);
            msg = (j.error && j.error.message) || j.message || j.error || msg;
            if (typeof msg !== 'string') msg = JSON.stringify(msg);
            msg = String(msg).slice(0, 200);
          } catch (_) { /* keep default */ }
          reject(new Error('Provider error (' + status + '): ' + msg));
          return;
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Provider returned invalid JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out after ' + (TIMEOUT / 1000) + 's')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** GET JSON, resolve parsed JSON. */
function getJSON(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: 'GET',
      headers: Object.assign({}, headers, { Accept: 'application/json' }),
      timeout: 15000,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Provider returned invalid JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

const PROVIDERS = [
  { id: 'groq',       label: 'Groq',       model: 'llama-3.3-70b-versatile',               url: 'https://api.groq.com/openai/v1/chat/completions',          keyEnv: 'GROQ_API_KEY',       type: 'openai' },
  { id: 'sarvam',     label: 'Sarvam',     model: 'sarvam-m',                              url: 'https://api.sarvam.ai/v1/chat/completions',                keyEnv: 'SARVAM_API_KEY',     type: 'openai' },
  { id: 'mistral',    label: 'Mistral',    model: 'mistral-small-latest',                  url: 'https://api.mistral.ai/v1/chat/completions',              keyEnv: 'MISTRAL_API_KEY',    type: 'openai' },
  { id: 'gemini',     label: 'Gemini',     model: 'gemini-2.0-flash',                      url: 'https://generativelanguage.googleapis.com/v1beta',        keyEnv: 'GEMINI_API_KEY',     type: 'gemini' },
  { id: 'openrouter', label: 'OpenRouter', model: 'meta-llama/llama-3.3-70b-instruct:free', url: 'https://openrouter.ai/api/v1/chat/completions',         keyEnv: 'OPENROUTER_API_KEY', type: 'openai' },
  { id: 'together',   label: 'Together',   model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', url: 'https://api.together.xyz/v1/chat/completions',          keyEnv: 'TOGETHER_API_KEY',   type: 'openai' },
  { id: 'cohere',     label: 'Cohere',     model: 'command-r-plus',                       url: 'https://api.cohere.com/compatibility/v1/chat/completions', keyEnv: 'COHERE_API_KEY',   type: 'openai' },
  { id: 'cerebras',   label: 'Cerebras',   model: 'llama-3.3-70b',                        url: 'https://api.cerebras.ai/v1/chat/completions',             keyEnv: 'CEREBRAS_API_KEY',   type: 'openai' },
  { id: 'sambanova',  label: 'SambaNova',  model: 'Meta-Llama-3.3-70B-Instruct',          url: 'https://api.sambanova.ai/v1/chat/completions',            keyEnv: 'SAMBANOVA_API_KEY',  type: 'openai' },
  { id: 'plugsky',    label: 'Plugsky',    model: process.env.PLUGSKY_MODEL || 'gpt-4o-mini', url: process.env.PLUGSKY_BASE_URL || 'https://api.plugsky.com/v1/chat/completions', keyEnv: 'PLUGSKY_API_KEY', type: 'openai' },
];

/** Which providers have keys configured? */
function available() {
  return PROVIDERS
    .filter((p) => process.env[p.keyEnv])
    .map((p) => ({ id: p.id, label: p.label }));
}

function byId(id) { return PROVIDERS.find((p) => p.id === id) || null; }

/** Model can be overridden per provider via e.g. GROQ_MODEL=... */
function modelOf(p) { return process.env[p.id.toUpperCase() + '_MODEL'] || p.model; }

/** Base URL can be overridden per provider via e.g. MISTRAL_BASE_URL=... */
function urlOf(p) { return process.env[p.id.toUpperCase() + '_BASE_URL'] || p.url; }

/* ---------- model auto-discovery ---
   Providers retire old model names over time (e.g. Groq 404s on
   llama-3.3-70b-versatile). When that happens we ask the provider's
   /models endpoint what is available and switch automatically. */
const discoveredModels = {};
const NOT_A_CHAT_MODEL = /whisper|tts|guard|embed|moderation|safety|flux|sdxl|stable.?diffusion|distil|rerank|ocr/i;
const PREFERRED_MODEL = /llama|gpt-oss|qwen|kimi|deepseek|mixtral|gemma|sarvam|command|mistral|gpt|claude/i;

async function discoverModel(p) {
  try {
    const base = urlOf(p).replace(/\/chat\/completions$/, '');
    const res = await getJSON(base + '/models', { Authorization: 'Bearer ' + process.env[p.keyEnv] });
    const ids = (res.data || []).map((m) => m.id).filter(Boolean);
    const chat = ids.filter((id) => !NOT_A_CHAT_MODEL.test(id));
    const pick = chat.find((id) => PREFERRED_MODEL.test(id)) || chat[0] || ids[0];
    if (pick) {
      discoveredModels[p.id] = pick;
      console.error('[ai] ' + p.label + ': using model "' + pick + '"');
    }
    return pick || null;
  } catch (e) {
    console.error('[ai] ' + p.label + ': model discovery failed: ' + e.message);
    return null;
  }
}

function extractContent(p, res) {
  const text = res && res.choices && res.choices[0] && res.choices[0].message &&
               res.choices[0].message.content;
  if (!text) throw new Error(p.label + ' returned an empty response');
  return text;
}

async function callOpenAI(p, messages) {
  const attempt = (model) => postJSON(urlOf(p), {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 1800,
  }, { Authorization: 'Bearer ' + process.env[p.keyEnv] });
  let model = discoveredModels[p.id] || modelOf(p);
  try {
    return extractContent(p, await attempt(model));
  } catch (e) {
    const modelGone = /404|does not exist|not found|decommission|no longer/i.test(e.message);
    if (!modelGone) throw e;
    const alt = await discoverModel(p);
    if (!alt || alt === model) throw e;
    return extractContent(p, await attempt(alt));
  }
}

async function callGemini(p, messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents, generationConfig: { temperature: 0.4, maxOutputTokens: 1800 } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const url = p.url + '/models/' + modelOf(p) + ':generateContent?key=' + process.env[p.keyEnv];
  const res = await postJSON(url, body);
  const c = res && res.candidates && res.candidates[0];
  const text = c && c.content && c.content.parts && c.content.parts.map((x) => x.text || '').join('');
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function callProvider(p, messages) {
  if (p.type === 'gemini') return callGemini(p, messages);
  return callOpenAI(p, messages);
}

/**
 * Multi-engine answer ("Collective" — FAST MODE): up to `count` different
 * providers all start answering at the same time, and the FIRST engine to
 * finish delivers the reply. That makes every plan as fast as the single
 * fastest engine — no waiting for slow engines and no extra merge call.
 * The other engines keep running as backup: if the winner fails or comes
 * back empty, the next finisher takes over; if all fail, the sequential
 * fallback chain answers. Provider identities are never exposed to the
 * client — only the engine count.
 */
async function ensembleChat(messages, count) {
  const avail = PROVIDERS.filter((p) => process.env[p.keyEnv]);
  if (!avail.length) {
    const err = new Error('No AI provider keys configured. Add at least one key (e.g. GROQ_API_KEY) in your environment settings.');
    err.code = 'NO_KEYS';
    throw err;
  }
  const want = Math.max(1, Number(count) || 1);
  const picks = avail.slice(0, want);
  if (picks.length === 1) {
    const r = await chat(picks[0].id, messages);
    return { text: r.text, engines: 1 };
  }
  const tasks = picks.map((p) => callProvider(p, messages).then((t) => {
    if (!t || !String(t).trim()) throw new Error(p.label + ' returned an empty response');
    return t;
  }));
  try {
    const text = await Promise.any(tasks); /* first successful engine wins */
    return { text, engines: picks.length };
  } catch (e) {
    const r = await chat(null, messages); // every racer failed — full fallback chain
    return { text: r.text, engines: 1 };
  }
}

/**
 * Try the requested provider first (or the first available one),
 * then fall back to any other available provider on failure.
 */
async function chat(providerId, messages) {
  const avail = PROVIDERS.filter((p) => process.env[p.keyEnv]);
  if (!avail.length) {
    const err = new Error('No AI provider keys configured. Add at least one key (e.g. GROQ_API_KEY) in your environment settings.');
    err.code = 'NO_KEYS';
    throw err;
  }
  const first = (providerId && avail.find((p) => p.id === providerId)) || avail[0];
  const order = [first, ...avail.filter((p) => p !== first)];
  let lastErr = null;
  for (const p of order) {
    try {
      const text = await callProvider(p, messages);
      return { text, provider: p.id };
    } catch (e) {
      lastErr = e;
      console.error('[ai] ' + p.label + ' failed: ' + e.message);
    }
  }
  throw new Error('All AI providers failed. Last error: ' + (lastErr ? lastErr.message : 'unknown'));
}

module.exports = { available, chat, byId, ensembleChat };
