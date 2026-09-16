/**
 * Medi AI — production server
 * Express + SQLite. Auth, chats, credits & plans, multi-AI with fallback,
 * knowledge-base grounded answers, emergency detection, 50+ languages.
 */
'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');

const db = require('./db');
const ai = require('./ai');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

/* ------------------------------ plans ------------------------------ */
const PLANS = {
  free: { label: 'Free', credits: 50,   priceInr: 0   },
  plus: { label: 'Plus', credits: 1000, priceInr: 199 },
  pro:  { label: 'Pro',  credits: 5000, priceInr: 499 },
};

/* --------------------------- languages ---------------------------- */
const LANGUAGES = [
  { code: 'en-IN', name: 'English' }, { code: 'hi-IN', name: 'हिन्दी — Hindi' },
  { code: 'bn-IN', name: 'বাংলা — Bengali' }, { code: 'ta-IN', name: 'தமிழ் — Tamil' },
  { code: 'te-IN', name: 'తెలుగు — Telugu' }, { code: 'mr-IN', name: 'मराठी — Marathi' },
  { code: 'gu-IN', name: 'ગુજરાતી — Gujarati' }, { code: 'kn-IN', name: 'ಕನ್ನಡ — Kannada' },
  { code: 'ml-IN', name: 'മലയാളം — Malayalam' }, { code: 'pa-IN', name: 'ਪੰਜਾਬੀ — Punjabi' },
  { code: 'or-IN', name: 'ଓଡ଼ିଆ — Odia' }, { code: 'as-IN', name: 'অসমীয়া — Assamese' },
  { code: 'ur-IN', name: 'اردو — Urdu' }, { code: 'mai-IN', name: 'मैथिली — Maithili' },
  { code: 'sa-IN', name: 'संस्कृतम् — Sanskrit' }, { code: 'ks-IN', name: 'کٲشُر — Kashmiri' },
  { code: 'ne-IN', name: 'नेपाली — Nepali' }, { code: 'kok-IN', name: 'कोंकणी — Konkani' },
  { code: 'doi-IN', name: 'डोगरी — Dogri' }, { code: 'mni-IN', name: 'ꯃꯤꯇꯩꯂꯣꯟ — Manipuri' },
  { code: 'brx-IN', name: 'बड़ो — Bodo' }, { code: 'sd-IN', name: 'سنڌي — Sindhi' },
  { code: 'sat-IN', name: 'ᱥᱟᱱᱛᱟᱲᱤ — Santali' },
  { code: 'ar-SA', name: 'العربية — Arabic' }, { code: 'es-ES', name: 'Español — Spanish' },
  { code: 'fr-FR', name: 'Français — French' }, { code: 'de-DE', name: 'Deutsch — German' },
  { code: 'pt-BR', name: 'Português — Portuguese' }, { code: 'it-IT', name: 'Italiano — Italian' },
  { code: 'ru-RU', name: 'Русский — Russian' }, { code: 'zh-CN', name: '中文 — Chinese (Simplified)' },
  { code: 'ja-JP', name: '日本語 — Japanese' }, { code: 'ko-KR', name: '한국어 — Korean' },
  { code: 'id-ID', name: 'Bahasa Indonesia' }, { code: 'ms-MY', name: 'Bahasa Melayu' },
  { code: 'tr-TR', name: 'Türkçe — Turkish' }, { code: 'fa-IR', name: 'فارسی — Persian' },
  { code: 'vi-VN', name: 'Tiếng Việt — Vietnamese' }, { code: 'th-TH', name: 'ไทย — Thai' },
  { code: 'fil-PH', name: 'Filipino' }, { code: 'nl-NL', name: 'Nederlands — Dutch' },
  { code: 'pl-PL', name: 'Polski — Polish' }, { code: 'uk-UA', name: 'Українська — Ukrainian' },
  { code: 'ro-RO', name: 'Română — Romanian' }, { code: 'el-GR', name: 'Ελληνικά — Greek' },
  { code: 'he-IL', name: 'עברית — Hebrew' }, { code: 'sw-KE', name: 'Kiswahili — Swahili' },
  { code: 'ha-NG', name: 'Hausa' }, { code: 'cs-CZ', name: 'Čeština — Czech' },
  { code: 'hu-HU', name: 'Magyar — Hungarian' }, { code: 'sv-SE', name: 'Svenska — Swedish' },
  { code: 'no-NO', name: 'Norsk — Norwegian' }, { code: 'da-DK', name: 'Dansk — Danish' },
  { code: 'fi-FI', name: 'Suomi — Finnish' },
];

