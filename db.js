/**
 * Medi AI — database layer (PostgreSQL)
 * Works with any Postgres: Neon (recommended, free), Supabase, Railway…
 * Set DATABASE_URL in the environment. All data survives redeploys.
 */
'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

/* Neon and other hosted Postgres require SSL; local test servers can opt out
   with sslmode=disable in the URL. */
const NEEDS_SSL = !!process.env.DATABASE_URL && !/sslmode=disable/i.test(process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: NEEDS_SSL ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

async function q(text, params) { const r = await pool.query(text, params || []); return r.rows; }
async function q1(text, params) { const r = await pool.query(text, params || []); return r.rows[0] || null; }

/* ------------------------------ plans ------------------------------
   free : 5 credits refreshed every 14 days, 2 engines per answer
   plus : ₹49 one-time 15 credits (10+5), 3 engines, no renewal
   plus2: ₹99 one-time 32 credits (20+12), 4 engines, no renewal
   pro  : ₹799  — 30 credits refilled weekly for 4 weeks, all engines
   pro2 : ₹1999 — 79 credits refilled weekly for 4 weeks, all engines
   elite: ₹4999 — 100 credits refilled weekly for 1 year, all engines */
const PLANS = {
  free:  { label: 'Free',    credits: 5,   priceInr: 0,    engines: 2,  renewDays: 14 },
  plus:  { label: 'Plus',    credits: 15,  priceInr: 49,   engines: 3,  bonus: '10 + 5 bonus credits' },
  plus2: { label: 'Plus+',   credits: 32,  priceInr: 99,   engines: 4,  bonus: '20 + 12 bonus credits' },
  pro:   { label: 'Pro',     credits: 30,  priceInr: 799,  engines: 10, renewDays: 7, weeks: 4 },
  pro2:  { label: 'Pro+',    credits: 79,  priceInr: 1999, engines: 10, renewDays: 7, weeks: 4 },
  elite: { label: 'Elite',   credits: 100, priceInr: 4999, engines: 10, renewDays: 7, weeks: 52 },
  /* Hidden 1-rupee plan: visible only to admins on the Pricing page,
     used to verify live payments cheaply before launching. */
  test:  { label: 'Test',    credits: 1,   priceInr: 1,    engines: 2,  hidden: true },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  passhash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 5,
  language TEXT NOT NULL DEFAULT 'en-IN',
  provider TEXT DEFAULT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  plan_expires BIGINT,
  last_refill BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uname_ci ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci ON users (LOWER(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msgs_chat ON messages(chat_id);
CREATE TABLE IF NOT EXISTS kb (
  id SERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  symptoms TEXT NOT NULL,
  summary TEXT NOT NULL,
  advice TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'self-care'
);
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  extracted TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  percent_off INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code_ci ON coupons (LOWER(code));
CREATE TABLE IF NOT EXISTS problems (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  coupon TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  razorpay_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/* ------------------------------------------------------------------ */
/* Medical knowledge base seed — general public-health information.   */
/* Not a substitute for professional diagnosis.                        */
/* severity: self-care | see-doctor | emergency                        */
/* ------------------------------------------------------------------ */
const KB_SEED = [
  ['Fever (high temperature)', 'fever temperature hot forehead chills sweating', 'Fever means body temperature above 38 C (100.4 F), usually fighting an infection. Most fevers settle in 3-5 days.', 'Rest, drink plenty of fluids, paracetamol as per label. See a doctor if fever lasts over 3 days, is above 39.5 C, or comes with rash, stiff neck, breathlessness or confusion.', 'self-care'],
  ['Common cold', 'cold runny nose sneezing sore throat blocked nose cough', 'A viral infection of nose and throat lasting about a week. Antibiotics do NOT help.', 'Fluids, rest, steam inhalation, salt-water gargles. See a doctor if symptoms last beyond 10 days or breathing becomes difficult.', 'self-care'],
  ['Influenza (flu)', 'flu body ache fever headache tiredness chills muscle pain', 'Influenza is a viral illness with sudden fever, severe body aches and exhaustion; usually improves in 5-7 days.', 'Rest, fluids, paracetamol for aches. High-risk patients (elderly, pregnant, asthma, diabetes) should see a doctor early for antiviral assessment.', 'see-doctor'],
  ['COVID-19', 'covid coronavirus loss of smell taste fever cough breathlessness sore throat', 'COVID-19 is a respiratory viral infection; symptoms vary from mild cold to severe pneumonia.', 'Isolate, rest, monitor oxygen with a pulse oximeter if available. Seek urgent care if oxygen drops below 94%, or chest pain / blue lips appear.', 'see-doctor'],
  ['Dengue fever', 'dengue fever rash body ache joint pain eye pain headache platelets mosquito', 'Dengue is spread by Aedes mosquito bites; causes high fever, severe body and joint pain, sometimes rash after fever settles.', 'Hydration is critical. Avoid NSAIDs like ibuprofen/aspirin — use paracetamol only. Get a platelet count check. Go to hospital if bleeding gums, black stools, severe abdominal pain or drowsiness.', 'emergency'],
  ['Malaria', 'malaria fever shivering chills sweating headache vomiting mosquito', 'Malaria causes cyclical fever with shaking chills and heavy sweating, spread by Anopheles mosquitoes.', 'Needs a blood test (RDT or smear) and prescription medicine urgently. Do not self-treat. Go the same day.', 'emergency'],
  ['Typhoid', 'typhoid fever abdominal pain constipation diarrhea weakness continuous fever', 'Typhoid spreads through contaminated food/water; causes step-ladder rising fever over days with abdominal discomfort.', 'See a doctor for blood test and antibiotics. Rest, soft diet, hydration. Hospital if severe vomiting or delirium.', 'see-doctor'],
  ['Chest pain (possible heart attack)', 'chest pain heart attack left arm pain sweating pressure tightness palpitation', 'Chest pain with pressure, sweating, radiating to arm/jaw/back may be a heart attack — treat every minute as critical.', 'Call emergency services (112 in India) NOW. Chew one aspirin 300mg unless allergic or told otherwise. Do not drive yourself.', 'emergency'],
  ['Stroke (brain attack)', 'stroke face drooping arm weakness slurred speech sudden numbness vision loss balance', 'Use FAST: Face drooping, Arm weakness, Speech difficulty, Time to call emergency. Clot-busting treatment works only within hours.', 'Call 112 immediately. Note the exact time symptoms started. Do not give food, water or tablets by mouth.', 'emergency'],
  ['Severe bleeding / heavy bleeding', 'bleeding blood loss cut wound spurting deep wound', 'Heavy or spurting bleeding can become life-threatening within minutes.', 'Press hard on the wound with a clean cloth and do NOT keep peeking. Elevate the limb. Call 112. Keep pressing until help arrives.', 'emergency'],
  ['Burns (first aid)', 'burn scald hot water fire boiling skin blister burn wound', 'Cool the burn under running tap water for 20 minutes. Never apply toothpaste, ghee, oil or ice.', 'Cover loosely with clean cloth or cling film. Seek medical help for burns bigger than the person palm, on face/hands/genitals, or any deep/white/charred burn.', 'see-doctor'],
  ['Snake bite', 'snake bite viper cobra venom snakebite', 'Keep the person calm and still; movement pumps venom faster. Do NOT cut, suck, tie tight bands or apply herbs.', 'Go to the nearest hospital with anti-snake-venom immediately. Remove rings/watch. Keep bitten limb below heart level. Call 108.', 'emergency'],
  ['Seizure / fits', 'seizure fits epilepsy convulsion shaking unconscious jerking', 'Most seizures stop on their own in 1-2 minutes. Protect, do not restrain.', 'Clear sharp objects, cushion the head, turn to side after jerking stops, time it. Call an ambulance if it lasts over 5 minutes, repeats, or it is the first-ever seizure.', 'emergency'],
  ['Poisoning / overdose', 'poison swallowed chemicals tablets overdose medicine swallowed', 'Swallowed poison needs immediate hospital care.', 'Call 112 / poison control. Do NOT make the person vomit unless instructed. Carry the container/strip to hospital.', 'emergency'],
  ['Breathlessness / difficulty breathing', 'breathless breathing difficulty shortness of breath asthma attack wheeze gasping', 'Sudden or severe difficulty breathing is an emergency sign whatever the cause.', 'Sit upright, loosen clothes, use prescribed inhaler (puffs). Call 112 if lips/face turn blue, speech broken, or it worsens fast.', 'emergency'],
  ['Asthma', 'asthma wheeze inhaler night cough chest tightness allergy', 'Asthma narrows airways causing wheeze and cough, often triggered by dust, cold or pollen.', 'Use the reliever inhaler as prescribed. Avoid triggers. See a doctor for a written action plan; urgent care if inhaler is not helping.', 'see-doctor'],
  ['Headache / migraine', 'headache migraine head pain one sided nausea light sensitivity aura', 'Most headaches are tension or migraine. Migraines are often one-sided with nausea and light sensitivity.', 'Dark quiet room, hydrate, paracetamol early. See a doctor for sudden worst-ever headache, headache with fever + stiff neck, weakness or vision loss — these are emergencies.', 'self-care'],
  ['Food poisoning', 'food poisoning vomiting diarrhea stomach cramps loose motion eaten bad food', 'Vomiting and diarrhoea within hours of suspect food; usually settles in 1-3 days.', 'Oral rehydration salts (ORS) after every loose stool. Small sips of water. See a doctor if blood in stool, no urine for 8+ hours, or high fever.', 'self-care'],
  ['Acidity / GERD', 'acidity heartburn reflux burning chest sour burp gas gastritis', 'Stomach acid moving up causes burning behind the breastbone, worse lying down or after spicy/fatty meals.', 'Smaller meals, avoid lying down for 2-3 hours after eating, cut tea/coffee/alcohol/spicy food at night. Doctor if pain radiates to arm/jaw (rule out heart), or difficulty swallowing.', 'self-care'],
  ['Type 2 diabetes basics', 'diabetes sugar blood glucose thirst urination weight loss tingling feet', 'Diabetes means persistently high blood sugar; classic signs are excess thirst, frequent urination, fatigue.', 'Needs doctor-diagnosed control: diet, exercise, medicines as prescribed. Regular HbA1c checks. Urgent care for very high sugar with vomiting, confusion or fruity breath.', 'see-doctor'],
  ['High blood pressure (hypertension)', 'blood pressure hypertension bp headache dizziness', 'Usually silent — often found on routine checks. Rarely, very high BP causes headache, nosebleeds.', 'Low salt, walk 30 min daily, medicines as prescribed. Emergency if BP with chest pain, severe headache, blurred vision or weakness.', 'see-doctor'],
  ['High cholesterol', 'cholesterol lipid fat heart risk', 'No symptoms — detected by blood test (lipid profile). Raises heart attack and stroke risk over years.', 'Cut fried food and red meat, add oats/nuts/legumes, exercise, repeat lipid profile as advised.', 'see-doctor'],
  ['Anemia (low hemoglobin)', 'anemia weakness tired pale fatigue breathless hemoglobin iron', 'Low hemoglobin reduces oxygen carrying capacity — tiredness, paleness, breathlessness on effort.', 'Iron-rich foods (greens, dates, jaggery) + vitamin C. Doctor for a blood test to find the cause; urgent if chest pain or fainting.', 'see-doctor'],
  ['Urinary tract infection (UTI)', 'uti burning urination urine infection frequent urination pain', 'Burning and urgency when passing urine, sometimes fever or back pain.', 'Drink lots of water, see a doctor for urine test and antibiotics. Emergency if fever with chills + back pain (kidney involvement).', 'see-doctor'],
  ['Kidney stones', 'kidney stone renal colic loin to groin pain blood urine', 'Severe waves of pain from the side to the groin, sometimes blood in urine.', 'Painkillers from a doctor, plenty of water, scan to confirm size. Emergency if fever with the pain or cannot pass urine.', 'see-doctor'],
  ['Thyroid disorders', 'thyroid weight gain weight loss neck swelling fatigue hair fall', 'Low thyroid = weight gain, tiredness, cold intolerance. High thyroid = weight loss, palpitations, heat intolerance.', 'Simple blood test (TSH) and daily tablet if prescribed. Follow-up tests as advised.', 'see-doctor'],
  ['Anxiety and panic', 'anxiety panic attack nervous worry racing heart fear stress', 'Panic attacks mimic heart trouble: racing heart, breathlessness, tingling — but are not dangerous and peak within 10 minutes.', 'Slow breathing (4 in, 6 out), grounding, limit caffeine. Seek help if it disrupts daily life. Chest pain that is new/severe must be checked to rule out the heart.', 'self-care'],
  ['Depression', 'depression sad hopeless sleep loss interest low mood', 'More than 2 weeks of low mood, loss of interest, sleep and appetite changes, fatigue, worthlessness.', 'Talk to someone you trust and see a doctor or counsellor — it is treatable. If there are thoughts of self-harm, seek help immediately: Tele-MANAS 14416 (India, 24x7).', 'see-doctor'],
  ['Insomnia (sleep problems)', 'insomnia cannot sleep sleep problem tired waking up', 'Difficulty falling or staying asleep for 3+ nights a week.', 'Fixed wake time, no screens 1 hour before bed, no caffeine after 2 pm, dark cool room. Doctor if it persists over a month.', 'self-care'],
  ['Back pain', 'back pain spine lower back strain slipped disc posture', 'Most back pain is muscular, improves in 1-2 weeks with gentle movement.', 'Stay active, heat packs, avoid heavy lifting. Emergency if legs are weak/numb or bladder control is lost.', 'self-care'],
  ['Knee joint pain / arthritis', 'knee pain joint pain arthritis swelling stiffness', 'Joint pain with stiffness, worse in the morning or after activity.', 'Weight control, quadriceps exercises, avoid stairs overload. Doctor for swelling with fever or after injury.', 'self-care'],
  ['Allergy / allergic reaction', 'allergy itching rash hives swelling sneezing peanut dust', 'Itchy rash, sneezing or swelling after exposure to a trigger.', 'Antihistamine tablets help mild cases. EMERGENCY (call 112) if lips/tongue swell or breathing is affected — this is anaphylaxis.', 'see-doctor'],
  ['Skin rash / eczema', 'rash eczema itching dry skin dermatitis', 'Dry itchy patches that come and go; often worsened by soaps and sweat.', 'Fragrance-free moisturizer twice daily, mild soap, short lukewarm baths. Doctor if weeping, painful or spreading.', 'self-care'],
  ['Conjunctivitis (eye flu)', 'eye flu conjunctivitis red eye sticky discharge watering', 'Red, watery, sticky eyes spreading easily by touch.', 'Do not share towels, wash hands often, cold compress. Doctor if pain, light sensitivity or vision change — never use steroid drops without a doctor.', 'see-doctor'],
  ['Dental / tooth pain', 'tooth pain dental cavity gum swelling toothache', 'Most toothache is from cavities or gum infection and needs a dentist.', 'Warm salt-water rinses, paracetamol. Avoid very hot/cold food. See a dentist — infection near the face swelling needs urgent care.', 'see-doctor'],
  ['Ear pain / ear infection', 'ear pain ear discharge ear blocked', 'Pain, blockage or discharge; common after colds (especially in children).', 'Warm compress, paracetamol. Doctor if fever, discharge or severe pain. Never put oil or sticks inside the ear.', 'see-doctor'],
  ['Jaundice / hepatitis', 'jaundice yellow eyes yellow skin dark urine hepatitis', 'Yellowing of eyes/skin with dark urine means liver inflammation, often viral hepatitis.', "See a doctor and get tested (hepatitis panel). Rest, low-fat home food, no alcohol or self-medication — many medicines harm the liver.", 'see-doctor'],
  ['Tuberculosis (TB)', 'tb cough more than two weeks night sweats weight loss tuberculosis blood in cough', 'Cough over 2-3 weeks with night sweats, weight loss, evening fever.', 'Get a chest X-ray and sputum test. TB is fully curable with the full government course (NTEP) — never stop medicines midway.', 'see-doctor'],
  ['Chickenpox', 'chickenpox itchy blisters rash fever pox varicella', 'Itchy fluid-filled blisters appearing in crops with mild fever.', 'Calamine lotion, do not scratch, isolation until crusted. Doctor if blisters are infected, or fever is high in an adult.', 'see-doctor'],
  ['Heat stroke / heat exhaustion', 'heat stroke sunstroke very hot no sweat confusion cramps', 'In extreme heat, confusion, hot dry skin or fainting means heat stroke — an emergency.', 'Move to shade, cool with wet cloths/fan, sip water. Call 112. Do not give fluids if the person is confused or unconscious.', 'emergency'],
  ['Dehydration', 'dehydration thirst dry mouth less urine dizziness', 'Dark little urine, dry mouth, dizziness — common with diarrhoea, vomiting or heat.', 'ORS or water frequently in sips. Urgent care if no urine for 8 hours, sunken eyes, or extreme drowsiness.', 'self-care'],
  ['Pregnancy basics', 'pregnancy pregnant morning sickness antenatal period missed period', 'Pregnancy needs early antenatal registration, iron-folic acid tablets and 4 ultrasound visits as advised.', 'Balanced diet, no smoking/alcohol/self-medication. Contact the doctor for bleeding, severe headache, swelling, reduced baby movements or water breaking.', 'see-doctor'],
  ['Child fever (parents guide)', 'child fever baby fever kid high temperature febrile', "In babies under 3 months ANY fever is an emergency. In older children most fevers are viral.", 'Light clothing, fluids, paracetamol syrup by weight. Emergency if under 3 months, non-stop crying, limp, rash that does not fade on pressing, or seizure.', 'see-doctor']
];

async function init() {
  await pool.query(SCHEMA);
  /* migrations for older databases */
  try { await pool.query('ALTER TABLE users ADD COLUMN email TEXT'); } catch (e) {}
  /* persistent login sessions - survive restarts and redeploys */
  await pool.query(`CREATE TABLE IF NOT EXISTS session (
    sid TEXT PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire)');
  const c = await q1('SELECT COUNT(*)::int AS c FROM kb');
  if (!c || c.c === 0) {
    for (const e of KB_SEED) {
      await pool.query('INSERT INTO kb (topic, symptoms, summary, advice, severity) VALUES ($1,$2,$3,$4,$5)', e);
    }
    console.log('[db] Seeded medical knowledge base with', KB_SEED.length, 'topics');
  }
}

/* ------------------------- users ------------------------- */
async function userCount() { const r = await q1('SELECT COUNT(*)::int AS c FROM users'); return r.c; }
async function userExists(username) { return !!(await q1('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [String(username).trim()])); }
async function emailExists(email) { return !!(await q1('SELECT 1 FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER($1)', [String(email).trim()])); }

async function createUser(username, email, password, isAdmin) {
  const hash = bcrypt.hashSync(String(password), 10);
  const rows = await q(
    'INSERT INTO users (username, email, passhash, plan, credits, is_admin, last_refill) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [String(username).trim(), email ? String(email).trim().toLowerCase() : null, hash, 'free', PLANS.free.credits, !!isAdmin, Math.floor(Date.now() / 1000)]
  );
  return rows[0];
}

async function getUserByUsername(username) {
  return q1('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [String(username).trim()]);
}
async function getUserByEmail(email) {
  return q1('SELECT * FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER($1)', [String(email).trim()]);
}
/* login by email OR username */
async function getUserByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  return (await getUserByEmail(id)) || (await getUserByUsername(id));
}

async function getUser(id) {
  const u = await q1('SELECT * FROM users WHERE id = $1', [id]);
  return applyPlanCycle(u);
}

function verifyPassword(user, password) { return bcrypt.compareSync(String(password), user.passhash); }

async function deductCredits(id, amount) {
  const r = await q1('UPDATE users SET credits = credits - $1 WHERE id = $2 AND credits >= $1 RETURNING credits', [amount, id]);
  if (r) return r.credits;
  const u = await q1('SELECT credits FROM users WHERE id = $1', [id]);
  return u ? u.credits : 0;
}

async function setPlan(id, plan, credits, expiresAt, lastRefill) {
  const cur = (await q1('SELECT * FROM users WHERE id = $1', [id])) || {};
  await pool.query(
    'UPDATE users SET plan = $1, credits = $2, plan_expires = $3, last_refill = $4 WHERE id = $5',
    [
      plan,
      credits,
      expiresAt === undefined ? (cur.plan_expires || null) : (expiresAt || null),
      lastRefill === undefined ? (cur.last_refill || null) : (lastRefill || null),
      id,
    ]
  );
  return q1('SELECT * FROM users WHERE id = $1', [id]);
}

async function setPrefs(id, language, provider) {
  await pool.query('UPDATE users SET language = $1, provider = $2 WHERE id = $3', [language, provider, id]);
  return q1('SELECT * FROM users WHERE id = $1', [id]);
}

async function listUsersAdmin() {
  return q('SELECT id, username, email, plan, credits, is_admin, to_char(created_at, \'YYYY-MM-DD\') AS created_at FROM users ORDER BY id DESC LIMIT 200');
}

/* ------------------------- plan cycle (renewals) -------------------------
   Called on every getUser: expires finished subscriptions and tops up
   credits on schedule (weekly for paid Pro tiers, fortnightly for Free). */
async function applyPlanCycle(u) {
  if (!u) return u;
  const now = Math.floor(Date.now() / 1000);
  let plan = u.plan, credits = u.credits;
  let last = u.last_refill || now;
  let expires = u.plan_expires || 0;
  let dirty = false;
  if (expires && now > expires) {
    plan = 'free'; expires = 0; last = now; dirty = true;
  }
  const p = PLANS[plan] || PLANS.free;
  if (p.renewDays) {
    const period = p.renewDays * 86400;
    if (now - last >= period) {
      const cycles = Math.floor((now - last) / period);
      last += cycles * period;
      if (credits < p.credits) credits = p.credits;
      dirty = true;
    }
  }
  if (!dirty) return u;
  await pool.query('UPDATE users SET plan = $1, credits = $2, last_refill = $3, plan_expires = $4 WHERE id = $5',
    [plan, credits, last, expires || null, u.id]);
  return Object.assign({}, u, { plan, credits, last_refill: last, plan_expires: expires || null });
}

/* ------------------------- chats ------------------------- */
async function listChats(userId) {
  return q("SELECT id, title, mode, to_char(updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100", [userId]);
}
async function getChat(id, userId) {
  return q1('SELECT * FROM chats WHERE id = $1 AND user_id = $2', [id, userId]);
}
async function createChat(userId, title, mode) {
  const rows = await q(
    "INSERT INTO chats (user_id, title, mode) VALUES ($1,$2,$3) RETURNING *, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at",
    [userId, String(title).slice(0, 60) || 'New chat', mode || 'chat']
  );
  return rows[0];
}
async function getMessages(chatId) {
  return q('SELECT role, content FROM messages WHERE chat_id = $1 ORDER BY id ASC', [chatId]);
}
async function getRecentMessages(chatId, limit) {
  return q('SELECT role, content FROM (SELECT * FROM messages WHERE chat_id = $1 ORDER BY id DESC LIMIT $2) t ORDER BY id ASC', [chatId, limit]);
}
async function addMessage(chatId, role, content) {
  const r = await q1('INSERT INTO messages (chat_id, role, content) VALUES ($1,$2,$3) RETURNING id', [chatId, role, content]);
  return r ? r.id : null;
}
async function touchChat(chatId) { await pool.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]); }
async function deleteChat(id, userId) {
  const chat = await getChat(id, userId);
  if (!chat) return false;
  await pool.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [id, userId]); // messages cascade
  return true;
}

/* ------------------------- knowledge base ------------------------- */
async function searchKB(text, limit = 3) {
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const seen = new Map();
  for (const w of words) {
    const hits = await q(
      'SELECT * FROM kb WHERE topic ILIKE $1 OR symptoms ILIKE $1 OR summary ILIKE $1 LIMIT 4',
      ['%' + w + '%']
    );
    for (const h of hits) {
      if (!seen.has(h.id)) seen.set(h.id, { row: h, score: 0 });
      seen.get(h.id).score += 1;
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.row);
}

/* ------------------------- reports ------------------------- */
async function listReports(userId) {
  return q("SELECT id, title, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at FROM reports WHERE user_id = $1 ORDER BY id DESC LIMIT 100", [userId]);
}
async function getReport(id, userId) {
  return q1("SELECT *, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at FROM reports WHERE id = $1 AND user_id = $2", [id, userId]);
}
async function createReport(userId, title, extracted, analysis) {
  const rows = await q(
    "INSERT INTO reports (user_id, title, extracted, analysis) VALUES ($1,$2,$3,$4) RETURNING *, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at",
    [userId, String(title).slice(0, 80), extracted, analysis]
  );
  return rows[0];
}
async function deleteReport(id, userId) {
  const r = await q1('DELETE FROM reports WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  return !!r;
}

/* ------------------------- coupons ------------------------- */
async function findCoupon(code) {
  return q1('SELECT * FROM coupons WHERE LOWER(code) = LOWER($1) AND active = TRUE', [String(code || '').trim()]);
}
async function listCoupons() {
  return q("SELECT *, to_char(created_at, 'YYYY-MM-DD') AS created_at FROM coupons ORDER BY id DESC LIMIT 200");
}
async function createCoupon(code, percentOff, credits) {
  try {
    await pool.query('INSERT INTO coupons (code, percent_off, credits) VALUES ($1,$2,$3)',
      [String(code).trim().toUpperCase(), Math.max(0, Math.min(90, percentOff | 0)), Math.max(0, credits | 0)]);
    return true;
  } catch (e) { return false; }
}
async function deleteCoupon(id) {
  const r = await q1('DELETE FROM coupons WHERE id = $1 RETURNING id', [id]);
  return !!r;
}

/* ------------------------- problems ------------------------- */
async function createProblem(userId, subject, message) {
  const r = await q1('INSERT INTO problems (user_id, subject, message) VALUES ($1,$2,$3) RETURNING id',
    [userId, String(subject).slice(0, 120), String(message).slice(0, 4000)]);
  return !!r;
}
async function listProblems() {
  return q("SELECT p.*, u.username, to_char(p.created_at, 'YYYY-MM-DD') AS created_at FROM problems p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 200");
}
async function setProblemStatus(id, status) {
  const r = await q1('UPDATE problems SET status = $1 WHERE id = $2 RETURNING id', [status, id]);
  return !!r;
}

/* ------------------------- orders ------------------------- */
async function createOrder(userId, plan, amount, coupon, rzpId) {
  const r = await q1('INSERT INTO orders (user_id, plan, amount, coupon, razorpay_order_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [userId, plan, amount, coupon || null, rzpId || null]);
  return r ? r.id : null;
}
async function getOrderByRzp(rzpId) {
  return q1('SELECT * FROM orders WHERE razorpay_order_id = $1', [rzpId]);
}
async function setOrderStatus(id, status) {
  const r = await q1('UPDATE orders SET status = $1 WHERE id = $2 RETURNING id', [status, id]);
  return !!r;
}

/* ------------------------- stats ------------------------- */
async function userStats(userId) {
  const [a, b, c, d] = await Promise.all([
    q1('SELECT COUNT(*)::int AS c FROM chats WHERE user_id = $1', [userId]),
    q1('SELECT COUNT(*)::int AS c FROM reports WHERE user_id = $1', [userId]),
    q1('SELECT COUNT(*)::int AS c FROM problems WHERE user_id = $1', [userId]),
    q1("SELECT to_char(created_at, 'YYYY-MM-DD') AS created_at FROM users WHERE id = $1", [userId]),
  ]);
  return { chats: a.c, reports: b.c, problems: c.c, memberSince: d ? d.created_at : null };
}

/* ------------------------- knowledge base (admin) ------------------------- */
async function listKB() { return q('SELECT * FROM kb ORDER BY id DESC LIMIT 500'); }
async function addKB(topic, symptoms, summary, advice, severity) {
  const r = await q1('INSERT INTO kb (topic, symptoms, summary, advice, severity) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [String(topic).slice(0, 120), String(symptoms).slice(0, 400), String(summary).slice(0, 800), String(advice).slice(0, 800), severity]);
  return !!r;
}
async function deleteKB(id) {
  const r = await q1('DELETE FROM kb WHERE id = $1 RETURNING id', [id]);
  return !!r;
}

module.exports = {
  pool, PLANS, init,
  userCount, userExists, emailExists, createUser, getUserByUsername, getUserByEmail, getUserByIdentifier, getUser, verifyPassword,
  deductCredits, setPlan, setPrefs, listUsersAdmin,
  listChats, getChat, createChat, getMessages, getRecentMessages, addMessage, touchChat, deleteChat,
  searchKB, listKB, addKB, deleteKB,
  listReports, getReport, createReport, deleteReport,
  findCoupon, listCoupons, createCoupon, deleteCoupon,
  createProblem, listProblems, setProblemStatus,
  createOrder, getOrderByRzp, setOrderStatus,
  userStats,
};
