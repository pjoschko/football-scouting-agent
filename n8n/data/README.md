# Originaldaten für den Analytics-Adapter

Die CSV-Daten werden **nicht mehr im Repository gespiegelt und nicht mehr als JavaScript-Strings in n8n-Code-Nodes eingebettet**.

## Einmaliger Import in n8n

1. `n8n/import-scouting-data.json` in n8n importieren.
2. Den Workflow `Scouting-Daten importieren` öffnen bzw. dessen Formular starten.
3. Die vollständigen Originaldateien hochladen:
   - `bundesliga_2025_26_match_analytics.csv`
   - `players_data-2025_2026-full.csv`
4. Der Workflow validiert die Dateien und schreibt sie in die persistente n8n Data Table `football_scouting_raw`.

Ein erneuter Import ersetzt den jeweiligen vorhandenen Datensatz (`matches` bzw. `players`). Der eigentliche `AI Sporting Director` benötigt danach keinen Datei-Upload mehr.

## Schutz gegen Stichproben

Der Import lehnt die frühere Mini-Datenbasis ausdrücklich ab:

- Match-Daten: mindestens 300 Zeilen und exakt 18 Bundesliga-Vereine; erwartet werden 306 Spiele.
- Player-Daten: mindestens 2.000 Zeilen; erwartet wird der vollständige Datensatz mit ungefähr 2.433 Spielern.
- Erforderliche Kernspalten werden vor dem Import geprüft.

## Speicherung

`football_scouting_raw` besitzt bewusst nur wenige technische Spalten:

- `dataset`: `matches` oder `players`
- `rowNumber`: Position in der Originaldatei
- `sourceFile`: kanonischer Dateiname
- `importedAt`: Importzeitpunkt
- `payload`: vollständige Originalzeile als JSON

Dadurch bleiben auch die rund 267 Player-Spalten vollständig erhalten, ohne das Data-Table-Schema hart an die CSV-Struktur zu koppeln.

## Analytics-Subworkflows

Die bestehenden Subworkflow-IDs und Tool-Verträge bleiben stabil:

- `analytics-team-performance-subworkflow.json`
- `analytics-team-matches-subworkflow.json`
- `analytics-player-ranking-subworkflow.json`
- `analytics-player-profile-subworkflow.json`

Sie lesen die importierten Originalzeilen aus `football_scouting_raw`. Die fachliche Schicht darüber muss daher beim späteren Wechsel zu Qlik MCP nicht neu entworfen werden.

## Nicht mehr verwenden

Die früheren `matches.csv`/`players.csv`, der Generator für eingebettete CSV-Strings und die darauf basierenden Simulationstests waren nur ein fünf Vereine umfassender Prototyp und sind für die Runtime-Datenquelle fachlich ungeeignet.