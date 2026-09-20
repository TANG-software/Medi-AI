/**
 * Medi AI — structured medical knowledge seed data (reference copy)
 * Ported from MediMind v36. Covers: brand medicines (India), drug
 * interactions, and home remedies.
 *
 * NOTE: this file is REFERENCE DATA ONLY — it is not imported by the server.
 * The live knowledge base is the KB_SEED array inside db.js. This copy
 * originally also contained lab reference ranges, conditions, emergency
 * contacts and a WHO vaccination schedule, but those sections were
 * corrupted (binary garbage) in a past commit and could not be recovered.
 * Only the intact sections are preserved below.
 *
 * DISCLAIMER: general educational reference only — NOT a substitute for
 * professional medical advice. Every record's dosage text is a general
 * reference and must never be prescribed to a user without a doctor.
 */
'use strict';

// ───────────────────────────────────────────────────────────────────────────
// MEDICINES  (brand → generic → use) — India, OTC pain & fever
// (the original list also had international brands; that part was corrupted)
// ─────────────────────────────────────────────────────────────────────────────
const medicines = [
  { brand: 'Crocin', generic: 'Paracetamol', category: 'Pain & Fever', indication: 'Fever, headache, mild pain', dosage: '650mg (general reference)', country: 'India', otc: 1, pregnancy: 'Generally safe in recommended doses', notes: 'Max 4g/day adult. NEVER give Aspirin to children.', keywords: 'crocin paracetamol fever headache pain dolo calpol' },
  { brand: 'Dolo-650', generic: 'Paracetamol', category: 'Pain & Fever', indication: 'Fever, headache, body ache', dosage: '650mg', country: 'India', otc: 1, pregnancy: 'Generally safe in recommended doses', notes: 'Max 4g/day adult.', keywords: 'dolo 650 paracetamol fever headache pain' },
  { brand: 'Calpol', generic: 'Paracetamol', category: 'Pain & Fever', indication: 'Fever, mild pain', dosage: '500/650mg', country: 'India', otc: 1, pregnancy: 'Generally safe', notes: 'Max 4g/day adult.', keywords: 'calpol paracetamol fever pain' },
  { brand: 'Combiflam', generic: 'Ibuprofen + Paracetamol', category: 'Pain & Fever', indication: 'Moderate pain, inflammation', dosage: '400+325mg', country: 'India', otc: 1, pregnancy: 'Avoid in 3rd trimester', notes: 'Take with food. Avoid in kidney disease.', keywords: 'combiflam ibuprofen paracetamol pain inflammation moderate' },
  { brand: 'Volini', generic: 'Diclofenac (gel)', category: 'Pain & Fever', indication: 'Muscle pain, sprains', dosage: 'Topical gel', country: 'India', otc: 1, pregnancy: 'Topical generally safe', notes: 'For external use only', keywords: 'volini diclofenac gel muscle pain sprain moov' },
  { brand: 'Moov', generic: 'Diclofenac / herbal gel', category: 'Pain & Fever', indication: 'Muscle pain, backache', dosage: 'Topical gel', country: 'India', otc: 1, pregnancy: 'Topical generally safe', notes: 'External use.', keywords: 'moov diclofenac gel muscle pain backache volini' },
  { brand: 'Voveran', generic: 'Diclofenac', category: 'Pain & Fever', indication: 'Arthritis pain, inflammation', dosage: '50mg (prescription)', country: 'India', otc: 0, pregnancy: 'Avoid (3rd trimester)', notes: 'Take with food. Long-term use needs doctor supervision (kidney/stomach risk).', keywords: 'voveran diclofenac arthritis pain inflammation' },
];

