'use strict';
const fs = require('fs');
const path = require('path');

const N8N_DIR = path.join(__dirname, '..');
const MATCHES_CSV = fs.readFileSync(path.join(__dirname, 'matches.csv'), 'utf8');
const PLAYERS_CSV = fs.readFileSync(path.join(__dirname, 'players.csv'), 'utf8');

const PARSE_CSV_SNIPPET = `function parseCsv(text) {
  const lines = text.replace(/\\r\\n/g, '\\n').trim().split('\\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i]; });
    return row;
  });
}`;

function subworkflow({ id, name, triggerId, codeId, jsCode, position = [460, 300] }) {
  return {
    id,
    name,
    nodes: [
      {
        parameters: { inputSource: 'passthrough' },
        id: triggerId,
        name: 'Wenn von anderem Workflow aufgerufen',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [240, 300]
      },
      {
        parameters: { jsCode },
        id: codeId,
        name: 'CSV-Analytics ausfuehren',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position
      }
    ],
    connections: {
      'Wenn von anderem Workflow aufgerufen': {
        main: [[{ node: 'CSV-Analytics ausfuehren', type: 'main', index: 0 }]]
      }
    },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    settings: { executionOrder: 'v1' }
  };
}

function writeWorkflow(fileName, wf) {
  fs.writeFileSync(path.join(N8N_DIR, fileName), JSON.stringify(wf, null, 2) + '\n', 'utf8');
  console.log('wrote', fileName);
}

// ---------------------------------------------------------------------------
// 1. Teamperformance
// ---------------------------------------------------------------------------
const teamPerformanceCode = `const MATCHES_CSV = \`${MATCHES_CSV.trim()}\`;

${PARSE_CSV_SNIPPET}

// CSV-Analytics-Adapter (temporaerer Ersatz fuer Qlik MCP, siehe n8n/README.md).
// Tool-Vertrag: Input { club }, Output { ...item, teamPerformance }. Der eingebettete
// MATCHES_CSV-String ist eine zeichengleiche Kopie von n8n/data/matches.csv
// (siehe n8n/data/README.md) - n8n Code-Nodes koennen die Datei nicht
// zuverlaessig vom Dateisystem lesen.
const item = $input.item.json;
const club = (item.club || '').toString().trim();
const rows = parseCsv(MATCHES_CSV).filter((r) => r.club === club);

let teamPerformance;
if (rows.length === 0) {
  teamPerformance = {
    club,
    source: 'csv',
    dataAvailable: false,
    matchesAnalyzed: 0,
    note: \`Keine CSV-Match-Daten fuer Verein '\${club}' vorhanden (n8n/data/matches.csv).\`
  };
} else {
  let wins = 0, draws = 0, losses = 0, goalsFor = 0, goalsAgainst = 0;
  const form = [];
  rows.forEach((r) => {
    const gf = Number(r.goalsFor), ga = Number(r.goalsAgainst);
    goalsFor += gf; goalsAgainst += ga;
    let outcome;
    if (gf > ga) { wins++; outcome = 'W'; } else if (gf === ga) { draws++; outcome = 'D'; } else { losses++; outcome = 'L'; }
    form.push(outcome);
  });
  const matchesAnalyzed = rows.length;
  teamPerformance = {
    club,
    source: 'csv',
    dataAvailable: true,
    matchesAnalyzed,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    points: wins * 3 + draws,
    avgGoalsFor: Math.round((goalsFor / matchesAnalyzed) * 100) / 100,
    avgGoalsAgainst: Math.round((goalsAgainst / matchesAnalyzed) * 100) / 100,
    // Form ist in derselben Reihenfolge wie matches.csv fuer diesen Verein sortiert: neuestes Spiel zuerst.
    form
  };
}

return [{ json: { ...item, teamPerformance } }];`;

