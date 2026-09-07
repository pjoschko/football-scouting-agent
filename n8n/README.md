# AI Sporting Director (kanonischer Hauptworkflow)

Der kanonische Hauptworkflow für dieses Projekt heißt **`AI Sporting Director`**
und ist versioniert in [`ai-sporting-director.json`](./ai-sporting-director.json).
Jede weitere Story erweitert diesen bestehenden Workflow in-place. Es wird kein
neuer paralleler Hauptworkflow angelegt. Die einzige erlaubte Ausnahme ist die
Recherche-Stufe, die als technischer Subworkflow
[`recherche-subworkflow.json`](./recherche-subworkflow.json) implementiert ist
und über einen **Execute Workflow**-Node aus dem Hauptworkflow aufgerufen wird
(siehe [Recherche-Subworkflow](#recherche-subworkflow) unten).

Dieser Stand erweitert den bisherigen Hauptworkflow (Startformular →
normalisieren → validieren → eine einzelne Dummy-Antwort → Ausgabe prüfen →
Ergebnis/Fehler anzeigen) um alle fachlichen Stufen des Sporting-Director-
Ablaufs, jede mit einem eigenen, klar als Simulation gekennzeichneten
Dummy-Ergebnis und einem eigenen Gate (Schema-/Mindestbedingungsprüfung), das
bei ungültigem Ergebnis den bestehenden zentralen Fehlerpfad (**Fehler
anzeigen**) wiederverwendet. Es gibt noch keinen echten AI Agent, LLM-Schritt,
Qlik-/MCP-Zugriff oder echte Websuche — jede Stufe ist ein deterministischer,
sichtbar als Simulation markierter Dummy.

Credentials werden ausschließlich referenziert (`[cimt] Ollama` am Node
**Ollama Modell (Qwen3.8:latest)**, mit dem Platzhalter-Wert
`REPLACE_WITH_LOCAL_CREDENTIAL_ID` statt einer echten Credential-ID), nie
exportiert oder dupliziert. Ebenso wird die Workflow-ID des Recherche-
Subworkflows nur als Platzhalter `REPLACE_WITH_LOCAL_WORKFLOW_ID` referenziert
(siehe unten) und muss nach dem Import beider Workflows manuell auf die
tatsächliche, instanzspezifische ID gesetzt werden. Es gelangt kein echtes
Secret nach Git.

## Zielablauf

```
Formular → Teamdiagnose → Gate → Spielerprofil → Gate → Spielersuche → Gate
        → Recherche → Gate → Empfehlung → Final Validation → Anzeige
```

Jede Stufe folgt demselben Muster aus dem bisherigen Workflow (**Dummy-Antwort
erzeugen** → **Ausgabe prüfen** → **Ausgabe gültig?**), nur je fachlicher
Stufe wiederholt: `<Stufe> erzeugen`/`durchführen` (Code oder Execute
Workflow) → `<Stufe> prüfen` (Code, setzt `valid`/`errorMessage`) →
`<Stufe> gültig?` (IF) → bei `false` **Fehler anzeigen**, bei `true` weiter
zur nächsten Stufe.

## Nodes

1. **AI Sporting Director beauftragen** (Form Trigger) — unverändert:
   Formular mit `Verein` (Dropdown, `Hamburger SV` vorausgewählt), `Was soll
   der Sporting Director untersuchen?` (Pflichtfeld) und optionalem `Gibt es
   zusätzliche Rahmenbedingungen oder Beobachtungen?`.
2. **Auftrag normalisieren** (Set) — unverändert: normalisiert die
   Formularausgabe zu `club`, `objective`, `additionalContext`, `requestId`,
   `requestedAt`.
3. **Eingabe validieren** (IF) — unverändert: lehnt fehlende oder nur aus
   Leerzeichen bestehende Werte für `club`/`objective` ab.
   - **falsch** → **Validierungsfehler formulieren** (Set, unverändert) →
     **Fehler anzeigen**.
   - **wahr** → weiter zu **Teamdiagnose erzeugen**.
4. **Teamdiagnose erzeugen** (Code) — Dummy mit `evidence`, `hypotheses`,
   `mainProblem` (Hauptproblem) und `uncertainties`, alle klar als Simulation
   markiert (`teamDiagnosis.simulated: true`), ohne eine echte Qlik-Analyse
   oder Websuche zu behaupten.
5. **Teamdiagnose prüfen** (Code) — prüft, dass `evidence`/`hypotheses` nicht
   leere Arrays sind, `mainProblem` ein nichtleerer String ist und
   `uncertainties` ein Array ist; setzt `valid`/`errorMessage`.
6. **Teamdiagnose gültig?** (IF) — **falsch** → **Fehler anzeigen**; **wahr**
   → **Spielerprofil erzeugen**.
7. **Spielerprofil erzeugen** (Code) — Dummy mit `position`, `role`,
   `reasoning` (Begründung, referenziert `teamDiagnosis.mainProblem`),
   `weightedCriteria` (gewichtete Kriterien, je `criterion`/`weight`) und
   `constraints`.
8. **Spielerprofil prüfen** (Code) — prüft alle Pflichtfelder inkl. dass
   jedes `weightedCriteria`-Element ein `criterion` und ein numerisches
   `weight` hat.
9. **Spielerprofil gültig?** (IF) — **falsch** → **Fehler anzeigen**;
   **wahr** → **Spielersuche durchführen**.
10. **Spielersuche durchführen** (Code) — Dummy mit `longlistSize` und einer
    `shortlist` von bis zu fünf Kandidaten, je mit `score`, `strengths`,
    `weaknesses`, `evidence`.
11. **Spielersuche prüfen** (Code) — prüft `longlistSize > 0`, `shortlist`
    nichtleer und **höchstens fünf** Kandidaten, sowie dass jeder Kandidat
    alle Pflichtfelder hat.
12. **Spielersuche gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Recherche durchführen**.
13. **Recherche durchführen** (Execute Workflow) — ruft den technischen
    Subworkflow [`recherche-subworkflow.json`](./recherche-subworkflow.json)
    auf und übergibt das aktuelle Item (inkl. `playerSearch.shortlist`)
    unverändert weiter (`Passthrough`). Der Subworkflow liefert je Kandidat
    aus der Shortlist `club` (Verein), `contract` (Vertrag), `marketValue`
    (Marktwert), `injuries` (Verletzungen) und `news` (Meldungen), jeweils
    mit `source` (Dummy-Quelle), `timestamp` (Zeitpunkt) und `confidence`
    (Konfidenz) — siehe [Recherche-Subworkflow](#recherche-subworkflow).
14. **Recherche prüfen** (Code) — prüft die Kandidatenabdeckung per
    Set-Gleichheit (jeder Shortlist-Name kommt in `research` vor und
    umgekehrt) plus Duplikatprüfung, sodass `research` **genau einen**
    Eintrag je Shortlist-Kandidat enthält (nicht nur dieselbe Anzahl), und
    dass jeder Eintrag alle Pflichtfelder hat.
15. **Recherche gültig?** (IF) — **falsch** → **Fehler anzeigen**; **wahr**
    → **Empfehlung erzeugen**.
16. **Empfehlung erzeugen** (Code) — wählt den Kandidaten mit dem höchsten
    `score` aus `playerSearch.shortlist` als bevorzugten Kandidaten (damit
    stammt er per Konstruktion aus der validierten Shortlist), die übrigen
    Shortlist-Namen werden `alternatives`; dazu `reasoning`, `risks`,
    `uncertainties`, `nextStep`.
17. **Final Validation** (Code) — prüft alle vorherigen Stufenergebnisse
    noch einmal im Zusammenhang (u. a. dass `recommendation.candidate`
    tatsächlich Teil der validierten `playerSearch.shortlist` ist) sowie den
    vollständigen Empfehlungsvertrag: `candidate`, `alternatives` (Array),
    `reasoning`, `risks` (nichtleeres Array), `uncertainties` (nichtleeres
    Array) und `nextStep` — analog zur bisherigen **Ausgabe prüfen**, jetzt
    über den gesamten Ablauf.
18. **Final Validation gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Ergebnisseiten aufbereiten**.
19. **Ergebnisseiten aufbereiten** (Code) — baut `formattedResult`: einen
    Text, der Teamdiagnose, Spielerprofil, Spielersuche, Recherche und
    Empfehlung als klar getrennte Abschnitte darstellt, mit einem
    einleitenden Simulationshinweis.
20. **Ergebnis anzeigen** (Form, Completion) — zeigt `formattedResult` an;
    dieselbe Node wie zuvor, jetzt mit dem mehrteiligen Text statt einer
    einzelnen Diagnose-/Empfehlungszeile.
21. **Fehler anzeigen** (Form, Completion) — unverändert der eine zentrale
    Fehlerpfad für **alle** Gates (Validierung, Teamdiagnose, Spielerprofil,
    Spielersuche, Recherche, Final Validation): zeigt `errorMessage` an; ein
    ungültiges Ergebnis wird nie als fachliche Empfehlung dargestellt.
22. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model) — unverändert,
    weiterhin **ohne Verbindung**: Grundlage für die künftige Story, die
    einen echten AI-Agent-Node einführt.
23. **LLM-Fehler normalisieren** (Code) — unverändert, weiterhin ohne
    eingehende Verbindung, bereits mit **Fehler anzeigen** verbunden für die
    künftige Story.

Die Struktur erlaubt, jede `<Stufe> erzeugen`/`durchführen`-Node später durch
echte Logik (AI Agent, Qlik/MCP, Websuche) zu ersetzen, ohne die
`<Stufe> prüfen`/`<Stufe> gültig?`-Gates, das Formular, die Normalisierung,
die Validierung oder die Ergebnisdarstellung neu bauen zu müssen — die
Datenverträge (`teamDiagnosis`, `playerProfile`, `playerSearch`, `research`,
`recommendation`) bleiben dabei stabil, solange ein Ersatz dieselben Felder
liefert.

## Recherche-Subworkflow

[`recherche-subworkflow.json`](./recherche-subworkflow.json) ist ein
eigenständiger n8n-Workflow mit zwei Nodes:

1. **Wenn von anderem Workflow aufgerufen** (Execute Workflow Trigger,
   `inputSource: passthrough`) — nimmt das vom Hauptworkflow übergebene Item
   unverändert entgegen.
2. **Recherche-Dummy je Kandidat erzeugen** (Code) — liest
   `playerSearch.shortlist` aus dem übergebenen Item und erzeugt je
   Kandidat einen deterministischen Dummy-Rechercheeintrag (`club`,
   `contract`, `marketValue`, `injuries`, `news`, dazu `source` (immer
   `"Dummy-Quelle (keine echte Web-/Qlik-Recherche)"`), `timestamp` und
   `confidence`). Es wird an keiner Stelle eine echte Qlik-Analyse oder
   Websuche behauptet oder simuliert vorgetäuscht — jeder Wert ist
   ausdrücklich als Platzhalter gekennzeichnet.

Import-Reihenfolge: **zuerst** `recherche-subworkflow.json` importieren,
**danach** `ai-sporting-director.json`. Nach dem Import beider Workflows muss
am Node **Recherche durchführen** im Hauptworkflow der Platzhalter
`REPLACE_WITH_LOCAL_WORKFLOW_ID` im Feld **Workflow** durch die tatsächliche,
von der n8n-Instanz vergebene ID des importierten Subworkflows ersetzt werden
(instanzspezifisch, daher kein fester Wert im Repository — analog zur
Credential-ID am Ollama-Node).

## Import & run

1. Open your n8n instance.
2. Import [`recherche-subworkflow.json`](./recherche-subworkflow.json) first
   (**Workflows** → **Add workflow** → **Import from File**).
3. Import [`ai-sporting-director.json`](./ai-sporting-director.json) the
   same way, then open its **Recherche durchführen** node and replace the
   `REPLACE_WITH_LOCAL_WORKFLOW_ID` placeholder with the imported
   subworkflow's actual ID (and, on the **Ollama Modell (Qwen3.8:latest)**
   node, select the local `[cimt] Ollama` credential).
4. Use **Test workflow** to obtain a test-mode form URL for manual testing,
   or activate the workflow (toggle **Active** in the top right) to make the
   form reachable at its production URL shown on the **AI Sporting Director
   beauftragen** node.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/recherche-subworkflow.json
n8n import:workflow --input=n8n/ai-sporting-director.json
```

## End-to-End-Test über das HSV-Formular

### Positiver Testfall (alle Stufen)

1. Open the form's test or production URL in a browser. **Expected result:**
   `Verein` shows `Hamburger SV` preselected, and `Was soll der Sporting
   Director untersuchen?` already contains the example text about the
   Hamburger SV's sporting problems.
2. Click `Analyse starten` without changing anything. **Expected result:**
   the browser shows the **Ergebnis anzeigen** page with five clearly
   separated sections — Teamdiagnose, Spielerprofil, Spielersuche,
   Recherche, Empfehlung — each explicitly marked as a simulation, and the
   recommended candidate is one of the three shortlisted dummy players. In
   the n8n **Executions** list the run is successful and passes all six
   gates (**Teamdiagnose gültig?**, **Spielerprofil gültig?**, **Spielersuche
   gültig?**, **Recherche gültig?**, **Final Validation gültig?**, plus
   **Eingabe validieren**).
   **Ausgeführt (Logiksimulation):** Alle `Code`-Nodes des Hauptworkflows und
   des Subworkflows wurden außerhalb von n8n mit Node.js gegen die
   HSV-Beispieldaten (`club: "Hamburger SV"`, das voreingestellte
   `objective`) ausgeführt, inklusive des Aufrufs des Recherche-Subworkflows
   mit dem vom Hauptworkflow durchgereichten Item. Ergebnis: alle fünf Gates
   melden `valid: true`, `formattedResult` enthält alle fünf Abschnitte, und
   `recommendation.candidate` (`Dummy-Spieler A`, höchster `score`) ist
   Teil von `playerSearch.shortlist`. Nicht ausgeführt: das eigentliche
   Rendern der Formular-/Completion-Seiten und der n8n-**Executions**-Eintrag
   selbst, da dafür eine laufende n8n-Weboberfläche nötig ist — offen für die
   nächste Person (oder Session) mit interaktivem Zugriff auf eine
   importierte Instanz.

### Negative Testfälle (ein Gate pro Stufe)

Für jedes der folgenden Gates gilt dasselbe Muster: in einer Testkopie des
Workflows wird die vorausgehende `erzeugen`/`durchführen`-Node so verändert,
dass ein Pflichtfeld fehlt oder eine Mindestbedingung verletzt ist, danach
wird der positive Testfall erneut ausgeführt.

1. **Teamdiagnose gültig?** — `teamDiagnosis.mainProblem` entfernen.
   **Erwartet:** **Teamdiagnose prüfen** setzt `valid: false`, die Anzeige
   zeigt die Fehlermeldung "Die Teamdiagnose ist ungültig …" statt einer
   Diagnose.
2. **Spielerprofil gültig?** — `playerProfile.reasoning` entfernen.
   **Erwartet:** Fehlermeldung "Das Spielerprofil ist ungültig …".
3. **Spielersuche gültig?** — `playerSearch.shortlist` auf ein leeres Array
   setzen. **Erwartet:** Fehlermeldung "Die Spielersuche ist ungültig …".
4. **Recherche gültig?** — im Recherche-Subworkflow `research` auf ein
   leeres Array setzen (bzw. die Longlist/Shortlist so verändern, dass keine
   Recherche-Einträge entstehen). **Erwartet:** Fehlermeldung "Die Recherche
   ist ungültig …".
5. **Final Validation gültig?** — in **Empfehlung erzeugen**
   `recommendation.candidate` auf einen Namen setzen, der nicht Teil der
   Shortlist ist. **Erwartet:** Fehlermeldung "Die finale Validierung ist
   fehlgeschlagen …" (fängt damit auch einen Fehler ab, der die einzelnen
   Stufen-Gates unbeschädigt durchlaufen hat).
6. **Recherche gültig?** (Kandidatenabdeckung) — im Recherche-Subworkflow
   den `research`-Eintrag des letzten Shortlist-Kandidaten durch ein Duplikat
   des ersten Kandidaten ersetzen, sodass `research` weiterhin genauso viele
   Einträge wie die Shortlist hat, aber ein Kandidat doppelt und ein anderer
   gar nicht recherchiert wurde. **Erwartet:** **Recherche prüfen** erkennt
   sowohl das Duplikat als auch den fehlenden Kandidaten und setzt
   `valid: false` mit Fehlermeldung "Die Recherche ist ungültig …" (deckt
   damit ab, dass gleiche Länge/erlaubte Namen allein keine 1:1-Abdeckung
   der Shortlist beweisen).
7. **Final Validation gültig?** (vollständiger Empfehlungsvertrag) — in
   **Empfehlung erzeugen** einzeln `alternatives`, `risks` bzw.
   `uncertainties` aus der Empfehlung entfernen oder auf ein leeres Array
   setzen. **Erwartet:** **Final Validation** setzt in jedem der drei Fälle
   `valid: false` mit einer feldspezifischen Fehlermeldung ("Die finale
   Validierung ist fehlgeschlagen …"); keiner der Fälle erreicht
   **Ergebnis anzeigen**.

**Ausgeführt (Logiksimulation):** Alle sieben Fälle wurden wie oben
beschrieben mit Node.js gegen die HSV-Beispieldaten durchgespielt (jeweils
ein einzelnes Feld/Array gezielt entfernt, geleert oder dupliziert, alle
anderen Stufen unverändert gelassen). In jedem Fall meldete genau das
erwartete Gate `valid: false` mit der oben genannten Fehlermeldung, alle
nachfolgenden Stufen wurden nicht mehr ausgeführt, und keiner der Fälle
erreichte **Ergebnis anzeigen**. Nicht ausgeführt: das manuelle Editieren der
Nodes und Beobachten der **Executions**-Liste in einer laufenden
n8n-Instanz — offen für die nächste Person (oder Session) mit interaktivem
Zugriff.

### Negativer Testfall (Validierung des Startformulars)

Unverändert gegenüber dem bisherigen Workflow: leeres/nur aus Leerzeichen
bestehendes `objective` per direktem HTTP-Request (z. B. `curl`) einreichen.
**Erwartet:** **Eingabe validieren** routet zu **Validierungsfehler
formulieren** → **Fehler anzeigen** mit der Meldung, `Verein` und die
Zielsetzung auszufüllen — keine Dummy-Diagnose oder -Empfehlung wird
angezeigt.

### Regressionstest: Hauptworkflow funktioniert allein (Importtest)

Der Hauptworkflow bleibt die einzige n8n-Workflow-Datei, die die HSV-Formular-
Story trägt; einzige neue Datei ist der technische Recherche-Subworkflow.
Beim Import (`n8n import:workflow --input=n8n/ai-sporting-director.json`,
gefolgt von `n8n/recherche-subworkflow.json`, oder in umgekehrter Reihenfolge
wie oben empfohlen) öffnet sich der Hauptworkflow mit allen 24 hier
beschriebenen Nodes, inklusive der weiterhin unverbundenen **Ollama Modell
(Qwen3.8:latest)**- und **LLM-Fehler normalisieren**-Nodes; der
Subworkflow öffnet sich mit seinen zwei Nodes.
`n8n/ai-sporting-director.json` und `n8n/recherche-subworkflow.json` wurden
außerhalb von n8n als wohlgeformtes JSON mit eindeutigen Node-Namen/-IDs,
Connections, die ausschließlich existierende Nodes referenzieren, jeweils
genau einem erwarteten Trigger-Node (Form Trigger bzw. Execute Workflow
Trigger) und ohne Klartext-Credential- oder -Workflow-ID (außer den beiden
dokumentierten Platzhaltern) geprüft.
**Nicht ausgeführt:** der tatsächliche Import in eine laufende n8n-Instanz —
offen für die nächste Person (oder Session) mit interaktivem Zugriff.

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
   `{ "error": "Verbindung zu Ollama fehlgeschlagen (Testfall)" }` — the real
   shape n8n 2.35.7's **Basic LLM Chain** produces on its error output when
   `onError: continueErrorOutput` is set (`json: { error: error.message }`,
   i.e. `$json.error` is a **string**, not an object).
   **Expected result:** the node's output contains `errorMessage` with the
   text "Bei der Kommunikation mit dem lokalen Ollama-Modell ist ein Fehler
   aufgetreten. Bitte versuchen Sie es später erneut.\n\nDetails:
   Verbindung zu Ollama fehlgeschlagen (Testfall)", i.e. the same message
   shape the Frage-Antwort-Altworkflow used to show on its error-display
   node.
3. Repeat step 2 with the input item
   `{ "error": { "message": "Verbindung zu Ollama fehlgeschlagen (Testfall)" } }`
   (object shape, in case a future node ever produces it instead of a
   string).
   **Expected result:** the same `errorMessage` text as in step 2 — the node
   still extracts the message correctly.
4. Repeat step 2 with an input item that has no `error` field.
   **Expected result:** `errorMessage` falls back to "... Details:
   Unbekannter Fehler" instead of throwing.

## Migration der Altworkflows

Die beiden früheren Altworkflow-Dateien in diesem Verzeichnis (ein
Hello-World-Workflow und ein Frage-Antwort-Workflow) wurden gegen die obige
Analyse geprüft und aus dem Repository entfernt, bevor die Dummy-Pipeline
dieser Story hinzukam:

- **Der Hello-World-Altworkflow** enthielt nur einen Manual Trigger und ein
  statisches `Hello World`-Feld. Keine seiner Fähigkeiten wurde benötigt;
  die Datei wurde ersatzlos gelöscht.
- **Der Frage-Antwort-Altworkflow** enthielt ein generisches
  Frage/Antwort-Formular mit einer echten Ollama-Anbindung. Das Formular und
  die einfache LLM-Chain sind durch den Hauptworkflow abgelöst und wurden
  nicht übernommen. Die Ollama-Konfiguration selbst (Modell
  `Qwen3.8:latest`, aktiviertes Thinking, Credential-Referenz `[cimt]
  Ollama` ohne echte ID oder Secret) wurde 1:1 als der oben beschriebene
  Node **Ollama Modell (Qwen3.8:latest)** in `ai-sporting-director.json`
  übernommen. Das kontrollierte Fehler-Routing dieses Altworkflows
  (`onError: continueErrorOutput` am Chain-Node, verständliche Fehleranzeige
  aus dem Fehler-Output) wurde ebenfalls übernommen, als der oben
  beschriebene Node **LLM-Fehler normalisieren**, der bereits an den
  zentralen Fehlerpfad **Fehler anzeigen** angeschlossen ist.

`ai-sporting-director.json` ist damit weiterhin der einzige Hauptworkflow in
diesem Repository; `recherche-subworkflow.json` ist die einzige erlaubte
Ausnahme davon, als technischer, nicht-fachlicher Subworkflow.
