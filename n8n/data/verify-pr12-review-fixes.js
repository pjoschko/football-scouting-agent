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

function assertPerItemProfileLoop(workflow) {
  const splitNode = 'Kandidaten fuer Profilabgleich aufteilen';
  const loopNode = 'Profilabgleich je Kandidat';
  const executeNode = 'Player-Profil je Kandidat abrufen';
  const fanInNode = 'Kandidatenvergleich validieren';
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

function assertAsyncResearchFanOut(parent, child) {
  const tableName = 'football_scouting_research_runtime';
  const loopName = 'Research-Children dispatchen';
  const executeName = 'Recherche je Kandidat starten';
  const progressName = 'Research-Fortschritt und Fan-in pruefen';

  const loop = nodeByName(parent, loopName);
  const execute = nodeByName(parent, executeName);
  const ensureTable = nodeByName(parent, 'Research-Runtime-Tabelle sicherstellen');
  const loadRows = nodeByName(parent, 'Research-Resultate laden');
  const pollWait = nodeByName(parent, 'Auf Research-Children warten');

  // n8n Execute Sub-workflow runs mode="each" serially when waiting for child completion.
  // Therefore the parent must only serialize the short dispatch operation and explicitly
  // NOT wait for a child. n8n's no-wait path returns the input immediately after starting
  // the child execution, so subsequent loop iterations can dispatch while earlier children run.
  assert(loop.type === 'n8n-nodes-base.splitInBatches' && loop.parameters.batchSize === 1,
    `${parent.name}: Research-Dispatch muss ueber Loop Over Items batchSize=1 laufen.`);
  assert(execute.type === 'n8n-nodes-base.executeWorkflow',
    `${parent.name}: ${executeName} muss Execute Sub-workflow sein.`);
  assert(execute.typeVersion >= 1.3,
    `${parent.name}: ${executeName} muss mindestens typeVersion 1.3 verwenden; aeltere Error-Output-Semantik ist positionsabhaengig.`);
  assert(execute.parameters.mode === 'once',
    `${parent.name}: ${executeName} muss pro Dispatch genau ein Item mit mode="once" starten.`);
  assert(execute.parameters.options && execute.parameters.options.waitForSubWorkflow === false,
    `${parent.name}: ${executeName} darf nicht auf Child-Completion warten, sonst werden die Research-Zweige serialisiert.`);

  assert(targets(parent, 'Kandidaten fuer Recherche aufteilen', 0).some((t) => t.node === loopName),
    `${parent.name}: Kandidaten-Fan-out muss in den Dispatch-Loop fuehren.`);
  assert(targets(parent, loopName, 1).some((t) => t.node === executeName),
    `${parent.name}: Loop-Ausgang muss ${executeName} starten.`);
  assert(targets(parent, executeName, 0).some((t) => t.node === loopName),
    `${parent.name}: erfolgreicher Fire-and-forget-Dispatch muss sofort in den Loop zuruecklaufen.`);
  assert(targets(parent, executeName, 1).some((t) => t.node === 'Dispatch-Fehler als Unsicherheit markieren'),
    `${parent.name}: Dispatch-Fehler muessen kandidatenspezifisch persistiert werden.`);
  assert(targets(parent, loopName, 0).some((t) => t.node === 'Fan-in-Kontext herstellen'),
    `${parent.name}: erst nach Dispatch aller Kandidaten darf der Fan-in pollen.`);

  assert(ensureTable.type === 'n8n-nodes-base.dataTable'
    && ensureTable.parameters.resource === 'table'
    && ensureTable.parameters.operation === 'create'
    && ensureTable.parameters.tableName === tableName
    && ensureTable.parameters.options.createIfNotExists === true,
  `${parent.name}: Runtime-Tabelle ${tableName} muss vor dem Dispatch sichergestellt werden.`);

  assert(loadRows.type === 'n8n-nodes-base.dataTable'
    && loadRows.parameters.operation === 'get'
    && loadRows.parameters.dataTableId.value === tableName,
  `${parent.name}: Fan-in muss Ergebnisse aus ${tableName} laden.`);
  assert(pollWait.type === 'n8n-nodes-base.wait'
    && pollWait.parameters.resume === 'timeInterval',
  `${parent.name}: unvollstaendiger Fan-in muss warten und erneut pollen.`);
  assert(targets(parent, 'Research vollstaendig?', 1).some((t) => t.node === 'Auf Research-Children warten'),
    `${parent.name}: unvollstaendiger Fan-in muss in den Polling-Wait laufen.`);
  assert(targets(parent, 'Auf Research-Children warten', 0).some((t) => t.node === 'Research-Resultate laden'),
    `${parent.name}: Polling-Wait muss erneut die Runtime-Ergebnisse laden.`);

  const childWait = nodeByName(child, 'Simulierte Research-Latenz');
  const childResearch = nodeByName(child, 'Recherche-Dummy fuer Kandidat erzeugen');
  const successStore = nodeByName(child, 'Research-Erfolg speichern');
  const errorStore = nodeByName(child, 'Research-Fehler speichern');

  assert(childWait.type === 'n8n-nodes-base.wait'
    && childWait.parameters.resume === 'timeInterval'
    && Number(childWait.parameters.amount) >= 1,
  `${child.name}: Dummy-Research braucht sichtbare Latenz, damit parallele Child-Executions im UAT zeitlich ueberlappen.`);
  assert(childResearch.onError === 'continueErrorOutput',
    `${child.name}: kandidatenspezifische Research-Fehler muessen im Child normalisiert werden.`);
  for (const store of [successStore, errorStore]) {
    assert(store.type === 'n8n-nodes-base.dataTable'
      && store.parameters.operation === 'insert'
      && store.parameters.dataTableId.value === tableName,
    `${child.name}: Erfolg und Fehler muessen in ${tableName} persistiert werden.`);
  }

  assert(targets(child, 'Recherche-Dummy fuer Kandidat erzeugen', 0).some((t) => t.node === 'Research-Erfolg fuer Fan-in vorbereiten'),
    `${child.name}: Erfolgspfad muss fuer den Fan-in persistiert werden.`);
  assert(targets(child, 'Recherche-Dummy fuer Kandidat erzeugen', 1).some((t) => t.node === 'Research-Fehler als Unsicherheit markieren'),
    `${child.name}: Fehlerpfad muss als Unsicherheit persistiert werden.`);

  return nodeByName(parent, progressName).parameters.jsCode;
}

const candidates = loadWorkflow('kandidaten-suchen-subworkflow.json');
assertPerItemProfileLoop(candidates);

const dueDiligence = loadWorkflow('due-diligence-subworkflow.json');
const researchChild = loadWorkflow('recherche-subworkflow.json');
const fanInCode = assertAsyncResearchFanOut(dueDiligence, researchChild);

// Simulate persisted results from two independent child executions: A succeeds, B fails.
// This tests the actual fan-in contract used after the asynchronous dispatch.
const base = {
  requestId: 'test',
  researchBatchId: 'test-batch',
  researchStartedAt: new Date().toISOString(),
  researchTimeoutMs: 30000,
  playerSearch: { shortlist: [{ name: 'A' }, { name: 'B' }] },
};
const fanInRows = [
  {
    json: {
      batchId: 'test-batch',
      candidate: 'A',
      status: 'success',
      payload: JSON.stringify({
        candidate: 'A',
        club: 'Club A',
        contract: 'Simulierter Vertrag bis 30.06.2027',
        marketValue: '5 Mio. EUR',
        injuries: 'Keine bekannten Verletzungen',
        news: ['ok'],
        source: 'source',
        timestamp: '2026-09-08T00:00:00.000Z',
        confidence: 0.8,
        uncertain: false,
      }),
      completedAt: '2026-09-08T00:00:02.000Z',
    },
  },
  {
    json: {
      batchId: 'test-batch',
      candidate: 'B',
      status: 'error',
      payload: JSON.stringify({
        candidate: 'B',
        club: null,
        contract: null,
        marketValue: null,
        injuries: null,
        news: [],
        source: 'Recherche fehlgeschlagen',
        timestamp: '2026-09-08T00:00:02.100Z',
        confidence: 0,
        uncertain: true,
        uncertaintyReason: 'simulierter Fehler',
      }),
      completedAt: '2026-09-08T00:00:02.100Z',
    },
  },
];

const fanInResult = vm.runInNewContext(`(function () { ${fanInCode} })()`, {
  $input: { all: () => fanInRows },
  $: (name) => {
    if (name !== 'Research-Lauf vorbereiten') throw new Error(`Unexpected node lookup: ${name}`);
    return { first: () => ({ json: base }) };
  },
  Date,
  Set,
  Map,
  JSON,
  Number,
  String,
  Boolean,
  Error,
});
const fanInOutput = fanInResult[0].json;
assert(fanInOutput.researchComplete === true, 'Fan-in muss bei einem Ergebnis je Kandidat vollstaendig sein.');
assert(fanInOutput.research.length === 2, 'Fan-in muss beide Kandidaten erhalten.');
const failedResearch = fanInOutput.research.find((entry) => entry.candidate === 'B');
assert(failedResearch && failedResearch.uncertain === true && failedResearch.confidence === 0,
  'Fehlgeschlagener Child-Research muss als kandidatenspezifische Unsicherheit erhalten bleiben.');

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

console.log('OK: Profil-Loop, asynchroner Research-Fan-out/Fan-in mit Partial-Error und Transfer-Realisierbarkeit verifiziert.');
