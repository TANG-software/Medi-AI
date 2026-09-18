/**
 * Medi AI — database layer (SQLite)
 * Users, chats, messages, and a seeded medical knowledge base used
 * to ground AI answers with verified context.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'medi.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  passhash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  credits INTEGER NOT NULL DEFAULT 50,
  language TEXT NOT NULL DEFAULT 'en-IN',
  provider TEXT DEFAULT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_chat ON messages(chat_id, id ASC);
CREATE TABLE IF NOT EXISTS kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  symptoms TEXT NOT NULL,
  summary TEXT NOT NULL,
  advice TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'self-care'
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  extracted TEXT NOT NULL,
  analysis TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, id DESC);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL COLLATE NOCASE,
  percent_off INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,
  amount INTEGER NOT NULL,
  coupon TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  razorpay_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

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

const count = db.prepare('SELECT COUNT(*) AS c FROM kb').get().c;
if (count === 0) {
  const ins = db.prepare('INSERT INTO kb (topic, symptoms, summary, advice, severity) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => { for (const e of KB_SEED) ins.run(e[0], e[1], e[2], e[3], e[4]); });
  tx();
  console.log('[db] Seeded medical knowledge base with', KB_SEED.length, 'topics');
}

/* ------------------------- users ------------------------- */
const qUsers = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byName: db.prepare('SELECT * FROM users WHERE username = ?'),
  count: db.prepare('SELECT COUNT(*) AS c FROM users'),
  insert: db.prepare("INSERT INTO users (username, passhash, plan, credits, is_admin) VALUES (?,?,?,?,?)"),
  credits: db.prepare('UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?'),
  setPlan: db.prepare('UPDATE users SET plan = ?, credits = ? WHERE id = ?'),
  setPrefs: db.prepare('UPDATE users SET language = ?, provider = ? WHERE id = ?'),
};

function userCount() { return qUsers.count.get().c; }
function userExists(username) { return !!qUsers.byName.get(String(username).trim()); }
function createUser(username, password, isAdmin) {
  const hash = bcrypt.hashSync(String(password), 10);
  const plan = 'free', credits = 50;
  const info = qUsers.insert.run(String(username).trim(), hash, plan, credits, isAdmin ? 1 : 0);
  return qUsers.byId.get(info.lastInsertRowid);
}
function getUserByUsername(username) { return qUsers.byName.get(String(username).trim()) || null; }
function getUser(id) { return qUsers.byId.get(id) || null; }
function verifyPassword(user, password) { return bcrypt.compareSync(String(password), user.passhash); }
function deductCredits(id, amount) {
  qUsers.credits.run(amount, id, amount);
  return qUsers.byId.get(id).credits;
}
function setPlan(id, plan, credits) { qUsers.setPlan.run(plan, credits, id); return qUsers.byId.get(id); }
function setPrefs(id, language, provider) { qUsers.setPrefs.run(language, provider, id); return qUsers.byId.get(id); }

/* ------------------------- chats ------------------------- */
const qChats = {
  list: db.prepare('SELECT id, title, mode, updated_at FROM chats WHERE user_id = ? ORDER BY datetime(updated_at) DESC LIMIT 100'),
  get: db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?'),
  create: db.prepare("INSERT INTO chats (user_id, title, mode) VALUES (?,?,?)"),
  touch: db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?"),
  rename: db.prepare('UPDATE chats SET title = ? WHERE id = ? AND user_id = ?'),
  del: db.prepare('DELETE FROM chats WHERE id = ? AND user_id = ?'),
};
const qMsgs = {
  list: db.prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC'),
  last: db.prepare('SELECT role, content FROM (SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC'),
  add: db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?,?,?)'),
  clear: db.prepare('DELETE FROM messages WHERE chat_id = ?'),
};
const delMsgsByChat = db.prepare('DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE user_id = ?)');

function listChats(userId) { return qChats.list.all(userId); }
function getChat(id, userId) { return qChats.get.get(id, userId) || null; }
function createChat(userId, title, mode) {
  const info = qChats.create.run(userId, title.slice(0, 60) || 'New chat', mode || 'chat');
  return qChats.get.get(info.lastInsertRowid, userId);
}
function getMessages(chatId) { return qMsgs.list.all(chatId); }
function getRecentMessages(chatId, limit) { return qMsgs.last.all(chatId, limit); }
function addMessage(chatId, role, content) { return qMsgs.add.run(chatId, role, content); }
function touchChat(chatId) { qChats.touch.run(chatId); }
function renameChat(id, userId, title) { qChats.rename.run(title.slice(0, 60), id, userId); }
function deleteChat(id, userId) {
  const chat = getChat(id, userId);
  if (!chat) return false;
  qMsgs.clear.run(id);
  qChats.del.run(id, userId);
  return true;
}

