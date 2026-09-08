#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const n8nDir = path.resolve(__dirname, '..');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function node(workflow, name) {
  const value = workflow.nodes.find((candidate) => candidate.name === name);
  if (!value) fail(`${workflow.name}: Node "${name}" fehlt.`);
  return value;
}

function targets(workflow, from, output = 0, connectionType = 'main') {
  const entry = workflow.connections[from];
  if (!entry || !Array.isArray(entry[connectionType]) || !Array.isArray(entry[connectionType][output])) return [];
  return entry[connectionType][output];
}

function assertGraph(workflow) {
  const names = workflow.nodes.map((n) => n.name);
  const ids = workflow.nodes.map((n) => n.id);
  assert(new Set(names).size === names.length, `${workflow.name}: Node-Namen muessen eindeutig sein.`);
  assert(new Set(ids).size === ids.length, `${workflow.name}: Node-IDs muessen eindeutig sein.`);
  const known = new Set(names);
  for (const [source, groups] of Object.entries(workflow.connections || {})) {
    assert(known.has(source), `${workflow.name}: Connection-Quelle "${source}" existiert nicht.`);
    for (const outputs of Object.values(groups)) {
      if (!Array.isArray(outputs)) continue;
      for (const output of outputs) {
        if (!Array.isArray(output)) continue;
        for (const target of output) {
          assert(known.has(target.node), `${workflow.name}: Connection-Ziel "${target.node}" existiert nicht.`);
        }
      }
    }
  }
}

const parent = load('due-diligence-subworkflow.json');
const child = load('recherche-subworkflow.json');
assertGraph(parent);
assertGraph(child);

// 1) Expliziter Child-Input-Vertrag. Kein implizites passthrough mehr.
const trigger = node(child, 'Wenn von anderem Workflow aufgerufen');
const declaredInputs = trigger.parameters?.workflowInputs?.values || [];
assert(trigger.typeVersion >= 1.2, 'Recherche: Execute Workflow Trigger muss typed workflowInputs unterstuetzen.');
assert(!Object.prototype.hasOwnProperty.call(trigger.parameters || {}, 'inputSource'), 'Recherche: implizites inputSource/passthrough darf nicht mehr verwendet werden.');
assert(declaredInputs.some((v) => v.name === 'researchCandidateName' && v.type === 'string'), 'Recherche: researchCandidateName muss als String-Workflow-Input deklariert sein.');
assert(declaredInputs.some((v) => v.name === 'researchBatchId' && v.type === 'string'), 'Recherche: researchBatchId muss als String-Workflow-Input deklariert sein.');

// 2) Parent mappt exakt dieselben Werte in den Fire-and-forget Child.
const dispatch = node(parent, 'Recherche je Kandidat starten');
const mapped = dispatch.parameters?.workflowInputs?.value || {};
assert(mapped.researchCandidateName === '={{ $json.researchCandidateName }}', 'Due Diligence: researchCandidateName muss explizit in den Child gemappt werden.');
assert(mapped.researchBatchId === '={{ $json.researchBatchId }}', 'Due Diligence: researchBatchId muss explizit in den Child gemappt werden.');
assert(dispatch.parameters?.options?.waitForSubWorkflow === false, 'Due Diligence: Research-Dispatch muss fire-and-forget bleiben.');

// 3) Der Startmarker bleibt vor dem Agenten, darf dessen Input aber nicht implizit liefern.
// Data Table Insert gibt Insert-Metadaten aus; deshalb muss der Agent seinen Kandidaten
// direkt aus dem Execute-Workflow-Trigger lesen.
const start = node(child, 'Recherche-Start markieren');
const agent = node(child, 'Recherche-Agent');
assert(start.type === 'n8n-nodes-base.dataTable', 'Recherche: Startmarker muss in der Runtime-Data-Table persistiert werden.');
assert(targets(child, 'Wenn von anderem Workflow aufgerufen').some((t) => t.node === 'Recherche-Start markieren'), 'Recherche: Trigger muss zuerst den started-Marker schreiben.');
assert(targets(child, 'Recherche-Start markieren').some((t) => t.node === 'Recherche-Agent'), 'Recherche: started-Marker muss anschliessend den Agent starten.');
assert(agent.parameters?.text?.includes("$('Wenn von anderem Workflow aufgerufen').first().json.researchCandidateName"), 'Recherche: Agent muss researchCandidateName direkt aus dem Child-Trigger lesen.');
assert(!agent.parameters?.text?.includes('{{ $json.researchCandidateName }}'), 'Recherche: Agent darf nach dem Data-Table-Insert nicht auf $json.researchCandidateName vertrauen.');

// 4) Success/Error stellen Batch+Candidate ebenfalls explizit aus dem Trigger wieder her.
for (const name of ['Recherche-Ergebnis normalisieren', 'Recherche-Fehler als Unsicherheit markieren']) {
  const code = node(child, name).parameters?.jsCode || '';
  assert(code.includes("$('Wenn von anderem Workflow aufgerufen').first().json"), `Recherche: ${name} muss Trigger-Kontext explizit wiederherstellen.`);
  assert(code.includes('researchRuntimeBatchId: trigger.researchBatchId'), `Recherche: ${name} muss researchBatchId fuer den Fan-in persistieren.`);
}

// 5) Tool-faehiges Zielmodell und Terminalpersistenz bleiben erhalten.
const model = node(child, 'Ollama Modell (qwen3.8-agent-128k:latest)');
assert(model.parameters?.model === 'qwen3.8-agent-128k:latest', 'Recherche: erwartetes tool-faehiges Agent-Modell fehlt.');
const successCode = node(child, 'Recherche-Ergebnis normalisieren').parameters.jsCode;
const errorCode = node(child, 'Recherche-Fehler als Unsicherheit markieren').parameters.jsCode;
assert(successCode.includes("researchRuntimeStatus: uncertain ? 'uncertain' : 'success'"), 'Recherche: Success/uncertain-Terminalstatus fehlt.');
assert(errorCode.includes("researchRuntimeStatus: 'agent_error'"), 'Recherche: agent_error-Terminalstatus fehlt.');

// 6) started ist Diagnosezustand, kein Terminalzustand; all-uncertain ist degraded statt invalid.
const fanInCode = node(parent, 'Research-Fortschritt und Fan-in pruefen').parameters?.jsCode || '';
assert(fanInCode.includes("row.status !== 'started'"), 'Due Diligence: started-Zeilen duerfen den Fan-in nicht als abgeschlossen markieren.');
const validateCode = node(parent, 'Recherche pruefen').parameters?.jsCode || '';
assert(validateCode.includes('researchDegraded'), 'Due Diligence: all-uncertain muss als researchDegraded ausgewiesen werden.');
assert(!validateCode.includes("errors.push('Fuer keinen Kandidaten konnte eine Recherche erfolgreich durchgefuehrt werden.')"), 'Due Diligence: all-uncertain darf nicht mehr hart invalidieren.');

const setupCode = node(parent, 'Research-Lauf vorbereiten').parameters?.jsCode || '';
assert(setupCode.includes('researchTimeoutMs: 120000'), 'Due Diligence: Research-Timeout muss 120 Sekunden betragen.');

console.log('OK: PR14 Parent→Child-Vertrag, started-Diagnosepfad, Agent-Kontext, Terminalstatus und degraded Research verifiziert.');
