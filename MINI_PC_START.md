# Übergabe: Adventure Land auf dem Mini-PC + Team-Bot

Dieser Text ist der Startprompt für eine neue Claude-Code-Sitzung auf dem Mini-PC.
Antworte auf Deutsch, knapp, ohne lange Einleitungen.

## Ziel

1. Einen privaten Adventure-Land-Server auf diesem Mini-PC betreiben (nur für uns, nur lokal).
2. Unseren 4er-Team-Bot (Repo `fabianh199621-ctrl/adventureland`) darauf laufen lassen,
   ohne Bildschirm (Chromium headless über Playwright), damit Claude den Bot selbst starten,
   beobachten, messen und verbessern kann.
3. Zwei Betriebsarten:
   - **Sandbox:** erhöhte XP/Gold/Drops, viel Gold per Admin – für Funktionstests im Zeitraffer
     (Upgrade-/Compound-Routine, Bank, Events, gefährliche Spots, Tode).
   - **Benchmark:** Originalwerte (Faktor 1) – zum Vergleich von Bot-Versionen
     (z. B. je 24 h gleiche Startbedingungen, XP/h, Gold/h, Tode vergleichen).
     Nur diese Zahlen zählen als echter Fortschritt; Sandbox-Werte verfälschen XP/h und Gold/h.

## Repos

| Repo | Zweck |
|---|---|
| `https://github.com/fabianh199621-ctrl/adventureland` | **Unser Bot.** Stand v355 liegt auf Branch `claude/great-edison-utc177` (noch nicht in `main`). |
| `kaansoral/adventureland_mongodb` (bzw. unser Fork) | Spiel: Express-Backend, Socket.IO-Spielserver, Client. Node.js + MongoDB. |
| `kaansoral/common_engine` (bzw. unser Fork) | Gemeinsame Engine, wird als `adventureland/common` verlinkt. |
| `kaansoral/adventureland_secretsandconfig` | Nur Vorlage. **Nicht forken/veröffentlichen** – lokal kopieren, enthält später unsere Schlüssel. |

Das alte `kaansoral/adventureland` (Python 2 / Google App Engine) **nicht** verwenden – laut README eingestellt.

Fork-Strategie: Fork möglichst nah am Original halten (Original wird aktiv gepflegt, letzter Commit 07.10.2026).
Eigene Änderungen klein und abschaltbar (Standard = Originalverhalten). Echte Server-Bugs als kleine,
fokussierte PRs ans Original vorschlagen (README dort: „small and focused“) – nicht ungefragt einreichen.

## Schritt 1 – System prüfen und vorbereiten

- Erst Betriebssystem, CPU, RAM, freien Speicher feststellen und melden.
- Windows: WSL2 (Ubuntu) bevorzugen, sonst nativ. Linux: direkt.
- Benötigt: git, Node.js (aktuelle LTS), MongoDB Community (lokal, 127.0.0.1:27017, ohne Auth),
  Python/Build-Tools nur falls `npm install` sie für native Module verlangt (argon2, zstd).
- Vor Installationen mit Root-Rechten kurz Bescheid geben.

## Schritt 2 – Server installieren (laut README von adventureland_mongodb)

```sh
mkdir -p ~/al && cd ~/al
git clone https://github.com/kaansoral/adventureland_mongodb.git adventureland   # oder unser Fork
git clone https://github.com/kaansoral/common_engine.git common                  # oder unser Fork
git clone https://github.com/kaansoral/adventureland_secretsandconfig.git secretsandconfig
cd adventureland && ln -s ../common common && ln -s ../secretsandconfig secretsandconfig
npm install && (cd node && npm install)
node scripts/seed_mongodb.js --dry-run
node scripts/seed_mongodb.js --confirm adventureland     # einmalig, Datenbank muss leer sein
node main.js                                             # Backend, Port 8090
cd node && node server.js local                          # Spielserver, Port 7192
```

Beide Prozesse dauerhaft laufen lassen (systemd-Dienste oder pm2) und Logs in Dateien schreiben,
damit spätere Sitzungen sie lesen können.

### Bekannte Fallstricke in `secretsandconfig/options.js` (Vorlage geprüft)

- `base_url: "http://localhost"` – Backend läuft aber auf Port **8090**. Auf `"http://localhost:8090"`
  setzen (oder Backend auf Port 80 legen). Der Bot nimmt seit v355 genau diese Adresse (`parent.base_url`).
