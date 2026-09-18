/* ================================================================
   Medi AI — client app
   Auth · chats · multi-mode composer · voice input · Report Lens
   (OCR on-device) · settings · admin · PWA
   ================================================================ */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const state = {
  user: null, plans: {}, providers: [], languages: [],
  chats: [], chatId: null,
  mode: 'chat',
  sending: false,
  deferredInstall: null,
};

/* ------------------------------ utils ------------------------------ */
function esc(s) {
  const A = String.fromCharCode(38); // ampersand
  const map = {};
  map[A] = A + 'amp;';
  map['<'] = A + 'lt;';
  map['>'] = A + 'gt;';
  map['"'] = A + 'quot;';
  map["'"] = A + '#39;';
  return String(s).replace(/[<>"']/g, (c) => map[c]);
}

/* Minimal safe markdown: bold, headings, bullets, line breaks. */
function md(text) {
  let h = esc(text);
  h = h.replace(/^#{1,4}\s+(.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = h.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-\u2022]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + m[1] + '</li>');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line);
    }
  }
  if (inList) out.push('</ul>');
  h = out.join('\n');
  h = h.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  return h;
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

/* ------------------------------ boot ------------------------------ */
async function boot() {
  try {
    const me = await api('/api/me');
    state.plans = me.plans || {};
    state.providers = me.providers || [];
    state.languages = me.languages || [];
    if (me.user) enterApp(me.user);
    else showAuth();
  } catch (e) {
    showAuth();
  }
  registerSW();
}

function showAuth() {
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
}

function enterApp(user) {
  state.user = user;
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#userDisplayName').textContent = user.username;
  $('#userAvatar').textContent = user.username[0].toUpperCase();
  updateCredits(user.credits);
  $('#planPill').textContent = user.planLabel;
  $('#adminBtn').style.display = user.isAdmin ? 'flex' : 'none';
  fillSettings();
  loadChats();
}

function updateCredits(n) {
  $('#creditCount').textContent = n;
  $('#creditCountTop').textContent = n;
}

/* ------------------------------ auth ------------------------------ */
let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $('#tabLogin').classList.toggle('active', m === 'login');
  $('#tabSignup').classList.toggle('active', m === 'signup');
  $('#authSubmit').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('#authError').classList.add('hidden');
}
$('#tabLogin').addEventListener('click', () => setAuthMode('login'));
$('#tabSignup').addEventListener('click', () => setAuthMode('signup'));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const btn = $('#authSubmit');
  btn.disabled = true; btn.textContent = 'Please wait…';
  $('#authError').classList.add('hidden');
  try {
    const r = await api('/api/' + (authMode === 'login' ? 'login' : 'signup'), { method: 'POST', body: { username, password } });
    enterApp(r.user);
  } catch (err) {
    const el = $('#authError');
    el.textContent = err.message;
    el.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    setAuthMode(authMode);
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  location.reload();
});

/* ------------------------------ sidebar ------------------------------ */
function openSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#sidebarBackdrop').classList.toggle('show', open);
}
$('#menuBtn').addEventListener('click', () => openSidebar(true));
$('#sidebarBackdrop').addEventListener('click', () => openSidebar(false));

/* ------------------------------ chats ------------------------------ */
async function loadChats() {
  try {
    const r = await api('/api/chats');
    state.chats = r.chats || [];
    renderChatList($('#chatSearch').value);
  } catch (_) {}
}

function renderChatList(filter = '') {
  const f = filter.trim().toLowerCase();
  const list = $('#chatList');
  list.innerHTML = '';
  const chats = state.chats.filter((c) => !f || c.title.toLowerCase().includes(f));
  if (!chats.length) {
    list.innerHTML = '<div class="section-label" style="padding:10px 8px">No chats yet</div>';
    return;
  }
  for (const c of chats) {
    const el = document.createElement('div');
    el.className = 'chat-item' + (c.id === state.chatId ? ' active' : '');
    el.innerHTML = `<i class="bi ${c.mode === 'report' ? 'bi-file-earmark-medical' : 'bi-chat-left'}"></i><span>${esc(c.title)}</span>`;
    el.addEventListener('click', () => { openChat(c.id); openSidebar(false); });
    list.appendChild(el);
  }
}

$('#chatSearch').addEventListener('input', (e) => renderChatList(e.target.value));

