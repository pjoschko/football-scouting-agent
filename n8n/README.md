# AI Sporting Director (kanonischer Hauptworkflow)

Der kanonische Hauptworkflow für dieses Projekt heißt **`AI Sporting Director`**
und ist versioniert in [`ai-sporting-director.json`](./ai-sporting-director.json).
Jede weitere Story erweitert diesen bestehenden Workflow in-place. Es wird kein
neuer paralleler Hauptworkflow angelegt.

Seit der Restrukturierung „AI Sporting Director: Subworkflow-Restructuring"
zeigt der Hauptworkflow auf oberster Ebene **nur noch die fachlichen Phasen**
des Sporting-Director-Ablaufs plus das zentrale Routing/Review (Formulare,
Validierungs-/Review-Entscheidungen, der eine zentrale Fehlerpfad). Jede
fachliche Phase (Team analysieren, Scouting Brief erstellen, Kandidaten
suchen, Due Diligence, Empfehlung erstellen, Ergebnis aufbereiten) ist ein eigener,
in sich abgeschlossener **fachlicher Subworkflow** mit eigenen internen
Transformationen, Validierungen und Gates — der Hauptworkflow ruft sie über
je einen **Execute Workflow**-Node auf und hat danach genau **ein** `<Phase>
gültig?`-Gate, das bei `false` in den bestehenden zentralen Fehlerpfad
(**Fehler anzeigen**) routet. Technische Details (LLM-Prompting,
CSV-Analytics-Zugriff, feldweise Validierung) sind damit aus dem Hauptworkflow
verschwunden und nur noch beim Öffnen der jeweiligen Subworkflow-Datei
sichtbar — der Hauptworkflow selbst liest sich als Business-/Agentenprozess:
**Detect → Diagnose → Decide → Research → Act**.

