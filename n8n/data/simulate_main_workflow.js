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

// $ ist ein Simulations-Shim fuer n8n-Expressions der Form
// $('NodeName').item.json, wie sie die Merge-Nodes "Teamdiagnose
// zusammenfuehren" und "Spielerprofil zusammenfuehren" nutzen, um das Item von
// VOR dem jeweiligen (verlustbehafteten) Chain-Node-Aufruf zurueckzuholen -
// siehe n8n/README.md. history haelt dafuer den json-Stand nach jedem bereits
// in DIESEM Simulationslauf ausgefuehrten Hauptworkflow-Node vor, genau wie
// echtes n8n den Output jedes bereits gelaufenen Nodes einer Execution
// vorhaelt. Code-Nodes, deren jsCode $ nicht referenziert, ignorieren den
// zusaetzlichen Parameter einfach (er bleibt ungenutzt).
function makeDollar(history) {
  return function dollarFn(nodeName) {
    if (!(nodeName in history)) {
      throw new Error(`Simulation: $('${nodeName}') referenziert einen Node, der in diesem Lauf noch nicht ausgefuehrt wurde.`);
    }
    return { item: { json: history[nodeName] } };
  };
}

function codeFn(node) {
  return new Function('$input', '$', node.parameters.jsCode);
}

const main = loadWorkflow('ai-sporting-director.json');
const subworkflows = {
  'e7a415a1-6e8b-4f26-a724-3f728588c6b3': loadWorkflow('analytics-team-performance-subworkflow.json'),
  '68f47ebf-1e64-41a1-af75-b2afae2c0fbc': loadWorkflow('analytics-team-matches-subworkflow.json'),
  '5e50b3ea-5e60-436f-b8bd-77957b54355a': loadWorkflow('analytics-player-ranking-subworkflow.json'),
  'd6f31473-12f9-40a2-b935-ca998397142e': loadWorkflow('analytics-player-profile-subworkflow.json'),
  '802fdb6b-4c0a-413f-952d-250c91ddc476': loadWorkflow('recherche-subworkflow.json')
};

// --- Mock fuer die beiden Basic-LLM-Chain-Nodes (@n8n/n8n-nodes-langchain.chainLlm) ---
//
// WICHTIG: Es gibt in dieser Offline-Logiksimulation keinen erreichbaren
// Ollama-Endpunkt - ein echter Modellaufruf ist hier technisch unmoeglich.
// mockLlmChain() ersetzt NUR die Modellantwort durch eine deterministische,
// das jeweilige Structured-Output-Parser-Schema erfuellende JSON-Struktur, und
// bildet dabei absichtlich exakt das reale Verhalten von n8n 2.35.7 nach: die
// Basic LLM Chain liefert bei aktivem Output Parser NUR { output: <geparstes
// Objekt> } als Main-Output, der Rest des Items geht verloren (deshalb muessen
// "Teamdiagnose zusammenfuehren"/"Spielerprofil zusammenfuehren" das
// vorherige Item ueber $('<Node vor der Chain>') zurueckholen - siehe oben).
// Dieser Mock testet NICHT die tatsaechliche Modellqualitaet, Prompt-Befolgung
// oder ob ein echtes Ollama-Modell inhaltlich sinnvoll antwortet - das kann
// nur eine laufende n8n-Instanz mit echtem lokalen Modell zeigen. Er stellt
// ausschliesslich sicher, dass die umgebende Pipeline (Merge-Nodes, Gates,
// Spielerprofil-Konsistenzpruefung, Player-Ranking, Spielersuche, ...) mit dem
// vom LLM erwarteten Datenvertrag exakt so weiterlaeuft wie im echten Betrieb.
const DEFENSIVE_POSITIONS = ['Innenverteidiger', 'Linksverteidiger', 'Rechtsverteidiger', 'Defensives Mittelfeld'];
const ATTACKING_POSITIONS = ['Offensives Mittelfeld', 'Linksaußen', 'Mittelstürmer'];

