// Isolierte Node.js-Verifikation der drei neuen Code-Nodes des
// Human-Review-Gates (siehe n8n/README.md, Abschnitt "Scouting Brief
// Human-Review"): "Scouting Brief erstellen", "Scouting Brief pruefen" und
// "Review-Entscheidung auswerten". Die Funktionen unten sind 1:1 aus den
// jeweiligen jsCode-Strings in n8n/ai-sporting-director.json uebernommen,
// nur mit $input.item.json/$json durch ein uebergebenes item-Argument und
// $('Scouting Brief erstellen').first().json durch ein original-Argument
// ersetzt, da beides ausserhalb von n8n nicht existiert.
const assert = require('assert');

function buildScoutingBrief(item) {
  const MAX_REVIEW_ROUNDS = 3;
  const priorBrief = item.scoutingBrief;
  const feedbackHistory = Array.isArray(priorBrief && priorBrief.feedbackHistory)
    ? [...priorBrief.feedbackHistory]
    : [];

  if (item.reviewDecision === 'Request Changes' && priorBrief) {
    feedbackHistory.push({ round: priorBrief.reviewRound, feedback: item.reviewFeedback || '' });
  }

  const teamDiagnosis = item.teamDiagnosis || {};
  const playerProfile = item.playerProfile || {};

  const scoutingBrief = {
    problem: teamDiagnosis.mainProblem,
    targetPosition: playerProfile.position,
    role: playerProfile.role,
    reasoning: playerProfile.reasoning,
    weightedCriteria: playerProfile.weightedCriteria,
    constraints: playerProfile.constraints,
    uncertainties: Array.isArray(teamDiagnosis.uncertainties) ? teamDiagnosis.uncertainties : [],
    reviewRound: feedbackHistory.length + 1,
    maxReviewRounds: MAX_REVIEW_ROUNDS,
    feedbackHistory
  };

  return { ...item, scoutingBrief };
}

function checkScoutingBrief(item) {
  const b = item.scoutingBrief;
  const errors = [];

  if (!b || typeof b !== 'object') {
    errors.push('scoutingBrief fehlt oder ist kein Objekt.');
  } else {
    if (!b.problem) errors.push('scoutingBrief.problem fehlt.');
    if (!b.targetPosition) errors.push('scoutingBrief.targetPosition fehlt.');
    if (!b.role) errors.push('scoutingBrief.role fehlt.');
    if (!b.reasoning) errors.push('scoutingBrief.reasoning fehlt.');
    if (!Array.isArray(b.weightedCriteria) || b.weightedCriteria.length === 0) {
      errors.push('scoutingBrief.weightedCriteria fehlt oder ist leer.');
    }
    if (!Array.isArray(b.constraints)) errors.push('scoutingBrief.constraints fehlt oder ist kein Array.');
    if (!Array.isArray(b.uncertainties)) errors.push('scoutingBrief.uncertainties fehlt oder ist kein Array.');
  }

  const valid = errors.length === 0;
  return {
    ...item,
    valid,
    errorMessage: valid
      ? undefined
      : 'Das Scouting Brief ist ungueltig und wird nicht zur Freigabe vorgelegt.\n\n' + errors.join('\n')
  };
}

