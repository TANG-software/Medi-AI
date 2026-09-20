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
   NOTE: server.js applies the v2.1 daily-credit overrides on top of these
   defaults at startup (free 9/week · plus 19/day ×7 · plus+ 25/day ×28 ·
   pro 39/day ×28 · pro+ 59/day ×28 · elite 119/day ×336). Prices & engines
   per answer: free 2 · plus 3 · plus+ 4 · pro tiers all available. */
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
/* Each row: [topic, symptoms, summary, advice, severity, source, url] */
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
  ['Child fever (parents guide)', 'child fever baby fever kid high temperature febrile', "In babies under 3 months ANY fever is an emergency. In older children most fevers are viral.", 'Light clothing, fluids, paracetamol syrup by weight. Emergency if under 3 months, non-stop crying, limp, rash that does not fade on pressing, or seizure.', 'see-doctor'],
  ['Chikungunya', 'chikungunya joint pain fever rash mosquito chikungunya', 'Mosquito-borne viral fever with severe joint pain that can linger for weeks.', 'Paracetamol for pain and fever, rest, plenty of fluids. Avoid NSAIDs unless dengue is ruled out. See a doctor to confirm; urgent care if severe weakness, bleeding or persistent vomiting.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/dengue-and-severe-dengue'],
  ['Leptospirosis', 'leptospirosis rat urine dirty water fever jaundice muscle pain', 'Bacterial infection from water contaminated by animal urine — common after floods, causing fever with severe muscle pain.', 'See a doctor early for blood tests and antibiotics; early treatment works best. Avoid wading in floodwater with cuts on skin; wear boots.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/leptospirosis'],
  ['Cholera', 'cholera watery diarrhea rice water severe dehydration', 'Cholera causes sudden profuse watery diarrhoea that can kill through dehydration within hours.', 'Start ORS immediately and continuously, and go to a hospital urgently — cholera is fully treatable with rehydration. Boil or treat drinking water during outbreaks.', 'emergency', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/cholera'],
  ['Diarrhoea in children', 'child diarrhea loose motion kid ORS dehydration', 'Loose stools in children are mostly viral; the real danger is dehydration.', 'Give ORS after every loose stool in sips, keep feeding, zinc syrup for 14 days if advised. Emergency signs: no urine for 8 hours, sunken eyes, very drowsy, blood in stool.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Intestinal worms', 'worms in stomach pinworm itching anus child worms pica', 'Common in children — tummy pain, itching around the anus, sometimes worms in stool.', 'Single-dose deworming tablets (albendazole/mebendazole) are cheap and safe — ask a chemist or doctor; repeat after 2 weeks. Wash hands, trim nails, wash vegetables.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Measles', 'measles rash fever cough runny nose koplik spots', 'Highly contagious viral illness with fever, cough, red eyes and a rash starting behind the ears.', 'Vitamin A drops as advised, fluids, rest, isolation for 4 days after the rash. See a doctor to confirm; urgent if breathing difficulty, convulsions or the child becomes drowsy. Preventable by MMR vaccine.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/measles'],
  ['Mumps', 'mumps swollen cheeks parotitis jaw swelling fever', 'Viral infection causing painful swollen cheeks and jaw, mostly in children.', 'Supportive care: soft food, fluids, warm/cold compress, paracetamol. Doctor if severe belly pain (pancreatitis), high fever in a boy with testicular swelling, or if hearing/deafness is affected. Preventable by MMR vaccine.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['German measles (rubella)', 'rubella german measles mild rash swollen glands pregnancy', 'A mild viral rash with swollen neck glands — serious only if caught in early pregnancy.', 'Rest and paracetamol; it clears in days. Any rash in pregnancy needs a doctor the same day — rubella can harm the baby. Vaccination before pregnancy prevents it.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Hand, foot and mouth disease', 'hfmd blisters hands feet mouth child fever coxsackie', 'A common childhood viral infection: small painful mouth ulcers and blisters on hands and feet.', 'Fluids, soft cool foods (avoid citrus/salty), paracetamol for pain. It settles in 7-10 days. See a doctor if the child refuses all fluids, is passing less urine, or there is neck stiffness.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Rabies (animal bite)', 'dog bite animal bite monkey bite rabies vaccine scratch', 'Any dog, cat, monkey or bat bite/scratch can transmit rabies, which is 100% fatal once symptoms start — but 100% preventable with timely vaccination.', 'Wash the wound with soap under running water for 15 minutes, apply antiseptic, and go to a hospital the SAME DAY for anti-rabies vaccine — even for minor scratches or licks on broken skin.', 'emergency', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/rabies'],
  ['Tetanus', 'tetanus lockjaw stiff jaw wound rust nail bite', 'Tetanus bacteria enter through wounds and cause painful muscle spasms starting with jaw stiffness.', 'Any dirty, deep or puncture wound (especially with rust, soil or animal bites) needs a doctor the same day for a tetanus shot. Keep wounds clean. Booster needed every 10 years.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Hepatitis A', 'hepatitis A jaundice contaminated food water dirty food', 'Liver infection spread by contaminated food/water causing jaundice, tiredness and stomach upset.', 'Rest, hydration, no alcohol or unnecessary medicines — most recover fully in weeks. See a doctor to confirm and monitor. Vaccine and safe food/water prevent it.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/hepatitis-a'],
  ['Hepatitis B', 'hepatitis B jaundice blood transmission needle vaccine', 'A liver virus spread by blood and body fluids; can become long-term and cause liver damage.', 'Prevention is key: vaccine at birth, safe needles. If exposed, a doctor can give urgent protection. Long-term infection needs regular monitoring and treatment — never ignore yellow eyes or dark urine.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/hepatitis-b'],
  ['HIV/AIDS basics', 'hiv aids unprotected sex fever weight loss night sweats test', 'HIV spreads through unprotected sex, shared needles or from mother to baby — never by touch, sharing food or mosquitoes.', 'If you may have been exposed, get tested — free at government centres (ICTC); emergency medicines (PEP) work best within 72 hours. HIV+ people on treatment live normal lives and cannot pass it on (U=U).', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/hiv-aids'],
  ['Pneumonia', 'pneumonia chest infection fast breathing cough phlegm fever', 'Lung infection with fever, cough and fast or painful breathing — dangerous in young children and the elderly.', 'See a doctor promptly — pneumonia usually needs prescribed antibiotics. Emergency: blue lips, breathlessness at rest, confusion, or a child breathing very fast with chest drawing in.', 'emergency', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/pneumonia'],
  ['Acute bronchitis', 'bronchitis chest cough productive cough after cold', 'A chesty cough following a cold, often lasting 2-3 weeks; usually viral so antibiotics rarely help.', 'Rest, fluids, warm fluids, steam. See a doctor if fever lasts over 3 days, you cough blood, breathlessness appears, or the cough lasts beyond 3 weeks.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['COPD (smoker’s lung)', 'copd smokers lung chronic bronchitis emphysema breathless smoker', 'Long-term lung damage, almost always from smoking/biomass smoke: progressive breathlessness and daily cough.', 'The single most important step is stopping smoking — benefits start within days. Doctor-prescribed inhalers help; get flu and pneumonia vaccines. Emergency if breathing suddenly worsens.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Snoring & sleep apnea', 'snoring sleep apnea daytime sleep choking gasp at night', 'Loud snoring with pauses/gasping in sleep and daytime sleepiness suggests obstructive sleep apnea — raises BP and heart risk.', 'Lose weight, avoid alcohol at night, sleep on your side. Get a sleep study — a CPAP machine safely fixes it for most. Important for drivers: daytime sleepiness is dangerous.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Nosebleed (epistaxis)', 'nose bleed nosebleed blood from nose', 'Most nosebleeds are from a burst vessel in the front of the nose and stop with simple pressure.', 'Sit leaning slightly forward, pinch the SOFT part of the nose firmly for 10-15 minutes without peeking, cold compress on the bridge. Emergency if bleeding continues beyond 20-30 minutes, after a head injury, or with blood thinners.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Sprains & strains', 'sprain strain twisted ankle wrist injury swelling bruise', 'Stretched or torn ligaments/muscles causing pain and swelling around a joint.', 'Follow RICE for 2-3 days: Rest, Ice 15 min hourly (wrapped in cloth), Compression bandage, Elevation. Doctor/X-ray if you cannot bear weight, the joint looks deformed, or it is not improving in a week.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Broken bone (fracture)', 'fracture broken bone fall deformity cannot move limb', 'Suspect a break with a fall or crush injury: pain, swelling, deformity or inability to move/bear weight.', 'Immobilise the limb with a splint (stick/cardboard + cloth), do not try to straighten it, apply cold pack, go to hospital. Emergency if bone pierces skin, or for neck/back injury — do not move the person, call 112.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Head injury / concussion', 'head injury concussion hit head fall unconscious vomiting', 'Any hit to the head needs watching; concussion may occur without losing consciousness.', 'Watch for 24 hours: drowsiness that grows, repeated vomiting, seizures, unequal pupils, weakness or confusion = go to hospital NOW. Rest, no screens/alcohol for a day. Children and elderly need extra caution.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Sunburn', 'sunburn red skin sun burn peeling painful skin', 'Overexposure to UV causing red, hot, painful skin, sometimes blisters.', 'Cool showers, aloe/moisturiser, paracetamol, extra water. Do not burst blisters. Prevention: shade 11am-4pm, clothing, broad-spectrum sunscreen SPF 30+. See a doctor for large blisters, fever or a sunburnt baby.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Bee / wasp sting', 'bee sting wasp sting hornet sting swelling allergy', 'Most stings cause local pain and swelling; some cause severe allergic reaction.', 'Remove the sting by scraping sideways (credit card), wash, cold compress, antihistamine. EMERGENCY (call 112): any swelling of lips/tongue/throat, wheeze, dizziness or widespread rash — use an adrenaline auto-injector if prescribed.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Electric shock', 'electric shock electrocution lightning burn wire', 'Electric shock can stop the heart or cause deep internal burns even when the skin looks fine.', 'Switch off the power source FIRST — never touch the person while they are in contact. If unresponsive, call 112 and start CPR if trained. All electric shock victims need hospital assessment.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Near-drowning', 'drowning water rescue pool river fell in water', 'Water accidents kill by suffocation; every near-drowning needs medical review even if the person seems fine.', 'Get the person out of water safely (reach or throw, do not jump in unless trained). If not breathing, call 112 and start CPR. Hospital check is a must for all — lung problems can develop hours later.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Choking (first aid)', 'choking food stuck throat cannot breathe gagging', 'Choking blocks the airway — acting within minutes saves lives.', 'Cough it out if they can cough. If they cannot speak/cough: give 5 firm back blows between shoulder blades, then 5 abdominal thrusts (Heimlich); alternate. Call 112. For babies: 5 back blows, 5 chest thrusts. Start CPR if unconscious.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Foreign body in the eye', 'something in eye dust particle eye watering red eye', 'Dust or grit in the eye causes watering, redness and a gritty feeling.', 'Blink to make tears wash it out, or rinse with clean water/saline for minutes. NEVER rub or use a toothpick/needle. Hospital/eye doctor if it does not come out, is metal/glass, or after chemical splashes (rinse 20 minutes first, chemicals = emergency).', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Constipation', 'constipation hard stool cannot pass motion piles straining', 'Fewer than 3 stools a week, or hard stools needing straining.', 'More water, fibre (fruits, vegetables, whole grains, soaked figs/raisins), daily walks, fixed toilet time. Short-term osmotic laxative (lactulose) is safe. Doctor if there is blood, weight loss, or a sudden change lasting weeks.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Irritable bowel syndrome (IBS)', 'ibs alternating diarrhea constipation bloating cramps stress gut', 'A common gut disorder: cramping, bloating and alternating loose/hard stools, often stress-linked.', 'Regular meals, limit caffeine/fizzy drinks, note trigger foods, exercise, stress management. Doctor visit to rule out other causes. Alarm signs needing urgent tests: blood in stool, night-time symptoms, weight loss, fever.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Piles (haemorrhoids)', 'piles hemorrhoids bleeding anus itching lump at anus', 'Swollen veins at the anus causing painless bright-red bleeding, itching or a lump.', 'More fibre and water, avoid straining, warm sitz baths, short courses of safe creams. Doctor to confirm the diagnosis — bleeding should never be assumed to be piles without a check.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Appendicitis warning signs', 'appendicitis right lower abdomen pain vomiting fever moving to right side', 'Appendicitis starts as tummy-button pain moving to the lower right side with vomiting and low fever.', 'Do NOT eat, drink or take painkillers/laxatives — go to a hospital urgently. Surgery works best early; delay risks rupture and life-threatening infection.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Gallstones', 'gallstone gallbladder pain right upper belly fatty food', 'Stones in the gallbladder cause attacks of severe right-upper-belly pain after fatty meals, sometimes with vomiting.', 'Low-fat diet during attacks; see a doctor to confirm with an ultrasound. Emergency if pain with fever + yellow eyes (blocked duct/infection).', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Fatty liver', 'fatty liver nafl liver fat sgpt ultrasound', 'Fat build-up in the liver, usually from weight, sugar/alcohol intake; often found on routine tests.', 'Reversible with 5-10% weight loss, cutting sugary drinks/alcohol, and 150 min/week exercise. Doctor follow-up for liver tests. No random "liver tonic" medicines.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['PCOS / PCOD', 'pcos pcod irregular periods acne hair growth weight gain', 'A common hormone condition: irregular periods, weight gain, acne and excess facial hair; long-term diabetes risk.', 'Weight loss of even 5% restores cycles in many. Doctor-guided pill/metformin for cycle control; healthy diet and exercise are the backbone. Fertility help is available when planning pregnancy.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Menstrual cramps', 'period pain cramps dysmenorrhea menstrual pain belly', 'Painful periods are common; usually start before the period and ease after day 1.', 'Heat pack on the lower belly, warm fluids, light exercise, paracetamol/ibuprofen early. Doctor if pain stops school/work, needs increasing tablets, or is new after age 25 — check for endometriosis.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Irregular periods', 'irregular period missed period cycle problem amenorrhea', 'Cycles outside 21-35 days, missed periods or unpredictable bleeding.', 'Track 3 cycles in an app; common causes are stress, weight change, PCOS or thyroid — a doctor can identify with simple tests. Pregnancy test first if sexually active. Sudden heavy bleeding with dizziness = urgent care.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Menopause', 'menopause hot flashes period stopped night sweats mood', 'Natural change of hormones around 45-55: periods stop, hot flushes, sleep and mood changes.', 'It is a natural phase, not a disease: cool environment, layered clothing, exercise, calcium-rich diet, limit caffeine/spicy food. Doctor for very troublesome symptoms or bleeding AFTER one year of no periods (needs urgent check).', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Vaginal discharge & thrush', 'white discharge thrush itching vaginal candidiasis odor', 'Some clear/white odourless discharge is normal. Thick white itchy discharge = thrush; frothy/foul-smelling = infection needing treatment.', 'Cotton underwear, avoid douching and scented products; thrush is treated with tablets/creams from a doctor. Partner treatment may be needed for some infections. Fever + pelvic pain = see a doctor urgently.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Contraception overview', 'contraception family planning birth control pill condom iud', 'Many safe options exist: condoms, pills, copper-T/IUD, implants and permanent surgery.', 'Condoms also protect against infections. Pills need daily discipline; IUDs give years of protection. A family planning counsellor/doctor helps choose. Emergency pills work best within 72 hours but are not routine contraception.', 'see-doctor', 'Ministry of Health & Family Welfare (India)', 'https://main.mohfw.gov.in'],
  ['Infertility basics', 'infertility cannot conceive trying for baby semen ivf', 'About 1 in 6 couples face difficulty conceiving; causes can be from either partner equally.', 'Both partners get simple tests (semen analysis, hormone and tube checks). Treatments from timed medication to IUI/IVF are widely available. Avoid unverified "fertility tonic" clinics; a year of trying (6 months if over 35) warrants evaluation.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Breast lump awareness', 'breast lump breast cancer screening mammogram self exam', 'Most breast lumps are benign, but any NEW lump needs a doctor visit — early breast cancer is highly curable.', 'Know your normal: monthly self-check after periods. See a doctor promptly for any new lump, skin dimpling, nipple blood/discharge or armpit swelling. Screening mammogram from 40-45 as advised.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/breast-cancer'],
  ['Cervical cancer & screening', 'pap smear cervical cancer hpv vaccine screening', 'Cervical cancer is nearly 100% preventable by HPV vaccination (best at 9-14 years) and regular Pap smears.', 'HPV vaccine for girls (and per local guidance boys), Pap/HPV tests every 3-5 years after age 25-30. Report irregular bleeding, especially after sex. India has free screening under national programmes.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/cervical-cancer'],
  ['Anaemia in pregnancy', 'pregnancy anemia weak pale pregnant iron tablets', 'Low haemoglobin in pregnancy risks mother and baby — common in India and fully preventable.', 'Iron-folic acid tablets daily as prescribed (more if anemic), iron-rich foods with vitamin C, deworming as advised. Danger signs: severe weakness, breathlessness, swelling, pale inner eyelids — inform the doctor.', 'see-doctor', 'Ministry of Health & Family Welfare (India)', 'https://main.mohfw.gov.in'],
  ['Newborn care basics', 'newborn baby care breastfeeding jaundice newborn umbilical', 'First 28 days: exclusive breastfeeding, warmth, cord care, hygiene and vaccination at birth.', 'Keep the baby warm and dry, breastfeed on demand (no water/honey till 6 months), clean cord with nothing but soap-water if soiled. Doctor urgently if: poor feeding, fever, fast breathing, yellow palms/soles, or lethargy.', 'see-doctor', 'WHO', 'https://www.who.int/india'],
  ['Breastfeeding basics', 'breastfeeding milk supply latch colic weaning', 'Breast milk alone is ideal food for the first 6 months; feeding often builds supply.', 'Feed on demand day and night (8-12 times), ensure a deep latch, no bottles/water till 6 months, then family foods alongside up to 2 years. Support and rest help supply more than any "galactagogue". Lactation counsellor if nipples crack or baby gains poorly.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Child immunisation (India)', 'vaccination schedule immunisation baby vaccine bcg mmr', 'India’s UIP gives free vaccines: BCG, Hep-B, OPV/IPV, pentavalent, rotavirus, PCV, MR, DPT boosters.', 'Follow the ANGANWADI/ASHA card timeline strictly; delay is better than skipping, but on-time is best. Mild fever/fussiness after shots is normal; serious reactions are rare. Keep the card safe — school admission needs it.', 'self-care', 'Ministry of Health & Family Welfare (India)', 'https://main.mohfw.gov.in'],
  ['Child nutrition & picky eating', 'picky eater child not eating fussy toddler malnutrition', 'Toddlers famously eat unpredictably; growth (weight/height on chart) matters more than one meal.', 'Small frequent meals, colourful plates, eat together, no screens at meals, no force-feeding — it worsens fussiness. Limit milk/juice between meals. Doctor if weight plateaus or drops on the growth chart.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Bedwetting', 'bedwetting enuresis child wets bed night pee', 'Night wetting is common up to age 7 and usually resolves by itself.', 'No punishment or shame — it is not laziness. Limit fluids after dinner, toilet before bed, reward dry nights. Doctor visit after age 7, or if daytime wetting returns, to rule out urine infection/diabetes.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['ADHD basics', 'adhd hyperactive child cannot focus attention deficit', 'ADHD is a neurodevelopmental difference: inattention, hyperactivity, impulsivity affecting school and home.', 'Structure, short clear instructions, routine, sleep and exercise help a lot. Diagnosis needs a specialist (paediatrician/psychologist) — medication and behavioural therapy are proven. Avoid blaming; it is not bad parenting or naughtiness.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Autism red flags', 'autism spectrum no eye contact no speech repetitive lining toys', 'Early signs by 12-18 months: no pointing/name response, poor eye contact, no words by 16 months, repetitive play.', 'Early intervention changes lives — if you notice signs, get a developmental assessment promptly (RBSK free screening at health centres). Do not "wait and see" past 18 months. Vaccines do NOT cause autism.', 'see-doctor', 'WHO', 'https://www.who.int/india'],
  ['Tobacco & quitting smoking', 'quit smoking tobacco gutkha paan addiction', 'Tobacco in any form (cigarette, bidi, gutkha, paan) causes cancer, heart and lung disease — every quit attempt counts.', 'Set a quit date, tell family, use nicotine replacement (patch/gum) or doctor-prescribed medicines — they double success. Cravings peak for 3 days then fade. India’s quitline: 1800-11-2356.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Alcohol harm & cutting down', 'alcohol drinking problem liver quit drink', 'Regular heavy drinking damages liver, brain, heart and family life; safe level for some conditions is zero.', 'Keep drink-free days, set limits, replace routines, and tell someone your goal. Withdrawal in heavy drinkers (shakes, seizures) needs medical supervision — never stop suddenly after heavy daily use. National helpline 14446.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Obesity & healthy weight', 'obesity overweight bmi belly fat weight loss', 'Excess weight raises diabetes, BP, joint and cancer risk; even 5% loss helps measurably.', 'Aim for gradual loss (0.5 kg/week): plate method (half veg, quarter protein, quarter grains), 150+ min activity weekly, sleep 7h, limit sugary drinks. Doctor check for thyroid/PCOS if weight resists change.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Healthy diet basics', 'healthy diet balanced food protein fruits vegetables salt sugar', 'An Indian thali done right: variety, more plants, adequate protein, less oil/salt/sugar.', 'Half the plate vegetables/dal/salad, whole grains (roti/brown rice) over refined, curd/dal/paneer/eggs/chicken for protein, fruit over juice. Limit deep-fried to occasions. Salt under 5g/day. Cook fresh when possible.', 'self-care', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'],
  ['Vitamin D deficiency', 'vitamin d deficiency bone pain tired weakness sunlight', 'Very common in Indians despite sunshine — causes tiredness, aches and weak bones.', '15-30 minutes of midday sun on arms/legs most days, plus eggs/fish/fortified foods. Supplements (weekly sachets/tablets) work well — get levels tested before high-dose self-treatment.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Vitamin B12 deficiency', 'b12 deficiency vegetarian numbness tingling fatigue memory', 'Common in pure vegetarians and metformin users — fatigue, tingling hands/feet, poor memory, anaemia.', 'Sources: milk, curd, paneer, eggs, fortified cereals; pure vegetarians often need supplements. A blood test confirms; tablets/injections are effective. Untreated, nerve damage becomes permanent.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Diabetes — daily self-care', 'diabetes sugar control foot care diet hba1c', 'Living with diabetes: control sugar to prevent eye, kidney, nerve and heart damage.', 'Medicines as prescribed, HbA1c every 3-6 months, daily foot inspection (never walk barefoot), eye check yearly, BP control, no smoking. Emergency: sweating/confusion = check sugar; hypoglycemia needs sugar immediately.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Low blood sugar (hypoglycemia)', 'low sugar hypoglycemia sweating shakiness faint diabetic', 'Sugar dropping too low (missed meals, extra medicine) is dangerous fast: sweating, shaking, confusion.', 'Rule of 15: eat 15g fast sugar (glucose tabs, 3 tsp sugar, juice) NOW, recheck in 15 minutes, repeat if still low, then eat a snack. If unconscious — nothing by mouth, glucagon/injection + call 112.', 'emergency', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Heart-healthy lifestyle', 'heart health cholesterol exercise bp heart attack prevention', 'Most heart attacks are preventable with habits: BP/sugar control, no tobacco, activity, diet.', '150 min/week brisk activity, salt <5g, less fried food, more vegetables and dal, sleep 7h, stress care, yearly BP+sugar+lipid checks after 30. Family history means earlier, not no, prevention.', 'self-care', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/physical-activity'],
  ['Stress management', 'stress tension burnout overwhelmed relaxing', 'Chronic stress harms sleep, BP and mood — managing it is a skill anyone can learn.', 'Daily 10-min breathing/walk, fixed sleep, limits on work spills, talking to someone trusted, hobbies without screens. Counselling is a strength not weakness. If stress feels unmanageable 2+ weeks, seek help (Tele-MANAS 14416).', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Grief & loss', 'grief death loss mourning depressed after death', 'Grief after losing someone is natural and takes months, with waves of pain, guilt or numbness.', 'Eat and sleep regularly, accept help, talk about the person, avoid big decisions for a year. Counselling helps when stuck. Urgent help if there are thoughts of joining the deceased or self-harm — Tele-MANAS 14416.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Psychosis awareness', 'hearing voices delusions hallucination schizophrenia losing touch', 'Sudden loss of touch with reality (hearing voices, strange beliefs, social withdrawal) is treatable — not "ghosts" or character failure.', 'Early psychiatric treatment gives the best recovery; with medication and family support people study, work and live fully. Do not argue with the beliefs, do not seek faith-cures alone. Emergency if there is danger to self/others — 112 or Tele-MANAS 14416.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Self-harm awareness', 'self harm cutting burning suicide thoughts hopeless', 'Self-harm is a distress signal, not attention-seeking — it needs kindness and professional support, never scolding.', 'Listen without judgement, remove means, stay with the person, and get help the same day. India 24x7 helplines: Tele-MANAS 14416, iCall 9152987821, AASRA 9820466726. In immediate danger: 112.', 'emergency', 'WHO', 'https://www.who.int/india'],
  ['Dementia (memory loss)', 'dementia alzheimer memory loss old age forgetting confusion', 'Progressive memory loss affecting daily life — beyond normal ageing forgetfulness.', 'Early diagnosis helps planning and treatment. Keep routines, labels and photos; night lights prevent falls; register in support groups. Caregivers need breaks too. Sudden confusion with fever = delirium — often treatable, go to a doctor urgently.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Parkinson’s disease', 'parkinson tremor shaking slowness stiffness walking', 'A brain condition causing tremor at rest, slowness and stiffness — treatable for many years.', 'Medicines and exercise (walking, balance work) maintain function long-term. Doctor review when medicines "wear off" early or freezing/balance worsens — falling is the main injury risk.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Living with epilepsy', 'epilepsy fits seizure medicine compliance driving', 'With regular medicines, 70% of people with epilepsy become seizure-free.', 'Never stop/skip medicines on your own — sudden stops trigger seizures. Keep sleep regular, avoid flickering lights if sensitive, no swimming alone or driving until cleared by the doctor. Carry an ID card. Free medicines via government schemes exist.', 'see-doctor', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/epilepsy'],
  ['Vertigo & dizziness', 'vertigo dizziness spinning room moving bppv', 'A spinning sensation, often from inner-ear crystals (BPPV) — unsettling but rarely dangerous.', 'Move head slowly, sit at the edge of the bed first, home Epley manoeuvre helps BPPV. Doctor to identify the cause. Emergency: dizziness with new deafness, double vision, slurred speech, weakness or worst-ever headache = possible stroke, call 112.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Tinnitus', 'tinnitus ringing in ears buzzing sound', 'Ringing/buzzing with no external sound — very common; usually harmless but annoying.', 'Reduce caffeine/loud headphones; white-noise apps at bedtime help sleep. Doctor if one-sided, pulsing, with hearing loss or dizziness. Sudden hearing loss = urgent visit within 48 hours.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Mouth ulcers', 'mouth ulcer canker sore gums painful ulcer', 'Painful small sores in the mouth, usually stress/deficiency-linked, healing in 1-2 weeks.', 'Salt-water/betadine rinses, avoid spicy-hot food, gel for pain, B-complex + iron if deficient. Doctor if any ulcer lasts beyond 3 weeks, is painless and growing, or has a hard edge — oral cancer check (common in tobacco users).', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Acne (pimples)', 'acne pimples oily skin blackheads face', 'Clogged oil glands — driven by hormones; not caused by eating specific foods (chocolate myth) or dirt.', 'Wash twice daily with a gentle cleanser, no squeezing, non-comedogenic products, benzoyl peroxide/adapalene gels from a doctor. Antibiotics/isotretinoin for severe cases are prescription-only. Be patient — 8-12 weeks for visible change.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Hair loss', 'hair fall baldness alopecia dandruff losing hair', 'Losing 50-100 hairs daily is normal. True loss shows as thinning patches or receding hairline.', 'Common causes: iron/vitamin D deficiency, thyroid, post-illness/stress telogen effluvium (recovers), and male-pattern loss (treatable early with minoxidil/doctor-prescribed tablets). No oil or home remedy regrows bald skin.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Fungal skin infection (ringworm)', 'ringworm fungal itch dhobi itch white patch scrotum itch', 'Itchy ring-shaped patches or pale scaly patches — spread by sweat, sharing towels, and steroid creams misuse.', 'Keep skin dry, wear loose cotton, never share towels; treat ALL affected family members. Plain antifungal creams (clotrimazole) for 2-4 weeks — NEVER combination steroid creams on the face. Doctor for scalp/nail involvement or no improvement in 4 weeks.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Scabies', 'scabies itching at night rash between fingers itch mites', 'Tiny mites burrowing in skin — intense night itching between fingers, wrists, waist; spreads by contact to whole families.', 'Permethrin 5% cream neck-to-toes for everyone in the house on the same night, repeat after a week; wash clothes/bedding in hot water. Itching persists 2 weeks after cure (post-scabetic itch) — do not re-apply endlessly.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Head lice', 'lice nits head itching school children', 'Tiny insects on the scalp causing itching; spreads head-to-head at school.', 'Permethrin lotion twice, 7 days apart, plus daily wet-combing with a fine comb for 2 weeks; wash hats/bedding. All family members treated together. No shaving needed.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Psoriasis', 'psoriasis scaly red patches elbows knees', 'An immune condition causing well-defined scaly patches — not contagious.', 'Moisturise aggressively, sunlight helps mild cases, doctor treatments (creams, phototherapy, tablets) keep it controlled. Avoid scrubbing scales off. Stress and some medicines can flare it.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Vitiligo (white patches)', 'vitiligo white patch leucoderma skin losing colour', 'Loss of skin colour in patches — a pigment issue, NOT contagious or "eating wrong foods".', 'Sun protection of pale patches; doctor treatments (creams, phototherapy) can repigment early patches. Cosmetic cover products exist. Kind explanation to classmates/colleagues matters most for kids.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Gout', 'gout big toe pain swelling uric acid joint red', 'Sudden severe painful red big toe (or other joints) from uric acid crystals — linked to beer, red meat, organ meat, dehydration.', 'Rest, ice, elevate; doctor for attack-relief medicines (colchicine/NSAIDs) and later urate-lowering therapy. Prevent attacks: water, less beer/meat/seafood, lose weight. Untreated, gout damages joints and kidneys.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Osteoporosis (weak bones)', 'osteoporosis bones weak fracture height loss calcium old age', 'Bones silently thinning with age (especially after menopause) until a small fall breaks a hip or wrist.', 'Calcium-rich diet (milk, curd, ragi, greens) + vitamin D + weight-bearing walk 30 min daily. Doctors can measure bone density and treat. Home safety against falls: lights, rails, non-slip mats, no loose wires.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Neck & shoulder pain', 'neck pain shoulder text neck cervical stiff neck', 'Most neck pain is muscular — from phones, pillows, desks.', 'Screen at eye level, hourly stretch breaks, firm pillow, warm compress. Doctor if pain shoots down an arm, with numbness/weakness, or after a fall. Emergency: neck pain + fever + headache/stiff jaw = possible meningitis, go urgently.', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Varicose veins', 'varicose veins leg veins swollen purple veins legs', 'Twisted leg veins with aching/heaviness, worse standing; common in teachers, security, pregnancy.', 'Avoid long standing, walk daily, elevate legs when sitting, compression stockings help. Doctor if leg swelling, skin darkening or ulcers appear, or a vein becomes red/painful/hard (clot — urgent).', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Blood donation', 'blood donation donor eligibility give blood anemia test', 'Healthy 18-65 year olds (45kg+) can donate every 3 months — one unit can save three lives.', 'Eat normally, drink water before/after, avoid smoking that day; you cannot donate with anemia, active infection, or recent tattoos (6 months). It is safe: sterile single-use kits, and your marrow replaces the blood within weeks.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Home first aid kit', 'first aid kit home medicines bandage antiseptic', 'Every home should have: bandages, gauze, antiseptic, ORS packets, paracetamol, digital thermometer, scissors, tweezers.', 'Keep it in one labelled box, out of children’s reach, with a torch and emergency numbers (112, doctor, blood group list). Check expiry dates twice a year. Do NOT stock antibiotics or prescription medicines "just in case".', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Medicine safety', 'expired medicine medicine sharing overdose tablet storage', 'Expired, shared, or wrongly stored medicines cause poisoning and resistance.', 'Store in a cool dry place away from sunlight/kids, check dates, never share prescriptions (even for similar symptoms), complete antibiotic courses as prescribed, return unused/expired medicines to a pharmacy. Keep medicines in original labels.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Antibiotic misuse', 'antibiotic resistance antibiotics for virus self medication', 'Antibiotics do NOT work on colds, flu, most coughs, loose motions or fevers caused by viruses.', 'Taking antibiotics unnecessarily breeds resistance — future infections may have no cure. Only take antibiotics prescribed for you, complete the course, never buy them over the counter. Doctors, not chemists, prescribe.', 'self-care', 'WHO', 'https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance'],
  ['Painkiller (NSAID) safety', 'painkiller side effects ibuprofen paracetamol overdose kidney', 'Paracetamol is safest at correct doses; NSAIDs (ibuprofen, diclofenac) can damage stomach, kidneys and BP with overuse.', 'Max 4g paracetamol/day for adults (less for liver patients), NSAIDs after food only, never combine two NSAIDs or two painkiller brands. Avoid NSAIDs with dengue, kidney disease, ulcers and pregnancy. Any overdose is an emergency.', 'see-doctor', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Adult vaccination', 'adult vaccines flu tetanus hepatitis b cervical', 'Adults need vaccines too: tetanus every 10 years, yearly flu (elderly/asthma/diabetes), hepatitis B, pneumococcal after 60, HPV for young adults.', 'Ask your doctor for an adult schedule at your next visit. Flu and pneumonia vaccines prevent hospitalisation in the elderly and chronically ill. Free tetanus after injuries at government hospitals.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Heat rash (prickly heat)', 'prickly heat heat rash sweat itch summer', 'Blocked sweat ducts in hot humid weather — itchy tiny red bumps.', 'Cool showers twice daily, loose cotton, calamine lotion, talc-free drying powder, stay in shade/AC when possible. See a doctor if it turns into pustules (infection).', 'self-care', 'NHS', 'https://www.nhs.uk/conditions/'],
  ['Air pollution & health', 'air pollution aqi smog asthma cough mask', 'Delhi-NCR winters and city AQI above 200 harm everyone — worse for asthma, heart, pregnancy and children.', 'Check AQI daily; on bad days (200+) limit outdoor exercise, keep windows shut during smog peaks, N95 masks outdoors, HEPA/purifier if possible. Asthmatics: keep reliever handy, take controller medicines. Report sudden breathing difficulty in elderly/children early.', 'see-doctor', 'WHO', 'https://www.who.int/india'],
  ['Mosquito-bite prevention', 'mosquito prevention dengue malaria repellent net stagnation', 'Dengue/malaria/chikungunya all breed in clean/dirty standing water around homes.', 'Empty and scrub water containers weekly, cover tanks, wear full sleeves at dawn/dusk, repellents with DEET/picaridin, bed-nets for babies. Community clean-ups beat every spray.', 'self-care', 'WHO', 'https://www.who.int/india'],
  ['Safe drinking water & food hygiene', 'food poisoning prevention water boiling hygiene handwash', 'Most stomach infections enter through unsafe water/food — prevention is cheap and proven.', 'Boil/RO/filter drinking water, wash hands with soap before cooking/eating, keep raw and cooked separate, refrigerate leftovers within 2 hours, reheat till steaming. Avoid cut street fruit/stale chutneys in summer. WHO’s 5 keys: cleanliness, separation, cooking, chilling, safe water.', 'self-care', 'WHO', 'https://www.who.int/india'],
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
  try { await pool.query('ALTER TABLE kb ADD COLUMN source TEXT'); } catch (e) {}
  try { await pool.query('ALTER TABLE kb ADD COLUMN source_url TEXT'); } catch (e) {}
  /* Seed / upgrade knowledge base: inserts only topics not present yet, so
     existing databases gain new topics without touching admin edits. */
  const existing = new Set((await q('SELECT topic FROM kb')).map((r) => r.topic.toLowerCase()));
  const missing = KB_SEED.filter((e) => !existing.has(e[0].toLowerCase()));
  if (missing.length) {
    for (const e of missing) {
      const row = e.length >= 7 ? e : e.concat(['Medi AI Knowledge Base', null]);
      await pool.query(
        'INSERT INTO kb (topic, symptoms, summary, advice, severity, source, source_url) VALUES ($1,$2,$3,$4,$5,$6,$7)', row);
    }
    console.log('[db] Knowledge base:', existing.size + missing.length, 'topics (' + missing.length + ' new)');
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

async function setPrefs(id, language, email) {
  /* email === undefined → keep the current email (language-only update).
     null → clear it, string → set it. */
  if (email === undefined) {
    await pool.query('UPDATE users SET language = $1 WHERE id = $2', [language, id]);
  } else {
    await pool.query('UPDATE users SET language = $1, email = $2 WHERE id = $3', [language, email, id]);
  }
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
async function addKB(topic, symptoms, summary, advice, severity, source, sourceUrl) {
  const r = await q1('INSERT INTO kb (topic, symptoms, summary, advice, severity, source, source_url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [String(topic).slice(0, 120), String(symptoms).slice(0, 400), String(summary).slice(0, 800), String(advice).slice(0, 800), severity,
     source ? String(source).slice(0, 120) : null, sourceUrl ? String(sourceUrl).slice(0, 300) : null]);
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
