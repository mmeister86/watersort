# Water Sort PWA – Bauplan

Oct 4, 2026 · @Matthias Meister

## TL;DR

Ein Docker-Container auf Coolify, ein Node-Server, eine JSON-Datei, null Werbung. Realistisch an 2–3 Abenden spielbar.

- **Level = Zahl + Seed.** Level 37 wird aus dem Seed 37 erzeugt. Jeder bekommt dasselbe Level 37. Gespeichert wird nur die Level-Nummer, nie das Level selbst.
- **Immer lösbar:** Generator mischt zufällig, ein eingebauter Solver prüft. Unlösbar oder zu leicht → nächster Versuch. Kein Level erreicht je den Spieler ohne bewiesene Lösung.
- **Graduell schwerer** über 4 Stellschrauben: Farben, leere Röhren, Röhrenhöhe, versteckte Schichten.
- **Datenbank** = eine `data.json` auf einem Coolify-Volume. Atomar schreiben, fertig.
- **PWA:** installierbar auf dem Homescreen, spielt offline, synct beim nächsten Kontakt.

## Spielregeln & Features

Regeln wie im Original: Röhre antippen, dann Ziel-Röhre antippen. Gießen geht nur, wenn das Ziel leer ist oder oben dieselbe Farbe hat und Platz da ist. Es fließt die ganze gleichfarbige Oberschicht, soweit sie passt. Gewonnen, wenn jede Röhre leer oder voll mit einer Farbe ist.

| Feature | MVP | Später |
| --- | --- | --- |
| Spielerprofile (Name + Avatar-Farbe) | ja |  |
| Familien-Code beim ersten Öffnen (gegen Fremde) | ja |  |
| Endlos-Level, Fortschritt pro Spieler | ja |  |
| Rückgängig (unbegrenzt) + Neustart | ja |  |
| Gieß-Animation (CSS) | ja |  |
| Tipp-Button (Solver zeigt den nächsten Zug) |  | ja |
| Extra-Röhre als Joker (z. B. 1× pro Level) |  | ja |
| Sterne nach Zügen vs. Optimum |  | ja |
| Farbenblind-Modus (Symbole in den Schichten) |  | ja |
| Familien-Rangliste |  | ja |
| Sound + Vibration |  | ja |

Keine Leben, keine Timer, keine Energie. Das sind genau die Mechaniken, mit denen die Bezahl-Apps nerven.

## UI: Handy, Tablet und Desktop-Browser

Dieselbe App läuft überall: installiert als PWA oder einfach als Tab im Browser. Kein Installieren nötig, um zu spielen.

| Gerät | Layout | Eingabe |
| --- | --- | --- |
| Handy hochkant | 2 Reihen Röhren, Buttons unten (Daumenzone) | Tippen |
| Tablet / Handy quer | 1–2 Reihen, Buttons seitlich | Tippen |
| Desktop-Browser | Brett zentriert, max. \~900 px breit, Buttons unter dem Brett | Maus + Tastatur |

- **Eine Eingabe-Logik:** Pointer Events statt getrennter Touch- und Maus-Handler. Klick = Tippen.
- **Hover am Desktop:** Röhre hebt sich leicht an, gültige Ziel-Röhren leuchten auf, wenn eine Röhre gewählt ist.
- **Tastatur:** Ziffern `1`–`9`, `0` und `Q`–`P` wählen Röhren (zweimal drücken = gießen), `Z` oder `Strg+Z` = rückgängig, `R` = neu starten, `Esc` = Auswahl aufheben.
- **Skalierung:** Röhrengröße per CSS `clamp()` aus der Viewport-Größe. Nichts scrollt, das Brett passt immer auf einen Bildschirm.
- **Barrierearm:** sichtbarer Fokus-Rahmen, Röhren als `button` mit `aria-label` („Röhre 3, oben Blau“).
- **Kein Desktop-Sonderweg:** Installations-Hinweise nur dort zeigen, wo sie Sinn ergeben (iOS-Banner nur auf dem iPhone).

## Architektur & Stack

Der Server ist dumm: er liefert Dateien aus und speichert Spielstände. Die ganze Spiellogik inkl. Level-Erzeugung läuft im Browser.