function evaluateReview(submitted, original) {
  const MAX_REVIEW_ROUNDS = 3;
  const reviewDecision = (submitted['Entscheidung'] || '').toString().trim();
  const reviewFeedback = (submitted['Feedback (Pflicht bei Request Changes)'] || '').toString().trim();

  const errors = [];
  if (!['Approve', 'Request Changes', 'Reject'].includes(reviewDecision)) {
    errors.push('Unbekannte Review-Entscheidung: ' + reviewDecision);
  }
  if (reviewDecision === 'Request Changes' && !reviewFeedback) {
    errors.push('Fuer "Request Changes" ist ein Feedback-Text erforderlich.');
  }

  const problem = (submitted['Hauptproblem (Diagnose)'] || '').toString().trim();
  const targetPosition = (submitted['Zielposition'] || '').toString().trim();
  const role = (submitted['Rolle'] || '').toString().trim();
  const reasoning = (submitted['Begruendung'] || '').toString().trim();
  if (!problem) errors.push('Feld "Hauptproblem (Diagnose)" darf nicht leer sein.');
  if (!targetPosition) errors.push('Feld "Zielposition" darf nicht leer sein.');
  if (!role) errors.push('Feld "Rolle" darf nicht leer sein.');
  if (!reasoning) errors.push('Feld "Begruendung" darf nicht leer sein.');

  function parseJsonArrayField(label) {
    const raw = (submitted[label] || '').toString().trim();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('kein Array');
      return parsed;
    } catch (e) {
      errors.push('Feld "' + label + '" enthaelt kein gueltiges JSON-Array: ' + e.message);
      return undefined;
    }
  }
  const weightedCriteria = parseJsonArrayField('Gewichtete Kriterien (JSON-Array)');
  const constraints = parseJsonArrayField('Constraints (JSON-Array)');
  const uncertainties = parseJsonArrayField('Unsicherheiten (JSON-Array)');

  const reviewRound = (original.scoutingBrief && original.scoutingBrief.reviewRound) || 1;
  const maxRoundsReached = reviewDecision === 'Request Changes' && reviewRound >= MAX_REVIEW_ROUNDS;
  const reviewOutcome = maxRoundsReached ? 'Reject' : reviewDecision;

  const valid = errors.length === 0;
  const scoutingBrief = valid
    ? { ...original.scoutingBrief, problem, targetPosition, role, reasoning, weightedCriteria, constraints, uncertainties }
    : original.scoutingBrief;

  // Der freigegebene Formularstand ist die einzige massgebliche Quelle:
  // playerProfile wird mit dem (ggf. vom Reviewer bearbeiteten) scoutingBrief
  // synchron gehalten, weil "Player-Ranking-Anfrage vorbereiten" (Kandidaten
  // suchen) ausdruecklich playerProfile bevorzugt und scoutingBrief nur als
  // Fallback verwendet (siehe playerRankingRequestFromItem() unten).
  const playerProfile = valid
    ? { ...original.playerProfile, position: targetPosition, role, reasoning, weightedCriteria, constraints }
    : original.playerProfile;

  return {
    ...original,
    scoutingBrief,
    playerProfile,
    reviewDecision,
    reviewFeedback,
    reviewOutcome,
    maxRoundsReached,
    valid,
    errorMessage: valid ? undefined : 'Die Review-Entscheidung ist ungueltig.\n\n' + errors.join('\n')
  };
}

// 1:1 aus "Player-Ranking-Anfrage vorbereiten"
// (n8n/kandidaten-suchen-subworkflow.json) uebernommen, nur mit $input.item.json
// durch ein uebergebenes item-Argument ersetzt, um zu pruefen, welches
// playerProfile die Kandidatensuche nach einem Human-Review-Durchlauf
// tatsaechlich verwendet.
function playerRankingRequestFromItem(item) {
  const p = item.playerProfile || (
    item.scoutingBrief
      ? {
          simulated: false,
          position: item.scoutingBrief.targetPosition,
          role: item.scoutingBrief.role,
          weightedCriteria: item.scoutingBrief.weightedCriteria,
          constraints: item.scoutingBrief.constraints || [],
          reasoning: item.scoutingBrief.reasoning
        }
      : null
  );

  if (!p) {
    throw new Error('Weder playerProfile noch scoutingBrief sind vorhanden. Die Kandidatensuche kann nicht vorbereitet werden.');
  }
  if (!p.position) {
    throw new Error('playerProfile.position fehlt.');
  }
  if (!Array.isArray(p.weightedCriteria) || p.weightedCriteria.length === 0) {
    throw new Error('playerProfile.weightedCriteria fehlt oder ist leer.');
  }

  return {
    ...item,
    playerProfile: p,
    position: p.position,
    criteria: p.weightedCriteria,
    constraints: p.constraints || [],
    limit: 5
  };
}

