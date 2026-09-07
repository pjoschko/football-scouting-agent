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
ist.

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
        → Spielerprofil-Positionspool ermitteln → Spielerprofil-LLM (Ollama)
        → Spielerprofil zusammenfuehren → Spielerprofil pruefen → Gate
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
   zu benennen. `onError: continueErrorOutput` leitet einen Fehler (z. B.
   Ollama nicht erreichbar) auf den zweiten Output an **LLM-Fehler
   normalisieren** statt den Workflow abzubrechen.
10. **Teamdiagnose Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
    — erzwingt (`schemaType: manual`) den unter 9. genannten JSON-Vertrag für
    **Teamdiagnose LLM**; `evidence` ist bewusst **nicht** Teil dieses
    Schemas (siehe 8.).
11. **Teamdiagnose zusammenführen** (Code) — die Basic LLM Chain liefert bei
    aktivem Output Parser nur `{ output: <geparstes Objekt> }` als
    Main-Output, der Rest des Items geht dabei verloren; dieser Node holt das
    vollständige Item über `$('Teamdiagnose: Evidenz aufbereiten').item.json`
    zurück und baut `teamDiagnosis` aus dem deterministischen
    `teamDiagnosisEvidence` (→ `evidence`) und der LLM-Interpretation (→
    `diagnosisCategory`, `leagueComparison`, `hypotheses`,
    `counterHypotheses`, `mainProblem`, `uncertainties`) zusammen
    (`teamDiagnosis.simulated: false`, `dataAvailable: true`). Läuft
    anschließend in dieselbe **Teamdiagnose prüfen** wie der No-Data-Zweig.
12. **Teamdiagnose prüfen** (Code) — erweitert: prüft wie bisher, dass
    `evidence`/`hypotheses` nichtleere Arrays sind, `mainProblem` ein
    nichtleerer String ist und `uncertainties` ein Array ist, **zusätzlich**
    jetzt auch, dass `leagueComparison` ein nichtleerer String und
    `counterHypotheses` ein Array ist; setzt `valid`/`errorMessage`.
13. **Teamdiagnose gültig?** (IF) — **falsch** → **Fehler anzeigen**; **wahr**
    → **Spielerprofil: Positionspool ermitteln**.
14. **Spielerprofil: Positionspool ermitteln** (Code) — grenzt den
    Positionspool generisch anhand von `teamDiagnosis.diagnosisCategory` ein
    (Defensivproblem → defensive Positionen, Offensivproblem → offensive
    Positionen, `neutral`/`no_data` → alle Positionen; kein Sonderfall für
    einen bestimmten Verein oder eine bestimmte Position) und übergibt diesen
    Pool als `allowedPositions` verbindlich an **Spielerprofil LLM**.
15. **Spielerprofil LLM** (`@n8n/n8n-nodes-langchain.chainLlm`, Basic LLM
    Chain) — leitet aus der (jetzt LLM-erzeugten) Teamdiagnose sowie
    `club`/`objective`/`additionalContext` ein strukturiertes
    Anforderungsprofil ab, über dasselbe **Ollama Modell (Qwen3.8:latest)**
    und erzwungen durch **Spielerprofil Output-Schema**: `position` (die
    Instruktion verlangt ausdrücklich, ausschließlich aus `allowedPositions`
    zu wählen), `role`, `weightedCriteria` (Kriteriennamen, die
    **Player-Ranking** erkennt: `goals`, `assists`, `rating`,
    `appearances`, `age`, `minutesPlayed`, `marketValueMEUR`), `constraints`
    und `reasoning` (muss sich auf `teamDiagnosis.mainProblem` beziehen).
    Gleiches `onError: continueErrorOutput` → **LLM-Fehler normalisieren**
    wie bei **Teamdiagnose LLM**.
16. **Spielerprofil Output-Schema** (`@n8n/n8n-nodes-langchain.outputParserStructured`)
    — erzwingt den unter 15. genannten JSON-Vertrag für **Spielerprofil
    LLM**.
