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
  return connection.main[outputIndex];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPerItemLoop(workflow, splitNode, loopNode, executeNode, fanInNode) {
  const loop = nodeByName(workflow, loopNode);
  const execute = nodeByName(workflow, executeNode);

  assert(loop.type === 'n8n-nodes-base.splitInBatches', `${workflow.name}: ${loopNode} muss Loop Over Items sein.`);
  assert(loop.typeVersion === 3, `${workflow.name}: ${loopNode} muss typeVersion 3 verwenden.`);
  assert(loop.parameters.batchSize === 1, `${workflow.name}: ${loopNode} muss batchSize=1 verwenden.`);
  assert(execute.parameters.mode === 'once', `${workflow.name}: ${executeNode} muss explizit mode="once" verwenden.`);

  assert(targets(workflow, splitNode, 0).some((t) => t.node === loopNode), `${workflow.name}: ${splitNode} muss in ${loopNode} fuehren.`);
  assert(targets(workflow, loopNode, 1).some((t) => t.node === executeNode), `${workflow.name}: Loop-Ausgang von ${loopNode} muss ${executeNode} starten.`);
  assert(targets(workflow, executeNode, 0).some((t) => t.node === loopNode), `${workflow.name}: Erfolg von ${executeNode} muss in ${loopNode} zuruecklaufen.`);
  assert(targets(workflow, loopNode, 0).some((t) => t.node === fanInNode), `${workflow.name}: Done-Ausgang von ${loopNode} muss in ${fanInNode} fuehren.`);
}

function assertParallelSubworkflowFanOut(workflow) {
  const splitName = 'Kandidaten fuer Recherche aufteilen';
  const executeName = 'Recherche je Kandidat durchfuehren';
  const mergeName = 'Research-Zweige einsammeln';
  const fanInName = 'Recherche-Ergebnisse zusammenfuehren';

  const execute = nodeByName(workflow, executeName);
  const merge = nodeByName(workflow, mergeName);

  assert(!workflow.nodes.some((node) => node.type === 'n8n-nodes-base.splitInBatches'),
    `${workflow.name}: Due Diligence darf keinen Loop Over Items enthalten, weil dieser die Research-Ausfuehrungen serialisiert.`);
  assert(execute.type === 'n8n-nodes-base.executeWorkflow', `${workflow.name}: ${executeName} muss Execute Sub-workflow sein.`);
  assert(execute.parameters.mode === 'each',
    `${workflow.name}: ${executeName} muss mode="each" verwenden, damit je Kandidat eine eigene Child-Execution gestartet wird.`);
  assert(execute.parameters.options && execute.parameters.options.waitForSubWorkflow === true,
    `${workflow.name}: ${executeName} muss auf die parallel gestarteten Child-Executions warten, bevor der Fan-in weiterlaeuft.`);
  assert(execute.onError === 'continueErrorOutput',
    `${workflow.name}: ${executeName} muss fehlgeschlagene Kandidaten auf dem Fehlerausgang erhalten.`);

  assert(targets(workflow, splitName, 0).some((t) => t.node === executeName),
    `${workflow.name}: Kandidaten-Fan-out muss direkt in ${executeName} fuehren.`);

  const successTargets = targets(workflow, executeName, 0);
  const errorTargets = targets(workflow, executeName, 1);
  assert(successTargets.some((t) => t.node === mergeName && t.index === 0),
    `${workflow.name}: Erfolgsoutput muss auf Input 0 von ${mergeName} gehen.`);
  assert(errorTargets.some((t) => t.node === mergeName && t.index === 1),
    `${workflow.name}: Fehleroutput muss auf Input 1 von ${mergeName} gehen.`);

  assert(merge.type === 'n8n-nodes-base.merge', `${workflow.name}: ${mergeName} muss ein Merge-Node sein.`);
  assert(merge.parameters.mode === 'append', `${workflow.name}: ${mergeName} muss Append verwenden.`);
  assert(merge.parameters.numberInputs === 2, `${workflow.name}: ${mergeName} muss Erfolg + Fehler zusammenfuehren.`);
  assert(targets(workflow, mergeName, 0).some((t) => t.node === fanInName),
    `${workflow.name}: ${mergeName} muss in ${fanInName} fuehren.`);
}

const candidates = loadWorkflow('kandidaten-suchen-subworkflow.json');
assertPerItemLoop(
  candidates,
  'Kandidaten fuer Profilabgleich aufteilen',
  'Profilabgleich je Kandidat',
  'Player-Profil je Kandidat abrufen',
  'Kandidatenvergleich validieren',
);

const dueDiligence = loadWorkflow('due-diligence-subworkflow.json');
assertParallelSubworkflowFanOut(dueDiligence);

const fanInCode = nodeByName(dueDiligence, 'Recherche-Ergebnisse zusammenfuehren').parameters.jsCode;
const fanInInput = [
  {
    json: {
      playerSearch: { shortlist: [{ name: 'A' }, { name: 'B' }] },
      researchCandidateName: 'A',
      researchResult: {
        candidate: 'A',
        club: 'Club A',
        contract: 'bis 2027',
        marketValue: '5 Mio. EUR',
        injuries: 'Keine bekannten Verletzungen',
        news: ['ok'],
        source: 'source',
        timestamp: '2026-09-08T00:00:00.000Z',
        confidence: 0.8,
      },
    },
  },
  {
    json: {
      playerSearch: { shortlist: [{ name: 'A' }, { name: 'B' }] },
      researchCandidateName: 'B',
      error: { message: 'simulierter Fehler' },
    },
  },
];

const fanInResult = vm.runInNewContext(`(function () { ${fanInCode} })()`, {
  $input: { all: () => fanInInput },
  Date,
  String,
});
const research = fanInResult[0].json.research;
assert(research.length === 2, 'Due-Diligence-Fan-in muss Erfolg und Fehler beider Kandidaten erhalten.');
const failed = research.find((entry) => entry.candidate === 'B');
assert(failed && failed.uncertain === true && failed.confidence === 0,
  'Fehlgeschlagener paralleler Research-Zweig muss als kandidatenspezifische Unsicherheit erhalten bleiben.');

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

console.log('OK: kandidatengenauer Profil-Loop, paralleler Due-Diligence-Fan-out/Fan-in und Transfer-Realisierbarkeit verifiziert.');