- `character_limit: 3` und `ip_limit: 3` – unser Team braucht **4 Charaktere gleichzeitig** von einer IP
  (Magier, Priester, Ranger, Händler). Beide auf mindestens 5 setzen.
- `Local: true`, `unsecure_admin: true` – jeder Zugriff von localhost ist Admin. **Server niemals ins
  Internet/LAN freigeben**, solange das gesetzt ist. Schlüssel in `keys.js` für Dauerbetrieb fest setzen.
- Der lokale Server heißt Region `US`, Name `I` → im Bot ergibt `server.region + server.id` = `USI`.
  Es gibt nur einen Server: Händler-Fahrten auf andere Server (Arbitrage) gehen nicht, bis wir einen
  zweiten Server in `servers` eintragen.

## Schritt 3 – Accounts und Charaktere

- Im Browser `http://localhost:8090` registrieren (lokaler Account, **nicht** die Live-Zugangsdaten).
- Admin: `http://localhost:8090/admin/make/user/admin` (eingeloggt aufrufen), danach
  `/admin/executor` und `/admin/renderer` verfügbar.
- Vier Charaktere mit genau diesen Namen anlegen (sonst die Namen im Bot ändern, siehe unten):
  - `F4llen` – Magier (Teamleiter, startet die anderen selbst)
  - `F4llenPriest` – Priester
  - `F4llenRanger` – Ranger
  - `F4llenMerch` – Händler
- Namen stehen im Bot hier: `bot_vNNN.js` → `var MAIN_NAME = "F4llen"` (Zeile ~14) und
  `var TEAM = { merch: "F4llenMerch", priest: "F4llenPriest", ranger: "F4llenRanger" }` (Zeile ~384);
  `merchant/priest/ranger_vNNN.js` → `var MAGE = "F4llen"`.

## Schritt 4 – Bot laden

Funktionsweise: `loader.js` wird im CODE-Editor gespeichert. Er liest `BASE + "version.txt"` und lädt dann
`bot_/merchant_/priest_/ranger_<version>.js` passend zur Klasse. Der Magier startet Priester, Ranger und
Händler selbst per `start_character(name, LP_CODE_SLOT)` – **alle vier Charaktere brauchen den Loader im
selben Code-Slot** (Standard `LP_CODE_SLOT = 1`). Gemeinsamer Zustand läuft über `send_cm` und
`localStorage`, daher **alle Charaktere im selben Browser / selben Browser-Kontext**.

Für den Mini-PC den Loader mit eigener `BASE` verwenden, **nicht** `main` auf GitHub:

- **Empfohlen (lokale Entwicklung):** Bot-Repo lokal klonen, Branch `claude/great-edison-utc177`, und per
  kleinem HTTP-Server mit CORS ausliefern, z. B. `npx http-server ~/al/bot -p 8091 --cors -c-1`.
  Im Loader `var BASE = "http://localhost:8091/";`. Änderungen sind dann ohne Push sofort testbar
  (im Spiel Taste **N** = neu laden).
- Alternative: `BASE = "https://raw.githubusercontent.com/fabianh199621-ctrl/adventureland/claude/great-edison-utc177/"`.

Loader in Slot 1 speichern: über die Spieloberfläche oder die Backend-API (`save_code` in `api.js`).

Wichtig: den `loader.js` **aus dem Branch** nehmen (setzt `parent.LP_BASE = BASE`). Nur dann lädt der Magier
auch die Team-Skripte, das Neuladen per N und die Versionsprüfung aus derselben Quelle. Ohne `LP_BASE`
fällt der Bot auf GitHub `main` zurück und würde sich auf die Live-Version zurücksetzen.

### Headless betreiben (Playwright)

- Ein Node-Skript mit Playwright + Chromium, **ein persistenter Browser-Kontext** (für gemeinsames
  `localStorage`), Login, Magier `F4llen` betreten, Code-Slot 1 starten. Der Magier öffnet die
  anderen drei selbst.
- Konsole und `game_log` der Seite in eine Logdatei schreiben (JSON-Zeilen mit Zeitstempel), damit
  Claude Läufe auswerten kann, ohne zuzuschauen.
- Der Bot startet immer im **Pause-Modus** (Taste P). Für Automatik die Pause per Skript aufheben.
- Tasten im Magier-Skript: P Pause, N neu laden, U Upgrade-Routine, L Farm-Statistik ins Log,
  D Event-Diagnose, G Xyn-Tausch.

## Schritt 5 – XP / Gold / Drops anpassen (im Server-Fork)

