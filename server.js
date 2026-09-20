/**
 * Medi AI — production server
 * Express + PostgreSQL (Neon). Auth with email, chats, credits & plans,
 * multi-AI with fallback, knowledge-base grounded answers,
 * emergency detection, 50+ languages. All data survives redeploys.
 */
'use strict';
const path = require('path');
const https = require('https');
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

/* Login sessions live in Postgres, so users stay logged in even when the
   server restarts, redeploys, or wakes up from idle sleep. */
let PGStore = null;
try { PGStore = require('connect-pg-simple')(session); } catch (e) { /* memory fallback */ }

const sessionConfig = {
  secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 30 * 24 * 60 * 60 * 1000, // stay logged in for 30 days
  },
};
if (PGStore && db.pool) sessionConfig.store = new PGStore({ pool: db.pool });
app.use(session(sessionConfig));

/* ------------------------------ plans ------------------------------ */
const PLANS = db.PLANS;
/* v2.1 plan tuning — daily-credit plans (prices & engines unchanged):
   Free 9/week · Plus 19/day ×7 days · Plus+ 25/day ×28 · Pro 39/day ×28 ·
   Pro+ 59/day ×28 · Elite 119/day ×336 (28×12) days. */
Object.assign(db.PLANS.free,  { credits: 9,   renewDays: 7 });
Object.assign(db.PLANS.plus,  { credits: 19,  renewDays: 1, weeks: 1 });
Object.assign(db.PLANS.plus2, { credits: 25,  renewDays: 1, weeks: 4 });
Object.assign(db.PLANS.pro,   { credits: 39,  renewDays: 1, weeks: 4 });
Object.assign(db.PLANS.pro2,  { credits: 59,  renewDays: 1, weeks: 4 });
Object.assign(db.PLANS.elite, { credits: 119, renewDays: 1, weeks: 48 });

/* --------------------------- languages ---------------------------- */
const LANGUAGES = [
  { code: 'en-IN', name: 'English' }, { code: 'hi-Latn-IN', name: 'Hinglish — Roman Hindi + English mix' },
  { code: 'hi-IN', name: 'हिन्दी — Hindi' },
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
  { code: 'vi-VN', name: 'Tiếng Việt — Vietnamese' }, { code: 'th-TH', name: 'ไทย — Thai' }, { code: 'fil-PH', name: 'Filipino' }, { code: 'nl-NL', name: 'Nederlands — Dutch' },
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
    id: u.id, username: u.username, email: u.email || undefined, plan: u.plan,
    planLabel: (PLANS[u.plan] || PLANS.free).label,
    credits: u.credits, language: u.language, isAdmin: !!u.is_admin,
    memberSince: u.created_at ? String(u.created_at).slice(0, 10) : undefined,
  };
}
async function currentUser(req) {
  if (!req.session || !req.session.uid) return null;
  return db.getUser(req.session.uid);
}
async function requireAuth(req, res, next) {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in.' });
  req.user = u;
  next();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ------------------------------ auth ------------------------------ */
app.post('/api/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const uname = String(username || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    const pass = String(password || '');
    if (uname.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (!/^[a-zA-Z0-9_.-]+$/.test(uname)) return res.status(400).json({ error: 'Username can only have letters, numbers, dot, dash, underscore.' });
    if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (pass.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (await db.userExists(uname)) return res.status(409).json({ error: 'That username is already taken.' });
    if (await db.emailExists(mail)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const isFirst = (await db.userCount()) === 0; // first user becomes admin
    const u = await db.createUser(uname, mail, pass, isFirst);
    req.session.uid = u.id;
    res.json({ ok: true, user: publicUser(u) });
  } catch (e) {
    console.error('[signup] ' + e.message);
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const identifier = String(username || '').trim();
    const u = await db.getUserByIdentifier(identifier);
    if (!u) {
      /* Tell the user exactly what went wrong instead of a generic message. */
      const msg = identifier.includes('@')
        ? 'No account found with that email. Log in with your username instead — and add your email under Settings so email login works next time.'
        : 'No account found with that username. Check the spelling, or create a new account on the Sign up tab.';
      return res.status(401).json({ error: msg });
    }
    if (!db.verifyPassword(u, String(password || ''))) {
      return res.status(401).json({ error: 'Wrong password for ' + u.username + '. Passwords are case-sensitive — check for typos and try again.' });
    }
    req.session.uid = u.id;
    res.json({ ok: true, user: publicUser(u) });
  } catch (e) {
    console.error('[login] ' + e.message);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  const u = await currentUser(req);
  res.json({
    user: u ? publicUser(u) : null,
    plans: PLANS,
    engines: ai.available().length,
    languages: LANGUAGES,
  });
});

/* ---------------------------- settings ---------------------------- */
app.post('/api/settings', requireAuth, async (req, res) => {
  const u = req.user;
  const { language, email } = req.body || {};
  const lang = LANGUAGES.find((l) => l.code === language) || LANGUAGES.find((l) => l.code === u.language) || LANGUAGES[0];
  /* Optional email update — lets existing users (whose accounts were made
     before the email field existed) attach an email so they can log in
     with it. Empty string clears the email. */
  let newEmail;
  if (email !== undefined) {
    const mail = String(email || '').trim().toLowerCase();
    if (mail === '') {
      newEmail = null;
    } else {
      if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: 'Please enter a valid email address.' });
      const other = await db.getUserByEmail(mail);
      if (other && other.id !== u.id) return res.status(409).json({ error: 'That email is already used by another account.' });
      newEmail = mail;
    }
  }
  const updated = await db.setPrefs(u.id, lang.code, newEmail);
  res.json({ ok: true, user: publicUser(updated) });
});

/* ------------------------------ chats ----------------------------- */
app.get('/api/chats', requireAuth, async (req, res) => {
  res.json({ chats: await db.listChats(req.user.id) });
});

app.get('/api/chats/:id', requireAuth, async (req, res) => {
  const chat = await db.getChat(Number(req.params.id), req.user.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });
  res.json({ chat, messages: await db.getMessages(chat.id) });
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  const ok = await db.deleteChat(Number(req.params.id), req.user.id);
  res.json({ ok });
});