/* ------------------------- knowledge base ------------------------- */
function searchKB(text, limit = 3) {
  const words = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return [];
  const seen = new Map();
  for (const w of words) {
    const hits = db.prepare(
      "SELECT * FROM kb WHERE topic LIKE ? OR symptoms LIKE ? OR summary LIKE ? LIMIT 4"
    ).all(`%${w}%`, `%${w}%`, `%${w}%`);
    for (const h of hits) {
      if (!seen.has(h.id)) seen.set(h.id, { row: h, score: 0 });
      seen.get(h.id).score += 1;
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.row);
}

/* ------------------------- reports ------------------------- */
const qReports = {
  list: db.prepare('SELECT id, title, created_at FROM reports WHERE user_id = ? ORDER BY id DESC LIMIT 100'),
  get: db.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?'),
  create: db.prepare('INSERT INTO reports (user_id, title, extracted, analysis) VALUES (?,?,?,?)'),
  del: db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?'),
  count: db.prepare('SELECT COUNT(*) AS c FROM reports WHERE user_id = ?'),
};
function listReports(userId) { return qReports.list.all(userId); }
function getReport(id, userId) { return qReports.get.get(id, userId) || null; }
function createReport(userId, title, extracted, analysis) {
  const info = qReports.create.run(userId, String(title).slice(0, 80), extracted, analysis);
  return qReports.get.get(info.lastInsertRowid, userId);
}
function deleteReport(id, userId) { return !!qReports.del.run(id, userId).changes; }

/* ------------------------- coupons ------------------------- */
const qCoupons = {
  find: db.prepare('SELECT * FROM coupons WHERE code = ? AND active = 1'),
  list: db.prepare('SELECT * FROM coupons ORDER BY id DESC LIMIT 200'),
  create: db.prepare('INSERT INTO coupons (code, percent_off, credits) VALUES (?,?,?)'),
  del: db.prepare('DELETE FROM coupons WHERE id = ?'),
};
function findCoupon(code) { return qCoupons.find.get(String(code || '').trim()) || null; }
function listCoupons() { return qCoupons.list.all(); }
function createCoupon(code, percentOff, credits) {
  try { qCoupons.create.run(String(code).trim().toUpperCase(), Math.max(0, Math.min(90, percentOff | 0)), Math.max(0, credits | 0)); return true; }
  catch (e) { return false; }
}
function deleteCoupon(id) { return !!qCoupons.del.run(id).changes; }

/* ------------------------- problems ------------------------- */
const qProblems = {
  create: db.prepare('INSERT INTO problems (user_id, subject, message) VALUES (?,?,?)'),
  list: db.prepare('SELECT p.*, u.username FROM problems p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 200'),
  setStatus: db.prepare('UPDATE problems SET status = ? WHERE id = ?'),
};
function createProblem(userId, subject, message) { return !!qProblems.create.run(userId, String(subject).slice(0, 120), String(message).slice(0, 4000)).changes; }
function listProblems() { return qProblems.list.all(); }
function setProblemStatus(id, status) { return !!qProblems.setStatus.run(status, id).changes; }

/* ------------------------- orders ------------------------- */
const qOrders = {
  create: db.prepare('INSERT INTO orders (user_id, plan, amount, coupon, razorpay_order_id) VALUES (?,?,?,?,?)'),
  byRzp: db.prepare('SELECT * FROM orders WHERE razorpay_order_id = ?'),
  setStatus: db.prepare('UPDATE orders SET status = ? WHERE id = ?'),
};
function createOrder(userId, plan, amount, coupon, rzpId) {
  const info = qOrders.create.run(userId, plan, amount, coupon || null, rzpId || null);
  return info.lastInsertRowid;
}
function getOrderByRzp(rzpId) { return qOrders.byRzp.get(rzpId) || null; }
function setOrderStatus(id, status) { return !!qOrders.setStatus.run(status, id).changes; }

/* ------------------------- stats ------------------------- */
function userStats(userId) {
  return {
    chats: db.prepare('SELECT COUNT(*) AS c FROM chats WHERE user_id = ?').get(userId).c,
    reports: qReports.count.get(userId).c,
    problems: db.prepare('SELECT COUNT(*) AS c FROM problems WHERE user_id = ?').get(userId).c,
    memberSince: db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId).created_at,
  };
}

/* ------------------------- knowledge base (admin) ------------------------- */
const qKb = {
  list: db.prepare('SELECT * FROM kb ORDER BY id DESC LIMIT 500'),
  add: db.prepare('INSERT INTO kb (topic, symptoms, summary, advice, severity) VALUES (?,?,?,?,?)'),
  del: db.prepare('DELETE FROM kb WHERE id = ?'),
};
function listKB() { return qKb.list.all(); }
function addKB(topic, symptoms, summary, advice, severity) {
  return !!qKb.add.run(String(topic).slice(0, 120), String(symptoms).slice(0, 400), String(summary).slice(0, 800), String(advice).slice(0, 800), severity).changes;
}
function deleteKB(id) { return !!qKb.del.run(id).changes; }

module.exports = {
  db,
  userCount, userExists, createUser, getUserByUsername, getUser, verifyPassword,
  deductCredits, setPlan, setPrefs,
  listChats, getChat, createChat, getMessages, getRecentMessages, addMessage,
  touchChat, renameChat, deleteChat,
  searchKB, listKB, addKB, deleteKB,
  listReports, getReport, createReport, deleteReport,
  findCoupon, listCoupons, createCoupon, deleteCoupon,
  createProblem, listProblems, setProblemStatus,
  createOrder, getOrderByRzp, setOrderStatus,
  userStats,
};
