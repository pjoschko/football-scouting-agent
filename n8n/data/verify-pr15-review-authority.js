'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const n8nDir = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
const node = (workflow, name) => {
  const found = workflow.nodes.find((entry) => entry.name === name);
  assert(found, `Node fehlt: ${name}`);
  return found;
};

const main = load('ai-sporting-director.json');
const scoutingBriefWorkflow = load('scouting-brief-subworkflow.json');
const resultWorkflow = load('ergebnis-aufbereiten-subworkflow.json');

const reviewCode = node(main, 'Review-Entscheidung auswerten').parameters.jsCode;
const runReview = (submitted, original) => {
  const fn = new Function('$input', '$', reviewCode);
  const result = fn(
    { item: { json: submitted } },
    (name) => {
      assert.strictEqual(name, 'Execute Workflow: Scouting Brief erstellen');
      return { first: () => ({ json: original }) };
    },
  );
  assert(Array.isArray(result) && result.length === 1, 'Review-Code muss genau ein Item liefern.');
  return result[0].json;
};

const original = {
  club: 'Hamburger SV',
  objective: 'Kader verbessern',
  additionalContext: '',
  teamDiagnosis: {
    mainProblem: 'Altes KI-Hauptproblem',
    diagnosisCategory: 'defensive',
    hypotheses: ['Hypothese A'],
    counterHypotheses: [],
    leagueComparison: 'Vergleich',
    uncertainties: ['Alte KI-Unsicherheit'],
  },
  playerProfile: {
    position: 'Innenverteidiger',
    role: 'Alte Rolle',
    reasoning: 'Alte Begruendung',
    weightedCriteria: [{ criterion: 'appearances', weight: 1 }],
    constraints: [],
  },
  scoutingBrief: {
    problem: 'Altes KI-Hauptproblem',
    targetPosition: 'Innenverteidiger',
    role: 'Alte Rolle',
    reasoning: 'Alte Begruendung',
    weightedCriteria: [{ criterion: 'appearances', weight: 1 }],
    constraints: [],
    uncertainties: ['Alte KI-Unsicherheit'],
    reviewRound: 1,
    maxReviewRounds: 3,
    feedbackHistory: [],
  },
};

const editedBase = {
  'Hauptproblem (Diagnose)': 'Vom Reviewer korrigiertes Hauptproblem',
  Zielposition: 'Defensives Mittelfeld',
  Rolle: 'Vom Reviewer korrigierte Rolle',
  Begruendung: 'Vom Reviewer korrigierte Begruendung',
  'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'assists', weight: 0.7 }]),
  'Constraints (JSON-Array)': JSON.stringify([{ field: 'age', operator: 'max', value: 26 }]),
  'Unsicherheiten (JSON-Array)': JSON.stringify(['Vom Reviewer korrigierte Unsicherheit']),
};

const approved = runReview({ ...editedBase, Entscheidung: 'Approve' }, original);
assert.strictEqual(approved.valid, true);
assert.strictEqual(approved.reviewOutcome, 'Approve');
assert.strictEqual(approved.scoutingBrief.problem, 'Vom Reviewer korrigiertes Hauptproblem');
assert.deepStrictEqual(approved.scoutingBrief.uncertainties, ['Vom Reviewer korrigierte Unsicherheit']);
assert.strictEqual(approved.playerProfile.position, 'Defensives Mittelfeld');
assert.deepStrictEqual(approved.playerProfile.constraints, [{ field: 'age', operator: 'max', value: 26 }]);
assert.strictEqual(approved.teamDiagnosis.mainProblem, 'Vom Reviewer korrigiertes Hauptproblem');
assert.deepStrictEqual(approved.teamDiagnosis.uncertainties, ['Vom Reviewer korrigierte Unsicherheit']);
assert.strictEqual(approved.teamDiagnosis.diagnosisCategory, 'defensive', 'Nicht editierbare Diagnosefelder muessen erhalten bleiben.');
assert.strictEqual(approved.scoutingBrief.reviewRound, 1, 'Review-Metadaten duerfen durch reine Form-Edits nicht veraendert werden.');

// Approve: der reale Ergebnis-Formatter liest weiterhin teamDiagnosis.mainProblem.
// Der synchronisierte Review-Output muss deshalb im finalen Text sichtbar sein.
const formatCode = node(resultWorkflow, 'Ergebnisseiten aufbereiten').parameters.jsCode;
const runFormatter = new Function('$input', formatCode);
const formattedInput = {
  ...approved,
  playerSearch: { longlistSize: 1, shortlist: [{ name: 'Kandidat A', score: 88 }] },
  research: [{ candidate: 'Kandidat A', uncertain: true, uncertaintyReason: 'Test' }],
  recommendation: { candidate: 'Kandidat A', reasoning: 'Test', nextStep: 'Test', alternatives: [], risks: ['Test'], uncertainties: ['Test'] },
};
const formatted = runFormatter({ item: { json: formattedInput } })[0].json.formattedResult;
assert(formatted.includes('Hauptproblem: Vom Reviewer korrigiertes Hauptproblem'), 'Finaler Output muss das editierte Hauptproblem anzeigen.');
assert(!formatted.includes('Hauptproblem: Altes KI-Hauptproblem'), 'Finaler Output darf das alte KI-Hauptproblem nicht wiederherstellen.');

// Request Changes: die naechste Brief-Runde liest Hauptproblem und Unsicherheiten
// aus teamDiagnosis; daher muessen genau die Formularwerte dort stehen.
const requested = runReview({
  ...editedBase,
  Entscheidung: 'Request Changes',
  'Feedback (Pflicht bei Request Changes)': 'Bitte Profil neu gewichten.',
}, original);
assert.strictEqual(requested.valid, true);
assert.strictEqual(requested.reviewOutcome, 'Request Changes');
assert.strictEqual(requested.teamDiagnosis.mainProblem, 'Vom Reviewer korrigiertes Hauptproblem');
assert.deepStrictEqual(requested.teamDiagnosis.uncertainties, ['Vom Reviewer korrigierte Unsicherheit']);

const profilePrompt = node(scoutingBriefWorkflow, 'Spielerprofil LLM').parameters.text;
assert(profilePrompt.includes('$json.teamDiagnosis.mainProblem'), 'Request-Changes-LLM muss das synchronisierte teamDiagnosis.mainProblem konsumieren.');
assert(profilePrompt.includes('$json.teamDiagnosis.uncertainties'), 'Request-Changes-LLM muss die synchronisierten teamDiagnosis.uncertainties konsumieren.');
const rebuildCode = node(scoutingBriefWorkflow, 'Scouting Brief erstellen').parameters.jsCode;
assert(rebuildCode.includes('problem: teamDiagnosis.mainProblem'), 'Naechste Brief-Runde muss problem aus synchronisierter teamDiagnosis aufbauen.');
assert(rebuildCode.includes('teamDiagnosis.uncertainties'), 'Naechste Brief-Runde muss uncertainties aus synchronisierter teamDiagnosis aufbauen.');

console.log('OK: Reviewer-Edits bleiben fuer Approve und Request Changes downstream massgeblich.');