17. **Spielerprofil zusammenführen** (Code) — holt das vollständige Item über
    `$('Spielerprofil: Positionspool ermitteln').item.json` zurück (gleicher
    Mechanismus wie bei **Teamdiagnose zusammenführen**) und setzt
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
19. **Spielerprofil gültig?** (IF) — **falsch** → **Fehler anzeigen**;
    **wahr** → **Player-Ranking-Anfrage vorbereiten**.
20. **Player-Ranking-Anfrage vorbereiten** (Code) — übersetzt `playerProfile`
    in den Tool-Vertrag von Player-Ranking: `rankingExcludeClub` = der
    diagnostizierte Verein (Scouting sucht außerhalb des eigenen Kaders),
    `position`/`criteria` aus `playerProfile.position`/`weightedCriteria`,
    `limit: 5`.
21. **Player-Ranking abrufen** (Execute Workflow) — ruft
    [`analytics-player-ranking-subworkflow.json`](./analytics-player-ranking-subworkflow.json)
    auf (Tool „Player-Ranking“) und reichert das Item um `playerRanking` an.
22. **Spielersuche durchführen** (Code) — leitet `longlistSize` und eine
    `shortlist` von bis zu fünf Kandidaten (`score`, `strengths`,
    `weaknesses`, `evidence` jeweils aus echten `players.csv`-Werten
    gegenüber dem Pool-Durchschnitt) aus `playerRanking` ab
    (`playerSearch.simulated: false`). Liefert der Adapter keine Kandidaten
    (z. B. weil der komplette Markt für die Anfrage leer ist), bleibt
    `shortlist` leer statt Kandidaten zu erfinden — das nachfolgende Gate
    greift dann reell.
23. **Spielersuche prüfen** (Code) — unverändert: prüft `longlistSize > 0`,
    `shortlist` nichtleer und **höchstens fünf** Kandidaten, sowie dass jeder
    Kandidat alle Pflichtfelder hat.
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
28. **Empfehlung erzeugen** (Code) — unverändert: wählt den Kandidaten mit dem
    höchsten `score` aus `playerSearch.shortlist` als bevorzugten Kandidaten
    (damit stammt er per Konstruktion aus der validierten Shortlist), die
    übrigen Shortlist-Namen werden `alternatives`; dazu `reasoning`, `risks`,
    `uncertainties`, `nextStep`.
29. **Player-Profil-Anfrage vorbereiten** (Code) — setzt `playerName` auf
    `recommendation.candidate`.
30. **Player-Profil abrufen** (Execute Workflow) — ruft
    [`analytics-player-profile-subworkflow.json`](./analytics-player-profile-subworkflow.json)
    auf (Tool „Player-Profil“) und reichert das Item um `playerProfileLookup`
    an. Da der Kandidat selbst aus `players.csv` stammt (über Player-Ranking),
    wird er hier immer gefunden.
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
selbst liegen versioniert in [`n8n/data/`](./data/README.md)
(`matches.csv`, `players.csv`) für dieselben fünf Vereine wie im
`Verein`-Dropdown. Kein Tool erfindet Werte für unbekannte Vereine, Spieler
oder Positionen — stattdessen wird das explizit ausgewiesen (`dataAvailable:
false`, `found: false` bzw. `positionFallbackApplied: true`). Dasselbe gilt
für einzelne fehlende/ungültige numerische CSV-Zellen (leerer Wert,
nicht-numerischer Text): sie werden validiert, statt per `Number(...)`
stillschweigend zu `0` bzw. `NaN` zu werden, und fließen explizit markiert
(`invalidMatches`, `dataError`, `excludedInvalidData`/`invalidFields`, siehe
unten) nicht in Aggregation oder Ranking-Score ein.