writeWorkflow('analytics-team-performance-subworkflow.json', subworkflow({
  id: 'e7a415a1-6e8b-4f26-a724-3f728588c6b3',
  name: 'Team-Performance (CSV)',
  triggerId: 'e0b8482f-cf16-4ef6-a907-d5c7816777c6',
  codeId: '79f4f54f-6afa-4612-a697-19f8dbd450d6',
  jsCode: teamPerformanceCode
}));

// ---------------------------------------------------------------------------
// 2. Team-Matches
// ---------------------------------------------------------------------------
const teamMatchesCode = `const MATCHES_CSV = \`${MATCHES_CSV.trim()}\`;

${PARSE_CSV_SNIPPET}

// CSV-Analytics-Adapter (temporaerer Ersatz fuer Qlik MCP, siehe n8n/README.md).
// Tool-Vertrag: Input { club, matchLimit? }, Output { ...item, teamMatches }.
// Der eingebettete MATCHES_CSV-String ist eine zeichengleiche Kopie von
// n8n/data/matches.csv (siehe n8n/data/README.md).
const item = $input.item.json;
const club = (item.club || '').toString().trim();
const limit = Number.isFinite(item.matchLimit) && item.matchLimit > 0 ? Math.floor(item.matchLimit) : 10;

const matches = parseCsv(MATCHES_CSV)
  .filter((r) => r.club === club)
  .slice(0, limit)
  .map((r) => {
    const gf = Number(r.goalsFor), ga = Number(r.goalsAgainst);
    return {
      date: r.date,
      opponent: r.opponent,
      homeAway: r.homeAway,
      goalsFor: gf,
      goalsAgainst: ga,
      result: gf > ga ? 'W' : (gf === ga ? 'D' : 'L'),
      competition: r.competition
    };
  });

const teamMatches = {
  club,
  source: 'csv',
  dataAvailable: matches.length > 0,
  count: matches.length,
  // Sortiert wie n8n/data/matches.csv: neuestes Spiel zuerst.
  matches,
  note: matches.length === 0 ? \`Keine CSV-Match-Daten fuer Verein '\${club}' vorhanden (n8n/data/matches.csv).\` : undefined
};

return [{ json: { ...item, teamMatches } }];`;

writeWorkflow('analytics-team-matches-subworkflow.json', subworkflow({
  id: '68f47ebf-1e64-41a1-af75-b2afae2c0fbc',
  name: 'Team-Matches (CSV)',
  triggerId: 'f8b9f781-0aec-4d17-b72d-056bd3430447',
  codeId: 'f32f1eb4-0920-405a-be50-9046d9e701fb',
  jsCode: teamMatchesCode
}));