/* ------------------------------ chat ------------------------------- */
app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    const { chatId, text, mode = 'chat', language } = req.body || {};
    const body = String(text || '').trim();
    if (!body) return res.status(400).json({ error: 'Message is empty.' });
    if (body.length > 8000) return res.status(400).json({ error: 'Message is too long (max 8000 characters).' });

    const lang = LANGUAGES.find((l) => l.code === (language || u.language)) ||
                 LANGUAGES.find((l) => l.code === u.language) || LANGUAGES[0];

    const cost = mode === 'report' ? 2 : 1;
    const fresh = await db.getUser(u.id);
    if (fresh.credits < cost) {
      return res.status(402).json({ error: 'Not enough credits. Upgrade your plan to continue.', credits: fresh.credits });
    }

    let chat = chatId ? await db.getChat(Number(chatId), u.id) : null;
    if (!chat) chat = await db.createChat(u.id, body.replace(/\s+/g, ' ').slice(0, 50), mode);

    const emergency = detectEmergency(body);
    const kbHits = await db.searchKB(body, 3);
    const system = buildSystemPrompt({ mode, languageName: lang.name, kbHits, emergency });

    const history = await db.getRecentMessages(chat.id, 10);
    const messages = [{ role: 'system', content: system }, ...history, { role: 'user', content: body }];

    await db.addMessage(chat.id, 'user', body);

    // Engine count depends on the plan: Free = 2 engines, Plus = 3,
    // Plus+ = 4, Pro tiers = all available engines, working collectively.
    // If an engine fails, the remaining engines still answer.
    const plan = PLANS[fresh.plan] || PLANS.free;
    const result = plan.engines > 1
      ? await ai.ensembleChat(messages, plan.engines)
      : await ai.chat(null, messages);
    await db.addMessage(chat.id, 'assistant', result.text);
    await db.touchChat(chat.id);

    // In report mode the exchange is also saved as a reusable report.
    let reportId = null;
    if (mode === 'report') {
      const saved = await db.createReport(u.id, body.replace(/\s+/g, ' ').slice(0, 60) || 'Report', body, result.text);
      reportId = saved ? saved.id : null;
    }

    const credits = await db.deductCredits(u.id, cost);
    res.json({
      ok: true, chatId: chat.id, reply: result.text,
      engines: result.engines || 1, credits, emergency, reportId,
      kbTopics: (kbHits || []).map((h) => ({
        topic: h.topic, severity: h.severity,
        source: h.source || 'Medi AI Knowledge Base',
        sourceUrl: h.source_url || null,
      })),
    });
  } catch (e) {
    console.error('[chat] ' + e.message);
    const status = e.message.includes('No AI provider keys') ? 503 : 502;
    res.status(status).json({ error: e.message });
  }
});

/* ------------------------------ admin ----------------------------- */
app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ users: await db.listUsersAdmin() });
});

app.post('/api/admin/plan', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { username, plan } = req.body || {};
  const target = await db.getUserByIdentifier(String(username || ''));
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: 'Unknown plan: ' + plan });
  const now = Math.floor(Date.now() / 1000);
  const expires = p.weeks ? now + p.weeks * 7 * 86400 : null;
  const updated = await db.setPlan(target.id, plan, p.credits, expires, now);
  res.json({ ok: true, user: publicUser(updated) });
});

