'use strict';
// Regressionstest fuer die vier CSV-Analytics-Subworkflows: fuehrt den in jeder
// n8n/analytics-*-subworkflow.json eingebetteten Code-Node-jsCode direkt mit
// Node.js aus (dieselbe "Logiksimulation" wie in n8n/README.md fuer den
// Hauptworkflow beschrieben) und prueft ihn gegen n8n/data/{matches,players}.csv.
// Aufruf: node n8n/data/verify-analytics.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const N8N_DIR = path.join(__dirname, '..');

function runSubworkflow(fileName, inputJson) {
  const wf = JSON.parse(fs.readFileSync(path.join(N8N_DIR, fileName), 'utf8'));
  const codeNode = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code');
  const fn = new Function('$input', codeNode.parameters.jsCode);
  return fn({ item: { json: inputJson } })[0].json;
}

// Wie runSubworkflow, ersetzt aber die im Code-Node eingebettete CSV-Kopie
// (MATCHES_CSV bzw. PLAYERS_CSV) durch eine frei waehlbare Test-CSV - so lassen
// sich leere/ungueltige Zellen gezielt gegen die echte Validierungslogik der
// Subworkflows testen, ohne n8n/data/matches.csv bzw. players.csv selbst
// anfassen zu muessen.
function runSubworkflowWithCsv(fileName, csvVarName, csvText, inputJson) {
  const wf = JSON.parse(fs.readFileSync(path.join(N8N_DIR, fileName), 'utf8'));
  const codeNode = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code');
  const marker = `const ${csvVarName} = \``;
  const start = codeNode.parameters.jsCode.indexOf(marker);
  assert.ok(start !== -1, `${csvVarName} nicht im Code-Node von ${fileName} gefunden`);
  const end = codeNode.parameters.jsCode.indexOf('`;', start + marker.length);
  assert.ok(end !== -1, `Ende von ${csvVarName} nicht im Code-Node von ${fileName} gefunden`);
  const code = codeNode.parameters.jsCode.slice(0, start) + marker + csvText + codeNode.parameters.jsCode.slice(end);
  const fn = new Function('$input', code);
  return fn({ item: { json: inputJson } })[0].json;
}

let checks = 0;
function check(label, actual, expected) {
  checks++;
  assert.deepStrictEqual(actual, expected, label);
  console.log('OK:', label);
}

// --- Team-Performance ---
check(
  'Team-Performance: Hamburger SV hat mehr Niederlagen als Siege (Ausgangslage der Story)',
  runSubworkflow('analytics-team-performance-subworkflow.json', { club: 'Hamburger SV' }).teamPerformance.losses > runSubworkflow('analytics-team-performance-subworkflow.json', { club: 'Hamburger SV' }).teamPerformance.wins,
  true
);
check(
  'Team-Performance: unbekannter Verein liefert dataAvailable:false statt erfundener Werte',
  runSubworkflow('analytics-team-performance-subworkflow.json', { club: 'FC Nirgendwo' }).teamPerformance.dataAvailable,
  false
);

// --- Team-Matches ---
check(
  'Team-Matches: matchLimit begrenzt die Anzahl zurueckgegebener Spiele',
  runSubworkflow('analytics-team-matches-subworkflow.json', { club: 'Hamburger SV', matchLimit: 2 }).teamMatches.count,
  2
);
check(
  'Team-Matches: unbekannter Verein liefert eine leere, nicht erfundene Liste',
  runSubworkflow('analytics-team-matches-subworkflow.json', { club: 'FC Nirgendwo' }).teamMatches.matches,
  []
);

// --- Player-Ranking ---
const hsvIv = runSubworkflow('analytics-player-ranking-subworkflow.json', { rankingClub: 'Hamburger SV', position: 'Innenverteidiger' }).playerRanking;
check('Player-Ranking: Positionsfilter liefert nur Spieler dieser Position', hsvIv.ranking.every((p) => p.position === 'Innenverteidiger'), true);
check('Player-Ranking: Positionsfilter reduziert den Pool gegenueber dem Vereinskader', hsvIv.poolSize < hsvIv.clubPoolSize, true);
const unknownPos = runSubworkflow('analytics-player-ranking-subworkflow.json', { rankingClub: 'Hamburger SV', position: 'Sechser' }).playerRanking;
check('Player-Ranking: unbekannte Position faellt explizit markiert auf den Kader zurueck statt Spieler zu erfinden', unknownPos.positionFallbackApplied, true);
const unknownClub = runSubworkflow('analytics-player-ranking-subworkflow.json', { rankingClub: 'FC Nirgendwo' }).playerRanking;
check('Player-Ranking: unbekannter Verein liefert eine leere Rangliste', unknownClub.ranking, []);
const excluded = runSubworkflow('analytics-player-ranking-subworkflow.json', { rankingExcludeClub: 'Hamburger SV', position: 'Mittelstürmer', limit: 10 }).playerRanking;
check('Player-Ranking: rankingExcludeClub schliesst den eigenen Verein aus der Scouting-Suche aus', excluded.ranking.every((p) => p.club !== 'Hamburger SV'), true);
check('Player-Ranking: rankingExcludeClub durchsucht weiterhin mehrere andere Vereine', new Set(excluded.ranking.map((p) => p.club)).size > 1, true);