// ───────────────────────────────────────────────────────────────────────────
// DRUG INTERACTIONS
// ─────────────────────────────────────────────────────────────────────────────
const drugInteractions = [
  { drug_a: 'Aspirin', drug_b: 'Warfarin', severity: 'severe', effect: 'Increased bleeding risk', recommendation: 'Avoid combination', keywords: 'aspirin warfarin bleeding interaction' },
  { drug_a: 'Ibuprofen', drug_b: 'Lithium', severity: 'severe', effect: 'Lithium toxicity', recommendation: 'Avoid or monitor levels', keywords: 'ibuprofen lithium toxicity interaction' },
  { drug_a: 'Metformin', drug_b: 'IV Contrast dye', severity: 'severe', effect: 'Lactic acidosis', recommendation: 'Stop metformin before/after contrast', keywords: 'metformin contrast dye lactic acidosis interaction' },
  { drug_a: 'Azithromycin', drug_b: 'Antacids', severity: 'moderate', effect: 'Poor absorption of antibiotic', recommendation: 'Space by 2 hours', keywords: 'azithromycin antacids absorption interaction' },
  { drug_a: 'Ciprofloxacin', drug_b: 'Iron/Calcium', severity: 'moderate', effect: 'Reduced antibiotic effect', recommendation: 'Space by 2 hours', keywords: 'ciprofloxacin iron calcium reduced effect interaction' },
  { drug_a: 'Clopidogrel', drug_b: 'Omeprazole', severity: 'severe', effect: 'Reduced antiplatelet effect', recommendation: 'Use pantoprazole instead', keywords: 'clopidogrel omeprazole reduced antiplatelet interaction' },
  { drug_a: 'Statins (Atorvastatin/Simvastatin)', drug_b: 'Macrolides (Clarithromicin/Erythromycin)', severity: 'severe', effect: 'Muscle damage (rhabdomyolysis)', recommendation: 'Avoid or hold statin', keywords: 'statin macrolides muscle rhabdomyolysis interaction' },
  { drug_a: 'Warfarin', drug_b: 'NSAIDs (Ibuprofen/Diclofenac)', severity: 'severe', effect: 'Serious bleeding', recommendation: 'Avoid combination', keywords: 'warfarin nsaids ibuprofen bleeding interaction' },
  { drug_a: 'Metformin', drug_b: 'Alcohol', severity: 'severe', effect: 'Lactic acidosis', recommendation: 'Avoid alcohol', keywords: 'metformin alcohol lactic acidosis interaction' },
  { drug_a: 'Diclofenac', drug_b: 'ACE inhibitors (Ramipril/Enalapril)', severity: 'severe', effect: 'Kidney damage', recommendation: 'Avoid combination, monitor kidney function', keywords: 'diclofenac ace inhibitor kidney damage interaction' },
  { drug_a: 'SSRIs (Fluoxetine/Sertraline)', drug_b: 'NSAIDs', severity: 'moderate', effect: 'Increased GI bleeding risk', recommendation: 'Use gastroprotection', keywords: 'ssri nsaid gi bleeding interaction' },
  { drug_a: 'Warfarin', drug_b: 'Amiodarone', severity: 'severe', effect: 'Increased warfarin effect (bleeding)', recommendation: 'Reduce warfarin dose, monitor INR', keywords: 'warfarin amiodarone bleeding interaction' },
];