/* --------------------------- emergencies --------------------------- */
const EMERGENCY_PATTERNS = [
  'chest pain', 'heart attack', 'cardiac arrest', 'suicide', 'kill myself', 'end my life',
  'want to die', 'not breathing', "can't breathe", 'cant breathe', 'difficulty breathing',
  'unconscious', 'passed out', 'seizure', 'fits ', 'heavy bleeding', 'severe bleeding',
  'bleeding a lot', 'stroke', 'paralysis', 'overdose', 'poison', 'poisoned',
  'snake bite', 'snakebite', 'dengue hemorrhagic', 'anaphyla', 'blue lips',
];

function detectEmergency(text) {
  const t = ' ' + String(text).toLowerCase() + ' ';
  return EMERGENCY_PATTERNS.some((w) => t.includes(w));
}

/* ------------------------ system prompt --------------------------- */
function buildSystemPrompt({ mode, languageName, kbHits, emergency }) {
  const lines = [];
  lines.push(
    'You are Medi AI, a careful medical and health information assistant for the general public.',
    'Rules you MUST always follow:',
    '1. Give clear, practical, evidence-based general health information.',
    '2. Be honest about uncertainty. Never invent diagnoses, doses or lab values.',
    '3. You are NOT a doctor: for anything serious, persistent, or worsening, clearly tell the user to see a qualified doctor.',
    '4. Never tell the user to stop or change prescription medicines — direct them to their doctor.',
    '5. Detect emergencies (heart attack, stroke, heavy bleeding, suicidal thoughts, poisoning, breathing trouble) and tell the user to call emergency services immediately.',
    '6. Use simple language, short paragraphs and bullet lists. Use common units (mg, °C, ml).',
    '7. Reply ONLY in this language: ' + languageName + '.'
  );

  if (mode === 'report') {
    lines.push(
      'MODE — REPORT LENS: The user has uploaded a medical report or lab result that was converted to text by OCR.',
      'Explain it simply: what the report is, key values, which are normal / abnormal and what they usually mean.',
      'Add: "This is not a diagnosis — discuss these results with your doctor." OCR text may contain errors; note anything that looks cut off or garbled instead of guessing.'
    );
  } else {
    lines.push('MODE — MEDICAL CHATBOT: Answer the user\'s health question directly and helpfully.');
  }

  if (kbHits && kbHits.length) {
    lines.push('VERIFIED KNOWLEDGE BASE context (use if relevant, ignore if not):');
    for (const k of kbHits) {
      lines.push(`- ${k.topic} [severity: ${k.severity}] ${k.summary} Advice: ${k.advice}`);
    }
  }

  if (emergency) {
    lines.push(
      'EMERGENCY DETECTED IN THE USER MESSAGE. Start your reply with a clear urgent warning line,',
      'tell them to call 112 (India) or their local emergency number immediately,',
      'then give only safe first-aid-level guidance.'
    );
  }
  return lines.join('\n');
}

/* ---------------------------- helpers ----------------------------- */
function publicUser(u) {
  return {
    id: u.id, username: u.username, plan: u.plan, planLabel: (PLANS[u.plan] || PLANS.free).label,
    credits: u.credits, language: u.language, provider: u.provider, isAdmin: !!u.is_admin,
  };
}
function currentUser(req) {
  if (!req.session || !req.session.uid) return null;
  return db.getUser(req.session.uid);
}
function requireAuth(req, res, next) {
  if (!currentUser(req)) return res.status(401).json({ error: 'Please log in.' });
  next();
}

/* ------------------------------ auth ------------------------------ */
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim();
  const pass = String(password || '');
  if (uname.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  if (!/^[a-zA-Z0-9_.-]+$/.test(uname)) return res.status(400).json({ error: 'Username can only have letters, numbers, dot, dash, underscore.' });
  if (pass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.userExists(uname)) return res.status(409).json({ error: 'That username is already taken.' });
  const isFirst = db.userCount() === 0; // first user becomes admin
  const u = db.createUser(uname, pass, isFirst);
  req.session.uid = u.id;
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.getUserByUsername(String(username || ''));
  if (!u || !db.verifyPassword(u, String(password || ''))) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }
  req.session.uid = u.id;
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({
    user: u ? publicUser(u) : null,
    plans: PLANS,
    providers: ai.available(),
    languages: LANGUAGES,
  });
});