$('#newChatBtn').addEventListener('click', () => {
  state.chatId = null;
  $('#messages').innerHTML = '';
  $('#messages').appendChild(buildWelcome());
  openSidebar(false);
});

async function openChat(id) {
  try {
    const r = await api('/api/chats/' + id);
    state.chatId = id;
    const box = $('#messages');
    box.innerHTML = '';
    for (const m of r.messages) box.appendChild(buildMsg(m.role === 'user' ? 'user' : 'ai', m.content));
    renderChatList($('#chatSearch').value);
  } catch (e) { toast(e.message); }
}

function buildWelcome() {
  const d = document.createElement('div');
  d.className = 'welcome';
  d.id = 'welcome';
  const lang = state.languages.find((l) => l.code === state.user.language);
  d.innerHTML = `
    <div class="welcome-icon"><i class="bi bi-activity"></i></div>
    <h1>How can I help your health today?</h1>
    <p>Ask anything — symptoms, medicines, reports. Answers in <b>${esc(lang ? lang.name.split('—')[0].trim() : 'English')}</b>.</p>
    <div class="suggestions">
      <button class="suggestion" data-q="I have a headache and mild fever since yesterday. What should I do?">I have a headache and fever…</button>
      <button class="suggestion" data-q="Explain in simple terms what HbA1c means in my diabetes report.">Explain my diabetes report</button>
      <button class="suggestion" data-q="What are the warning signs of a stroke I should never ignore?">Stroke warning signs</button>
      <button class="suggestion" data-q="Safe home remedies for acidity at night?">Acidity at night</button>
    </div>`;
  d.querySelectorAll('.suggestion').forEach((b) =>
    b.addEventListener('click', () => { $('#input').value = b.dataset.q; send(); }));
  return d;
}

/* ------------------------------ messages ------------------------------ */
function buildMsg(role, content, meta) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const icon = role === 'user' ? 'bi-person' : 'bi-activity';
  wrap.innerHTML = `
    <div class="msg-ava"><i class="bi ${icon}"></i></div>
    <div class="bubble">${md(content)}${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</div>`;
  return wrap;
}