/* ------------------------------ dashboard ------------------------- */
app.get('/api/dashboard', requireAuth, async (req, res) => {
  const u = req.user;
  res.json({
    user: publicUser(u),
    stats: await db.userStats(u.id),
    recentChats: (await db.listChats(u.id)).slice(0, 5),
    recentReports: (await db.listReports(u.id)).slice(0, 5),
  });
});

/* ------------------------------ reports --------------------------- */
app.get('/api/reports', requireAuth, async (req, res) => {
  res.json({ reports: await db.listReports(req.user.id) });
});

app.get('/api/reports/:id', requireAuth, async (req, res) => {
  const r = await db.getReport(Number(req.params.id), req.user.id);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  res.json({ report: r });
});

app.delete('/api/reports/:id', requireAuth, async (req, res) => {
  res.json({ ok: await db.deleteReport(Number(req.params.id), req.user.id) });
});

/* ------------------------------ coupons --------------------------- */
app.post('/api/coupon/redeem', requireAuth, async (req, res) => {
  const code = String((req.body || {}).code || '').trim();
  if (!code) return res.status(400).json({ error: 'Enter a coupon code.' });
  const c = await db.findCoupon(code);
  if (!c) return res.status(404).json({ error: 'Invalid or expired coupon code.' });
  if (c.credits > 0) {
    const fresh = await db.getUser(req.user.id);
    const updated = await db.setPlan(fresh.id, fresh.plan, fresh.credits + c.credits);
    return res.json({ ok: true, message: 'Coupon applied! +' + c.credits + ' credits added.', credits: updated.credits, percentOff: 0 });
  }
  if (c.percent_off > 0) {
    return res.json({ ok: true, message: c.percent_off + '% off will be applied at checkout.', percentOff: c.percent_off });
  }
  res.status(400).json({ error: 'This coupon has no benefit.' });
});

/* ------------------------------ payments -------------------------- */
function rzpRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: 'api.razorpay.com', path: apiPath, method,
      headers: {
        Authorization: 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: 20000,
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          res.statusCode < 300 ? resolve(json) : reject(new Error((json.error && json.error.description) || ('Razorpay HTTP ' + res.statusCode)));
        } catch (e) { reject(new Error('Razorpay returned invalid JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Razorpay request timed out')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

app.post('/api/payment/create-order', requireAuth, async (req, res) => {
  try {
    const u = req.user;
    const { plan, coupon } = req.body || {};
    const p = PLANS[plan];
    if (!p || !p.priceInr) return res.status(400).json({ error: 'Choose a paid plan to continue.' });
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ error: 'Payments are not configured yet. Contact the administrator to upgrade your plan.' });
    }
    let percentOff = 0;
    let couponCode = null;
    if (coupon) {
      const c = await db.findCoupon(coupon);
      if (c && c.percent_off > 0) { percentOff = c.percent_off; couponCode = c.code; }
    }
    const amount = Math.round(p.priceInr * 100 * (1 - percentOff / 100)); // paise
    const rzp = await rzpRequest('POST', '/v1/orders', {
      amount, currency: 'INR', receipt: 'medi-' + Date.now(), notes: { username: u.username, plan },
    });
    await db.createOrder(u.id, plan, amount, couponCode, rzp.id);
    res.json({
      ok: true, plan, amount, percentOff,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: rzp.id, currency: 'INR',
    });
  } catch (e) {
    console.error('[payment] ' + e.message);
    res.status(502).json({ error: 'Could not create payment order: ' + e.message });
  }
});

app.post('/api/payment/verify', requireAuth, async (req, res) => {
  const u = req.user;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification fields.' });
  }
  const order = await db.getOrderByRzp(razorpay_order_id);
  if (!order || order.user_id !== u.id) return res.status(404).json({ error: 'Order not found.' });
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (expected !== razorpay_signature) {
    await db.setOrderStatus(order.id, 'tampered');
    return res.status(400).json({ error: 'Payment verification failed. If money was deducted it will be auto-refunded by Razorpay.' });
  }
  const target = order.plan || plan;
  const p = PLANS[target];
  if (!p) return res.status(400).json({ error: 'Unknown plan on order.' });
  const now = Math.floor(Date.now() / 1000);
  const expires = p.weeks ? now + p.weeks * 7 * 86400 : null;
  const updated = await db.setPlan(u.id, target, p.credits, expires, now);
  await db.setOrderStatus(order.id, 'paid');
  res.json({ ok: true, user: publicUser(updated), plan: target });
});

/* ------------------------------ problems -------------------------- */
app.post('/api/report-problem', requireAuth, async (req, res) => {
  const u = req.user;
  const { subject, message } = req.body || {};
  const s = String(subject || '').trim();
  const m = String(message || '').trim();
  if (!s || !m) return res.status(400).json({ error: 'Subject and message are required.' });
  await db.createProblem(u.id, s, m);
  res.json({ ok: true, message: 'Thank you! Your report was sent to the team.' });
});

