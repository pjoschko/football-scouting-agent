# football-scouting-agent

An n8n-based agent for football scouting workflows.

## Workflows

- [**AI Sporting Director**](n8n/README.md) — the canonical, and only, main
  workflow (`n8n/ai-sporting-director.json`). Every further story extends
  this workflow in place; no new parallel main workflow is created.
  Covers the full dummy pipeline: start form → normalize → validate →
  Teamdiagnose → Spielerprofil → Spielersuche → Recherche → Empfehlung →
  Final Validation → show result or error, with a schema/minimum-condition
  gate after every stage that routes invalid dummy output to the shared
  error path. Recherche is the one stage implemented as a technical
  subworkflow, [`n8n/recherche-subworkflow.json`](n8n/recherche-subworkflow.json),
  called via an Execute Workflow node — the only exception to "no new main
  workflow" the story allows. It also carries a prepared, not yet connected,
  Ollama configuration (`[cimt] Ollama` / `Qwen3.8:latest`) and a matching
  error-normalization node, both as the basis for the future story that
  replaces the dummy stages with the real AI agent, Qlik and web research
  and its controlled error routing.
