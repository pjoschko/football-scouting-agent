# AI Sporting Director (kanonischer Hauptworkflow)

Der kanonische Hauptworkflow für dieses Projekt heißt **`AI Sporting Director`**
und ist versioniert in [`ai-sporting-director.json`](./ai-sporting-director.json).
Jede weitere Story erweitert diesen bestehenden Workflow in-place. Es wird kein
neuer paralleler Hauptworkflow angelegt, außer eine Story verlangt ausdrücklich
einen technischen Subworkflow.

Der Workflow entstand durch Konsolidierung der bisher separat entwickelten
n8n-Workflows dieses Repositories. Die früheren Dateien
`hello-world-workflow.json` und `question-answer-workflow.json` sind
vollständig gegen den Hauptworkflow geprüft und aufgelöst worden und wurden
danach aus dem Repository entfernt (siehe [Migration der
Altworkflows](#migration-der-altworkflows) unten); `ai-sporting-director.json`
ist jetzt die einzige n8n-Workflow-Datei in diesem Repository:

- Das Startformular (Verein/Objective/Kontext) stammt aus Story 33, jetzt Teil
  des Hauptworkflows.
- Normalisierung, Validierung, die Dummy-Agentenantwort und die
  Ergebnis-/Fehleranzeige setzen die noch offene Story 34 direkt im
  Hauptworkflow um (bisher gab es dafür keinen eigenen Workflow).
- Die Ollama-Konfiguration aus Story 32 (vormals
  `question-answer-workflow.json`) ist als eigener, noch nicht verbundener
  Node **Ollama Modell (Qwen3.8:latest)** in den Hauptworkflow übernommen.
  Sie bleibt die Grundlage für die spätere Story, in der der Dummy durch den
  echten AI Agent ersetzt wird — sie ersetzt den Dummy in diesem Workflow
  noch nicht.

Credentials werden ausschließlich referenziert (`[cimt] Ollama` am Node
**Ollama Modell (Qwen3.8:latest)**, mit dem Platzhalter-Wert
`REPLACE_WITH_LOCAL_CREDENTIAL_ID` statt einer echten Credential-ID), nie
exportiert oder dupliziert. Es gelangt kein echtes Secret nach Git.

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
7. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model, aus
   `question-answer-workflow.json` übernommen) — liegt vorbereitet, aber
   bewusst noch **ohne Verbindung** im Workflow: Modell `Qwen3.8:latest`,
   Option **Think** aktiviert, Credential-Referenz `[cimt] Ollama` (nur der
   Name wird referenziert; die Credential-ID ist der unveränderte Platzhalter
   `REPLACE_WITH_LOCAL_CREDENTIAL_ID`, keine echte ID oder ein Secret). Der
   Node dokumentiert seinen Zweck über eine Notiz direkt am Node.
8. **LLM-Fehler normalisieren** (Code) — bereits jetzt im Hauptworkflow
   vorhanden und mit **Fehler anzeigen** verbunden, damit der zentrale
   Fehlerpfad die Fehlerbehandlung aus `question-answer-workflow.json` ohne
   weitere Implementierung übernehmen kann: der Node liest `error.message`
   (das Format, das ein Chain-/Agent-Node bei `onError:
   continueErrorOutput` liefert, wie zuvor **Antwort von Ollama
   generieren**) und schreibt daraus dieselbe verständliche
   Ollama-Fehlermeldung wie zuvor in `question-answer-workflow.json` in
   `errorMessage`. Er hat noch **keine eingehende Verbindung**, da der
   Chain-/Agent-Node, dessen Fehler-Output ihn speist, erst in der
   künftigen Story hinzukommt, die den Dummy ersetzt.

Die Struktur erlaubt, `Dummy-Antwort erzeugen` später durch den echten AI
Agent zu ersetzen, ohne Formular, Normalisierung, Validierung,
Ausgabe-Prüfung, Ergebnisdarstellung oder Fehler-Routing neu bauen zu
müssen:

- Ein künftiger Chain-/Agent-Node verbindet sich mit **Ollama Modell
  (Qwen3.8:latest)** als Sprachmodell (`ai_languageModel`-Input), genau wie
  zuvor in `question-answer-workflow.json`.
- Für kontrolliertes Fehler-Routing aktiviert dieser künftige Node
  `onError: continueErrorOutput` (wie zuvor **Antwort von Ollama
  generieren**) und verbindet seinen Fehler-Output (zweiter `main`-Output)
  mit dem bereits vorhandenen Node **LLM-Fehler normalisieren**. Dieser
  schreibt die verständliche Fehlermeldung in `errorMessage` und leitet sie
  an denselben zentralen Fehlerpfad weiter, der bereits für Validierungs-
  und Ausgabefehler existiert: **Fehler anzeigen** zeigt jede
  `errorMessage` unabhängig von ihrer Ursache verständlich an, ohne dass ein
  eigener Ollama-spezifischer Fehler-Node nötig ist.

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

### Regressionstest: Hauptworkflow funktioniert allein (Importtest)

1. In a clean n8n instance (or after removing every other workflow),
   import only [`ai-sporting-director.json`](./ai-sporting-director.json) —
   `n8n/hello-world-workflow.json` and `n8n/question-answer-workflow.json` no
   longer exist in this repository, so there is nothing left to import
   alongside it.
   **Expected result:** the import succeeds without asking to resolve any
   other workflow or file; the workflow opens with all 11 nodes described
   above, including the unconnected **Ollama Modell (Qwen3.8:latest)** and
   **LLM-Fehler normalisieren** nodes.
   **Executed:** run via the n8n CLI (`n8n import:workflow
   --input=n8n/ai-sporting-director.json`, n8n 2.35.7) against a fresh
   SQLite-backed n8n instance. The command reported "Successfully imported
   1 workflow." and a direct query of the resulting `workflow_entity` row
   confirms exactly 11 nodes with the names listed above — including
   **Ollama Modell (Qwen3.8:latest)** and **LLM-Fehler normalisieren**.
   Because the workflow file previously had no top-level `id`, this CLI
   version rejected the import with `SQLITE_CONSTRAINT: NOT NULL constraint
   failed: workflow_entity.id`; a stable `id` was added to
   `ai-sporting-director.json` to fix this (this affected the file on
   `main` before this change too — it was not specific to the nodes added
   here), after which the import above succeeded.
2. Repeat the positive test case and both negative test cases above against
   this single imported workflow.
   **Expected result:** all three behave exactly as described — the HSV
   start form remains the only functional entry point, and the dummy,
   validation and error paths are all unaffected by the added Ollama and
   error-normalization nodes.
   **Not executed:** these three require submitting the form and reading
   the **Executions** list of a running n8n web UI, which the CLI import
   above does not exercise; still open for the next person (or session)
   with interactive access to the imported instance.
3. Outside of n8n itself, `n8n/ai-sporting-director.json` was additionally
   checked to be well-formed JSON with unique node names/ids, connections
   that only reference existing nodes, exactly one form trigger, and no
   credential value other than the `REPLACE_WITH_LOCAL_CREDENTIAL_ID`
   placeholder.

### Regressionstest: vorbereiteter Ollama-Node

1. Open the imported main workflow and select the **Ollama Modell
   (Qwen3.8:latest)** node.
   **Expected result:** the model field shows `Qwen3.8:latest`, **Options →
   Think** is enabled, and **Credential to connect with** references
   `[cimt] Ollama` (select the existing local credential here — the import
   cannot resolve the instance-specific credential ID automatically).
2. **Expected result:** the node has no incoming or outgoing connections yet
   — it does not run as part of any execution of the main workflow, so the
   positive and negative test cases above are unaffected by its presence.

### Regressionstest: vorbereitete Fehler-Normalisierung

1. Open the imported main workflow and select the **LLM-Fehler
   normalisieren** node.
   **Expected result:** the node is a Code node connected to **Fehler
   anzeigen** as its only output, and has no incoming connection yet — it
   does not run as part of any execution of the main workflow, so the
   positive and negative test cases above are unaffected by its presence.
2. Open a test copy of the workflow, temporarily wire a manual trigger into
   **LLM-Fehler normalisieren** and run it once with the input item
   `{ "error": { "message": "Verbindung zu Ollama fehlgeschlagen (Testfall)" } }`.
   **Expected result:** the node's output contains `errorMessage` with the
   text "Bei der Kommunikation mit dem lokalen Ollama-Modell ist ein Fehler
   aufgetreten. Bitte versuchen Sie es später erneut.\n\nDetails:
   Verbindung zu Ollama fehlgeschlagen (Testfall)", i.e. the same message
   shape `question-answer-workflow.json` used to show on its **Fehler
   anzeigen** node.
3. Repeat step 2 with an input item that has no `error` field.
   **Expected result:** `errorMessage` falls back to "... Details:
   Unbekannter Fehler" instead of throwing.

## Migration der Altworkflows

`n8n/hello-world-workflow.json` und `n8n/question-answer-workflow.json`
wurden gegen die obige Analyse geprüft und danach aus dem Repository
entfernt:

- **`hello-world-workflow.json`** enthielt nur einen Manual Trigger und ein
  statisches `Hello World`-Feld. Keine seiner Fähigkeiten wurde benötigt;
  die Datei wurde ersatzlos gelöscht.
- **`question-answer-workflow.json`** enthielt ein generisches
  Frage/Antwort-Formular mit einer echten Ollama-Anbindung. Das Formular und
  die einfache LLM-Chain sind durch den Hauptworkflow abgelöst und wurden
  nicht übernommen. Die Ollama-Konfiguration selbst (Modell
  `Qwen3.8:latest`, aktiviertes Thinking, Credential-Referenz `[cimt]
  Ollama` ohne echte ID oder Secret) wurde 1:1 als der oben beschriebene
  Node **Ollama Modell (Qwen3.8:latest)** in `ai-sporting-director.json`
  übernommen, bevor die Datei gelöscht wurde. Das kontrollierte
  Fehler-Routing dieses Altworkflows (`onError: continueErrorOutput` am
  Chain-Node, verständliche Fehleranzeige aus `error.message`) wurde
  ebenfalls übernommen, als der oben beschriebene Node **LLM-Fehler
  normalisieren**, der bereits an den zentralen Fehlerpfad **Fehler
  anzeigen** angeschlossen ist und nur noch auf den Fehler-Output des
  künftigen Chain-/Agent-Nodes wartet.

`ai-sporting-director.json` ist damit die einzige n8n-Workflow-Datei in
diesem Repository.
