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

console.log(`\n${checks} Pruefungen erfolgreich.`);
