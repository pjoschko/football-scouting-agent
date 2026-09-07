# AI Sporting Director (kanonischer Hauptworkflow)

Der kanonische Hauptworkflow für dieses Projekt heißt **`AI Sporting Director`**
und ist versioniert in [`ai-sporting-director.json`](./ai-sporting-director.json).
Jede weitere Story erweitert diesen bestehenden Workflow in-place. Es wird kein
neuer paralleler Hauptworkflow angelegt, außer eine Story verlangt ausdrücklich
einen technischen Subworkflow.

Der Workflow entstand durch Konsolidierung der bisher separat entwickelten
n8n-Workflows dieses Repositories:

- Das Startformular (Verein/Objective/Kontext) stammt aus Story 33
  ([`ai-sporting-director-start-form.json`](#abgel%C3%B6ste-workflows), jetzt Teil
  des Hauptworkflows).
- Normalisierung, Validierung, die Dummy-Agentenantwort und die
  Ergebnis-/Fehleranzeige setzen die noch offene Story 34 direkt im
  Hauptworkflow um (bisher gab es dafür keinen eigenen Workflow).
- Die Ollama-Konfiguration aus Story 32
  ([`question-answer-workflow.json`](#abgel%C3%B6ste-workflows)) bleibt
  wiederverwendbar für die spätere Story, in der der Dummy durch den echten
  AI Agent ersetzt wird — sie ersetzt den Dummy in diesem Workflow noch nicht.

Credentials werden ausschließlich referenziert (`[cimt] Ollama` in der
abgelösten Q&A-Workflow-Datei), nie exportiert oder dupliziert.

## Zielablauf

```
Startformular → normalisieren → validieren → Dummy-Antwort → Ausgabe prüfen → Ergebnis oder Fehler anzeigen
```

## Nodes

1. **AI Sporting Director beauftragen** (Form Trigger) — unverändert aus
   Story 33: Formular mit `Verein` (Dropdown, `Hamburger SV` vorausgewählt),
   `Was soll der Sporting Director untersuchen?` (Pflichtfeld) und optionalem
   `Gibt es zusätzliche Rahmenbedingungen oder Beobachtungen?`.
2. **Auftrag normalisieren** (Set) — normalisiert die Formularausgabe zu
   `club`, `objective`, `additionalContext` (jeweils getrimmt) sowie neu
   `requestId` und `requestedAt` (ISO-Zeitstempel).
3. **Eingabe validieren** (IF) — lehnt fehlende oder nur aus Leerzeichen
   bestehende Werte für `club`/`objective` ab.
   - **falsch** → **Validierungsfehler formulieren** (Set) setzt eine
     verständliche `errorMessage` → **Fehler anzeigen**.
   - **wahr** → weiter zu **Dummy-Antwort erzeugen**.
4. **Dummy-Antwort erzeugen** (Code) — deterministischer, klar als Simulation
   gekennzeichneter Dummy (`agentResponse.simulated: true`), der bereits dem
   späteren Agentenvertrag entspricht: `diagnosis` (summary, evidence,
   hypotheses, uncertainties), `requiredProfile` (position, role, criteria),
   `shortlist`, `recommendation` (candidate, reasoning, risks, nextStep). Der
   Dummy behauptet an keiner Stelle, eine echte Qlik-Analyse oder Websuche
   durchgeführt zu haben.
5. **Ausgabe prüfen** (Code) — prüft die Pflichtstruktur der Agentenantwort
   und setzt `valid` sowie ggf. `errorMessage`.
6. **Ausgabe gültig?** (IF)
   - **wahr** → **Ergebnis anzeigen** (Form, Completion) zeigt Verein,
     Auftrag, den simulierten Diagnose-Text und die Empfehlung inkl.
     Hinweis, dass es sich um eine Simulation handelt.
   - **falsch** → **Fehler anzeigen** (Form, Completion) — derselbe Node wie
     im Validierungsfehlerpfad — zeigt die `errorMessage` an; ein ungültiges
     Ergebnis wird nie als fachliche Empfehlung dargestellt.

Die Struktur erlaubt, `Dummy-Antwort erzeugen` später durch den echten AI
Agent (z. B. unter Wiederverwendung von `[cimt] Ollama` / `Qwen3.8:latest`)
zu ersetzen, ohne Formular, Normalisierung, Validierung, Ausgabe-Prüfung oder
Ergebnisdarstellung neu bauen zu müssen.

## Import & run

1. Open your n8n instance.
2. Go to **Workflows** → **Add workflow** → **Import from File** (or use the
   "⋮" menu → **Import from File** on an existing workflow).
3. Select [`ai-sporting-director.json`](./ai-sporting-director.json) from
   this directory.
4. Use **Test workflow** to obtain a test-mode form URL for manual testing,
   or activate the workflow (toggle **Active** in the top right) to make the
   form reachable at its production URL shown on the **AI Sporting Director
   beauftragen** node.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/ai-sporting-director.json
```

## End-to-End-Test über das HSV-Formular

### Positiver Testfall

1. Open the form's test or production URL in a browser.
   **Expected result:** `Verein` shows `Hamburger SV` preselected, and
   `Was soll der Sporting Director untersuchen?` already contains the
   example text about the Hamburger SV's sporting problems.
2. Click `Analyse starten` without changing anything (optionally fill in
   `Gibt es zusätzliche Rahmenbedingungen oder Beobachtungen?`).
   **Expected result:** the browser shows the **Ergebnis anzeigen** page
   with the club, the objective, an explicit note that the answer is a
   simulation, a diagnosis summary and a recommended dummy candidate with
   reasoning and next step. In the n8n **Executions** list the run is
   successful; **Auftrag normalisieren** shows `club`, `objective`,
   `additionalContext`, `requestId` and `requestedAt`; **Ausgabe prüfen**
   shows `valid: true`.

### Negativer Testfall (Validierung)

1. Open the form again and clear `Was soll der Sporting Director
   untersuchen?` (or fill it with only spaces), then click
   `Analyse starten`.
   **Expected result:** the n8n form itself blocks empty required fields;
   to also exercise the workflow's own validation node, submit the form via
   a direct HTTP request that bypasses the browser's required-field check
   (e.g. with `curl`), or temporarily remove `requiredField` in a test copy.
   **Expected result in that case:** **Eingabe validieren** routes to
   **Validierungsfehler formulieren** and the browser/response shows the
   **Fehler anzeigen** page with a message asking to fill in `Verein` and
   the objective — no dummy diagnosis or recommendation is shown.

### Negativer Testfall (Ausgabeprüfung)

1. In a test copy of the workflow, temporarily edit **Dummy-Antwort
   erzeugen** so the returned `agentResponse` is missing a required field
   (e.g. remove `recommendation.nextStep`), then run the positive test case
   again.
   **Expected result:** **Ausgabe prüfen** sets `valid: false`, **Ausgabe
   gültig?** routes to **Fehler anzeigen**, and the browser shows the error
   page listing the missing field instead of an incomplete recommendation.

## Abgelöste Workflows

Diese Workflows wurden bereits verglichen und sind durch den Hauptworkflow
`AI Sporting Director` als Einstiegspunkt abgelöst. Sie werden **nicht**
gelöscht, da ihre Konfiguration noch benötigt bzw. als Referenz sinnvoll ist:

- **`hello-world-workflow.json`** — minimaler Nachweis, dass die n8n-Umgebung
  grundsätzlich funktioniert (Story ~1). Für die weitere Entwicklung nicht
  mehr erforderlich, bleibt als Referenz erhalten.
- **`question-answer-workflow.json`** — generisches Frage/Antwort-Formular
  mit echter Ollama-Anbindung (Story 32). Als fachlicher Einstiegspunkt durch
  `AI Sporting Director beauftragen` abgelöst. Die darin enthaltene
  Ollama-Konfiguration (`Ollama Modell (Qwen3.8:latest)`-Node mit dem
  referenzierten Credential `[cimt] Ollama`) bleibt die Grundlage für die
  spätere Story, die **Dummy-Antwort erzeugen** im Hauptworkflow durch den
  echten AI Agent ersetzt.

---

# n8n Hello World Workflow

A minimal n8n workflow that proves the n8n environment for this project is
working end to end.

## What it does

1. **When clicking 'Execute workflow'** (Manual Trigger) — starts the
   workflow when you click "Execute workflow" in the n8n editor.
2. **Set Hello World** (Set node) — sets an output field `message` to the
   text `Hello World`.

The workflow contains no credentials or secrets, so it can be imported and
run in any n8n instance without further configuration.

## Import & run

1. Open your n8n instance.
2. Go to **Workflows** → **Add workflow** → **Import from File** (or use the
   "⋮" menu → **Import from File** on an existing workflow).
3. Select [`hello-world-workflow.json`](./hello-world-workflow.json) from
   this directory.
4. Open the imported workflow and click **Execute workflow**.
5. Open the **Set Hello World** node's output panel — the `message` field
   contains the text `Hello World`, confirming the workflow ran
   successfully.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/hello-world-workflow.json
```

# Question & Answer workflow (Ollama)

> **Status:** abgelöst als fachlicher Einstiegspunkt durch den Hauptworkflow
> `AI Sporting Director` (siehe oben). Die Ollama-Konfiguration in dieser
> Datei bleibt als Referenz für die spätere Agentenstory erhalten.

A workflow that provides a browser-accessible form where a user can enter a
freely formulated question and immediately receive an answer generated by
the local Ollama model, as the first building block for the later
interaction with the scouting agent. The question is not restricted to the
football scouting use case.

## What it does

1. **Frage stellen** (Form Trigger) — publishes a form with a required,
   multi-line field labelled `Frage`. Because the field is required, the
   form cannot be submitted (and no model request is made) while it is
   empty.
2. **Antwort von Ollama generieren** (Basic LLM Chain) — sends the
   submitted question as the prompt to the connected language model and
   waits for the generated answer. On failure (e.g. Ollama not reachable,
   model not found) it routes to its error output instead of producing a
   misleading answer.
3. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model) — the language
   model used by the chain above. It is configured for the model
   `Qwen3.8:latest` with thinking enabled, and uses the existing n8n
   credential `[cimt] Ollama`.
4. **Antwort anzeigen** (Form / completion) — shown on success; displays the
   generated answer to the user in the browser.
5. **Fehler anzeigen** (Form / completion) — shown when the Ollama request
   fails; displays an understandable error message instead of a model
   answer.

The exported JSON contains no credentials or secrets — only a reference to
the existing credential name `[cimt] Ollama`. Connection details are neither
duplicated nor hard-coded.

## Import & run

1. Open your n8n instance.
2. Go to **Workflows** → **Add workflow** → **Import from File** (or use the
   "⋮" menu → **Import from File** on an existing workflow).
3. Select [`question-answer-workflow.json`](./question-answer-workflow.json)
   from this directory.
4. Open the **Ollama Modell (Qwen3.8:latest)** node and, under
   **Credential to connect with**, select the existing `[cimt] Ollama`
   credential (the import cannot resolve the credential automatically
   because credential IDs are instance-specific).
5. Confirm the model field is set to `Qwen3.8:latest` and that **Options →
   Think** (thinking mode) is enabled; adjust the option name/label if your
   n8n version exposes it differently.
6. Activate the workflow (toggle **Active** in the top right) so the form is
   reachable at its production URL, or use **Test workflow** to obtain a
   test URL for manual testing.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/question-answer-workflow.json
```

## Manual test case

1. Activate the workflow and open the form's URL in a browser (via **Test
   workflow** for a test run, or the production URL once activated).
2. Enter a simple question into the **Frage** field, e.g. `Was ist die
   Hauptstadt von Frankreich?`.
3. Submit the form.
4. **Expected result:** after a short processing time the browser shows an
   answer page with a text generated by the local model that answers the
   question (e.g. mentioning "Paris"). In the n8n **Executions** list the
   run is successful, and the **Ollama Modell (Qwen3.8:latest)** node shows
   the generated text in its output.
5. To verify the error path, temporarily stop the local Ollama service (or
   point the credential at an unreachable URL) and submit a question again.
   **Expected result:** the browser shows the friendly error page from
   **Fehler anzeigen** instead of a fabricated answer.