// Simuliert ein unbearbeitet abgesendetes Formular: die defaultValue-Ausdruecke
// der editierbaren Brief-Felder in n8n/ai-sporting-director.json fuellen exakt
// die Werte aus dem uebergebenen scoutingBrief vor (siehe "Scouting Brief zur
// Freigabe vorlegen").
function unchangedBriefFields(original) {
  const b = (original && original.scoutingBrief) || {};
  return {
    'Hauptproblem (Diagnose)': b.problem,
    'Zielposition': b.targetPosition,
    'Rolle': b.role,
    'Begruendung': b.reasoning,
    'Gewichtete Kriterien (JSON-Array)': JSON.stringify(b.weightedCriteria),
    'Constraints (JSON-Array)': JSON.stringify(b.constraints),
    'Unsicherheiten (JSON-Array)': JSON.stringify(b.uncertainties)
  };
}

const baseItem = {
  club: 'Hamburger SV',
  teamDiagnosis: { mainProblem: 'Zu wenig Torgefahr im letzten Drittel.', uncertainties: ['Kleine Stichprobe.'] },
  playerProfile: {
    position: 'Mittelstürmer',
    role: 'Zielspieler',
    reasoning: 'Adressiert das Hauptproblem der Teamdiagnose.',
    weightedCriteria: [{ criterion: 'goals', weight: 0.8 }],
    constraints: []
  }
};

// 1. Erste Runde: reviewRound 1, leere feedbackHistory.
const round1 = buildScoutingBrief(baseItem);
assert.strictEqual(round1.scoutingBrief.reviewRound, 1);
assert.deepStrictEqual(round1.scoutingBrief.feedbackHistory, []);
assert.strictEqual(round1.scoutingBrief.problem, baseItem.teamDiagnosis.mainProblem);
assert.strictEqual(round1.scoutingBrief.targetPosition, 'Mittelstürmer');

// 2. Scouting Brief pruefen: gueltiges Brief.
const checked1 = checkScoutingBrief(round1);
assert.strictEqual(checked1.valid, true);
assert.strictEqual(checked1.errorMessage, undefined);

// 3. Scouting Brief pruefen: fehlendes Pflichtfeld -> ungueltig.
const brokenBrief = { ...round1, scoutingBrief: { ...round1.scoutingBrief, reasoning: '' } };
const checkedBroken = checkScoutingBrief(brokenBrief);
assert.strictEqual(checkedBroken.valid, false);
assert.ok(checkedBroken.errorMessage.includes('scoutingBrief.reasoning fehlt.'));

