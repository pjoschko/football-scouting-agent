'use strict';
// End-to-End-Logiksimulation des Hauptworkflows nach dem CSV-Analytics-Umbau,
// analog zur bereits in n8n/README.md beschriebenen Vorgehensweise: alle
// Code-Nodes (Haupt- und Subworkflows) werden ausserhalb von n8n mit Node.js
// ausgefuehrt. Aufruf: node n8n/data/simulate_main_workflow.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const N8N_DIR = path.join(__dirname, '..');

function loadWorkflow(fileName) {
  return JSON.parse(fs.readFileSync(path.join(N8N_DIR, fileName), 'utf8'));
}

function codeFn(node) {
  return new Function('$input', node.parameters.jsCode);
}

const main = loadWorkflow('ai-sporting-director.json');
const subworkflows = {
  'e7a415a1-6e8b-4f26-a724-3f728588c6b3': loadWorkflow('analytics-team-performance-subworkflow.json'),
  '68f47ebf-1e64-41a1-af75-b2afae2c0fbc': loadWorkflow('analytics-team-matches-subworkflow.json'),
  '5e50b3ea-5e60-436f-b8bd-77957b54355a': loadWorkflow('analytics-player-ranking-subworkflow.json'),
  'd6f31473-12f9-40a2-b935-ca998397142e': loadWorkflow('analytics-player-profile-subworkflow.json'),
  '802fdb6b-4c0a-413f-952d-250c91ddc476': loadWorkflow('recherche-subworkflow.json')
};

function runNode(node, json) {
  if (node.type === 'n8n-nodes-base.code') {
    return codeFn(node)({ item: { json } })[0].json;
  }
  if (node.type === 'n8n-nodes-base.executeWorkflow') {
    const sub = subworkflows[node.parameters.workflowId.value];
    const codeNode = sub.nodes.find((n) => n.type === 'n8n-nodes-base.code');
    return codeFn(codeNode)({ item: { json } })[0].json;
  }
  if (node.type === 'n8n-nodes-base.if') {
    return json; // gate handling done by caller via json.valid
  }
  throw new Error(`unsupported node type in simulation: ${node.type} (${node.name})`);
}

function nodeByName(wf, name) {
  return wf.nodes.find((n) => n.name === name);
}

// Runs the main chain starting right after "Eingabe validieren" (true branch),
// i.e. starting from an item that already has club/objective/additionalContext.
function runPipeline(initialJson, { stopAfter } = {}) {
  const chain = [
    'Team-Performance abrufen',
    'Team-Matches abrufen',
    'Teamdiagnose erzeugen',
    'Teamdiagnose pruefen',
    'GATE:Teamdiagnose gueltig?',
    'Spielerprofil erzeugen',
    'Spielerprofil pruefen',
    'GATE:Spielerprofil gueltig?',
    'Player-Ranking-Anfrage vorbereiten',
    'Player-Ranking abrufen',
    'Spielersuche durchfuehren',
    'Spielersuche pruefen',
    'GATE:Spielersuche gueltig?',
    'Recherche durchfuehren',
    'Recherche pruefen',
    'GATE:Recherche gueltig?',
    'Empfehlung erzeugen',
    'Player-Profil-Anfrage vorbereiten',
    'Player-Profil abrufen',
    'Empfehlung anreichern',
    'Final Validation',
    'GATE:Final Validation gueltig?',
    'Ergebnisseiten aufbereiten'
  ];

  let json = initialJson;
  for (const step of chain) {
    if (step.startsWith('GATE:')) {
      const gateName = step.slice('GATE:'.length);
      if (json.valid !== true) {
        return { failedAt: gateName, errorMessage: json.errorMessage, json };
      }
      continue;
    }
    const node = nodeByName(main, step);
    if (!node) throw new Error(`node missing from main workflow: ${step}`);
    json = runNode(node, json);
    if (stopAfter === step) return { json, stoppedAt: step };
  }
  return { json, completed: true };
}