function showEmergencyBanner() {
  const b = document.createElement('div');
  b.className = 'emergency-banner';
  b.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i><div><b>Emergency warning:</b> Medi AI detected this may be urgent. If symptoms are severe or life-threatening, <b>call 112 (India) or your local emergency number NOW.</b></div>`;
  $('#messages').appendChild(b);
}

function typingBubble() {
  const wrap = document.createElement('div');
  wrap.className = 'msg ai';
  wrap.id = 'typingMsg';
  wrap.innerHTML = `
    <div class="msg-ava"><i class="bi bi-activity"></i></div>
    <div class="bubble"><span class="typing"><span></span><span></span><span></span></span></div>`;
  return wrap;
}

/* ------------------------------ send ------------------------------ */
async function send(textOverride) {
  if (state.sending) return;
  const input = $('#input');
  const text = (textOverride != null ? textOverride : input.value).trim();
  if (!text) return;

  if ($('#welcome')) $('#messages').innerHTML = '';
  $('#messages').appendChild(buildMsg('user', text));
  input.value = '';
  autosize();
  scrollToBottom();
  state.sending = true;
  $('#sendBtn').disabled = true;
  $('#messages').appendChild(typingBubble());
  scrollToBottom();

  try {
    const r = await api('/api/chat', {
      method: 'POST',
      body: {
        chatId: state.chatId,
        text,
        mode: state.mode,
        language: state.user.language,
        provider: state.user.provider || null,
      },
    });
    const t = $('#typingMsg');
    if (t) t.remove();
    if (r.emergency) showEmergencyBanner();
    const label = (state.providers.find((p) => p.id === r.provider) || {}).label || r.provider;
    $('#messages').appendChild(buildMsg('ai', r.reply, 'Medi AI · ' + label));
    state.chatId = r.chatId;
    updateCredits(r.credits);
    state.user.credits = r.credits;
    if (r.reportId) toast('Report saved — see it under Reports in the menu.');
    scrollToBottom();
    loadChats();
  } catch (e) {
    const t = $('#typingMsg');
    if (t) t.remove();
    const b = document.createElement('div');
    b.className = 'emergency-banner';
    b.innerHTML = `<i class="bi bi-x-circle"></i><div>${esc(e.message)}</div>`;
    $('#messages').appendChild(b);
    scrollToBottom();
  } finally {
    state.sending = false;
    $('#sendBtn').disabled = false;
    input.focus();
  }
}

$('#sendBtn').addEventListener('click', () => send());
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 140) + 'px';
}
$('#input').addEventListener('input', autosize);
function scrollToBottom() { const m = $('#messages'); m.scrollTop = m.scrollHeight; }

/* ------------------------------ mode selector ------------------------------ */
const MODE_META = {
  chat: { icon: 'bi-chat-heart', label: 'Chat' },
  report: { icon: 'bi-file-earmark-medical', label: 'Report Lens' },
};
function setMode(mode) {
  state.mode = mode;
  $$('.mode-option[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#modeMenu').classList.add('hidden');
  const m = MODE_META[mode];
  $('#modeBadge').innerHTML = `<i class="bi ${m.icon}"></i> ${m.label}`;
  $('#input').placeholder = mode === 'report'
    ? 'Ask about a report, or tap + to upload a photo…'
    : 'Ask Medi AI anything…';
}
$('#modeBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#modeMenu').classList.toggle('hidden');
});
$$('.mode-option[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.addEventListener('click', (e) => {
  if (!e.target.closest('#modeMenu') && !e.target.closest('#modeBtn')) $('#modeMenu').classList.add('hidden');
});

/* ------------------------------ voice input ------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recording = false;
if (SR) {
  rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    $('#input').value = ($('#input').value + ' ' + t).trim();
    autosize();
  };
  rec.onend = () => { recording = false; $('#micBtn').classList.remove('recording'); };
  rec.onerror = () => { recording = false; $('#micBtn').classList.remove('recording'); };
}
$('#micBtn').addEventListener('click', () => {
  if (!rec) return toast('Voice input is not supported in this browser.');
  if (recording) { rec.stop(); return; }
  rec.lang = state.user.language || 'en-IN';
  try { rec.start(); recording = true; $('#micBtn').classList.add('recording'); }
  catch (_) {}
});

/* ------------------------------ Report Lens (OCR) ------------------------------ */
const OCR_LANG = {
  'en-IN': 'eng', 'hi-IN': 'hin', 'bn-IN': 'ben', 'ta-IN': 'tam', 'te-IN': 'tel',
  'mr-IN': 'mar', 'gu-IN': 'guj', 'kn-IN': 'kan', 'ml-IN': 'mal', 'pa-IN': 'pan',
  'or-IN': 'ori', 'as-IN': 'asm', 'ur-IN': 'urd', 'ar-SA': 'ara', 'es-ES': 'spa',
  'fr-FR': 'fra', 'de-DE': 'deu', 'pt-BR': 'por', 'it-IT': 'ita', 'ru-RU': 'rus',
  'zh-CN': 'chi_sim', 'ja-JP': 'jpn', 'ko-KR': 'kor', 'tr-TR': 'tur',
};
$('#attachBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (state.mode !== 'report') setMode('report');
  toast('Reading text from your image…', 8000);
  try {
    const lang = OCR_LANG[state.user.language] || 'eng';
    const result = await Tesseract.recognize(file, lang + '+eng', { logger: () => {} });
    const text = (result.data.text || '').trim();
    if (!text) { toast('No readable text found in that image — try a clearer photo.'); return; }
    $('#ocrText').value = text.slice(0, 8000);
    $('#ocrModal').classList.remove('hidden');
  } catch (err) {
    toast('Could not read that image: ' + err.message);
  }
});
$('#ocrClose').addEventListener('click', () => $('#ocrModal').classList.add('hidden'));
$('#ocrAnalyze').addEventListener('click', () => {
  const t = $('#ocrText').value.trim();
  if (!t) return toast('No text to analyze.');
  $('#ocrModal').classList.add('hidden');
  send('Please analyze this medical report and explain it simply:\n\n' + t);
});

/* ------------------------------ settings ------------------------------ */
function fillSettings() {
  const ls = $('#langSelect');
  ls.innerHTML = state.languages.map((l) =>
    `<option value="${l.code}" ${l.code === state.user.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const ps = $('#providerSelect');
  ps.innerHTML = '<option value="">Auto (first available)</option>' +
    state.providers.map((p) =>
      `<option value="${p.id}" ${p.id === state.user.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  $('#settingsPlan').textContent = state.user.planLabel;
  $('#settingsCredits').textContent = state.user.credits;
}
$('#settingsBtn').addEventListener('click', () => $('#settingsModal').classList.remove('hidden'));
$('#settingsClose').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
$('#saveSettings').addEventListener('click', async () => {
  try {
    const r = await api('/api/settings', {
      method: 'POST',
      body: { language: $('#langSelect').value, provider: $('#providerSelect').value || null },
    });
    state.user = Object.assign({}, state.user, r.user);
    $('#settingsModal').classList.add('hidden');
    const lang = state.languages.find((l) => l.code === state.user.language);
    toast('Saved — answers will be in ' + (lang ? lang.name : state.user.language));
    if ($('#welcome')) {
      const b = $('#welcome').querySelector('p b');
      if (b) b.textContent = lang ? lang.name.split('—')[0].trim() : 'English';
    }
  } catch (e) { toast(e.message); }
});

/* ------------------------------ admin ------------------------------ */
$('#adminBtn').addEventListener('click', async () => {
  $('#adminModal').classList.remove('hidden');
  try {
    const r = await api('/api/admin/users');
    const box = $('#adminUsers');
    box.innerHTML = '';
    for (const u of r.users) {
      const row = document.createElement('div');
      row.className = 'admin-user';
      row.innerHTML = `
        <i class="bi bi-person"></i><span class="name">${esc(u.username)}${u.is_admin ? ' · admin' : ''}</span>
        <span style="color:var(--text-dim)">${u.credits}cr</span>
        <select data-user="${esc(u.username)}">
          ${['free', 'plus', 'pro'].map((p) =>
            `<option value="${p}" ${p === u.plan ? 'selected' : ''}>${p}</option>`).join('')}
        </select>`;
      box.appendChild(row);
    }
    box.querySelectorAll('select').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api('/api/admin/plan', { method: 'POST', body: { username: sel.dataset.user, plan: sel.value } });
        toast('Plan updated for ' + sel.dataset.user);
        if (sel.dataset.user.toLowerCase() === state.user.username.toLowerCase()) {
          const me = await api('/api/me');
          if (me.user) { state.user = me.user; updateCredits(me.user.credits); $('#planPill').textContent = me.user.planLabel; }
        }
      } catch (e) { toast(e.message); }
    }));
  } catch (e) {
    $('#adminUsers').innerHTML = `<p class="modal-hint">${esc(e.message)}</p>`;
  }
});
$('#adminClose').addEventListener('click', () => $('#adminModal').classList.add('hidden'));
$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); }));

/* ------------------------------ PWA ------------------------------ */
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstall = e;
  toast('Install Medi AI as an app from your browser menu!');
});

boot();

/* ==================== PAGES: dashboard, reports, pricing, about, problem ==================== */
function closePage() {
  const pv = $('#pageView');
  pv.classList.add('hidden');
  pv.innerHTML = '';
  document.body.classList.remove('page-open');
  $$('.nav-link').forEach((b) => b.classList.remove('active'));
}

async function openPage(name) {
  const pv = $('#pageView');
  closePage();
  pv.classList.remove('hidden');
  document.body.classList.add('page-open');
  $$('.nav-link').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  pv.innerHTML = '<div class="page-loading">Loading…</div>';
  try {
    if (name === 'dashboard') await renderDashboard();
    else if (name === 'reports') await renderReports();
    else if (name === 'pricing') await renderPricing();
    else if (name === 'about') renderAbout();
    else if (name === 'problem') renderProblem();
  } catch (e) {
    pv.innerHTML = '<div class="page-loading">' + esc(e.message) + '</div>';
  }
  if (window.innerWidth <= 900) openSidebar(false);
}

async function renderDashboard() {
  const r = await api('/api/dashboard');
  const s = r.stats;
  $('#pageView').innerHTML = `
    <div class="page-head"><h2><i class="bi bi-grid-1x2"></i> Dashboard</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back to chat</button></div>
    <div class="stat-grid">
      <div class="stat-card"><i class="bi bi-lightning-charge"></i><b>${r.user.credits}</b><span>Credits left</span></div>
      <div class="stat-card"><i class="bi bi-star"></i><b>${esc(r.user.planLabel || r.user.plan)}</b><span>Current plan</span></div>
      <div class="stat-card"><i class="bi bi-chat-dots"></i><b>${s.chats}</b><span>Conversations</span></div>
      <div class="stat-card"><i class="bi bi-file-earmark-medical"></i><b>${s.reports}</b><span>Saved reports</span></div>
    </div>
    <div class="page-cols">
      <div class="panel">
        <h3>Recent chats</h3>
        ${r.recentChats.length ? r.recentChats.map((c) =>
          `<button class="list-item" data-chat="${c.id}">${esc(c.title)}<small>${esc(c.created_at || '')}</small></button>`).join('')
          : '<p class="modal-hint">No chats yet — ask your first question!</p>'}
      </div>
      <div class="panel">
        <h3>Recent reports</h3>
        ${r.recentReports.length ? r.recentReports.map((c) =>
          `<button class="list-item" data-report="${c.id}">${esc(c.title)}<small>${esc(c.created_at || '')}</small></button>`).join('')
          : '<p class="modal-hint">No reports yet — scan a lab report with Report Lens.</p>'}
      </div>
    </div>
    <p class="modal-hint">Member since ${esc(s.memberSince || '')} · Report a bug anytime from “Report a problem”.</p>`;
}

async function renderReports() {
  const r = await api('/api/reports');
  $('#pageView').innerHTML = `
    <div class="page-head"><h2><i class="bi bi-file-earmark-medical"></i> Reports</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back to chat</button></div>
    <p class="modal-hint">Every Report Lens analysis is saved here automatically.</p>
    <div id="reportsList">
      ${r.reports.length ? r.reports.map((rep) => `
        <div class="report-item">
          <button class="list-item" data-report="${rep.id}">${esc(rep.title)}<small>${esc(rep.created_at || '')}</small></button>
          <button class="icon-btn danger" data-delreport="${rep.id}" title="Delete"><i class="bi bi-trash"></i></button>
        </div>`).join('')
        : '<p class="modal-hint">No reports yet. Tap the + button, choose a lab report photo, fix the text and tap Analyze.</p>'}
    </div>`;
}

async function openReport(id) {
  const r = await api('/api/reports/' + id);
  const rep = r.report;
  $('#pageView').innerHTML = `
    <div class="page-head"><h2>${esc(rep.title)}</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back</button></div>
    <p class="modal-hint">Analyzed on ${esc(rep.created_at || '')}</p>
    <div class="panel"><h3>Extracted text</h3><pre class="pre-wrap">${esc(rep.extracted)}</pre></div>
    <div class="panel gold-border"><h3>Medi AI analysis</h3><div class="md">${md(rep.analysis)}</div></div>`;
}

async function renderPricing() {
  const me = await api('/api/me');
  const plans = Object.entries(me.plans || {});
  const current = (me.user || {}).plan;
  $('#pageView').innerHTML = `
    <div class="page-head"><h2><i class="bi bi-stars"></i> Pricing</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back to chat</button></div>
    <div class="price-grid">
      ${plans.map(([id, p]) => `
        <div class="price-card ${id === current ? 'current' : ''}">
          <h3>${esc(p.label)}</h3>
          <div class="price">${p.priceInr ? '₹' + p.priceInr : 'Free'}</div>
          <ul>
            <li><b>${p.credits}</b> credits</li>
            <li>Report Lens access</li>
            <li>50+ languages</li>
            <li>${id === 'pro' ? 'Priority AI engines' : 'All 10 AI engines'}</li>
          </ul>
          ${id === 'free' ? '<button class="btn-ghost" disabled>Default plan</button>'
            : id === current ? '<button class="btn-gold" disabled>Current plan</button>'
            : `<button class="btn-gold" data-buy="${id}">Choose ${esc(p.label)}</button>`}
        </div>`).join('')}
    </div>
    <div class="panel">
      <h3>Have a coupon?</h3>
      <div class="coupon-row">
        <input id="couponInput" type="text" placeholder="Enter coupon code" autocomplete="off">
        <button class="btn-gold small" id="couponBtn">Redeem</button>
      </div>
      <p class="modal-hint" id="couponMsg">Credit coupons add credits instantly; discount coupons apply at checkout.</p>
    </div>`;
}

function renderAbout() {
  $('#pageView').innerHTML = `
    <div class="page-head"><h2><i class="bi bi-info-circle"></i> About Medi AI</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back to chat</button></div>
    <div class="panel">
      <h3>Your multilingual health companion</h3>
      <div class="md">
        <p>Medi AI helps you understand health questions and medical reports in simple language, in <b>50+ languages</b> — all 22 official Indian languages included.</p>
        <p>It combines <b>10 AI engines</b> with a curated medical knowledge base, automatically falls back if one engine is busy, and detects emergencies.</p>
        <p><b>Features:</b> medical chat, Report Lens (photo → explanation), voice input, saved reports, plans & credits, coupons, dashboard, admin tools and a WhatsApp bot.</p>
        <p><b>Important:</b> Medi AI provides general information, not a medical diagnosis. In an emergency, call <b>112</b> (India) or your local emergency number.</p>
      </div>
    </div>`;
}

function renderProblem() {
  $('#pageView').innerHTML = `
    <div class="page-head"><h2><i class="bi bi-exclamation-triangle"></i> Report a problem</h2>
      <button class="btn-gold small" id="pageCloseBtn">Back to chat</button></div>
    <div class="panel">
      <form id="problemForm">
        <label>Subject</label>
        <input id="probSubject" type="text" placeholder="e.g. Voice input not working" required maxlength="120">
        <label>What happened?</label>
        <textarea id="probMessage" rows="6" placeholder="Describe the problem — what you did, what you expected, what happened instead." required maxlength="4000"></textarea>
        <button class="btn-gold" type="submit">Send report</button>
      </form>
    </div>`;
}

/* ---------- payments (Razorpay) ---------- */
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function buyPlan(plan) {
  const coupon = ($('#couponInput') || {}).value || '';
  try {
    const r = await api('/api/payment/create-order', { method: 'POST', body: { plan, coupon } });
    if (!window.Razorpay) {
      try { await loadScript('https://checkout.razorpay.com/v1/checkout.js'); }
      catch (_) { return toast('Could not load the payment window. Check your connection.'); }
    }
    const rzp = new window.Razorpay({
      key: r.keyId,
      amount: r.amount,
      currency: r.currency,
      order_id: r.orderId,
      name: 'Medi AI',
      description: 'Plan upgrade',
      theme: { color: '#d4af37' },
      prefill: { name: state.user.username },
      handler: async (resp) => {
        try {
          const v = await api('/api/payment/verify', {
            method: 'POST',
            body: {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
              plan,
            },
          });
          state.user = v.user;
          updateCredits(v.user.credits);
          $('#planPill').textContent = v.user.planLabel;
          toast('Payment successful! Welcome to ' + (v.user.planLabel || plan) + '.');
          renderPricing();
        } catch (e) { toast(e.message); }
      },
    });
    rzp.on('payment.failed', () => toast('Payment failed or was cancelled — you were not charged.'));
    rzp.open();
  } catch (e) { toast(e.message); }
}

/* ---------- page events (delegated) ---------- */
$('#pageView').addEventListener('click', async (e) => {
  if (e.target.closest('#pageCloseBtn')) return closePage();
  const chat = e.target.closest('[data-chat]');
  if (chat) { closePage(); openChat(Number(chat.dataset.chat)); return; }
  const rep = e.target.closest('[data-report]');
  if (rep) { openReport(Number(rep.dataset.report)); return; }
  const del = e.target.closest('[data-delreport]');
  if (del) {
    if (!confirm('Delete this report?')) return;
    try { await api('/api/reports/' + del.dataset.delreport, { method: 'DELETE' }); toast('Report deleted'); renderReports(); }
    catch (err) { toast(err.message); }
    return;
  }
  const buy = e.target.closest('[data-buy]');
  if (buy) { buyPlan(buy.dataset.buy); return; }
  if (e.target.closest('#couponBtn')) {
    const code = ($('#couponInput') || {}).value.trim();
    if (!code) return toast('Enter a coupon code first');
    try {
      const r = await api('/api/coupon/redeem', { method: 'POST', body: { code } });
      if (r.credits != null) { state.user.credits = r.credits; updateCredits(r.credits); }
      $('#couponMsg').textContent = r.message || '';
      toast(r.message || 'Coupon applied');
    } catch (err) { toast(err.message); }
  }
});

$('#pageView').addEventListener('submit', async (e) => {
  if (e.target.id === 'problemForm') {
    e.preventDefault();
    try {
      const r = await api('/api/report-problem', {
        method: 'POST',
        body: { subject: $('#probSubject').value, message: $('#probMessage').value },
      });
      toast(r.message || 'Sent — thank you!');
      renderProblem();
    } catch (err) { toast(err.message); }
  }
});

/* ---------- sidebar nav ---------- */
$$('.nav-link').forEach((b) => b.addEventListener('click', () => openPage(b.dataset.page)));
$('#newChatBtn').addEventListener('click', () => closePage());
$('#chatList').addEventListener('click', (e) => { if (e.target.closest('button')) closePage(); });

/* ==================== ADMIN: knowledge, coupons, problems, status ==================== */
async function loadAdminKnowledge() {
  const box = $('#adminKnowledge');
  box.innerHTML = 'Loading…';
  try {
    const r = await api('/api/admin/knowledge');
    box.innerHTML = `
      <form id="kbForm" class="admin-form">
        <input id="kbTopic" placeholder="Topic (e.g. Asthma)" required maxlength="120">
        <input id="kbSymptoms" placeholder="Symptoms (comma separated)" required maxlength="400">
        <select id="kbSeverity">
          <option value="self-care">Self-care</option>
          <option value="see-doctor">See doctor</option>
          <option value="emergency">Emergency</option>
        </select>
        <textarea id="kbSummary" rows="2" placeholder="Summary" required maxlength="800"></textarea>
        <textarea id="kbAdvice" rows="2" placeholder="Advice" required maxlength="800"></textarea>
        <button class="btn-gold small" type="submit">Add topic</button>
      </form>
      <div class="admin-list">
        ${r.topics.map((t) => `
          <div class="admin-row">
            <div><b>${esc(t.topic)}</b> <span class="sev-pill ${esc(t.severity)}">${esc(t.severity)}</span><br>
            <small>${esc(String(t.symptoms).slice(0, 100))}</small></div>
            <button class="icon-btn danger" data-delkb="${t.id}" title="Delete"><i class="bi bi-trash"></i></button>
          </div>`).join('')}
      </div>`;
  } catch (e) { box.innerHTML = '<p class="modal-hint">' + esc(e.message) + '</p>'; }
}

async function loadAdminCoupons() {
  const box = $('#adminCoupons');
  box.innerHTML = 'Loading…';
  try {
    const r = await api('/api/admin/coupons');
    box.innerHTML = `
      <form id="couponForm" class="admin-form">
        <input id="cpCode" placeholder="Coupon code (e.g. WELCOME50)" required maxlength="40">
        <input id="cpPercent" type="number" min="0" max="90" placeholder="% off at checkout (0–90)">
        <input id="cpCredits" type="number" min="0" placeholder="Instant credits (optional)">
        <button class="btn-gold small" type="submit">Create coupon</button>
      </form>
      <div class="admin-list">
        ${r.coupons.length ? r.coupons.map((c) => `
          <div class="admin-row">
            <div><b>${esc(c.code)}</b><br><small>${c.percent_off ? c.percent_off + '% off at checkout' : ''}${c.credits ? (c.percent_off ? ' · ' : '') + '+' + c.credits + ' credits' : ''}</small></div>
            <button class="icon-btn danger" data-delcoupon="${c.id}" title="Delete"><i class="bi bi-trash"></i></button>
          </div>`).join('') : '<p class="modal-hint">No coupons yet. Create one to reward your users!</p>'}
      </div>`;
  } catch (e) { box.innerHTML = '<p class="modal-hint">' + esc(e.message) + '</p>'; }
}

async function loadAdminProblems() {
  const box = $('#adminProblems');
  box.innerHTML = 'Loading…';
  try {
    const r = await api('/api/admin/problems');
    box.innerHTML = r.problems.length ? `
      <div class="admin-list">
        ${r.problems.map((p) => `
          <div class="admin-row">
            <div><b>${esc(p.subject)}</b> <span class="sev-pill ${p.status === 'open' ? 'emergency' : 'self-care'}">${esc(p.status)}</span><br>
            <small>from ${esc(p.username || 'user')} · ${esc(p.created_at || '')}</small><br>
            <small>${esc(String(p.message).slice(0, 300))}</small></div>
            <button class="btn-gold small" data-problemclose="${p.id}">${p.status === 'open' ? 'Close' : 'Reopen'}</button>
          </div>`).join('')}
      </div>` : '<p class="modal-hint">No problem reports. 🎉</p>';
  } catch (e) { box.innerHTML = '<p class="modal-hint">' + esc(e.message) + '</p>'; }
}

async function loadAdminStatus() {
  const box = $('#adminStatus');
  box.innerHTML = 'Loading…';
  try {
    const s = await api('/api/admin/sync-status');
    const mins = Math.floor(s.uptime / 60);
    box.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><i class="bi bi-clock"></i><b>${mins}m</b><span>Server uptime</span></div>
        <div class="stat-card"><i class="bi bi-people"></i><b>${s.users}</b><span>Users</span></div>
        <div class="stat-card"><i class="bi bi-book-heart"></i><b>${s.knowledge}</b><span>KB topics</span></div>
        <div class="stat-card"><i class="bi bi-cpu"></i><b>${s.providers.length}</b><span>AI engines</span></div>
      </div>
      <p class="modal-hint">Payments (Razorpay): ${s.payments ? 'configured ✅' : 'not configured'} · WhatsApp bot: ${s.whatsapp ? 'configured ✅' : 'not configured'}</p>`;
  } catch (e) { box.innerHTML = '<p class="modal-hint">' + esc(e.message) + '</p>'; }
}

/* admin tab switching */
$$('.admin-tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.admin-tab').forEach((t) => t.classList.toggle('active', t === tab));
  $$('.admin-pane').forEach((p) => p.classList.add('hidden'));
  const panes = { users: '#adminUsers', knowledge: '#adminKnowledge', coupons: '#adminCoupons', problems: '#adminProblems', status: '#adminStatus' };
  $(panes[tab.dataset.tab]).classList.remove('hidden');
  if (tab.dataset.tab === 'knowledge') loadAdminKnowledge();
  if (tab.dataset.tab === 'coupons') loadAdminCoupons();
  if (tab.dataset.tab === 'problems') loadAdminProblems();
  if (tab.dataset.tab === 'status') loadAdminStatus();
}));

