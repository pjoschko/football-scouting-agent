#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const n8nDir = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
const node = (workflow, name) => {
  const found = workflow.nodes.find((entry) => entry.name === name);
  assert(found, `${workflow.name}: Node fehlt: ${name}`);
  return found;
};

const parent = load('due-diligence-subworkflow.json');
const child = load('recherche-subworkflow.json');

// Regression 1: Execute Sub-workflow v1.3 liefert bei continueErrorOutput
// nur { error } plus pairedItem/Metadata. Candidate und Batch duerfen deshalb
// NICHT aus dem Error-JSON erwartet werden, sondern muessen ueber die
// vorgelagerte Item-Lineage rekonstruiert werden.
const dispatchErrorCode = node(parent, 'Dispatch-Fehler als Unsicherheit markieren').parameters.jsCode;
assert(dispatchErrorCode.includes("$('Research-Children dispatchen').item.json"));
assert(dispatchErrorCode.includes("$('Research-Lauf vorbereiten').first().json"));

const runDispatchError = new Function('$input', '$', dispatchErrorCode);
const dispatchError = runDispatchError(
  { item: { json: { error: 'Child konnte nicht gestartet werden' } } },
  (name) => {
    if (name === 'Research-Children dispatchen') {
      return { item: { json: { researchCandidateName: 'Dispatch kaputt', researchBatchId: 'mixed-batch' } } };
    }
    if (name === 'Research-Lauf vorbereiten') {
      return { first: () => ({ json: { researchBatchId: 'mixed-batch' } }) };
    }
    if (name === 'Kandidaten fuer Recherche aufteilen') {
      return { item: { json: { researchCandidateName: 'Dispatch kaputt', researchBatchId: 'mixed-batch' } } };
    }
    throw new Error(`Unerwarteter Node-Zugriff: ${name}`);
  },
)[0].json;

assert.strictEqual(dispatchError.researchRuntimeBatchId, 'mixed-batch');
assert.strictEqual(dispatchError.researchRuntimeCandidate, 'Dispatch kaputt');
assert.strictEqual(dispatchError.researchBatchId, 'mixed-batch');
assert.strictEqual(dispatchError.researchCandidateName, 'Dispatch kaputt');
const dispatchPayload = JSON.parse(dispatchError.researchRuntimePayload);
assert.strictEqual(dispatchPayload.candidate, 'Dispatch kaputt');
assert.strictEqual(dispatchPayload.uncertain, true);
assert.deepStrictEqual(dispatchPayload.evidence, []);

// Der reale gemischte Fan-in muss danach weiterhin erfolgreich sein:
// ein Research-Erfolg + genau ein Dispatch-Fehler.
const successPayload = {
  candidate: 'Erfolgreich',
  club: 'Club A',
  contract: 'Vertrag bis 30.06.2028',
  contractEndDate: '2028-06-30',
  marketValue: '20 Mio. EUR',
  marketValueMEUR: 20,
  injuries: 'Keine bekannten Verletzungen',
  currentSituation: 'Stammspieler',
  transferLikelihoodNotes: 'Verein ist offen fuer einen Wechsel',
  news: ['Club ist gespraechsbereit'],
  evidence: [{ fact: 'club', claim: 'Club A', source: 'Quelle', url: 'https://example.com/club', timestamp: '2026-09-08T00:00:00Z', confidence: 0.9 }],
  source: 'Quelle',
  timestamp: '2026-09-08T00:00:00Z',
  confidence: 0.9,
  uncertain: false,
  uncertaintyReason: null,
};
const mixedBase = {
  researchBatchId: 'mixed-batch',
  researchStartedAt: '2026-09-08T10:00:00Z',
  researchTimeoutMs: 120000,
  playerSearch: { shortlist: [{ name: 'Erfolgreich' }, { name: 'Dispatch kaputt' }] },
};
const mixedRows = [
  { batchId: 'mixed-batch', candidate: 'Erfolgreich', status: 'success', payload: JSON.stringify(successPayload), completedAt: '2026-09-08T10:00:10Z' },
  { batchId: 'mixed-batch', candidate: 'Dispatch kaputt', status: 'dispatch_error', payload: dispatchError.researchRuntimePayload, completedAt: dispatchError.researchRuntimeCompletedAt },
];
const fanInCode = node(parent, 'Research-Fortschritt und Fan-in pruefen').parameters.jsCode;
const fanIn = new Function('$input', '$', fanInCode)(
  { all: () => mixedRows.map((json) => ({ json })) },
  (name) => {
    assert.strictEqual(name, 'Research-Lauf vorbereiten');
    return { first: () => ({ json: mixedBase }) };
  },
)[0].json;
assert.strictEqual(fanIn.researchComplete, true);
assert.strictEqual(fanIn.research.find((r) => r.candidate === 'Dispatch kaputt').uncertain, true);
assert.strictEqual(fanIn.research.find((r) => r.candidate === 'Erfolgreich').uncertain, false);