function baseHsvInput() {
  return {
    club: 'Hamburger SV',
    objective: "Beim Hamburger SV läuft es sportlich nicht besonders gut. Analysiere, wo die größten Probleme liegen, und schlage vor, was wir auf dem Transfermarkt tun sollten.",
    additionalContext: '',
    requestId: 'test-1',
    requestedAt: new Date().toISOString()
  };
}

console.log('=== Positiver Testfall: HSV-Formular (Default) ===');
const positive = runPipeline(baseHsvInput());
if (!positive.completed) console.log('DEBUG failedAt', positive.failedAt, positive.errorMessage);
assert.strictEqual(positive.completed, true, 'positive Pipeline sollte vollstaendig durchlaufen');
const fr = positive.json;
assert.strictEqual(fr.teamDiagnosis.simulated, false);
assert.strictEqual(fr.teamDiagnosis.dataAvailable, true);
assert.match(fr.teamDiagnosis.mainProblem, /[Dd]efensiv/, 'HSV sollte laut CSV-Daten ein Defensivproblem diagnostiziert bekommen');
assert.strictEqual(fr.teamDiagnosis.diagnosisCategory, 'defensive', 'diagnosisCategory sollte die Defensivdiagnose maschinenlesbar widerspiegeln');
assert.strictEqual(fr.playerSearch.simulated, false);
assert.ok(fr.playerSearch.shortlist.length > 0 && fr.playerSearch.shortlist.length <= 5);
assert.ok(fr.playerSearch.shortlist.every((c) => c.name), 'jeder Shortlist-Kandidat braucht einen Namen');
assert.ok(!fr.playerSearch.shortlist.some((c) => c.name.toLowerCase().includes('hamburger')), 'Kandidaten sollten nicht aus dem eigenen Kader stammen');
// Konsistenz Diagnose -> gesuchte Position/Kandidat (P1-Finding aus dem Review):
// bei einem Defensivproblem darf die Bedarfsermittlung nicht trotzdem einen
// Stuermer suchen. playerRanking bleibt im Item erhalten (Execute-Workflow-
// Nodes mergen ihr Ergebnis per {...item}), daher hier direkt pruefbar.
const DEFENSIVE_POSITIONS = ['Innenverteidiger', 'Linksverteidiger', 'Rechtsverteidiger', 'Defensives Mittelfeld'];
assert.ok(DEFENSIVE_POSITIONS.includes(fr.playerProfile.position), `Bei einem Defensivproblem sollte eine defensive Position gesucht werden, nicht '${fr.playerProfile.position}'`);
assert.strictEqual(fr.playerRanking.position, fr.playerProfile.position, 'Player-Ranking sollte tatsaechlich mit der aus der Diagnose abgeleiteten Position angefragt werden');
assert.strictEqual(fr.playerRanking.positionFallbackApplied, false, 'die gesuchte Position sollte im Kader-Pool vorkommen und keinen Fallback benoetigen');
assert.ok(fr.playerRanking.ranking.every((p) => p.position === fr.playerProfile.position), 'alle gerankten Kandidaten sollten tatsaechlich die gesuchte (defensive) Position spielen');
// candidateProfile: recommendation.candidate stammt aus playerSearch.shortlist, die
// wiederum aus players.csv erzeugt wurde -> playerProfileLookup muss ihn finden.
assert.ok(fr.recommendation.candidateProfile, 'Empfehlung sollte um ein echtes CSV-Profil angereichert sein');
assert.strictEqual(fr.recommendation.candidateProfile.name, fr.recommendation.candidate);
assert.strictEqual(fr.recommendation.candidateProfile.position, fr.playerProfile.position, 'die empfohlene Person sollte tatsaechlich auf der aus der Defensivdiagnose gesuchten Position spielen');
assert.ok(fr.formattedResult.includes('CSV-Profil'));
assert.ok(fr.formattedResult.includes('Teamdiagnose') && fr.formattedResult.includes('Empfehlung'));
console.log('OK: kompletter Positivpfad, Teamdiagnose=Defensivproblem, gesuchte Position ist defensiv, Kandidat ausserhalb des eigenen Kaders und tatsaechlich auf dieser Position, Empfehlung inkl. CSV-Profil.');