// ───────────────────────────────────────────────────────────────────────────
// AYURVEDIC / HOME REMEDIES
// ─────────────────────────────────────────────────────────────────────────────
const remedies = [
  { condition: 'Cold / Cough', system: 'Ayurveda', remedy: 'Turmeric milk (haldi doodh)', preparation: '1 tsp turmeric in warm milk before bed', keywords: 'cold cough turmeric milk haldi ayurveda' },
  { condition: 'Cold / Cough', system: 'Ayurveda', remedy: 'Ginger tea with honey', preparation: 'Boil ginger in water, add honey', keywords: 'cold cough ginger tea honey ayurveda' },
  { condition: 'Cold / Cough', system: 'Ayurveda', remedy: 'Steam with eucalyptus', preparation: 'Inhale steam with 2 drops eucalyptus oil', keywords: 'cold cough steam eucalyptus congestion' },
  { condition: 'Cold / Cough', system: 'Ayurveda', remedy: 'Tulsi (holy basil) tea', preparation: 'Boil tulsi leaves in water', keywords: 'cold cough tulsi basil ayurveda immunity' },
  { condition: 'Cold / Cough', system: 'Ayurveda', remedy: 'Honey + lemon warm water', preparation: '1 tbsp honey + lemon in warm water', keywords: 'cold cough honey lemon sore throat' },
  { condition: 'Digestion', system: 'Ayurveda', remedy: 'Jeera (cumin) water', preparation: 'Soak/boil 1 tsp cumin seeds in water', keywords: 'digestion jeera cumin water ayurveda bloating indigestion' },
  { condition: 'Digestion', system: 'Ayurveda', remedy: 'Ajwain (carom) water', preparation: 'Boil 1 tsp ajwain in water', keywords: 'digestion ajwain carom water ayurveda gas indigestion' },
  { condition: 'Digestion', system: 'Ayurveda', remedy: 'Fennel (saunf) tea', preparation: 'Steep fennel seeds in hot water', keywords: 'digestion fennel saunf tea ayurveda indigestion' },
  { condition: 'Digestion', system: 'Ayurveda', remedy: 'Buttermilk with cumin', preparation: 'Plain buttermilk + roasted cumin powder', keywords: 'digestion buttermilk cumin ayurveda indigestion' },
  { condition: 'Digestion', system: 'Ayurveda', remedy: 'Isabgol (psyllium husk)', preparation: '1 tbsp with warm water/milk at night', keywords: 'digestion isabgol psyllium constipation ayurveda indigestion' },
  { condition: 'Joint Pain', system: 'Ayurveda', remedy: 'Turmeric paste', preparation: 'Turmeric + water paste applied to joint', keywords: 'joint pain turmeric paste ayurveda arthritis' },
  { condition: 'Joint Pain', system: 'Ayurveda', remedy: 'Mahanarayan oil massage', preparation: 'Warm oil massage on affected joints', keywords: 'joint pain mahanarayan oil massage ayurveda' },
  { condition: 'Joint Pain', system: 'Ayurveda', remedy: 'Epsom salt bath', preparation: 'Soak in warm water with Epsom salt', keywords: 'joint pain epsom salt bath arthritis' },
  { condition: 'Joint Pain', system: 'Ayurveda', remedy: 'Ashwagandha', preparation: '300-500mg daily with warm milk', keywords: 'joint pain ashwagandha arthritis ayurveda inflammation' },
  { condition: 'Skin', system: 'Ayurveda', remedy: 'Aloe vera gel', preparation: 'Fresh aloe gel on skin', keywords: 'skin aloe vera ayurveda burn rash' },
  { condition: 'Skin', system: 'Ayurveda', remedy: 'Neem paste', preparation: 'Crushed neem leaves applied to skin', keywords: 'skin neem ayurveda acne fungal' },
  { condition: 'Skin', system: 'Ayurveda', remedy: 'Turmeric + sandalwood paste', preparation: 'Mix with rose water, apply, wash after 15 min', keywords: 'skin turmeric sandalwood ayurveda glow acne' },
  { condition: 'Skin', system: 'Ayurveda', remedy: 'Coconut oil', preparation: 'Apply to dry skin/scalp', keywords: 'skin coconut oil ayurveda dry moisturizer' },
  { condition: 'Stress / Sleep', system: 'Ayurveda', remedy: 'Ashwagandha', preparation: '300-500mg daily', keywords: 'stress sleep ashwagandha ayurveda anxiety' },
  { condition: 'Stress / Sleep', system: 'Ayurveda', remedy: 'Brahmi', preparation: 'As supplement or tea', keywords: 'stress sleep brahmi ayurveda anxiety memory' },
  { condition: 'Stress / Sleep', system: 'Ayurveda', remedy: 'Warm milk with nutmeg', preparation: 'Pinch of nutmeg in warm milk before bed', keywords: 'sleep nutmeg warm milk ayurveda insomnia' },
  { condition: 'Stress / Sleep', system: 'Ayurveda', remedy: 'Chamomile tea', preparation: 'Steep chamomile in hot water', keywords: 'sleep chamomile tea ayurveda relax insomnia' },
];

module.exports = { medicines, drugInteractions, remedies };