function mockTeamdiagnoseLlm(json) {
  const perf = json.teamPerformance;
  // Dieselbe Kategorie-Entscheidung, die frueher deterministisch im Code-Node
  // "Teamdiagnose erzeugen" stand - als Mock-Stellvertreter fuer das, was ein
  // echtes LLM aus denselben Fakten schlussfolgern sollte. Die eigentliche
  // Story ersetzt die Quelle dieser Entscheidung (Code -> LLM), nicht die
  // fachliche Grundwahrheit der Testfixtures (HSV=defensiv, Bayern=neutral,
  // Leverkusen=offensiv).
  const diff = perf.avgGoalsAgainst - perf.avgGoalsFor;
  const diagnosisCategory = diff >= 0.5 ? 'defensive' : (perf.avgGoalsFor < 1 ? 'offensive' : 'neutral');
  const mainProblem = diagnosisCategory === 'defensive'
    ? `Mock-LLM: primaer defensives Problem bei ${json.club} (avgGoalsAgainst ${perf.avgGoalsAgainst} > avgGoalsFor ${perf.avgGoalsFor}).`
    : diagnosisCategory === 'offensive'
      ? `Mock-LLM: primaer offensives Problem bei ${json.club} (avgGoalsFor ${perf.avgGoalsFor} < 1).`
      : `Mock-LLM: kein eindeutiger struktureller Schwerpunkt bei ${json.club}.`;

  return {
    output: {
      diagnosisCategory,
      leagueComparison: `Mock-Ligavergleich fuer ${json.club}: Kategorie '${diagnosisCategory}' auf Basis von ${perf.matchesAnalyzed} CSV-Spielen.`,
      hypotheses: [`Mock-Hypothese (${diagnosisCategory}) auf Basis der gegebenen Evidenz.`],
      counterHypotheses: [`Mock-Gegenhypothese: die Bilanz koennte auch durch einen ungewoehnlich schweren Spielplan bedingt sein.`],
      mainProblem,
      uncertainties: ['Mock-Unsicherheit: keine erwartbaren Tore (xG), keine Gegnerstaerke, kein Vergleichszeitraum verfuegbar.']
    }
  };
}

function mockSpielerprofilLlm(json, override) {
  const allowedPositions = json.allowedPositions;
  // Deterministisch die erste erlaubte Position waehlen, sofern kein Test
  // gezielt eine andere (ggf. ungueltige) Position erzwingt - siehe
  // playerProfileMockOverride weiter unten fuer den Negativtest.
  const position = (override && override.position) || allowedPositions[0];
  const weightedCriteria = ATTACKING_POSITIONS.includes(position)
    ? [{ criterion: 'goals', weight: 0.5 }, { criterion: 'assists', weight: 0.3 }, { criterion: 'rating', weight: 0.2 }]
    : [{ criterion: 'rating', weight: 0.5 }, { criterion: 'appearances', weight: 0.3 }, { criterion: 'age', weight: 0.2 }];

  return {
    output: {
      position,
      role: `Mock-LLM-Rolle fuer die Position ${position}.`,
      weightedCriteria,
      constraints: ['Mock-Constraint: Budgetobergrenze (Platzhalter).', 'Mock-Constraint: Altersgrenze (Platzhalter).'],
      reasoning: `Mock-Begruendung auf Basis des Hauptproblems: ${json.teamDiagnosis.mainProblem}`
    }
  };
}

function mockLlmChain(node, json, options) {
  if (node.name === 'Teamdiagnose LLM') return mockTeamdiagnoseLlm(json);
  if (node.name === 'Spielerprofil LLM') return mockSpielerprofilLlm(json, options && options.playerProfileMockOverride);
  throw new Error(`Simulation: kein Mock fuer chainLlm-Node definiert: ${node.name}`);
}

function runNode(node, json, history, options) {
  if (node.type === 'n8n-nodes-base.code') {
    return codeFn(node)({ item: { json } }, makeDollar(history))[0].json;
  }
  if (node.type === 'n8n-nodes-base.executeWorkflow') {
    const sub = subworkflows[node.parameters.workflowId.value];
    const codeNode = sub.nodes.find((n) => n.type === 'n8n-nodes-base.code');
    return codeFn(codeNode)({ item: { json } })[0].json;
  }
  if (node.type === 'n8n-nodes-base.if') {
    return json; // gate handling done by caller via json.valid
  }
  if (node.type === '@n8n/n8n-nodes-langchain.chainLlm') {
    // Bewusst NICHT { ...json, ...mocked } zurueckgeben: die reale Basic LLM
    // Chain mit aktivem Output Parser liefert ausschliesslich { output: ... }
    // als Main-Output und verwirft den Rest des Items - siehe Kommentar oben.
    return mockLlmChain(node, json, options);
  }
  throw new Error(`unsupported node type in simulation: ${node.type} (${node.name})`);
}

function nodeByName(wf, name) {
  return wf.nodes.find((n) => n.name === name);
}