console.log('\n=== Positiver Testfall: Bayern (starke Form, kein Defensiv-/Offensivproblem) ===');
const bayern = runPipeline({ ...baseHsvInput(), club: 'FC Bayern München', objective: 'Kader fuer naechste Saison pruefen.' });
assert.strictEqual(bayern.completed, true);
assert.match(bayern.json.teamDiagnosis.mainProblem, /[Kk]ein eindeutiger/, 'Bayern sollte laut CSV-Daten kein Struktur-Problem attestiert bekommen');
assert.strictEqual(bayern.json.teamDiagnosis.diagnosisCategory, 'neutral');
assert.strictEqual(bayern.json.recommendation.candidateProfile.position, bayern.json.playerProfile.position, 'auch ohne einseitige Diagnose sollte der empfohlene Kandidat auf der tatsaechlich gesuchten Position spielen');
console.log('OK: Bayern-Diagnose ohne einseitiges Struktur-Problem, Positionskonsistenz bleibt gewahrt.');

console.log('\n=== Positiver Testfall: Leverkusen (Offensivproblem) ===');
const lev = runPipeline({ ...baseHsvInput(), club: 'Bayer 04 Leverkusen', objective: 'Warum treffen wir so selten?' });
assert.strictEqual(lev.completed, true);
assert.match(lev.json.teamDiagnosis.mainProblem, /[Oo]ffensiv/);
assert.strictEqual(lev.json.teamDiagnosis.diagnosisCategory, 'offensive');
const ATTACKING_POSITIONS = ['Offensives Mittelfeld', 'Linksaußen', 'Mittelstürmer'];
assert.ok(ATTACKING_POSITIONS.includes(lev.json.playerProfile.position), `Bei einem Offensivproblem sollte eine offensive Position gesucht werden, nicht '${lev.json.playerProfile.position}'`);
assert.ok(lev.json.playerRanking.ranking.every((p) => p.position === lev.json.playerProfile.position), 'alle gerankten Kandidaten sollten tatsaechlich die gesuchte (offensive) Position spielen');
assert.strictEqual(lev.json.recommendation.candidateProfile.position, lev.json.playerProfile.position, 'die empfohlene Person sollte tatsaechlich auf der aus der Offensivdiagnose gesuchten Position spielen');
console.log('OK: Leverkusen-Diagnose = Offensivproblem, gesuchte Position ist offensiv und Kandidat spielt tatsaechlich dort.');

console.log('\n=== Negativtestfall: unbekannter Verein (Formular-Bypass) ===');
const unknown = runPipeline({ ...baseHsvInput(), club: 'SV Unbekannt 1900', objective: 'Testfall' });
assert.strictEqual(unknown.json.teamDiagnosis.dataAvailable, false, 'Teamdiagnose sollte fehlende Daten explizit ausweisen, nichts erfinden');
// Die Teamdiagnose selbst bleibt schema-gueltig (nicht-leere Felder), aber die
// Spielersuche kann fuer den unbekannten Verein keinen Bedarf real bedienen -
// tatsaechlich schlaegt sie hier NICHT fehl, weil excludeClub nur den (unbekannten)
// Club ausschliesst und der Rest des Marktes durchsucht wird. Das ist gewolltes
// Verhalten: die Spielersuche ist unabhaengig vom Diagnoseergebnis des angefragten
// Vereins moeglich, sie erfindet dabei aber keine Daten ueber den unbekannten Verein selbst.
console.log('OK: unbekannter Verein fuehrt zu explizit ausgewiesenem Datenmangel in der Teamdiagnose, kein Absturz, keine erfundenen Werte.', { failedAt: unknown.failedAt || null });

console.log('\nAlle Simulationen erfolgreich.');
