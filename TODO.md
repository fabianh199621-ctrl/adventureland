# Adventure Land Bot – Ideen & To-do (Stand v137)

## A) Aus der Community geklaut (Guides, fremde Bots)

1. **Monster Hunt-Quests** – NPC „Monster Hunter" in der Stadt gibt alle paar Minuten „töte N × Monster X". Belohnung: Gold + Monstertokens, die man beim Token-Händler gezielt gegen Ausrüstung tauscht. Bot: Quest annehmen, wenn Monster in der sicheren Liste; hinfarmen; abgeben; Tokens tauschen.
2. **Händler-Charakter (Merchant)** – zweiter Charakter am Stand (Stand 40k bei Divian, 16 Slots): verkauft unseren Loot an Spieler, kauft Zielitems günstig auf, gibt **mluck** (+12 % Luck, 60 min; Chance auf Duplikate von Drops) auf den Magier, verwaltet Bank und Gold, kauft Tränke/Scrolls und liefert sie per Magiport. Passive XP am Stand.
3. **Party mit 2–3 Charakteren** – Priester (Heilung, Party-XP) und/oder Ranger; Magier gibt „Energize" (Mana) an den Ranger → Dauerfeuer. Größter Fortschrittsschub, aber eigenes Projekt.
4. **Tiny Crabs (crabx)** – droppen Muscheln in Masse (Elixiere!) und mit winziger Chance „Sucker Punch" (~200 M Gold). Als Muschel-Farmspot einplanen, wenn Elixiere knapp sind.
5. **Arena (oben rechts an der Goo-Brücke)** – Skeletor und Irradiated Goos (cgoo) → „Tiny Rubies" → Waffen-/Rüstungsboxen mit T4-Chance. cgoo ist schon Kandidat; Rubin-Tausch einbauen.
6. **Ponty-Sniping** – Ponty verkauft versehentlich verkaufte Spieler-Items. Öfter prüfen (alle 5 min) und auch Items kaufen, die nicht für uns sind, aber wertvoll (Weiterverkauf über Händler).
7. **Monster-Level** – Monster leveln, wenn sie lange nicht getötet werden (mehr XP/Loot). Beim Zielen bevorzugt das höchstlevelige Exemplar nehmen.
8. **Bosse zu festen Zeiten** – Phoenix, Dracul, Franky, Ice Golem usw. stehen in `S` (Serverstatus). Mit Party lohnenswert; Drops: INT-Ohrringe, Feuerstab, mcape.
9. **Glücks-Elixier** (Warin im Inn) für Loot-/Gold-Phasen.
10. **Upgrade-Tricks** – höhere Scroll als nötig erhöht die Chance; Primling/Primordial Essence als Offering; „nie hochziehen, was man nicht verlieren kann".
11. **Burst-Regel** aus fremdem Mage-Bot: Burst nur, wenn `target.hp <= character.mp * 0.555` (Mana-effizienter Finisher).
12. **Mage-Skills**: Reflection auf Party, Magiport (Händler holen), Energize; Blink zum Kiten.
13. **Code-Organisation**: `load_code("name")` für Module, Chrome-Konsole (Shift+J) zum Debuggen.

## B) Eigene offene Punkte

- **Wunschliste pflegen**: Preisobergrenzen (WISH_MAX) an echte Marktpreise anpassen, sobald Angebote gesehen wurden; ggf. Cape-Ziel (bcape/stealthcape) ergänzen.
- **Drop-Quellen der Wunschliste**: wbook0 (bat), intearring (mvampire/phoenix), cring/cearring (vbat) – Farmspot-Empfehlung, sobald das Level reicht.

