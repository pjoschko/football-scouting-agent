'use strict';

// Verifiziert, dass die zentralen Club-Maps im Node "Auftrag normalisieren"
// (n8n/ai-sporting-director.json) jeden der 18 Bundesliga-Dropdown-Werte der
// Saison 2025/26 auf die tatsaechlichen Team-Identifier BEIDER
// Analytics-Quelldateien abbilden:
// - CLUB_CANONICAL_MAP -> bundesliga_2025_26_match_analytics.csv (Spalten
//   Heimteam/Auswärtsteam), gegen die Team-Performance/Team-Matches per
//   exaktem String-Vergleich matchen.
// - CLUB_PLAYER_DATA_MAP -> players_data-2025_2026-full.csv (Spalte
//   'Squad'), gegen die Player-Ranking den Eigenkader-Ausschluss
//   (rankingExcludeClub) per exaktem String-Vergleich durchfuehrt. Diese
//   Identifier weichen bei 8 der 18 Vereine von CLUB_CANONICAL_MAP ab (z. B.
//   'Borussia Dortmund' vs. 'Dortmund', 'RasenBallsport Leipzig' vs.
//   'RB Leipzig'); ohne eigene Map wuerden eigene Spieler dieser Clubs nicht
//   ausgeschlossen und koennten als Transferkandidaten gerankt werden.
// Ausserdem wird der Rueckgabevertrag des Code-Nodes gegen dessen
// konfigurierten Ausfuehrungsmodus geprueft (n8n 2.35.7: runOnceForEachItem
// verlangt ein einzelnes Item-Objekt, kein Array), und dass
// "Player-Ranking-Anfrage vorbereiten" tatsaechlich CLUB_PLAYER_DATA_MAP
// (ueber clubPlayerData) statt CLUB_CANONICAL_MAP fuer rankingExcludeClub
// verwendet.

const fs = require('node:fs');
const path = require('node:path');