// 4. Review-Entscheidung auswerten: Approve, Formular unbearbeitet abgesendet
// (AC "Ohne Bearbeitung koennen die vorausgefuellten KI-Ergebnisse
// unveraendert abgesendet werden").
const approve = evaluateReview(
  { ...unchangedBriefFields(round1), Entscheidung: 'Approve', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(approve.valid, true);
assert.strictEqual(approve.reviewOutcome, 'Approve');
assert.strictEqual(approve.maxRoundsReached, false);
assert.deepStrictEqual(approve.scoutingBrief, round1.scoutingBrief);

// 4a. Review-Entscheidung auswerten: Reviewer bearbeitet Hauptproblem und
// Begruendung vor dem Absenden -> die final abgesendeten Texte muessen exakt
// den bearbeiteten Werten entsprechen und duerfen nicht durch das
// urspruengliche KI-Ergebnis ueberschrieben werden; unveraenderte Felder
// (z. B. reviewRound/feedbackHistory) bleiben unangetastet.
const approveEdited = evaluateReview(
  {
    ...unchangedBriefFields(round1),
    'Hauptproblem (Diagnose)': 'Vom Reviewer praezisiertes Hauptproblem.',
    'Begruendung': 'Vom Reviewer ergaenzte Begruendung.',
    Entscheidung: 'Approve',
    'Feedback (Pflicht bei Request Changes)': ''
  },
  round1
);
assert.strictEqual(approveEdited.valid, true);
assert.strictEqual(approveEdited.scoutingBrief.problem, 'Vom Reviewer praezisiertes Hauptproblem.');
assert.strictEqual(approveEdited.scoutingBrief.reasoning, 'Vom Reviewer ergaenzte Begruendung.');
assert.strictEqual(approveEdited.scoutingBrief.targetPosition, round1.scoutingBrief.targetPosition);
assert.strictEqual(approveEdited.scoutingBrief.reviewRound, round1.scoutingBrief.reviewRound);
assert.deepStrictEqual(approveEdited.scoutingBrief.feedbackHistory, round1.scoutingBrief.feedbackHistory);

// 4a-regression. Nach Approve mit editierter Zielposition/gewichteten
// Kriterien/Constraints muss "Kandidaten suchen" (ueber
// "Player-Ranking-Anfrage vorbereiten") tatsaechlich die freigegebenen
// Reviewer-Werte verwenden statt der urspruenglichen KI-Werte aus
// playerProfile: playerRankingRequestFromItem() bevorzugt playerProfile und
// faellt nur auf scoutingBrief zurueck, falls playerProfile fehlt (siehe
// n8n/kandidaten-suchen-subworkflow.json); "Review-Entscheidung auswerten"
// muss playerProfile deshalb mit dem freigegebenen scoutingBrief synchron
// halten, statt das ursprüngliche, unveraenderte playerProfile
// durchzureichen.
const approveEditedCriteria = evaluateReview(
  {
    ...unchangedBriefFields(round1),
    Zielposition: 'Linksaussen',
    'Gewichtete Kriterien (JSON-Array)': JSON.stringify([{ criterion: 'dribbling', weight: 0.9 }]),
    'Constraints (JSON-Array)': JSON.stringify([{ field: 'age', operator: 'max', value: 23 }]),
    Entscheidung: 'Approve',
    'Feedback (Pflicht bei Request Changes)': ''
  },
  round1
);
assert.strictEqual(approveEditedCriteria.valid, true);
const rankingRequest = playerRankingRequestFromItem(approveEditedCriteria);
assert.strictEqual(rankingRequest.position, 'Linksaussen');
assert.deepStrictEqual(rankingRequest.criteria, [{ criterion: 'dribbling', weight: 0.9 }]);
assert.deepStrictEqual(rankingRequest.constraints, [{ field: 'age', operator: 'max', value: 23 }]);
assert.strictEqual(rankingRequest.playerProfile.position, 'Linksaussen');
assert.notStrictEqual(rankingRequest.position, baseItem.playerProfile.position);

// 4b. Review-Entscheidung auswerten: leeres Pflichtfeld (Zielposition) ->
// ungueltig.
const emptyRequiredField = evaluateReview(
  { ...unchangedBriefFields(round1), 'Zielposition': '  ', Entscheidung: 'Approve', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(emptyRequiredField.valid, false);
assert.ok(emptyRequiredField.errorMessage.includes('"Zielposition" darf nicht leer sein.'));

// 4c. Review-Entscheidung auswerten: ungueltiges JSON im Constraints-Feld ->
// ungueltig, mit eindeutiger Fehlermeldung.
const invalidJsonField = evaluateReview(
  { ...unchangedBriefFields(round1), 'Constraints (JSON-Array)': 'kein-json', Entscheidung: 'Approve', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(invalidJsonField.valid, false);
assert.ok(invalidJsonField.errorMessage.includes('"Constraints (JSON-Array)" enthaelt kein gueltiges JSON-Array'));

// 5. Review-Entscheidung auswerten: Request Changes ohne Feedback -> ungueltig.
const requestNoFeedback = evaluateReview(
  { ...unchangedBriefFields(round1), Entscheidung: 'Request Changes', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(requestNoFeedback.valid, false);
assert.ok(requestNoFeedback.errorMessage.includes('Feedback-Text erforderlich'));

// 6. Review-Entscheidung auswerten: Request Changes mit Feedback -> gueltig, Loop.
const request1 = evaluateReview(
  {
    ...unchangedBriefFields(round1),
    Entscheidung: 'Request Changes',
    'Feedback (Pflicht bei Request Changes)': 'Bitte juengeren Kandidaten vorschlagen.'
  },
  round1
);
assert.strictEqual(request1.valid, true);
assert.strictEqual(request1.reviewOutcome, 'Request Changes');
assert.strictEqual(request1.maxRoundsReached, false);

// 7. Zweite Runde: die Positionspool-/LLM-Regeneration wuerde hier erneut
// playerProfile setzen; die Historie muss das Feedback aus Runde 1 archivieren.
const itemForRound2 = { ...request1, playerProfile: { ...baseItem.playerProfile, role: 'Zielspieler (juenger)' } };
const round2 = buildScoutingBrief(itemForRound2);
assert.strictEqual(round2.scoutingBrief.reviewRound, 2);
assert.strictEqual(round2.scoutingBrief.feedbackHistory.length, 1);
assert.strictEqual(round2.scoutingBrief.feedbackHistory[0].feedback, 'Bitte juengeren Kandidaten vorschlagen.');
assert.strictEqual(round2.scoutingBrief.role, 'Zielspieler (juenger)');

// 7a. Reviewer-Feedback mit konkretem Alters-/Budgetlimit ("max. 10 Mio.
// Marktwert") muss laut Prompt von "Spielerprofil LLM" (siehe
// n8n/ai-sporting-director.json) in playerProfile.constraints landen -
// hier simuliert durch die dadurch erzeugte LLM-Ausgabe der Folgerunde -
// und muss von "Scouting Brief erstellen" unveraendert in
// scoutingBrief.constraints uebernommen werden, damit es downstream (ueber
// playerProfile.constraints -> Player-Ranking-Anfrage, siehe README.md)
// tatsaechlich wirksam wird.
const requestBudgetLimit = evaluateReview(
  {
    ...unchangedBriefFields(round1),
    Entscheidung: 'Request Changes',
    'Feedback (Pflicht bei Request Changes)': 'Bitte nur Kandidaten unter 10 Mio. Marktwert vorschlagen.'
  },
  round1
);
const itemForBudgetRound = {
  ...requestBudgetLimit,
  playerProfile: {
    ...baseItem.playerProfile,
    constraints: [{ field: 'marketValueMEUR', operator: 'max', value: 10 }]
  }
};
const budgetRound = buildScoutingBrief(itemForBudgetRound);
assert.strictEqual(budgetRound.scoutingBrief.reviewRound, 2);
assert.deepStrictEqual(budgetRound.scoutingBrief.constraints, [{ field: 'marketValueMEUR', operator: 'max', value: 10 }]);
const checkedBudgetRound = checkScoutingBrief(budgetRound);
assert.strictEqual(checkedBudgetRound.valid, true);

// 8. Dritte Runde erreicht: eine weitere "Request Changes" auf reviewRound 3
// muss ueber maxRoundsReached zu reviewOutcome 'Reject' gezwungen werden.
const request2 = evaluateReview(
  {
    ...unchangedBriefFields(round2),
    Entscheidung: 'Request Changes',
    'Feedback (Pflicht bei Request Changes)': 'Noch juenger bitte.'
  },
  round2
);
const itemForRound3 = { ...request2, playerProfile: baseItem.playerProfile };
const round3 = buildScoutingBrief(itemForRound3);
assert.strictEqual(round3.scoutingBrief.reviewRound, 3);

const request3 = evaluateReview(
  {
    ...unchangedBriefFields(round3),
    Entscheidung: 'Request Changes',
    'Feedback (Pflicht bei Request Changes)': 'Und nochmal.'
  },
  round3
);
assert.strictEqual(request3.valid, true, 'die Entscheidung selbst bleibt formal gueltig');
assert.strictEqual(request3.maxRoundsReached, true);
assert.strictEqual(request3.reviewOutcome, 'Reject', 'die dritte Ueberarbeitungsrunde ist ausgeschoepft und wird kontrolliert beendet');

// 9. Reject direkt in Runde 1.
const reject1 = evaluateReview(
  { ...unchangedBriefFields(round1), Entscheidung: 'Reject', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(reject1.valid, true);
assert.strictEqual(reject1.reviewOutcome, 'Reject');
assert.strictEqual(reject1.maxRoundsReached, false);

// 10. Unbekannte Entscheidung -> ungueltig.
const unknown = evaluateReview(
  { ...unchangedBriefFields(round1), Entscheidung: 'Vielleicht', 'Feedback (Pflicht bei Request Changes)': '' },
  round1
);
assert.strictEqual(unknown.valid, false);
assert.ok(unknown.errorMessage.includes('Unbekannte Review-Entscheidung'));

console.log('Alle Scouting-Brief-/Human-Review-Verifikationen erfolgreich.');