- **Item-Vergleich nebeneinander** im Char-Fenster (Werte jetzt / auf Zielstufe, Klick = vergleichen).
- **Fenster-Kleinigkeiten**: Tode und Küsse zählen, Laufzeit, Tabellen einklappbar (teilweise erledigt).
- **Kuss-Erfolg** sauber über den Event-Buff erkennen (Buff-Name aus „Buffs jetzt"-Log).
- **Offerings** beim Upgrade ab bestimmtem Itemwert automatisch einsetzen.
- **Ponty-Kauf prüfen**: Party Hat ×3 und hpbelt+1 (82k) – Grund steht ab v83 im Log.

## D) Ideen Bot-Logik (Vorschläge vom 18.09., noch nicht beauftragt)

1. **Gold-Ziel / Fortschritt** – Summe der offenen Zielbau-Kosten minus Gold, geteilt durch aktuelle G/h → „noch X Mio. ≈ Y h farmen". Kleiner Aufwand, sofort spürbar.
2. **Fokus mit Nachholen** – „Fokus für N h", danach einmal alle Routinen (Kuss, Ponty, Markt, Kuchen, Ausrüstungs-Tick) durchlaufen, aufräumen, zurück in den Fokus. Mittlerer Aufwand.
3. **Preisgedächtnis Händler** – je Item+Stufe Tiefstpreis/Durchschnitt der letzten 7 Tage speichern; in der Angebotsspalte „Tiefstpreis 7 Tage" und Marker „günstig". Braucht ein paar Tage Daten.
4. ~~Tod im Hunt = Monster sperren~~ – erledigt v151 (plus Jagd-Gefahrgrenze in %, Feld neben dem Hunt-Knopf).
5. **Events mitnehmen** – laufende Events (Goo Brawl, Wabbit, Franky, Feiertage) aus `parent.S` erkennen; bei sicherem Event-Monster mit mehr XP/G dorthin wechseln, gleiche Gefahr-Bewertung. Größerer Aufwand, größter XP-Hebel.
6. **Grad-1-Upgradechancen** (Firestaff & Co.) aus dem Spiel ablesen und eintragen – bisher geschätzt.
7. **Glück/Gold/XP-Boni** mit kleinen Gewichten in die Item-Bewertung aufnehmen (verändert die Rangfolge im Zielbau-Dropdown).
8. **Hunt-Server prüfen** – Monster Hunts gelten nur auf dem Server der Annahme (`sn`); bei Abweichung anzeigen, wie abgelaufen behandeln, optional Knopf „zurück nach …“.
9. **Arbitrage Schritt 2** – Knopf „Arbitrage“: lohnende Angebote kaufen und beim NPC verkaufen, andere Server (kein PVP) per Hin-Kaufen-Verkaufen-Zurück; erst wenn Scan (v138) und Faktor-Messung (v140) belastbar sind.
10. **Händler-Charakter** (A2) – Stufe 1 erledigt v141–v150 (Start per Magier, Stand, mluck, Gold; Priester folgt/heilt/kämpft). Offen: Stufe 2 Loot abholen & am Stand verkaufen, Stufe 3 Bank/Nachschub/Upgrades, Stufe 4 Zielbau-Käufe. Ursprünglicher Plan: Loader startet Händler mit, Stand + mluck + Loot verkaufen, dann Bank/Nachschub/Upgrades, dann Zielbau-Käufe.

## E) Ideen Panel (Vorschläge vom 18.09., noch nicht beauftragt)

1. **Fortschrittszeile Zielbau** – „6/10 Slots fertig · noch ~4,2 Mio. ≈ 11 h" mit Balken (Panel-Seite von D1).
2. **Reiter statt Scrollen** – „Farmen" (Status, Spot, Modus, Monster-Tabelle), „Ausrüstung" (Zielbau, Serverwechsel, Angebote), „Tag" (Tagesbilanz, Kuss, Kuchen, Hunt); Breite je Reiter, Kompaktansicht bleibt.
3. **Ereignisleiste** – die letzten 3 Log-Zeilen klein im Panel, Klick = kopieren.
4. **Warnzeile** oben, nur wenn etwas ansteht: Bank fast voll, Tränke < 50, Angebot unter Limit gefunden, Hunt läuft ab, Tode heute.
5. **Tastenkürzel** – F Fokus, Z Zielbau auf/zu, M Kompaktansicht; Kürzel im Tooltip.
6. **Zielbau kompakter** – Spalten „Bauen oder kaufen?" und „Zwischenlösung" standardmäßig eingeklappt, per Klick auf den Spaltenkopf ausklappen (620 statt 900 px).
7. **Deckkraft/Schriftgröße** – Regler 80–100 % und 11/12/13 px.

Empfohlene Reihenfolge: E2 + E1 zusammen, dann E4; D1 + D4 in einer Version, dann D2, D3; D5 erst, wenn ein Event ansteht.

## C) Erledigt (Kurzfassung)
v20 Loader · v21 Tasten/Upgrade manuell · v22–v26 Spotmessung · v27–v29 Inventar, Rückzug, Kuss, Gifts · v30–v34 Panel · v35 Kiten · v36–v37 Kuss/Compound · v38–v46 Panel-Design, Sortierung, fester Spot · v47 Reserve +5 · v48 Hänger/Aggro · v49–v50 Ponty, Inv-Sortierung · v51–v55 Pause/N/Loader · v56–v60 Reserve-Fixes · v61–v64 Log, Versionierung · v65–v68 Ausrüstungsziele & Wirtschaftlichkeit · v69–v72 Scroll, U nach Empfehlung, Referenz G/h · v73 Char-Fenster · v74–v78 Kauf-Fixes · v79 Elixiere via Muscheln · v80 bestes Teil tragen · v81 Beifang · v82 Town-Teleport · v83 Kaufgrund/Sperre · v84 Panel-Position · v85–v88 Monster Hunt, Muscheln · v89–v95 Kalibrierung, N-Resume, Bank sortieren · v96–v97 gelevelte Monster · v98 Tagesbilanz, Duplikate verkaufen, Sixfold Cake · v99–v105 Inventar/Bank-Fixes, Jagd-Rückfall, Abbruch per Taste, Aufräumen-Button · v106 Wunschliste (fester Magier-Build), Auto-Ausrüstung mit 1 M Reserve, Waffe zuerst, HP-Schmuck verkaufen · v107–v111 Jetzt-Button, Reserve-/Bank-Fixes, Wertmodell · v112–v115 Händlerscan alle Server, Danach-Schalter · v116 Zielbau (Zielitem + Stufe je Slot) · v117 Wiki im Spiel · v118–v128 Chancen-Tabellen, Bauen-oder-kaufen, Serverwechsel, Wiki-Kategorien · v129 alte Empfehlungstabelle raus · v130–v133 Zielbau = Getragenes, Jetzt nur ein Slot, Reserven (3 Kopien) · v134 Kompaktansicht, feste Zielbau-Spalten · v135 Kandidaten auf eingestellter Stufe bewerten · v136 Kaufen-Knopf je Angebot, Preislimit je Slot, Ist-Knopf · v137 Fokus-Modus
