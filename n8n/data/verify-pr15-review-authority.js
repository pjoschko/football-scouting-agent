'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = path.resolve(__dirname, '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const node = (workflow, name) => {
  const found = workflow.nodes.find((entry) => entry.name === name);
  assert(found, `Node fehlt: ${name}`);
  return found;
};

const main = load('ai-sporting-director.json');
const scouting = load('scouting-brief-subworkflow.json');
const ranking = load('analytics-player-ranking-subworkflow.json');
const reviewCode = node(main, 'Review-Entscheidung auswerten').parameters.jsCode;

function runReview(submitted, original) {
  const fn = new Function('$input', '$', reviewCode);
  const result = fn(
    { item: { json: submitted } },
    (name) => {
      assert.strictEqual(name, 'Execute Workflow: Scouting Brief erstellen');
      return { first: () => ({ json: original }) };
    },
  );
  assert(Array.isArray(result) && result.length === 1);
  return result[0].json;
}

const original = {
  club: 'HSV',
  objective: 'Kader verbessern',
  additionalContext: '',
  teamDiagnosis: {
    mainProblem: 'Alt',
    diagnosisCategory: 'defensive',
    hypotheses: ['H'],
    counterHypotheses: [],
    leagueComparison: 'L',
    uncertainties: ['Alt unsicher'],
  },
  playerProfile: {
    position: 'Innenverteidiger',
    role: 'Alt',
    reasoning: 'Alt',
    weightedCriteria: [{ criterion: 'appearances', weight: 1 }],
    constraints: [],
  },
  scoutingBrief: {
    problem: 'Alt',
    targetPosition: 'Innenverteidiger',
    role: 'Alt',
    reasoning: 'Alt',
    weightedCriteria: [{ criterion: 'appearances', weight: 1 }],
    constraints: [],
    uncertainties: ['Alt unsicher'],
    reviewRound: 1,
    maxReviewRounds: 3,
    feedbackHistory: [],
  },
};

const base = {
  'Hauptproblem (Diagnose)': 'Neu',
  Zielposition: 'Defensives Mittelfeld',
  Rolle: 'Neu',
  Begruendung: 'Neu',
  'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'assists', weight: 0.7 }]),
  'Constraints (JSON-Array)': JSON.stringify([{ field: 'age', operator: 'max', value: 23 }]),
  'Unsicherheiten (JSON-Array)': JSON.stringify(['Neu unsicher']),
};

const approved = runReview({ ...base, Entscheidung: 'Approve' }, original);
assert.strictEqual(approved.valid, true);
assert.strictEqual(approved.reviewOutcome, 'Approve');
assert.strictEqual(approved.scoutingBrief.problem, 'Neu');
assert.strictEqual(approved.playerProfile.position, 'Defensives Mittelfeld');
assert.deepStrictEqual(approved.playerProfile.constraints, [{ field: 'age', operator: 'max', value: 23 }]);
assert.deepStrictEqual(approved.teamDiagnosis.uncertainties, ['Neu unsicher']);