| Teil | Wahl | Warum |
| --- | --- | --- |
| Frontend | Vanilla TypeScript + Vite | Ein Spielbrett braucht kein React. Klein, schnell, wenig Abhängigkeiten. |
| Darstellung | DOM + CSS (Röhren als `div`s) | Animationen per CSS-Transition, Touch-Events gratis, kein Canvas-Gefummel. |
| Level-Generator + Solver | `shared/`-Modul in TS, im Browser in einem Web Worker | Blockiert die UI nicht, falls der Solver mal 200 ms braucht. |
| PWA | `vite-plugin-pwa` (Workbox) | Manifest + Service Worker ohne Handarbeit. |
| Backend | Node 22 + Hono | Ein paar Routen, \~100 Zeilen. Express geht genauso. |
| Datenbank | `/data/data.json` auf Coolify-Volume | Genau wie gewünscht. |
| Deployment | Ein Dockerfile, ein Container | Coolify baut direkt aus dem Git-Repo. |

Repo-Struktur:

```
watersort/
  shared/      # generator.ts, solver.ts, rng.ts, rules.ts  (+ Tests)
  web/         # Vite-App: UI, Worker, Service Worker
  server/      # index.ts: Hono, statische Dateien, /api
  Dockerfile
```

`shared/` wird von Frontend UND Server importiert. Der Server kann so später Level nachprüfen (z. B. gegen geschummelte Ranglisten), muss es aber nicht.

## Level-Generator

Prinzip: zufällig mischen, Solver beweist die Lösbarkeit, sonst verwerfen. Das ist simpel und 100 % sicher, weil jedes ausgelieferte Level eine gefundene Lösung hat.

&#91;embedded content: Generator-Schleife · 5 Schritte, 1 Prüfung\]

Jeder Fehlversuch dreht nur den Seed weiter. Erst wenn der Solver eine Lösung in passender Länge findet, sieht der Spieler das Level.

### Ablauf pro Level

1. **Parameter holen:** aus der Level-Nummer per Kurve (nächster Abschnitt): Farben K, Röhrenhöhe H, leere Röhren E, versteckte Schichten.
2. **Seed bauen:** `seed = hash(levelNr, versuch)`. Zufall kommt aus einem seeded PRNG (z. B. mulberry32), nie aus `Math.random()`. Gleiche Nummer = gleiches Level, auf jedem Gerät.
3. **Mischen:** K × H Farbeinheiten in einen Topf, Fisher-Yates-Shuffle, auf K Röhren verteilen, E leere dazu.
4. **Schnell-Check:** verwerfen, wenn schon eine Röhre fertig ist oder zu viele gleiche Farben übereinander liegen (sieht billig aus).
5. **Solver:** sucht eine Lösung mit festem Budget (z. B. 200.000 Zustände). Budget gesprengt = verwerfen. Nur ein gefundener Beweis zählt.
6. **Schwierigkeits-Check:** Zuglänge der Lösung muss im Zielband des Levels liegen. Zu kurz = zu leicht = verwerfen.
7. **Fertig** oder `versuch + 1` und zurück zu Schritt 2. Nach 50 Fehlversuchen: eine leere Röhre mehr (macht praktisch alles lösbar). So terminiert die Schleife garantiert.

### Solver in Kurzform

- **Zustand** = Liste von Röhren, jede ein Array von Farb-IDs (unten → oben).
- **Suche:** A\* bzw. Best-First. Heuristik = Anzahl Farbwechsel innerhalb der Röhren. Liefert schnell eine kurze Lösung.
- **Besucht-Set mit kanonischem Schlüssel:** Röhren sortiert serialisieren. Röhren-Reihenfolge ist egal, das schrumpft den Suchraum massiv.
- **Unsinnige Züge streichen:** nie aus fertiger Röhre gießen, nie eine einfarbige Röhre in eine leere kippen, bei mehreren leeren Röhren nur in die erste.

Der Solver ist doppelt nützlich: Er liefert später gratis den Tipp-Button und das Optimum für die Sterne-Wertung.

### Warum nicht rückwärts vom gelösten Zustand?

Klingt eleganter, ist es aber nicht. Gieß-Züge sind nicht frei umkehrbar, ein Rückwärts-Zug muss eigene Bedingungen erfüllen. Das Ergebnis sind oft langweilige, leicht durchschaubare Level. Mischen + Prüfen ist robuster und leichter zu testen.

### Wichtig