const validateCode = node(parent, 'Recherche pruefen').parameters.jsCode;
const validated = new Function('$input', validateCode)({ item: { json: fanIn } })[0].json;
assert.strictEqual(validated.valid, true, validated.errorMessage);
assert.strictEqual(validated.researchDegraded, false);

// Regression 2: Evidence muss den tatsaechlich verwendeten/scoring-relevanten
// Wert belegen, nicht nur denselben fact-Namen tragen.
const normalizeCode = node(child, 'Recherche-Ergebnis normalisieren').parameters.jsCode;
assert(normalizeCode.includes('sameText(entry.claim, transferLikelihoodNotes)'));
assert(normalizeCode.includes("claimHasDate(entry.claim, contractEndDate)"));
assert(normalizeCode.includes("claimNumber(entry.claim) === marketValueMEUR"));
const runNormalize = new Function('$input', '$', normalizeCode);
const triggerLookup = (name) => {
  assert.strictEqual(name, 'Wenn von anderem Workflow aufgerufen');
  return { first: () => ({ json: { researchCandidateName: 'Spieler A', researchBatchId: 'evidence-batch' } }) };
};

const goodOutput = {
  club: 'Club A',
  contract: 'Vertrag bis 30.06.2028',
  contractEndDate: '2028-06-30',
  marketValue: '20 Mio. EUR',
  marketValueMEUR: 20,
  injuries: 'Keine bekannten Verletzungen',
  currentSituation: 'Stammspieler',
  transferLikelihoodNotes: 'Verein ist offen fuer einen Wechsel',
  news: ['Club ist gespraechsbereit'],
  evidence: [
    { fact: 'club', claim: 'Club A', source: 'Quelle Club', url: 'https://example.com/club', timestamp: null, confidence: 0.9 },
    { fact: 'contract', claim: 'Vertrag bis 30.06.2028', source: 'Quelle Vertrag', url: 'https://example.com/contract', timestamp: null, confidence: 0.9 },
    { fact: 'marketValue', claim: '20 Mio. EUR', source: 'Quelle Marktwert', url: 'https://example.com/value', timestamp: null, confidence: 0.8 },
    { fact: 'injuries', claim: 'Keine bekannten Verletzungen', source: 'Quelle Injury', url: 'https://example.com/injury', timestamp: null, confidence: 0.8 },
    { fact: 'currentSituation', claim: 'Stammspieler', source: 'Quelle Situation', url: 'https://example.com/situation', timestamp: null, confidence: 0.8 },
    { fact: 'transferLikelihoodNotes', claim: 'Verein ist offen fuer einen Wechsel', source: 'Quelle Transfer', url: 'https://example.com/transfer', timestamp: null, confidence: 0.9 },
    { fact: 'news', claim: 'Club ist gespraechsbereit', source: 'Quelle News', url: 'https://example.com/news', timestamp: null, confidence: 0.8 },
  ],
};

const good = runNormalize({ item: { json: { output: goodOutput } } }, triggerLookup)[0].json;
const goodPayload = JSON.parse(good.researchRuntimePayload);
assert.strictEqual(good.researchRuntimeStatus, 'success');
assert.strictEqual(goodPayload.uncertain, false);

const contradictoryTransfer = JSON.parse(JSON.stringify(goodOutput));
contradictoryTransfer.transferLikelihoodNotes = 'Spieler ist wechselbereit';
contradictoryTransfer.evidence = contradictoryTransfer.evidence.map((entry) =>
  entry.fact === 'transferLikelihoodNotes'
    ? { ...entry, claim: 'Verein lehnt einen Verkauf kategorisch ab' }
    : entry,
);
const badTransfer = runNormalize({ item: { json: { output: contradictoryTransfer } } }, triggerLookup)[0].json;
const badTransferPayload = JSON.parse(badTransfer.researchRuntimePayload);
assert.strictEqual(badTransfer.researchRuntimeStatus, 'uncertain');
assert.strictEqual(badTransferPayload.uncertain, true);
assert(badTransferPayload.uncertaintyReason.includes('transferLikelihoodNotes'));

const contradictoryCanonical = JSON.parse(JSON.stringify(goodOutput));
contradictoryCanonical.contractEndDate = '2029-06-30';
contradictoryCanonical.marketValueMEUR = 30;
const badCanonical = runNormalize({ item: { json: { output: contradictoryCanonical } } }, triggerLookup)[0].json;
const badCanonicalPayload = JSON.parse(badCanonical.researchRuntimePayload);
assert.strictEqual(badCanonical.researchRuntimeStatus, 'uncertain');
assert(badCanonicalPayload.uncertaintyReason.includes('contractEndDate'));
assert(badCanonicalPayload.uncertaintyReason.includes('marketValueMEUR'));

console.log('OK: PR14 realer Dispatch-Error-Kontext und wertgebundene Evidence-Provenienz verifiziert.');
