# football-scouting-agent

An n8n-based agent for football scouting workflows.

## Workflows

- [**AI Sporting Director**](n8n/README.md) — the canonical, and only, main
  workflow (`n8n/ai-sporting-director.json`). Every further story extends
  this workflow in place; no new parallel main workflow is created.
  Currently covers: start form → normalize → validate → dummy agent answer →
  check output → show result or error. It also carries a prepared, not yet
  connected, Ollama configuration (`[cimt] Ollama` / `Qwen3.8:latest`) as the
  basis for the future story that replaces the dummy agent answer with the
  real AI agent.
