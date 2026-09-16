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
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
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
