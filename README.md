# football-scouting-agent

An n8n-based agent for football scouting workflows.

## Workflows

- [**AI Sporting Director**](n8n/README.md) — the canonical main workflow
  (`n8n/ai-sporting-director.json`). Every further story extends this
  workflow in place; no new parallel main workflow is created. Currently
  covers: start form → normalize → validate → dummy agent answer → check
  output → show result or error.
- [n8n Hello World workflow](n8n/README.md#n8n-hello-world-workflow) —
  minimal workflow that proves the n8n environment is functional. Superseded
  as an entry point, kept as reference.
- [Question & Answer workflow (Ollama)](n8n/README.md#question--answer-workflow-ollama) —
  superseded as an entry point by the AI Sporting Director workflow; its
  Ollama configuration (`[cimt] Ollama` / `Qwen3.8:latest`) remains the basis
  for the future story that replaces the dummy agent answer with the real
  AI agent.