const n8nDir = path.resolve(__dirname, '..');
const workflowPath = path.join(n8nDir, 'ai-sporting-director.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

const node = workflow.nodes.find((n) => n.name === 'Auftrag normalisieren');
if (!node) {
  console.error('Node "Auftrag normalisieren" nicht gefunden.');
  process.exit(1);
}

const { mode, jsCode } = node.parameters;

// Dropdown-Wert (Formular "Verein") -> tatsaechlicher Team-Identifier in
// bundesliga_2025_26_match_analytics.csv. Nur 4 der 18 Vereine sind
// wortgleich zwischen Dropdown-Label und CSV-Team-Identifier.
const EXPECTED_CLUB_CANONICAL_MAP = {
  'FC Bayern München': 'Bayern Munich',
  'Borussia Dortmund': 'Borussia Dortmund',
  'RB Leipzig': 'RasenBallsport Leipzig',
  'VfB Stuttgart': 'VfB Stuttgart',
  'TSG Hoffenheim': 'Hoffenheim',
  'Bayer 04 Leverkusen': 'Bayer Leverkusen',
  'Sport-Club Freiburg': 'Freiburg',
  'Eintracht Frankfurt': 'Eintracht Frankfurt',
  'FC Augsburg': 'Augsburg',
  '1. FSV Mainz 05': 'Mainz 05',
  '1. FC Union Berlin': 'Union Berlin',
  'Borussia Mönchengladbach': 'Borussia M.Gladbach',
  'Hamburger SV': 'Hamburger SV',
  '1. FC Köln': 'FC Cologne',
  'SV Werder Bremen': 'Werder Bremen',
  'VfL Wolfsburg': 'Wolfsburg',
  '1. FC Heidenheim 1846': 'FC Heidenheim',
  'FC St. Pauli': 'St. Pauli',
};

// Dropdown-Wert -> tatsaechlicher 'Squad'-Identifier in
// players_data-2025_2026-full.csv. 8 der 18 Vereine weichen hier von
// EXPECTED_CLUB_CANONICAL_MAP ab.
const EXPECTED_CLUB_PLAYER_DATA_MAP = {
  'FC Bayern München': 'Bayern Munich',
  'Borussia Dortmund': 'Dortmund',
  'RB Leipzig': 'RB Leipzig',
  'VfB Stuttgart': 'Stuttgart',
  'TSG Hoffenheim': 'Hoffenheim',
  'Bayer 04 Leverkusen': 'Leverkusen',
  'Sport-Club Freiburg': 'Freiburg',
  'Eintracht Frankfurt': 'Eint Frankfurt',
  'FC Augsburg': 'Augsburg',
  '1. FSV Mainz 05': 'Mainz 05',
  '1. FC Union Berlin': 'Union Berlin',
  'Borussia Mönchengladbach': 'Gladbach',
  'Hamburger SV': 'Hamburger SV',
  '1. FC Köln': 'Köln',
  'SV Werder Bremen': 'Werder Bremen',
  'VfL Wolfsburg': 'Wolfsburg',
  '1. FC Heidenheim 1846': 'Heidenheim',
  'FC St. Pauli': 'St. Pauli',
};

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

// 1) Rueckgabevertrag gegen konfigurierten Modus pruefen (P1: n8n 2.35.7
// verwirft bei runOnceForEachItem ein Array-Ergebnis als
// "Code doesn't return a single object").
assert(mode === 'runOnceForEachItem', `unerwarteter Node-Modus: ${mode}`);
const returnsArray = /return\s*\[\s*\{\s*json\s*:/.test(jsCode);
assert(!returnsArray, 'jsCode gibt ein Array zurueck, aber Modus ist runOnceForEachItem');
assert(/return\s*\{\s*json\s*:/.test(jsCode), 'jsCode gibt kein einzelnes { json: ... }-Objekt zurueck');

// 2) Beide Club-Maps aus dem Node-Code extrahieren und pro Verein gegen die
// tatsaechlichen CSV-Team-Identifier der jeweiligen Datenquelle verifizieren.
const extractMap = (constName) => {
  const match = jsCode.match(new RegExp(`const ${constName} = (\\{[\\s\\S]*?\\n\\};)`));
  assert(Boolean(match), `${constName} nicht im jsCode gefunden`);
  if (!match) return null;
  // Kontrollierte Auswertung eines reinen Objekt-Literals aus dem eigenen
  // Workflow-Code (keine Fremdeingabe) in einem isolierten Function-Scope.
  // eslint-disable-next-line no-new-func
  return new Function(`return ${match[1].replace(/;$/, '')};`)();
};

const verifyMap = (constName, actualMap, expectedMap, sourceFile) => {
  if (!actualMap) return;
  const expectedClubs = Object.keys(expectedMap);
  const actualClubs = Object.keys(actualMap);

  assert(
    actualClubs.length === expectedClubs.length,
    `${constName} hat ${actualClubs.length} Eintraege, erwartet werden ${expectedClubs.length}`
  );

  for (const club of expectedClubs) {
    const expected = expectedMap[club];
    const actual = actualMap[club];
    assert(
      actual === expected,
      `${constName}['${club}'] === '${actual}', erwartet '${expected}' (${sourceFile})`
    );
  }

  return expectedClubs;
};

const actualCanonicalMap = extractMap('CLUB_CANONICAL_MAP');
const actualPlayerDataMap = extractMap('CLUB_PLAYER_DATA_MAP');

const expectedClubs = verifyMap(
  'CLUB_CANONICAL_MAP',
  actualCanonicalMap,
  EXPECTED_CLUB_CANONICAL_MAP,
  'bundesliga_2025_26_match_analytics.csv'
);
verifyMap(
  'CLUB_PLAYER_DATA_MAP',
  actualPlayerDataMap,
  EXPECTED_CLUB_PLAYER_DATA_MAP,
  "players_data-2025_2026-full.csv, Spalte 'Squad'"
);

if (actualCanonicalMap && actualPlayerDataMap) {
  // 3) Dropdown-Optionen des Formulars muessen exakt den Map-Schluesseln
  // beider Maps entsprechen, sonst ergibt eine gueltige Auswahl ein leeres
  // `club`/`clubPlayerData`.
  const formNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.formTrigger');
  const dropdown = formNode?.parameters?.formFields?.values?.find((f) => f.fieldLabel === 'Verein');
  const dropdownOptions = (dropdown?.fieldOptions?.values || []).map((o) => o.option);

  assert(dropdownOptions.length === 18, `Dropdown "Verein" hat ${dropdownOptions.length} Optionen, erwartet 18`);
  for (const option of dropdownOptions) {
    assert(option in actualCanonicalMap, `Dropdown-Option '${option}' fehlt in CLUB_CANONICAL_MAP`);
    assert(option in actualPlayerDataMap, `Dropdown-Option '${option}' fehlt in CLUB_PLAYER_DATA_MAP`);
  }
  for (const club of expectedClubs) {
    assert(dropdownOptions.includes(club), `Map-Eintrag '${club}' ist keine Dropdown-Option mehr`);
  }
}

// 4) Downstream-Vertrag pruefen: "Player-Ranking-Anfrage vorbereiten" muss
// den Eigenkader-Ausschluss ueber CLUB_PLAYER_DATA_MAP (clubPlayerData)
// bestimmen, nicht ueber den Match-Identifier (club) - sonst werden eigene
// Spieler bei den 8 abweichenden Clubs nicht ausgeschlossen (Cross-Dataset-
// Bug, siehe Review).
const rankingPrepNode = workflow.nodes.find((n) => n.name === 'Player-Ranking-Anfrage vorbereiten');
assert(Boolean(rankingPrepNode), 'Node "Player-Ranking-Anfrage vorbereiten" nicht gefunden.');
if (rankingPrepNode) {
  const prepCode = rankingPrepNode.parameters.jsCode;
  assert(
    /rankingExcludeClub:\s*item\.clubPlayerData/.test(prepCode),
    "Player-Ranking-Anfrage vorbereiten setzt rankingExcludeClub nicht aus item.clubPlayerData (CLUB_PLAYER_DATA_MAP) - Eigenkader-Ausschluss würde gegen den falschen Datensatz vergleichen."
  );
  assert(
    !/rankingExcludeClub:\s*item\.club\b(?!PlayerData)/.test(prepCode),
    'Player-Ranking-Anfrage vorbereiten setzt rankingExcludeClub weiterhin aus dem Match-Identifier item.club.'
  );
}

if (failures.length) {
  console.error(`Club-Canonical-Map-Verifikation fehlgeschlagen (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  'OK: CLUB_CANONICAL_MAP und CLUB_PLAYER_DATA_MAP bilden alle 18 Dropdown-Vereine korrekt auf beide ' +
    'CSV-Datensaetze ab, und der Eigenkader-Ausschluss nutzt CLUB_PLAYER_DATA_MAP.'
);