/* ---------------------------- settings ---------------------------- */
app.post('/api/settings', requireAuth, (req, res) => {
  const u = currentUser(req);
  const { language, provider } = req.body || {};
  const lang = LANGUAGES.find((l) => l.code === language) || LANGUAGES.find((l) => l.code === u.language) || LANGUAGES[0];
  const prov = (provider && ai.available().some((p) => p.id === provider)) ? provider : null;
  const updated = db.setPrefs(u.id, lang.code, prov);
  res.json({ ok: true, user: publicUser(updated) });
});

/* ------------------------------ chats ----------------------------- */
app.get('/api/chats', requireAuth, (req, res) => {
  res.json({ chats: db.listChats(currentUser(req).id) });
});

app.get('/api/chats/:id', requireAuth, (req, res) => {
  const u = currentUser(req);
  const chat = db.getChat(Number(req.params.id), u.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat, messages: db.getMessages(chat.id) });
});

app.delete('/api/chats/:id', requireAuth, (req, res) => {
  const ok = db.deleteChat(Number(req.params.id), currentUser(req).id);
  res.json({ ok });
});

/* ------------------------------ chat ------------------------------- */
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const u = currentUser(req);
    const { chatId, text, mode = 'chat', language, provider } = req.body || {};
    const body = String(text || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is empty.' });
    if (body.length > 8000) return res.status(400).json({ error: 'Message is too long (max 8000 characters).' });

    const lang = LANGUAGES.find((l) => l.code === (language || u.language)) ||
                 LANGUAGES.find((l) => l.code === u.language) || LANGUAGES[0];

    const cost = mode === 'report' ? 2 : 1;
    const fresh = db.getUser(u.id);
    if (fresh.credits < cost) {
      return res.status(402).json({ error: 'Not enough credits. Upgrade your plan to continue.', credits: fresh.credits });
    }

    let chat = chatId ? db.getChat(Number(chatId), u.id) : null;
    if (!chat) chat = db.createChat(u.id, body.replace(/\s+/g, ' ').slice(0, 50), mode);

    const emergency = detectEmergency(body);
    const kbHits = db.searchKB(body, 3);
    const system = buildSystemPrompt({ mode, languageName: lang.name, kbHits, emergency });

    const history = db.getRecentMessages(chat.id, 10);
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: body }];

    db.addMessage(chat.id, 'user', body);

    const result = await ai.chat(provider || u.provider || null, messages);
    db.addMessage(chat.id, 'assistant', result.text);
    db.touchChat(chat.id);

    const credits = db.deductCredits(u.id, cost);
    res.json({
      ok: true, chatId: chat.id, reply: result.text,
      provider: result.provider, credits, emergency,
    });
  } catch (e) {
    console.error('[chat] ' + e.message);
    const status = e.message.includes('No AI provider keys') ? 503 : 502;
    res.status(status).json({ error: e.message });
  }
});

/* ------------------------------ admin ----------------------------- */
app.get('/api/admin/users', requireAuth, (req, res) => {
  const u = currentUser(req);
  if (!u.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const users = db.db.prepare('SELECT id, username, plan, credits, is_admin, created_at FROM users ORDER BY id DESC LIMIT 200').all();
  res.json({ users });
});

app.post('/api/admin/plan', requireAuth, (req, res) => {
  const u = currentUser(req);
  if (!u.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { username, plan } = req.body || {};
  const target = db.getUserByUsername(String(username || ''));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: 'Unknown plan: ' + plan });
  const updated = db.setPlan(target.id, plan, p.credits);
  res.json({ ok: true, user: publicUser(updated) });
});

/* ------------------------------ static ----------------------------- */
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('[medi-ai] listening on port ' + PORT);
  console.log('[medi-ai] AI providers with keys: ' + (ai.available().map((p) => p.id).join(', ') || 'NONE — set API keys!'));
});