// --- Player-Profil ---
check(
  'Player-Profil: bekannter Spieler wird gefunden und Verein stimmt mit players.csv ueberein',
  runSubworkflow('analytics-player-profile-subworkflow.json', { playerName: 'W. Krieger' }).playerProfileLookup.profile.club,
  'FC Bayern München'
);
check(
  'Player-Profil: unbekannter Spieler wird explizit als nicht gefunden markiert statt erfunden',
  runSubworkflow('analytics-player-profile-subworkflow.json', { playerName: 'Nobody' }).playerProfileLookup.found,
  false
);

// --- Negativtests: leere/ungueltige CSV-Zellen duerfen nicht als 0/NaN in
// Aggregation, Ranking oder Profil einfliessen, sondern muessen explizit als
// Datenfehler ausgewiesen werden (Number('')===0, Number(undefined)===NaN
// waeren beides stillschweigend falsche Messwerte).
const MATCHES_WITH_GAPS_CSV = [
  'club,date,opponent,homeAway,goalsFor,goalsAgainst,competition',
  'Testverein,2026-08-30,Gegner A,H,,2,Bundesliga',
  'Testverein,2026-08-23,Gegner B,A,2,ungueltig,Bundesliga',
  'Testverein,2026-08-16,Gegner C,H,1,1,Bundesliga'
].join('\n');

const perfWithGaps = runSubworkflowWithCsv(
  'analytics-team-performance-subworkflow.json', 'MATCHES_CSV', MATCHES_WITH_GAPS_CSV, { club: 'Testverein' }
).teamPerformance;
check('Team-Performance: Zeilen mit fehlenden/ungueltigen Tordaten werden gezaehlt statt als 0 in die Bilanz einzufliessen', perfWithGaps.invalidMatches, 2);
check('Team-Performance: nur die eine valide Zeile geht in matchesAnalyzed ein', perfWithGaps.matchesAnalyzed, 1);
check('Team-Performance: Bilanz basiert ausschliesslich auf der validen 1:1-Zeile, nicht auf erfundenen 0-Toren', perfWithGaps.goalsFor === 1 && perfWithGaps.goalsAgainst === 1, true);

const matchesWithGaps = runSubworkflowWithCsv(
  'analytics-team-matches-subworkflow.json', 'MATCHES_CSV', MATCHES_WITH_GAPS_CSV, { club: 'Testverein' }
).teamMatches;
check('Team-Matches: fehlende/ungueltige Tordaten werden als dataError markiert statt erfunden', matchesWithGaps.matches.filter((m) => m.dataError).length, 2);
check('Team-Matches: dataError-Spiele haben result explizit null statt geraten', matchesWithGaps.matches.filter((m) => m.dataError).every((m) => m.result === null), true);
check('Team-Matches: dataError-Spiele haben die fehlerhafte Torzahl explizit null statt 0/NaN', matchesWithGaps.matches.filter((m) => m.dataError).every((m) => m.goalsFor === null || m.goalsAgainst === null), true);

const PLAYERS_WITH_GAPS_CSV = [
  'club,name,position,age,marketValueMEUR,appearances,goals,assists,minutesPlayed,yellowCards,redCards,rating',
  'Testverein,A. Incomplete,Innenverteidiger,,5.0,6,0,0,540,0,0,6.0',
  'Testverein,B. Invalid,Innenverteidiger,25,5.0,6,0,0,540,0,0,ungueltig',
  'Testverein,C. Valid,Innenverteidiger,24,5.0,6,1,1,540,0,0,6.5'
].join('\n');

const rankingWithGaps = runSubworkflowWithCsv(
  'analytics-player-ranking-subworkflow.json', 'PLAYERS_CSV', PLAYERS_WITH_GAPS_CSV, { rankingClub: 'Testverein', position: 'Innenverteidiger' }
).playerRanking;
check('Player-Ranking: Spieler mit fehlendem/ungueltigem Pflichtfeld (z. B. leeres age) werden ausgeschlossen statt mit 0/NaN gerankt', rankingWithGaps.excludedInvalidData, 2);
check('Player-Ranking: nur der vollstaendige Datensatz bleibt im Pool', rankingWithGaps.ranking.map((p) => p.name), ['C. Valid']);
check('Player-Ranking: ein fehlendes age (niedriger = besser) verschafft "A. Incomplete" keinen Vorteil, da er ausgeschlossen ist', rankingWithGaps.ranking.some((p) => p.name === 'A. Incomplete'), false);

const PLAYER_PROFILE_WITH_GAPS_CSV = [
  'club,name,position,age,marketValueMEUR,appearances,goals,assists,minutesPlayed,yellowCards,redCards,rating',
  'Testverein,D. Incomplete,Mittelstürmer,26,,6,,3,500,0,0,7.0'
].join('\n');

const profileWithGaps = runSubworkflowWithCsv(
  'analytics-player-profile-subworkflow.json', 'PLAYERS_CSV', PLAYER_PROFILE_WITH_GAPS_CSV, { playerName: 'D. Incomplete' }
).playerProfileLookup;
check('Player-Profil: fehlende numerische Felder werden namentlich in invalidFields ausgewiesen statt erfunden', profileWithGaps.invalidFields, ['marketValueMEUR', 'goals']);
check('Player-Profil: die fehlenden Felder bleiben im Profil explizit null statt 0/NaN', profileWithGaps.profile.marketValueMEUR === null && profileWithGaps.profile.goals === null, true);
check('Player-Profil: vorhandene Felder (z. B. age) werden trotzdem korrekt uebernommen', profileWithGaps.profile.age, 26);
check('Player-Profil: dataError markiert den Datensatz als unvollstaendig', profileWithGaps.profile.dataError, true);

console.log(`\n${checks} Pruefungen erfolgreich.`);
