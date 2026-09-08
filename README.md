# football-scouting-agent

An n8n-based agent for football scouting workflows.

## Workflows

- [**AI Sporting Director**](n8n/README.md) — the canonical, and only, main workflow (`n8n/ai-sporting-director.json`). Every further story extends this workflow in place; no new parallel main workflow is created. Covers the full pipeline: start form → normalize → validate → Teamdiagnose → Spielerprofil → Human Review (Scouting Brief) → Spielersuche → Recherche → Empfehlung → Final Validation → show result or error.
- [**Scouting-Daten importieren**](n8n/import-scouting-data.json) — one-time/manual import of the two complete original CSV datasets into the persistent n8n Data Table `football_scouting_raw`. The import explicitly rejects the former five-club sample data by validating row counts, required columns, and all 18 Bundesliga clubs in the match dataset.
- The four technical analytics subworkflows (`n8n/analytics-*-subworkflow.json`) keep their stable workflow IDs/tool contracts but now read the imported original rows from the Data Table instead of embedding CSV strings in JavaScript. This is the temporary implementation behind the analytics abstraction and can later be replaced by Qlik MCP without redesigning the main workflow.
- `n8n/recherche-subworkflow.json` remains the technical research subworkflow.

The full original CSV files are intentionally not committed to this repository. Upload them once through `Scouting-Daten importieren`; re-importing replaces the corresponding persistent dataset. Details are documented in [`n8n/data/README.md`](n8n/data/README.md).
