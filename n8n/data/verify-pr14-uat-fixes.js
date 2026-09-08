#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const n8nDir = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
const node = (workflow, name) => { const found = workflow.nodes.find((entry) => entry.name === name); assert(found, `${workflow.name}: Node fehlt: ${name}`); return found; };
const targets = (workflow, from, output = 0, type = 'main') => workflow.connections?.[from]?.[type]?.[output] || [];
const parent = load('due-diligence-subworkflow.json');
const child = load('recherche-subworkflow.json');
const recommendation = load('empfehlung-erstellen-subworkflow.json');
const resultWorkflow = load('ergebnis-aufbereiten-subworkflow.json');
for (const workflow of [parent, child, recommendation, resultWorkflow]) {
  const names = workflow.nodes.map((n) => n.name); const ids = workflow.nodes.map((n) => n.id);
  assert.strictEqual(new Set(names).size, names.length, `${workflow.name}: Node-Namen nicht eindeutig.`);
  assert.strictEqual(new Set(ids).size, ids.length, `${workflow.name}: Node-IDs nicht eindeutig.`);
}
const trigger = node(child, 'Wenn von anderem Workflow aufgerufen');
const inputs = trigger.parameters?.workflowInputs?.values || [];
assert(inputs.some((v) => v.name === 'researchCandidateName' && v.type === 'string'));
assert(inputs.some((v) => v.name === 'researchBatchId' && v.type === 'string'));
assert(!Object.prototype.hasOwnProperty.call(trigger.parameters || {}, 'inputSource'));
const dispatch = node(parent, 'Recherche je Kandidat starten');
assert.strictEqual(dispatch.parameters?.workflowInputs?.value?.researchCandidateName, '={{ $json.researchCandidateName }}');
assert.strictEqual(dispatch.parameters?.workflowInputs?.value?.researchBatchId, '={{ $json.researchBatchId }}');
assert.strictEqual(dispatch.parameters?.options?.waitForSubWorkflow, false);
assert.strictEqual(child.settings?.executionTimeout, 120, 'Recherche-Child muss eigenes executionTimeout=120 Sekunden haben.');
const setupCode = node(parent, 'Research-Lauf vorbereiten').parameters.jsCode;
assert(setupCode.includes('researchTimeoutMs: 120000'));
const fanInCode = node(parent, 'Research-Fortschritt und Fan-in pruefen').parameters.jsCode;
assert(fanInCode.includes('startedByCandidate'));
assert(fanInCode.includes('nowMs - anchorMs >= branchTimeoutMs'));
assert(fanInCode.includes('started && started.completedAt ? started.completedAt : base.researchStartedAt'));
assert(!fanInCode.includes('Date.now() - new Date(base.researchStartedAt)'));
const originalNow = Date.now;
Date.now = () => Date.parse('2026-09-08T10:02:01Z');
try {
  const runFanIn = new Function('$input', '$', fanInCode);
  const base = { researchBatchId:'batch', researchStartedAt:'2026-09-08T10:00:00Z', researchTimeoutMs:120000, playerSearch:{shortlist:[{name:'A'},{name:'B'}]} };
  const rows = [
    {batchId:'batch',candidate:'A',status:'started',completedAt:'2026-09-08T10:00:00Z'},
    {batchId:'batch',candidate:'B',status:'started',completedAt:'2026-09-08T10:01:30Z'}
  ];
  const out = runFanIn({all:()=>rows.map((json)=>({json}))}, (name)=>{ assert.strictEqual(name,'Research-Lauf vorbereiten'); return {first:()=>({json:base})}; })[0].json;
  assert.deepStrictEqual(out.researchTimedOutCandidates,['A']);
  assert.strictEqual(out.researchComplete,false,'Spaeter gestarteter Zweig B muss eigene 120s erhalten.');
  assert(out.research.some((r)=>r.candidate==='A'&&r.uncertain));
  const missingStartBase = { researchBatchId:'batch-missing-start', researchStartedAt:'2026-09-08T09:59:00Z', researchTimeoutMs:120000, playerSearch:{shortlist:[{name:'C'}]} };
  const missingStartOut = runFanIn({all:()=>[]}, (name)=>{ assert.strictEqual(name,'Research-Lauf vorbereiten'); return {first:()=>({json:missingStartBase})}; })[0].json;
  assert.deepStrictEqual(missingStartOut.researchTimedOutCandidates,['C']);
  assert.strictEqual(missingStartOut.researchComplete,true);
  assert(missingStartOut.research[0].uncertaintyReason.includes('keinen started- oder Terminalstatus'));
} finally { Date.now = originalNow; }
assert(targets(parent,'Research vollstaendig?',0).some((t)=>t.node==='Research-Runtime aufraeumen'));
const schema = JSON.parse(node(child,'Recherche-Ergebnis Output-Schema').parameters.inputSchema);
assert(schema.required.includes('evidence'));
const evidenceSchema = schema.properties?.evidence?.items;
for (const field of ['fact','claim','source','url','timestamp','confidence']) assert(evidenceSchema.required.includes(field),`Evidence muss ${field} verlangen.`);
const normalizeCode = node(child,'Recherche-Ergebnis normalisieren').parameters.jsCode;
assert(normalizeCode.includes('missingEvidenceFacts')); assert(normalizeCode.includes('uncoveredNews')); assert(normalizeCode.includes('evidence'));
const runNormalize = new Function('$input','$',normalizeCode);
const normalized = runNormalize({item:{json:{output:{
  club:'Club A', contract:'Vertrag bis 30.06.2028', contractEndDate:'2028-06-30', marketValue:'20 Mio. EUR', marketValueMEUR:20,
  injuries:'Keine bekannten Verletzungen', currentSituation:'Stammspieler', transferLikelihoodNotes:'Verein ist offen fuer einen Wechsel', news:['Club ist gespraechsbereit'],
  evidence:[
    {fact:'club',claim:'Club A',source:'Quelle Club',url:'https://example.com/club',timestamp:null,confidence:0.9},
    {fact:'contract',claim:'Vertrag bis 30.06.2028',source:'Quelle Vertrag',url:'https://example.com/contract',timestamp:'2026-09-01T00:00:00Z',confidence:0.9},
    {fact:'marketValue',claim:'20 Mio. EUR',source:'Quelle Marktwert',url:'https://example.com/value',timestamp:null,confidence:0.8},
    {fact:'injuries',claim:'Keine bekannten Verletzungen',source:'Quelle Injury',url:'https://example.com/injury',timestamp:null,confidence:0.8},
    {fact:'currentSituation',claim:'Stammspieler',source:'Quelle Situation',url:'https://example.com/situation',timestamp:null,confidence:0.8},
    {fact:'transferLikelihoodNotes',claim:'Verein ist offen fuer einen Wechsel',source:'Quelle Transfer',url:'https://example.com/transfer',timestamp:null,confidence:0.9},
    {fact:'news',claim:'Club ist gespraechsbereit',source:'Quelle News',url:'https://example.com/news',timestamp:null,confidence:0.8}
  ]
}}}}, (name)=>{ assert.strictEqual(name,'Wenn von anderem Workflow aufgerufen'); return {first:()=>({json:{researchCandidateName:'Spieler A',researchBatchId:'batch'}})}; })[0].json;
const payload = JSON.parse(normalized.researchRuntimePayload);
assert.strictEqual(payload.uncertain,false); assert.strictEqual(payload.evidence.length,7);
assert(payload.evidence.every((e)=>e.source&&e.url&&e.timestamp&&typeof e.confidence==='number'));
const resultCode = node(resultWorkflow,'Ergebnisseiten aufbereiten').parameters.jsCode;
for (const field of ['evidence.source','evidence.url','evidence.timestamp','evidence.confidence']) assert(resultCode.includes(field),`Ergebnisdarstellung muss ${field} ausgeben.`);
const recommendationCode = node(recommendation,'Empfehlung erzeugen').parameters.jsCode;
const dateCheck = recommendationCode.indexOf('r.contractEndDate'); const legacyExpiring = recommendationCode.indexOf('/auslaufend/i');
assert(dateCheck>=0&&legacyExpiring>dateCheck,'contractEndDate muss vor dem auslaufend-Fallback ausgewertet werden.');
assert(recommendationCode.includes('scoreTransferLikelihood')); assert(recommendationCode.includes('scoreCurrentSituation'));
assert(recommendationCode.includes("['transferLikelihood',0.15]") || recommendationCode.includes("['transferLikelihood', 0.15]"));
assert(recommendationCode.includes("['currentSituation',0.10]") || recommendationCode.includes("['currentSituation', 0.10]"));
const runRecommendation = new Function('$input',recommendationCode);
const common={club:'Club',contract:'Vertrag bis 30.06.2028',contractEndDate:'2028-06-30',marketValue:'20 Mio. EUR',marketValueMEUR:20,injuries:'Keine bekannten Verletzungen',news:['Keine eindeutigen Transfer-News'],confidence:0.9,uncertain:false,evidence:[]};
const recommendationOut=runRecommendation({item:{json:{playerSearch:{shortlist:[{name:'Analytics 1',score:90},{name:'Realistisch',score:88}]},research:[
  {...common,candidate:'Analytics 1',transferLikelihoodNotes:'Verein lehnt einen Verkauf kategorisch ab',currentSituation:'Unverzichtbarer Schluesselspieler'},
  {...common,candidate:'Realistisch',transferLikelihoodNotes:'Spieler ist wechselbereit und der Verein ist verkaufsbereit',currentSituation:'Aktuell nur Bank und wenig Einsatzzeit'}
]}}})[0].json.recommendation;
assert.strictEqual(recommendationOut.candidate,'Realistisch','Transferrealisierbarkeit muss die Rangfolge veraendern koennen.');
const validateCode=node(parent,'Recherche pruefen').parameters.jsCode;
assert(validateCode.includes('researchDegraded')); assert(validateCode.includes('r.evidence'));
console.log('OK: PR14 Evidenz-Provenienz, kanonisches Vertragsdatum, Availability-Scoring und per-Child-Timeout verifiziert.');
