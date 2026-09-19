/**
 * Medi AI — private accuracy test harness (for the owner only; not shipped to users)
 * ---------------------------------------------------------------------------
 * Run from the project root:
 *   DATABASE_URL=... GROQ_API_KEY=... node tests/accuracy.js
 *
 * What it does:
 *  - Asks the same AI pipeline used in production (ai.js + KB grounding) 105
 *    fixed health questions whose expected key points were written from public
 *    NHS / WHO / CDC / MoHFW guidance.
 *  - An answer passes if every expected key point appears in it.
 *  - Writes tests/accuracy-report.md with the score and every question,
 *    expected keys and whether it passed, so you can eyeball borderline ones.
 *
 * Honest-claims note: report the score as the date-stamped result of THIS
 * test set, e.g. "94/105 questions passed our monthly accuracy test (Sep 2026)".
 * Re-run after every engine/prompt change and before making any public claim.
 */
'use strict';
process.chdir(require('path').join(__dirname, '..'));

globalThis.navigator = globalThis.navigator || { userAgent: 'Node' }; // pg shim for local runs

const fs = require('fs');
const db = require('../db');
const ai = require('../ai');

const QUESTIONS = [
  ['I have fever since 3 days, what should I do?', ['paracetamol', 'fluid'], 'NHS fever in adults'],
  ['How to treat a common cold?', ['rest', 'fluid'], 'NHS common cold'],
  ['What are the warning signs of a stroke?', ['112', 'face'], 'WHO stroke'],
  ['What to do for chest pain with sweating?', ['112', 'aspirin'], 'NHS chest pain'],
  ['How can I avoid dengue?', ['mosquito', 'water'], 'WHO dengue'],
  ['What should I do in heavy bleeding?', ['press', '112'], 'first aid'],
  ['First aid for burns?', ['water', '20'], 'NHS burns'],
  ['What to do if someone has a seizure?', ['side', 'time'], 'NHS epilepsy'],
  ['What to do after a dog bite?', ['wash', '15'], 'WHO rabies'],
  ['What to do for snake bite?', ['hospital', 'calm'], 'WHO snakebite'],
  ['What to do if someone is choking?', ['back', '112'], 'first aid'],
  ['How much water should I drink daily?', ['thirst', 'urine'], 'general guidance'],
  ['How to manage acidity at night?', ['meal', 'lying'], 'NHS GERD'],
  ['What is HbA1c?', ['sugar', 'month'], 'NHS diabetes'],
  ['What diet for diabetes?', ['vegetable', 'sugar'], 'NHS diabetes diet'],
  ['What are symptoms of low sugar?', ['sweat', 'sugar'], 'NHS hypoglycemia'],
  ['How often should I check my BP?', ['regular', 'year'], 'general'],
  ['What is normal blood pressure?', ['120', '80'], 'NHS BP'],
  ['How to lower cholesterol?', ['exercise', 'fried'], 'NHS cholesterol'],
  ['What food has iron?', ['green', 'vitamin C'], 'anemia diet'],
  ['How to treat a urine infection at home?', ['water', 'doctor'], 'NHS UTI'],
  ['What causes kidney stones?', ['water', 'oxalate'], 'NHS kidney stones'],
  ['Symptoms of thyroid problem?', ['weight', 'tired'], 'NHS thyroid'],
  ['How to sleep better?', ['screen', 'caffeine'], 'NHS insomnia'],
  ['How to handle a panic attack?', ['breath', 'minute'], 'NHS panic'],
  ['How to help constipation?', ['fibre', 'water'], 'NHS constipation'],
  ['What helps in vomiting and loose motion?', ['ORS', 'sip'], 'WHO ORS'],
  ['When is fever dangerous in a baby?', ['3 month', 'emergency'], 'WHO child health'],
  ['What vaccines does a newborn get?', ['bcg', 'hepatitis'], 'MoHFW UIP'],
  ['How to treat prickly heat?', ['cool', 'cotton'], 'WHO heat'],
  ['What to do in heat stroke?', ['shade', '112'], 'WHO heat'],
  ['Is paracetamol safe in pregnancy?', ['doctor', 'paracetamol'], 'NHS pregnancy'],
  ['What to do for morning sickness?', ['small', 'fluid'], 'NHS pregnancy'],
  ['How to care for the umbilical cord of a newborn?', ['clean', 'dry'], 'WHO newborn'],
  ['Can I give water to my 2-month-old?', ['6 month', 'breast'], 'WHO breastfeeding'],
  ['How to deworm a child?', ['albendazole', 'repeat'], 'WHO deworming'],
  ['What to do for measles?', ['vitamin A', 'isolation'], 'WHO measles'],
  ['Symptoms of malaria?', ['chill', 'fever'], 'WHO malaria'],
  ['What to do for typhoid fever?', ['blood test', 'antibiotic'], 'WHO typhoid'],
  ['How is hepatitis A spread?', ['food', 'water'], 'WHO hepatitis A'],
  ['How to prevent hepatitis B?', ['vaccine', 'needle'], 'WHO hepatitis B'],
  ['Can HIV spread by sharing food?', ['not', 'mosquito'], 'WHO HIV'],
  ['What is PEP after HIV exposure?', ['72', 'test'], 'WHO HIV'],
  ['What are symptoms of pneumonia?', ['breath', 'fever'], 'WHO pneumonia'],
  ['Does bronchitis need antibiotics?', ['viral', 'no'], 'NHS bronchitis'],
  ['How to quit smoking?', ['quit', 'nicotine'], 'WHO tobacco'],
  ['What is the safe alcohol limit?', ['limit', 'day'], 'NHS alcohol'],
  ['How much exercise per week?', ['150', 'minute'], 'WHO activity'],
  ['What is a healthy BMI?', ['weight', 'height'], 'WHO obesity'],
  ['How to get vitamin D naturally?', ['sun', 'egg'], 'NHS vitamin D'],
  ['What food gives B12 for vegetarians?', ['milk', 'curd'], 'NHS B12'],
  ['How to manage gout?', ['water', 'purine'], 'NHS gout'],
  ['What to do for back pain?', ['move', 'exercise'], 'NHS back pain'],
  ['How to treat ankle sprain?', ['rice', 'ice'], 'NHS sprain'],
  ['When does a cut need a tetanus shot?', ['tetanus', 'wound'], 'NHS tetanus'],
  ['What to do for a head injury?', ['vomit', 'hospital'], 'NHS head injury'],
  ['How to stop a nosebleed?', ['10', 'forward'], 'NHS nosebleed'],
  ['What to do if a bee sting swells the lips?', ['112', 'adrenaline'], 'anaphylaxis'],
  ['First aid for electric shock?', ['switch', '112'], 'first aid'],
  ['What to do when someone faints?', ['leg', 'airway'], 'first aid'],
  ['How to treat sunburn?', ['cool', 'water'], 'NHS sunburn'],
  ['What is appendicitis pain like?', ['right', 'vomit'], 'NHS appendicitis'],
  ['What triggers gallstone pain?', ['fat', 'right'], 'NHS gallstones'],
  ['How to reverse fatty liver?', ['weight', 'exercise'], 'NHS fatty liver'],
  ['What are PCOS symptoms?', ['period', 'weight'], 'NHS PCOS'],
  ['How to manage period pain?', ['heat', 'paracetamol'], 'NHS period pain'],
  ['When do periods become a concern?', ['month', 'heavy'], 'NHS periods'],
  ['What are menopause symptoms?', ['hot', 'period'], 'NHS menopause'],
  ['Is white discharge always an infection?', ['normal', 'itch'], 'NHS discharge'],
  ['What contraceptive protects from disease?', ['condom'], 'WHO contraception'],
  ['When should a couple test for infertility?', ['year', 'both'], 'NHS fertility'],
  ['When is a breast lump dangerous?', ['lump', 'doctor'], 'WHO breast cancer'],
  ['How often to get a Pap smear?', ['3', 'year'], 'WHO cervical cancer'],
  ['What causes anaemia in pregnancy?', ['iron', 'folic'], 'MoHFW'],
  ['What are danger signs in late pregnancy?', ['bleed', 'movement'], 'WHO pregnancy'],
  ['How to treat ringworm?', ['antifungal', 'dry'], 'NHS ringworm'],
  ['How to treat scabies?', ['permethrin', 'family'], 'NHS scabies'],
  ['How to remove head lice?', ['comb', 'permethrin'], 'NHS lice'],
  ['Is psoriasis contagious?', ['not', 'immune'], 'NHS psoriasis'],
  ['How to treat acne?', ['wash', 'doctor'], 'NHS acne'],
  ['Why am I losing hair?', ['iron', 'thyroid'], 'NHS hair loss'],
  ['What to do for mouth ulcers?', ['salt', 'week'], 'NHS mouth ulcers'],
  ['What helps vertigo?', ['slow', 'manoeuvre'], 'NHS vertigo'],
  ['When is dizziness an emergency?', ['speech', 'stroke'], 'NHS dizziness'],
  ['Is tinnitus dangerous?', ['hearing', 'doctor'], 'NHS tinnitus'],
  ['How to care for dementia at home?', ['routine', 'light'], 'NHS dementia'],
  ['Can epilepsy be controlled?', ['medicine', '70'], 'WHO epilepsy'],
  ['What is Parkinson disease?', ['tremor', 'slow'], 'NHS Parkinson'],
  ['How to prevent osteoporosis?', ['calcium', 'vitamin D'], 'NHS osteoporosis'],
  ['Why should I not share antibiotics?', ['resistance', 'course'], 'WHO AMR'],
  ['Maximum paracetamol dose per day for adults?', ['4', 'gram'], 'NHS paracetamol'],
  ['Is ibuprofen safe with dengue?', ['no', 'paracetamol'], 'WHO dengue'],
  ['Which painkiller is safest in pregnancy?', ['paracetamol'], 'NHS pregnancy'],
  ['How to store medicines at home?', ['cool', 'child'], 'medicine safety'],
  ['When do adults need vaccines?', ['tetanus', 'flu'], 'WHO immunization'],
  ['How to use AQI to protect from smog?', ['mask', 'indoor'], 'WHO air quality'],
  ['How to prevent mosquito breeding?', ['water', 'week'], 'WHO vector control'],
  ['How to make water safe to drink?', ['boil', 'filter'], 'WHO water'],
  ['What are the WHO 5 keys to food safety?', ['clean', 'cook'], 'WHO food'],
  ['What should a home first aid kit have?', ['bandage', 'thermometer'], 'first aid'],
  ['What to do for a child who will not eat?', ['routine', 'force'], 'WHO child nutrition'],
  ['Is bedwetting normal at age 5?', ['normal', '7'], 'NHS bedwetting'],
  ['Early signs of autism?', ['eye contact', 'speech'], 'WHO autism'],
  ['How to help a hyperactive child?', ['structure', 'doctor'], 'NHS ADHD'],
  ['What to do if someone talks about suicide?', ['help', 'stay'], 'WHO suicide'],
];