// ---------------------------------------------------------------------------
// 3. Player-Ranking
// ---------------------------------------------------------------------------
const playerRankingCode = `const PLAYERS_CSV = \`${PLAYERS_CSV.trim()}\`;

${PARSE_CSV_SNIPPET}

// CSV-Analytics-Adapter (temporaerer Ersatz fuer Qlik MCP, siehe n8n/README.md).
// Tool-Vertrag: Input { rankingClub?, rankingExcludeClub?, position?, criteria?:
// [{ criterion, weight }], limit? }, Output { ...item, playerRanking }.
// rankingClub filtert auf genau einen Verein (z. B. fuer eine Kaderanalyse),
// rankingExcludeClub schliesst genau einen Verein aus (z. B. fuer eine
// Scouting-Suche ausserhalb des eigenen Kaders); beide sind unabhaengig von
// einem bestimmten Verein oder einer bestimmten Position nutzbar. Bewusst
// eigene Feldnamen statt des generischen "club" (das im Hauptworkflow bereits
// den zu diagnostizierenden Verein bezeichnet) - so kollidiert der ambiente
// item.club aus dem Hauptworkflow nicht mit dem Rangliste-Filter, wenn das
// gesamte Item per Execute Workflow durchgereicht wird. Der eingebettete
// PLAYERS_CSV-String ist eine zeichengleiche Kopie von n8n/data/players.csv
// (siehe n8n/data/README.md).
// Erkannte Kriterien (generisch, nicht an einen Verein oder eine Position gebunden):
// goals, assists, rating, minutesPlayed, appearances, marketValueMEUR (jeweils
// hoeher = besser) sowie age (niedriger = besser). Unbekannte Kriterien werden
// nicht erfunden, sondern explizit in ignoredCriteria aufgefuehrt.
const RANKING_STAT_FIELDS = {
  goals: { higherIsBetter: true },
  assists: { higherIsBetter: true },
  rating: { higherIsBetter: true },
  minutesPlayed: { higherIsBetter: true },
  appearances: { higherIsBetter: true },
  marketValueMEUR: { higherIsBetter: true },
  age: { higherIsBetter: false }
};
const DEFAULT_CRITERIA = [
  { criterion: 'rating', weight: 0.5 },
  { criterion: 'goals', weight: 0.3 },
  { criterion: 'assists', weight: 0.2 }
];

const item = $input.item.json;
const club = (item.rankingClub || '').toString().trim() || null;
const excludeClub = (item.rankingExcludeClub || '').toString().trim() || null;
const position = (item.position || '').toString().trim() || null;
const effectiveLimit = Number.isFinite(item.limit) && item.limit > 0 ? Math.floor(item.limit) : 5;

const allRows = parseCsv(PLAYERS_CSV).map((r) => ({
  ...r,
  age: Number(r.age),
  marketValueMEUR: Number(r.marketValueMEUR),
  appearances: Number(r.appearances),
  goals: Number(r.goals),
  assists: Number(r.assists),
  minutesPlayed: Number(r.minutesPlayed),
  yellowCards: Number(r.yellowCards),
  redCards: Number(r.redCards),
  rating: Number(r.rating)
}));

let pool = allRows.slice();
if (club) pool = pool.filter((r) => r.club === club);
if (excludeClub) pool = pool.filter((r) => r.club !== excludeClub);
const clubPoolSize = pool.length;

// Unbekannte/nicht vorhandene Position: es wird kein Kandidat erfunden. Statt
// eines leeren Ergebnisses wird - explizit vermerkt ueber positionFallbackApplied -
// auf den ungefilterten Kader-/Gesamtpool zurueckgefallen, sofern dieser nicht leer ist.
let positionFallbackApplied = false;
if (position) {
  const filtered = pool.filter((r) => r.position.toLowerCase() === position.toLowerCase());
  if (filtered.length > 0) {
    pool = filtered;
  } else if (pool.length > 0) {
    positionFallbackApplied = true;
  }
}

if (pool.length === 0) {
  const playerRanking = {
    club,
    excludeClub,
    position,
    source: 'csv',
    dataAvailable: false,
    poolSize: 0,
    clubPoolSize,
    positionFallbackApplied: false,
    ignoredCriteria: [],
    ranking: [],
    note: club
      ? \`Keine CSV-Spielerdaten fuer Verein '\${club}' vorhanden (n8n/data/players.csv).\`
      : \`Keine CSV-Spielerdaten fuer Position '\${position}' vorhanden (n8n/data/players.csv).\`
  };
  return [{ json: { ...item, playerRanking } }];
}

const rawCriteria = Array.isArray(item.criteria) && item.criteria.length > 0 ? item.criteria : DEFAULT_CRITERIA;
const recognized = [];
const ignoredCriteria = [];
rawCriteria.forEach((c) => {
  if (c && RANKING_STAT_FIELDS[c.criterion] && typeof c.weight === 'number') {
    recognized.push(c);
  } else if (c) {
    ignoredCriteria.push(c.criterion || '(unbenannt)');
  }
});
const effectiveCriteria = recognized.length > 0 ? recognized : DEFAULT_CRITERIA;
const weightSum = effectiveCriteria.reduce((sum, c) => sum + c.weight, 0) || 1;

const ranges = {};
effectiveCriteria.forEach((c) => {
  const values = pool.map((p) => p[c.criterion]);
  ranges[c.criterion] = { min: Math.min(...values), max: Math.max(...values) };
});

const scored = pool.map((p) => {
  let score = 0;
  effectiveCriteria.forEach((c) => {
    const { min, max } = ranges[c.criterion];
    const spread = max - min;
    let normalized = spread === 0 ? 0.5 : (p[c.criterion] - min) / spread;
    if (!RANKING_STAT_FIELDS[c.criterion].higherIsBetter) normalized = 1 - normalized;
    score += normalized * (c.weight / weightSum);
  });
  return {
    name: p.name,
    club: p.club,
    position: p.position,
    age: p.age,
    score: Math.round(score * 1000) / 1000,
    stats: {
      goals: p.goals,
      assists: p.assists,
      rating: p.rating,
      minutesPlayed: p.minutesPlayed,
      appearances: p.appearances,
      marketValueMEUR: p.marketValueMEUR
    }
  };
});

scored.sort((a, b) => b.score - a.score);

const playerRanking = {
  club,
  excludeClub,
  position,
  source: 'csv',
  dataAvailable: true,
  poolSize: pool.length,
  clubPoolSize,
  positionFallbackApplied,
  ignoredCriteria,
  criteriaUsed: effectiveCriteria,
  ranking: scored.slice(0, effectiveLimit)
};

return [{ json: { ...item, playerRanking } }];`;