/* ------------------------------ admin extras ---------------------- */
app.get('/api/admin/problems', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ problems: await db.listProblems() });
});

app.post('/api/admin/problems/:id', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const status = ['open', 'closed'].includes((req.body || {}).status) ? req.body.status : 'open';
  res.json({ ok: await db.setProblemStatus(Number(req.params.id), status) });
});

app.get('/api/admin/knowledge', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ topics: await db.listKB() });
});

app.post('/api/admin/knowledge', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { topic, symptoms, summary, advice, severity, source, sourceUrl } = req.body || {};
  if (!topic || !symptoms || !summary || !advice) {
    return res.status(400).json({ error: 'Topic, symptoms, summary and advice are required.' });
  }
  const sev = ['self-care', 'see-doctor', 'emergency'].includes(severity) ? severity : 'self-care';
  const ok = await db.addKB(topic, symptoms, summary, advice, sev, source, sourceUrl);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: 'Could not add topic.' });
});

app.delete('/api/admin/knowledge/:id', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ ok: await db.deleteKB(Number(req.params.id)) });
});

app.get('/api/admin/coupons', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ coupons: await db.listCoupons() });
});

app.post('/api/admin/coupons', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  const { code, percentOff, credits } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Coupon code is required.' });
  const ok = await db.createCoupon(code, Number(percentOff) || 0, Number(credits) || 0);
  ok ? res.json({ ok: true }) : res.status(400).json({ error: 'Coupon already exists.' });
});

app.delete('/api/admin/coupons/:id', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({ ok: await db.deleteCoupon(Number(req.params.id)) });
});

app.get('/api/admin/sync-status', requireAuth, async (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only.' });
  res.json({
    uptime: Math.round(process.uptime()),
    engines: ai.available().length,
    users: await db.userCount(),
    knowledge: (await db.listKB()).length,
    payments: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    whatsapp: !!process.env.WHATSAPP_TOKEN,
  });
});

/* ------------------------------ whatsapp webhook ------------------ */
app.get('/whatsapp/webhook', (req, res) => {
  // Meta webhook verification handshake
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === (process.env.WHATSAPP_VERIFY_TOKEN || 'medi-ai')) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/whatsapp/webhook', express.json(), async (req, res) => {
  res.sendStatus(200); // acknowledge immediately
  try {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) return;
    const value = req.body && req.body.entry && req.body.entry[0] && req.body.entry[0].changes &&
                  req.body.entry[0].changes[0] && req.body.entry[0].changes[0].value;
    const msg = value && value.messages && value.messages[0];
    if (!msg || msg.type !== 'text') return;
    const from = msg.from;
    const text = String(msg.text && msg.text.body || '').slice(0, 2000);
    if (!text) return;
    const emergency = detectEmergency(text);
    const kbHits = await db.searchKB(text, 3);
    const system = buildSystemPrompt({ mode: 'chat', languageName: 'English', kbHits, emergency });
    const result = await ai.chat(null, [{ role: 'system', content: system }, { role: 'user', content: text }]);
    const reply = String(result.text).slice(0, 4000);
    await new Promise((resolve) => {
      const data = JSON.stringify({ messaging_product: 'whatsapp', to: from, text: { body: reply } });
      const r = https.request({
        hostname: 'graph.facebook.com',
        path: '/v21.0/' + process.env.WHATSAPP_PHONE_ID + '/messages',
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 20000,
      }, (res2) => { res2.resume(); res2.on('end', resolve); });
      r.on('timeout', () => { r.destroy(); resolve(); });
      r.on('error', () => resolve());
      r.write(data);
      r.end();
    });
  } catch (e) {
    console.error('[whatsapp] ' + e.message);
  }
});

/* ------------------------------ static ----------------------------- */
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ------------------------------ boot ------------------------------- */
(async () => {
  try {
    await db.init();
    /* Safety migrations for older databases: add columns the current code
       expects. Harmless no-ops when the columns already exist. */
    for (const m of [
      'ALTER TABLE users ADD COLUMN last_refill BIGINT',
      'ALTER TABLE users ADD COLUMN plan_expires BIGINT',
      'ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ DEFAULT now()',
      'ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT \'en-IN\'',
      'ALTER TABLE users ADD COLUMN provider TEXT DEFAULT NULL',
      'ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE',
    ]) { try { await db.pool.query(m); } catch (e) {} }
    console.log('[medi-ai] database ready (PostgreSQL)');
  } catch (e) {
    console.error('[medi-ai] DATABASE ERROR: ' + e.message);
    console.error('[medi-ai] Set DATABASE_URL (e.g. a free Neon Postgres connection string).');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log('[medi-ai] listening on port ' + PORT);
    console.log('[medi-ai] AI engines with keys: ' + (ai.available().length || 'NONE — set API keys!'));
  });
})();