/* admin forms + deletes (delegated) */
$('#adminModal').addEventListener('submit', async (e) => {
  if (e.target.id === 'kbForm') {
    e.preventDefault();
    try {
      await api('/api/admin/knowledge', {
        method: 'POST',
        body: {
          topic: $('#kbTopic').value, symptoms: $('#kbSymptoms').value,
          summary: $('#kbSummary').value, advice: $('#kbAdvice').value,
          severity: $('#kbSeverity').value,
        },
      });
      toast('Topic added to knowledge base');
      loadAdminKnowledge();
    } catch (err) { toast(err.message); }
  }
  if (e.target.id === 'couponForm') {
    e.preventDefault();
    try {
      await api('/api/admin/coupons', {
        method: 'POST',
        body: { code: $('#cpCode').value, percentOff: Number($('#cpPercent').value) || 0, credits: Number($('#cpCredits').value) || 0 },
      });
      toast('Coupon created');
      loadAdminCoupons();
    } catch (err) { toast(err.message); }
  }
});

$('#adminModal').addEventListener('click', async (e) => {
  const delkb = e.target.closest('[data-delkb]');
  if (delkb) {
    if (!confirm('Delete this knowledge topic?')) return;
    try { await api('/api/admin/knowledge/' + delkb.dataset.delkb, { method: 'DELETE' }); toast('Topic deleted'); loadAdminKnowledge(); }
    catch (err) { toast(err.message); }
    return;
  }
  const delcp = e.target.closest('[data-delcoupon]');
  if (delcp) {
    if (!confirm('Delete this coupon?')) return;
    try { await api('/api/admin/coupons/' + delcp.dataset.delcoupon, { method: 'DELETE' }); toast('Coupon deleted'); loadAdminCoupons(); }
    catch (err) { toast(err.message); }
    return;
  }
  const pc = e.target.closest('[data-problemclose]');
  if (pc) {
    try { await api('/api/admin/problems/' + pc.dataset.problemclose, { method: 'POST', body: { status: 'closed' } }); loadAdminProblems(); }
    catch (err) { toast(err.message); }
  }
});