(async () => {
  if (!ai.available().length) {
    console.error('No AI provider keys found (set GROQ_API_KEY etc.).');
    process.exit(1);
  }
  let kbNote = 'no KB grounding (DATABASE_URL not set)';
  try { await db.init(); kbNote = 'KB grounding active'; } catch (e) { /* ok */ }

  const results = [];
  let pass = 0;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const [q, keys, ref] = QUESTIONS[i];
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${q}\n`);
    let answer = '', err = null;
    try {
      let kbHits = [];
      try { kbHits = await db.searchKB(q, 3); } catch (e) { /* no db */ }
      const system = 'You are Medi AI, a careful medical information assistant. ' +
        'Give clear, practical, evidence-based general health information. For anything serious ' +
        'tell the user to see a qualified doctor. Reply in English.';
      const messages = [{ role: 'system', content: system }, { role: 'user', content: q }];
      const r = await (ai.available().length > 1 ? ai.ensembleChat(messages, 2) : ai.chat(null, messages));
      answer = r.text;
    } catch (e) { err = e.message; }
    const lower = String(answer).toLowerCase();
    const missing = err ? keys : keys.filter((k) => !lower.includes(String(k).toLowerCase()));
    const ok = !err && missing.length === 0;
    if (ok) pass++;
    results.push({ q, keys, ref, ok, err, missing, answer: String(answer).slice(0, 400) });
  }

  const d = new Date().toISOString().slice(0, 10);
  const pct = Math.round((pass / QUESTIONS.length) * 100);
  let md = `# Medi AI accuracy report — ${d}\n\n` +
    `**Score: ${pass}/${QUESTIONS.length} (${pct}%)** — engines: ${ai.available().length} — ${kbNote}\n\n` +
    `Run again with: \`DATABASE_URL=... GROQ_API_KEY=... node tests/accuracy.js\`\n\n` +
    `| # | Question | Ref | Result | Missing keys |\n|---|---|---|---|---|\n`;
  results.forEach((r, i) => {
    md += `| ${i + 1} | ${r.q.replace(/\|/g, '/')} | ${r.ref} | ${r.ok ? 'PASS' : 'FAIL'} | ${(r.err ? 'ERROR: ' + r.err : r.missing.join(', ')).replace(/\|/g, '/')} |\n`;
  });
  md += `\n## Sample answers for manual review\n\n`;
  results.filter((r) => !r.ok).slice(0, 10).forEach((r) => {
    md += `### ${r.q}\nExpected: ${r.keys.join(', ')} (ref: ${r.ref})\n\n> ${r.answer.replace(/\n/g, ' ').slice(0, 300)}\n\n`;
  });
  fs.writeFileSync(require('path').join(__dirname, 'accuracy-report.md'), md);
  console.log(`\nScore: ${pass}/${QUESTIONS.length} (${pct}%) — report: tests/accuracy-report.md`);
  process.exit(0);
})();
