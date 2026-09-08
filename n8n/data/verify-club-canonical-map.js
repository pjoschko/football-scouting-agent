'use strict';

// Verifiziert, dass CLUB_CANONICAL_MAP im Node "Auftrag normalisieren"
// (n8n/ai-sporting-director.json) jeden der 18 Bundesliga-Dropdown-Werte der
// Saison 2025/26 auf den tatsaechlichen Team-Identifier aus
// bundesliga_2025_26_match_analytics.csv abbildet (Spalten Heimteam/
// Auswärtsteam), gegen den Team-Performance/Team-Matches per exaktem
// String-Vergleich matchen. Ausserdem wird der Rueckgabevertrag des Code-Nodes
// gegen dessen konfigurierten Ausfuehrungsmodus geprueft (n8n 2.35.7:
// runOnceForEachItem verlangt ein einzelnes Item-Objekt, kein Array).

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

// 2) CLUB_CANONICAL_MAP aus dem Node-Code extrahieren und pro Verein
// gegen die tatsaechlichen CSV-Team-Identifier verifizieren.
const mapMatch = jsCode.match(/const CLUB_CANONICAL_MAP = (\{[\s\S]*?\n\};)/);
assert(Boolean(mapMatch), 'CLUB_CANONICAL_MAP nicht im jsCode gefunden');

if (mapMatch) {
  // Kontrollierte Auswertung eines reinen Objekt-Literals aus dem eigenen
  // Workflow-Code (keine Fremdeingabe) in einem isolierten Function-Scope.
  // eslint-disable-next-line no-new-func
  const actualMap = new Function(`return ${mapMatch[1].replace(/;$/, '')};`)();

  const expectedClubs = Object.keys(EXPECTED_CLUB_CANONICAL_MAP);
  const actualClubs = Object.keys(actualMap);

  assert(
    actualClubs.length === expectedClubs.length,
    `CLUB_CANONICAL_MAP hat ${actualClubs.length} Eintraege, erwartet werden ${expectedClubs.length}`
  );

  for (const club of expectedClubs) {
    const expected = EXPECTED_CLUB_CANONICAL_MAP[club];
    const actual = actualMap[club];
    assert(
      actual === expected,
      `CLUB_CANONICAL_MAP['${club}'] === '${actual}', erwartet '${expected}' (bundesliga_2025_26_match_analytics.csv)`
    );
  }

  // 3) Dropdown-Optionen des Formulars muessen exakt den Map-Schluesseln
  // entsprechen, sonst ergibt eine gueltige Auswahl ein leeres `club`.
  const formNode = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.formTrigger');
  const dropdown = formNode?.parameters?.formFields?.values?.find((f) => f.fieldLabel === 'Verein');
  const dropdownOptions = (dropdown?.fieldOptions?.values || []).map((o) => o.option);

  assert(dropdownOptions.length === 18, `Dropdown "Verein" hat ${dropdownOptions.length} Optionen, erwartet 18`);
  for (const option of dropdownOptions) {
    assert(option in actualMap, `Dropdown-Option '${option}' fehlt in CLUB_CANONICAL_MAP`);
  }
  for (const club of expectedClubs) {
    assert(dropdownOptions.includes(club), `CLUB_CANONICAL_MAP-Eintrag '${club}' ist keine Dropdown-Option mehr`);
  }
}

if (failures.length) {
  console.error(`Club-Canonical-Map-Verifikation fehlgeschlagen (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: CLUB_CANONICAL_MAP bildet alle 18 Dropdown-Vereine korrekt auf die CSV-Team-Identifier ab.');