Neben den sechs neuen fachlichen Subworkflows bleiben die bereits zuvor
existierenden **rein technischen, nicht-fachlichen** Subworkflows unverändert
bestehen (weiterhin über **Execute Workflow**-Nodes aufgerufen, jetzt aus den
fachlichen Subworkflows heraus statt direkt aus dem Hauptworkflow): die
Recherche-Stufe ([`recherche-subworkflow.json`](./recherche-subworkflow.json),
siehe [Recherche-Subworkflow](#recherche-subworkflow) unten) sowie die vier
CSV-Analytics-Tools des [CSV-Analytics-Adapters](#csv-analytics-adapter)
(`analytics-*-subworkflow.json`). Diese technischen Subworkflows bleiben
bewusst **stabil und unverändert** — dieselben Tool-Verträge
(`get_team_performance`, `get_team_matches`, `rank_players`,
`get_player_profile`), dieselben festen Top-Level-IDs, dieselbe interne
Logik — nur der aufrufende Node zog in eine andere Datei um.

Insgesamt gilt: **`ai-sporting-director.json`** ist der einzige Hauptworkflow
in diesem Repository. Alle übrigen `n8n/*.json`-Dateien sind Subworkflows,
entweder **fachlich** (`team-analysieren-subworkflow.json`,
`scouting-brief-subworkflow.json`, `kandidaten-suchen-subworkflow.json`,
`due-diligence-subworkflow.json`, `empfehlung-erstellen-subworkflow.json`,
`ergebnis-aufbereiten-subworkflow.json` —
je eine vollständige fachliche Fähigkeit inkl. eigener Validierung/
Fehlerbehandlung) oder **technisch** (`recherche-subworkflow.json`, die vier
`analytics-*-subworkflow.json`) — bewusst **keine** Zwischengröße: kein
Subworkflow kapselt nur eine einzelne Validierung/Zuordnung/Berechnung, jeder
steht entweder für eine ganze fachliche Fähigkeit oder für eine bewusst
austauschbare technische Schnittstelle (analog zum CSV-Analytics-Adapter als
Platzhalter für die künftige Qlik-MCP-Anbindung).

**Teamdiagnose** und **Spielerprofil** werden weiterhin nicht
deterministisch/simuliert erzeugt, sondern von einem echten lokalen LLM
(**Ollama Modell (Qwen3.8:latest)**, angesprochen über je eine **Basic LLM
Chain** mit **Structured Output Parser**) interpretiert: **Teamdiagnose**
greift dafür über den [CSV-Analytics-Adapter](#csv-analytics-adapter) auf
echte, versionierte Referenzdaten zu (temporärer Ersatz für die künftige
Qlik-/MCP-Anbindung, noch keine echte Websuche) und lässt deren Kennzahlen vom
LLM fachlich interpretieren (Hypothesen, Ligavergleich, Hauptproblem,
Gegenhypothesen, Unsicherheiten), ohne die Kennzahlen selbst zu erfinden;
**Spielerprofil** leitet aus dieser LLM-Teamdiagnose ein strukturiertes
Anforderungsprofil ab. **Spielersuche** greift ebenfalls über den
CSV-Analytics-Adapter auf echte Daten zu (weiterhin deterministisch
ausgewertet, siehe unten). Nur **Recherche** bleibt ein deterministischer,
sichtbar als Simulation gekennzeichneter Dummy, da hierfür noch keine reale
Implementierung möglich ist. Zwischen **Spielerprofil** und **Spielersuche**
steht ein echtes **Human-Review-Gate** (siehe
[Scouting Brief Human-Review](#scouting-brief-human-review) unten): ein
Mensch prüft ein aus **Teamdiagnose** und **Spielerprofil** abgeleitetes
**Scouting Brief** und kann es **Approve**, **Request Changes** (mit
Freitext-Feedback, das über **Spielerprofil LLM** in eine Überarbeitung
einfließt) oder **Reject** entscheiden; nur **Approve** setzt den
Hauptworkflow fort.

Weil ein n8n-Formular (Form Trigger/Form-Seiten) an die Browser-Session
gebunden ist, in der es geöffnet wurde, **kann** dieses Human-Review-Gate
nicht in einen Subworkflow ausgelagert werden — es bleibt bewusst im
Hauptworkflow als Teil des erlaubten „zentralen Routings/Reviews" (siehe
[Human Review bleibt im Hauptworkflow](#human-review-bleibt-im-hauptworkflow)
unten).

Credentials werden ausschließlich referenziert (`[cimt] Ollama` an den beiden
Nodes **Ollama Modell (Qwen3.8:latest)** in `team-analysieren-subworkflow.json`
und `scouting-brief-subworkflow.json`, mit dem Platzhalter-Wert
`REPLACE_WITH_LOCAL_CREDENTIAL_ID` statt einer echten Credential-ID), nie
exportiert oder dupliziert. Alle Subworkflows werden über ihre feste
Top-Level-ID referenziert; n8n übernimmt diese ID beim Import
(`import:workflow`) per Upsert unverändert, sodass nach dem Import (siehe
[Import & run](#import--run)) alle Workflow-Dateien ohne manuelle Anpassung
verbunden sind. Es gelangt kein echtes Secret nach Git.

## Zielablauf

Oberste Ebene des Hauptworkflows (fachliche Phasen plus zentrales
Routing/Review):

```
Start (Formular)
  → Team analysieren            [Execute Workflow] → Team analysieren gültig?      --nein--> Fehler anzeigen
  → Scouting Brief erstellen    [Execute Workflow] → Scouting Brief gültig?        --nein--> Fehler anzeigen
  → Human Review (Form: Approve / Request Changes / Reject)
        --Request Changes--> zurück zu Scouting Brief erstellen (mit reviewFeedback)
        --Reject-----------> Fehler anzeigen
        --Approve-----------v
  → Kandidaten suchen            [Execute Workflow] → Kandidaten suchen gültig?      --nein--> Fehler anzeigen
  → Due Diligence                [Execute Workflow] → Due Diligence gültig?          --nein--> Fehler anzeigen
  → Empfehlung erstellen         [Execute Workflow] → Empfehlung gültig?             --nein--> Fehler anzeigen
  → Ergebnis aufbereiten          [Execute Workflow] → Ergebnis aufbereiten gültig?  --nein--> Fehler anzeigen
  → Ergebnis anzeigen
```

Das liest sich fachlich als **Detect** (Team analysieren erkennt die
sportliche Lage) **→ Diagnose** (Scouting Brief erstellen leitet daraus einen
Bedarf ab) **→ Decide** (Human Review entscheidet über die Freigabe) **→
Research** (Kandidaten suchen + Due Diligence) **→ Act** (Empfehlung
erstellen).

Innerhalb jeder fachlichen Phase läuft weiterhin dieselbe interne
Gate-Kette wie zuvor (`<Stufe> erzeugen/durchführen` → `<Stufe> prüfen` →
`<Stufe> gültig?`), nur dass ein internes `false` jetzt **nicht** mehr direkt
zu **Fehler anzeigen** springt (das ist ein Form-Node und kann nicht
innerhalb eines Subworkflows liegen), sondern in einen konsolidierten,
lokalen **Phase-Ergebnis**-Knoten (`NoOp`) mündet, der `{ ...item, valid,
errorMessage }` an den Hauptworkflow zurückgibt. Der Hauptworkflow prüft
dieses `valid` danach mit **genau einem** `<Phase> gültig?`-Gate und routet
bei `false` in den weiterhin einzigen zentralen Fehlerpfad **Fehler
anzeigen**. Siehe die Abschnitte je Subworkflow unten für die jeweilige
interne Gate-Kette.

## Hauptworkflow (`ai-sporting-director.json`, 24 Nodes)

1. **AI Sporting Director beauftragen** (Form Trigger) — unverändert:
   Formular mit `Verein` (Dropdown, alle 18 Bundesliga-Vereine der Saison
   2025/26, `FC Bayern München` vorausgewählt), `Was soll der Sporting
   Director untersuchen?` (Pflichtfeld, vereinsoffener Default-Auftrag ohne
   fest verdrahteten Verein, Position oder Problemdiagnose) und optionalem
   `Gibt es zusätzliche Rahmenbedingungen oder Beobachtungen?`.
2. **Auftrag normalisieren** (Code, `runOnceForEachItem`) — unverändert:
   normalisiert die Formularausgabe zu `club`, `clubPlayerData`, `objective`,
   `additionalContext`, `requestId`, `requestedAt`. Gibt dafür pro Item ein
   einzelnes `{ json: ... }`-Objekt zurück (kein Array) — gegen exakt n8n
   **2.35.7** verifiziert: bei `runOnceForEachItem` verwirft
   `validateRunCodeEachItem()` ein Array-Ergebnis mit `Code doesn't return a
   single object`. Bildet die Dropdown-Auswahl über zwei zentrale Maps
   eindeutig auf die kanonischen Team-Identifier der Analytics-Schicht ab
   (`CLUB_CANONICAL_MAP` → `club`, `CLUB_PLAYER_DATA_MAP` → `clubPlayerData`
   — siehe die ausführliche Begründung für die zwei getrennten Maps im
   Node-Kommentar bzw. `n8n/data/verify-club-canonical-map.js`, das
   automatisiert alle 18 Dropdown-Vereine gegen beide CSV-Identifier sowie
   den Rückgabevertrag des Nodes verifiziert). Diese Zuordnungen bleiben
   bewusst zentral in diesem einen Hauptworkflow-Node und werden in keinem
   Subworkflow dupliziert.
3. **Eingabe validieren** (IF) — unverändert: lehnt fehlende oder nur aus
   Leerzeichen bestehende Werte für `club`/`objective` ab.
   - **falsch** → **Validierungsfehler formulieren** (Set, unverändert) →
     **Fehler anzeigen**.
   - **wahr** → weiter zu **Execute Workflow: Team analysieren**.
4. **Execute Workflow: Team analysieren** (Execute Workflow) — ruft den
   fachlichen Subworkflow
   [`team-analysieren-subworkflow.json`](./team-analysieren-subworkflow.json)
   über dessen feste Top-Level-ID `25aeb354-a18e-4e44-b0a1-c3a7c546b19f` auf
   (siehe [Team analysieren](#team-analysieren-subworkflow) unten). Reichert
   das Item um `teamDiagnosis` sowie `valid`/`errorMessage` an.
5. **Team analysieren gültig?** (IF, prüft `$json.valid`) — **falsch** →
   **Fehler anzeigen**; **wahr** → **Execute Workflow: Scouting Brief
   erstellen**.
6. **Execute Workflow: Scouting Brief erstellen** (Execute Workflow) — ruft
   den fachlichen Subworkflow
   [`scouting-brief-subworkflow.json`](./scouting-brief-subworkflow.json)
   über dessen feste Top-Level-ID `85a4c672-5c35-4543-98ee-1f877f955593` auf
   (siehe [Scouting Brief erstellen](#scouting-brief-erstellen-subworkflow)
   unten). Reichert das Item um `playerProfile`, `scoutingBrief` sowie
   `valid`/`errorMessage` an. **Derselbe Node** wird bei einer **Request
   Changes**-Entscheidung im Human Review (13.) erneut aufgerufen, mit
   `item.reviewFeedback` gesetzt — der Subworkflow unterstützt das über
   seinen `inputSource: passthrough`-Trigger, der bei jedem Aufruf einfach
   das aktuell übergebene Item entgegennimmt, unabhängig davon, wie oft er in
   derselben Hauptworkflow-Ausführung aufgerufen wird.
7. **Scouting Brief gültig?** (IF, prüft `$json.valid`) — **falsch** →
   **Fehler anzeigen**; **wahr** → **Scouting Brief zur Freigabe vorlegen**.
8. – 13. **Human Review** — siehe eigener Abschnitt
   [Human Review bleibt im Hauptworkflow](#human-review-bleibt-im-hauptworkflow)
   unten.
14. **Execute Workflow: Kandidaten suchen** (Execute Workflow) — ruft den
    fachlichen Subworkflow
    [`kandidaten-suchen-subworkflow.json`](./kandidaten-suchen-subworkflow.json)
    über dessen feste Top-Level-ID `803a06a1-fb4b-4cb7-b502-63ab119c9996` auf
    (siehe [Kandidaten suchen](#kandidaten-suchen-subworkflow) unten).
    Erreicht wird dieser Node nur über den **Approve**-Zweig des Human
    Review. Reichert das Item um `playerRanking`, `playerSearch` sowie
    `valid`/`errorMessage` an.
15. **Kandidaten suchen gültig?** (IF, prüft `$json.valid`) — **falsch** →
    **Fehler anzeigen**; **wahr** → **Execute Workflow: Due Diligence**.
16. **Execute Workflow: Due Diligence** (Execute Workflow) — ruft den
    fachlichen Subworkflow
    [`due-diligence-subworkflow.json`](./due-diligence-subworkflow.json) über
    dessen feste Top-Level-ID `c2ffe3ab-e97a-4147-83a8-4fbd1b87eae6` auf
    (siehe [Due Diligence](#due-diligence-subworkflow) unten). Reichert das
    Item um `research` sowie `valid`/`errorMessage` an.
17. **Due Diligence gültig?** (IF, prüft `$json.valid`) — **falsch** →
    **Fehler anzeigen**; **wahr** → **Execute Workflow: Empfehlung
    erstellen**.
18. **Execute Workflow: Empfehlung erstellen** (Execute Workflow) — ruft den
    fachlichen Subworkflow
    [`empfehlung-erstellen-subworkflow.json`](./empfehlung-erstellen-subworkflow.json)
    über dessen feste Top-Level-ID `7e29c7d7-ef3b-488c-9d1e-2fdd4dad6bf1` auf
    (siehe [Empfehlung erstellen](#empfehlung-erstellen-subworkflow) unten).
    Reichert das Item um `recommendation` sowie `valid`/`errorMessage` an.
19. **Empfehlung gültig?** (IF, prüft `$json.valid`) — **falsch** →
    **Fehler anzeigen**; **wahr** → **Execute Workflow: Ergebnis
    aufbereiten**.
20. **Execute Workflow: Ergebnis aufbereiten** (Execute Workflow) — ruft den
    fachlichen Subworkflow
    [`ergebnis-aufbereiten-subworkflow.json`](./ergebnis-aufbereiten-subworkflow.json)
    über dessen feste Top-Level-ID `6306c333-15f1-48ed-a006-0d2812a9c7a7` auf
    (siehe [Ergebnis aufbereiten](#ergebnis-aufbereiten-subworkflow) unten).
    Kapselt die abschließende, phasenübergreifende Gesamtvalidierung (Final
    Validation) sowie die Praesentationsaufbereitung (`formattedResult`);
    liefert bei Erfolg `formattedResult`, sonst nur `valid: false` +
    `errorMessage` zurück. Der Hauptworkflow selbst enthält damit keine
    technische Präsentationslogik mehr.
21. **Ergebnis aufbereiten gültig?** (IF, prüft `$json.valid`) — **falsch** →
    **Fehler anzeigen**; **wahr** → **Ergebnis anzeigen**.
22. **Ergebnis anzeigen** (Form, Completion) — unverändert: zeigt
    `formattedResult` an.
23. **Fehler anzeigen** (Form, Completion) — unverändert der eine zentrale
    Fehlerpfad für **alle** Gates: die eingangs- und Human-Review-Gates des
    Hauptworkflows selbst (**Eingabe validieren**, **Review-Entscheidung
    gültig?**, ein **Reject**/ausgeschöpfter Review-Loop über **Scouting
    Brief: Ablehnung dokumentieren**) sowie die sechs neuen
    `<Phase> gültig?`-Gates nach jedem Execute-Workflow-Aufruf (**Team
    analysieren gültig?**, **Scouting Brief gültig?**, **Kandidaten suchen
    gültig?**, **Due Diligence gültig?**, **Empfehlung gültig?**, **Ergebnis
    aufbereiten gültig?**): zeigt `errorMessage` an; ein ungültiges Ergebnis
    wird nie als fachliche Empfehlung dargestellt.

Nodes 4./15./17./19./20. tragen jeweils die technische Bezeichnung `Execute
Workflow: <Phase>` statt des reinen Phasennamens, um sie im n8n-Editor
eindeutig vom internen `<Stufe> gültig?`-Gate desselben Subworkflows zu
unterscheiden (z. B. gibt es sowohl ein Hauptworkflow-Gate **Scouting Brief
gültig?** als auch ein gleichnamiges, aber unabhängiges internes Gate in
`scouting-brief-subworkflow.json` — beide prüfen `valid`, aber an
unterschiedlichen Stellen der Pipeline und in unterschiedlichen Dateien).

## Human Review bleibt im Hauptworkflow

n8n-Formulare (Form Trigger und nachfolgende Form-Seiten desselben
mehrseitigen Formulars) sind an die Browser-Session gebunden, in der das
Formular geöffnet wurde — ein Form-Node kann deshalb nicht innerhalb eines
per Execute-Workflow aufgerufenen Subworkflows liegen (dessen Ausführung
läuft nicht in derselben Browser-Session). Das Human-Review-Gate bleibt daher
bewusst **im Hauptworkflow** als Teil des erlaubten „zentralen
Routings/Reviews", nicht als eigener Subworkflow:

8. **Scouting Brief zur Freigabe vorlegen** (`n8n-nodes-base.form`, ohne
   `operation: "completion"`, d. h. eine zusätzliche Formularseite innerhalb
   desselben mehrstufigen Formulars wie **AI Sporting Director beauftragen**,
   nicht dessen Abschluss) — zeigt `scoutingBrief` (Hauptproblem,
   Zielposition, Rolle, Begründung, gewichtete Kriterien, Constraints,
   Unsicherheiten) **vollständig und editierbar** im Formular an: jedes
   dieser Felder ist ein eigenes Formularfeld (`text`/`textarea`), dessen
   `defaultValue` per Ausdruck (`={{ $json.scoutingBrief.<feld> }}`) mit dem
   von der KI erzeugten Inhalt vorausgefüllt wird — die Array-Felder
   (gewichtete Kriterien, Constraints, Unsicherheiten) werden dabei als
   JSON-Array-Text vorausgefüllt. Der Reviewer kann jedes dieser Felder vor
   dem Absenden frei bearbeiten; ohne Bearbeitung werden die vorausgefüllten
   KI-Werte unverändert übernommen. Danach folgen wie zuvor zwei weitere
   Eingabefelder: `Entscheidung` (Dropdown, Pflichtfeld, Optionen
   `Approve`/`Request Changes`/`Reject`) und `Feedback (Pflicht bei Request
   Changes)` (Textarea, im Formular selbst nicht als Pflichtfeld hinterlegt —
   die eigentliche Pflicht bei `Request Changes` erzwingt der nachfolgende
   Code-Node). Pausiert die Workflow-Ausführung, bis ein Mensch das Formular
   absendet.
9. **Review-Entscheidung auswerten** (Code) — liest `$json['Entscheidung']`,
   `$json['Feedback (Pflicht bei Request Changes)']` sowie die editierbaren
   Brief-Felder (`Hauptproblem (Diagnose)`, `Zielposition`, `Rolle`,
   `Begruendung`, sowie die drei JSON-Array-Felder für gewichtete Kriterien,
   Constraints und Unsicherheiten) aus der Formulareingabe und holt das
   vollständige Item vor der Formularseite über
   `$('Execute Workflow: Scouting Brief erstellen').first().json` zurück
   (bewusst defensiv wie bei den LLM-Chain-Knoten in den Subworkflows,
   unabhängig davon, ob der Form-Node selbst bereits alle Felder
   durchreicht — dieser Rückgriff musste bei der Restrukturierung angepasst
   werden: er zeigte zuvor auf den Code-Node **Scouting Brief erstellen**,
   der jetzt innerhalb von `scouting-brief-subworkflow.json` liegt und aus
   dem Hauptworkflow heraus nicht mehr per `$()` adressierbar ist; der
   Execute-Workflow-Aufrufknoten selbst liefert dasselbe vollständige Item
   zurück). Validiert, dass `Entscheidung` einer von `Approve`/`Request
   Changes`/`Reject` ist, dass bei `Request Changes` ein nichtleeres Feedback
   vorliegt, dass die Text-Felder (`Hauptproblem`, `Zielposition`, `Rolle`,
   `Begruendung`) nicht leer sind und dass die drei JSON-Array-Felder
   gültiges JSON (jeweils ein Array) enthalten; setzt `valid`/`errorMessage`.
   Baut bei gültiger Eingabe ein neues `scoutingBrief`-Objekt, das
   `reviewRound`/`maxReviewRounds`/`feedbackHistory` unverändert aus dem
   ursprünglichen `scoutingBrief` übernimmt, dessen Inhaltsfelder aber exakt
   den zuletzt im Formular sichtbaren (ggf. vom Reviewer bearbeiteten) Werten
   entsprechen — die ursprünglichen, unbearbeiteten KI-Werte überschreiben
   die Bearbeitung des Reviewers also nicht mehr. Erzwingt außerdem den
   **begrenzten** Feedback-Loop: ist `scoutingBrief.reviewRound` bereits
   `maxReviewRounds` (3) erreicht und die Entscheidung erneut `Request
   Changes`, wird `reviewOutcome` trotzdem auf `'Reject'` gesetzt
   (`maxRoundsReached: true`) statt eine vierte Überarbeitung zuzulassen —
   ansonsten entspricht `reviewOutcome` der eingegebenen `Entscheidung`.
10. **Review-Entscheidung gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Review: Approve?**.
11. **Review: Approve?** (IF, prüft `reviewOutcome === 'Approve'`) —
    **wahr** → **Execute Workflow: Kandidaten suchen** (derselbe
    Hauptworkflow läuft unverändert fort); **falsch** → **Review: Request
    Changes?**.
12. **Review: Request Changes?** (IF, prüft `reviewOutcome === 'Request
    Changes'`) — **wahr** → zurück zu **Execute Workflow: Scouting Brief
    erstellen** (erneuter Aufruf desselben fachlichen Subworkflows;
    `item.reviewFeedback` ist zu diesem Zeitpunkt bereits auf dem Item
    gesetzt und wird vom Subworkflow-Trigger unverändert durchgereicht, siehe
    6. oben und [Scouting Brief erstellen](#scouting-brief-erstellen-subworkflow)
    unten); **falsch** (d. h. `reviewOutcome === 'Reject'`, ob explizit oder
    weil `maxRoundsReached`) → **Scouting Brief: Ablehnung dokumentieren**.
13. **Scouting Brief: Ablehnung dokumentieren** (Code) — formuliert
    `errorMessage` mit dem Grund (`Reject` durch den Reviewer oder erreichte
    `maxReviewRounds`) und dem zuletzt gegebenen Feedback, läuft in den
    zentralen Fehlerpfad **Fehler anzeigen** — ein Reject beendet die
    Kandidatensuche damit kontrolliert, ohne eine Empfehlung zu erzeugen.

Position und Profil werden dabei weiterhin ausschließlich vom Agenten
hergeleitet — der Reviewer entscheidet nur über Freigabe, Überarbeitung oder
Ablehnung, gibt aber keine eigene Position/kein eigenes Profil vor.

## Team analysieren (Subworkflow)

[`team-analysieren-subworkflow.json`](./team-analysieren-subworkflow.json)
(feste Top-Level-ID `25aeb354-a18e-4e44-b0a1-c3a7c546b19f`, 16 Nodes) kapselt
die komplette Team-Analyse-Fähigkeit: CSV-Analytics-Abruf, die
LLM-Interpretation der Teamdiagnose inklusive eigener **Ollama
Modell**-/**LLM-Fehler normalisieren**-Instanz, und alle zugehörigen internen
Gates. Eingang (`inputSource: passthrough`): das vollständige Item aus dem
Hauptworkflow (`club`, `clubPlayerData`, `objective`, `additionalContext`,
…). Ausgang: dasselbe Item, angereichert um `teamDiagnosis` sowie
`valid`/`errorMessage`.

1. **Team-Performance abrufen** (Execute Workflow) — ruft den
   CSV-Analytics-Subworkflow
   [`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json)
   auf (Tool „Teamperformance", siehe [CSV-Analytics-Adapter](#csv-analytics-adapter))
   und reichert das Item um `teamPerformance` an.
2. **Team-Matches abrufen** (Execute Workflow) — ruft
   [`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json)
   auf (Tool „Team-Matches") und reichert das Item um `teamMatches` an.
3. **Teamdiagnose: Datenverfügbarkeit prüfen** (IF) — prüft
   `teamPerformance.dataAvailable`. **falsch** (kein CSV-Datensatz für den
   angefragten Verein) → **Teamdiagnose (keine Daten) erzeugen**; **wahr** →
   **Teamdiagnose: Evidenz aufbereiten**. Ohne Datengrundlage gibt es nichts,
   was ein LLM interpretieren könnte — dieser Fall bleibt deshalb bewusst
   deterministisch, ohne einen LLM-Aufruf auszulösen.
4. **Teamdiagnose (keine Daten) erzeugen** (Code) — deterministischer
   Ersatz-Zweig für einen unbekannten Verein: liefert
   `teamDiagnosis.dataAvailable: false`, `diagnosisCategory: 'no_data'` und
   einen expliziten Hinweis auf die fehlende Datengrundlage statt etwas zu
   erfinden. Läuft direkt weiter zu **Teamdiagnose prüfen**.
5. **Teamdiagnose: Evidenz aufbereiten** (Code) — deterministische
   Faktenextraktion aus `teamPerformance`/`teamMatches` (Bilanz, Form,
   Punkteschnitt, letzte Ergebnisse) in `teamDiagnosisEvidence`, bewusst
   **ohne** jede Interpretation (keine Hypothesen, kein Hauptproblem) — das
   übernimmt **Teamdiagnose LLM**. Diese Trennung stellt sicher, dass der
   spätere `teamDiagnosis.evidence`-Wert nachweisbar der reine, unveränderte
   CSV-Befund bleibt und nicht vom LLM mitgestaltet wird.
6. **Teamdiagnose LLM** (`@n8n/n8n-nodes-langchain.chainLlm`, Basic LLM
   Chain) — interpretiert `teamDiagnosisEvidence` sowie die Rohkennzahlen aus
   `teamPerformance`/`teamMatches` über **Ollama Modell (Qwen3.8:latest)**
   (`ai_languageModel`, eigene Node-Instanz dieser Datei) und liefert,
   erzwungen durch **Teamdiagnose Output-Schema** (`ai_outputParser`),
   `diagnosisCategory` (`'defensive'`/`'offensive'`/`'neutral'`),
   `leagueComparison`, `hypotheses`, `counterHypotheses`, `mainProblem` und
   `uncertainties` als strukturiertes JSON — ausdrücklich angewiesen,
   ausschließlich die gegebenen Fakten zu interpretieren, nichts zu erfinden
   und Unsicherheiten zu benennen; erfindet insbesondere keinen Ligavergleich
   (keine Platzierung, keinen Liga-Durchschnitt, keinen Vergleich zu
   konkreten anderen Vereinen), da dem LLM nur die Kennzahlen des
   betrachteten Vereins vorliegen. `onError: continueErrorOutput` leitet
   einen Fehler (z. B. Ollama nicht erreichbar) auf den zweiten Output an
   **LLM-Fehler normalisieren** statt den Workflow abzubrechen.
7. **Teamdiagnose Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
   — erzwingt (`schemaType: manual`) den unter 6. genannten JSON-Vertrag;
   `evidence` ist bewusst **nicht** Teil dieses Schemas (siehe 5.).
8. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model) — eigene
   Node-Instanz **dieser Datei** (technische Utility-Node, bewusst dupliziert
   statt geteilt, siehe Einleitung oben), versorgt **Teamdiagnose LLM** über
   `ai_languageModel`. Credential-Referenz `[cimt] Ollama`
   (`REPLACE_WITH_LOCAL_CREDENTIAL_ID`).
9. **LLM-Fehler normalisieren** (Code) — eigene Kopie **dieser Datei**:
   empfängt den Error-Output (`onError: continueErrorOutput`) von
   **Teamdiagnose LLM** und normalisiert ihn (String- oder Objekt-Fehler-
   Shape) zu `errorMessage`; setzt zusätzlich **`valid: false`** (Ergänzung
   gegenüber der Vor-Restrukturierungs-Fassung dieses Nodes: da diese Kopie
   nicht mehr direkt an **Fehler anzeigen** hängen kann, muss sie den
   konsolidierten Phase-Ergebnis-Vertrag dieser Datei selbst erfüllen) und
   läuft direkt in **Team analysieren: Ergebnis**.
10. **Teamdiagnose zusammenführen** (Code) — gegen n8n **2.35.7** verifiziert:
    die Basic LLM Chain (v1.6) setzt bei aktivem Output Parser
    `shouldUnwrapObjects = true`, wodurch die geparsten Structured-Output-
    Felder direkt als Node-JSON zurückkommen (`$json.diagnosisCategory` usw.,
    **nicht** `$json.output.diagnosisCategory`); der Rest des Items geht
    dabei trotzdem verloren. Dieser Node holt das vollständige Item über
    `$('Teamdiagnose: Evidenz aufbereiten').first().json` zurück (`.first()`
    statt `.item`, da die Chain auf dem Erfolgspfad kein `pairedItem`
    liefert) und baut `teamDiagnosis` aus dem deterministischen
    `teamDiagnosisEvidence` (→ `evidence`) und der LLM-Interpretation
    zusammen (`teamDiagnosis.simulated: false`, `dataAvailable: true`).
    Setzt `teamDiagnosis.leagueComparisonAvailable` **deterministisch im Code
    auf `false`** (dem LLM liegen nachweislich nie echte Liga-Vergleichsdaten
    vor) und verwirft dafür den LLM-Text in `leagueComparison` zugunsten
    eines festen, wahrheitsgemäßen Hinweises. Läuft anschließend in
    dieselbe **Teamdiagnose prüfen** wie der No-Data-Zweig.
11. **Teamdiagnose prüfen** (Code) — prüft, dass `evidence`/`hypotheses`
    nichtleere Arrays sind, `mainProblem` ein nichtleerer String ist,
    `uncertainties` ein Array ist, `leagueComparisonAvailable` ein boolean
    und `leagueComparison` ein nichtleerer String sowie `counterHypotheses`
    ein Array ist; setzt `valid`/`errorMessage`.
12. **Teamdiagnose gültig?** (IF) — **falsch** → **Team analysieren:
    Ergebnis** (statt wie vor der Restrukturierung direkt zu **Fehler
    anzeigen** — `valid: false` ist bereits gesetzt, der Hauptworkflow routet
    darüber über sein eigenes **Team analysieren gültig?**-Gate); **wahr** →
    **Teamdiagnose: Datengrundlage prüfen**.
13. **Teamdiagnose: Datengrundlage prüfen** (Code) — prüft, ob
    `teamDiagnosis.diagnosisCategory === 'no_data'`. Ohne diesen Stopp würde
    die nachfolgende Bedarfsermittlung (im Scouting-Brief-Subworkflow) auf
    den ungefilterten Positionspool zurückfallen und die Pipeline bis zur
    Empfehlung weiterlaufen lassen, obwohl keine belastbare Diagnose vorliegt
    — das widerspricht der Vorgabe, bei unzureichender Evidenz Unsicherheit
    auszuweisen bzw. weitere Analytics anzufordern statt sichere
    Folgeschlüsse zu erfinden. Setzt `valid`/`errorMessage`.
14. **Teamdiagnose: Datengrundlage ausreichend?** (IF) — **falsch** (d. h.
    `diagnosisCategory === 'no_data'`) → **Team analysieren: Ergebnis**
    (`valid: false`); **wahr** → **Team analysieren: Ergebnis**
    (`valid: true`).
15. **Team analysieren: Ergebnis** (`n8n-nodes-base.noOp`) — konsolidierter
    Phase-Ergebnis-Knoten dieser Datei: alle vier möglichen Pfade (11./12.
    ungültige Teamdiagnose, 13./14. `no_data`-Stopp, 14. gültige Diagnose, 9.
    LLM-Fehler) münden hier ein, `valid`/`errorMessage` sind an dieser Stelle
    bereits vom jeweils zuletzt durchlaufenen Prüf-Node gesetzt. Dieser Node
    verändert das Item nicht, sondern ist einfach der letzte Node der Datei —
    n8n liefert dessen Output als Ergebnis des Execute-Workflow-Aufrufs an
    den Hauptworkflow zurück.

## Scouting Brief erstellen (Subworkflow)

[`scouting-brief-subworkflow.json`](./scouting-brief-subworkflow.json) (feste
Top-Level-ID `85a4c672-5c35-4543-98ee-1f877f955593`, 13 Nodes) kapselt die
Ableitung des Spielerprofils (LLM) und die Erstellung des Scouting Briefs
inklusive eigener **Ollama Modell**-/**LLM-Fehler normalisieren**-Instanz und
aller zugehörigen internen Gates. Eingang (`inputSource: passthrough`): das
vom Hauptworkflow übergebene Item, inkl. `teamDiagnosis` (aus **Team
analysieren**) und optional `reviewFeedback`/`reviewDecision`/`scoutingBrief`
(gesetzt, wenn dies eine erneute Vorlage nach einer **Request
Changes**-Entscheidung ist, siehe [Human Review](#human-review-bleibt-im-hauptworkflow)
oben — der Subworkflow selbst unterscheidet nicht zwischen Erst- und
Folgeaufruf, sondern reagiert nur darauf, ob `reviewFeedback` gesetzt ist).
Ausgang: dasselbe Item, angereichert um `playerProfile`, `scoutingBrief`
sowie `valid`/`errorMessage`.

1. **Spielerprofil: Positionspool ermitteln** (Code) — grenzt den
   Positionspool generisch anhand von `teamDiagnosis.diagnosisCategory` ein
   (Defensivproblem → defensive Positionen, Offensivproblem → offensive
   Positionen, `neutral` → alle Positionen; kein Sonderfall für einen
   bestimmten Verein oder eine bestimmte Position) und übergibt diesen Pool
   als `allowedPositions` verbindlich an **Spielerprofil LLM**.
2. **Spielerprofil LLM** (`@n8n/n8n-nodes-langchain.chainLlm`, Basic LLM
   Chain) — leitet aus der Teamdiagnose sowie `club`/`objective`/
   `additionalContext` ein strukturiertes Anforderungsprofil ab, über
   **Ollama Modell (Qwen3.8:latest)** (eigene Node-Instanz dieser Datei) und
   erzwungen durch **Spielerprofil Output-Schema**: `position` (nur aus
   `allowedPositions`), `role`, `weightedCriteria` (Kriteriennamen, die
   **Player-Ranking** erkennt: `goals`, `assists`, `rating`,
   `appearances`, `age`, `minutesPlayed`, `marketValueMEUR`), `constraints`
   (Liste strukturierter Objekte `{ field: 'age'|'marketValueMEUR',
   operator: 'max'|'min', value: <Zahl> }` — nur wenn ein konkreter Alters-
   oder Budget-/Marktwertrahmen aus `additionalContext` und/oder aus
   `reviewFeedback` ableitbar ist, sonst ein leeres Array) und `reasoning`
   (muss sich auf `teamDiagnosis.mainProblem` beziehen). `onError:
   continueErrorOutput` → **LLM-Fehler normalisieren** wie bei
   **Teamdiagnose LLM**. Ist `$json.reviewFeedback` gesetzt (dieser Lauf
   folgt auf eine **Request Changes**-Entscheidung), wird der Prompt um genau
   dieses Freitext-Feedback ergänzt und das LLM angewiesen,
   Rolle/Kriterien/Constraints/Begründung entsprechend zu überarbeiten, ohne
   den erlaubten Positionspool oder die zulässigen Kriteriennamen zu
   verletzen; ist `reviewFeedback` leer (Erstlauf), bleibt der Prompt
   unverändert.
3. **Spielerprofil Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
   — erzwingt den unter 2. genannten JSON-Vertrag, inkl. des strukturierten
   `constraints`-Objektvertrags.
4. **Ollama Modell (Qwen3.8:latest)** (Ollama Chat Model) — eigene
   Node-Instanz **dieser Datei**, versorgt **Spielerprofil LLM** über
   `ai_languageModel`. Credential-Referenz `[cimt] Ollama`
   (`REPLACE_WITH_LOCAL_CREDENTIAL_ID`).
5. **LLM-Fehler normalisieren** (Code) — eigene Kopie **dieser Datei**:
   empfängt den Error-Output von **Spielerprofil LLM**, normalisiert ihn zu
   `errorMessage`, setzt zusätzlich `valid: false` und läuft direkt in
   **Scouting Brief erstellen: Ergebnis** (dieselbe Ergänzung wie bei der
   Kopie in `team-analysieren-subworkflow.json`, siehe oben).
6. **Spielerprofil zusammenführen** (Code) — gegen n8n **2.35.7** verifiziert
   (siehe **Team analysieren**, Punkt 10.): holt das vollständige Item über
   `$('Spielerprofil: Positionspool ermitteln').first().json` zurück und
   setzt `playerProfile` aus der LLM-Ausgabe zusammen (`playerProfile.
   simulated: false`).
7. **Spielerprofil prüfen** (Code) — prüft alle Pflichtfelder inkl. dass
   jedes `weightedCriteria`-Element ein `criterion` und ein numerisches
   `weight` hat, dass jedes `constraints`-Element ein gültiges
   `field`/`operator`/numerisches `value` hat, sowie eine generische
   Konsistenzprüfung, dass `playerProfile.position` tatsächlich im durch
   `teamDiagnosis.diagnosisCategory` vorgegebenen Pool liegt (dieselbe
   Poolzuordnung wie in 1., hier erneut dupliziert, da Code-Nodes keine
   gemeinsamen Hilfsfunktionen teilen können).
8. **Spielerprofil gültig?** (IF) — **falsch** → **Scouting Brief erstellen:
   Ergebnis** (`valid: false`); **wahr** → **Scouting Brief erstellen**
   (Code, Punkt 9.).
9. **Scouting Brief erstellen** (Code) — baut `scoutingBrief` aus dem
   bereits validierten `teamDiagnosis.mainProblem` (→ `problem`) und
   `playerProfile.position`/`role`/`reasoning`/`weightedCriteria`/
   `constraints` sowie `teamDiagnosis.uncertainties` zusammen — rein
   deklarativ aus bereits vorhandenen, validierten Feldern. Führt zusätzlich
   eine begrenzte Überarbeitungshistorie: folgt dieser Lauf auf eine
   **Request Changes**-Entscheidung, wird das Feedback der vorherigen Runde
   an `scoutingBrief.feedbackHistory` angehängt; `scoutingBrief.reviewRound`
   zählt ab 1 hoch, `scoutingBrief.maxReviewRounds` ist auf `3` fest
   verdrahtet.
10. **Scouting Brief prüfen** (Code) — prüft, dass `problem`,
    `targetPosition`, `role` und `reasoning` nichtleere Strings sind,
    `weightedCriteria` ein nichtleeres Array ist und `constraints`/
    `uncertainties` Arrays sind; setzt `valid`/`errorMessage`.
11. **Scouting Brief gültig?** (IF, **intern**, nicht zu verwechseln mit dem
    gleichnamigen Gate im Hauptworkflow) — **falsch**/**wahr** → jeweils
    **Scouting Brief erstellen: Ergebnis** (`valid` ist in beiden Fällen
    bereits korrekt von 10. gesetzt).
12. **Scouting Brief erstellen: Ergebnis** (`n8n-nodes-base.noOp`) —
    konsolidierter Phase-Ergebnis-Knoten dieser Datei: alle Pfade (7./8.
    ungültiges Spielerprofil, 10./11. Scouting-Brief-Prüfung, 5. LLM-Fehler)
    münden hier ein und werden unverändert an den Hauptworkflow
    zurückgegeben.

## Kandidaten suchen (Subworkflow)

[`kandidaten-suchen-subworkflow.json`](./kandidaten-suchen-subworkflow.json)
(feste Top-Level-ID `803a06a1-fb4b-4cb7-b502-63ab119c9996`, 11 Nodes) kapselt
den Player-Ranking-Abruf, den fachlichen Kandidatenvergleich über
`get_player_profile` und die Ableitung der validierten Spielersuche/
Shortlist. Eingang: das Item mit `playerProfile` (aus **Scouting Brief
erstellen**) und `clubPlayerData` (aus **Auftrag normalisieren**). Ausgang:
dasselbe Item, angereichert um `playerRanking`, `playerSearch` sowie
`valid`/`errorMessage`.

1. **Player-Ranking-Anfrage vorbereiten** (Code) — übersetzt `playerProfile`
   in den Tool-Vertrag von Player-Ranking: `rankingExcludeClub` =
   `clubPlayerData` des diagnostizierten Vereins (Scouting sucht außerhalb
   des eigenen Kaders) — bewusst `clubPlayerData` statt `club`, da
   Player-Ranking den Ausschluss gegen die `Squad`-Spalte der Spielerdaten
   vergleicht, die bei 8 der 18 Vereine einen anderen Identifier als der
   Match-Datensatz verwendet (siehe Hauptworkflow, Node 2.), `constraints` =
   `playerProfile.constraints`, `position`/`criteria` aus
   `playerProfile.position`/`weightedCriteria`, `limit: 5`.
2. **Player-Ranking abrufen** (Execute Workflow) — ruft
   [`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json)
   auf (Tool „Player-Ranking" / `rank_players`, siehe
   [CSV-Analytics-Adapter](#csv-analytics-adapter)) und reichert das Item um
   `playerRanking` an.
3. **Spielersuche durchführen** (Code) — leitet `longlistSize` und eine
   analytische `shortlist` von bis zu fünf Kandidaten (`score`, `strengths`,
   `weaknesses`, `evidence` jeweils aus echten, importierten Spielerwerten
   gegenüber dem Pool-Durchschnitt) aus `playerRanking` ab
   (`playerSearch.simulated: false`). Liefert der Adapter keine Kandidaten,
   bleibt `shortlist` leer statt Kandidaten zu erfinden.
4. **Shortlist vorhanden?** (IF, **intern**) — nur mit nichtleerer,
   analytisch verfügbarer Shortlist lohnt sich der fachliche Profilabgleich;
   **falsch** → direkt weiter zu **Spielersuche prüfen** (7., meldet den
   bestehenden Leer-Shortlist-Fehlerfall); **wahr** → **Kandidaten für
   Profilabgleich aufteilen**.
5. **Kandidaten für Profilabgleich aufteilen** (Code) — teilt die analytische
   Shortlist in ein Item je Kandidat auf (`playerName` = Kandidatenname),
   damit jeder Kandidat einzeln über `get_player_profile` nachgeschlagen
   werden kann, statt dieses Tool nur einmal für den bereits feststehenden
   Sieger aufzurufen (siehe **Empfehlung erstellen** unten).
6. **Player-Profil je Kandidat abrufen** (Execute Workflow) — ruft
   [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)
   auf (Tool „Player-Profil" / `get_player_profile`, siehe
   [CSV-Analytics-Adapter](#csv-analytics-adapter)); läuft je eingehendem
   Item separat und reichert jedes Item um `playerProfileLookup` **für genau
   diesen Kandidaten** an.
7. **Kandidatenvergleich validieren** (Code, `runOnceForAllItems`) — führt
   den analytischen Rang mit dem fachlichen Spielerprofil je Kandidat
   zusammen: nur Kandidaten mit gefundenem, fehlerfreiem Profil
   (`playerProfileLookup.found && !profile.dataError`) gelten als fachlich
   validiert und bilden die finale `playerSearch.shortlist`
   (`playerSearch.profileValidated: true`); nicht validierte Kandidaten
   landen namentlich in `playerSearch.candidatesWithoutValidProfile` und
   fallen aus der Shortlist. Reichert jeden verbleibenden Kandidaten
   zusätzlich um `profile` sowie einen CSV-Analytics-Profil-Eintrag in
   `evidence` an.
8. **Spielersuche prüfen** (Code) — prüft `longlistSize > 0`, `shortlist`
   nichtleer und **höchstens fünf** Kandidaten, dass jeder Kandidat alle
   Pflichtfelder hat und dass `playerSearch.profileValidated` gesetzt ist
   (sonst wurde die Shortlist nicht über `get_player_profile` fachlich
   validiert). Prüft zusätzlich, dass `playerRanking.ignoredConstraints` und
   `playerRanking.ignoredCriteria` leer sind (sonst wurde ein vom
   Spielerprofil gefordertes Constraint/Kriterium stillschweigend nicht
   angewendet) sowie dass `playerRanking.positionFallbackApplied` nicht
   gesetzt ist (sonst wäre die angeforderte Position komplett
   verlorengegangen und der Pool ungefiltert geblieben).
9. **Spielersuche gültig?** (IF, **intern**) — **falsch**/**wahr** → jeweils
   **Kandidaten suchen: Ergebnis** (`valid` ist bereits von 8. gesetzt).
10. **Kandidaten suchen: Ergebnis** (`n8n-nodes-base.noOp`) — konsolidierter
    Phase-Ergebnis-Knoten dieser Datei.

## Due Diligence (Subworkflow)

[`due-diligence-subworkflow.json`](./due-diligence-subworkflow.json) (feste
Top-Level-ID `c2ffe3ab-e97a-4147-83a8-4fbd1b87eae6`, 8 Nodes) kapselt die
Recherche zu den Shortlist-Kandidaten als **echte, je Kandidat unabhängige
Research-Zweige** mit anschließendem Fan-in. Eingang: das Item mit
`playerSearch.shortlist` (aus **Kandidaten suchen**). Ausgang: dasselbe Item,
angereichert um `research` sowie `valid`/`errorMessage`.

1. **Shortlist vorhanden?** (IF, **intern**) — nur mit nichtleerer Shortlist
   gibt es Kandidaten für eigene Research-Zweige; **falsch** → direkt weiter
   zu **Recherche prüfen** (5., meldet den bestehenden `research fehlt`-
   Fehlerfall); **wahr** → **Kandidaten für Recherche aufteilen**.
2. **Kandidaten für Recherche aufteilen** (Code) — teilt die validierte
   Shortlist in ein Item je Kandidat auf (`researchCandidateName`), damit
   jeder Kandidat einen eigenen, unabhängigen Research-Zweig erhält.
3. **Recherche je Kandidat durchführen** (Execute Workflow,
   `onError: continueErrorOutput`) — ruft den technischen Subworkflow
   [`recherche-subworkflow.json`](./recherche-subworkflow.json) auf; läuft je
   eingehendem Item (also je Kandidat) als eigener, unabhängiger
   Research-Zweig. Der Subworkflow liefert für genau diesen Kandidaten
   `club`, `contract`, `marketValue`, `injuries` und `news`, jeweils mit
   `source` (Dummy-Quelle), `timestamp` und `confidence` — siehe
   [Recherche-Subworkflow](#recherche-subworkflow). Schlägt ein einzelner
   Zweig fehl, läuft er über den zweiten Node-Output (Fehlerausgang) statt
   die gesamte Due Diligence abzubrechen.
4. **Recherche-Ergebnisse zusammenführen** (Code, `runOnceForAllItems`,
   **Fan-in**) — führt alle parallelen Research-Zweige zu einem einzigen
   `research`-Array zusammen. Ein erfolgreicher Zweig übernimmt Quelle und
   Konfidenz unverändert (`uncertain: false`); ein fehlgeschlagener Zweig
   wird **nicht verworfen**, sondern als Unsicherheit am betroffenen
   Kandidaten erhalten (`uncertain: true`, `confidence: 0`,
   `uncertaintyReason` mit der Fehlermeldung) statt die gesamte Due Diligence
   hart ungültig zu machen.
5. **Recherche prüfen** (Code) — prüft die Kandidatenabdeckung per
   Set-Gleichheit (jeder Shortlist-Name kommt in `research` vor und
   umgekehrt) plus Duplikatprüfung, sodass `research` **genau einen**
   Eintrag je Shortlist-Kandidat enthält. Ein als `uncertain` markierter
   Eintrag muss nur `confidence`/`source`/`timestamp`/`news` (Array) haben;
   ein erfolgreicher Eintrag muss zusätzlich alle fachlichen Detailfelder
   (`club`, `contract`, `marketValue`, `injuries`, nichtleere `news`)
   liefern. Sind **alle** Zweige `uncertain`, gilt das weiterhin als
   ungültig (keine verwertbare Recherche für die gesamte Shortlist).
6. **Recherche gültig?** (IF, **intern**) — **falsch**/**wahr** → jeweils
   **Due Diligence: Ergebnis** (`valid` ist bereits von 5. gesetzt).
7. **Due Diligence: Ergebnis** (`n8n-nodes-base.noOp`) — konsolidierter
   Phase-Ergebnis-Knoten dieser Datei.

## Empfehlung erstellen (Subworkflow)

[`empfehlung-erstellen-subworkflow.json`](./empfehlung-erstellen-subworkflow.json)
(feste Top-Level-ID `7e29c7d7-ef3b-488c-9d1e-2fdd4dad6bf1`, 8 Nodes) kapselt
die Erzeugung der Empfehlung (unter Einbeziehung der Due-Diligence-Ergebnisse)
sowie die Anreicherung mit dem Kandidatenprofil. Die phasenübergreifende
Gesamtvalidierung (Final Validation) und die Präsentationsaufbereitung sind
**nicht** mehr Teil dieser Datei — sie leben in der eigenständigen Capability
[Ergebnis aufbereiten](#ergebnis-aufbereiten-subworkflow). Eingang: das Item
mit `teamDiagnosis`, `playerProfile`, `playerSearch`, `research` (aus den
vorherigen Phasen). Ausgang: dasselbe Item, angereichert um `recommendation`
sowie `valid`/`errorMessage`.

1. **Empfehlung erzeugen** (Code) — kombiniert je Kandidat aus
   `playerSearch.shortlist` den analytischen Fit (`score`, Gewicht 0,6) mit
   der Transferrealisierbarkeit aus der Due Diligence (`research[].
   confidence` des Kandidaten, Gewicht 0,4; ein Kandidat ohne erfolgreichen
   Research-Zweig — `research[].uncertain` — geht mit Feasibility-Score `0`
   ein) zu einem `combinedScore`. Der Kandidat mit dem höchsten
   `combinedScore` wird bevorzugter Kandidat (damit stammt er per
   Konstruktion aus der validierten Shortlist), die übrigen Shortlist-Namen
   (absteigend nach `combinedScore`) werden `alternatives`; `reasoning` und
   `risks` zitieren bei erfolgreicher Recherche explizit Vertrag, Marktwert
   und Verletzungshistorie des Siegers. Ist `playerRanking.
   positionApproximationApplied` gesetzt (angeforderte Position nur grob auf
   eine Positionsgruppe DF/MF/FW/GK angenähert statt exakt gematcht — mit der
   FBref-Datengrundlage der Regelfall) oder liegt für den Sieger keine
   belastbare Recherche vor, wird das explizit als zusätzlicher Eintrag in
   `recommendation.uncertainties` ausgewiesen.
2. **Player-Profil-Anfrage vorbereiten** (Code) — setzt `playerName` auf
   `recommendation.candidate`.
3. **Player-Profil abrufen** (Execute Workflow) — ruft
   [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)
   auf (Tool „Player-Profil", siehe [CSV-Analytics-Adapter](#csv-analytics-adapter))
   und reichert das Item um `playerProfileLookup` an. Da der Kandidat selbst
   aus den importierten Player-Daten stammt (über Player-Ranking), wird er
   hier immer gefunden.
4. **Empfehlung anreichern** (Code) — setzt `recommendation.candidateProfile`
   auf `playerProfileLookup.profile` (bzw. `null`, falls nicht gefunden),
   ohne die übrigen `recommendation`-Felder zu verändern.
5. **Empfehlung technisch prüfen** (Code) — nur ein leichtgewichtiger,
   struktureller Check dieser Capability: `candidate`, `alternatives`
   (Array), `reasoning`, `risks` (nichtleeres Array), `uncertainties`
   (nichtleeres Array) und `nextStep` müssen vorhanden sein. Die tiefere,
   phasenübergreifende Prüfung (Final Validation) läuft erst in **Ergebnis
   aufbereiten**.
6. **Empfehlung technisch gültig?** (IF, **intern**) — **falsch**/**wahr** →
   jeweils **Empfehlung erstellen: Ergebnis** (`valid` ist bereits von 5.
   gesetzt).
7. **Empfehlung erstellen: Ergebnis** (`n8n-nodes-base.noOp`) —
   konsolidierter Phase-Ergebnis-Knoten dieser Datei.

## Ergebnis aufbereiten (Subworkflow)

[`ergebnis-aufbereiten-subworkflow.json`](./ergebnis-aufbereiten-subworkflow.json)
(feste Top-Level-ID `6306c333-15f1-48ed-a006-0d2812a9c7a7`, 5 Nodes) kapselt
die abschließende, phasenübergreifende Gesamtvalidierung (Final Validation)
und die Präsentationsaufbereitung. Der Hauptworkflow erhält aus dieser
Capability ausschließlich das validierte Ergebnis (`formattedResult`) bzw.
einen kontrollierten Fehler (`valid: false` + `errorMessage`) — keine
technische Präsentationslogik bleibt im Hauptworkflow selbst. Eingang: das
Item mit `teamDiagnosis`, `playerProfile`, `playerSearch`, `research`,
`recommendation` (aus allen vorherigen Phasen). Ausgang: dasselbe Item,
angereichert um `valid`/`errorMessage` sowie (bei Erfolg) `formattedResult`.

1. **Final Validation** (Code) — prüft alle vorherigen Stufenergebnisse noch
   einmal im Zusammenhang (u. a. dass `recommendation.candidate` tatsächlich
   Teil der validierten `playerSearch.shortlist` ist) sowie den vollständigen
   Empfehlungsvertrag: `candidate`, `alternatives` (Array), `reasoning`,
   `risks` (nichtleeres Array), `uncertainties` (nichtleeres Array) und
   `nextStep`. `candidateProfile` ist kein Pflichtfeld dieser Prüfung.
2. **Final Validation gültig?** (IF, **intern**) — **falsch** → direkt
   **Ergebnis aufbereiten: Ergebnis** (`valid` ist bereits von 1. gesetzt);
   **wahr** → **Ergebnisseiten aufbereiten**.
3. **Ergebnisseiten aufbereiten** (Code) — liest `item.teamDiagnosis`/
   `playerProfile`/`playerSearch`/`research`/`recommendation` und baut
   `formattedResult`, einen Text, der Teamdiagnose, Spielerprofil,
   Spielersuche, Recherche und Empfehlung (inkl. `candidateProfile`, falls
   vorhanden) als klar getrennte Abschnitte darstellt, mit einem Hinweis,
   welche Abschnitte auf dem CSV-Analytics-Adapter bzw. der
   LLM-Interpretation beruhen und welche weiterhin vollständig simuliert
   sind. Ein als `uncertain` markierter Recherche-Eintrag wird im
   Recherche-Abschnitt explizit als fehlgeschlagen/unsicher ausgewiesen statt
   `null`-Felder auszugeben.
4. **Ergebnis aufbereiten: Ergebnis** (`n8n-nodes-base.noOp`) —
   konsolidierter Phase-Ergebnis-Knoten dieser Datei.

Die Struktur erlaubt weiterhin, jeden `<Stufe> erzeugen`/`durchführen`-Node
später durch echte Logik (AI Agent, Qlik/MCP, Websuche) zu ersetzen, ohne die
umgebenden `<Stufe> prüfen`/`<Stufe> gültig?`-Gates, das Formular, die
Normalisierung, die Validierung oder die Ergebnisdarstellung neu bauen zu
müssen — die Datenverträge (`teamDiagnosis`, `playerProfile`, `playerSearch`,
`research`, `recommendation`) bleiben dabei stabil, solange ein Ersatz
dieselben Felder liefert. Das gilt jetzt zusätzlich auf Ebene der fachlichen
Subworkflows selbst: ein künftiger Ersatz für z. B. **Team analysieren**
müsste nur denselben `teamDiagnosis`/`valid`/`errorMessage`-Vertrag über
seinen eigenen Execute-Workflow-Trigger/-Ergebnis-Knoten erfüllen, ohne dass
der Hauptworkflow angepasst werden müsste.

## CSV-Analytics-Adapter

Temporärer, CSV-basierter Ersatz für die künftige Qlik-MCP-Anbindung (siehe
User Story „CSV Analytics Adapter als temporären Qlik-Ersatz
implementieren"). Vier fachliche Analytics-Tools sind als eigenständige,
**technische** n8n-Subworkflows gekapselt — analog zum
[Recherche-Subworkflow](#recherche-subworkflow) — und werden jetzt aus den
fachlichen Subworkflows heraus über je einen **Execute Workflow**-Node
aufgerufen (unverändert gegenüber der Zeit vor der Restrukturierung, nur der
aufrufende Node liegt jetzt in einer anderen Datei). Die Tool-Verträge
(Feldnamen für Ein-/Ausgabe) sind bewusst so gestaltet, wie sie später durch
echte Qlik-MCP-Tools bedient werden sollen; die Referenzdaten selbst liegen
persistent in der n8n Data Table `football_scouting_raw` (voller
Bundesliga-Datensatz, importiert über
[`import-scouting-data.json`](./import-scouting-data.json), siehe
[`n8n/data/README.md`](./data/README.md)), nicht als CSV-Dateien im
Repository. Kein Tool erfindet Werte für unbekannte Vereine, Spieler oder
Positionen — stattdessen wird das explizit ausgewiesen (`dataAvailable:
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
   Aufgerufen von **Team-Performance abrufen** in
   `team-analysieren-subworkflow.json`.
2. **Team-Matches**
   ([`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json)) —
   Input `{ club, matchLimit? }` (Default 10). Liefert `teamMatches.matches`:
   je Spiel `date`, `opponent`, `homeAway`, `goalsFor`, `goalsAgainst`,
   `result`, `competition`, `dataError`. Ein Spiel mit fehlenden/ungültigen
   Tordaten bleibt in der Liste, hat aber `goalsFor`/`goalsAgainst`/`result:
   null` und `dataError: true` statt erfundener Werte (`invalidMatches`
   zählt sie zusätzlich auf Ebene von `teamMatches`). Aufgerufen von
   **Team-Matches abrufen** in `team-analysieren-subworkflow.json`.
3. **Player-Ranking**
   ([`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json)) —
   Input `{ rankingClub?, rankingExcludeClub?, position?, criteria?: [{
   criterion, weight }], constraints?: [{ field, operator, value }], limit? }`
   (bewusst eigene Feldnamen statt `club`, da das im Hauptworkflow bereits
   den zu diagnostizierenden Verein bezeichnet und beim Durchreichen des
   ganzen Items sonst kollidieren würde). `rankingClub` filtert auf genau
   einen Verein, `rankingExcludeClub` schließt genau einen Verein aus (so
   sucht die Spielersuche außerhalb des eigenen Kaders). Erkannte,
   generische `criteria`-Namen: `goals`, `assists`, `rating`,
   `minutesPlayed`, `appearances`, `marketValueMEUR` (höher = besser) sowie
   `age` (niedriger = besser); jeder Wert wird über den betrachteten Pool
   min-max-normalisiert und gewichtet aufsummiert. `constraints` (von
   `playerProfile.constraints`) filtert den Pool **vor** dem Scoring hart:
   `field` ist `age` oder `marketValueMEUR`, `operator` ist `max` (Wert ≤
   `value`) oder `min` (Wert ≥ `value`). Ein Constraint auf ein Feld ohne
   numerisch verfügbare Daten im Pool wird nicht ignoriert-und-verschwiegen,
   sondern in `ignoredConstraints` aufgeführt; tatsächlich angewendete
   Constraints stehen in `appliedConstraints`, die Anzahl dadurch
   ausgeschlossener Kandidaten in `excludedByConstraints`. Ein nicht
   anwendbares Constraint bleibt hier bewusst nur protokolliert
   (`ignoredConstraints`) statt den Subworkflow-Lauf abzubrechen —
   **Spielersuche prüfen** in `kandidaten-suchen-subworkflow.json` wertet
   `ignoredConstraints` aus und stoppt die Pipeline vor einer Empfehlung,
   falls ein Constraint nicht wirksam wurde. Unbekannte oder im Pool nicht
   numerisch verfügbare Kriterien werden analog in `ignoredCriteria`
   aufgeführt; **Spielersuche prüfen** wertet das ebenfalls aus. Die
   Positionssuche versucht zuerst einen exakten Match (normalisiert, `ß`→`ss`),
   dann einen groben Gruppen-Match (DF/MF/FW/GK, z. B. „Linksaußen" → `FW`) —
   dabei wird `positionApproximationApplied: true` gesetzt (**Empfehlung
   erzeugen** in `empfehlung-erstellen-subworkflow.json` weist das als
   Unsicherheit aus). Schlägt selbst der grobe Gruppen-Match fehl, fällt der
   Subworkflow — explizit über `positionFallbackApplied: true` markiert —
   auf den ungefilterten Pool zurück statt Kandidaten zu erfinden;
   **Spielersuche prüfen** behandelt das als unzureichende Datengrundlage.
   Ein Spieler-Datensatz mit fehlendem/ungültigem numerischem Pflichtfeld
   wird komplett aus dem Ranking-Pool ausgeschlossen statt mit `0`/`NaN` in
   den Score einzufließen; die Anzahl solcher ausgeschlossenen Datensätze
   steht in `excludedInvalidData`. Liefert `playerRanking.ranking` (bis
   `limit`, Default 5) mit `name`, `club`, `position`, `age`, `score`,
   `stats`. Aufgerufen von **Player-Ranking abrufen** in
   `kandidaten-suchen-subworkflow.json`.
4. **Player-Profil**
   ([`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)) —
   Input `{ playerName }`. Liefert `playerProfileLookup` mit `found` und
   `profile` (alle importierten Spalten aus der Data Table
   `football_scouting_raw`) bzw. `found: false` und `profile: null` für
   einen unbekannten Namen. Einzelne fehlende/ungültige numerische Felder im
   gefundenen Datensatz bleiben in `profile` explizit `null` (statt
   `0`/`NaN`) und werden namentlich in `invalidFields` aufgeführt;
   `profile.dataError: true` markiert einen unvollständigen Datensatz. Heißt
   bewusst `playerProfileLookup`, nicht `playerProfile` — Letzteres
   bezeichnet im Scouting-Brief-Subworkflow bereits das simulierte
   Bedarfsprofil, beide Verträge bleiben dadurch unabhängig voneinander
   stabil. Aufgerufen von **Player-Profil je Kandidat abrufen** in
   `kandidaten-suchen-subworkflow.json` (je Shortlist-Kandidat, für den
   fachlichen Kandidatenvergleich) sowie von **Player-Profil abrufen** in
   `empfehlung-erstellen-subworkflow.json` (einmal für den bereits gewählten
   Sieger, zur Anreicherung der Empfehlung).

Die vier Subworkflows lesen die importierten Originalzeilen aus der
persistenten Data Table `football_scouting_raw` (kein eingebetteter
CSV-Code) — siehe [`n8n/data/README.md`](./data/README.md) für den Import
(`import-scouting-data.json`) und die Architektur-Verifikation
(`verify-import-architecture.js`).

## Recherche-Subworkflow

[`recherche-subworkflow.json`](./recherche-subworkflow.json) ist ein
eigenständiger, **technischer** n8n-Workflow mit zwei Nodes. Er kapselt
seit der Due-Diligence-Parallelisierung (siehe
[Due Diligence](#due-diligence-subworkflow) oben) die Recherche zu **genau
einem** Kandidaten je Ausführung, statt intern über die gesamte Shortlist zu
iterieren — der Fan-out/Fan-in über alle Shortlist-Kandidaten passiert jetzt
im aufrufenden `due-diligence-subworkflow.json`:

1. **Wenn von anderem Workflow aufgerufen** (Execute Workflow Trigger,
   `inputSource: passthrough`) — nimmt das übergebene Item unverändert
   entgegen.
2. **Recherche-Dummy für Kandidat erzeugen** (Code) — liest
   `researchCandidateName` aus dem übergebenen Item und erzeugt für **genau
   diesen einen Kandidaten** einen deterministischen Dummy-Rechercheeintrag
   (`club`, `contract`, `marketValue`, `injuries`, `news`, dazu `source`
   (immer `"Dummy-Quelle (keine echte Web-/Qlik-Recherche)"`), `timestamp`
   und `confidence`) unter `researchResult`. Fehlt `researchCandidateName`,
   wirft der Node einen Fehler, den der Aufrufer (**Recherche je Kandidat
   durchführen** in `due-diligence-subworkflow.json`, `onError:
   continueErrorOutput`) als fehlgeschlagenen, isolierten Research-Zweig
   dieses einen Kandidaten behandelt, ohne die übrigen Zweige zu
   beeinträchtigen. Es wird an keiner Stelle eine echte Qlik-Analyse oder
   Websuche behauptet oder simuliert vorgetäuscht — jeder Wert ist
   ausdrücklich als Platzhalter gekennzeichnet.

Aufgerufen von **Recherche je Kandidat durchführen** in
[`due-diligence-subworkflow.json`](./due-diligence-subworkflow.json), einmal
separat je Shortlist-Kandidat (vor der Restrukturierung direkt aus
`ai-sporting-director.json`). n8n übernimmt die feste Top-Level-ID
`802fdb6b-4c0a-413f-952d-250c91ddc476` beim Import (`import:workflow`) per
Upsert, sodass alle Workflow-Dateien nach dem Import ohne manuelle Anpassung
verbunden sind — siehe [Import & run](#import--run).

## Import & run

1. Open your n8n instance.
2. Import **alle elf Subworkflows** zuerst — Reihenfolge untereinander egal,
   nur "vor dem Hauptworkflow" zählt — (**Workflows** → **Add workflow** →
   **Import from File**):
   - die fünf **technischen** Subworkflows:
     [`recherche-subworkflow.json`](./recherche-subworkflow.json),
     [`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json),
     [`analytics-team-matches-subworkflow.json`](./analytics-team-matches-subworkflow.json),
     [`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json),
     [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json);
   - die sechs **fachlichen** Subworkflows:
     [`team-analysieren-subworkflow.json`](./team-analysieren-subworkflow.json),
     [`scouting-brief-subworkflow.json`](./scouting-brief-subworkflow.json),
     [`kandidaten-suchen-subworkflow.json`](./kandidaten-suchen-subworkflow.json),
     [`due-diligence-subworkflow.json`](./due-diligence-subworkflow.json),
     [`empfehlung-erstellen-subworkflow.json`](./empfehlung-erstellen-subworkflow.json),
     [`ergebnis-aufbereiten-subworkflow.json`](./ergebnis-aufbereiten-subworkflow.json).
3. Import [`ai-sporting-director.json`](./ai-sporting-director.json) the
   same way — its Execute-Workflow nodes already reference the subworkflows'
   fixed IDs, so no manual edit is needed there.
4. On the **Ollama Modell (Qwen3.8:latest)** node in **both**
   `team-analysieren-subworkflow.json` and `scouting-brief-subworkflow.json`,
   select the local `[cimt] Ollama` credential (once per file, per
   n8n-instance).
5. Use **Test workflow** on the main workflow to obtain a test-mode form URL
   for manual testing, or activate it (toggle **Active**) to make the form
   reachable at its production URL shown on the **AI Sporting Director
   beauftragen** node.

Alternatively, with the [n8n CLI](https://docs.n8n.io/hosting/cli-commands/)
available:

```bash
n8n import:workflow --input=n8n/recherche-subworkflow.json
n8n import:workflow --input=n8n/analytics-team-performance-subworkflow.json
n8n import:workflow --input=n8n/analytics-team-matches-subworkflow.json
n8n import:workflow --input=n8n/analytics-player-ranking-subworkflow.json
n8n import:workflow --input=n8n/analytics-player-profile-subworkflow.json
n8n import:workflow --input=n8n/team-analysieren-subworkflow.json
n8n import:workflow --input=n8n/scouting-brief-subworkflow.json
n8n import:workflow --input=n8n/kandidaten-suchen-subworkflow.json
n8n import:workflow --input=n8n/due-diligence-subworkflow.json
n8n import:workflow --input=n8n/empfehlung-erstellen-subworkflow.json
n8n import:workflow --input=n8n/ergebnis-aufbereiten-subworkflow.json
n8n import:workflow --input=n8n/ai-sporting-director.json
```

## End-to-End-Test über das HSV-Formular

### Positiver Testfall (alle Stufen)

1. Open the form's test or production URL in a browser. **Expected result:**
   `Verein` shows all 18 Bundesliga clubs of the 2025/26 season, with
   `FC Bayern München` preselected, and `Was soll der Sporting Director
   untersuchen?` already contains the club-agnostic default order text.
2. Click `Analyse starten` without changing anything. **Expected result:**
   the browser now shows the **Scouting Brief zur Freigabe vorlegen** page
   (Human Review) instead of directly proceeding to the recommendation — the
   Teamdiagnose-derived `Hauptproblem (Diagnose)` and the
   Spielerprofil-derived `Zielposition`, `Rolle`, `Begruendung`, `Gewichtete
   Kriterien (JSON-Array)`, `Constraints (JSON-Array)` and `Unsicherheiten
   (JSON-Array)` of the `scoutingBrief` are each pre-filled, editable form
   fields (not read-only text). In the n8n **Executions** list, this run
   appears as the main-workflow execution plus two nested sub-executions
   (**Team analysieren**, **Scouting Brief erstellen**), each independently
   inspectable.
3. Without editing any of the pre-filled brief fields, select `Approve` in
   the `Entscheidung` dropdown, leave `Feedback` empty, and submit.
   **Expected result:** the browser shows the **Ergebnis
   anzeigen** page with five clearly separated sections — Teamdiagnose,
   Spielerprofil, Spielersuche, Recherche, Empfehlung — with a hint
   distinguishing the sections backed by the CSV-Analytics-Adapter and the
   LLM interpretation (Teamdiagnose, Spielerprofil, Spielersuche) from the
   still fully simulated one (Recherche), and the recommended candidate is
   one of the shortlisted CSV players (not the Hamburger SV squad itself).
   In the n8n **Executions** list the main-workflow run is successful and
   passes all eight top-level gates (**Eingabe validieren**, **Team
   analysieren gültig?**, **Scouting Brief gültig?**, **Review-Entscheidung
   gültig?**, **Kandidaten suchen gültig?**, **Due Diligence gültig?**,
   **Empfehlung gültig?**, **Ergebnis aufbereiten gültig?**), plus the
   routing IF **Review: Approve?** in its true branch; each of the six
   Execute-Workflow calls (**Team analysieren**, **Scouting Brief
   erstellen**, **Kandidaten suchen**, **Due Diligence**, **Empfehlung
   erstellen**, **Ergebnis aufbereiten**) shows as its own successful nested
   sub-execution, internally passing its own gates (see the per-subworkflow
   sections above).

   **Ausgeführt (gezielte Node.js-Verifikation der geänderten Nodes):** ein
   Offline-Simulator für den kompletten Hauptworkflow existiert nicht mehr
   (siehe Migrationshinweis unten); stattdessen werden die relevanten
   Code-Nodes isoliert mit Node.js gegen den echten n8n-2.35.7-Vertrag
   (Structured-Output-Felder direkt auf `$json`, siehe **Team analysieren**,
   Punkt 10. oben) verifiziert: **Teamdiagnose zusammenführen** und
   **Spielerprofil zusammenführen** lesen die simulierte LLM-Antwort korrekt
   ohne `output`-Hülle und holen das Vor-LLM-Item über `.first()` statt über
   das `pairedItem`-abhängige `.item` zurück; **Teamdiagnose zusammenführen**
   verwirft dabei außerdem eine erfundene LLM-Ligaplatzierung zugunsten des
   deterministischen `leagueComparisonAvailable: false`-Vertrags;
   **Teamdiagnose: Datengrundlage prüfen** liefert `valid: false` für
   `diagnosisCategory: 'no_data'` und `valid: true` für
   `'defensive'`/`'offensive'`/`'neutral'`; **Spielerprofil prüfen** akzeptiert
   strukturierte `constraints` und lehnt unstrukturierte ab; **Spielersuche
   prüfen** liefert `valid: false`, sobald `playerRanking.ignoredConstraints`
   nichtleer ist, und `valid: true`, wenn keine Constraints ignoriert wurden.
   Für das Human-Review-Gate: `node n8n/data/verify-scouting-brief-review.js`
   (grün) verifiziert isoliert die drei zugehörigen Code-Nodes 1:1 aus ihrem
   `jsCode`-Inhalt (jetzt in `scouting-brief-subworkflow.json` bzw.
   `ai-sporting-director.json`, siehe unten) — **Scouting Brief erstellen**
   setzt `reviewRound: 1` mit leerer `feedbackHistory` im Erstlauf und
   übernimmt in Folgerunden das Feedback der Vorrunde korrekt in die
   Historie; **Scouting Brief prüfen** liefert `valid: false` bei einem
   fehlenden Pflichtfeld; **Review-Entscheidung auswerten** liefert
   `valid: false` für eine unbekannte Entscheidung sowie für `Request Changes`
   ohne Feedback-Text, setzt `reviewOutcome` korrekt für `Approve`/`Reject`,
   und erzwingt nach drei erreichten Überarbeitungsrunden `reviewOutcome:
   'Reject'` (`maxRoundsReached: true`); zusätzlich verifiziert dieselbe
   Datei, dass ein konkretes Reviewer-Alters-/Budgetlimit aus
   `reviewFeedback` unverändert in `playerProfile.constraints` und von dort
   in `scoutingBrief.constraints` der Folgerunde landet. Für die im Rahmen
   dieser Story editierbar gemachten Brief-Felder verifiziert dieselbe Datei
   zusätzlich: ein unbearbeitet abgesendetes Formular (alle Felder auf ihrem
   `defaultValue`) liefert ein `scoutingBrief`, das exakt dem ursprünglichen
   KI-Ergebnis entspricht; vom Reviewer bearbeitete Felder (z. B.
   `Hauptproblem (Diagnose)`, `Begruendung`) landen unverändert im
   resultierenden `scoutingBrief`, ohne dass unbearbeitete Felder
   (`reviewRound`, `feedbackHistory`) davon berührt werden; ein leeres
   Pflichtfeld sowie ein ungültiges JSON-Array in einem der drei
   JSON-Array-Felder liefern `valid: false` mit einer feldspezifischen
   Fehlermeldung.

   `node n8n/data/verify-import-architecture.js` (grün) verifiziert zusätzlich
   die vier `analytics-*-subworkflow.json`-Dateien sowie
   `import-scouting-data.json` (unverändert von der Restrukturierung).
   `node n8n/data/verify-club-canonical-map.js` (grün) verifiziert weiterhin
   alle 18 Dropdown-Vereine der Saison 2025/26 in `ai-sporting-director.json`
   (Node **Auftrag normalisieren**) sowie, jetzt aus
   `kandidaten-suchen-subworkflow.json` gelesen, dass **Player-Ranking-Anfrage
   vorbereiten** `rankingExcludeClub` tatsächlich aus `clubPlayerData`
   ableitet.

   Eine eigene JSON-Konsistenzprüfung (siehe
   [Regressionstest: alle Workflow-Dateien sind in sich konsistent](#regressionstest-alle-workflow-dateien-sind-in-sich-konsistent)
   unten) bestätigt für **alle dreizehn** `n8n/*.json`-Dateien: gültiges JSON,
   keine doppelten Node-Namen/-IDs innerhalb einer Datei, alle Connections
   referenzieren existierende Nodes, genau ein Trigger-Node je Datei, sowie
   dass keine zwei Nodes derselben Datei dieselbe `position` teilen.

   Nicht ausgeführt: ein vollständiger End-to-End-Lauf des Hauptworkflows
   (inkl. Formular-/Completion-Seiten, dem n8n-**Executions**-Eintrag und
   einem echten Aufruf des lokalen Ollama-Modells), da dafür eine laufende
   n8n-Weboberfläche mit erreichbarem Ollama-Endpunkt nötig ist — offen für
   die nächste Person (oder Session) mit interaktivem Zugriff auf eine
   importierte Instanz mit bereits über `import-scouting-data.json`
   importierten Originaldaten.

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
CSV-Fixtures mehr enthalten. Dieser Subworkflow selbst blieb von der
Restrukturierung unverändert; nur sein Aufrufer (**Player-Ranking abrufen**)
zog von `ai-sporting-director.json` nach `kandidaten-suchen-subworkflow.json`
um.

Zusätzlich isoliert gegen die extrahierten `norm()`/`posMatch()`-Funktionen
verifiziert (**Linksaußen-Negativtest**): `norm('Linksaußen')` liefert
`'linksaussen'` und `posMatch('FW', 'Linksaußen')` liefert `true`, sodass eine
angeforderte Linksaußen-Position korrekt der `FW`-Gruppe zugeordnet wird
statt in den ungefilterten Fallback zu laufen.

### Negative Testfälle (ein Gate pro Stufe)

Für jedes der folgenden Gates gilt dasselbe Muster: in einer Testkopie des
jeweiligen Workflows (Hauptworkflow oder Subworkflow, siehe Klammerhinweis)
wird die vorausgehende `erzeugen`/`durchführen`-Node so verändert, dass ein
Pflichtfeld fehlt oder eine Mindestbedingung verletzt ist, danach wird der
positive Testfall erneut ausgeführt.

1. **Teamdiagnose gültig?** (intern in `team-analysieren-subworkflow.json`) —
   `teamDiagnosis.mainProblem` entfernen. **Erwartet:** **Teamdiagnose
   prüfen** setzt `valid: false`; im Hauptworkflow greift **Team analysieren
   gültig?** und die Anzeige zeigt die Fehlermeldung "Die Teamdiagnose ist
   ungültig …" statt einer Diagnose.
2. **Spielerprofil gültig?** (intern in `scouting-brief-subworkflow.json`) —
   `playerProfile.reasoning` entfernen. **Erwartet:** Fehlermeldung "Das
   Spielerprofil ist ungültig …", ausgelöst über das Hauptworkflow-Gate
   **Scouting Brief gültig?**.
3. **Spielersuche gültig?** (intern in `kandidaten-suchen-subworkflow.json`) —
   `playerSearch.shortlist` auf ein leeres Array setzen. **Erwartet:**
   Fehlermeldung "Die Spielersuche ist ungültig …", ausgelöst über
   **Kandidaten suchen gültig?**.
3a. **Spielersuche gültig?** (ignoriertes Constraint) — `playerRanking.ignoredConstraints`
   auf `[{ field: 'marketValueMEUR', operator: 'max', value: 5 }]` setzen,
   während `playerSearch.shortlist` ansonsten gültig bleibt. **Erwartet:**
   **Spielersuche prüfen** setzt trotz gültiger Shortlist `valid: false` mit
   einer Fehlermeldung, die `ignoredConstraints` nennt.
3b. **Spielersuche gültig?** (ignoriertes Kriterium) — `playerRanking.ignoredCriteria`
   auf `['rating']` setzen, während `playerSearch.shortlist` ansonsten
   gültig bleibt. **Erwartet:** **Spielersuche prüfen** setzt trotz gültiger
   Shortlist `valid: false` mit einer Fehlermeldung, die `ignoredCriteria`
   nennt.
3c. **Spielersuche gültig?** (Positions-Fallback) — `playerRanking.positionFallbackApplied`
   auf `true` setzen, während `playerSearch.shortlist` ansonsten gültig
   bleibt. **Erwartet:** **Spielersuche prüfen** setzt trotz gültiger
   Shortlist `valid: false` mit einer Fehlermeldung, die
   `positionFallbackApplied` nennt.
4. **Recherche gültig?** (intern in `due-diligence-subworkflow.json`) — vor
   **Due Diligence** `playerSearch.shortlist` auf ein leeres Array setzen.
   **Erwartet:** **Shortlist vorhanden?** routet direkt zu **Recherche
   prüfen**, die den Fehlerfall "research fehlt oder ist leer" erkennt;
   Fehlermeldung "Die Recherche ist ungültig …", ausgelöst über **Due
   Diligence gültig?**.
4a. **Recherche gültig?** (alle Research-Zweige fehlgeschlagen) — im
   Recherche-Subworkflow (**Recherche-Dummy für Kandidat erzeugen**) für
   jeden Kandidaten `researchCandidateName` leeren, sodass jeder
   Research-Zweig über den Fehlerausgang von **Recherche je Kandidat
   durchführen** läuft. **Erwartet:** **Recherche-Ergebnisse
   zusammenführen** markiert jeden Kandidaten als `uncertain: true`;
   **Recherche prüfen** erkennt, dass **alle** Zweige unsicher sind, und
   setzt trotzdem `valid: false` (keine verwertbare Recherche für die
   gesamte Shortlist) statt eine Empfehlung ohne jede belastbare Due
   Diligence durchzulassen.
4b. **Recherche gültig?** (ein einzelner Zweig fehlgeschlagen, Rest bleibt
   gültig) — nur für **einen** Kandidaten der Shortlist
   `researchCandidateName` leeren. **Erwartet:** nur dieser eine
   Research-Zweig läuft über den Fehlerausgang und wird als `uncertain:
   true` markiert; die übrigen Zweige bleiben erfolgreich; **Recherche
   prüfen** akzeptiert das Ergebnis weiterhin als `valid: true` (ein
   fehlgeschlagener Zweig bleibt Unsicherheit am betroffenen Kandidaten,
   macht aber nicht die gesamte Due Diligence ungültig); **Empfehlung
   erzeugen** vergibt diesem Kandidaten anschließend einen
   Feasibility-Score von `0`.
5. **Final Validation gültig?** (intern in
   `ergebnis-aufbereiten-subworkflow.json`) — in **Empfehlung erzeugen**
   (`empfehlung-erstellen-subworkflow.json`) `recommendation.candidate` auf
   einen Namen setzen, der nicht Teil der Shortlist ist. **Erwartet:** die
   leichtgewichtige **Empfehlung technisch gültig?**-Prüfung im
   `empfehlung-erstellen-subworkflow.json` bleibt `true` (rein struktureller
   Check), aber **Final Validation** in **Ergebnis aufbereiten** erkennt,
   dass `recommendation.candidate` nicht Teil der validierten Shortlist ist,
   und setzt `valid: false`; Fehlermeldung "Die finale Validierung ist
   fehlgeschlagen …", ausgelöst über das Hauptworkflow-Gate **Ergebnis
   aufbereiten gültig?** (fängt damit auch einen Fehler ab, der die
   einzelnen Stufen-Gates unbeschädigt durchlaufen hat).
6. **Recherche gültig?** (Kandidatenabdeckung) — in **Kandidaten für
   Recherche aufteilen** (`due-diligence-subworkflow.json`) den Fan-out so
   verändern, dass für den letzten Shortlist-Kandidaten kein eigenes Item
   entsteht, sondern stattdessen ein zweites Item für den ersten Kandidaten.
   **Erwartet:** **Recherche prüfen** erkennt sowohl das Duplikat als auch
   den fehlenden Kandidaten und setzt `valid: false`.
7. **Final Validation gültig?** (vollständiger Empfehlungsvertrag) — in
   **Empfehlung erzeugen** einzeln `alternatives`, `risks` bzw.
   `uncertainties` aus der Empfehlung entfernen oder auf ein leeres Array
   setzen. **Erwartet:** **Empfehlung technisch gültig?**
   (`empfehlung-erstellen-subworkflow.json`) erkennt bereits denselben
   fehlenden Pflicht-Vertrag und setzt `valid: false`, ausgelöst über das
   Hauptworkflow-Gate **Empfehlung gültig?** (Ergebnis aufbereiten wird in
   diesem Fall gar nicht mehr erreicht); **Final Validation** in **Ergebnis
   aufbereiten** prüft denselben Vertrag zusätzlich noch einmal
   phasenübergreifend ab, für den Fall, dass ein künftiger Ersatz von
   **Empfehlung erzeugen** die leichtgewichtige Prüfung umgeht.
8. **Spielerprofil gültig?** (Positions-/Diagnose-Konsistenz) —
   **Spielerprofil LLM** liefert eine `position` außerhalb des durch
   `teamDiagnosis.diagnosisCategory` vorgegebenen Pools. **Erwartet:**
   **Spielerprofil prüfen** erkennt dies über die generische
   Konsistenzprüfung und setzt `valid: false`.
9. **Teamdiagnose: Datengrundlage ausreichend?** (`no_data` stoppt
   kontrolliert, intern in `team-analysieren-subworkflow.json`) —
   `teamDiagnosis.diagnosisCategory` auf `'no_data'` setzen. **Erwartet:**
   **Teamdiagnose: Datengrundlage prüfen** setzt `valid: false`, der gesamte
   restliche Ablauf (Spielerprofil, Kandidaten suchen, Due Diligence,
   Empfehlung) wird über **Team analysieren gültig?** im Hauptworkflow
   **nicht** mehr erreicht.
10. **Scouting Brief gültig?** (intern) — `playerProfile.reasoning` vor
    **Scouting Brief erstellen** entfernen. **Erwartet:** **Scouting Brief
    prüfen** setzt `valid: false`, die Anzeige zeigt "Das Scouting Brief ist
    ungültig …" (ausgelöst über das Hauptworkflow-Gate **Scouting Brief
    gültig?**) statt der Freigabeseite.
11. **Review-Entscheidung gültig?** (Request Changes ohne Feedback) — im
    Formular **Scouting Brief zur Freigabe vorlegen** `Entscheidung` =
    `Request Changes` waehlen und `Feedback` leer lassen. **Erwartet:**
    **Review-Entscheidung auswerten** setzt `valid: false`; die
    Kandidatensuche stoppt kontrolliert über **Fehler anzeigen**.
12. **Review: Request Changes?** (begrenzter Feedback-Loop) — im Formular
    dreimal hintereinander `Request Changes` mit nichtleerem Feedback waehlen.
    **Erwartet:** die ersten beiden Runden rufen erneut **Execute Workflow:
    Scouting Brief erstellen** auf (mit `reviewFeedback` im Prompt) und
    legen ein überarbeitetes Scouting Brief erneut vor (`reviewRound` 2, dann
    3); bei der dritten `Request Changes`-Entscheidung setzt
    **Review-Entscheidung auswerten** `maxRoundsReached: true` und
    `reviewOutcome: 'Reject'`, sodass **Scouting Brief: Ablehnung
    dokumentieren** die Kandidatensuche kontrolliert über **Fehler anzeigen**
    beendet.
13. **Review: Approve?** (Reject) — im Formular `Entscheidung` = `Reject`
    waehlen. **Erwartet:** **Scouting Brief: Ablehnung dokumentieren**
    formuliert eine `errorMessage`, die auf die Ablehnung durch den Reviewer
    hinweist, und die Anzeige zeigt diese über **Fehler anzeigen** statt
    einer Empfehlung.
14. **Review: Request Changes?** (Reviewer-Alters-/Budgetlimit wird wirksam) —
    im Formular ein konkretes Limit im Feedback angeben (z. B. „bitte nur
    Kandidaten unter 10 Mio. Marktwert vorschlagen"). **Erwartet:** die
    Folgerunde von **Spielerprofil LLM** (in `scouting-brief-subworkflow.json`)
    liefert ein `playerProfile.constraints` mit genau diesem Limit, das
    unveraendert in `scoutingBrief.constraints` der Folgerunde landet, und
    nach **Approve** wendet **Player-Ranking-Anfrage vorbereiten**/der
    Player-Ranking-Subworkflow (jetzt in `kandidaten-suchen-subworkflow.json`)
    es tatsaechlich an.

**Ausgeführt (gezielte Node.js-Verifikation):** Fälle 1–8 (inkl. 3a–3c,
4a–4b) wurden isoliert gegen die 1:1 aus den jeweiligen Subworkflow-Dateien
übernommenen Code-Node-Funktionen verifiziert (siehe „Positiver Testfall"
oben, sowie die Simulation der neuen Fan-out-/Fan-in-Nodes in **Kandidaten
suchen** und **Due Diligence**); Fall 9
wurde isoliert mit Node.js gegen **Teamdiagnose: Datengrundlage prüfen**
verifiziert; die Fälle 10–12 wurden isoliert mit Node.js gegen die 1:1 aus
`scouting-brief-subworkflow.json`/`ai-sporting-director.json` übernommenen
Funktionen in `n8n/data/verify-scouting-brief-review.js` verifiziert; Fall 13
(Reject) teilt sich denselben `evaluateReview`-Codepfad wie Fall 12; Fall 14
(Reviewer-Alters-/Budgetlimit) wurde für den Teil bis einschließlich
`scoutingBrief.constraints` ebenfalls isoliert mit Node.js in
`n8n/data/verify-scouting-brief-review.js` verifiziert — der Teil ab
**Player-Ranking-Anfrage vorbereiten** deckt sich mit der bereits
bestehenden, isolierten Constraint-Filterung des Player-Ranking-Subworkflows.
Nicht ausgeführt: das manuelle Editieren der Nodes bzw. Ausfüllen des
Freigabe-Formulars und Beobachten der **Executions**-Liste in einer
laufenden n8n-Instanz — offen für die nächste Person (oder Session) mit
interaktivem Zugriff.

### Negativer Testfall (Validierung des Startformulars)

Unverändert gegenüber dem bisherigen Workflow: leeres/nur aus Leerzeichen
bestehendes `objective` per direktem HTTP-Request (z. B. `curl`) einreichen.
**Erwartet:** **Eingabe validieren** routet zu **Validierungsfehler
formulieren** → **Fehler anzeigen** mit der Meldung, `Verein` und die
Zielsetzung auszufüllen — keine Dummy-Diagnose oder -Empfehlung wird
angezeigt.

### Regressionstest: alle Workflow-Dateien sind in sich konsistent

Der Hauptworkflow (`ai-sporting-director.json`, 24 Nodes) trägt seit der
Restrukturierung nur noch die **fachlichen Phasen plus zentrales
Routing/Review** der HSV-Formular-Story; die sechs **fachlichen**
Subworkflow-Dateien (`team-analysieren-subworkflow.json`, 16 Nodes;
`scouting-brief-subworkflow.json`, 13 Nodes; `kandidaten-suchen-subworkflow.json`,
11 Nodes; `due-diligence-subworkflow.json`, 8 Nodes;
`empfehlung-erstellen-subworkflow.json`, 8 Nodes;
`ergebnis-aufbereiten-subworkflow.json`, 5 Nodes) tragen die technischen
Details je fachlicher Fähigkeit; die fünf **technischen** Subworkflow-Dateien
(Recherche + die vier CSV-Analytics-Tools) bleiben strukturell (Tool-Verträge,
feste IDs) unverändert bestehen — bis auf `recherche-subworkflow.json`, das
seit der Due-Diligence-Parallelisierung nur noch einen einzelnen Kandidaten je
Ausführung verarbeitet (siehe [Recherche-Subworkflow](#recherche-subworkflow)
oben).
Beim Import (alle elf Subworkflows zuerst, `n8n/ai-sporting-director.json`
danach, siehe [Import & run](#import--run)) öffnet sich der Hauptworkflow mit
den 24 oben beschriebenen Nodes; jeder fachliche Subworkflow öffnet sich mit
seinen eigenen Nodes (siehe die jeweiligen Abschnitte oben); jeder der fünf
technischen Subworkflows öffnet sich mit seinen (bei `recherche-subworkflow.json`
angepassten) Nodes.

Alle dreizehn Workflow-Dateien wurden außerhalb von n8n als wohlgeformtes JSON
mit eindeutigen Node-Namen/-IDs innerhalb jeder Datei, Connections, die
ausschließlich existierende Nodes referenzieren, jeweils genau einem
erwarteten Trigger-Node (Form Trigger bzw. Execute Workflow Trigger) und
ohne überlappende Node-`position`-Koordinaten innerhalb einer Datei geprüft
(Node.js-Konsistenzcheck, siehe Commit-Historie). Keine Datei enthält
Klartext-Credential- oder -Workflow-IDs außer den dokumentierten
Platzhaltern/festen Subworkflow-IDs.

**Nicht ausgeführt:** der tatsächliche Import in eine laufende n8n-Instanz —
offen für die nächste Person (oder Session) mit interaktivem Zugriff.

### Regressionstest: aktiver Ollama-Node

1. Open the imported **`team-analysieren-subworkflow.json`** and select its
   **Ollama Modell (Qwen3.8:latest)** node (independently, repeat for
   **`scouting-brief-subworkflow.json`**'s own instance of this node).
   **Expected result:** the model field shows `Qwen3.8:latest`, **Options →
   Think** is enabled, and **Credential to connect with** references
   `[cimt] Ollama` (select the existing local credential here in **both**
   files — the import cannot resolve the instance-specific credential ID
   automatically, and each file has its own node instance).
2. **Expected result:** in each file, the node has exactly one outgoing
   `ai_languageModel` connection (to **Teamdiagnose LLM** in
   `team-analysieren-subworkflow.json`, to **Spielerprofil LLM** in
   `scouting-brief-subworkflow.json`) and no incoming connection
   (language-model sub-nodes are only ever a connection source). Running the
   positive test case above therefore requires a real, reachable local
   Ollama instance with the referenced credential configured in both files;
   without one, both LLM chain nodes fail and their respective subworkflow
   execution ends on its local **LLM-Fehler normalisieren** → **... :
   Ergebnis** node with `valid: false`, which the main workflow then routes
   to **Fehler anzeigen** via its **Team analysieren gültig?** /
   **Scouting Brief gültig?** gate instead of reaching **Ergebnis anzeigen**.

### Regressionstest: aktive Fehler-Normalisierung

1. Open **`team-analysieren-subworkflow.json`** (repeat for
   **`scouting-brief-subworkflow.json`**) and select the **LLM-Fehler
   normalisieren** node. **Expected result:** the node is a Code node
   connected to the file's local **... : Ergebnis** NoOp node as its only
   output, and has exactly one incoming connection — the error output
   (`onError: continueErrorOutput`) of the file's own LLM chain node
   (**Teamdiagnose LLM** / **Spielerprofil LLM**).
2. Open a test copy of the subworkflow, temporarily wire a manual trigger
   into **LLM-Fehler normalisieren** and run it once with the input item
   `{ "error": "Verbindung zu Ollama fehlgeschlagen (Testfall)" }` — the real
   shape n8n 2.35.7's **Basic LLM Chain** produces on its error output when
   `onError: continueErrorOutput` is set (`json: { error: error.message }`,
   i.e. `$json.error` is a **string**, not an object).
   **Expected result:** the node's output contains `valid: false` and
   `errorMessage` with the text "Bei der Kommunikation mit dem lokalen
   Ollama-Modell ist ein Fehler aufgetreten. Bitte versuchen Sie es später
   erneut.\n\nDetails: Verbindung zu Ollama fehlgeschlagen (Testfall)".
3. Repeat step 2 with the input item
   `{ "error": { "message": "Verbindung zu Ollama fehlgeschlagen (Testfall)" } }`
   (object shape). **Expected result:** the same `errorMessage` text as in
   step 2 — the node still extracts the message correctly.
4. Repeat step 2 with an input item that has no `error` field.
   **Expected result:** `errorMessage` falls back to "... Details:
   Unbekannter Fehler" instead of throwing, `valid` stays `false`.

## Migration der Altworkflows

Die beiden früheren Altworkflow-Dateien in diesem Verzeichnis (ein
Hello-World-Workflow und ein Frage-Antwort-Workflow) wurden gegen eine frühe
Analyse geprüft und aus dem Repository entfernt, bevor die Dummy-Pipeline
hinzukam:

- **Der Hello-World-Altworkflow** enthielt nur einen Manual Trigger und ein
  statisches `Hello World`-Feld. Keine seiner Fähigkeiten wurde benötigt;
  die Datei wurde ersatzlos gelöscht.
- **Der Frage-Antwort-Altworkflow** enthielt ein generisches
  Frage/Antwort-Formular mit einer echten Ollama-Anbindung. Das Formular und
  die einfache LLM-Chain sind durch den Hauptworkflow abgelöst und wurden
  nicht übernommen. Die Ollama-Konfiguration selbst (Modell
  `Qwen3.8:latest`, aktiviertes Thinking, Credential-Referenz `[cimt]
  Ollama` ohne echte ID oder Secret) wurde 1:1 als Node **Ollama Modell
  (Qwen3.8:latest)** übernommen — heute als zwei eigenständige Node-Instanzen
  in `team-analysieren-subworkflow.json` und `scouting-brief-subworkflow.json`
  (siehe Einleitung oben zur Duplizierung technischer Utility-Nodes über
  Subworkflow-Grenzen hinweg). Das kontrollierte Fehler-Routing dieses
  Altworkflows (`onError: continueErrorOutput` am Chain-Node, verständliche
  Fehleranzeige aus dem Fehler-Output) wurde ebenfalls übernommen, als der
  Node **LLM-Fehler normalisieren** (heute ebenfalls zwei eigenständige
  Kopien in denselben zwei Dateien).

Ein Offline-Simulator für den kompletten Hauptworkflow
(`n8n/data/simulate_main_workflow.js`) existierte zwischenzeitlich, ist aber
mit der Umstellung der Analytics-Subworkflows auf die persistente Data Table
`football_scouting_raw` entfallen — er beruhte auf einem inzwischen
entfernten, fünf Vereine umfassenden CSV-Prototyp und ist für die reale
Datenquelle nicht mehr repräsentativ. Die verbliebenen Node.js-Verifikationen
in `n8n/data/` (`verify-club-canonical-map.js`, `verify-scouting-brief-review.js`,
`verify-import-architecture.js`) testen stattdessen einzelne Code-Nodes 1:1
aus ihrem `jsCode`-Inhalt, gelesen aus der Workflow-Datei, in der der
jeweilige Node aktuell liegt (siehe die Abschnitte oben).

`ai-sporting-director.json` ist damit weiterhin der einzige Hauptworkflow in
diesem Repository. Alle übrigen `n8n/*.json`-Dateien sind Subworkflows: die
sechs fachlichen Subworkflows (`team-analysieren-subworkflow.json`,
`scouting-brief-subworkflow.json`, `kandidaten-suchen-subworkflow.json`,
`due-diligence-subworkflow.json`, `empfehlung-erstellen-subworkflow.json`,
`ergebnis-aufbereiten-subworkflow.json`)
sowie die fünf technischen Subworkflows (`recherche-subworkflow.json` und die
vier `analytics-*-subworkflow.json`-Dateien des
[CSV-Analytics-Adapters](#csv-analytics-adapter)) — zusammen mit
`import-scouting-data.json` (Daten-Import, kein Teil des Sporting-Director-
Ablaufs selbst) die einzigen erlaubten Ausnahmen vom Grundsatz „ein
Hauptworkflow, keine parallele Kopie".
