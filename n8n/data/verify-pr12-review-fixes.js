#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const n8nDir = path.resolve(__dirname, '..');

function loadWorkflow(name) {
  return JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`${workflow.name}: Node "${name}" fehlt.`);
  return node;
}

function targets(workflow, from, outputIndex) {
  const connection = workflow.connections[from];
  if (!connection || !Array.isArray(connection.main) || !Array.isArray(connection.main[outputIndex])) return [];
  return connection.main[outputIndex].map((entry) => entry.node);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPerItemLoop(workflow, splitNode, loopNode, executeNode, fanInNode, expectErrorLoopBack) {
  const loop = nodeByName(workflow, loopNode);
  const execute = nodeByName(workflow, executeNode);

  assert(loop.type === 'n8n-nodes-base.splitInBatches', `${workflow.name}: ${loopNode} muss Loop Over Items sein.`);
  assert(loop.typeVersion === 3, `${workflow.name}: ${loopNode} muss typeVersion 3 verwenden.`);
  assert(loop.parameters.batchSize === 1, `${workflow.name}: ${loopNode} muss batchSize=1 verwenden.`);
  assert(execute.parameters.mode === 'once', `${workflow.name}: ${executeNode} muss explizit mode="once" verwenden.`);

  assert(targets(workflow, splitNode, 0).includes(loopNode), `${workflow.name}: ${splitNode} muss in ${loopNode} fuehren.`);
  assert(targets(workflow, loopNode, 1).includes(executeNode), `${workflow.name}: Loop-Ausgang von ${loopNode} muss ${executeNode} starten.`);
  assert(targets(workflow, executeNode, 0).includes(loopNode), `${workflow.name}: Erfolg von ${executeNode} muss in ${loopNode} zuruecklaufen.`);
  assert(targets(workflow, loopNode, 0).includes(fanInNode), `${workflow.name}: Done-Ausgang von ${loopNode} muss in ${fanInNode} fuehren.`);

  if (expectErrorLoopBack) {
    assert(targets(workflow, executeNode, 1).includes(loopNode), `${workflow.name}: Fehlerausgang von ${executeNode} muss in ${loopNode} zuruecklaufen.`);
    assert(execute.onError === 'continueErrorOutput', `${workflow.name}: ${executeNode} muss Fehler als separaten Output weitergeben.`);
  }
}

const candidates = loadWorkflow('kandidaten-suchen-subworkflow.json');
assertPerItemLoop(
  candidates,
  'Kandidaten fuer Profilabgleich aufteilen',
  'Profilabgleich je Kandidat',
  'Player-Profil je Kandidat abrufen',
  'Kandidatenvergleich validieren',
  false,
);

const dueDiligence = loadWorkflow('due-diligence-subworkflow.json');
assertPerItemLoop(
  dueDiligence,
  'Kandidaten fuer Recherche aufteilen',
  'Recherche je Kandidat',
  'Recherche je Kandidat durchfuehren',
  'Recherche-Ergebnisse zusammenfuehren',
  true,
);

const recommendation = loadWorkflow('empfehlung-erstellen-subworkflow.json');
const recommendationCode = nodeByName(recommendation, 'Empfehlung erzeugen').parameters.jsCode;

const now = new Date();
function futureContract(years) {
  const d = new Date(Date.UTC(now.getUTCFullYear() + years, now.getUTCMonth(), now.getUTCDate()));
  return `Simulierter Vertrag bis ${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}

const testItem = {
  playerSearch: {
    shortlist: [
      { name: 'Analytics Star', score: 95 },
      { name: 'Machbarer Kandidat', score: 82 },
    ],
  },
  research: [
    {
      candidate: 'Analytics Star',
      contract: futureContract(6),
      marketValue: '80 Mio. EUR',
      injuries: 'Wiederkehrende schwere Verletzungen',
      news: ['Der Verein bezeichnet den Spieler als unverkäuflich.'],
      confidence: 0.95,
      uncertain: false,
    },
    {
      candidate: 'Machbarer Kandidat',
      contract: futureContract(1),
      marketValue: '5 Mio. EUR',
      injuries: 'Keine bekannten Verletzungen',
      news: ['Der Spieler gilt als wechselbereit und hat Transferfreigabe.'],
      confidence: 0.40,
      uncertain: false,
    },
  ],
};

const result = vm.runInNewContext(`(function () { ${recommendationCode} })()`, {
  $input: { item: { json: testItem } },
  Date,
  Map,
  Math,
  Number,
  Array,
  String,
  RegExp,
});

const output = result[0].json.recommendation;
assert(output.candidate === 'Machbarer Kandidat',
  `Feasibility-Gegenbeispiel fehlgeschlagen: erwartet "Machbarer Kandidat", erhalten "${output.candidate}".`);

const star = output.candidateEvaluations.find((entry) => entry.candidate === 'Analytics Star');
const feasible = output.candidateEvaluations.find((entry) => entry.candidate === 'Machbarer Kandidat');
assert(star && feasible, 'candidateEvaluations muessen beide Testkandidaten enthalten.');
assert(star.analyticsScore > feasible.analyticsScore, 'Testaufbau ungueltig: Analytics Star muss analytisch besser sein.');
assert(star.feasibilityScore < feasible.feasibilityScore, 'Transfer-Realisierbarkeit muss den Gegenkandidaten bevorzugen.');
assert(feasible.combinedScore > star.combinedScore, 'Kombinierter Score muss den realisierbareren Kandidaten bevorzugen.');
assert(feasible.researchConfidence < star.researchConfidence,
  'Test muss zeigen, dass Research-Confidence nicht mit Transfer-Realisierbarkeit gleichgesetzt wird.');

console.log('OK: per-item loops und echte Transfer-Realisierbarkeitsbewertung verifiziert.');