// Bildet die im Hauptworkflow ueber die IF-Node "Teamdiagnose:
// Datenverfuegbarkeit pruefen" verzweigte Teamdiagnose-Stufe nach: ohne
// CSV-Analytics-Daten (teamPerformance.dataAvailable === false) wird die
// Ollama-Chain gar nicht erst aufgerufen (deterministischer
// "Teamdiagnose (keine Daten) erzeugen"-Zweig), sonst durchlaeuft das Item
// Evidenz-Aufbereitung -> LLM-Mock -> Merge - siehe n8n/README.md.
function runTeamdiagnoseStage(json, history) {
  history['Teamdiagnose: Datenverfuegbarkeit pruefen'] = json;

  if (json.teamPerformance && json.teamPerformance.dataAvailable === true) {
    const evidenceNode = nodeByName(main, 'Teamdiagnose: Evidenz aufbereiten');
    json = runNode(evidenceNode, json, history);
    history['Teamdiagnose: Evidenz aufbereiten'] = json;

    const llmNode = nodeByName(main, 'Teamdiagnose LLM');
    json = runNode(llmNode, json, history);
    history['Teamdiagnose LLM'] = json;

    const mergeNode = nodeByName(main, 'Teamdiagnose zusammenfuehren');
    json = runNode(mergeNode, json, history);
    history['Teamdiagnose zusammenfuehren'] = json;
  } else {
    const noDataNode = nodeByName(main, 'Teamdiagnose (keine Daten) erzeugen');
    json = runNode(noDataNode, json, history);
    history['Teamdiagnose (keine Daten) erzeugen'] = json;
  }
  return json;
}