Globale Faktoren gibt es bereits in `node/server.js` (ca. Zeile 360):

```js
var luckm = 1;
var xpm = 1;
var goldm = 1;
var buym = 1;
```

(Der HARDCORE-Modus setzt dort z. B. `xpm = 2188`, `goldm = 12000`.)
Plan: diese Werte aus `options.js` lesen (z. B. `options.xpm`, Standard 1), damit Sandbox/Benchmark nur
eine Konfigurationsänderung ist. Weitere Stellen:

| Was | Wo |
|---|---|
| Gold je Kill (Basis/Zufall/x10-Chance) | `design/drops.js` → `gold: { base, random, x10 }` |
| Drop-Chancen | `design/drops.js` → `maps.global`, `maps.<karte>`, `monsters.<typ>` |
| XP je Monster | `design/monsters.js` |
| XP je Level | `design/levels.js` |
| XP-Vergabe | `node/server.js` (Suche nach `monster.xp * share * current.xpm`) |
| Goldformel | `node/server.js` (Suche nach `D.drops.gold.base`) |

Gold geben: als Admin über `/admin/executor` oder den Spielserver-Endpunkt `/eval` (mit `ACCESS_MASTER`)
`player.gold` setzen.

## Schritt 6 – Messdaten im Bot (geplant als v356)

Der Bot soll laufend maschinenlesbar protokollieren: Zeit, Version, Farmspot, XP/h, Gold/h (Loot vs.
Verkäufe), Tode mit Ursache, Level, Gold, Spotwechsel. Ausgabe z. B. über `console.log` mit festem
Präfix (`LPSTAT {json}`), die das Playwright-Skript in eine JSONL-Datei schreibt. Damit lassen sich
Versionen im Benchmark-Modus vergleichen.

## Konventionen im Bot-Repo (wichtig)

- **Alles, was in `main` landet, ist sofort live** – der Live-Loader liest `main`. Nie ohne Rückfrage
  nach `main` pushen oder mergen. Entwickeln auf eigenem Branch.
- Neue Version: es werden immer zwei Versionen behalten. Die ältere per `git mv` auf die neue Nummer
  umbenennen, Inhalt der aktuellen hineinkopieren, ändern. Versionskonstanten in allen vier Dateien
  (`BOT_VERSION`, `MERCH_VERSION`, `PRIEST_VERSION`, `RANGER_VERSION`) und `version.txt` anheben.
- Vor jedem Commit `node --check` auf alle vier Dateien.
- Commit-Nachrichten auf Deutsch: `vNNN: <was und warum>`.
- Oberfläche, Logs und Kommentare im Bot sind deutsch; Stil des umgebenden Codes beibehalten.
- `README.md` (Aufbau, Features) und `TODO.md` (Ideen, offene Punkte) im Repo lesen.

## Stand bei Übergabe

- v355 (Branch `claude/great-edison-utc177`): Bot nimmt die Server-Adresse aus dem Spiel
  (`lp_base_url()` → `parent.base_url`) statt fest `https://adventure.land` – beim Start der
  Charakterfenster und beim Marktscan `/api/pull_merchants`. Beide Endpunkte existieren im lokalen
  Server. Außerdem übernimmt der Magier die Quelle aus dem Loader (`parent.LP_BASE`, gesetzt in `loader.js`)
  für Team-Skripte, Taste N und Versionsprüfung; ohne `LP_BASE` wie bisher GitHub `main`.
  Nur Syntax geprüft, im Spiel noch nicht getestet.
- Offen für den lokalen Betrieb: Marktscan/Stand/Arbitrage sind ohne andere Spieler wertlos →
  später ein Schalter, der Marktfunktionen lokal abschaltet.

## Reihenfolge für diese Sitzung

1. System prüfen, Ergebnis melden.
2. Server installieren und starten (Schritt 2), Fallstricke in `options.js` beheben.
3. Account, Admin, vier Charaktere.
4. Bot v355 lokal ausliefern, Loader speichern, erst einmal im sichtbaren Browser testen,
   dann headless mit Logdatei.
5. Alles notieren, was lokal nicht funktioniert, und vorschlagen, was wir fixen (Bot oder Server-Fork).
6. Danach: Faktoren über `options.js` (Server-Fork), Messdaten v356, erster Benchmark-Lauf.

Bei Entscheidungen, die schwer rückgängig zu machen sind (Push nach `main`, Datenbank löschen,
Dienste systemweit einrichten, Ports nach außen öffnen), vorher fragen.