writeWorkflow('analytics-player-ranking-subworkflow.json', subworkflow({
  id: '5e50b3ea-5e60-436f-b8bd-77957b54355a',
  name: 'Player-Ranking (CSV)',
  triggerId: 'cc675a33-1985-43d4-af21-e726006a74bd',
  codeId: '21bca942-2d35-4f61-8951-0515adf3e631',
  jsCode: playerRankingCode
}));

// ---------------------------------------------------------------------------
// 4. Player-Profil
// ---------------------------------------------------------------------------
const playerProfileCode = `const PLAYERS_CSV = \`${PLAYERS_CSV.trim()}\`;

${PARSE_CSV_SNIPPET}

// CSV-Analytics-Adapter (temporaerer Ersatz fuer Qlik MCP, siehe n8n/README.md).
// Tool-Vertrag: Input { playerName }, Output { ...item, playerProfileLookup }.
// Der eingebettete PLAYERS_CSV-String ist eine zeichengleiche Kopie von
// n8n/data/players.csv (siehe n8n/data/README.md). Heisst playerProfileLookup
// (nicht playerProfile), da playerProfile im Hauptworkflow bereits das
// Bedarfsprofil (gesuchtes Anforderungsprofil) bezeichnet - beide Vertraege
// bleiben dadurch unabhaengig voneinander stabil.
const item = $input.item.json;
const requestedName = (item.playerName || '').toString().trim();
const match = parseCsv(PLAYERS_CSV).find((r) => r.name === requestedName);

const profile = match ? {
  name: match.name,
  club: match.club,
  position: match.position,
  age: Number(match.age),
  marketValueMEUR: Number(match.marketValueMEUR),
  appearances: Number(match.appearances),
  goals: Number(match.goals),
  assists: Number(match.assists),
  minutesPlayed: Number(match.minutesPlayed),
  yellowCards: Number(match.yellowCards),
  redCards: Number(match.redCards),
  rating: Number(match.rating)
} : null;

const playerProfileLookup = {
  source: 'csv',
  found: !!match,
  requestedName,
  profile,
  note: match ? undefined : \`Kein CSV-Datensatz fuer Spieler '\${requestedName}' vorhanden (n8n/data/players.csv).\`
};

return [{ json: { ...item, playerProfileLookup } }];`;

writeWorkflow('analytics-player-profile-subworkflow.json', subworkflow({
  id: 'd6f31473-12f9-40a2-b935-ca998397142e',
  name: 'Player-Profil (CSV)',
  triggerId: '8714a814-f9d9-4782-a122-f77931211430',
  codeId: '7ae028b2-6c42-4c8a-84ef-47ceddcef5ea',
  jsCode: playerProfileCode
}));

console.log('done');