// Runs the main chain starting right after "Eingabe validieren" (true branch),
// i.e. starting from an item that already has club/objective/additionalContext.
// options.playerProfileMockOverride erlaubt es Tests, die vom Mock gewaehlte
// Spielerprofil-Position gezielt zu ueberschreiben (z. B. mit einer Position
// ausserhalb des erlaubten Pools, um den Negativtest fuer die
// Positions-Konsistenzpruefung zu erzwingen).
function runPipeline(initialJson, { stopAfter, playerProfileMockOverride } = {}) {
  const chain = [
    'Team-Performance abrufen',
    'Team-Matches abrufen',
    // Nicht mehr ein einzelner Code-Node: STAGE:Teamdiagnose bildet die
    // IF-Verzweigung "Teamdiagnose: Datenverfuegbarkeit pruefen" plus ihre
    // beiden Zweige nach (siehe runTeamdiagnoseStage).
    'STAGE:Teamdiagnose',
    'Teamdiagnose pruefen',
    'GATE:Teamdiagnose gueltig?',
    'Spielerprofil: Positionspool ermitteln',
    'Spielerprofil LLM',
    'Spielerprofil zusammenfuehren',
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
  const history = {};
  const options = { playerProfileMockOverride };

  for (const step of chain) {
    if (step.startsWith('GATE:')) {
      const gateName = step.slice('GATE:'.length);
      if (json.valid !== true) {
        return { failedAt: gateName, errorMessage: json.errorMessage, json };
      }
      continue;
    }
    if (step === 'STAGE:Teamdiagnose') {
      json = runTeamdiagnoseStage(json, history);
      if (stopAfter === step) return { json, stoppedAt: step };
      continue;
    }
    const node = nodeByName(main, step);
    if (!node) throw new Error(`node missing from main workflow: ${step}`);
    json = runNode(node, json, history, options);
    history[step] = json;
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
assert.ok(typeof fr.teamDiagnosis.leagueComparison === 'string' && fr.teamDiagnosis.leagueComparison.trim(), 'teamDiagnosis.leagueComparison sollte ein nichtleerer String sein');
assert.ok(Array.isArray(fr.teamDiagnosis.counterHypotheses), 'teamDiagnosis.counterHypotheses sollte ein Array sein');
assert.ok(Array.isArray(fr.teamDiagnosis.evidence) && fr.teamDiagnosis.evidence.length > 0, 'teamDiagnosis.evidence sollte weiterhin die deterministisch berechneten Fakten enthalten');
assert.ok(fr.teamDiagnosis.evidence.every((e) => !e.startsWith('Mock-LLM')), 'evidence sollte ausschliesslich der deterministische Befund sein, nicht die LLM-Interpretation');
assert.strictEqual(fr.playerProfile.simulated, false, 'playerProfile sollte nicht mehr als Dummy markiert sein');
assert.strictEqual(fr.playerSearch.simulated, false);
assert.ok(fr.playerSearch.shortlist.length > 0 && fr.playerSearch.shortlist.length <= 5);
assert.ok(fr.playerSearch.shortlist.every((c) => c.name), 'jeder Shortlist-Kandidat braucht einen Namen');
assert.ok(!fr.playerSearch.shortlist.some((c) => c.name.toLowerCase().includes('hamburger')), 'Kandidaten sollten nicht aus dem eigenen Kader stammen');
// Konsistenz Diagnose -> gesuchte Position/Kandidat (P1-Finding aus dem Review):
// bei einem Defensivproblem darf die Bedarfsermittlung nicht trotzdem einen
// Stuermer suchen. playerRanking bleibt im Item erhalten (Execute-Workflow-
// Nodes mergen ihr Ergebnis per {...item}), daher hier direkt pruefbar.
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
console.log('OK: kompletter Positivpfad, Teamdiagnose=Defensivproblem (jetzt per LLM-Mock interpretiert, Evidenz weiterhin deterministisch), gesuchte Position ist defensiv, Kandidat ausserhalb des eigenen Kaders und tatsaechlich auf dieser Position, Empfehlung inkl. CSV-Profil.');

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
assert.ok(ATTACKING_POSITIONS.includes(lev.json.playerProfile.position), `Bei einem Offensivproblem sollte eine offensive Position gesucht werden, nicht '${lev.json.playerProfile.position}'`);
assert.ok(lev.json.playerRanking.ranking.every((p) => p.position === lev.json.playerProfile.position), 'alle gerankten Kandidaten sollten tatsaechlich die gesuchte (offensive) Position spielen');
assert.strictEqual(lev.json.recommendation.candidateProfile.position, lev.json.playerProfile.position, 'die empfohlene Person sollte tatsaechlich auf der aus der Offensivdiagnose gesuchten Position spielen');
console.log('OK: Leverkusen-Diagnose = Offensivproblem, gesuchte Position ist offensiv und Kandidat spielt tatsaechlich dort.');

console.log('\n=== Negativtestfall: unbekannter Verein (Formular-Bypass) ===');
const unknown = runPipeline({ ...baseHsvInput(), club: 'SV Unbekannt 1900', objective: 'Testfall' });
assert.strictEqual(unknown.json.teamDiagnosis.dataAvailable, false, 'Teamdiagnose sollte fehlende Daten explizit ausweisen, nichts erfinden');
assert.strictEqual(unknown.json.teamDiagnosis.diagnosisCategory, 'no_data');
assert.ok(Array.isArray(unknown.json.teamDiagnosis.counterHypotheses), 'auch der no-data-Zweig muss counterHypotheses als Array liefern (Gate-Anforderung)');
assert.ok(typeof unknown.json.teamDiagnosis.leagueComparison === 'string' && unknown.json.teamDiagnosis.leagueComparison.trim(), 'auch der no-data-Zweig muss leagueComparison als nichtleeren String liefern (Gate-Anforderung)');
// Die Teamdiagnose selbst bleibt schema-gueltig (nicht-leere Felder), aber die
// Spielersuche kann fuer den unbekannten Verein keinen Bedarf real bedienen -
// tatsaechlich schlaegt sie hier NICHT fehl, weil excludeClub nur den (unbekannten)
// Club ausschliesst und der Rest des Marktes durchsucht wird. Das ist gewolltes
// Verhalten: die Spielersuche ist unabhaengig vom Diagnoseergebnis des angefragten
// Vereins moeglich, sie erfindet dabei aber keine Daten ueber den unbekannten Verein selbst.
// Wichtig fuer diese Story: OHNE CSV-Daten wird "Teamdiagnose LLM" gar nicht erst
// aufgerufen (siehe runTeamdiagnoseStage) - es gibt hier also nichts, was der
// Mock ueberhaupt haette erfinden koennen.
console.log('OK: unbekannter Verein fuehrt zu explizit ausgewiesenem Datenmangel in der Teamdiagnose (LLM wurde dafuer gar nicht erst aufgerufen), kein Absturz, keine erfundenen Werte.', { failedAt: unknown.failedAt || null });

console.log('\n=== Negativtestfall: LLM waehlt eine zur Diagnose inkonsistente Position ===');
// Erzwingt ueber playerProfileMockOverride eine Mock-LLM-Antwort mit einer
// Position ausserhalb des fuer die HSV-Defensivdiagnose erlaubten Pools
// (DEFENSIVE_POSITIONS) - simuliert damit ein LLM, das sich nicht an die im
// Prompt vorgegebene Positionsliste haelt. "Spielerprofil pruefen" muss das
// unabhaengig vom (an sich schema-gueltigen) Parser-Output abfangen.
const inconsistent = runPipeline(baseHsvInput(), { playerProfileMockOverride: { position: 'Mittelstürmer' } });
assert.strictEqual(inconsistent.failedAt, 'Spielerprofil gueltig?', 'eine zur Diagnosekategorie inkonsistente Position sollte am Spielerprofil-Gate scheitern');
assert.match(inconsistent.errorMessage, /passt nicht zur Diagnosekategorie/, 'die Fehlermeldung sollte die Positions-Diagnose-Inkonsistenz benennen');
console.log('OK: eine vom Mock-LLM ausserhalb des erlaubten Pools gewaehlte Position wird von "Spielerprofil pruefen" als ungueltig erkannt, obwohl das Parser-Schema selbst dagegen nichts einzuwenden haette.');

console.log('\nAlle Simulationen erfolgreich.');
