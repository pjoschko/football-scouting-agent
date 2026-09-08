# AI Sporting Director (kanonischer Hauptworkflow)

Der kanonische Hauptworkflow für dieses Projekt heißt **`AI Sporting Director`**
und ist versioniert in [`ai-sporting-director.json`](./ai-sporting-director.json).
Jede weitere Story erweitert diesen bestehenden Workflow in-place. Es wird kein
neuer paralleler Hauptworkflow angelegt. Die einzige erlaubte Ausnahme sind
rein technische, nicht-fachliche Subworkflows, die über einen **Execute
Workflow**-Node aus dem Hauptworkflow aufgerufen werden: die Recherche-Stufe
([`recherche-subworkflow.json`](./recherche-subworkflow.json), siehe
[Recherche-Subworkflow](#recherche-subworkflow) unten) sowie die vier
CSV-Analytics-Tools des [CSV-Analytics-Adapters](#csv-analytics-adapter)
(`analytics-*-subworkflow.json`).

Dieser Stand erweitert den bisherigen Hauptworkflow (Startformular →
normalisieren → validieren → eine einzelne Dummy-Antwort → Ausgabe prüfen →
Ergebnis/Fehler anzeigen) um alle fachlichen Stufen des Sporting-Director-
Ablaufs, jede mit einem eigenen Gate (Schema-/Mindestbedingungsprüfung), das
bei ungültigem Ergebnis den bestehenden zentralen Fehlerpfad (**Fehler
anzeigen**) wiederverwendet. **Teamdiagnose** und **Spielerprofil** werden
inzwischen nicht mehr deterministisch/simuliert erzeugt, sondern von einem
echten lokalen LLM (**Ollama Modell (Qwen3.8:latest)**, angesprochen über je
eine **Basic LLM Chain** mit **Structured Output Parser**) interpretiert:
**Teamdiagnose** greift dafür über den
[CSV-Analytics-Adapter](#csv-analytics-adapter) auf echte, versionierte
Referenzdaten zu (temporärer Ersatz für die künftige Qlik-/MCP-Anbindung,
noch keine echte Websuche) und lässt deren Kennzahlen vom LLM fachlich
interpretieren (Hypothesen, Ligavergleich, Hauptproblem, Gegenhypothesen,
Unsicherheiten), ohne die Kennzahlen selbst zu erfinden; **Spielerprofil**
leitet aus dieser LLM-Teamdiagnose ein strukturiertes Anforderungsprofil ab.
**Spielersuche** greift ebenfalls über den CSV-Analytics-Adapter auf echte
Daten zu (weiterhin deterministisch ausgewertet, siehe unten). Nur
**Recherche** bleibt ein deterministischer, sichtbar als Simulation
gekennzeichneter Dummy, da hierfür noch keine reale Implementierung möglich
ist. Zwischen **Spielerprofil** und **Spielersuche** steht jetzt ein echtes
**Human-Review-Gate** (siehe [Scouting Brief Human-Review](#scouting-brief-human-review)
unten): der bisherige Dummy-Gate an dieser Stelle (automatische Weiterleitung
ohne menschliche Beteiligung) ist durch eine echte Formular-Vorlage des
strukturierten **Scouting Briefs** ersetzt, die ein Mensch **Approve**,
**Request Changes** (mit Freitext-Feedback, das über **Spielerprofil LLM** in
eine Überarbeitung einfließt) oder **Reject** entscheiden kann; nur **Approve**
setzt den bestehenden Hauptworkflow fort.

Credentials werden ausschließlich referenziert (`[cimt] Ollama` am Node
**Ollama Modell (Qwen3.8:latest)**, mit dem Platzhalter-Wert
`REPLACE_WITH_LOCAL_CREDENTIAL_ID` statt einer echten Credential-ID), nie
exportiert oder dupliziert. Der Recherche-Subworkflow wird dagegen über seine
feste Top-Level-ID `802fdb6b-4c0a-413f-952d-250c91ddc476` referenziert (siehe
unten); n8n übernimmt diese ID beim Import unverändert, sodass keine manuelle
Anpassung nötig ist. Es gelangt kein echtes Secret nach Git.

## Zielablauf

```
Formular → [Team-Performance, Team-Matches]
        → Datenverfuegbarkeit? --nein--> Teamdiagnose (keine Daten) --+
                 |ja                                                  |
                 v                                                    |
        Teamdiagnose-Evidenz aufbereiten → Teamdiagnose-LLM (Ollama)  |
                 → Teamdiagnose zusammenfuehren -----------------------+
        → Teamdiagnose pruefen → Gate
        → Teamdiagnose: Datengrundlage ausreichend? --nein--> Fehler anzeigen
                 |ja
                 v
        → Spielerprofil-Positionspool ermitteln → Spielerprofil-LLM (Ollama) <---------+
        → Spielerprofil zusammenfuehren → Spielerprofil pruefen → Gate                 |
        → Scouting Brief erstellen → Scouting Brief pruefen → Gate                     |
        → Scouting Brief zur Freigabe vorlegen (Human Review: Form)                    |
        → Review-Entscheidung auswerten → Gate                                         |
        → Approve? --nein--> Request Changes? --ja--> (zurueck zu Spielerprofil-LLM) --+
                 |                    |nein
                 |ja                  v
                 |            Scouting Brief: Ablehnung dokumentieren --> Fehler anzeigen
                 v
        → [Player-Ranking] → Spielersuche → Gate
        → Recherche → Gate
        → Empfehlung → [Player-Profil] → Empfehlung anreichern
        → Final Validation → Anzeige
```

Die in `[…]` stehenden Schritte sind Aufrufe des
[CSV-Analytics-Adapters](#csv-analytics-adapter) über je einen
**Execute Workflow**-Node (analog zum Recherche-Subworkflow). Jeder
`<Stufe>-LLM`-Schritt ist eine **Basic LLM Chain**
(`@n8n/n8n-nodes-langchain.chainLlm`), verbunden mit dem gemeinsamen
**Ollama Modell (Qwen3.8:latest)** (`ai_languageModel`) und einem eigenen
**Structured Output Parser** (`@n8n/n8n-nodes-langchain.outputParserStructured`,
`ai_outputParser`), der die jeweilige Ausgabestruktur erzwingt; ein Fehler auf
diesem Weg (z. B. Ollama nicht erreichbar) wird über `onError:
continueErrorOutput` an **LLM-Fehler normalisieren** → **Fehler anzeigen**
geleitet, siehe unten.

Jede Stufe folgt weiterhin demselben Grundmuster wie im bisherigen Workflow
(**Dummy-/LLM-Antwort erzeugen** → **Ausgabe prüfen** → **Ausgabe gültig?**),
nur je fachlicher Stufe wiederholt: `<Stufe> erzeugen`/`durchführen` (Code,
Execute Workflow oder LLM-Chain) → `<Stufe> prüfen` (Code, setzt
`valid`/`errorMessage`) → `<Stufe> gültig?` (IF) → bei `false` **Fehler
anzeigen**, bei `true` weiter zur nächsten Stufe. Bei **Teamdiagnose** und
**Spielerprofil** ist aus dem einzelnen `<Stufe> erzeugen`-Node inzwischen
eine kleine, in sich geschlossene Teilkette geworden (siehe Diagramm oben),
das Gate-Muster danach bleibt aber identisch.

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
   - **wahr** → weiter zu **Team-Performance abrufen**.
4. **Team-Performance abrufen** (Execute Workflow) — ruft den
   CSV-Analytics-Subworkflow
   [`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json)
   auf (Tool „Teamperformance“, siehe [CSV-Analytics-Adapter](#csv-analytics-adapter))
   und reichert das Item um `teamPerformance` an.
5. **Team-Matches abrufen** (Execute Workflow) — ruft
   [`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json)
   auf (Tool „Team-Matches“) und reichert das Item um `teamMatches` an.
6. **Teamdiagnose: Datenverfügbarkeit prüfen** (IF) — prüft
   `teamPerformance.dataAvailable`. **falsch** (kein CSV-Datensatz für den
   angefragten Verein) → **Teamdiagnose (keine Daten) erzeugen**; **wahr** →
   **Teamdiagnose: Evidenz aufbereiten**. Ohne Datengrundlage gibt es nichts,
   was ein LLM interpretieren könnte — dieser Fall bleibt deshalb bewusst
   deterministisch, ohne einen LLM-Aufruf auszulösen.
7. **Teamdiagnose (keine Daten) erzeugen** (Code) — deterministischer
   Ersatz-Zweig für einen unbekannten Verein: liefert
   `teamDiagnosis.dataAvailable: false`, `diagnosisCategory: 'no_data'` und
   einen expliziten Hinweis auf die fehlende Datengrundlage statt etwas zu
   erfinden (unverändert gegenüber dem bisherigen No-Data-Verhalten,
   ergänzt um die beiden neuen Pflichtfelder `leagueComparison` und
   `counterHypotheses`, damit **Teamdiagnose prüfen** unten auch diesen
   Zweig als schema-gültig akzeptiert). Läuft direkt weiter zu
   **Teamdiagnose prüfen**.
8. **Teamdiagnose: Evidenz aufbereiten** (Code) — deterministische
   Faktenextraktion aus `teamPerformance`/`teamMatches` (Bilanz, Form,
   Punkteschnitt, letzte Ergebnisse) in `teamDiagnosisEvidence`, bewusst
   **ohne** jede Interpretation (keine Hypothesen, kein Hauptproblem) — das
   übernimmt jetzt **Teamdiagnose LLM**. Diese Trennung stellt sicher, dass
   der spätere `teamDiagnosis.evidence`-Wert nachweisbar der reine,
   unveränderte CSV-Befund bleibt und nicht vom LLM mitgestaltet wird.
9. **Teamdiagnose LLM** (`@n8n/n8n-nodes-langchain.chainLlm`, Basic LLM
   Chain) — interpretiert `teamDiagnosisEvidence` sowie die Rohkennzahlen aus
   `teamPerformance`/`teamMatches` über **Ollama Modell (Qwen3.8:latest)**
   (`ai_languageModel`) und liefert, erzwungen durch **Teamdiagnose
   Output-Schema** (`ai_outputParser`), `diagnosisCategory`
   (`'defensive'`/`'offensive'`/`'neutral'`), `leagueComparison`,
   `hypotheses`, `counterHypotheses`, `mainProblem` und `uncertainties` als
   strukturiertes JSON — ausdrücklich angewiesen, ausschließlich die
   gegebenen Fakten zu interpretieren, nichts zu erfinden und Unsicherheiten
   zu benennen. Da dem LLM nur die Kennzahlen des betrachteten Vereins
   vorliegen (keine Liga-Durchschnittswerte, keine Kennzahlen anderer
   Vereine), ist der Prompt ausdrücklich angewiesen, in `leagueComparison`
   **keine** Bundesliga-Platzierung/-Durchschnitt/-Vergleichswerte zu
   erfinden, sondern das Fehlen einer belastbaren Vergleichsgrundlage
   explizit zu benennen. `onError: continueErrorOutput` leitet einen Fehler (z. B.
   Ollama nicht erreichbar) auf den zweiten Output an **LLM-Fehler
   normalisieren** statt den Workflow abzubrechen.
10. **Teamdiagnose Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
    — erzwingt (`schemaType: manual`) den unter 9. genannten JSON-Vertrag für
    **Teamdiagnose LLM**; `evidence` ist bewusst **nicht** Teil dieses
    Schemas (siehe 8.).
11. **Teamdiagnose zusammenführen** (Code) — gegen n8n **2.35.7** verifiziert:
    die Basic LLM Chain (v1.6) setzt bei aktivem Output Parser
    `shouldUnwrapObjects = true`, wodurch die geparsten Structured-Output-
    Felder direkt als Node-JSON zurückkommen (`$json.diagnosisCategory` usw.,
    **nicht** `$json.output.diagnosisCategory`); der Rest des Items geht dabei
    trotzdem verloren. Dieser Node holt das vollständige Item über
    `$('Teamdiagnose: Evidenz aufbereiten').first().json` zurück — **nicht**
    über `.item`, denn die Chain liefert auf dem Erfolgspfad laut exakt
    getaggtem n8n-2.35.7-Quellcode nur `{ json: ... }` ohne `pairedItem`, und
    `.item` würde dafür `paired_item_no_info` werfen; `.first()` braucht keine
    Pairing-Kette und ist für diesen durchgehend Ein-Item-Zweig äquivalent —
    und baut `teamDiagnosis` aus dem deterministischen `teamDiagnosisEvidence`
    (→ `evidence`) und der LLM-Interpretation (→ `diagnosisCategory`,
    `hypotheses`, `counterHypotheses`, `mainProblem`, `uncertainties`)
    zusammen (`teamDiagnosis.simulated: false`, `dataAvailable: true`). Da dem
    LLM nachweislich nie echte Liga-Vergleichsdaten vorliegen (siehe 9.), setzt
    dieser Node `teamDiagnosis.leagueComparisonAvailable` **deterministisch im
    Code auf `false`** statt es vom LLM zu erfragen, und verwirft dafür den
    LLM-Text in `leagueComparison` zugunsten eines festen, wahrheitsgemäßen
    Hinweises — eine reine Promptvorgabe könnte ein regelwidriges LLM nicht
    zuverlässig daran hindern, trotzdem eine Bundesliga-Platzierung zu
    erfinden. Läuft anschließend in dieselbe **Teamdiagnose prüfen** wie der
    No-Data-Zweig.
12. **Teamdiagnose prüfen** (Code) — erweitert: prüft wie bisher, dass
    `evidence`/`hypotheses` nichtleere Arrays sind, `mainProblem` ein
    nichtleerer String ist und `uncertainties` ein Array ist, **zusätzlich**
    jetzt auch, dass `leagueComparisonAvailable` ein boolean und
    `leagueComparison` ein nichtleerer String sowie `counterHypotheses` ein
    Array ist; setzt `valid`/`errorMessage`.
13. **Teamdiagnose gültig?** (IF) — **falsch** → **Fehler anzeigen**; **wahr**
    → **Teamdiagnose: Datengrundlage prüfen**.
13a. **Teamdiagnose: Datengrundlage prüfen** (Code) — prüft, ob
    `teamDiagnosis.diagnosisCategory === 'no_data'`. Ohne diesen Stopp würde
    **Spielerprofil: Positionspool ermitteln** bei fehlender Datengrundlage
    auf den ungefilterten Positionspool zurückfallen und die Pipeline bis zur
    Empfehlung weiterlaufen lassen, obwohl keine belastbare Diagnose vorliegt
    — das widerspricht der Story-Vorgabe, bei unzureichender Evidenz
    Unsicherheit auszuweisen bzw. weitere Analytics anzufordern statt sichere
    Folgeschlüsse zu erfinden. Setzt `valid`/`errorMessage`.
13b. **Teamdiagnose: Datengrundlage ausreichend?** (IF) — **falsch** (d. h.
    `diagnosisCategory === 'no_data'`) → **Fehler anzeigen** (die Bedarfs-
    ermittlung/Spielersuche wird kontrolliert gestoppt); **wahr** →
    **Spielerprofil: Positionspool ermitteln**.
14. **Spielerprofil: Positionspool ermitteln** (Code) — wird nur noch mit
    einer belastbaren Teamdiagnose erreicht (`no_data` stoppt bereits bei
    13b.) und grenzt den Positionspool generisch anhand von
    `teamDiagnosis.diagnosisCategory` ein (Defensivproblem → defensive
    Positionen, Offensivproblem → offensive Positionen, `neutral` → alle
    Positionen; kein Sonderfall für einen bestimmten Verein oder eine
    bestimmte Position) und übergibt diesen Pool als `allowedPositions`
    verbindlich an **Spielerprofil LLM**.
15. **Spielerprofil LLM** (`@n8n/n8n-nodes-langchain.chainLlm`, Basic LLM
    Chain) — leitet aus der (jetzt LLM-erzeugten) Teamdiagnose sowie
    `club`/`objective`/`additionalContext` ein strukturiertes
    Anforderungsprofil ab, über dasselbe **Ollama Modell (Qwen3.8:latest)**
    und erzwungen durch **Spielerprofil Output-Schema**: `position` (die
    Instruktion verlangt ausdrücklich, ausschließlich aus `allowedPositions`
    zu wählen), `role`, `weightedCriteria` (Kriteriennamen, die
    **Player-Ranking** erkennt: `goals`, `assists`, `rating`,
    `appearances`, `age`, `minutesPlayed`, `marketValueMEUR`), `constraints`
    (Liste strukturierter, tatsächlich filterbarer Objekte `{ field:
    'age'|'marketValueMEUR', operator: 'max'|'min', value: <Zahl> }` — nur
    wenn ein konkreter Alters- oder Budget-/Marktwertrahmen aus dem
    zusätzlichen Kontext **und/oder** aus einer vorliegenden
    Reviewer-Rückmeldung (`reviewFeedback`, s. u.) ableitbar ist, sonst ein
    leeres Array statt eines erfundenen Rahmens) und `reasoning` (muss sich
    auf `teamDiagnosis.mainProblem` beziehen). Gleiches `onError:
    continueErrorOutput` → **LLM-Fehler normalisieren** wie bei
    **Teamdiagnose LLM**. **Neu:** ist `$json.reviewFeedback` gesetzt (dieser
    Lauf folgt auf eine **Request Changes**-Entscheidung im
    [Scouting-Brief-Human-Review](#scouting-brief-human-review), siehe 19a./19h.
    unten), wird der Prompt um genau dieses Freitext-Feedback ergänzt und das
    LLM angewiesen, Rolle/Kriterien/Constraints/Begründung entsprechend zu
    überarbeiten, ohne den erlaubten Positionspool oder die zulässigen
    Kriteriennamen zu verletzen; die `constraints`-Instruktion nennt
    `additionalContext` und `reviewFeedback` dabei ausdrücklich als
    gleichberechtigte, alternative Quellen für einen konkreten
    Alters-/Budgetwert (z. B. „max. 10 Mio. Marktwert“ oder „nur unter 24“ im
    Feedback), sodass ein vom Reviewer genanntes Limit zuverlässig ins
    überarbeitete `playerProfile.constraints` übernommen wird, statt vom
    Widerspruch zur ursprünglichen, auf `additionalContext` beschränkten
    Formulierung abzuhängen; ist `reviewFeedback` leer (Erstlauf), bleibt der
    Prompt unverändert. Die zusätzlich konfigurierte Chat-Message (in n8n
    **2.35.7** als `SystemMessage` vor den User-Prompt gestellt) ist mit
    dieser Constraints-Instruktion abgestimmt: sie nennt die Teamdiagnose als
    fachliche Grundlage für Position/Rolle/Kriterien, erlaubt aber ausdrücklich
    `additionalContext`/`reviewFeedback` als Quelle für einen konkreten
    Alters-/Budgetgrenzwert — andernfalls würde die System-Message dem
    User-Prompt widersprechen und das LLM könnte ein Reviewer-Limit trotz
    korrekter Instruktion im `text`-Prompt ignorieren.
16. **Spielerprofil Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
    — erzwingt den unter 15. genannten JSON-Vertrag für **Spielerprofil
    LLM**, inkl. des strukturierten `constraints`-Objektvertrags.
17. **Spielerprofil zusammenführen** (Code) — gegen n8n **2.35.7** verifiziert
    (siehe 11.): die geparsten Structured-Output-Felder liegen direkt auf
    `$json`, nicht unter `$json.output`. Holt das vollständige Item über
    `$('Spielerprofil: Positionspool ermitteln').first().json` zurück (**nicht**
    über `.item`, aus demselben `pairedItem`-Grund wie bei **Teamdiagnose
    zusammenführen**, siehe 11.) und setzt
    `playerProfile` aus der LLM-Ausgabe zusammen (`playerProfile.simulated:
    false` — nicht mehr als Dummy markiert).
18. **Spielerprofil prüfen** (Code) — erweitert: prüft wie bisher alle
    Pflichtfelder inkl. dass jedes `weightedCriteria`-Element ein `criterion`
    und ein numerisches `weight` hat, **zusätzlich** jetzt eine generische
    Konsistenzprüfung, dass `playerProfile.position` tatsächlich im durch
    `teamDiagnosis.diagnosisCategory` vorgegebenen Pool liegt (dieselbe
    Poolzuordnung wie in **Spielerprofil: Positionspool ermitteln**, hier
    erneut dupliziert, da Code-Nodes keine gemeinsamen Hilfsfunktionen teilen
    können) — das Parser-Schema allein kann das nicht garantieren, da
    `position` dort nur als String typisiert ist, nicht als von der Diagnose
    abhängiges Enum. Verstößt das LLM dagegen, wird `valid: false` gesetzt.
    Ebenso geprüft: jedes `constraints`-Element hat ein `field` aus
    `age`/`marketValueMEUR`, ein `operator` aus `max`/`min` und ein
    numerisches `value` — nur so kann **Player-Ranking-Anfrage vorbereiten**
    (20.) die Constraints tatsächlich anwenden statt sie als Dead Data
    mitzuführen.
19. **Spielerprofil gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Scouting Brief erstellen**.

**Scouting Brief Human-Review**

Nach einem gültigen Spielerprofil folgt jetzt ein echtes Human-Review-Gate
statt der bisherigen automatischen Weiterleitung an die Spielersuche. Ein
Mensch prüft dabei ein aus **Teamdiagnose** und **Spielerprofil**
abgeleitetes, strukturiertes **Scouting Brief** und kann es **Approve**,
mit Freitext-Feedback **Request Changes** verlangen (der Agent überarbeitet
das Spielerprofil daraufhin über einen erneuten **Spielerprofil LLM**-Aufruf
und legt das Brief erneut vor) oder **Reject**. Position und Profil werden
dabei weiterhin ausschließlich vom Agenten hergeleitet — der Reviewer
entscheidet nur über Freigabe, Überarbeitung oder Ablehnung, gibt aber keine
eigene Position/kein eigenes Profil vor.

19a. **Scouting Brief erstellen** (Code) — baut `scoutingBrief` aus dem
    bereits validierten `teamDiagnosis.mainProblem` (→ `problem`) und
    `playerProfile.position`/`role`/`reasoning`/`weightedCriteria`/
    `constraints` (→ `targetPosition`/`role`/`reasoning`/`weightedCriteria`/
    `constraints`) sowie `teamDiagnosis.uncertainties` (→ `uncertainties`)
    zusammen — rein deklarativ aus bereits vorhandenen, validierten Feldern,
    ohne neue Werte zu erfinden. Führt zusätzlich eine begrenzte
    Überarbeitungshistorie: folgt dieser Lauf auf eine **Request
    Changes**-Entscheidung (`item.reviewDecision === 'Request Changes'`),
    wird das Feedback der vorherigen Runde (aus dem vorherigen
    `scoutingBrief.reviewRound`) an `scoutingBrief.feedbackHistory`
    angehängt; `scoutingBrief.reviewRound` zählt ab 1 hoch,
    `scoutingBrief.maxReviewRounds` ist auf `3` fest verdrahtet (siehe
    **Review-Entscheidung auswerten** unten).
19b. **Scouting Brief prüfen** (Code) — Gate nach demselben Muster wie die
    übrigen Stufen: prüft, dass `problem`, `targetPosition`, `role` und
    `reasoning` nichtleere Strings sind, `weightedCriteria` ein nichtleeres
    Array ist und `constraints`/`uncertainties` Arrays sind; setzt
    `valid`/`errorMessage`.
19c. **Scouting Brief gültig?** (IF) — **falsch** → **Fehler anzeigen**
    (derselbe zentrale Fehlerpfad wie bei allen anderen Gates); **wahr** →
    **Scouting Brief zur Freigabe vorlegen**.
19d. **Scouting Brief zur Freigabe vorlegen** (`n8n-nodes-base.form`, ohne
    `operation: "completion"`, d. h. eine zusätzliche Formularseite
    innerhalb desselben mehrstufigen Formulars wie **AI Sporting Director
    beauftragen**, nicht dessen Abschluss) — zeigt `scoutingBrief`
    (Hauptproblem, Zielposition/Rolle, Begründung, gewichtete Kriterien,
    Constraints, Unsicherheiten, aktuelle Überarbeitungsrunde und ggf. bereits
    gesammeltes Feedback früherer Runden) rein lesend in `formDescription` an
    und erfragt zwei Eingabefelder: `Entscheidung` (Dropdown, Pflichtfeld,
    Optionen `Approve`/`Request Changes`/`Reject`) und `Feedback (Pflicht bei
    Request Changes)` (Textarea, im Formular selbst nicht als Pflichtfeld
    hinterlegt, da n8n-Formularfelder nicht bedingt pflicht sein können — die
    eigentliche Pflicht bei `Request Changes` erzwingt stattdessen der
    nachfolgende Code-Node). Pausiert die Workflow-Ausführung, bis ein Mensch
    das Formular absendet, und setzt danach mit den eingegebenen Werten fort
    — analog zum mehrstufigen Formularmuster von **AI Sporting Director
    beauftragen**/**Ergebnis anzeigen**/**Fehler anzeigen**, hier nur ohne
    `completion`, weil der Workflow nach dieser Seite weiterläuft statt zu
    enden.
19e. **Review-Entscheidung auswerten** (Code) — liest `$json['Entscheidung']`
    und `$json['Feedback (Pflicht bei Request Changes)']` aus der
    Formulareingabe und holt das vollständige Item vor der Formularseite über
    `$('Scouting Brief erstellen').first().json` zurück (bewusst defensiv wie
    bei den LLM-Chain-Knoten, siehe 11./17., unabhängig davon, ob der
    Form-Node selbst bereits alle Felder durchreicht). Validiert, dass
    `Entscheidung` einer von `Approve`/`Request Changes`/`Reject` ist und dass
    bei `Request Changes` ein nichtleeres Feedback vorliegt; setzt
    `valid`/`errorMessage`. Erzwingt außerdem den **begrenzten** Feedback-Loop
    aus der Story-Vorgabe: ist `scoutingBrief.reviewRound` bereits
    `maxReviewRounds` (3) erreicht und die Entscheidung erneut `Request
    Changes`, wird `reviewOutcome` trotzdem auf `'Reject'` gesetzt
    (`maxRoundsReached: true`) statt eine vierte Überarbeitung zuzulassen —
    ansonsten entspricht `reviewOutcome` der eingegebenen `Entscheidung`.
19f. **Review-Entscheidung gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Review: Approve?**.
19g. **Review: Approve?** (IF, prüft `reviewOutcome === 'Approve'`) —
    **wahr** → **Player-Ranking-Anfrage vorbereiten** (derselbe Hauptworkflow
    läuft unverändert fort); **falsch** → **Review: Request Changes?**.
19h. **Review: Request Changes?** (IF, prüft `reviewOutcome === 'Request
    Changes'`) — **wahr** → zurück zu **Spielerprofil: Positionspool
    ermitteln** (derselbe Positionspool wird deterministisch aus
    `teamDiagnosis.diagnosisCategory` neu ermittelt; **Spielerprofil LLM**
    erhält über `reviewFeedback` das Freitext-Feedback und ist angewiesen,
    das Profil entsprechend zu überarbeiten, siehe 15.); durchläuft danach
    erneut **Spielerprofil zusammenführen** → **Spielerprofil prüfen** →
    **Spielerprofil gültig?** → **Scouting Brief erstellen** (19a., das dabei
    das vorherige Feedback archiviert und die Runde hochzählt) → erneutes
    Review. **falsch** (d. h. `reviewOutcome === 'Reject'`, ob explizit oder
    weil `maxRoundsReached`) → **Scouting Brief: Ablehnung dokumentieren**.
19i. **Scouting Brief: Ablehnung dokumentieren** (Code) — formuliert
    `errorMessage` mit dem Grund (`Reject` durch den Reviewer oder erreichte
    `maxReviewRounds`) und dem zuletzt gegebenen Feedback, läuft in denselben
    zentralen Fehlerpfad **Fehler anzeigen** wie alle anderen Gates — ein
    Reject beendet die Kandidatensuche damit kontrolliert, ohne eine
    Empfehlung zu erzeugen.

20. **Player-Ranking-Anfrage vorbereiten** (Code) — übersetzt `playerProfile`
    in den Tool-Vertrag von Player-Ranking: `rankingExcludeClub` = der
    diagnostizierte Verein (Scouting sucht außerhalb des eigenen Kaders),
    `constraints` = `playerProfile.constraints` (siehe unten, Abschnitt
    [CSV-Analytics-Adapter](#csv-analytics-adapter), Player-Ranking),
    `position`/`criteria` aus `playerProfile.position`/`weightedCriteria`,
    `limit: 5`.
21. **Player-Ranking abrufen** (Execute Workflow) — ruft
    [`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json)
    auf (Tool „Player-Ranking“) und reichert das Item um `playerRanking` an.
22. **Spielersuche durchführen** (Code) — leitet `longlistSize` und eine
    `shortlist` von bis zu fünf Kandidaten (`score`, `strengths`,
    `weaknesses`, `evidence` jeweils aus echten, importierten Spielerwerten
    gegenüber dem Pool-Durchschnitt) aus `playerRanking` ab
    (`playerSearch.simulated: false`). Liefert der Adapter keine Kandidaten
    (z. B. weil der komplette Markt für die Anfrage leer ist), bleibt
    `shortlist` leer statt Kandidaten zu erfinden — das nachfolgende Gate
    greift dann reell.
23. **Spielersuche prüfen** (Code) — prüft `longlistSize > 0`, `shortlist`
    nichtleer und **höchstens fünf** Kandidaten, sowie dass jeder Kandidat
    alle Pflichtfelder hat. Prüft zusätzlich, dass
    `playerRanking.ignoredConstraints` leer ist — ein vom Spielerprofil
    gefordertes, aber im Player-Ranking nicht anwendbares Constraint (z. B.
    weil `marketValueMEUR` im Kandidatenpool nicht numerisch verfügbar ist)
    würde sonst stillschweigend ignoriert und die Pipeline könnte trotzdem bis
    zur Empfehlung weiterlaufen, obwohl das Constraint keine Wirkung hatte.
    Ein nicht anwendbares Constraint gilt hier deshalb als unzureichende
    Datengrundlage und stoppt über das folgende Gate. **Neu:** dasselbe gilt
    jetzt analog für `playerRanking.ignoredCriteria` — sind alle vom
    Spielerprofil gewichteten Kriterien im Kandidatenpool nicht numerisch
    verfügbar, ersetzt der Ranking-Subworkflow sie sonst still durch die
    Default-Kriterien (`goals`/`assists`/`xG`) und könnte trotzdem eine
    Empfehlung erzeugen, ohne dass die LLM-Kriterien die Suche tatsächlich
    steuern. **Neu:** außerdem prüft das Gate `playerRanking.
    positionFallbackApplied` — schlägt selbst der grobe
    Positionsgruppen-Match (DF/MF/FW/GK) fehl, behält der Ranking-Subworkflow
    den kompletten ungefilterten Spielerpool statt gar keinen Kandidaten zu
    liefern; ohne diese Prüfung könnte eine angeforderte Position komplett
    verloren gehen und ein Spieler einer völlig anderen Positionsgruppe
    empfohlen werden.
24. **Spielersuche gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Recherche durchführen**.
25. **Recherche durchführen** (Execute Workflow) — unverändert: ruft den
    technischen Subworkflow
    [`recherche-subworkflow.json`](./recherche-subworkflow.json) auf und
    übergibt das aktuelle Item (inkl. `playerSearch.shortlist`) unverändert
    weiter (`Passthrough`). Der Subworkflow liefert je Kandidat aus der
    Shortlist `club` (Verein), `contract` (Vertrag), `marketValue`
    (Marktwert), `injuries` (Verletzungen) und `news` (Meldungen), jeweils
    mit `source` (Dummy-Quelle), `timestamp` (Zeitpunkt) und `confidence`
    (Konfidenz) — siehe [Recherche-Subworkflow](#recherche-subworkflow).
26. **Recherche prüfen** (Code) — unverändert: prüft die Kandidatenabdeckung
    per Set-Gleichheit (jeder Shortlist-Name kommt in `research` vor und
    umgekehrt) plus Duplikatprüfung, sodass `research` **genau einen**
    Eintrag je Shortlist-Kandidat enthält (nicht nur dieselbe Anzahl), und
    dass jeder Eintrag alle Pflichtfelder hat.
27. **Recherche gültig?** (IF) — **falsch** → **Fehler anzeigen**; **wahr**
    → **Empfehlung erzeugen**.
28. **Empfehlung erzeugen** (Code) — wählt den Kandidaten mit dem
    höchsten `score` aus `playerSearch.shortlist` als bevorzugten Kandidaten
    (damit stammt er per Konstruktion aus der validierten Shortlist), die
    übrigen Shortlist-Namen werden `alternatives`; dazu `reasoning`, `risks`,
    `uncertainties`, `nextStep`. **Neu:** ist `playerRanking.
    positionApproximationApplied` gesetzt (angeforderte Position nur grob auf
    eine Positionsgruppe DF/MF/FW/GK angenähert statt exakt gematcht — mit der
    FBref-Datengrundlage der Regelfall, siehe Player-Ranking-Subworkflow
    unten), wird das explizit als zusätzlicher Eintrag in
    `recommendation.uncertainties` ausgewiesen, statt stillschweigend
    übernommen zu werden.
29. **Player-Profil-Anfrage vorbereiten** (Code) — setzt `playerName` auf
    `recommendation.candidate`.
30. **Player-Profil abrufen** (Execute Workflow) — ruft
    [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)
    auf (Tool „Player-Profil“) und reichert das Item um `playerProfileLookup`
    an. Da der Kandidat selbst aus den importierten Player-Daten stammt (über
    Player-Ranking), wird er hier immer gefunden.
31. **Empfehlung anreichern** (Code) — setzt
    `recommendation.candidateProfile` auf `playerProfileLookup.profile` (bzw.
    `null`, falls nicht gefunden), ohne die übrigen `recommendation`-Felder zu
    verändern.
32. **Final Validation** (Code) — unverändert: prüft alle vorherigen
    Stufenergebnisse noch einmal im Zusammenhang (u. a. dass
    `recommendation.candidate` tatsächlich Teil der validierten
    `playerSearch.shortlist` ist) sowie den vollständigen
    Empfehlungsvertrag: `candidate`, `alternatives` (Array), `reasoning`,
    `risks` (nichtleeres Array), `uncertainties` (nichtleeres Array) und
    `nextStep` — analog zur bisherigen **Ausgabe prüfen**, jetzt über den
    gesamten Ablauf. `candidateProfile` ist kein Pflichtfeld dieser Prüfung.
33. **Final Validation gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Ergebnisseiten aufbereiten**.
34. **Ergebnisseiten aufbereiten** (Code) — baut `formattedResult`: einen
    Text, der Teamdiagnose, Spielerprofil, Spielersuche, Recherche und
    Empfehlung (inkl. `candidateProfile`, falls vorhanden) als klar
    getrennte Abschnitte darstellt, mit einem Hinweis, welche Abschnitte auf
    dem CSV-Analytics-Adapter bzw. der LLM-Interpretation beruhen und welche
    weiterhin vollständig simuliert sind.
35. **Ergebnis anzeigen** (Form, Completion) — unverändert: zeigt
    `formattedResult` an.
36. **Fehler anzeigen** (Form, Completion) — unverändert der eine zentrale
    Fehlerpfad für **alle** Gates (Validierung, Teamdiagnose, Spielerprofil,
    Spielersuche, Recherche, Final Validation) **und** für Fehler aus
    **Teamdiagnose LLM**/**Spielerprofil LLM** (über **LLM-Fehler
    normalisieren**): zeigt `errorMessage` an; ein ungültiges Ergebnis wird
    nie als fachliche Empfehlung dargestellt.
37. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model) — nicht mehr ohne
    Verbindung: versorgt jetzt sowohl **Teamdiagnose LLM** als auch
    **Spielerprofil LLM** über `ai_languageModel`.
38. **LLM-Fehler normalisieren** (Code) — nicht mehr ohne eingehende
    Verbindung: empfängt jetzt den Error-Output (`onError:
    continueErrorOutput`) von **Teamdiagnose LLM** und **Spielerprofil LLM**
    und normalisiert ihn wie zuvor beschrieben (String- oder
    Objekt-Fehler-Shape) zu `errorMessage`, weiterhin verbunden mit dem
    zentralen Fehlerpfad **Fehler anzeigen**.

Die Struktur erlaubt, jede `<Stufe> erzeugen`/`durchführen`-Node später durch
echte Logik (AI Agent, Qlik/MCP, Websuche) zu ersetzen, ohne die
`<Stufe> prüfen`/`<Stufe> gültig?`-Gates, das Formular, die Normalisierung,
die Validierung oder die Ergebnisdarstellung neu bauen zu müssen — die
Datenverträge (`teamDiagnosis`, `playerProfile`, `playerSearch`, `research`,
`recommendation`) bleiben dabei stabil, solange ein Ersatz dieselben Felder
liefert. Für **Teamdiagnose** und **Spielerprofil** ist dieser Ersatz jetzt
bereits vollzogen: statt eines Code-Nodes erzeugt eine **Basic LLM Chain**
über **Ollama Modell (Qwen3.8:latest)** die Interpretation bzw. das
Anforderungsprofil; nur **Recherche durchführen** bleibt ein noch zu
ersetzender Dummy. Das gilt weiterhin auch eine Ebene tiefer:
**Team-Performance abrufen**, **Team-Matches abrufen**, **Player-Ranking
abrufen** und **Player-Profil abrufen** lassen sich beim Wechsel auf Qlik MCP
durch Aufrufe der dann echten MCP-Tools ersetzen, ohne dass **Teamdiagnose:
Evidenz aufbereiten**, **Spielersuche durchführen** oder **Empfehlung
anreichern** angepasst werden müssen, solange der Ersatz dieselben Felder
(`teamPerformance`, `teamMatches`, `playerRanking`, `playerProfileLookup`)
liefert — siehe [CSV-Analytics-Adapter](#csv-analytics-adapter).

## CSV-Analytics-Adapter

Temporärer, CSV-basierter Ersatz für die künftige Qlik-MCP-Anbindung (siehe
User Story „CSV Analytics Adapter als temporären Qlik-Ersatz
implementieren“). Vier fachliche Analytics-Tools sind als eigenständige,
technische n8n-Subworkflows gekapselt — analog zum
[Recherche-Subworkflow](#recherche-subworkflow) — und werden aus dem
Hauptworkflow über je einen **Execute Workflow**-Node aufgerufen. Die
Tool-Verträge (Feldnamen für Ein-/Ausgabe) sind bewusst so gestaltet, wie sie
später durch echte Qlik-MCP-Tools bedient werden sollen; die Referenzdaten
selbst liegen persistent in der n8n Data Table `football_scouting_raw` (voller
Bundesliga-Datensatz, importiert über
[`import-scouting-data.json`](./import-scouting-data.json), siehe
[`n8n/data/README.md`](./data/README.md)), nicht mehr als CSV-Dateien im
Repository. Kein Tool erfindet Werte für unbekannte Vereine, Spieler
oder Positionen — stattdessen wird das explizit ausgewiesen (`dataAvailable:
false`, `found: false` bzw. `positionFallbackApplied: true`). Dasselbe gilt
für einzelne fehlende/ungültige numerische CSV-Zellen (leerer Wert,
nicht-numerischer Text): sie werden validiert, statt per `Number(...)`
stillschweigend zu `0` bzw. `NaN` zu werden, und fließen explizit markiert
(`invalidMatches`, `dataError`, `excludedInvalidData`/`invalidFields`, siehe
unten) nicht in Aggregation oder Ranking-Score ein.

1. **Teamperformance**
   ([`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json)) —
   Input `{ club }`. Aggregiert die letzten Spiele des Vereins aus der Data
   Table `football_scouting_raw` zu `teamPerformance`: `matchesAnalyzed`, `wins`/`draws`/`losses`,
   `goalsFor`/`goalsAgainst`/`goalDifference`, `points`, `avgGoalsFor`/
   `avgGoalsAgainst`, `form` (neuestes Spiel zuerst). Unbekannter Verein →
   `dataAvailable: false` statt erfundener Werte; Spiele mit fehlenden/
   ungültigen Tordaten werden gezählt (`invalidMatches`) und von der
   Aggregation ausgeschlossen statt als `0` eingerechnet zu werden (bei
   ausschließlich ungültigen Zeilen ebenfalls `dataAvailable: false`).
2. **Team-Matches**
   ([`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json)) —
   Input `{ club, matchLimit? }` (Default 10). Liefert `teamMatches.matches`:
   je Spiel `date`, `opponent`, `homeAway`, `goalsFor`, `goalsAgainst`,
   `result`, `competition`, `dataError`. Ein Spiel mit fehlenden/ungültigen
   Tordaten bleibt in der Liste, hat aber `goalsFor`/`goalsAgainst`/`result:
   null` und `dataError: true` statt erfundener Werte (`invalidMatches`
   zählt sie zusätzlich auf Ebene von `teamMatches`).
3. **Player-Ranking**
   ([`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json)) —
   Input `{ rankingClub?, rankingExcludeClub?, position?, criteria?: [{
   criterion, weight }], constraints?: [{ field, operator, value }], limit? }`
   (bewusst eigene Feldnamen statt `club`, da
   das im Hauptworkflow bereits den zu diagnostizierenden Verein bezeichnet
   und beim Durchreichen des ganzen Items sonst kollidieren würde).
   `rankingClub` filtert auf genau einen Verein, `rankingExcludeClub`
   schließt genau einen Verein aus (so sucht die Spielersuche außerhalb des
   eigenen Kaders). Erkannte, generische `criteria`-Namen: `goals`,
   `assists`, `rating`, `minutesPlayed`, `appearances`, `marketValueMEUR`
   (höher = besser) sowie `age` (niedriger = besser); jeder Wert wird über
   den betrachteten Pool min-max-normalisiert und gewichtet aufsummiert.
   `constraints` (von `playerProfile.constraints` im Hauptworkflow, siehe
   Node 20 oben) filtert den Pool **vor** dem Scoring hart: `field` ist
   `age` oder `marketValueMEUR`, `operator` ist `max` (Wert ≤ `value`) oder
   `min` (Wert ≥ `value`). Ein Constraint auf ein Feld ohne numerisch
   verfügbare Daten im Pool wird nicht ignoriert-und-verschwiegen, sondern in
   `ignoredConstraints` aufgeführt; tatsächlich angewendete Constraints stehen
   in `appliedConstraints`, die Anzahl dadurch ausgeschlossener Kandidaten in
   `excludedByConstraints`. So werden Budget-/Altersvorgaben aus dem
   Spielerprofil tatsächlich für die Spielersuche wirksam, statt Dead Data zu
   bleiben. Ein nicht anwendbares Constraint bleibt hier bewusst nur
   protokolliert (`ignoredConstraints`) statt den Subworkflow-Lauf
   abzubrechen; **Spielersuche prüfen** im Hauptworkflow (siehe Node 23 oben)
   wertet `ignoredConstraints` aus und stoppt die Pipeline vor einer
   Empfehlung, falls ein Constraint nicht wirksam wurde.
   Unbekannte oder im Pool nicht numerisch verfügbare Kriterien werden nicht
   ignoriert-und-verschwiegen, sondern in `ignoredCriteria` aufgeführt;
   **Spielersuche prüfen** im Hauptworkflow (siehe Node 23 oben) wertet das
   aus und stoppt die Pipeline, falls dadurch die vom Spielerprofil
   gewichteten Kriterien die Suche nicht mehr tatsächlich steuern würden.
   Die Positionssuche versucht zuerst einen exakten Match (normalisiert,
   `ß`→`ss`), dann einen groben Gruppen-Match (DF/MF/FW/GK, z. B.
   „Linksaußen“ → `FW`) — dabei wird `positionApproximationApplied: true`
   gesetzt (mit der FBref-Datengrundlage der Regelfall, da dort keine
   granulareren Positionen als DF/MF/FW/GK vorliegen; **Empfehlung
   erzeugen** im Hauptworkflow weist das als Unsicherheit aus, siehe Node 28
   oben). Schlägt selbst der grobe Gruppen-Match fehl, fällt der
   Subworkflow — explizit über `positionFallbackApplied: true` markiert —
   auf den ungefilterten Pool zurück statt Kandidaten zu erfinden;
   **Spielersuche prüfen** behandelt das als unzureichende Datengrundlage und
   stoppt die Pipeline (siehe Node 23 oben). Ein
   Spieler-Datensatz mit fehlendem/ungültigem numerischem Pflichtfeld (z. B.
   leeres `age`) wird komplett aus dem Ranking-Pool ausgeschlossen statt mit
   `0`/`NaN` in den Score einzufließen — sonst könnte z. B. ein fehlendes
   `age` (niedriger = besser) den Score künstlich verbessern; die Anzahl
   solcher ausgeschlossenen Datensätze steht in `excludedInvalidData`.
   Liefert `playerRanking.ranking` (bis `limit`, Default 5) mit `name`,
   `club`, `position`, `age`, `score`, `stats`.
4. **Player-Profil**
   ([`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)) —
   Input `{ playerName }`. Liefert `playerProfileLookup` mit `found` und
   `profile` (alle importierten Spalten aus der Data Table
   `football_scouting_raw`) bzw. `found: false` und
   `profile: null` für einen unbekannten Namen. Einzelne fehlende/ungültige
   numerische Felder im gefundenen Datensatz bleiben in `profile` explizit
   `null` (statt `0`/`NaN`) und werden namentlich in `invalidFields`
   aufgeführt; `profile.dataError: true` markiert einen unvollständigen
   Datensatz. Heißt bewusst
   `playerProfileLookup`, nicht `playerProfile` — Letzteres bezeichnet im
   Hauptworkflow bereits das simulierte Bedarfsprofil (Anforderung an den
   gesuchten Spielertyp), beide Verträge bleiben dadurch unabhängig
   voneinander stabil.

Die vier Subworkflows lesen die importierten Originalzeilen aus der
persistenten Data Table `football_scouting_raw` (kein eingebetteter
CSV-Code mehr) — siehe [`n8n/data/README.md`](./data/README.md) für den
Import (`import-scouting-data.json`) und die Architektur-Verifikation
(`verify-import-architecture.js`).

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
**danach** `ai-sporting-director.json`. Der Node **Recherche durchführen** im
Hauptworkflow referenziert bereits die feste Top-Level-ID
`802fdb6b-4c0a-413f-952d-250c91ddc476` des Subworkflows; n8n übernimmt
vorhandene Workflow-IDs beim Import (`import:workflow`) per Upsert, sodass
beide Workflows nach dem Import ohne manuelle Anpassung verbunden sind.

## Import & run

1. Open your n8n instance.
2. Import the five technical subworkflows first — order among themselves
   doesn't matter, only "before the main workflow" does — (**Workflows** →
   **Add workflow** → **Import from File**):
   [`recherche-subworkflow.json`](./recherche-subworkflow.json),
   [`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json),
   [`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json),
   [`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json),
   [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json).
3. Import [`ai-sporting-director.json`](./ai-sporting-director.json) the
   same way — its Execute-Workflow nodes already reference the subworkflows'
   fixed IDs, so no manual edit is needed there (on the **Ollama Modell
   (Qwen3.8:latest)** node, select the local `[cimt] Ollama` credential).
4. Use **Test workflow** to obtain a test-mode form URL for manual testing,
   or activate the workflow (toggle **Active** in the top right) to make the
   form reachable at its production URL shown on the **AI Sporting Director
   beauftragen** node.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/recherche-subworkflow.json
n8n import:workflow --input=n8n/analytics-team-performance-subworkflow.json
n8n import:workflow --input=n8n/analytics-team-matches-subworkflow.json
n8n import:workflow --input=n8n/analytics-player-ranking-subworkflow.json
n8n import:workflow --input=n8n/analytics-player-profile-subworkflow.json
n8n import:workflow --input=n8n/ai-sporting-director.json
```

## End-to-End-Test über das HSV-Formular

### Positiver Testfall (alle Stufen)

1. Open the form's test or production URL in a browser. **Expected result:**
   `Verein` shows `Hamburger SV` preselected, and `Was soll der Sporting
   Director untersuchen?` already contains the example text about the
   Hamburger SV's sporting problems.
2. Click `Analyse starten` without changing anything. **Expected result:**
   the browser now shows the **Scouting Brief zur Freigabe vorlegen** page
   (Human Review) instead of directly proceeding to the recommendation —
   `formDescription` renders the Teamdiagnose-derived Hauptproblem,
   Zielposition/Rolle, Begründung, gewichtete Kriterien, Constraints and
   Unsicherheiten of the Spielerprofil-derived `scoutingBrief`, and shows
   `Ueberarbeitungsrunde: 1 von max. 3` with no prior feedback.
3. Select `Approve` in the `Entscheidung` dropdown, leave `Feedback` empty,
   and submit. **Expected result:** the browser shows the **Ergebnis
   anzeigen** page with five clearly separated sections — Teamdiagnose,
   Spielerprofil, Spielersuche, Recherche, Empfehlung — with a hint
   distinguishing the sections backed by the CSV-Analytics-Adapter and the
   LLM interpretation (Teamdiagnose, Spielerprofil, Spielersuche) from the
   still fully simulated one (Recherche), and the recommended candidate is
   one of the shortlisted CSV players (not the Hamburger SV squad itself).
   In the n8n **Executions** list the run is successful and passes all eight
   gates (**Teamdiagnose gültig?**, **Spielerprofil gültig?**, **Scouting
   Brief gültig?**, **Review-Entscheidung gültig?**, **Spielersuche
   gültig?**, **Recherche gültig?**, **Final Validation gültig?**, plus
   **Eingabe validieren**); zusätzlich werden die Routing-IFs **Teamdiagnose:
   Datenverfügbarkeit prüfen** und **Review: Approve?** in ihren Wahr-Zweig
   verzweigt (kein Gate im engeren Sinn, da beide Zweige gültig fortsetzen),
   und **Teamdiagnose LLM**/**Spielerprofil LLM** laufen jeweils über ihren
   Erfolgs-Output.
   **Ausgeführt (gezielte Node.js-Verifikation der geänderten Nodes):** der
   frühere Offline-Simulator für den kompletten Hauptworkflow
   (`n8n/data/simulate_main_workflow.js`) ist mit der Umstellung der
   Analytics-Subworkflows auf die persistente Data Table
   `football_scouting_raw` (siehe [`n8n/data/README.md`](./data/README.md))
   entfallen — er beruhte auf dem inzwischen ebenfalls entfernten,
   fünf Vereine umfassenden CSV-Prototyp und ist für die reale Datenquelle
   nicht mehr repräsentativ. Stattdessen wurden die für diese Story
   geänderten Code-Nodes isoliert mit Node.js gegen den echten n8n-2.35.7-
   Vertrag (Structured-Output-Felder direkt auf `$json`, siehe 11./17. oben)
   verifiziert: **Teamdiagnose zusammenführen** und **Spielerprofil
   zusammenführen** lesen die simulierte LLM-Antwort korrekt ohne
   `output`-Hülle und holen das Vor-LLM-Item über `.first()` statt über das
   `pairedItem`-abhängige `.item` zurück (gegen einen `$()`-Mock verifiziert,
   der bewusst nur `.first()` implementiert, sodass ein verbliebener
   `.item`-Zugriff sofort fehlschlagen würde); **Teamdiagnose zusammenführen**
   verwirft dabei außerdem eine erfundene LLM-Ligaplatzierung zugunsten des
   deterministischen `leagueComparisonAvailable: false`-Vertrags;
   **Teamdiagnose: Datengrundlage prüfen** liefert `valid: false` für
   `diagnosisCategory: 'no_data'` und `valid: true` für
   `'defensive'`/`'offensive'`/`'neutral'`; **Spielerprofil prüfen** akzeptiert
   strukturierte `constraints` (`{ field, operator, value }`) und lehnt
   unstrukturierte (z. B. freitextliche) Constraints ab; **Spielersuche
   prüfen** liefert `valid: false`, sobald `playerRanking.ignoredConstraints`
   nichtleer ist, und `valid: true`, wenn keine Constraints ignoriert wurden.
   Für das neue Human-Review-Gate: `node
   n8n/data/verify-scouting-brief-review.js` (grün) verifiziert isoliert die
   drei zugehörigen Code-Nodes 1:1 aus ihrem `jsCode`-Inhalt — **Scouting
   Brief erstellen** setzt `reviewRound: 1` mit leerer `feedbackHistory` im
   Erstlauf und übernimmt in Folgerunden das Feedback der Vorrunde korrekt in
   die Historie; **Scouting Brief prüfen** liefert `valid: false` bei einem
   fehlenden Pflichtfeld; **Review-Entscheidung auswerten** liefert
   `valid: false` für eine unbekannte Entscheidung sowie für `Request Changes`
   ohne Feedback-Text, setzt `reviewOutcome` korrekt für `Approve`/`Reject`,
   und erzwingt nach drei erreichten Überarbeitungsrunden `reviewOutcome:
   'Reject'` (`maxRoundsReached: true`) statt eine vierte `Request
   Changes`-Runde zuzulassen; zusätzlich verifiziert dieselbe Datei, dass ein
   konkretes Reviewer-Alters-/Budgetlimit aus `reviewFeedback` (z. B. „max.
   10 Mio. Marktwert“) — simuliert über die dadurch ausgelöste
   **Spielerprofil LLM**-Folgerunde — unverändert in
   `playerProfile.constraints` und von dort in `scoutingBrief.constraints`
   der Folgerunde landet und ein gültiges Brief ergibt, statt am
   ursprünglichen Widerspruch zwischen der `additionalContext`- und der
   `reviewFeedback`-Instruktion im Prompt zu scheitern (siehe 15. oben).
   Zusätzlich:
   `node n8n/data/verify-import-architecture.js` (grün) sowie eine
   Konsistenzprüfung aller `n8n/*.json`-Workflow-Dateien (gültiges JSON, keine
   doppelten Node-Namen/-IDs, alle Connections referenzieren existierende
   Nodes, genau ein Trigger-Node). Nicht ausgeführt: ein vollständiger
   End-to-End-Lauf des Hauptworkflows (inkl. Formular-/Completion-Seiten, dem
   n8n-**Executions**-Eintrag und einem echten Aufruf des lokalen
   Ollama-Modells), da dafür eine laufende n8n-Weboberfläche mit
   erreichbarem Ollama-Endpunkt nötig ist — offen für die nächste Person
   (oder Session) mit interaktivem Zugriff auf eine importierte Instanz mit
   bereits über `import-scouting-data.json` importierten Originaldaten.

### Player-Ranking-Subworkflow: gezielte Tests

Die Constraint-Filterung (`field`/`operator`/`value`, siehe
[CSV-Analytics-Adapter](#csv-analytics-adapter), Player-Ranking) wurde isoliert
mit Node.js gegen einen synthetischen Spieler-Pool verifiziert: ein
`maxAge`-Constraint schließt ältere Kandidaten korrekt aus (`excludedByConstraints`
zählt sie), ein `maxMarketValueMEUR`-Constraint filtert nach Marktwert, ein
Constraint auf ein nicht verfügbares Feld landet unverändert in
`ignoredConstraints` statt den Lauf abzubrechen, ein Aufruf ganz ohne
`constraints` bleibt abwärtskompatibel unverändert, und ein Constraint, der den
gesamten Pool ausschließt, liefert korrekt `dataAvailable: false` statt leerer
oder erfundener Kandidaten. `node n8n/data/verify-import-architecture.js`
bestätigt zusätzlich weiterhin, dass die vier Analytics-Subworkflows
ausschließlich aus `football_scouting_raw` lesen und keine eingebetteten
CSV-Fixtures mehr enthalten.

Zusätzlich isoliert gegen die extrahierten `norm()`/`posMatch()`-Funktionen
verifiziert (**Linksaußen-Negativtest**, behebt einen Bug, bei dem `ß` von der
alten Normalisierung ersatzlos entfernt statt zu `ss` transliteriert wurde):
`norm('Linksaußen')` liefert jetzt `'linksaussen'` (vorher `'linksauen'`, was
gegen das hartkodierte `'linksaussen'` in `posMatch()` nie gematcht hätte) und
`posMatch('FW', 'Linksaußen')` liefert `true`, sodass eine angeforderte
Linksaußen-Position korrekt der `FW`-Gruppe zugeordnet wird statt in den
ungefilterten Fallback zu laufen.

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
3a. **Spielersuche gültig?** (ignoriertes Constraint) — `playerRanking.ignoredConstraints`
   auf `[{ field: 'marketValueMEUR', operator: 'max', value: 5 }]` setzen,
   während `playerSearch.shortlist` ansonsten gültig bleibt. **Erwartet:**
   **Spielersuche prüfen** setzt trotz gültiger Shortlist `valid: false` mit
   einer Fehlermeldung, die `ignoredConstraints` nennt — ein nicht
   angewendetes Constraint darf keine Empfehlung erreichen.
3b. **Spielersuche gültig?** (ignoriertes Kriterium) — `playerRanking.ignoredCriteria`
   auf `['rating']` setzen, während `playerSearch.shortlist` ansonsten
   gültig bleibt. **Erwartet:** **Spielersuche prüfen** setzt trotz gültiger
   Shortlist `valid: false` mit einer Fehlermeldung, die `ignoredCriteria`
   nennt — ein vom Spielerprofil gewichtetes, aber nicht numerisch
   verfügbares Kriterium darf nicht still durch Default-Kriterien ersetzt
   werden, ohne dass das die Pipeline stoppt.
3c. **Spielersuche gültig?** (Positions-Fallback) — `playerRanking.positionFallbackApplied`
   auf `true` setzen, während `playerSearch.shortlist` ansonsten gültig
   bleibt. **Erwartet:** **Spielersuche prüfen** setzt trotz gültiger
   Shortlist `valid: false` mit einer Fehlermeldung, die
   `positionFallbackApplied` nennt — ein kompletter Rückfall auf den
   ungefilterten Pool darf keine Empfehlung außerhalb der angeforderten
   Position erreichen.
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
8. **Spielerprofil gültig?** (Positions-/Diagnose-Konsistenz) —
   **Spielerprofil LLM** liefert eine `position` außerhalb des durch
   `teamDiagnosis.diagnosisCategory` vorgegebenen Pools (z. B. eine
   offensive Position bei einer Defensivdiagnose). **Erwartet:**
   **Spielerprofil prüfen** erkennt dies über die generische
   Konsistenzprüfung (unabhängig vom an sich schema-gültigen
   Parser-Output) und setzt `valid: false` mit einer Fehlermeldung, die die
   inkonsistente Position und die erwartete Diagnosekategorie benennt.
9. **Teamdiagnose: Datengrundlage ausreichend?** (`no_data` stoppt kontrolliert) —
   `teamDiagnosis.diagnosisCategory` auf `'no_data'` setzen (z. B. ein Verein
   ohne importierte Match-Daten). **Erwartet:** **Teamdiagnose: Datengrundlage
   prüfen** setzt `valid: false`, **Spielerprofil: Positionspool ermitteln**
   sowie alle nachfolgenden Stufen (Spielerprofil-LLM, Player-Ranking,
   Spielersuche, Recherche, Empfehlung) werden **nicht** mehr erreicht,
   stattdessen zeigt **Fehler anzeigen** einen expliziten Hinweis auf die
   fehlende Datengrundlage statt eine Transfermaßnahme auf Basis eines
   beliebigen Positionspools zu erzeugen.
10. **Scouting Brief gültig?** — `playerProfile.reasoning` vor **Scouting
    Brief erstellen** entfernen (bzw. eine leere `weightedCriteria`-Liste
    setzen). **Erwartet:** **Scouting Brief prüfen** setzt `valid: false`,
    die Anzeige zeigt "Das Scouting Brief ist ungültig …" statt der
    Freigabeseite.
11. **Review-Entscheidung gültig?** (Request Changes ohne Feedback) — im
    Formular **Scouting Brief zur Freigabe vorlegen** `Entscheidung` =
    `Request Changes` waehlen und `Feedback` leer lassen. **Erwartet:**
    **Review-Entscheidung auswerten** setzt `valid: false` mit einer
    Fehlermeldung, die einen erforderlichen Feedback-Text nennt; die
    Kandidatensuche stoppt kontrolliert über **Fehler anzeigen**, statt eine
    leere Überarbeitung anzustoßen.
12. **Review: Request Changes?** (begrenzter Feedback-Loop) — im Formular
    dreimal hintereinander `Request Changes` mit nichtleerem Feedback waehlen.
    **Erwartet:** die ersten beiden Runden erzeugen über **Spielerprofil
    LLM** (mit `reviewFeedback` im Prompt) ein erneut vorgelegtes,
    überarbeitetes Scouting Brief (`reviewRound` 2, dann 3) mit der
    bisherigen Feedback-Historie sichtbar in `formDescription`; bei der
    dritten `Request Changes`-Entscheidung (auf bereits erreichter
    `maxReviewRounds: 3`) setzt **Review-Entscheidung auswerten**
    `maxRoundsReached: true` und `reviewOutcome: 'Reject'`, sodass **Scouting
    Brief: Ablehnung dokumentieren** die Kandidatensuche kontrolliert über
    **Fehler anzeigen** beendet, statt eine vierte Überarbeitung zuzulassen.
13. **Review: Approve?** (Reject) — im Formular `Entscheidung` = `Reject`
    waehlen. **Erwartet:** **Scouting Brief: Ablehnung dokumentieren**
    formuliert eine `errorMessage`, die auf die Ablehnung durch den Reviewer
    hinweist (inkl. eines evtl. angegebenen Feedbacks), und die Anzeige zeigt
    diese über **Fehler anzeigen** statt einer Empfehlung — keine der
    nachfolgenden Stufen (Player-Ranking, Spielersuche, Recherche,
    Empfehlung) wird erreicht.
14. **Review: Request Changes?** (Reviewer-Alters-/Budgetlimit wird wirksam) —
    im Formular **Scouting Brief zur Freigabe vorlegen** `Entscheidung` =
    `Request Changes` waehlen und im `Feedback`-Feld ein konkretes Limit ohne
    Bezug zum urspruenglichen `additionalContext` angeben (z. B. „bitte nur
    Kandidaten unter 10 Mio. Marktwert vorschlagen“). **Erwartet:** die
    Folgerunde von **Spielerprofil LLM** liefert ein `playerProfile.constraints`
    mit genau diesem Limit (`{ field: 'marketValueMEUR', operator: 'max',
    value: 10 }`), **Scouting Brief erstellen** übernimmt es unverändert in
    `scoutingBrief.constraints` der Folgerunde, und nach **Approve** wendet
    **Player-Ranking-Anfrage vorbereiten**/der Player-Ranking-Subworkflow es
    tatsächlich an (`appliedConstraints` enthält es, `ignoredConstraints`
    bleibt leer) — das vom Reviewer genannte Limit darf nicht folgenlos
    bleiben, nur weil es nicht aus `additionalContext`, sondern aus
    `reviewFeedback` stammt.

**Ausgeführt (gezielte Node.js-Verifikation):** Fälle 1–8 wurden bereits vor
dieser Story mit dem inzwischen entfernten Offline-Simulator gegen die
HSV-Beispieldaten durchgespielt (siehe oben, Abschnitt „Positiver Testfall“,
zur Ablösung dieses Simulators); Fall 9 wurde isoliert mit Node.js gegen
**Teamdiagnose: Datengrundlage prüfen** verifiziert (`valid: false` für
`diagnosisCategory: 'no_data'`, `valid: true` für `'defensive'`); die Fälle
10–12 wurden isoliert mit Node.js gegen die 1:1 aus `ai-sporting-director.json`
übernommenen Funktionen in `n8n/data/verify-scouting-brief-review.js`
verifiziert (siehe oben, Abschnitt "Positiver Testfall"); Fall 13 (Reject)
teilt sich denselben `evaluateReview`-Codepfad wie Fall 12 und wurde dort mit
verifiziert (`reviewOutcome: 'Reject'` bei direkter Reject-Entscheidung ohne
`maxRoundsReached`); Fall 14 (Reviewer-Alters-/Budgetlimit) wurde für den Teil
bis einschließlich `scoutingBrief.constraints` ebenfalls isoliert mit Node.js
in `n8n/data/verify-scouting-brief-review.js` verifiziert (siehe oben) — der
Teil ab **Player-Ranking-Anfrage vorbereiten** deckt sich mit der bereits
bestehenden, isolierten Constraint-Filterung des Player-Ranking-Subworkflows
(siehe unten, Abschnitt „Player-Ranking-Subworkflow: gezielte Tests“) und
wurde nicht erneut end-to-end durchgespielt. Nicht ausgeführt: das manuelle
Editieren der Nodes bzw. Ausfüllen des Freigabe-Formulars und Beobachten der
**Executions**-Liste in einer laufenden n8n-Instanz — offen für die nächste
Person (oder Session) mit
interaktivem Zugriff.

### Negativer Testfall (Validierung des Startformulars)

Unverändert gegenüber dem bisherigen Workflow: leeres/nur aus Leerzeichen
bestehendes `objective` per direktem HTTP-Request (z. B. `curl`) einreichen.
**Erwartet:** **Eingabe validieren** routet zu **Validierungsfehler
formulieren** → **Fehler anzeigen** mit der Meldung, `Verein` und die
Zielsetzung auszufüllen — keine Dummy-Diagnose oder -Empfehlung wird
angezeigt.

### Regressionstest: Hauptworkflow funktioniert allein (Importtest)

Der Hauptworkflow bleibt die einzige n8n-Workflow-Datei, die die HSV-Formular-
Story trägt; die fünf technischen Subworkflow-Dateien (Recherche + die vier
CSV-Analytics-Tools) sind die einzigen weiteren Dateien. Beim Import (die
fünf Subworkflows zuerst, `n8n/ai-sporting-director.json` danach, siehe
[Import & run](#import--run)) öffnet sich der Hauptworkflow mit allen 50 hier
beschriebenen Nodes, inklusive der jetzt verbundenen **Ollama Modell
(Qwen3.8:latest)**- und **LLM-Fehler normalisieren**-Nodes (siehe die beiden
folgenden Regressionstests); jeder der fünf Subworkflows öffnet sich mit
seinen zwei Nodes (Trigger + Code).
Alle sechs Workflow-Dateien wurden außerhalb von n8n als wohlgeformtes JSON
mit eindeutigen Node-Namen/-IDs, Connections, die ausschließlich existierende
Nodes referenzieren, jeweils genau einem erwarteten Trigger-Node (Form
Trigger bzw. Execute Workflow Trigger) und ohne Klartext-Credential- oder
-Workflow-ID (außer den dokumentierten Platzhaltern/festen Subworkflow-IDs)
geprüft (`python3` JSON-Konsistenzcheck, siehe Commit-Historie).
**Nicht ausgeführt:** der tatsächliche Import in eine laufende n8n-Instanz —
offen für die nächste Person (oder Session) mit interaktivem Zugriff.

### Regressionstest: aktiver Ollama-Node

1. Open the imported main workflow and select the **Ollama Modell
   (Qwen3.8:latest)** node.
   **Expected result:** the model field shows `Qwen3.8:latest`, **Options →
   Think** is enabled, and **Credential to connect with** references
   `[cimt] Ollama` (select the existing local credential here — the import
   cannot resolve the instance-specific credential ID automatically).
2. **Expected result:** the node now has two outgoing `ai_languageModel`
   connections — to **Teamdiagnose LLM** and to **Spielerprofil LLM** — and
   still no incoming connection (language-model sub-nodes are only ever a
   connection source, never a `main`-flow target). Running the positive test
   case above therefore requires a real, reachable local Ollama instance
   with the referenced credential configured; without one, both LLM chain
   nodes fail and the execution ends on **Fehler anzeigen** via **LLM-Fehler
   normalisieren** (see below) instead of on **Ergebnis anzeigen**.

### Regressionstest: aktive Fehler-Normalisierung

1. Open the imported main workflow and select the **LLM-Fehler
   normalisieren** node.
   **Expected result:** the node is a Code node connected to **Fehler
   anzeigen** as its only output, and now has two incoming connections — the
   error output (`onError: continueErrorOutput`) of **Teamdiagnose LLM** and
   of **Spielerprofil LLM** — so it runs whenever either chain fails (e.g.
   Ollama not reachable, or the model's answer fails the connected
   Structured Output Parser's schema).
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
diesem Repository; `recherche-subworkflow.json` und die vier
`analytics-*-subworkflow.json`-Dateien des
[CSV-Analytics-Adapters](#csv-analytics-adapter) sind die einzigen erlaubten
Ausnahmen davon, jeweils als technischer, nicht-fachlicher Subworkflow.