1. **Teamperformance**
   ([`analytics-team-performance-subworkflow.json`](./analytics-team-performance-subworkflow.json)) —
   Input `{ club }`. Aggregiert die letzten Spiele des Vereins aus
   `matches.csv` zu `teamPerformance`: `matchesAnalyzed`, `wins`/`draws`/`losses`,
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
   criterion, weight }], limit? }` (bewusst eigene Feldnamen statt `club`, da
   das im Hauptworkflow bereits den zu diagnostizierenden Verein bezeichnet
   und beim Durchreichen des ganzen Items sonst kollidieren würde).
   `rankingClub` filtert auf genau einen Verein, `rankingExcludeClub`
   schließt genau einen Verein aus (so sucht die Spielersuche außerhalb des
   eigenen Kaders). Erkannte, generische `criteria`-Namen: `goals`,
   `assists`, `rating`, `minutesPlayed`, `appearances`, `marketValueMEUR`
   (höher = besser) sowie `age` (niedriger = besser); jeder Wert wird über
   den betrachteten Pool min-max-normalisiert und gewichtet aufsummiert.
   Unbekannte Kriterien werden nicht ignoriert-und-verschwiegen, sondern in
   `ignoredCriteria` aufgeführt; eine nicht im Pool vorkommende Position
   führt — explizit über `positionFallbackApplied: true` markiert — zum
   Rückfall auf den ungefilterten Pool statt zu erfundenen Kandidaten. Ein
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
   `profile` (alle Spalten aus `players.csv`) bzw. `found: false` und
   `profile: null` für einen unbekannten Namen. Einzelne fehlende/ungültige
   numerische Felder im gefundenen Datensatz bleiben in `profile` explizit
   `null` (statt `0`/`NaN`) und werden namentlich in `invalidFields`
   aufgeführt; `profile.dataError: true` markiert einen unvollständigen
   Datensatz. Heißt bewusst
   `playerProfileLookup`, nicht `playerProfile` — Letzteres bezeichnet im
   Hauptworkflow bereits das simulierte Bedarfsprofil (Anforderung an den
   gesuchten Spielertyp), beide Verträge bleiben dadurch unabhängig
   voneinander stabil.

Die eingebetteten CSV-Kopien in den vier Subworkflows werden aus
`n8n/data/matches.csv` / `n8n/data/players.csv` generiert und mit
Node.js-Skripten verifiziert — siehe [`n8n/data/README.md`](./data/README.md)
für `build_subworkflows.js`, `verify-analytics.js` und
`simulate_main_workflow.js`.

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
   the browser shows the **Ergebnis anzeigen** page with five clearly
   separated sections — Teamdiagnose, Spielerprofil, Spielersuche,
   Recherche, Empfehlung — with a hint distinguishing the sections backed by
   the CSV-Analytics-Adapter and the LLM interpretation (Teamdiagnose,
   Spielerprofil, Spielersuche) from the still fully simulated one
   (Recherche), and the recommended candidate is one of the shortlisted CSV
   players (not the Hamburger SV squad itself). In the n8n **Executions**
   list the run is successful and passes all six gates (**Teamdiagnose
   gültig?**, **Spielerprofil gültig?**, **Spielersuche gültig?**,
   **Recherche gültig?**, **Final Validation gültig?**, plus **Eingabe
   validieren**); zusätzlich wird die Routing-IF **Teamdiagnose:
   Datenverfügbarkeit prüfen** in ihren Wahr-Zweig verzweigt (kein Gate im
   engeren Sinn, da beide Zweige gültig fortsetzen), und **Teamdiagnose
   LLM**/**Spielerprofil LLM** laufen jeweils über ihren Erfolgs-Output.
   **Ausgeführt (Logiksimulation):** `node n8n/data/simulate_main_workflow.js`
   führt alle `Code`- und Execute-Workflow-Nodes des Hauptworkflows sowie
   aller fünf Subworkflows (Recherche + die vier CSV-Analytics-Tools)
   außerhalb von n8n mit Node.js gegen die HSV-Beispieldaten
   (`club: "Hamburger SV"`, das voreingestellte `objective`) sowie gegen
   Bayern und Leverkusen als weitere Vereine aus. Die beiden
   `@n8n/n8n-nodes-langchain.chainLlm`-Nodes (**Teamdiagnose LLM**,
   **Spielerprofil LLM**) werden dabei durch einen deterministischen Mock
   ersetzt (siehe Kommentar in `simulate_main_workflow.js`) — es gibt in
   dieser Umgebung keinen erreichbaren Ollama-Endpunkt, der Mock testet daher
   nachweisbar nur die umgebende Pipeline (Merge-Nodes, Gates,
   Positions-Konsistenzprüfung, Player-Ranking), **nicht** die tatsächliche
   Antwortqualität eines echten lokalen Modells. Ergebnis: der komplette Pfad
   läuft durch, `teamDiagnosis.mainProblem` benennt für HSV korrekt ein
   Defensivproblem (mehr Gegentore als eigene Tore in den letzten sechs
   CSV-Spielen) und für Leverkusen ein Offensivproblem, der empfohlene
   Kandidat stammt aus einem anderen Verein als dem angefragten und
   `recommendation.candidateProfile` enthält dessen echtes CSV-Profil. Für
   HSV/Leverkusen wird zusätzlich geprüft, dass die aus `diagnosisCategory`
   abgeleitete `playerProfile.position` tatsächlich zur Diagnose passt
   (defensiv bzw. offensiv) und dass sowohl alle gerankten Kandidaten als
   auch der empfohlene Kandidat wirklich auf dieser Position spielen — die
   (jetzt LLM-interpretierte) Diagnose beeinflusst die Transfermaßnahme damit
   nachweisbar. Ein zusätzlicher Negativtest erzwingt eine Mock-LLM-Antwort
   mit einer zur Diagnosekategorie inkonsistenten Position und prüft, dass
   **Spielerprofil prüfen** dies unabhängig vom (an sich schema-gültigen)
   Parser-Output als `valid: false` erkennt. Siehe
   [`n8n/data/README.md`](./data/README.md) für das Skript selbst.
   Nicht ausgeführt: das eigentliche Rendern der Formular-/Completion-Seiten,
   der n8n-**Executions**-Eintrag selbst sowie ein echter Aufruf des lokalen
   Ollama-Modells (Antwortqualität/Prompt-Befolgung), da dafür eine laufende
   n8n-Weboberfläche mit erreichbarem Ollama-Endpunkt nötig ist — offen für
   die nächste Person (oder Session) mit interaktivem Zugriff auf eine
   importierte Instanz.

### CSV-Analytics-Adapter: gezielte Tests

`node n8n/data/verify-analytics.js` prüft die vier CSV-Analytics-Subworkflows
isoliert gegen `matches.csv`/`players.csv` (Positionsfilter, `rankingClub`/
`rankingExcludeClub`, sowie dass ein unbekannter Verein, Spieler oder eine
unbekannte Position explizit ausgewiesen statt erfunden wird), dazu
Negativtests mit leeren/ungültigen CSV-Zellen (fehlende Tordaten, fehlendes
`age`/ungültiges `rating` einzelner Spieler) gegen eigens dafür eingesetzte
Test-CSVs — siehe [`n8n/data/README.md`](./data/README.md) für die
vollständige Liste der Prüfungen. **Ausgeführt:** alle 25 Prüfungen sind
grün.

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
8. **Spielerprofil gültig?** (Positions-/Diagnose-Konsistenz) —
   **Spielerprofil LLM** liefert eine `position` außerhalb des durch
   `teamDiagnosis.diagnosisCategory` vorgegebenen Pools (z. B. eine
   offensive Position bei einer Defensivdiagnose). **Erwartet:**
   **Spielerprofil prüfen** erkennt dies über die generische
   Konsistenzprüfung (unabhängig vom an sich schema-gültigen
   Parser-Output) und setzt `valid: false` mit einer Fehlermeldung, die die
   inkonsistente Position und die erwartete Diagnosekategorie benennt.

**Ausgeführt (Logiksimulation):** Alle acht Fälle wurden wie oben beschrieben
mit Node.js gegen die HSV-Beispieldaten durchgespielt (jeweils ein einzelnes
Feld/Array gezielt entfernt, geleert, dupliziert oder — bei Fall 8 — die
Mock-LLM-Antwort gezielt auf eine inkonsistente Position gesetzt, alle
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
Story trägt; die fünf technischen Subworkflow-Dateien (Recherche + die vier
CSV-Analytics-Tools) sind die einzigen weiteren Dateien. Beim Import (die
fünf Subworkflows zuerst, `n8n/ai-sporting-director.json` danach, siehe
[Import & run](#import--run)) öffnet sich der Hauptworkflow mit allen 39 hier
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
