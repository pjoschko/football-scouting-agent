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

// Request Changes: die synchronisierten Reviewer-Werte sind die Baseline der Folgerunde.
const requested = runReview({
  ...editedBase,
  Zielposition: 'Zentrales Mittelfeld',
  Entscheidung: 'Request Changes',
  'Feedback (Pflicht bei Request Changes)': 'Bitte nur die Begruendung schaerfen; Position, Kriterien und Constraints beibehalten.',
}, original);
assert.strictEqual(requested.valid, true);
assert.strictEqual(requested.reviewOutcome, 'Request Changes');
assert.strictEqual(requested.teamDiagnosis.mainProblem, 'Vom Reviewer korrigiertes Hauptproblem');
assert.deepStrictEqual(requested.teamDiagnosis.uncertainties, ['Vom Reviewer korrigierte Unsicherheit']);
assert.strictEqual(requested.playerProfile.position, 'Zentrales Mittelfeld');
assert.deepStrictEqual(requested.playerProfile.weightedCriteria, [{ criterion: 'assists', weight: 0.7 }]);
assert.deepStrictEqual(requested.playerProfile.constraints, [{ field: 'age', operator: 'max', value: 26 }]);

const positionPoolCode = node(scoutingBriefWorkflow, 'Spielerprofil: Positionspool ermitteln').parameters.jsCode;
const runPositionPool = new Function('$input', positionPoolCode);
const positioned = runPositionPool({ item: { json: requested } })[0].json;
assert(positioned.allowedPositions.includes('Zentrales Mittelfeld'), 'Reviewer-Position muss in der Request-Changes-Folgerunde zulaessig bleiben.');

const profilePrompt = node(scoutingBriefWorkflow, 'Spielerprofil LLM').parameters.text;
assert(profilePrompt.includes('VERBINDLICHER, VOM REVIEWER BEREITS EDITIERTER AUSGANGSSTAND'), 'Request-Changes-Prompt muss den Reviewer-Stand explizit als Baseline enthalten.');
assert(profilePrompt.includes('JSON.stringify($json.playerProfile)'), 'Request-Changes-Prompt muss das synchronisierte playerProfile uebergeben.');
assert(profilePrompt.includes('null = unveraendert'), 'Prompt muss Patch-Semantik fuer unveraenderte Reviewer-Felder definieren.');

const schema = JSON.parse(node(scoutingBriefWorkflow, 'Spielerprofil Output-Schema').parameters.inputSchema);
for (const field of ['position', 'role', 'weightedCriteria', 'constraints', 'reasoning']) {
  const type = schema.properties[field].type;
  assert(Array.isArray(type) && type.includes('null'), `${field} muss in der Request-Changes-Patch-Semantik null erlauben.`);
}

// Simuliere eine LLM-Folgerunde, die laut Feedback nur reasoning aendert und alle
// anderen Felder als null (= Reviewer-Wert beibehalten) liefert.
const mergeCode = node(scoutingBriefWorkflow, 'Spielerprofil zusammenfuehren').parameters.jsCode;
const runMerge = new Function('$json', '$', mergeCode);
const llmPatch = {
  output: {
    position: null,
    role: null,
    weightedCriteria: null,
    constraints: null,
    reasoning: 'Vom LLM anhand des Feedbacks geschaerfte Begruendung',
  },
};
const merged = runMerge(llmPatch, (name) => {
  assert.strictEqual(name, 'Spielerprofil: Positionspool ermitteln');
  return { first: () => ({ json: positioned }) };
}).json;
assert.strictEqual(merged.playerProfile.position, 'Zentrales Mittelfeld', 'Reviewer-Position darf durch null-Patch nicht verloren gehen.');
assert.deepStrictEqual(merged.playerProfile.weightedCriteria, [{ criterion: 'assists', weight: 0.7 }], 'Reviewer-Kriterien duerfen durch null-Patch nicht verloren gehen.');
assert.deepStrictEqual(merged.playerProfile.constraints, [{ field: 'age', operator: 'max', value: 26 }], 'Reviewer-Constraints duerfen durch null-Patch nicht verloren gehen.');
assert.strictEqual(merged.playerProfile.reasoning, 'Vom LLM anhand des Feedbacks geschaerfte Begruendung');

const validateProfileCode = node(scoutingBriefWorkflow, 'Spielerprofil pruefen').parameters.jsCode;
const validatedProfile = new Function('$input', validateProfileCode)({ item: { json: merged } })[0].json;
assert.strictEqual(validatedProfile.valid, true, validatedProfile.errorMessage);

const rebuildCode = node(scoutingBriefWorkflow, 'Scouting Brief erstellen').parameters.jsCode;
const nextRound = new Function('$input', rebuildCode)({ item: { json: validatedProfile } })[0].json;
assert.strictEqual(nextRound.scoutingBrief.targetPosition, 'Zentrales Mittelfeld', 'Naechste Formularrunde muss die Reviewer-Position zeigen.');
assert.deepStrictEqual(nextRound.scoutingBrief.weightedCriteria, [{ criterion: 'assists', weight: 0.7 }], 'Naechste Formularrunde muss die Reviewer-Kriterien zeigen.');
assert.deepStrictEqual(nextRound.scoutingBrief.constraints, [{ field: 'age', operator: 'max', value: 26 }], 'Naechste Formularrunde muss die Reviewer-Constraints zeigen.');
assert.strictEqual(nextRound.scoutingBrief.reasoning, 'Vom LLM anhand des Feedbacks geschaerfte Begruendung');
assert.strictEqual(nextRound.scoutingBrief.reviewRound, 2);

console.log('OK: Reviewer-Edits bleiben fuer Approve und Request Changes bis in die naechste Formularrunde autoritativ.');