- Konstante `GENERATOR_VERSION` im Code. Ändert sich der Algorithmus, ändern sich die Level. Fortschritt (= Nummer) bleibt gültig, nur ein halb gespieltes Level wird verworfen.
- Unit-Test: Level 1–500 erzeugen, jedes muss gelöst werden, Laufzeit pro Level loggen.

## Schwierigkeitskurve

Vier Stellschrauben, nacheinander eingeführt, nie zwei Neuheiten gleichzeitig. Die Zahlen sind Startwerte für den ersten Playtest mit den Kids.

| Level | Farben | Röhrenhöhe | Leere Röhren | Neu | Ziel-Zuglänge |
| --- | --- | --- | --- | --- | --- |
| 1–5 | 3 | 4 | 2 | Tutorial | 6–12 |
| 6–20 | 4–5 | 4 | 2 |  | 12–25 |
| 21–50 | 6–7 | 4 | 2 |  | 20–35 |
| 51–100 | 8–9 | 4 | 2 |  | 30–50 |
| 101–200 | 10–11 | 4 | 2 | ab 150: versteckte Schichten (`?`) | 40–60 |
| 201–400 | 12 | 5 | 2 | höhere Röhren | 50–75 |
| 400+ | 12–14 | 5 | 2, Boss-Level 1 | jedes 10. Level ist ein Boss | 60–90 |

- **Sägezahn statt Rampe:** jedes 5. Level eine Stufe leichter. Erfolgserlebnis zwischendurch hält Kinder (und alle anderen) bei der Stange.
- **Versteckte Schichten:** nur die oberste Einheit ist sichtbar, der Rest zeigt `?`, bis er freigelegt wird. Der Solver kennt die echten Farben, lösbar ist es also trotzdem.
- **Bildschirm-Limit:** 14 Farben + 2 leer = 16 Röhren, also 2 Reihen à 8. Mehr passt auf dem Handy nicht sinnvoll, deshalb steigt danach nur noch die Zuglänge.

## Datenbank-Textdatei & API

Eine JSON-Datei reicht locker: ein paar Spieler, ein paar Dutzend Bytes pro Spieler. Levels werden nie gespeichert, nur Nummern.

### Format von `/data/data.json`

```json
{
  "version": 1,
  "players": [
    {
      "id": "p_k3x9",
      "name": "Papa",
      "color": "teal",
      "level": 37,
      "stats": { "solved": 36, "moves": 812, "undos": 40 },
      "createdAt": "2026-10-04T18:00:00Z",
      "updatedAt": "2026-10-04T19:10:00Z"
    }
  ]
}
```

### Sicher schreiben (die 4 Regeln)

1. Beim Start einlesen, danach im RAM halten. Gelesen wird nur aus dem RAM.
2. Schreiben über eine Warteschlange (eine Promise-Kette). Nie zwei Schreibvorgänge parallel.
3. Atomar: erst `data.json.tmp` schreiben, dann `rename` auf `data.json`. Ein Absturz mittendrin zerstört nie die echte Datei.
4. Einmal täglich `data.json.bak` kopieren. Kostet nichts, rettet den Tag.

### Zugang ohne Passwörter

Env-Variable `FAMILY_CODE`. Wer ihn einmal eingibt, bekommt ein langlebiges httpOnly-Cookie. Danach Spieler antippen und los, keine Logins für Kinder.