const invalidCases = [
  ['unbekannte Entscheidung', { Entscheidung: 'Vielleicht' }],
  ['Request Changes ohne Feedback', { Entscheidung: 'Request Changes', 'Feedback (Pflicht bei Request Changes)': '' }],
  ['leere Zielposition', { Entscheidung: 'Approve', Zielposition: '  ' }],
  ['ungueltiges JSON', { Entscheidung: 'Approve', 'Constraints (JSON-Array)': 'kein-json' }],
  ['unbekanntes Kriterium', { Entscheidung: 'Approve', 'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'xGoals', weight: 0.7 }]) }],
  ['String-Gewicht', { Entscheidung: 'Approve', 'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'assists', weight: 'hoch' }]) }],
  ['negatives Gewicht', { Entscheidung: 'Approve', 'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'goals', weight: -0.1 }]) }],
  ['Gewicht groesser 1', { Entscheidung: 'Approve', 'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'goals', weight: 1.1 }]) }],
  ['leere Kriterien', { Entscheidung: 'Approve', 'Gewichtete Kriterien (JSON-Array)': '[]' }],
  ['ungueltiges Constraint-Feld', { Entscheidung: 'Approve', 'Constraints (JSON-Array)': JSON.stringify([{ field: 'salaryMEUR', operator: 'max', value: 5 }]) }],
  ['ungueltiger Constraint-Operator', { Entscheidung: 'Approve', 'Constraints (JSON-Array)': JSON.stringify([{ field: 'age', operator: 'equals', value: 23 }]) }],
  ['nichtnumerischer Constraint-Wert', { Entscheidung: 'Approve', 'Constraints (JSON-Array)': JSON.stringify([{ field: 'age', operator: 'max', value: '23' }]) }],
  ['Unsicherheit als Objekt', { Entscheidung: 'Approve', 'Unsicherheiten (JSON-Array)': JSON.stringify([{ text: 'x' }]) }],
];

for (const [label, patch] of invalidCases) {
  const submitted = { ...base, Entscheidung: 'Approve', ...patch };
  const result = runReview(submitted, original);
  assert.strictEqual(result.valid, false, `${label} muss abgelehnt werden`);
  assert.deepStrictEqual(result.playerProfile, original.playerProfile, `${label}: playerProfile darf nicht ueberschrieben werden`);
  assert.deepStrictEqual(result.scoutingBrief, original.scoutingBrief, `${label}: scoutingBrief darf nicht ueberschrieben werden`);
  assert.deepStrictEqual(result.teamDiagnosis, original.teamDiagnosis, `${label}: teamDiagnosis darf nicht ueberschrieben werden`);
}

const round3 = JSON.parse(JSON.stringify(original));
round3.scoutingBrief.reviewRound = 3;
const maxed = runReview({
  ...base,
  Entscheidung: 'Request Changes',
  'Feedback (Pflicht bei Request Changes)': 'Noch einmal',
}, round3);
assert.strictEqual(maxed.valid, false);
assert.strictEqual(maxed.reviewDecision, 'Request Changes');
assert.strictEqual(maxed.reviewOutcome, 'Request Changes');
assert.strictEqual(maxed.maxRoundsReached, true);
assert(maxed.errorMessage.includes('Approve oder Reject'));

const requested = runReview({
  ...base,
  Zielposition: 'Zentrales Mittelfeld',
  Entscheidung: 'Request Changes',
  'Feedback (Pflicht bei Request Changes)': 'Nur Begruendung schaerfen',
}, original);
assert.strictEqual(requested.valid, true);

const poolFn = new Function('$input', node(scouting, 'Spielerprofil: Positionspool ermitteln').parameters.jsCode);
const positioned = poolFn({ item: { json: requested } })[0].json;
assert(positioned.allowedPositions.includes('Zentrales Mittelfeld'));

const mergeFn = new Function('$json', '$', node(scouting, 'Spielerprofil zusammenfuehren').parameters.jsCode);
const merged = mergeFn(
  { output: { position: null, role: null, weightedCriteria: null, constraints: null, reasoning: 'Geschaerft' } },
  (name) => {
    assert.strictEqual(name, 'Spielerprofil: Positionspool ermitteln');
    return { first: () => ({ json: positioned }) };
  },
).json;
assert.strictEqual(merged.playerProfile.position, 'Zentrales Mittelfeld');
assert.deepStrictEqual(merged.playerProfile.weightedCriteria, [{ criterion: 'assists', weight: 0.7 }]);
assert.deepStrictEqual(merged.playerProfile.constraints, [{ field: 'age', operator: 'max', value: 23 }]);
assert.strictEqual(merged.playerProfile.reasoning, 'Geschaerft');

const validateFn = new Function('$input', node(scouting, 'Spielerprofil pruefen').parameters.jsCode);
assert.strictEqual(validateFn({ item: { json: merged } })[0].json.valid, true);

// Echte Ranking-Implementierung: Reviewer-Constraint muss den Pool wirklich filtern.
const analyticsCode = node(ranking, 'Analytics ausführen').parameters.jsCode;
const analyticsFn = new Function('$input', '$', analyticsCode);
const rows = [
  { Player: 'Young', Squad: 'Other', Position: 'MF', Age: '22', Goals: '2', Assists: '8', Appearances: '25', Minutes: '1800', MarketValueMEUR: '8' },
  { Player: 'Old', Squad: 'Other', Position: 'MF', Age: '29', Goals: '8', Assists: '9', Appearances: '30', Minutes: '2200', MarketValueMEUR: '7' },
];
const items = rows.map((row, index) => ({ json: { payload: JSON.stringify(row), rowNumber: index + 1 } }));
const request = {
  rankingExcludeClub: 'HSV',
  position: 'Zentrales Mittelfeld',
  criteria: [{ criterion: 'assists', weight: 0.7 }],
  constraints: [{ field: 'age', operator: 'max', value: 23 }],
  limit: 5,
};
const ranked = analyticsFn(
  { all: () => items },
  (name) => {
    assert.strictEqual(name, 'Wenn von anderem Workflow aufgerufen');
    return { first: () => ({ json: request }) };
  },
)[0].json.playerRanking;
assert.deepStrictEqual(ranked.ranking.map((entry) => entry.name), ['Young']);
assert.deepStrictEqual(ranked.ignoredConstraints, []);
assert.strictEqual(ranked.appliedConstraints.length, 1);
assert.strictEqual(ranked.appliedConstraints[0].field, 'age');
assert.strictEqual(ranked.excludedByConstraints, 1);

console.log('OK: PR15 Reviewer-Werte bleiben autoritativ und wirken bis ins echte Player-Ranking.');
