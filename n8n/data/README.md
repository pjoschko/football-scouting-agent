# CSV-Referenzdaten für den Analytics-Adapter

Diese beiden Dateien sind die kanonische, versionierte Datengrundlage für den
CSV-Analytics-Adapter (siehe [`n8n/README.md`](../README.md), Abschnitt
„CSV-Analytics-Adapter“). Sie sind exemplarische, in sich nicht als
vollständiger Spielplan konsistente Referenzdaten für fünf Vereine
(Hamburger SV, FC Bayern München, Borussia Dortmund, RB Leipzig, Bayer 04
Leverkusen — dieselben fünf Vereine wie im `Verein`-Dropdown des
Hauptworkflows) und dienen ausschließlich als Testgrundlage für den Adapter
sowie als fachliche Referenz für die spätere Qlik-Umsetzung.

- **`matches.csv`** — je Verein die letzten sechs Spiele, sortiert absteigend
  nach `date` (neuestes Spiel zuerst). Spalten: `club`, `date`, `opponent`,
  `homeAway` (`H`/`A`), `goalsFor`, `goalsAgainst`, `competition`.
- **`players.csv`** — je Verein zehn Spieler (eine Position je
  Kaderlinie: Torwart, zwei Innenverteidiger, Links-/Rechtsverteidiger,
  Defensives/Zentrales/Offensives Mittelfeld, Linksaußen, Mittelstürmer).
  Spalten: `club`, `name`, `position`, `age`, `marketValueMEUR`,
  `appearances`, `goals`, `assists`, `minutesPlayed`, `yellowCards`,
  `redCards`, `rating`.

Die vier n8n-Analytics-Subworkflows (`analytics-team-performance-subworkflow.json`,
`analytics-team-matches-subworkflow.json`, `analytics-player-ranking-subworkflow.json`,
`analytics-player-profile-subworkflow.json`) lesen **keine** Datei vom
Dateisystem, sondern enthalten den Inhalt dieser beiden CSV-Dateien als
eingebetteten String im jeweiligen Code-Node — n8n Code-Nodes haben keinen
verlässlichen, deployment-unabhängigen Dateisystempfad auf dieses
Repository.

## Tooling in diesem Verzeichnis

- **`build_subworkflows.js`** (`node n8n/data/build_subworkflows.js`) generiert
  alle vier `n8n/analytics-*-subworkflow.json` neu aus `matches.csv` /
  `players.csv` und der hier definierten Analytics-Logik. **Nach jeder
  Änderung an einer der beiden CSV-Dateien oder an der Analytics-Logik selbst
  muss dieses Skript erneut ausgeführt werden**, damit die eingebetteten
  Kopien zeichengleich bleiben — das ist die einzige Stelle im Adapter, die
  synchron gehalten werden muss, und entfällt vollständig, sobald die
  Subworkflows durch echte Qlik-MCP-Aufrufe ersetzt werden.
- **`verify-analytics.js`** (`node n8n/data/verify-analytics.js`) führt den in
  jedem `analytics-*-subworkflow.json` erzeugten Code direkt mit Node.js aus
  und prüft ihn gegen die beiden CSV-Dateien (u. a. Positionsfilter,
  `rankingExcludeClub`, und dass unbekannte Vereine/Spieler/Positionen explizit
  als solche ausgewiesen statt erfunden werden).
- **`simulate_main_workflow.js`** (`node n8n/data/simulate_main_workflow.js`)
  führt den kompletten Hauptworkflow (`../ai-sporting-director.json`) inklusive
  aller vier Analytics-Subworkflows und des Recherche-Subworkflows als
  Logiksimulation aus — für den HSV-Positivfall sowie für Bayern, Leverkusen
  und einen unbekannten Verein (Formular-Bypass).