### Endpunkte

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/api/session` | Familien-Code prüfen, Cookie setzen |
| GET | `/api/players` | Alle Spieler mit Level |
| POST | `/api/players` | Spieler anlegen (Name max. 20 Zeichen, Farbe) |
| PUT | `/api/players/:id/progress` | Level + Stats speichern |
| DELETE | `/api/players/:id` | Spieler löschen |
| GET | `/api/health` | Für den Coolify-Healthcheck |

**Merge-Regel beim Sync:** `level = max(server, client)`, Stats addieren. So geht nie Fortschritt verloren, auch wenn zwei Geräte offline gespielt haben.

## PWA & Offline

Weil Level aus der Nummer entstehen, ist Offline-Spielen fast geschenkt: kein Server nötig, um ein neues Level zu bekommen.

- **Manifest:** Name, Icons (192 + 512 px, maskable), `display: standalone`, `orientation: portrait`, Theme-Farbe.
- **Service Worker:** App-Shell vorab cachen (HTML, JS, CSS, Icons). `/api/*` nie cachen.
- **Lokal speichern:** aktueller Spieler, sein Level und das halb gespielte Brett in `localStorage`. App zu, App auf, Brett ist noch da.
- **Sync:** nach jedem gelösten Level `PUT /progress`. Schlägt es fehl, als „ausstehend“ merken und beim nächsten `online`-Event oder App-Start nachschieben.
- **Updates:** neue Version still im Hintergrund laden, beim nächsten Start aktiv. Kein „Neu laden?“-Popup mitten im Level.
- **iOS:** „Zum Home-Bildschirm“ in Safari. Kurzer Hinweis-Banner beim ersten Besuch auf dem iPhone, weil iOS keinen Installations-Prompt zeigt.
- **Wake Lock:** Bildschirm bleibt an, solange ein Level offen ist (optional).

## Coolify-Deployment

Eine Ressource vom Typ „Dockerfile“ aus dem Git-Repo, ein Volume, zwei Env-Variablen.

```dockerfile
# Build
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build      # baut web/dist und server/dist

# Run
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server/dist ./server
COPY --from=build /app/web/dist ./public
COPY --from=build /app/node_modules ./node_modules
ENV DATA_DIR=/data PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
```

| Einstellung in Coolify | Wert |
| --- | --- |
| Build Pack | Dockerfile |
| Port | 3000 |
| Persistent Storage | Volume → `/data` |
| Env | `FAMILY_CODE=...`, `DATA_DIR=/data` |
| Healthcheck | `GET /api/health` |
| Domain | z. B. `wasser.deinedomain.de`, HTTPS kommt von Traefik |

- **HTTPS ist Pflicht:** Service Worker laufen nur über HTTPS. Coolify erledigt das automatisch.
- **Volume-Rechte:** läuft der Container als Nicht-Root-User, muss `/data` beschreibbar sein. Sonst schlägt der erste Schreibvorgang still fehl. Beim Start einmal Testdatei schreiben und laut loggen, wenn's nicht klappt.
- **Backup:** das Volume in Coolifys Backup aufnehmen oder die `.bak`-Datei per n8n irgendwohin kopieren.

## Bau-Phasen

Reihenfolge ist Absicht: der schwierigste Teil (Generator + Solver) zuerst, weil alles andere darauf steht. Jede Phase endet mit etwas, das man anfassen kann.

### Phase 1 – Herzstück (Abend 1)

- [ ] `rules.ts`: Gieß-Regel, Gewinn-Check
- [ ] `rng.ts`: seeded PRNG + Hash aus (Level, Versuch)
- [ ] `solver.ts`: A\* mit kanonischem Schlüssel, Zug-Pruning, Budget
- [ ] `generator.ts`: Kurve → Parameter → Mischen → Prüfen → Retry
- [ ] Test: Level 1–500 erzeugen und lösen, Laufzeiten ausgeben

### Phase 2 – Spielbar im Browser (Abend 2)

- [ ] Brett rendern, Antippen + Gießen, Animation
- [ ] Rückgängig, Neustart, „Level geschafft“-Screen
- [ ] Generator im Web Worker
- [ ] Playtest mit den Kids → Kurve justieren

### Phase 3 – Server + Spieler (Abend 3)

- [ ] Hono-Server, statische Auslieferung, `/api`-Routen
- [ ] JSON-Speicher mit Queue + atomarem Schreiben + Backup
- [ ] Familien-Code + Spielerauswahl-Screen
- [ ] Sync mit Merge-Regel

### Phase 4 – PWA + Live

- [ ] Manifest, Icons, Service Worker, Offline-Test (Flugmodus)
- [ ] Dockerfile, Coolify-Ressource, Volume, Domain
- [ ] Auf allen Familien-Geräten installieren

### Phase 5 – Nice to have

- [ ] Tipp-Button und Sterne (Solver ist schon da)
- [ ] Versteckte Schichten ab Level 150
- [ ] Farbenblind-Modus, Sound, Familien-Rangliste

### Tipp fürs Coding-Tool

Diese Doku als `AGENTS.md`-Grundlage nehmen und Phase für Phase abarbeiten lassen. Phase 1 unbedingt mit Tests, sonst debuggt man später „unlösbare“ Level im UI statt im Solver.
