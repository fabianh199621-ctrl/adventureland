// ===== Adventure Land – Vollautomatik Magier (nichts einstellen) =====
// P = Pause (stoppt auch Upgrades) – Start immer im Pause-Modus
// N = neueste Version von GitHub laden und neu starten
// U = Empfehlungen der Ausrüstungstabelle abarbeiten: Upgrades Schritt für Schritt, solange sie sich rechnen
//     (kaufbare Items mit Reserve +5; Drop-Items nur bis +3 oder mit Reserve), Compound, INT-Scrolls, Ausrüstungskauf, Ponty/Markt
// L = Farm-Statistik (XP/h, Gold/h je Monster) ins Log
// D = Event-Daten anzeigen (Diagnose für 10-Jahre-Event)
// G = bei Xyn alles Tauschbare eintauschen (Gifts, Muscheln, Edelsteine, Leder …), holt vorher aus der Bank
// Upgrades laufen NUR auf Tastendruck. GOLD_RESERVE wird nie angetastet.
// Wird per Loader aus GitHub geladen: https://github.com/fabianh199621-ctrl/adventureland

var BOT_VERSION = "v278";
var MAIN_NAME = "F4llen", SOLO = character.name != MAIN_NAME; // SOLO: Zweit-Magier (Token-Jäger) – farmt und jagt allein, kein Team/Panel-Steuerung, eigene Einstellungen
var localStorage = SOLO ? (function () { var pfx = "lp_solo_" + character.name + "_", w = window.localStorage; return { getItem: function (k) { return w.getItem(pfx + k); }, setItem: function (k, v) { w.setItem(pfx + k, v); }, removeItem: function (k) { w.removeItem(pfx + k); } }; })() : ((typeof window != "undefined" && window.localStorage) || globalThis.localStorage); // eigener Speicherbereich je Zweit-Charakter
if (character.ctype != "mage") { // Händler/Priester haben versehentlich das Magier-Skript bekommen (alter Loader): passendes Skript nachladen
    (function () {
        var role = character.ctype == "merchant" || /merch/i.test(character.name) ? "merchant" : character.ctype == "ranger" || /ranger/i.test(character.name) ? "ranger" : "priest";
        var base = "https://raw.githubusercontent.com/fabianh199621-ctrl/adventureland/main/";
        game_log("bot.js ist nur für den Magier – lade " + role + "_" + BOT_VERSION + ".js");
        fetch(base + role + "_" + BOT_VERSION + ".js", { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (code) { try { eval(code); } catch (e) { game_log("Startfehler " + role + ": " + e); } }).catch(function (e) { game_log(role + " laden fehlgeschlagen: " + e); });
    })();
    throw new Error("falsche Klasse – " + character.ctype);
}
// ---------- Log-Puffer (für "Log kopieren") ----------
var LOG_MAX = 300, log_buf = [];
try { log_buf = JSON.parse(localStorage.getItem("lp_log") || "[]"); } catch (e) { log_buf = []; }
var _game_log = window.game_log; // Original aus dem Spiel (nicht unsere Hülle)
function game_log(msg, color) {
    try {
        var d = new Date(), ts = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2);
        log_buf.push(ts + " " + msg); if (log_buf.length > LOG_MAX) log_buf = log_buf.slice(-LOG_MAX);
        localStorage.setItem("lp_log", JSON.stringify(log_buf));
    } catch (e) {}
    return _game_log(msg, color);
}
function copy_log() {
    var txt = "LogicPlan " + BOT_VERSION + " – " + character.name + " Lv " + character.level + " – " + new Date().toLocaleString() + "\n" + log_buf.join("\n");
    var ok = function () { _game_log("Log in die Zwischenablage kopiert (" + log_buf.length + " Zeilen)"); };
    var fallback = function () { try { var ta = parent.document.createElement("textarea"); ta.value = txt; parent.document.body.appendChild(ta); ta.select(); parent.document.execCommand("copy"); ta.remove(); ok(); } catch (e) { _game_log("Kopieren fehlgeschlagen: " + e); } };
    try { parent.navigator.clipboard.writeText(txt).then(ok, fallback); } catch (e) { fallback(); }
}
// Nach N (Neuladen) im vorherigen Zustand weitermachen
var resume_timers = null;
try { var rs = parent.__lp_resume; if (rs && Date.now() - rs.t < 60000) { paused = !!rs.paused; resume_timers = rs.timers || null; } parent.__lp_resume = null; } catch (e) {}
function rt(name, def) { return resume_timers && typeof resume_timers[name] == "number" ? resume_timers[name] : def; } // Timer aus der Vorversion übernehmen (kein sofortiger Stadtgang nach N)
game_log("LogicPlan-Skript " + BOT_VERSION + (paused ? " gestartet – PAUSIERT." : " gestartet – läuft weiter.") + " P = Start/Pause, N = neu laden, U = Upgrades nach Empfehlung, L = Statistik, G = Gifts tauschen");

var GOLD_RESERVE = 20000;
var UPGRADE_TARGET = 8;              // kaufbare Items: Ziel für das getragene Teil
var BACKUP_LEVEL = 5;                // kaufbare Items: Reservekopie auf diesem Level im Inventar
var SAFE_TARGET_DROP = 3;            // Drop-Items bei U
var RISKY_TARGET_DROP = 5;           // Drop-Items bei K
var MAX_REBUYS = 6;
var COMPOUND_TARGET = 3;             // getragener Schmuck
var PONTY_INTERVAL = 30 * 60 * 1000; // Ponty (gebrauchte Items) regelmäßig prüfen
var MARKET_INTERVAL = 30 * 60 * 1000; // Marktstände in der Stadt regelmäßig prüfen
var GOAL_MAX_HOURS = 24;             // Beschaffung: max. erwartete Stunden insgesamt
var GOAL_GIVEUP_FACTOR = 2.5;        // Abbruch nach dem X-fachen der erwarteten Zeit
var MARKET_FACTOR = 1.5;             // nur für Kostenmodell nicht kaufbarer Items (Wiederbeschaffung)
var market_seen = {}; try { market_seen = JSON.parse(localStorage.getItem("lp_market_seen") || "{}"); } catch (e) {}
function note_market(name, level, price, where) { market_seen[name] = { level: level || 0, price: price, where: where, t: Date.now() }; try { localStorage.setItem("lp_market_seen", JSON.stringify(market_seen)); } catch (e) {} goal_cache_t = 0; }
var bought_recent = {}; try { bought_recent = JSON.parse(localStorage.getItem("lp_bought") || "{}"); } catch (e) {}
function note_bought(name) { bought_recent[name] = Date.now(); try { localStorage.setItem("lp_bought", JSON.stringify(bought_recent)); } catch (e) {} }
function bought_recently(name) { return bought_recent[name] && Date.now() - bought_recent[name] < 24 * 3600000; }
function market_valid(name) { var m = market_seen[name]; return m && (Date.now() - m.t) < 24 * 3600000 ? m : null; }
var UP_P = [0.9999, 0.98, 0.95, 0.7126, 0.6506, 0.4247, 0.2643, 0.166, 0.10, 0.06, 0.04, 0.02]; // Upgrade-Erfolg je Stufe, im Spiel abgelesen (Staff, Grad 0, passende Scroll); ab +8 geschätzt
var CO_P = [0.99, 0.75, 0.40, 0.25, 0.15, 0.10];                                                 // Compound-Erfolg je Stufe (Ring, Grad 0, Basic-Scroll); ab +3 geschätzt
var HIGH_SCROLL_BONUS = { u: 0.06, c: 0.041 };   // eine Scroll-Stufe höher als nötig: +6 %-Punkte (Upgrade), +4,1 (Compound) – im Spiel abgelesen
// Gelernte Erfolgsquoten je Stufe (aus echten Versuchen), Schlüssel "u<level>" / "c<level>"
var up_stats = {}; try { up_stats = JSON.parse(localStorage.getItem("lp_up_stats") || "{}"); } catch (e) {}
try { if (up_stats.c0 && up_stats.c0.n > 60 && up_stats.c0.ok / up_stats.c0.n < 0.5) { delete up_stats.c0; localStorage.setItem("lp_up_stats", JSON.stringify(up_stats)); } } catch (e) {} // v107: Statistik aus der ringsj-Schleife verwerfen
function record_attempt(kind, level, ok) { var k = kind + level, st = up_stats[k] || { n: 0, ok: 0 }; st.n++; if (ok) st.ok++; up_stats[k] = st; try { localStorage.setItem("lp_up_stats", JSON.stringify(up_stats)); } catch (e) {} }
var PRIOR_WEIGHT = 12; // Tabellenwert zählt wie 12 eigene Versuche; eigene Messungen verschieben ihn nach und nach
function table_p(kind, level) { return kind == "u" ? (UP_P[level] != null ? UP_P[level] : 0.02) : (CO_P[level] != null ? CO_P[level] : 0.1); }
function success_p(kind, level) { var st = up_stats[kind + level], t = table_p(kind, level); if (st && st.n) return (st.ok + t * PRIOR_WEIGHT) / (st.n + PRIOR_WEIGHT); return t; }
function success_txt(kind, level) { var st = up_stats[kind + level]; return Math.round(success_p(kind, level) * 100) + " %" + (st && st.n ? " (Tabelle " + Math.round(table_p(kind, level) * 100) + " % + gemessen " + st.ok + "/" + st.n + ")" : " (Tabelle)"); }
// Lohnt eine höhere Scroll? Erwartete Kosten je gelungener Stufe vergleichen (Scrollpreis + Wert des Items × Verlustrisiko)
function best_scroll_grade(def, level, kind, own_value) {
    var need = 0, g = def.grades || []; for (var i = 0; i < g.length; i++) if (level >= g[i]) need = i + 1; need = Math.min(need, 2);
    var pre = kind == "u" ? "scroll" : "cscroll", p = success_p(kind, level);
    var cost = function (grade, pp) { var sp = (G.items[pre + grade] || {}).g || 1e9; return (sp + (kind == "c" ? 3 : 1) * own_value * (1 - pp)) / pp; };
    var c0 = cost(need, p), higher = need + 1;
    if (higher > 2 || !G.items[pre + higher]) return need;
    var p1 = Math.min(0.999, p + HIGH_SCROLL_BONUS[kind]);
    return cost(higher, p1) < c0 ? higher : need;
}
var COMPOUND_SPARE_MAX = 3;          // ungetragener Schmuck im Inventar wird bis hierhin compoundet
var STAT_TYPE = "int";
var FALLBACK_WEAPONS = ["staff", "stick"];
var NO_WEAPON_MONSTER = "goo";
var MAX_TARGET_HP_FACTOR = 5;
// Kandidaten für Farmspots – ungeeignete (zu stark) werden automatisch aussortiert
var CANDIDATES_STATIC = ["goo", "crab", "bee", "croc", "armadillo", "squig", "squigtoad", "poisio",
                  "tortoise", "frog", "rat", "minimush", "snake", "osnake", "scorpion", "spider",
                  "arcticbee", "boar", "crabx", "bat", "cgoo"];
function all_farmable() { // alle Monster, die auf normalen Karten spawnen (keine Bosse/Event-/Übungsziele, keine PVP-/Instanz-Karten)
    var seen = {}, out = [];
    try {
        for (var map in G.maps) {
            var md = G.maps[map]; if (!md || md.ignore || md.instance || md.pvp || map == "jail" || !md.monsters) continue;
            md.monsters.forEach(function (e) {
                var id = e.type, m = G.monsters[id]; if (!m || seen[id]) return;
                if (m.boss || m.special || m.cooperative || /^target/.test(id) || !(m.xp > 0) || !(m.hp > 0)) return;
                seen[id] = true; out.push(id);
            });
        }
    } catch (e) {}
    return out.length ? out.sort() : CANDIDATES_STATIC.slice();
}
var CANDIDATES = all_farmable();
var EXCLUDE = { iceroamer: true };   // gezielt ausgeschlossen (Einfrieren)
var hidden_mons = {}; try { hidden_mons = JSON.parse(localStorage.getItem("lp_hidden") || "{}"); } catch (e) {}
var only_worth = false; try { only_worth = localStorage.getItem("lp_only_worth") == "1"; } catch (e) {}
var bycatch = true; try { bycatch = localStorage.getItem("lp_bycatch") != "0"; } catch (e) {}
var focus_mode = false; try { focus_mode = localStorage.getItem("lp_focus") == "1"; } catch (e) {} // Fokus: nur farmen/hunten, keine Nebenroutinen
var FOCUS_MIN_FREE = 3, FOCUS_TARGET_FREE = 20, FOCUS_POT_MIN = 50;
var BYCATCH_RANGE = 250;             // Beifang: andere sichere Monster in dieser Entfernung angreifen
var hunt_on = true; try { hunt_on = localStorage.getItem("lp_hunt") != "0"; } catch (e) {}
var auto_on = true; try { auto_on = localStorage.getItem("lp_auto_on") != "0"; } catch (e) {} // Auto aus + kein fester Spot = nur Jagden (Team wartet bei Daisy)
var idle_logged = 0;
var wait_team_on = true, wait_team_danger = 0.10; try { var wtd = parseFloat(localStorage.getItem("lp_wait_danger")); if (isFinite(wtd) && wtd >= 0) wait_team_danger = wtd; } catch (e) {} // Auf Team warten: bei Spots über dieser Gefahr nicht vorlaufen/allein kämpfen
var WAIT_BEHIND = 500, WAIT_NEAR = 300, RALLY_DIST = 350, spot_travel = false, team_wait_stop = false, wait_logged = 0;
var strict_set = {}; try { strict_set = JSON.parse(localStorage.getItem("lp_strict") || "{}"); } catch (e) {} // Häkchen "Team" je Monster: kein Angriff, bevor Priest und Ranger < WAIT_NEAR stehen; Priest/Ranger ziehen nie selbst
function strict_mon(mon) { return !!strict_set[mon]; }
function set_strict(mon, on) { strict_set[mon] = !!on; try { localStorage.setItem("lp_strict", JSON.stringify(strict_set)); } catch (e) {} game_log("Team-Pflicht bei " + mon + (on ? " an" : " aus")); }
function escorts() { // mitlaufende Kämpfer (Priest/Ranger), die an sind und sich zuletzt gemeldet haben
    var out = []; if (SOLO) return out;
    ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 90000) return; out.push({ k: k, nm: TEAM[k], st: st }); });
    return out;
}
function escort_behind(limit) { // am weitesten zurückhängender Begleiter (Abstand > limit, andere Karte oder tot), sonst null
    var worst = null; limit = limit || WAIT_BEHIND;
    escorts().forEach(function (e) { var p = null; try { p = get_player(e.nm); } catch (x) {} var d;
        if (p && !p.rip && p.map == character.map) d = distance(character, p);
        else if (p && p.rip) d = Infinity;
        else if (e.st.map && e.st.map != character.map) d = Infinity;
        else d = e.st.x != null ? Math.hypot(character.x - e.st.x, character.y - e.st.y) : Infinity;
        if (d > limit && (!worst || d > worst.d)) worst = { k: e.k, nm: e.nm, d: d, rip: !!(p && p.rip), other_map: !!(e.st.map && e.st.map != character.map) }; });
    return worst;
}
function escort_near() { var ok = true; escorts().forEach(function (e) { var p = null; try { p = get_player(e.nm); } catch (x) {} if (!(p && !p.rip && p.map == character.map && distance(character, p) <= WAIT_NEAR)) ok = false; }); return ok; }
function spot_needs_team(mon) { if (!wait_team_on || SOLO || event_mode || !mon || !escorts().length) return false; var d = G.monsters[mon]; return !!d && (strict_mon(mon) || mon_danger(d) > wait_team_danger); }
function wait_txt() { var b = escort_behind() || (strict_mon(current_spot) ? escort_behind(WAIT_NEAR) : null); if (!b) return ""; return "warte auf " + TEAM_LABEL[b.k] + (b.rip ? " (tot)" : isFinite(b.d) ? " (" + Math.round(b.d) + " px)" : b.other_map ? " (andere Karte)" : " (außer Sicht)"); }
function wait_log(why) { if (Date.now() - wait_logged > 60000) { wait_logged = Date.now(); game_log("Auf Team warten: " + why); } }
var wait_since = 0, wait_who = "", rally_logged = 0;
function rally_back(farm) { // Team-Spot und ich stehe schon im/zu nah am Spawnfeld ohne Team: raus zum Kartenanfang und dort warten
    if (!strict_mon(farm) || busy) return false;
    var far = escort_behind(WAIT_BEHIND); if (!far) return false; // Team ist auf dieser Karte und in Reichweite (nur noch nicht ganz dran): stehen bleiben statt zum Kartenanfang pendeln
    var rs = mon_rects(farm, character.map); if (!rs.length) return false;
    var pt = [character.x, character.y, character.x, character.y], dmin = Infinity; for (var i = 0; i < rs.length; i++) dmin = Math.min(dmin, rect_dist(rs[i], pt));
    if (dmin >= RALLY_DIST) return false;
    var sp = (G.maps[character.map] && G.maps[character.map].spawns || [])[0]; if (!sp) return false;
    // Sammelpunkt: nur knapp aus dem Feld heraus (Richtung Kartenanfang), nicht den ganzen Weg zurück – sonst pendelt das Team ewig hinterher
    var near = rs[0], nd = Infinity; for (var ri = 0; ri < rs.length; ri++) { var dd = rect_dist(rs[ri], pt); if (dd < nd) { nd = dd; near = rs[ri]; } }
    var cx = (near[0] + near[2]) / 2, cy = (near[1] + near[3]) / 2, vx = character.x - cx, vy = character.y - cy, vl = Math.hypot(vx, vy);
    if (vl < 40) { vx = sp[0] - cx; vy = sp[1] - cy; vl = Math.hypot(vx, vy) || 1; }
    var need = RALLY_DIST + 80 - dmin, tx = Math.round(character.x + vx / vl * need), ty = Math.round(character.y + vy / vl * need);
    if (Date.now() - rally_logged > 60000) { rally_logged = Date.now(); game_log("Team-Spot " + farm + ": stehe " + Math.round(dmin) + " px am Spawnfeld ohne Team – " + Math.round(need) + " px zurück und warten (" + (far.other_map ? TEAM_LABEL[far.k] + " auf anderer Karte" : far.rip ? TEAM_LABEL[far.k] + " tot" : TEAM_LABEL[far.k] + " " + Math.round(far.d) + " px") + ")"); }
    busy = true; change_target(null);
    smart_move({ map: character.map, x: tx, y: ty }).catch(function () { return smart_move({ map: character.map, x: sp[0], y: sp[1] }).catch(function () {}); }).then(function () { busy = false; });
    return true;
}
function meet_escort() { // Begleiter hängt auf derselben Karte länger fest (kein Weg zu mir?): ich gehe ihm entgegen
    var b = escort_behind(); if (!b || !isFinite(b.d) || b.rip) { wait_since = 0; return; }
    if (wait_who != b.nm) { wait_who = b.nm; wait_since = Date.now(); return; }
    if (Date.now() - wait_since < 45000 || busy) return;
    var p = null; try { p = get_player(b.nm); } catch (e) {}
    if (!p || p.map != character.map) return;
    wait_since = Date.now(); busy = true; game_log("Auf Team warten: " + TEAM_LABEL[b.k] + " kommt seit 45 s nicht näher (" + Math.round(b.d) + " px) – gehe ihm entgegen");
    smart_move({ x: p.x + 40, y: p.y }).catch(function () {}).then(function () { busy = false; });
}
// Einstellungen (⚙): Darstellung + Verhalten, gespeichert unter lp_settings
var SET = { alpha: 1, font: 12, accent: "green", list_right: true, wait_behind: 500, rally: 350, hold_flee: 60, hp_pot: 40, mp_pot: 50, xp_weight: 50, team_hunt_first: true, hunt_town_only: false, log_pots: true };
try { var so = JSON.parse(localStorage.getItem("lp_settings") || "null"); if (so) for (var sk in so) if (sk in SET) SET[sk] = so[sk]; } catch (e) {}
function save_settings() { try { localStorage.setItem("lp_settings", JSON.stringify(SET)); } catch (e) {} apply_settings(); }
var ACCENTS = { green: ["#2e7d32", "#4caf50"], blue: ["#1e6fb8", "#3d8bdc"], orange: ["#b8641e", "#e08a3c"], purple: ["#7b3fb8", "#9d5fd6"], red: ["#b83f4a", "#d65f6a"] };
function apply_settings() { try { WAIT_BEHIND = SET.wait_behind; RALLY_DIST = SET.rally; XP_WEIGHT = SET.xp_weight / 50; GOLD_WEIGHT = (100 - SET.xp_weight) / 50; var r = parent.document.documentElement; var ac = ACCENTS[SET.accent] || ACCENTS.green; r.style.setProperty("--lp-alpha", String(SET.alpha)); r.style.setProperty("--lp-fs", SET.font + "px"); r.style.setProperty("--lp-acc", ac[0]); r.style.setProperty("--lp-acc2", ac[1]); } catch (e) {} last_panel = 0; }


var pause_after = false; try { pause_after = localStorage.getItem("lp_pause_after") == "1"; } catch (e) {} // nach manueller Aktion (Button/Taste) pausieren statt weiterfarmen
function after_action(what) {
    if (pause_after) { paused = true; stop("smart"); set_message("PAUSE"); game_log((what || "Aktion") + " fertig – pausiert (Einstellung „Danach: Pause“, P zum Weiterfarmen)"); last_panel = 0; }
    else if (!paused) go_to_farm_spot();
}
var MH_SET = ["mmhat", "mmgloves", "mmpants", "mmarmor", "mmshoes"]; // Magier-Set bei Daisy (Tokens)
var MH_MIN_LEFT_MS = 3 * 60 * 1000;  // unter so viel Restzeit lohnt kein Neustart mehr
var WORTH_TOP = 5;                   // "nur lohnende": die 5 besten nach geschätzten XP/h
function save_hidden() { try { localStorage.setItem("lp_hidden", JSON.stringify(hidden_mons)); localStorage.setItem("lp_only_worth", only_worth ? "1" : "0"); } catch (e) {} }
function hide_mon(m, hide) { if (hide) hidden_mons[m] = true; else delete hidden_mons[m]; save_hidden(); if (hide && (current_spot == m || manual_spot == m)) set_auto_spot(); last_panel = 0; }
function is_worth(m) {
    if (!only_worth) return true;
    var top = CANDIDATES.filter(function (x) { return is_safe_monster(x) && !hidden_mons[x]; })
        .sort(function (a, b) { return mon_xph_est(G.monsters[b], b) - mon_xph_est(G.monsters[a], a); }).slice(0, WORTH_TOP);
    return top.indexOf(m) >= 0;
}
function visible_mons() { return CANDIDATES.filter(function (m) { return !hidden_mons[m] && is_worth(m); }); } // Liste zeigt alle farmbaren Monster (auch gefährliche, mit Gefahr-%); die Sicherheitsprüfung greift nur bei der automatischen Wahl
var EVAL_MS = 3 * 60 * 1000;         // Messdauer je Spot
var MEASURE_TOP = 6;                 // nur die 6 vielversprechendsten Spots werden gemessen
var REEVAL_MS = 6 * 60 * 60 * 1000;  // Messwerte gelten so lange
var ATTACK_DRIFT = 0.15;             // ... oder bis sich ANG um 15 % geändert hat
var XP_WEIGHT = 1, GOLD_WEIGHT = 1;  // Gewichtung XP/h vs. Gold/h
var MAX_DANGER = 0.5;                // Monster gilt als sicher, wenn ein Kill <= 50 % meiner HP kostet
var MAX_TTK = 40;                    // ... und in <= 40 s tot ist
var HITS_TO_DIE_MIN = 12;            // Monster darf mich nicht in < 8 Schlägen töten
var HITS_TO_KILL_MAX = 25;           // ich muss es in <= 25 Schlägen töten können
var FILL_SLOTS = {
    helmet:   ["wcap", "helmet"],
    chest:    ["wattire", "coat"],
    pants:    ["wbreeches", "pants"],
    shoes:    ["wshoes", "shoes"],
    gloves:   ["wgloves", "gloves"],
    offhand:  ["wbook0"],
    earring1: ["intearring"],
    earring2: ["intearring"],
    ring1:    ["intring", "ringsj"],
    ring2:    ["intring", "ringsj"],
    amulet:   ["intamulet", "hpamulet"],
    belt:     ["intbelt", "hpbelt"]
};
var INV_MIN_FREE = 5;                // unter so vielen freien Plätzen -> aufräumen
var INV_TARGET_FREE = 14;            // ... und dann so viele Plätze wieder frei machen
var BANK_MIN_FREE = 10;              // unter so vielen freien Bankplätzen -> Bank aufräumen
var KEEP_MIN_LEVEL = 4;              // Ausrüstung ab diesem Level behalten
var KEEP_MIN_VALUE = 50000;          // Items ab diesem Grundwert behalten
var KEEP_ITEMS = /^(hpot|mpot|elixirint|scroll|cscroll|intscroll|strscroll|dexscroll|vitscroll|tracker|seashell|monstertoken|slice_|sixcake)/;
var POTS_HP = ["hpot1", "hpot0"], POTS_MP = ["mpot1", "mpot0"]; // beste zuerst
var ELIXIRS = ["elixirint2", "elixirint1", "elixirint0"]; // beste zuerst, aktiv halten
var SHELLS_PER_TRIP = 40;            // ab so vielen Muscheln zu Xyn tauschen
var ELIXIR_MAX_PRICE = 15000;        // INT-Elixier am Markt kaufen bis zu diesem Preis
var SLICES = ["slice_strawberry", "slice_citrus", "slice_honey", "slice_mint", "slice_blueberry", "slice_nightberry"];
var SLICE_MAX_PRICE = 30000;         // fehlende Kuchenstücke am Markt kaufen bis zu diesem Preis
var CAKE_CRAFT_COST = 100000;        // Mira verlangt so viel Gold für den Sixfold Cake
var GEAR_MIN_GAIN = 1.2;             // neue Ausrüstung nur, wenn mind. 20 % besser // bleibt im Inventar
var EVENT_ITEMS = /cake|gift|anniv|kiss|slice/i;   // Event-Items bleiben im Inventar
var KISS_ENABLED = true;             // 10-Jahre-Event: jede Runde zum Ziel laufen und küssen
var KITE_HP = 0.35;                  // unter 35 % HP mit Schwarm: kurz zurückweichen und heilen
var FLEE_HP = 0.15;                  // unter 15 % HP: in die Stadt
var FLEE_ATTACKERS = 2;              // ... wenn mind. 2 Monster auf mich zielen
var MAX_AGGRO = 3;                   // ab so vielen Angreifern kein neues Ziel ziehen
var STUCK_MS = 5 * 60 * 1000;        // ohne XP so lange "farmend" -> festgefahren
var CBURST_MIN_TARGETS = 2;
var CBURST_MP_PER_TARGET = 80;
var CBURST_MIN_MP = 0.5;

var busy = false, paused = true, upgrading = false, pending_upgrade = null; // Start pausiert
var bot_running = true, main_timer = null;
var BOT_BASE = "https://raw.githubusercontent.com/fabianh199621-ctrl/adventureland/main/";
// alte Instanz (vorheriger Lauf/Reload) beenden
try { if (parent.__lp_main_timer) clearInterval(parent.__lp_main_timer); if (parent.__lp_panel_timer) { clearInterval(parent.__lp_panel_timer); parent.__lp_panel_timer = null; } } catch (e) {}
var last_weapon_log = 0;
var blocked_spots = {};
var farm_stats = load_stats();
var current_spot = null, need_repick = true;
var manual_spot = null; // aktuell fester Spot (Button, Jagd oder Ausrüstungsziel)
var user_manual = null; // nur per Button gewählt – dahin geht es nach Jagd/Ziel zurück
var meas = null; // laufende Messung
// Laufende Messung / Spot aus letztem Lauf wiederherstellen
try {
    var saved = JSON.parse(localStorage.getItem("lp_state_" + character.name) || "null");
    if (saved && (Date.now() - saved.t) < 30 * 60 * 1000) {
        current_spot = saved.spot || null; need_repick = !current_spot; manual_spot = saved.manual || null; user_manual = saved.user_manual || null;
        parent.__lp_saved_hunt = { prev: saved.hunt_prev || null, spot: saved.hunt_spot || null };
        if (saved.meas) { meas = saved.meas; meas.last_xp = character.xp; meas.last_level = character.level; meas.last_gold = character.gold; meas.pause_start = 0; }
        if (current_spot) game_log("Weiter bei Spot " + current_spot + (meas ? " (Messung läuft weiter)" : ""));
    }
} catch (e) {}
var last_state_save = 0;
function save_state() {
    try { localStorage.setItem("lp_state_" + character.name, JSON.stringify({ t: Date.now(), spot: current_spot, meas: meas, manual: manual_spot, user_manual: user_manual, hunt_prev: hunt_prev, hunt_spot: hunt_spot })); } catch (e) {}
}
var cburst_logged = false, rip_counted = false;

// Instanz-Kennung: nach N laufen alte Routinen nicht weiter (sleep/check_pause werfen ABORT)
var MY_INSTANCE = Date.now() + Math.random(); parent.__lp_instance = MY_INSTANCE;
var abort_requested = false;
function aborted() { return abort_requested || parent.__lp_instance != MY_INSTANCE; }
function sleep(ms) { return new Promise(function (r, rej) { setTimeout(function () { if (aborted()) rej("ABORT"); else r(); }, ms); }); }
function spendable() { return character.gold - GOLD_RESERVE; }
function check_pause() { if (aborted()) throw "ABORT"; if (paused) throw "PAUSE"; }
function clear_flags() { busy = false; upgrading = false; kissing = false; fleeing = false; exchanging = false; pontying = false; marketing = false; shelling = false; hunting = false; bank_cleaning = false; sorting_inv = false; baking = false; }
// Laufende Routine abbrechen und danach die gewünschte Aktion starten (Tasten/Buttons)
async function preempt(why, action, keep_pause) { // keep_pause: reine Inventar-Aktion, Pause bleibt bestehen
    if (busy || routine_running()) {
        game_log("Breche laufende Aktion ab (" + why + ")");
        abort_requested = true; stop("smart"); stop("move");
        var t0 = Date.now();
        while ((busy || routine_running()) && Date.now() - t0 < 6000) await new Promise(function (r) { setTimeout(r, 150); });
        abort_requested = false;
        if (busy || routine_running()) clear_flags();
        await new Promise(function (r) { setTimeout(r, 400); });
    }
    if (paused && !keep_pause) unpause(why);
    manual_lock = true;
    var res; try { res = await action(); } finally { manual_lock = false; }
    return res;
}
var manual_lock = false;
function has_weapon() { return !!character.slots.mainhand; }

// Fähigkeit nutzbar? (Klasse + Level aus den Spieldaten)
function skill_available(name) {
    var s = G.skills[name];
    if (!s) return false;
    if (s.class && s.class.indexOf(character.ctype) < 0) return false;
    if (s.level && character.level < s.level) return false;
    return true;
}

// Prüft das konkrete Exemplar (gelevelte Monster haben mehr HP/Angriff als die G-Daten)
var PRIORITY_MONS = { phoenix: true }; // seltene, lohnende und harmlose Spawns: sofort angreifen und fokussieren (Team folgt dem Ziel)
function priority_mon(mtype) { if (PRIORITY_MONS[mtype]) return true; var d = G.monsters[mtype]; return !!d && d.cooperative && (d.attack || 0) * 8 < character.max_hp && !d.boss; } // kooperative Spawns mit schwachem Angriff ebenfalls
function priority_target() { var best = null, bd = 700; for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead || !priority_mon(m.mtype)) continue; var d = distance(character, m); if (d < bd) { bd = d; best = m; } } return best; }
var prio_logged = "";
function too_strong(m) {
    var base = G.monsters[m.mtype]; if (!base) return true;
    if (priority_mon(m.mtype)) return false;

    var d = Object.assign({}, base);
    if (m.max_hp) d.hp = m.max_hp;
    if (m.attack) d.attack = m.attack;
    if (m.frequency) d.frequency = m.frequency;
    if (m.mtype == manual_spot || m.mtype == current_spot) return d.attack >= character.max_hp * 0.5; // aktueller Farmspot: gelevelte Exemplare werden trotzdem gefarmt (dauert nur länger); nur Gegner, die mich in 2 Treffern töten, bleiben tabu
    if (d.attack * HITS_TO_DIE_MIN > character.max_hp) return true;
    return mon_danger(d) > MAX_DANGER || mon_ttk(d) > MAX_TTK;
}
// Spot-Sperre: true = dauerhaft (bis Neustart), Zahl = bis Zeitpunkt (gelevelte Monster)
function spot_blocked(m) {
    var b = blocked_spots[m]; if (!b) return false;
    if (b === true) return true;
    if (Date.now() < b) return true;
    delete blocked_spots[m]; return false;
}
var LEVELED_WAIT_MS = 45000;   // so lange ohne angreifbares Exemplar am Spot, dann ausweichen
var LEVELED_BLOCK_MS = 30 * 60000;
var leveled_since = 0, leveled_warned = 0;
function all_leveled_check(farm, seen, valid) {
    if (!seen || valid) { leveled_since = 0; return; }
    if (!leveled_since) { leveled_since = Date.now(); return; }
    if (Date.now() - leveled_since < LEVELED_WAIT_MS) return;
    leveled_since = 0;
    if (manual_spot == farm || hunt_spot == farm) { if (Date.now() - leveled_warned > 600000) { leveled_warned = Date.now(); game_log("Nur Ein-Treffer-Exemplare von " + farm + " in Sicht – warte auf frische (keine Sperre)"); } return; }
    game_log("Nur Ein-Treffer-Exemplare von " + farm + " in Sicht – Automatik wählt neu (keine Sperre)");
    need_repick = true; meas = null; current_spot = null; save_state();
    change_target(null); stop("smart"); busy = false;
}
var ignore_log_t = {};
function log_ignored(m, why) {
    var now = Date.now(), k = m.mtype + (m.level || "");
    if (ignore_log_t[k] && now - ignore_log_t[k] < 60000) return;
    ignore_log_t[k] = now;
    game_log("Ziel " + m.mtype + (m.level > 1 ? " Lv" + m.level : "") + " ignoriert (" + why + ", " + Math.round(m.max_hp) + " HP)");
}
function is_valid_target(m) {
    if (!m || m.type != "monster" || m.dead) return false;
    if (m.target && TEAM_NAMES.indexOf(m.target) >= 0) return true; // greift ein Teammitglied an
    if (priority_mon(m.mtype)) return true; // seltener Spawn (Phoenix): immer gültig
    if (m.mtype == pick_farm_monster()) return m.target == character.name || !too_strong(m); // Angreifer wehren wir ab, sonst nur ungelevelte/sichere Exemplare
    if (m.max_hp > character.max_hp * MAX_TARGET_HP_FACTOR) return false;
    if (bycatch && is_safe_monster(m.mtype) && !hidden_mons[m.mtype] && (!m.target || m.target == character.name)) return true;
    return m.target == character.name;
}


// ---------- Team: Händler und Priester (laufen unsichtbar im selben Fenster, gestartet vom Magier) ----------
var TEAM = { merch: "F4llenMerch", priest: "F4llenPriest", ranger: "F4llenRanger" };
var TEAM_NAMES = [TEAM.merch, TEAM.priest, TEAM.ranger];
var TEAM_LABEL = { merch: "Merch", priest: "Priest", ranger: "Ranger" }, TEAM_ROLE = { merch: "merchant", priest: "priest", ranger: "ranger" }, TEAM_CTYPE = { merch: "merchant", priest: "priest", ranger: "ranger" };
var team_on = { merch: true, priest: true, ranger: true }; try { var to = JSON.parse(localStorage.getItem("lp_team") || "null"); if (to) { for (var tk0 in to) team_on[tk0] = to[tk0]; } } catch (e) {}
if (SOLO) { team_on = { merch: false, priest: false, ranger: false }; }
function save_team() { try { localStorage.setItem("lp_team", JSON.stringify(team_on)); } catch (e) {} }
var team_state = {}; // letzte Statusmeldung je Charakter { level, state, t, ... }
var last_team_tick = 0, last_team_cast = 0, last_party_try = 0, team_start_at = {};
function team_slot() { try { if (typeof LP_CODE_SLOT != "undefined" && LP_CODE_SLOT) return LP_CODE_SLOT; } catch (e) {} try { return parent.LP_CODE_SLOT || 1; } catch (e) { return 1; } }
function active_chars() { try { return (typeof get_active_characters == "function" ? get_active_characters() : parent.get_active_characters()) || {}; } catch (e) { return {}; } }
function team_running(name) { var a = active_chars(); return !!a[name]; }
function team_tick() { // fehlende Teammitglieder starten, abgeschaltete stoppen; Party pflegen
    if (SOLO) return;
    if (Date.now() - last_team_tick < 20000) return; last_team_tick = Date.now();
    try { if (parent.__lp_team_restart_after && Date.now() < parent.__lp_team_restart_after) return; } catch (e) {}
    try { if (server_trip) return; } catch (e) {} // während eines Serverwechsels bleibt das Team zuhause
    var act = active_chars();
    for (var k in TEAM) {
        var nm = TEAM[k], on = !!team_on[k], running = !!act[nm];
        if (nm == TEAM.merch && (arb_job || merch_test)) continue; // Händler ist auf Reise/Test: nicht neu starten
        if (on && !running) { if (Date.now() - (team_start_at[nm] || 0) > 60000) { team_start_at[nm] = Date.now(); try { var res = start_character(nm, team_slot()); game_log("Team: starte " + nm + " (Code-Slot " + team_slot() + ") – aktiv: " + JSON.stringify(act)); if (res && typeof res.then == "function") (function (who) { res.then(function (r) { game_log("Team: " + who + " Start-Antwort: " + JSON.stringify(r).slice(0, 120)); }, function (e) { game_log("Team: " + who + " Start abgelehnt: " + JSON.stringify(e).slice(0, 160)); }); })(nm); } catch (e) { game_log("Team: " + nm + " konnte nicht gestartet werden – " + err_txt(e)); } } }
        else if (!on && running) { try { stop_character(nm); game_log("Team: " + nm + " gestoppt"); } catch (e) {} }
    }
    // Party: Priester einladen, wenn er läuft und nicht dabei ist
    if (Date.now() - last_party_try > 60000) { var need = []; if (team_on.priest && act[TEAM.priest]) need.push(TEAM.priest); if (team_on.ranger && act[TEAM.ranger]) need.push(TEAM.ranger); if (team_on.hunter && act[TEAM.hunter]) need.push(TEAM.hunter); var ms = team_state[TEAM.merch]; if (team_on.merch && act[TEAM.merch] && ms && /levelt|folgt/.test(ms.state || "")) need.push(TEAM.merch); var missing = need.filter(function (nm) { return !(character.party && parent.party && parent.party[nm]); }); if (missing.length) { last_party_try = Date.now(); missing.forEach(function (nm) { try { send_party_invite(nm); } catch (e) {} }); } }
}
var team_inject_t = {};
function team_windows() { // Fenster der mitgestarteten Charaktere finden (gleiche Herkunft, daher zugreifbar)
    var out = {};
    try { var fr = parent.document.querySelectorAll("iframe"); for (var i = 0; i < fr.length; i++) { try { var cw = fr[i].contentWindow; var nm = cw && cw.character && cw.character.name; if (nm && TEAM_NAMES.indexOf(nm) >= 0) { var ci = cw.document && cw.document.querySelector("iframe"); out[nm] = { win: cw, code: ci && ci.contentWindow }; } } catch (e) {} } } catch (e) {}
    return out;
}
function team_inject() { // läuft im Fenster des Teammitglieds nicht unser Skript (falscher Code-Slot), spielen wir es direkt ein
    if (SOLO) return;
    var wins = team_windows();
    for (var k in TEAM) {
        var nm = TEAM[k], w = wins[nm]; if (!w || !team_on[k]) continue;
        if (Date.now() - (team_inject_t[nm] || 0) < 45000) continue;
        var cw = w.code, have = null;
        try { have = cw && (cw.MERCH_VERSION || cw.PRIEST_VERSION || cw.RANGER_VERSION); } catch (e) {}
        if (have == BOT_VERSION) continue;
        team_inject_t[nm] = Date.now();
        if (!cw) { // das Spiel hat für den Charakter noch keinen Code-Frame angelegt: Code-Start anstoßen (läuft dessen eigenen, meist leeren Slot), danach spielen wir unser Skript ein
            try { if (typeof w.win.start_runner == "function") { w.win.start_runner(); game_log("Team: " + nm + " – Code-Start angestoßen"); } else game_log("Team: " + nm + " – kein Code-Frame und kein start_runner"); } catch (e) { game_log("Team: " + nm + " start_runner: " + err_txt(e)); }
            continue;
        }
        var role = TEAM_ROLE[k];
        game_log("Team: " + nm + " – spiele " + role + "_" + BOT_VERSION + ".js ein" + (have ? " (bisher " + have + ")" : ""));
        (function (nm, cw, role) {
            fetch(BOT_BASE + role + "_" + BOT_VERSION + ".js", { cache: "no-store" }).then(function (r) { if (!r.ok) throw "HTTP " + r.status; return r.text(); }).then(function (code) { if (code.indexOf("// =====") != 0) { game_log("Team: " + nm + " – " + role + "_" + BOT_VERSION + ".js noch nicht abrufbar, neuer Versuch"); return; } try { cw.eval(code); game_log("Team: " + nm + " – Skript eingespielt"); } catch (e) { game_log("Team: " + nm + " – Einspielen fehlgeschlagen: " + err_txt(e)); } }).catch(function (e) { game_log("Team: " + nm + " – Laden fehlgeschlagen: " + e); });
        })(nm, cw, role);
    }
}
var solo_last_st = 0;
function mh_missing_for_me() { // Token-Set-Teile, die ich weder trage noch im Inventar/Bank habe – mit Kosten, günstigstes zuerst
    var bank = character.bank || bank_cache || {}, in_bank = {}; try { for (var pk in bank) if (pk.indexOf("items") == 0 && Array.isArray(bank[pk])) bank[pk].forEach(function (it) { if (it) in_bank[it.name] = true; }); } catch (e) {}
    return MH_SET.filter(function (n) { var def = G.items[n]; var sl = slot_for_item(def); var worn = character.slots[sl]; return !(worn && worn.name == n) && locate_item(n) < 0 && !in_bank[n]; }).map(function (n) { return { name: n, cost: (G.tokens.monstertoken || {})[n] || 99 }; }).sort(function (a, b) { return a.cost - b.cost; });
}
var team_log_seen = {};
function team_read_logs() { // Händler/Priester schreiben ihr Log in den gemeinsamen Speicher (localStorage), der Magier zeigt es an
    for (var k in TEAM) { var nm = TEAM[k]; try { if (!team_log_seen[nm]) { team_log_seen[nm] = Date.now() - 3000; continue; } var arr = JSON.parse(localStorage.getItem("lp_tlog_" + nm) || "[]"); var seen = team_log_seen[nm]; var lab2 = TEAM_LABEL[k]; for (var i = 0; i < arr.length; i++) { var ln = arr[i]; if (ln.t > seen) { team_log_seen[nm] = ln.t; game_log("[" + lab2 + "] " + ln.m); } } } catch (e) {} }
}
var cm_selftest = 0;
function team_broadcast() { // alle 5 s: wo bin ich, was mache ich (für Händler und Priester)
    if (Date.now() - last_team_cast < 5000) return; last_team_cast = Date.now();
    if (SOLO) { if (Date.now() - solo_last_st > 30000) { solo_last_st = Date.now(); try { var hq0 = mh_quest(); send_cm(MAIN_NAME, { t: "st", level: character.level, state: character.rip ? "tot" : paused ? "Pause" : (hq0 && hq0.c > 0 ? "jagt " + hq0.id + " (" + hq0.c + ")" : "farmt " + (current_spot || "?")), gold: character.gold, tokens: tokens(), hp: character.hp, max_hp: character.max_hp, map: character.map, free: character.esize }); } catch (e) {} } return; }
    try { window.localStorage.setItem("lp_mh_missing", JSON.stringify(mh_missing_for_me())); } catch (e) {} // für Jäger/Priest/Ranger: welche Set-Teile mir fehlen
    var act = active_chars(), ml = character.s && character.s.mluck;
    var msg = { t: "me", free: character.esize, map: character.map, x: Math.round(character.x), y: Math.round(character.y), level: character.level, hp: character.hp, max_hp: character.max_hp, paused: paused || !bot_running, spot: current_spot, strict: strict_mon(current_spot), event: event_mode, mg: MG, hunt_go: (function () { try { var hs0 = hunt_slot_state(); return hs0.busy ? null : hs0.fetcher; } catch (e) { return null; } })(), hunt_holder: (function () { try { return hunt_slot_state().holder; } catch (e) { return null; } })(), tgt: (function () { if (!paused) return last_target_id; try { var mt = get_target(); return mt && mt.type == "monster" && !mt.dead ? mt.id : null; } catch (e) { return null; } })(), mluck: ml ? { f: ml.f, ms: ml.ms, strong: !!ml.strong } : null, in: character.in };
    for (var k in TEAM) { var nm = TEAM[k]; if (team_on[k] && act[nm]) { try { send_cm(nm, msg); } catch (e) {} } }
}
function team_send(name, data) { try { send_cm(name, data); } catch (e) {} }
var merch_needs = {}; // Material, das der Händler angefragt hat (z. B. spidersilk für Werkzeuge)
function on_cm(name, data) { // Nachrichten der eigenen Charaktere
    if (name == character.name && data && data.t == "ping") { cm_selftest = 2; game_log("Team: Nachrichtenkanal funktioniert (Selbsttest)"); return; }
    if (TEAM_NAMES.indexOf(name) < 0 || !data || typeof data != "object") return;
    var who = "?"; for (var wk in TEAM) if (TEAM[wk] == name) who = TEAM_LABEL[wk];
    try {
        if (data.t == "log") { /* kommt bereits über den gemeinsamen Speicher */ }
        else if (data.t == "st") { team_state[name] = Object.assign({}, data, { t: Date.now() }); last_panel = 0; }
        else if (data.t == "ready") { if (pickup_state) pickup_state.ready = true; }
        else if (data.t == "sold") { game_log("[" + who + "] VERKAUFT: " + data.name + " für " + fmt(data.price) + " Gold – Gold kommt bei der nächsten Abholung/Übergabe"); if (stand_orders[data.name]) { delete stand_orders[data.name]; save_stand_orders(); } }
        else if (data.t == "cavres") { var stc = team_state[name]; if (stc) { stc.cav = stc.cav || {}; if (data.next) stc.cav.next = data.next; } game_log("[" + who + "] Cavalry: " + (data.ok ? "unterwegs (" + (data.assigned || "?") + " Ziele)" : "fehlgeschlagen (" + (data.reason || "?") + ")")); }
        else if (data.t == "given") { give_done[name] = true; game_log("[" + who + "] Übergabe: " + (data.n || 0) + " Posten" + (data.left ? ", " + data.left + " nicht (mein Inventar voll)" : "")); }
        else if (data.t == "donated") { last_donate = Date.now(); if (data.gold > 0 && data.xp > 0) { donate_rate = data.xp / data.gold; try { localStorage.setItem("lp_donate_rate", String(donate_rate)); } catch (x) {} } game_log("[" + who + "] Spende: " + fmt(data.gold) + " Gold → " + fmt(data.xp) + " XP, jetzt Lv " + data.level); last_panel = 0; }
        else if (data.t == "msold") { if (merch_buy && data.id == merch_buy.id) { if (data.ok) mb_done(data.q + "× " + merch_buy.o.name + " verkauft für " + fmt(data.earned) + " – Erlös in der Händlerkasse"); else mb_fail(data.why || "Verkauf nicht gelungen – Item bleibt beim Händler"); } }
        else if (data.t == "bought") { if (merch_buy && data.id == merch_buy.id) { if (data.ok) { merch_buy.stage = "deliver"; merch_buy.t = Date.now(); mb_save(); } else mb_fail(data.why || "Kauf nicht gelungen"); } }
        else if (data.t == "delivered_item") { if (merch_buy && data.id == merch_buy.id) { if (data.q > 0) mb_done(data.name + (data.q > 1 ? " ×" + data.q : "") + " erhalten" + (data.gold ? ", " + fmt(data.gold) + " Gold zurück" : "")); else if (data.ok) { merch_buy.stage = "fetch"; merch_buy.t = Date.now(); mb_save(); game_log("Einkauf: Händler hat mich nicht erreicht – rufe ihn zum Abholen"); } } }
        else if (data.t == "delivered") { if (pickup_state) pickup_state.done = true; if (merch_buy && merch_buy.stage == "fetching" && data.items) merch_buy.got = data.items; if (data.pots) game_log("[Merch] Tränke erhalten: " + data.pots); if (data.gold) game_log("[Merch] " + fmt(data.gold) + " Gold Verkaufserlös erhalten"); }
        else if (data.t == "hello") { game_log("[" + who + "] verbunden (" + (data.v || "?") + (data.sv ? ", Server " + pretty_server(data.sv) : "") + ")"); if (merch_test && name == TEAM.merch) merch_test_result(data.sv); team_send(name, { t: "state", paused: paused || !bot_running, spot: current_spot }); team_broadcast(); }
        else if (data.t == "need") { var np = get_player(name); var ni = locate_item(data.item); if (np && ni >= 0 && distance(character, np) < 400) { var nq = Math.min(data.q || 1, character.items[ni].q || 1); try { send_item(name, ni, nq); game_log("[" + who + "] " + nq + "x " + data.item + " übergeben"); } catch (e) {} } else if (ni < 0) { merch_needs[data.item] = Date.now(); game_log("[" + who + "] braucht " + data.item + " – wird beim nächsten Fund/Abholung mitgegeben"); } }
        else if (data.t == "gold?") { var p = get_player(name); var want = data.amount || 100000, avail = Math.max(0, character.gold - WISH_RESERVE), amt = Math.min(want, avail); if (data.kind == "refill" && avail < want) { amt = 0; game_log("[" + who + "] will " + fmt(want) + " Gold zum Auffüllen – ich habe nur " + fmt(avail) + " über der Reserve, gebe nichts"); } if (p && distance(character, p) < 400 && amt >= 1000) { send_gold(name, amt); game_log("[" + who + "] " + fmt(amt) + " Gold übergeben"); } else team_send(name, { t: "nogold", near: !!(p && distance(character, p) < 400) }); }
        else if (data.t == "pots?") { var pp = get_player(name); if (pp && distance(character, pp) < 400) { var gave = 0; [POTS_HP, POTS_MP].forEach(function (list) { var idx = -1, q = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && list.indexOf(it.name) >= 0 && (it.q || 0) > q) { idx = i; q = it.q; } } if (idx >= 0 && q >= 60) { send_item(name, idx, 25); gave++; } }); if (gave) game_log("[" + who + "] Tränke übergeben"); } }
    } catch (e) { game_log("Team-Nachricht: " + err_txt(e)); }
}
try { window.on_cm = on_cm; parent.window.__lp_on_cm = on_cm; } catch (e) {} // Hook global machen (eval-Scope ist nicht global)
setTimeout(function () { try { cm_selftest = 1; send_cm(character.name, { t: "ping" }); setTimeout(function () { if (cm_selftest != 2) game_log("Team: Selbsttest – keine Nachricht angekommen (on_cm greift nicht)"); }, 5000); } catch (e) { game_log("Team: send_cm-Fehler " + err_txt(e)); } }, 3000);

// ---------- Team-Zielbau: Zielitem + Stufe je Slot für Priest/Ranger; der Magier kauft, baut und übergibt ----------
var team_wish = {}; try { team_wish = JSON.parse(localStorage.getItem("lp_teamwish_" + character.name) || "{}"); } catch (e) {}
var team_wish_mode = 1; try { team_wish_mode = parseInt(localStorage.getItem("lp_teamwish_mode") || "1") || 1; } catch (e) {}
var team_wish_stat = true; try { team_wish_stat = localStorage.getItem("lp_teamwish_stat") != "0"; } catch (e) {} // fertige Teile bekommen den Klassen-Attribut-Scroll (int/dex)
var tw_stat_failed = {}; // name+level, bei denen der Scroll nicht angenommen wurde (ein Versuch je Teil)
function tw_stat_type(key) { return TEAM_CTYPE[key] == "priest" ? "int" : TEAM_CTYPE[key] == "warrior" ? "str" : "dex"; }
async function tw_apply_stat(key, name) { // Attribut-Scroll auf die fertige Team-Kopie
    var cp = tw_copies(name)[0]; if (!cp) return; var it = character.items[cp.i]; if (!it || it.stat_type) return;
    var scroll = tw_stat_type(key) + "scroll", price = (G.items[scroll] || {}).g || 0, k = name + "+" + cp.level;
    if (tw_stat_failed[k] || !price) return;
    if (!stat_possible(it)) { tw_stat_failed[k] = true; game_log("Team-Zielbau [" + TEAM_LABEL[key] + "]: " + name + "+" + cp.level + " – Attribut nicht möglich (" + (G.items[name].stat ? "schon Qualität 1, Scroll nur bis +" + grade0_max(name) : "Teil hat keinen Attributwert") + ") – wird ohne übergeben"); return; }
    if (spendable() < price) { game_log("Team-Zielbau: Attribut-Scroll – Reserve erreicht"); return; }
    await travel_place("scrolls");
    if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
    var sc = locate_item(scroll); if (sc < 0) { game_log("Team-Zielbau: " + scroll + " nicht gekauft"); return; }
    var idx = find_inv_index(name, cp.level); if (idx < 0) return;
    set_message(name + " +" + tw_stat_type(key).toUpperCase());
    try { await upgrade(idx, sc); } catch (e) {}
    await wait_queue("upgrade");
    var idx2 = find_inv_index(name, cp.level), it2 = idx2 >= 0 ? character.items[idx2] : null;
    if (it2 && it2.stat_type == tw_stat_type(key)) game_log("Team-Zielbau [" + TEAM_LABEL[key] + "]: " + name + "+" + cp.level + " hat jetzt " + tw_stat_type(key).toUpperCase());
    else { tw_stat_failed[k] = true; game_log("Team-Zielbau [" + TEAM_LABEL[key] + "]: " + name + ": Attribut-Scroll nicht angenommen – wird ohne übergeben"); }
} // 1 = nur NPC-Teile, 2 = auch Marktangebote auf diesem Server unter Limit
var TEAM_BUILD_BUDGET = 1000000, TEAM_BUILD_MAX_LEVEL = 8, TEAM_BUILD_DEFAULT_MAX = 500000;
var TEAM_WISH_SLOTS = ["mainhand", "offhand", "helmet", "chest", "pants", "shoes", "gloves", "cape", "ring1", "ring2", "earring1", "earring2", "amulet", "belt", "orb"];
function save_team_wish() { try { localStorage.setItem("lp_teamwish_" + character.name, JSON.stringify(team_wish)); } catch (e) {} last_panel = 0; }
function tw_cfg(key, slot) { return (team_wish[key] || {})[slot] || null; }
function tw_names() { var o = {}; for (var k in team_wish) for (var sl in team_wish[k]) { var c = team_wish[k][sl]; if (c && c.item) o[c.item] = true; } return o; }
function is_team_wish(name) { return !!tw_names()[name]; }
function tw_overlap(name) { return !!equipped_names()[name] || on_wishlist(name); } // Teil, das der Magier selbst trägt/anstrebt: Reserven gehören ihm, nur Kopien über Reserve-Stufe sind Team-Teile
function is_team_wish_item(it) { return is_team_wish(it.name) && (!tw_overlap(it.name) || (it.level || 0) > BACKUP_LEVEL); }
function tw_market_offer(name) { // günstigstes Angebot auf diesem Server (Stufe egal – höhere Stufe ist willkommen)
    var best = null; (global_offers || []).forEach(function (o) { if (o.same && o.name == name && (!best || o.price < best.price)) best = o; }); return best;
}
function tw_candidates(key, slot) { // "leichte" Teile: NPC-kaufbar (Stufe 1) bzw. zusätzlich Marktangebote hier unter Limit (Stufe 2)
    var ctype = TEAM_CTYPE[key], out = [], cfg = tw_cfg(key, slot), max = cfg && cfg.max || TEAM_BUILD_DEFAULT_MAX, lvl = cfg && typeof cfg.level == "number" ? cfg.level : 0;
    for (var name in G.items) {
        var d = G.items[name]; if (!d || d.ignore || !fits_class(d, ctype, slot)) continue;
        if (d.compound) continue; // Schmuck-Compound: später
        var npc = is_buyable(name), off = !npc && team_wish_mode >= 2 ? tw_market_offer(name) : null;
        if (!npc && !(off && off.price <= max)) continue;
        out.push({ name: name, def: d, npc: npc, offer: off, score: gear_score_for(d, lvl, ctype) });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
}
function gear_score_for(def, level, ctype) { // Bewertung mit dem Hauptattribut der anderen Klasse
    var ms = ctype == "priest" || ctype == "mage" ? "int" : ctype == "warrior" || ctype == "paladin" ? "str" : "dex";
    function w(st) { return ((st[ms] || 0) + (st.stat || 0)) * 30 + (st.attack || 0) * 3 + (st.range || 0) * 0.5 + (st.frequency || 0) * 5 + (st.hp || 0) * 0.05 + (st.mp || 0) * 0.1 + (st.armor || 0) * 0.5 + (st.resistance || 0) * 0.5 + (st.rpiercing || 0) * 0.8; }
    var sc = w(def); if (level > 0 && def.upgrade) sc += level * w(def.upgrade); return sc;
}
function tw_copies(name) { // Inventarkopien, die dem Team-Zielbau gehören, höchste Stufe zuerst
    var out = []; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && !it.p) out.push({ i: i, level: it.level || 0 }); }
    out.sort(function (a, b) { return b.level - a.level; });
    if (!tw_overlap(name)) return out;
    var team = out.filter(function (c) { return c.level > BACKUP_LEVEL; }); if (team.length) return team; // über Reserve-Stufe: eindeutig Team
    var res = out.filter(function (c) { return c.level <= BACKUP_LEVEL; }); return res.length > RESERVE_COPIES ? res.slice(RESERVE_COPIES) : []; // sonst nur Überschuss über die Reserven des Magiers
}
function tw_build_copy(name) { // Kopie zum Weiterbauen: Team-Kopie, sonst (bei Überschneidung mit dem Magier) die niedrigste Kopie, die nicht seine Reserve ist
    var c = tw_copies(name)[0]; if (c) return c;
    if (!tw_overlap(name)) return null;
    var bi = backup_index(name), out = [];
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && !it.p && i != bi && (it.level || 0) <= BACKUP_LEVEL) out.push({ i: i, level: it.level || 0 }); }
    out.sort(function (a, b) { return a.level - b.level; });
    return out[0] || null;
}
function tw_status(key, slot) { // {state, text}
    var c = tw_cfg(key, slot); if (!c || !c.item) return null;
    var st = team_state[TEAM[key]], worn = st && st.slots && st.slots[slot];
    if (worn && worn.name == c.item && (worn.level || 0) >= c.level) return { state: "fertig", text: "fertig ✓" };
    var cp = tw_copies(c.item)[0];
    if (cp && cp.level >= c.level) { var ci = character.items[cp.i]; if (team_wish_stat && ci && stat_possible(ci) && !tw_stat_failed[c.item + "+" + cp.level] && (G.items[tw_stat_type(key) + "scroll"] || {}).g) return { state: "stat", text: "Attribut " + tw_stat_type(key).toUpperCase() + " (+" + cp.level + " liegt bereit)" }; return { state: "handover", text: "übergeben (+" + cp.level + " liegt bereit)" }; }
    if (cp) return { state: "build", text: "bauen +" + cp.level + " → +" + c.level };
    if (tw_overlap(c.item) && c.level <= BACKUP_LEVEL) return { state: "wait", text: "wartet auf Reserve-Überschuss des Magiers (Ziel ≤ +" + BACKUP_LEVEL + ")" };
    if (is_buyable(c.item)) return { state: "buy", text: "kaufen (NPC " + fmt(G.items[c.item].g || 0) + ")" };
    var off = tw_market_offer(c.item); if (off && off.price <= (c.max || TEAM_BUILD_DEFAULT_MAX)) return { state: "buy", text: "kaufen (Markt " + fmt(off.price) + ", " + off.seller + ")" };
    return { state: "wait", text: "kein Angebot" + (team_wish_mode < 2 ? " (nicht beim NPC)" : "") };
}
function team_build_todo(only) { // offene Aufträge in Reihenfolge
    var out = [];
    ["priest", "ranger"].forEach(function (key) { if (!team_on[key] || (only && key != only)) return; TEAM_WISH_SLOTS.forEach(function (slot) { var s = tw_status(key, slot); if (s && (s.state == "buy" || s.state == "build" || s.state == "stat")) out.push({ key: key, slot: slot, cfg: tw_cfg(key, slot), state: s.state }); }); });
    return out;
}
async function team_build_step(only, manual) { // in der Ausrüstungsroutine: bis zu 2 Team-Teile kaufen/aufwerten, Budget je Durchlauf begrenzt
    if (focus_mode && !manual) return;
    var todo = team_build_todo(only); if (!todo.length) { if (manual) game_log("Team-Zielbau" + (only ? " " + TEAM_LABEL[only] : "") + ": nichts zu tun"); return; }
    var g0 = character.gold, done = 0;
    for (var i = 0; i < todo.length && done < 2; i++) {
        check_pause();
        var t = todo[i], c = t.cfg, name = c.item, lab = TEAM_LABEL[t.key];
        if (g0 - character.gold > TEAM_BUILD_BUDGET) { game_log("Team-Zielbau: Budget für diesen Durchlauf (" + fmt(TEAM_BUILD_BUDGET) + ") ausgeschöpft"); break; }
        if (character.esize < 2) { game_log("Team-Zielbau: Inventar zu voll"); break; }
        var rebuys = 0, stopped = false;
        while (true) { // bei Zerstörung im selben Durchlauf neu kaufen und weiterbauen, bis es steht (Grenzen: Budget je Durchlauf, Gold-Reserve, Pause)
            check_pause();
            if (g0 - character.gold > TEAM_BUILD_BUDGET) { game_log("Team-Zielbau: Budget für diesen Durchlauf (" + fmt(TEAM_BUILD_BUDGET) + ") ausgeschöpft"); stopped = true; break; }
            if (!tw_build_copy(name)) { // beschaffen
                if (is_buyable(name)) { if (!await buy_items(name, 1)) break; game_log("Team-Zielbau [" + lab + "]: " + name + " beim NPC gekauft" + (rebuys ? " (Neukauf " + rebuys + ")" : "")); }
                else { var off = tw_market_offer(name); if (!off || off.price > (c.max || TEAM_BUILD_DEFAULT_MAX) || off.price > spendable()) break; if (!await tw_buy_offer(off)) break; game_log("Team-Zielbau [" + lab + "]: " + name + "+" + (off.level || 0) + " am Markt gekauft (" + fmt(off.price) + ")"); }
            }
            var cp = tw_build_copy(name); if (!cp) break;
            if (cp.level >= c.level) break;
            var lv = Math.min(c.level, TEAM_BUILD_MAX_LEVEL);
            await travel_place("upgrade");
            game_log("Team-Zielbau [" + lab + "]: " + name + " +" + cp.level + " → +" + lv + " (Chance +" + cp.level + "→+" + (cp.level + 1) + ": " + success_txt("u", cp.level) + ")");
            var r = await upgrade_inv(name, cp.level, lv, team_wish_stat ? tw_stat_type(t.key) : null);
            if (r.stopped) { stopped = true; break; }
            if (r.destroyed) { rebuys++; game_log("Team-Zielbau [" + lab + "]: " + name + " zerstört (" + rebuys + ". Mal) – kaufe neu"); continue; }
            break;
        }
        if (stopped) break;
        var cp2 = tw_copies(name)[0];
        if (team_wish_stat && cp2 && cp2.level >= c.level) { check_pause(); await tw_apply_stat(t.key, name); }
        done++;
    }
    if (g0 != character.gold) game_log("Team-Zielbau: " + fmt(g0 - character.gold) + " Gold ausgegeben");
}
async function tw_buy_offer(o) { // Marktangebot auf diesem Server direkt kaufen (ohne eigene Wunschlisten-Logik)
    try {
        if (o.map && o.x != null) await travel({ map: o.map, x: o.x, y: o.y + 30 });
        var lo = await locate_offer({ name: o.name, level: o.level || 0, price: o.price, seller: o.seller, tslot: o.tslot }); if (!lo) return false;
        var n0 = tw_copies(o.name).length; trade_buy(lo.seller, lo.slot, 1); await sleep(1200);
        return tw_copies(o.name).length > n0;
    } catch (e) { game_log("Team-Zielbau Marktkauf: " + err_txt(e)); return false; }
}
async function team_build_now(key) { // Knopf: nur den Team-Zielbau eines Mitglieds abarbeiten (ohne die restliche Ausrüstungsroutine)
    if (upgrading) { game_log("Upgrade läuft bereits"); return; }
    var saved_reserve = GOLD_RESERVE; GOLD_RESERVE = Math.max(GOLD_RESERVE, WISH_RESERVE);
    upgrading = true; busy = true; set_message("Zielbau " + TEAM_LABEL[key]);
    game_log("Team-Zielbau " + TEAM_LABEL[key] + ": starte (frei: " + fmt(spendable()) + " Gold)");
    try { await team_build_step(key, true); }
    catch (e) { if (e == "PAUSE") game_log("Team-Zielbau durch Pause abgebrochen"); else game_log("Team-Zielbau: " + err_txt(e)); }
    finally { GOLD_RESERVE = saved_reserve; upgrading = false; busy = false; }
    try { last_tw_handover = 0; team_wish_handover_tick(); } catch (e) {}
    game_log("Team-Zielbau " + TEAM_LABEL[key] + " beendet (Gold: " + fmt(character.gold) + ")");
    after_action("Zielbau " + TEAM_LABEL[key]);
}
var last_tw_handover = 0;
function team_wish_handover_tick() { // fertige Teile übergeben, sobald der Kollege neben uns steht
    if (Date.now() - last_tw_handover < 20000 || busy || upgrading || handing) return; last_tw_handover = Date.now();
    ["priest", "ranger"].forEach(function (key) {
        if (!team_on[key]) return; var nm = TEAM[key], lab = TEAM_LABEL[key];
        TEAM_WISH_SLOTS.forEach(function (slot) {
            var c = tw_cfg(key, slot); if (!c || !c.item) return; var s = tw_status(key, slot); if (!s || s.state != "handover") return;
            var p = get_player(nm); if (!p || p.rip || p.map != character.map || distance(character, p) > 350) return;
            var st = team_state[nm]; if (st && typeof st.free == "number" && st.free < 1) return;
            var cp = tw_copies(c.item)[0]; if (!cp || cp.level < c.level) return;
            try { team_send(nm, { t: "gear", name: c.item, level: cp.level, slot: slot, manual: true }); send_item(nm, cp.i, 1); game_log("Team-Zielbau [" + lab + "]: " + c.item + "+" + cp.level + " übergeben (" + slot + ")"); } catch (e) { game_log("Team-Zielbau Übergabe: " + err_txt(e)); }
        });
    });
}
function team_wish_html(panel) {
    var h = "";
    ["priest", "ranger"].forEach(function (key) {
        if (!team_on[key]) return;
        var lab = TEAM_LABEL[key], open = panel["__tw_" + key], st = team_state[TEAM[key]], cfgs = team_wish[key] || {}, n = 0, done = 0;
        TEAM_WISH_SLOTS.forEach(function (sl) { var c = cfgs[sl]; if (c && c.item) { n++; var s = tw_status(key, sl); if (s && s.state == "fertig") done++; } });
        h += "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Zielbau " + lab + (n ? " " + done + "/" + n : "") + (st && st.slots ? "" : " <small>(keine Statusmeldung)</small>") + "</span><button data-act='twtoggle' data-k='" + key + "'>" + (open ? "▾" : "▸") + " Zielbau</button>" + (open ? "<button data-act='twnow' data-k='" + key + "' class='on' title='Zielbau jetzt abarbeiten: kaufen, aufwerten, übergeben'>Jetzt</button><button data-act='twist' data-k='" + key + "' title='alle Slots auf das setzen, was er gerade trägt'>Ist</button><button data-act='twmode'" + (team_wish_mode >= 2 ? " class='on'" : "") + " title='Stufe 1: nur NPC-Teile · Stufe 2: auch Marktangebote auf diesem Server unter dem Preislimit'>leicht: " + (team_wish_mode >= 2 ? "NPC + Markt" : "nur NPC") + "</button><button data-act='twstat'" + (team_wish_stat ? " class='on'" : "") + " title='fertige Teile bekommen vor der Übergabe den Klassen-Attribut-Scroll (Priest int, Ranger dex)'>Attribut</button><button data-act='twclear' data-k='" + key + "' title='alle Ziele löschen'>✕</button>" : "") + "</div>";
        if (!open) return;
        h += "<table class='lp_t' style='font-size:11px'><tr><th style='text-align:left'>Slot</th><th style='text-align:left'>getragen</th><th style='text-align:left'>Ziel</th><th>Stufe</th><th>Limit</th><th style='text-align:left'>Stand</th></tr>";
        TEAM_WISH_SLOTS.forEach(function (sl) {
            var c = cfgs[sl] || {}, worn = st && st.slots && st.slots[sl], cands = tw_candidates(key, sl), cur = c.item || "";
            if (cur && !cands.some(function (x) { return x.name == cur; })) { var d0 = G.items[cur]; if (d0) cands.unshift({ name: cur, def: d0, npc: is_buyable(cur), offer: null, score: gear_score_for(d0, c.level || 0, TEAM_CTYPE[key]) }); }
            var sel = "<select data-twslot='" + key + ":" + sl + "' style='font-size:11px;background:#1c2029;color:#eee;border:1px solid #555;max-width:190px'><option value=''" + (!cur ? " selected" : "") + ">– kein Ziel –</option>";
            cands.forEach(function (x) { sel += "<option value='" + x.name + "'" + (x.name == cur ? " selected" : "") + ">" + esc((x.def.name && x.def.name != x.name ? x.def.name + " [" + x.name + "]" : x.name) + " (" + Math.round(x.score) + ")" + (x.npc ? " NPC " + fmt(x.def.g || 0) : x.offer ? " Markt " + fmt(x.offer.price) : "")) + "</option>"; });
            sel += "</select>";
            var lv = ""; if (cur) { var mx = G.items[cur] && G.items[cur].upgrade ? TEAM_BUILD_MAX_LEVEL : 0; lv = "<select data-twlvl='" + key + ":" + sl + "' style='font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>"; for (var L = 0; L <= mx; L++) lv += "<option value='" + L + "'" + (L == (c.level || 0) ? " selected" : "") + ">+" + L + "</option>"; lv += "</select>"; }
            var s = tw_status(key, sl);
            h += "<tr><td>" + sl + "</td><td>" + (worn ? esc(worn.name + "+" + (worn.level || 0)) : "<span style='color:#666'>–</span>") + "</td><td>" + sel + "</td><td>" + lv + "</td><td>" + (cur ? "<input data-twmax='" + key + ":" + sl + "' value='" + (c.max ? esc(fmt_mio(c.max)) : "") + "' placeholder='0,5' style='width:40px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>" : "") + "</td><td style='color:" + (s && s.state == "fertig" ? "#4caf50" : "#e6e6e6") + "'>" + (s ? esc(s.text) : "") + "</td></tr>";
        });
        h += "</table>";
    });
    return h;
}

// ---------- Server-Event Giga Crab (crabxx): hinspringen, Huge Crabs farmen, Boss von außen anschießen; Team springt mit ----------
var event_on = true; try { event_on = localStorage.getItem("lp_event_on") != "0"; } catch (e) {}
var event_mode = null, event_prev = null, last_event_check = 0, event_boss_hits = 0, event_since = 0, event_empty_since = 0;
var EVENT_BOSS_MIN_DIST = 110, EVENT_BOSS_MAX_DIST = 190;
function event_status() { try { var st = (typeof server != "undefined" && server && server.status) || parent.S || {}; var e = st.crabxx; return e && (e.live !== false) ? e : null; } catch (e) { return null; } }
function event_boss() { try { for (var id in parent.entities) { var m = parent.entities[id]; if (m && m.type == "monster" && m.mtype == "crabxx" && !m.dead) return m; } } catch (e) {} return null; }
function event_tick() {
    if (Date.now() - last_event_check < 10000) return; last_event_check = Date.now();
    var st = event_status();
    if (!event_mode) {
        if (!event_on || !st || paused || busy || upgrading || server_trip || focus_mode || arb_job || merch_test) return;
        if (st.hp != null && st.hp <= 0) return; // Boss schon tot, Meldung hängt nach
        event_prev = { manual_spot: manual_spot, user_manual: user_manual }; event_mode = "crabxx"; event_since = Date.now(); event_boss_hits = 0; event_empty_since = 0;
        manual_spot = "crabx"; user_manual = null; current_spot = "crabx"; need_repick = true; meas = null; if (hunt_spot) { hunt_spot = null; }
        game_log("Event: Giga Crab läuft (HP " + (st.max_hp ? Math.round((st.hp || 0) / st.max_hp * 100) + " %" : "?") + ", Status " + JSON.stringify(st).slice(0, 120) + ") – springe hin, Team folgt"); last_panel = 0;
        event_join();
        return;
    }
    if (!st) { event_leave("Event vorbei"); return; }
    if (!event_on) { event_leave("Teilnahme abgeschaltet"); return; }
    if (st.hp != null && st.hp <= 0) { event_leave("Giga Crab besiegt"); return; }
    // am Event-Ort, aber weder Boss noch Huge Crabs in Sicht: nach 60 s aufgeben (Meldung hängt nach)
    var near = st.map && character.map == st.map && st.x != null && distance(character, { x: st.x, y: st.y }) < 600;
    var seen = !!event_boss() || !!get_nearest_monster({ type: "crabx" });
    if (near && !seen) { if (!event_empty_since) event_empty_since = Date.now(); else if (Date.now() - event_empty_since > 60000) { event_leave("am Event-Ort nichts mehr zu sehen"); return; } }
    else event_empty_since = 0;
    // nicht am Event-Ort (anderer Kartenbereich)? nochmal springen
    if (st.map && (character.map != st.map || (st.x != null && distance(character, { x: st.x, y: st.y }) > 900)) && !busy && !fleeing) event_join();
}
function event_join() {
    try { var r = join("crabxx"); if (r && typeof r.then == "function") r.then(function () { game_log("Event: angekommen"); }, function (e) { game_log("Event: Sprung fehlgeschlagen: " + JSON.stringify(e).slice(0, 120)); }); } catch (e) { game_log("Event: join-Fehler " + err_txt(e)); }
    ["priest", "ranger"].forEach(function (k) { if (team_on[k] && team_running(TEAM[k])) team_send(TEAM[k], { t: "join", event: "crabxx" }); });
}
function event_leave(why) {
    game_log("Event: " + why + " – zurück zum normalen Betrieb" + (event_boss_hits ? " (" + event_boss_hits + " Treffer auf Giga Crab)" : ""));
    if (event_prev) { manual_spot = event_prev.manual_spot; user_manual = event_prev.user_manual; } event_prev = null; event_mode = null;
    current_spot = null; need_repick = true; meas = null; last_hunt_check = 0; last_panel = 0;
    stop("smart"); change_target(null); if (!paused) go_to_farm_spot();
}
function event_boss_step() { // kein crabx in Sicht: Giga Crab von außerhalb seiner Reichweite anschießen, Abstand halten
    var bx = event_boss(); if (!bx) return false;
    if (bx.target && (bx.target == character.name || TEAM_NAMES.indexOf(bx.target) >= 0)) { // Boss hat einen von uns im Visier: weg (16k Schaden = Tod)
        var dx = character.x - bx.x, dy = character.y - bx.y, len = Math.hypot(dx, dy) || 1; try { move(character.x + dx / len * 200, character.y + dy / len * 200); } catch (e) {} set_message("Boss-Abstand!"); return true;
    }
    var d = distance(character, bx);
    if (d < EVENT_BOSS_MIN_DIST) { var dx2 = character.x - bx.x, dy2 = character.y - bx.y, l2 = Math.hypot(dx2, dy2) || 1; try { move(bx.x + dx2 / l2 * (EVENT_BOSS_MIN_DIST + 30), bx.y + dy2 / l2 * (EVENT_BOSS_MIN_DIST + 30)); } catch (e) {} return true; }
    var rng = Math.min(character.range || 150, EVENT_BOSS_MAX_DIST);
    if (d > rng) { var dx3 = character.x - bx.x, dy3 = character.y - bx.y, l3 = Math.hypot(dx3, dy3) || 1, want = Math.max(EVENT_BOSS_MIN_DIST, rng - 15); try { move(bx.x + dx3 / l3 * want, bx.y + dy3 / l3 * want); } catch (e) {} set_message("Zum Boss"); return true; }
    if (can_attack(bx)) { try { attack(bx); event_boss_hits++; last_target_id = bx.id; set_message("Giga Crab " + fmt(bx.hp) + "/" + fmt(bx.max_hp)); } catch (e) {} }
    return true;
}
function event_html() {
    var st = event_status(); if (!st && !event_mode) return "";
    return "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Event: <span style='color:#e6e6e6'>Giga Crab" + (st && st.max_hp ? " " + Math.round((st.hp || 0) / st.max_hp * 100) + " % HP" : "") + (event_mode ? " – dabei seit " + Math.round((Date.now() - event_since) / 60000) + " min, " + event_boss_hits + " Treffer" : "") + "</span></span><button data-act='eventon'" + (event_on ? " class='on'" : "") + " title='am Server-Event teilnehmen (Vorrang vor Jagd)'>Teilnehmen</button></div>";
}
function hunts_html() { // Rundlauf: Jagden aller Kämpfer mit Status
    if (SOLO) return "";
    var items = [], th = team_hunt_pick(), q = mh_quest();
    function st_txt(id, c, ms, mine, who) {
        if (!id || !(c > 0)) return "keine";
        var d = G.monsters[id], dg = d ? Math.round(mon_danger(d) * 100) : 0, ok = mine ? hunt_target_ok(id) : (th && th.id == id);
        var run = current_spot == id && !paused;
        if (!ok && !mine && hunt_allowed(id) && !spot_blocked(id) && !hunt_bad_for(id)) return esc(id) + " " + c + " <span style='color:#8ab4f8'>wartet" + (th ? " (nach " + esc(th.who) + ")" : "") + "</span>";
        return esc(id) + " " + c + (ok ? (run ? " <span style='color:#4caf50'>läuft</span>" : " <span style='color:#8ab4f8'>machbar" + (mine ? "" : ", als Nächstes") + "</span>") : " <span style='color:#ffb74d'>" + esc(hunt_skip_reason(id)) + (ms != null ? ", läuft aus " + fmt_time(ms) : "") + "</span>");
    }
    items.push("Mage " + st_txt(q && q.id, q && q.c, q && q.ms, true));
    ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 120000) { items.push(TEAM_LABEL[k] + " ?"); return; } var h = st.hunt; items.push(TEAM_LABEL[k] + " " + st_txt(h && h.id, h && h.c, h && h.ms != null ? Math.max(0, h.ms - (Date.now() - st.t)) : null, false)); }); // Restzeit ab Meldezeitpunkt weiterzählen
    var w = wait_txt();
    return "<span style='color:#9aa3b2'>Jagden: </span>" + items.join(" · ") + (w ? " <span style='color:#ffb74d'>· " + esc(w) + "</span>" : "");
}
var TEAM_POT_FULL = 800, TEAM_POT_MIN = 300;
function team_pots_need() { // Priest/Ranger unter 300 Tränken: der Händler bringt bei der Abholung auf 800 auf
    var out = []; if (SOLO) return out;
    ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 120000 || st.hpots == null) return; var hp = Math.max(0, TEAM_POT_FULL - st.hpots), mp = Math.max(0, TEAM_POT_FULL - (st.mpots || 0)); if (st.hpots < TEAM_POT_MIN || (st.mpots || 0) < TEAM_POT_MIN) out.push({ name: TEAM[k], hp: hp, mp: mp }); });
    return out;
}
function team_where_txt(nm, st) { // Karte + Entfernung eines Teammitglieds (aus Status/Sichtweite)
    try { var pe = get_player(nm); if (pe && pe.map == character.map) return " · " + Math.round(distance(character, pe)) + " px entfernt"; } catch (e) {}
    if (st && st.map) return " · " + esc(st.map) + (st.map != character.map ? " (andere Karte)" : " (außer Sicht)");
    return "";
}
function team_html() {
    var parts = [];
    for (var k in TEAM) {
        var nm = TEAM[k], st = team_state[nm], run = team_running(nm), lab = TEAM_LABEL[k]; var raw = active_chars()[nm];
        var pe = null; try { pe = get_player(nm); if (pe && pe.rip && st) st.state = "tot"; } catch (e) {}
        var fresh = st && Date.now() - st.t < 60000, same = pe && pe.map == character.map, dist = same ? Math.round(distance(character, pe)) : null;
        var warn = !team_on[k] ? "" : !run ? "aus/offline" : !fresh ? "keine Meldung" + (st && Date.now() - st.t < 3600000 ? " seit " + fmt_time(Date.now() - st.t) : "") : st.state == "tot" ? "tot" : (k != "merch" && !same) ? "andere Karte (" + (st.map || "?") + ")" : (k != "merch" && dist > WAIT_BEHIND) ? dist + " px zurück" : "";
        var col = !team_on[k] ? "#9aa3b2" : warn ? "#ffb74d" : "#4caf50", sym = !team_on[k] ? "" : warn ? " ⚠" : " ✓";
        var tip = lab + (fresh ? " Lv " + st.level + " · " + (st.state || "") + (st.map ? " · " + st.map : "") + (dist != null ? " · " + dist + " px" : "") + (st.hpots != null ? " · Tränke " + st.hpots + "/" + (st.mpots || 0) : "") + (st.tokens != null ? " · " + st.tokens + " Tokens" : "") + (st.gold != null ? " · " + fmt(st.gold) + " Gold" : "") + (st.hunt && st.hunt.c > 0 ? " · Jagd " + st.hunt.id + " " + st.hunt.c : "") : run ? " (" + String(raw) + ", keine Meldung)" : team_on[k] ? " (aus/offline)" : " aus");
        parts.push("<span style='color:" + col + "' title='" + esc(tip) + "'>" + lab + sym + (fresh ? " Lv " + st.level : "") + (warn ? " <small>" + esc(warn) + "</small>" : "") + "</span> <button data-act='team' data-k='" + k + "'" + (team_on[k] ? " class='on'" : "") + " style='padding:0 5px'>" + (team_on[k] ? "an" : "aus") + "</button><button data-act='tchar' data-nm='" + TEAM[k] + "' title='Fenster: Charakter & Inventar von " + lab + "'" + (tchar_panels[TEAM[k]] && tchar_panels[TEAM[k]].parentNode ? " class='on'" : "") + " style='padding:0 5px'>▣</button>");
    }
    var btns = "";
    btns += "<button data-act='teamlogs' title='gespeicherte Logs von Merch/Priest/Ranger (letzte 40 Zeilen je Char) ins Log holen'>Team-Logs</button>";
    var give = "";
    if (team_on.priest || team_on.ranger) { // manuelle Übergabe: Inventarteil auswählen, an Priest/Ranger geben (der legt es an, wenn es besser ist)
        var opts = "", any = false;
        for (var gi = 0; gi < character.items.length; gi++) { var git = character.items[gi]; if (!git) continue; var gd = G.items[git.name]; if (!gd || KEEP_ITEMS.test(git.name) || EVENT_ITEMS.test(git.name)) continue; var ok = false; for (var gsl in SLOT_TYPES) { if ((team_on.priest && fits_class(gd, "priest", gsl)) || (team_on.ranger && fits_class(gd, "ranger", gsl))) { ok = true; break; } } if (!ok) continue; any = true; opts += "<option value='" + gi + "'" + (give_sel == gi ? " selected" : "") + ">" + esc((gd.name || git.name) + "+" + (git.level || 0) + (git.q > 1 ? " ×" + git.q : "") + " [" + (gi + 1) + "]") + "</option>"; }
        if (any) give = "<div class='lp_row' style='flex-wrap:wrap'><span class='lp_k' title='Teil aus dem Inventar an ein Teammitglied geben – es muss neben dir stehen; angelegt wird es dort, wenn es besser ist'>Geben:</span> <select data-give='1' style='font-size:11px;background:#1c2029;color:#eee;border:1px solid #555;max-width:220px'><option value=''" + (give_sel < 0 ? " selected" : "") + ">– Teil wählen –</option>" + opts + "</select>" + (team_on.priest ? " <button data-act='give' data-k='priest' style='padding:0 6px'>→ Priest</button>" : "") + (team_on.ranger ? " <button data-act='give' data-k='ranger' style='padding:0 6px'>→ Ranger</button>" : "") + "</div>";
    }
    return "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'><span class='lp_k'>Team:</span> " + parts.join(" · ") + "</div><div class='lp_row' style='flex-wrap:wrap;margin-top:0'>" + btns + " " + (give ? give.replace("<div class='lp_row' style='flex-wrap:wrap'>", "").replace(/<\/div>$/, "") : "") + "</div>";
}
// ---------- Test: kann ein Nebencharakter auf einem anderen Server gestartet werden? ----------
var merch_test = null; // { stage: "stopped"|"started", t, target: {region, id}, sv }
function other_server() { var me = split_server(my_server().toUpperCase()); if (!me) return null; var id = me.id.toUpperCase() == "I" ? "II" : "I"; return { region: me.region, id: id }; }
function start_merch_test() {
    if (merch_test) { game_log("Servertest läuft schon (" + merch_test.stage + ")"); return; }
    var tgt = other_server(); if (!tgt) { game_log("Servertest: eigenen Server nicht erkannt (" + my_server() + ")"); return; }
    try { game_log("Servertest: start_character = " + String(start_character).replace(/\s+/g, " ").slice(0, 160)); } catch (e) {}
    try { var r = parent.start_character_runner; game_log("Servertest: start_character_runner = " + (r ? String(r).replace(/\s+/g, " ").slice(0, 400) : "nicht vorhanden")); } catch (e) {}
    var nm = TEAM.merch;
    try { if (active_chars()[nm]) stop_character(nm); } catch (e) {}
    try { parent.__lp_team_restart_after = Date.now() + 120000; } catch (e) {}
    merch_test = { stage: "stopped", t: Date.now(), target: tgt, sv: null };
    game_log("Servertest: Händler gestoppt, Start auf " + pretty_server(tgt.region + tgt.id) + " in 15 s"); last_panel = 0;
}
function merch_test_tick() {
    if (!merch_test) return; var nm = TEAM.merch, el = Date.now() - merch_test.t;
    if (merch_test.stage == "stopped" && el > 15000) {
        merch_test.stage = "started"; merch_test.t = Date.now();
        try { start_char_on_server(nm, merch_test.target.region, merch_test.target.id); game_log("Servertest: eigenes Fenster für " + nm + " auf " + pretty_server(merch_test.target.region + merch_test.target.id) + " angelegt"); } catch (e) { game_log("Servertest: Fenster-Fehler " + err_txt(e)); merch_test_finish(); }
        setTimeout(function () { try { var w = team_windows()[nm]; if (w && w.win) { var fr = null; try { fr = w.win.frameElement; } catch (e) {} game_log("Servertest: Fenster-URL " + String((fr && fr.src) || "?").slice(0, 160) + " · server_region/identifier " + (w.win.server_region || "?") + "/" + (w.win.server_identifier || "?") + " · aktiv: " + JSON.stringify(active_chars())); } else game_log("Servertest: kein Fenster für " + nm + " gefunden (Fenster lädt noch?)"); } catch (e) { game_log("Servertest: Fenster-Prüfung " + err_txt(e)); } }, 20000);
        return;
    }
    if (merch_test.stage == "started") { try { var wh = JSON.parse(localStorage.getItem("lp_where_" + nm) || "null"); if (wh && wh.t > merch_test.t) { merch_test_result(wh.sv); return; } } catch (e) {} } // Rückmeldung über den gemeinsamen Speicher (Nachrichten gehen nur auf demselben Server)
    if (merch_test.stage == "started" && el > 75000) { game_log("Servertest: keine Meldung vom Händler nach 75 s – Ergebnis unklar (Log prüfen)"); merch_test_finish(); }
}
function start_char_on_server(nm, region, id) { // Nebencharakter-Fenster wie das Spiel anlegen, aber mit Wunschserver in der Adresse
    var doc = parent.document, rid = "ichar" + nm.toLowerCase();
    var old = doc.getElementById(rid); if (old) { try { old.remove(); } catch (e) {} }
    var ref = null; try { var wins = team_windows(); for (var k in wins) { if (wins[k].win && wins[k].win.frameElement) { ref = wins[k].win.frameElement; break; } } } catch (e) {}
    var f = ref ? ref.cloneNode(false) : doc.createElement("iframe");
    if (!ref) { f.style.display = "none"; }
    f.id = rid; f.removeAttribute("src");
    f.src = "https://adventure.land/character/" + encodeURIComponent(nm) + "/in/" + region + "/" + id + "/?no_html=true&is_bot=1&code=1";
    (ref && ref.parentNode ? ref.parentNode : doc.body).appendChild(f);
    return f;
}
function merch_test_result(sv) {
    var want = (merch_test.target.region + merch_test.target.id).toLowerCase(), got = String(sv || "").replace(/\s+/g, "").toLowerCase();
    game_log("Servertest: Händler meldet sich von " + (sv ? pretty_server(sv) : "unbekannt") + " → " + (got == want ? "FUNKTIONIERT – Nebencharakter läuft über eigenes Fenster auf einem anderen Server" : "landet trotzdem zuhause (gewollt " + pretty_server(want.toUpperCase()) + ")"));
    merch_test.sv = sv; merch_test.stage = "fertig"; setTimeout(merch_test_finish, 3000);
}
function merch_test_finish() {
    if (!merch_test) return; merch_test = null; var nm = TEAM.merch;
    try { if (active_chars()[nm]) stop_character(nm); } catch (e) {}
    try { var f = parent.document.getElementById("ichar" + nm.toLowerCase()); if (f) f.remove(); } catch (e) {} // unser eigenes Fenster wieder entfernen
    try { parent.__lp_team_restart_after = Date.now() + 20000; } catch (e) {}
    game_log("Servertest beendet – Händler wird in 20 s zuhause neu gestartet"); last_panel = 0;
}
var give_sel = -1;
function give_to_team(key) { // ausgewähltes Inventarteil an Priest/Ranger senden
    var nm = TEAM[key], lab = TEAM_LABEL[key], i = give_sel, it = i >= 0 ? character.items[i] : null;
    if (!it) { game_log("Geben: erst ein Teil auswählen"); return; }
    var p = get_player(nm); if (!p || p.rip) { game_log("Geben: " + lab + " nicht in Sicht"); return; }
    if (p.map != character.map || distance(character, p) > 350) { game_log("Geben: " + lab + " zu weit weg (" + (p.map != character.map ? "andere Karte" : Math.round(distance(character, p)) + " Einheiten") + ") – er muss neben dir stehen"); return; }
    var st = team_state[nm]; if (st && typeof st.free == "number" && st.free < 1) { game_log("Geben: " + lab + " hat keinen freien Inventarplatz – er verkauft Reste beim nächsten Stadtgang"); return; }
    var def = G.items[it.name], slot = null; for (var sl in SLOT_TYPES) { if (fits_class(def, TEAM_CTYPE[key], sl)) { slot = sl; break; } }
    if (!slot) { game_log("Geben: " + it.name + " passt nicht zu " + lab); return; }
    try { team_send(nm, { t: "gear", name: it.name, level: it.level || 0, slot: slot, manual: true }); send_item(nm, i, it.q || 1); game_log("[" + lab + "] bekommt " + it.name + "+" + (it.level || 0) + " (manuell, " + slot + ")"); give_sel = -1; last_panel = 0; } catch (e) { game_log("Geben: " + err_txt(e)); }
}
function team_threat() { // Monster, das ein Teammitglied angreift und in meiner Nähe ist
    var best = null, bd = 260;
    for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead || !m.target || TEAM_NAMES.indexOf(m.target) < 0) continue; if (m.max_hp > character.max_hp * MAX_TARGET_HP_FACTOR * 1.5) continue; var d = distance(character, m); if (d < bd) { bd = d; best = m; } }
    return best;
}

// ---------- Tasten (direkt per Tastatur, unabhängig vom Loader) ----------
function on_key(ev) {
    var t = ev.target;
    if (t && (t.tagName == "INPUT" || t.tagName == "TEXTAREA" || t.isContentEditable)) return; // nicht beim Tippen
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.repeat) return; // Taste gehalten: nur der erste Anschlag zählt
    var k = (ev.key || "").toUpperCase();
    if (k == "P") toggle_pause();
    else if (k == "N") reload_bot();
    else if (k == "U") preempt("U – Upgrades", upgrade_routine);
    else if (k == "L") log_stats();
    else if (k == "D") event_debug();
    else if (k == "G") preempt("G – Tausch", exchange_gifts);
}
// alte Snippet-Belegungen aus früheren Versionen entfernen
try { unmap_key("P"); unmap_key("U"); unmap_key("K"); unmap_key("L"); unmap_key("N"); } catch (e) {}
// alten Handler (von vorherigem Run) entfernen, dann neu registrieren
if (parent.__logicplan_keyhandler) parent.document.removeEventListener("keydown", parent.__logicplan_keyhandler);
parent.__logicplan_keyhandler = on_key;
if (!SOLO) parent.document.addEventListener("keydown", on_key);

// Diagnose: Event-Daten (Serverstatus, Emotes, Items) als Fenster anzeigen
function event_debug() {
    var S = parent.S || {};
    var out = { S_keys: Object.keys(S), S_small: {}, emotes: [], skills: [], items: [], my_emotes: character.emx || null };
    Object.keys(S).forEach(function (k) {
        try { var j = JSON.stringify(S[k]); if (j && j.length < 400) out.S_small[k] = S[k]; else out.S_small[k] = "(gross: " + (j ? j.length : "?") + ")"; } catch (e) {}
    });
    var rx = /kiss|kuss|anniv|cake|gift|birthday|visit/i;
    if (G.emotes) Object.keys(G.emotes).forEach(function (k) { if (rx.test(k) || rx.test(JSON.stringify(G.emotes[k]))) out.emotes.push([k, G.emotes[k]]); });
    Object.keys(G.skills).forEach(function (k) { if (rx.test(k) || rx.test(G.skills[k].name || "")) out.skills.push([k, G.skills[k].name, G.skills[k].type]); });
    Object.keys(G.items).forEach(function (k) { if (rx.test(k) || rx.test(G.items[k].name || "")) out.items.push([k, G.items[k].name, G.items[k].type]); });
    out.inventory = character.items.filter(function (i) { return i; }).map(function (i) { return i.name + (i.q ? " x" + i.q : ""); });
    out.parent_funcs = Object.keys(parent).filter(function (k) { return /gift|open|kiss|anniv|cake/i.test(k); });
    try { out.chance_keys = Object.keys(parent).filter(function (k) { return /chance|probab|upgrade|compound|grade/i.test(k); }).map(function (k) { return k + ":" + typeof parent[k]; }); } catch (e) {}
    try { out.upgrade_fn = String(parent.upgrade || "").slice(0, 900); out.calc_grade = String(parent.calculate_item_grade || "").slice(0, 400); } catch (e) {}
    out.kiss_skill = G.skills.ikissyou || null;
    show_json(out);
    game_log("Event-Diagnose angezeigt (Fenster) – bitte Screenshot");
}

function reload_bot() {
    try { if (parent.__lp_reloading && Date.now() - parent.__lp_reloading < 8000) return; parent.__lp_reloading = Date.now(); } catch (e) {} // gedrückt gehaltenes N / Doppelklick: nur ein Neuladen auf einmal (mehrere parallele Starts zerlegen sonst Team-Kanal und Timer)
    game_log("Lade neueste Version von GitHub …");
    fetch(BOT_BASE + "version.txt?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw "HTTP " + r.status; return r.text(); })
        .then(function (v) {
            v = v.trim();
            if (v == BOT_VERSION) game_log("Bereits aktuell (" + v + ") – starte trotzdem neu");
            return fetch(BOT_BASE + "bot_" + v + ".js", { cache: "no-store" }).then(function (r) { if (!r.ok) throw "HTTP " + r.status + " bei bot_" + v + ".js"; return r.text(); });
        })
        .then(function (code) {
            parent.__lp_resume = { paused: paused, t: Date.now(), timers: { last_ponty: last_ponty, last_market: last_market, shells_retry_at: shells_retry_at, hunt_cooldown_until: hunt_cooldown_until, cake_next: cake_next, last_hunt_check: last_hunt_check, last_global_scan: last_global_scan, last_auto_gear: last_auto_gear, last_arb_trip: last_arb_trip } }; // Zustand für die neue Version
            if (main_timer) clearInterval(main_timer); main_timer = null; parent.__lp_main_timer = null;
            stop("smart"); stop("move");
            // Team bleibt eingeloggt und bekommt die neue Version per Einspielen (team_inject), kein Neustart mehr
            try { eval(code); } catch (e) { game_log("Startfehler: " + e); start_main(); }
        })
        .catch(function (e) { game_log("Neu laden fehlgeschlagen: " + e); });
}
function toggle_bot() {
    bot_running = !bot_running;
    if (!bot_running) {
        if (main_timer) clearInterval(main_timer); main_timer = null; parent.__lp_main_timer = null;
        stop("smart"); stop("move"); busy = false; upgrading = false; kissing = false; fleeing = false; exchanging = false; pontying = false;
        set_message("BOT AUS"); game_log("Bot AUS (O zum Starten) – nur das Panel läuft weiter");
        try { update_panel(); } catch (e) {}
        if (!parent.__lp_panel_timer) parent.__lp_panel_timer = setInterval(function () { try { update_panel(); } catch (e) {} }, 2000);
    } else {
        if (parent.__lp_panel_timer) { clearInterval(parent.__lp_panel_timer); parent.__lp_panel_timer = null; }
        paused = true; start_main();
        set_message("PAUSE"); game_log("Bot AN – pausiert, P zum Losfarmen");
    }
}
function routine_running() { return upgrading || kissing || fleeing || exchanging || pontying || marketing || shelling || hunting || bank_cleaning || sorting_inv || baking; }
var busy_since = 0;
function busy_watchdog() { // hängt eine Routine (busy ohne Ende), nach 4 min freigeben
    if (!busy) { busy_since = 0; return; }
    if (!busy_since) busy_since = Date.now();
    else if (Date.now() - busy_since > (routine_running() ? 25 : 4) * 60000) { busy_since = 0; game_log("Routine hängt – gebe frei"); busy = false; upgrading = false; kissing = false; exchanging = false; pontying = false; marketing = false; shelling = false; hunting = false; bank_cleaning = false; sorting_inv = false; baking = false; }
}
function toggle_pause() {
    paused = !paused; last_team_cast = 0; try { team_broadcast(); } catch (e) {}
    if (paused) {
        stop("move"); stop("smart"); change_target(null); if (!routine_running()) busy = false; // laufende Routinen beenden sich selbst (check_pause)
        set_message("PAUSE");
        game_log(upgrading ? "Pause – Upgrade wird nach dem aktuellen Schritt abgebrochen" : "Bot pausiert (P zum Fortsetzen)");
    } else {
        set_message("Weiter"); game_log("Bot läuft wieder");
    }
}

// ---------- Wege: Town-Teleport nutzen, wenn er den Weg verkürzt ----------
function town_spawn(map) { var md = G.maps[map]; var sp = md && md.spawns && md.spawns[0]; return sp ? { map: map, x: sp[0], y: sp[1] } : null; }
function spot_position(mon) { // erste Spawnposition des Monsters (irgendeine Karte)
    for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.monsters || md.ignore) continue; for (var i = 0; i < md.monsters.length; i++) { var e = md.monsters[i]; if (e.type != mon) continue; if (e.boundary) return { map: map, x: (e.boundary[0] + e.boundary[2]) / 2, y: (e.boundary[1] + e.boundary[3]) / 2 }; if (e.boundaries && e.boundaries[0]) { var b = e.boundaries[0]; return { map: b[0], x: (b[1] + b[3]) / 2, y: (b[2] + b[4]) / 2 }; } } }
    return null;
}
async function town_teleport() { // "town" nutzen und warten, bis wirklich angekommen
    var ts = town_spawn(character.map), t0 = Date.now();
    set_message("Teleport"); try { use_skill("town"); } catch (e) { return false; }
    await sleep(1500);
    while (Date.now() - t0 < 9000) { var ts2 = town_spawn(character.map); if (ts2 && distance(character, ts2) < 250 && !is_moving(character)) { await sleep(400); return true; } await sleep(300); }
    return ts ? distance(character, ts) < 400 : false;
}
async function travel_place(name) { // Orte in der Stadt: bei großer Entfernung teleportieren
    try {
        var ts = town_spawn(character.map);
        if (ts && skill_available("town") && !is_on_cooldown("town") && !character.rip && (character.map != "main" || distance(character, ts) > 900)) await town_teleport();
    } catch (e) {}
    return smart_move(name);
}
async function travel(dest) { // dest: Monstername, Ortsname oder {map,x,y}
    var pos = typeof dest == "string" ? (G.monsters[dest] ? spot_position(dest) : null) : dest;
    try {
        if (pos && pos.map && !character.rip && skill_available("town") && !is_on_cooldown("town")) {
            var ts = town_spawn(character.map);
            var direct = pos.map == character.map ? distance(character, pos) : Infinity;
            var via_town = ts ? (pos.map == character.map ? distance(ts, pos) : distance(ts, ts) + 1500) : Infinity;
            var here_to_town = ts ? distance(character, ts) : 0;
            if (ts && here_to_town > 600 && via_town + 600 < direct) await town_teleport();
        }
    } catch (e) {}
    try { return await smart_move(dest); }
    catch (e) { if (paused || aborted()) throw e; await sleep(2000); if (paused || aborted()) throw e; stop("smart"); return smart_move(dest); } // einmal erneut versuchen – nicht bei Pause/Abbruch
}

// ---------- Farmspot: automatisch nach XP/h und Gold/h ----------
function load_stats() { try { return JSON.parse(localStorage.getItem("lp_farm_" + character.name) || "{}"); } catch (e) { return {}; } }
function save_stats() { try { localStorage.setItem("lp_farm_" + character.name, JSON.stringify(farm_stats)); } catch (e) {} }

// Ist das Monster für meine Werte schaffbar?
function is_safe_monster(mon) {
    var d = G.monsters[mon];
    if (!d || EXCLUDE[mon]) return false;
    if (d.cooperative || d.boss || d.special || d.abilities) return false; // Sonderfähigkeiten (Einfrieren etc.) meiden
    if (d.attack * HITS_TO_DIE_MIN > character.max_hp) return false;
    if (mon_danger(d) > MAX_DANGER || mon_ttk(d) > MAX_TTK) return false;
    return true;
}
function stats_valid(st) {
    if (!st || (Date.now() - st.t) >= REEVAL_MS) return false;
    if (st.attack && Math.abs(character.attack - st.attack) / st.attack > ATTACK_DRIFT) return false;
    return true;
}
// Geschätztes Potenzial aus Spieldaten: XP pro Kill / nötige Schläge
function estimate(mon) { return mon_xph_est(G.monsters[mon], mon) / 100; }
var TEAM_ESCORT_LEVEL = 20; // bis zu diesem Priester-Level nur Spots, die der Priester überlebt
function team_escort() { // mitlaufender, noch schwacher Charakter (Priester unter Lv 20, Händler in der Level-Phase)
    var weakest = null;
    [["priest", TEAM_ESCORT_LEVEL], ["ranger", TEAM_ESCORT_LEVEL], ["merch", 40]].forEach(function (p) {
        var k = p[0], nm = TEAM[k]; if (!team_on[k]) return; var st = team_state[nm];
        if (!st || Date.now() - st.t > 120000 || !team_running(nm)) return;
        if (k == "merch" && !/levelt|folgt/.test(st.state || "")) return; // Händler nur, wenn er gerade mitläuft
        if (st.level < p[1] && (!weakest || st.level < weakest.level)) weakest = st;
    });
    return weakest;
}
function team_safe(mon) { // Spot für den Priester tragbar: Monsterlevel nahe seinem Level, Angriff klein gegen seine HP
    var esc = team_escort(); if (!esc) return true;
    var d = G.monsters[mon]; if (!d) return true;
    var php = esc.max_hp || (60 + esc.level * 30);
    return (d.level || 1) <= esc.level + 3 && d.attack * 4 <= php;
}
var team_safe_warned = 0;
function escort_name() { var e = team_escort(); if (!e) return "das Team"; var nm = e.name || ""; for (var k in TEAM) if (team_state[TEAM[k]] === e) nm = (k == "merch" ? "den Händler" : k == "ranger" ? "den Ranger" : "den Priester"); return nm + " (Lv " + e.level + ")"; }
function candidate_list() {
    var list = visible_mons().filter(function (m) {
        if (!hunt_allowed(m)) return false; // Automatik nur auf Monster mit Jagd-Häkchen (eine Liste für Automatik, Messung und Jagd)
        if (!is_safe_monster(m)) return false; // ... und nach Basiswerten sicher
        if (spot_blocked(m)) return false;
        if (!team_safe(m)) return false;
        var st = farm_stats[m];
        if (st && st.unsafe_until && character.level < st.unsafe_until) return false;
        return true;
    });
    list.sort(function (a, b) { return estimate(b) - estimate(a); });
    return list.slice(0, MEASURE_TOP);
}
function hunt_slot_state() { // Team holt nur eine Jagd zur Zeit: {busy, holder, fetcher}
    var q = mh_quest(), now = Date.now();
    if (SOLO) return { busy: false, holder: null, fetcher: character.name };
    var active = null, missing = 0, free = [];
    if (q && q.c > 0 && hunt_target_ok(q.id)) active = "Mage (" + q.id + ")";
    if (!q || q.c == 0) free.push(character.name);
    ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || now - st.t > 90000) { missing++; return; } var h = st.hunt; if (h && h.c > 0) { if (!active && hunt_target_ok(h.id)) active = TEAM_LABEL[k] + " (" + h.id + ")"; } else free.push(TEAM[k]); });
    if (active) return { busy: true, holder: active, fetcher: null };
    if (missing && now - boot_t < 45000) return { busy: true, holder: "warte auf Statusmeldungen", fetcher: null };
    return { busy: false, holder: null, fetcher: free[0] || null };
}
var hunt_slot_logged = 0;
function team_hunt_pick() { // Jagdmonster von Priest/Ranger, das für uns sicher ist (nur wenn keine eigene Jagd läuft)
    if (SOLO || hunt_spot) return null;
    var list = [], missing = 0; ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 90000) { missing++; return; } if (!st.hunt || !(st.hunt.c > 0)) return; var id = st.hunt.id; if (hunt_target_ok(id) && spawn_count(id) > 0) list.push({ id: id, who: TEAM_LABEL[k], k: k, left: st.hunt.ms != null ? st.hunt.ms - (Date.now() - st.t) : 1e12 }); });
    if (missing && Date.now() - boot_t < 45000) return null; // kurz nach dem Start: erst alle Meldungen abwarten, sonst wird die falsche Jagd gewählt
    var cur = list.filter(function (x) { return team_hunt_cur && x.id == team_hunt_cur.id && x.k == team_hunt_cur.k; })[0] || list.filter(function (x) { return x.id == current_spot; })[0]; // begonnene Team-Jagd zu Ende bringen, auch wenn der andere inzwischen eine neue hat
    if (!cur) { list.sort(function (a, b) { return a.left - b.left; }); cur = list[0] || null; } // sonst die Jagd, die zuerst abläuft
    if (cur && (!team_hunt_cur || team_hunt_cur.id != cur.id || team_hunt_cur.k != cur.k)) { team_hunt_cur = { id: cur.id, k: cur.k }; try { localStorage.setItem("lp_team_hunt_cur", JSON.stringify(team_hunt_cur)); } catch (e) {} }
    if (!cur && team_hunt_cur) { team_hunt_cur = null; try { localStorage.removeItem("lp_team_hunt_cur"); } catch (e) {} }
    return cur;
}
var MEASURE_SKIP_RATIO = 0.3, measure_skip_logged = {};
var team_hunt_logged = "", no_cand_logged = 0, boot_t = Date.now(), team_hunt_cur = null; try { team_hunt_cur = JSON.parse(localStorage.getItem("lp_team_hunt_cur") || "null"); } catch (e) {}
function choose_spot() {
    var th = team_hunt_pick(); if (th) { if (team_hunt_logged != th.id) { team_hunt_logged = th.id; game_log("Team-Jagd: " + th.who + " jagt " + th.id + " – farme dort mit"); } return th.id; }
    var cands = candidate_list();
    if (!cands.length) { if (Date.now() - no_cand_logged > 300000) { no_cand_logged = Date.now(); game_log("Automatik: kein Monster mit Jagd-Häkchen verfügbar – Häkchen in der Liste setzen; solange goo/bee"); } return team_escort() ? "bee" : "goo"; }
    // 1. noch nicht (oder veraltet) gemessene Spots zuerst – außer die Schätzung liegt weit unter dem besten gemessenen Spot (keine 10 min verschwenden)
    var best_meas = 0; cands.forEach(function (m) { if (stats_valid(farm_stats[m])) best_meas = Math.max(best_meas, farm_stats[m].xp_h); });
    var skipped = [];
    for (var i = 0; i < cands.length; i++) if (!stats_valid(farm_stats[cands[i]])) {
        var est_i = mon_xph_est(G.monsters[cands[i]], cands[i]);
        if (best_meas > 0 && est_i < best_meas * MEASURE_SKIP_RATIO) { skipped.push(cands[i]); if (!measure_skip_logged[cands[i]]) { measure_skip_logged[cands[i]] = true; game_log("Messung übersprungen: " + cands[i] + " (Schätzung " + fmt(est_i) + " XP/h, unter " + Math.round(MEASURE_SKIP_RATIO * 100) + " % vom besten Spot " + fmt(best_meas) + ") – „Farmen“ in der Liste misst ihn trotzdem"); } continue; }
        game_log("Messe Spot: " + cands[i]); return cands[i];
    }
    cands = cands.filter(function (m) { return skipped.indexOf(m) < 0; }); if (!cands.length) return team_escort() ? "bee" : "goo";
    // 2. sonst bester Score
    var max_xp = 1, max_gold = 1;
    cands.forEach(function (m) { max_xp = Math.max(max_xp, farm_stats[m].xp_h); max_gold = Math.max(max_gold, farm_stats[m].gold_h); });
    var best = null, best_score = -1;
    cands.forEach(function (m) {
        var st = farm_stats[m];
        var score = XP_WEIGHT * st.xp_h / max_xp + GOLD_WEIGHT * st.gold_h / max_gold;
        if (score > best_score) { best_score = score; best = m; }
    });
    var b = farm_stats[best];
    game_log("Bester Spot: " + best + " (" + Math.round(b.xp_h) + " XP/h, " + Math.round(b.gold_h) + " Gold/h)");
    return best;
}
function pick_farm_monster() {
    if (!has_weapon()) return NO_WEAPON_MONSTER;

    if (hunt_on && !hunt_spot) { var thp = team_hunt_pick(); if (thp) { if (current_spot != thp.id) { current_spot = thp.id; need_repick = false; meas = null; save_state(); if (team_hunt_logged != thp.id) { team_hunt_logged = thp.id; game_log("Team-Jagd: " + thp.who + " jagt " + thp.id + " – farme dort mit"); } } return thp.id; } else if (team_hunt_logged && current_spot == team_hunt_logged) { team_hunt_logged = ""; need_repick = true; current_spot = null; } } // Jagden vor festem Spot; fester/automatischer Spot ist der Lückenfüller
    if (!auto_on && !(manual_spot && !spot_blocked(manual_spot))) { if (current_spot) { current_spot = null; meas = null; save_state(); } return null; } // Auto aus: nur Jagden/fester Spot, sonst warten
    if (manual_spot && !spot_blocked(manual_spot)) { if (current_spot != manual_spot) { current_spot = manual_spot; need_repick = false; meas = null; save_state(); } if (!team_safe(manual_spot) && Date.now() - team_safe_warned > 600000) { team_safe_warned = Date.now(); game_log("Achtung: Spot " + manual_spot + " ist für " + escort_name() + " zu gefährlich – fester Spot bleibt, aber er wird dort sterben"); } return current_spot; }
    if (current_spot && !team_safe(current_spot)) { if (Date.now() - team_safe_warned > 600000) { team_safe_warned = Date.now(); game_log("Spot " + current_spot + " für " + escort_name() + " zu gefährlich – wähle einen leichteren"); } need_repick = true; }
    var th2 = team_hunt_pick(); if (th2 && current_spot != th2.id && !manual_spot) need_repick = true; else if (!th2 && team_hunt_logged && current_spot == team_hunt_logged) { team_hunt_logged = ""; need_repick = true; }
    if (!current_spot || need_repick) { current_spot = choose_spot(); need_repick = false; save_state(); }
    return current_spot;
}
// Buttons: fester Spot / Automatik / neu messen
function set_manual_spot(mon) {
    manual_spot = mon; meas = null; Object.keys(blocked_spots).forEach(function (k) { if (blocked_spots[k] === true) delete blocked_spots[k]; }); if (blocked_spots[mon]) { delete blocked_spots[mon]; game_log("Sperre für " + mon + " aufgehoben (manuell gewählt)"); } leveled_since = 0; need_repick = true; current_spot = mon;
    game_log("Fester Farmspot: " + mon); save_state();
    if (paused) { paused = false; game_log("Pause aufgehoben"); }
    stop("smart"); busy = false;
    change_target(null);
    if (!upgrading && !kissing && !fleeing) go_to_farm_spot(); // sofort losgehen, nicht erst Angreifer abarbeiten
}
function set_auto_spot() {
    manual_spot = null; user_manual = null; meas = null; need_repick = true; current_spot = null;
    game_log("Automatische Spotwahl aktiv"); save_state();
    if (paused) { paused = false; game_log("Pause aufgehoben"); }
    stop("smart"); busy = false;
    change_target(null);
    if (!upgrading && !kissing && !fleeing) go_to_farm_spot();
}
function reset_measurements() {
    Object.keys(farm_stats).forEach(function (m) { farm_stats[m].t = 0; }); // nur als veraltet markieren
    save_stats(); blocked_spots = {}; meas = null; manual_spot = null; current_spot = null; need_repick = true;
    game_log("Alle Spots als veraltet markiert – werden nacheinander neu gemessen"); save_state();
    stop("smart"); busy = false;
}

// Messung
function start_measure(mon) {
    meas = { mon: mon, manual: !!manual_spot, start: Date.now(), xp: 0, gold: 0, last_xp: character.xp, last_level: character.level, last_gold: character.gold, paused_ms: 0, pause_start: 0 };
}
function measure_tick() {
    if (!meas || !has_weapon()) return;
    // XP-Zuwachs (inkl. Level-Up)
    if (character.level > meas.last_level) meas.xp += (G.levels[meas.last_level] - meas.last_xp) + character.xp;
    else meas.xp += Math.max(0, character.xp - meas.last_xp);
    meas.last_xp = character.xp; meas.last_level = character.level;
    // Gold: nur Zuwächse zählen (Käufe ignorieren)
    var dg = character.gold - meas.last_gold;
    if (dg > 0) meas.gold += dg;
    meas.last_gold = character.gold;
    // Zeit, in der er unterwegs/beschäftigt war, nicht mitzählen
    if (busy || upgrading) { if (!meas.pause_start) meas.pause_start = Date.now(); }
    else if (meas.pause_start) { meas.paused_ms += Date.now() - meas.pause_start; meas.pause_start = 0; }

    var active = Date.now() - meas.start - meas.paused_ms - (meas.pause_start ? Date.now() - meas.pause_start : 0);
    if (Date.now() - last_state_save > 10000) { last_state_save = Date.now(); save_state(); }
    if (active >= EVAL_MS) {
        if (!meas.manual) finish_measure(false);
        else { // fester Spot: Messwert speichern und Zähler neu starten
            var h = active / 3600000;
            record_stat(meas.mon, meas.xp / h, meas.gold / h); save_stats();
            meas.start = Date.now(); meas.xp = 0; meas.gold = 0; meas.paused_ms = 0; meas.pause_start = 0; save_state();
        }
    }
}
// Messwert in die Statistik übernehmen: gleitender Mittelwert (max. 10 Messungen), Reset bei geändertem ANG
function record_stat(mon, xp_h, gold_h) {
    var st = farm_stats[mon] || { deaths: 0 };
    var same = st.attack && Math.abs(character.attack - st.attack) / st.attack <= ATTACK_DRIFT && st.n;
    if (same) { var n = Math.min(st.n, 9); st.xp_h = (st.xp_h * n + xp_h) / (n + 1); st.gold_h = (st.gold_h * n + gold_h) / (n + 1); st.n = n + 1; }
    else { st.xp_h = xp_h; st.gold_h = gold_h; st.n = 1; }
    st.t = Date.now(); st.level = character.level; st.attack = character.attack;
    farm_stats[mon] = st; return st;
}
function finish_measure(died) {
    if (!meas) return;
    var active = Math.max(60000, Date.now() - meas.start - meas.paused_ms);
    var h = active / 3600000;
    var st = record_stat(meas.mon, meas.xp / h, meas.gold / h);
    if (died) { st.deaths = (st.deaths || 0) + 1; if (!manual_spot) { st.unsafe_until = character.level + 3; st.xp_h = 0; } }
    save_stats();
    game_log("Spot " + meas.mon + ": " + Math.round(st.xp_h) + " XP/h, " + Math.round(st.gold_h) + " Gold/h" + (died ? (st.unsafe_until ? " – GESTORBEN, gesperrt bis Level " + st.unsafe_until : " – GESTORBEN (fester Spot, nicht gesperrt)") : ""));
    meas = null; need_repick = true; save_state();
}
function log_stats() {
    var keys = Object.keys(farm_stats);
    if (!keys.length) { game_log("Noch keine Messwerte"); return; }
    keys.sort(function (a, b) { return (farm_stats[b].xp_h || 0) - (farm_stats[a].xp_h || 0); });
    keys.forEach(function (m) {
        var st = farm_stats[m];
        game_log(m + ": " + Math.round(st.xp_h) + " XP/h, " + Math.round(st.gold_h) + " Gold/h, ANG " + (st.attack || "?") + (st.deaths ? ", Tode " + st.deaths : "") + (stats_valid(st) ? "" : " (veraltet)"));
    });
    game_log("Aktuell: " + (current_spot || "-") + (meas ? " (Messung läuft)" : ""));
}

// Spawngebiet eines Monsters auf der aktuellen Karte (aus den Kartendaten)
function spawn_areas(mon, map) {
    var out = [], md = G.maps[map || character.map];
    if (!md || !md.monsters) return out;
    md.monsters.forEach(function (e) {
        if (e.type != mon) return;
        if (e.boundary) out.push(e.boundary);
        if (e.boundaries) e.boundaries.forEach(function (b) { if (b[0] == (map || character.map)) out.push([b[1], b[2], b[3], b[4]]); });
    });
    return out;
}
var last_go = 0, roam_logged = false;
function go_to_farm_spot() {
    if (paused || Date.now() - last_go < 5000) return;
    last_go = Date.now();
    if (event_mode) { // Event: beim Boss bleiben (Huge Crabs spawnen um ihn herum)
        var est = event_status(), bx = event_boss();
        var tp = bx ? { map: character.map, x: bx.x, y: bx.y } : est && est.x != null ? { map: est.map, x: est.x, y: est.y } : null;
        if (!tp) return;
        if (character.map != tp.map || distance(character, tp) > 900) { event_join(); return; }
        if (distance(character, tp) > 300) { busy = true; set_message("Zum Event"); var ang = Math.random() * Math.PI * 2; smart_move({ map: tp.map, x: tp.x + Math.cos(ang) * 180, y: tp.y + Math.sin(ang) * 180 }).catch(function () {}).then(function () { busy = false; }); }
        return;
    }
    var mon = pick_farm_monster();
    if (!mon) { // Auto aus, keine Jagd: zu Daisy und dort warten
        set_message("nur Jagden – wartet");
        var dp = find_npc("monsterhunter");
        if (dp && (character.map != dp.map || distance(character, dp) > 150)) { busy = true; if (Date.now() - idle_logged > 300000) { idle_logged = Date.now(); game_log("Auto aus, keine machbare Jagd – warte bei Daisy auf die nächste"); } travel({ map: dp.map, x: dp.x + 40, y: dp.y + 20 }).catch(function () {}).then(function () { busy = false; }); }
        return;
    }
    var areas = spawn_areas(mon);
    // Schon im Spawngebiet, aber nichts in Sicht -> umherstreifen statt Weg neu suchen
    if (areas.length && !get_nearest_monster({ type: mon })) {
        var b = areas[Math.floor(Math.random() * areas.length)];
        var tx = b[0] + Math.random() * (b[2] - b[0]), ty = b[1] + Math.random() * (b[3] - b[1]);
        if (!roam_logged) { roam_logged = true; game_log("Keine " + mon + " in Sicht – streife im Spawngebiet umher"); }
        busy = true; set_message("Suche " + mon);
        smart_move({ x: tx, y: ty }).catch(function () {}).then(function () { busy = false; });
        if (!meas || meas.mon != mon) { start_measure(mon); save_state(); }
        return;
    }
    roam_logged = false;
    busy = true; set_message("Laufe zu " + mon); spot_travel = true;
    travel(mon)
        .then(function () {
            if (!get_nearest_monster({ type: mon }) && !manual_spot && !spawn_areas(mon).length) {
                blocked_spots[mon] = true; need_repick = true; meas = null;
                game_log("Spot " + mon + " erreicht, aber keine Monster – Automatik wählt neu");
            } else if (!meas || meas.mon != mon) { start_measure(mon); save_state(); }
        })
        .catch(function (e) {
            if (team_wait_stop) { team_wait_stop = false; return; } // absichtlich angehalten (Team hängt zurück)
            if (err_txt(e).indexOf("interrupted") >= 0 || err_txt(e).indexOf("abgebrochen") >= 0) return; // vom Nutzer/Bot unterbrochen: keine Sperre, einfach neu versuchen
            if (manual_spot == mon || hunt_spot == mon) { game_log("Weg zu " + mon + " unterbrochen – neuer Versuch"); return; } // fester Spot / Jagd: keine Sperre (Weg wurde meist durch Flucht/Angreifer abgebrochen)
            blocked_spots[mon] = true; need_repick = true; meas = null;
            game_log("Spot " + mon + " nicht erreichbar – Automatik wählt neu");
        })
        .then(function () { busy = false; spot_travel = false; });
}

// ---------- Heilen / Tränke (beste vorhandene Stufe) ----------
function best_pot(list) { for (var i = 0; i < list.length; i++) { var idx = locate_item(list[i]); if (idx >= 0) return { idx: idx, name: list[i], gives: pot_gives(list[i]) }; } return null; }
function pot_gives(name) { var g = G.items[name] && G.items[name].gives; if (!g) return name.indexOf("hpot") == 0 ? 200 : 300; for (var i = 0; i < g.length; i++) if (g[i][0] == "hp" || g[i][0] == "mp") return g[i][1]; return 200; }
function pots_total(list) { return list.reduce(function (n, p) { return n + quantity(p); }, 0); }
function heal_logic() {
    if (is_on_cooldown("use_hp")) return;
    var hp = character.hp / character.max_hp, mp = character.mp / character.max_mp;
    var missing_hp = character.max_hp - character.hp, missing_mp = character.max_mp - character.mp;
    var hpot = best_pot(POTS_HP), mpot = best_pot(POTS_MP);

    var swarm = attackers_on_me() >= FLEE_ATTACKERS;
    if (hp < (swarm ? Math.max(0.55, SET.hp_pot / 100) : SET.hp_pot / 100) && hpot && missing_hp >= hpot.gives * 0.8) {
        if (SET.log_pots) game_log("Heiltrank " + hpot.name + " (HP " + Math.round(hp * 100) + "%)"); equip(hpot.idx); day_count("pots");
    } else if (mp < SET.mp_pot / 100 && mpot && missing_mp >= mpot.gives * 0.8) {
        if (SET.log_pots) game_log("Manatrank " + mpot.name + " (MP " + Math.round(mp * 100) + "%)"); equip(mpot.idx); day_count("pots");
    } else if (character.hp < character.max_hp) use_skill("regen_hp");
    else if (character.mp < character.max_mp) use_skill("regen_mp");
}

// ---------- Elixier aktiv halten ----------
var last_elixir = 0;
function check_elixir() {
    if (Date.now() - last_elixir < 10000 || busy) return;
    last_elixir = Date.now();
    var active = character.slots.elixir;
    if (active && (!active.expires || new Date(active.expires).getTime() - Date.now() > 60000)) return;
    for (var i = 0; i < ELIXIRS.length; i++) { var idx = locate_item(ELIXIRS[i]); if (idx >= 0) { equip(idx); game_log("Elixier aktiviert: " + ELIXIRS[i]); return; } }
}

// ---------- Magier: Cburst (erst ab Freischaltungs-Level) ----------
function try_cburst() {
    if (!has_weapon() || !skill_available("cburst")) {
        if (!cburst_logged && G.skills.cburst) { cburst_logged = true; game_log("Cburst erst ab Level " + G.skills.cburst.level); }
        return false;
    }
    if (is_on_cooldown("cburst")) return false;
    if (character.mp / character.max_mp < CBURST_MIN_MP && attackers_on_me() < FLEE_ATTACKERS) return false;

    var range = G.skills.cburst.range || 300;
    var targets = [];
    for (var id in parent.entities) {
        var e = parent.entities[id];
        if (!is_valid_target(e)) continue;
        if (distance(character, e) > range) continue;
        targets.push([e.id, CBURST_MP_PER_TARGET]);
    }
    if (targets.length < CBURST_MIN_TARGETS) return false;
    if (character.mp < targets.length * CBURST_MP_PER_TARGET + 100) { if (attackers_on_me() < FLEE_ATTACKERS) return false; targets = targets.slice(0, Math.max(1, Math.floor((character.mp - 100) / CBURST_MP_PER_TARGET))); if (targets.length < 2) return false; }

    set_message("Cburst x" + targets.length);
    use_skill("cburst", targets);
    return true;
}

// ---------- Eigenes Fenster im Spiel (verschiebbar) ----------
var sess = { start: Date.now(), xp: 0, gold: 0, last_xp: character.xp, last_level: character.level, last_gold: character.gold };
// ---------- Tagesbilanz (bleibt über N/Neustart erhalten) ----------
var DAY_REPORT_MS = 30 * 60000;
function today_key() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
function new_day() { return { day: today_key(), run_ms: 0, last_tick: Date.now(), xp: 0, gold: 0, kills: 0, deaths: 0, kisses: 0, hunts: 0, pots: 0, last_report: Date.now() }; }
var day = null; try { day = JSON.parse(localStorage.getItem("lp_day_" + character.name) || "null"); } catch (e) {}
if (!day || day.day != today_key()) day = new_day();
function save_day() { try { localStorage.setItem("lp_day_" + character.name, JSON.stringify(day)); } catch (e) {} }
function day_text(d) {
    var h = Math.max(1 / 60, d.run_ms / 3600000);
    return "XP " + fmt(d.xp) + " (" + fmt(d.xp / h) + "/h), Gold " + fmt(d.gold) + " (" + fmt(d.gold / h) + "/h), Kills " + d.kills + ", Tode " + d.deaths + ", Küsse " + d.kisses + ", Jagden " + d.hunts + ", Tränke " + d.pots + ", Laufzeit " + fmt_time(d.run_ms);
}
function day_tick(dxp, dgold) {
    var now = Date.now();
    if (day.day != today_key()) { game_log("Tagesbilanz " + day.day + ": " + day_text(day)); day = new_day(); }
    if (!paused) day.run_ms += Math.min(5000, now - day.last_tick);
    day.last_tick = now;
    day.xp += dxp; day.gold += dgold;
    if (now - day.last_report >= DAY_REPORT_MS) { day.last_report = now; game_log("Bilanz heute: " + day_text(day)); }
    if (now % 10000 < 300) save_day();
}
function day_count(k, n) { day[k] = (day[k] || 0) + (n || 1); save_day(); }
// Kills über das Todes-Ereignis des Servers zählen (nur eigenes Ziel)
var last_target_id = null;
try {
    if (parent.__lp_death_fn) parent.socket.off("death", parent.__lp_death_fn);
    parent.__lp_death_fn = function (data) { if (data && data.id && data.id == last_target_id) { last_target_id = null; day_count("kills"); } };
    parent.socket.on("death", parent.__lp_death_fn);
} catch (e) {}
// ---------- Cavalry (Tracktrix): Lv-100-NPC-Trupp räumt 90 s lang bis zu 24 Monster im Umkreis (unter Lv 80); lange Abklingzeit ----------
var cav_on = true, cav_last = 0, cav_cd_ms = 0, cav_msg = "", cav_next = 0; try { cav_on = localStorage.getItem("lp_cav_on") != "0"; cav_last = parseInt(localStorage.getItem("lp_cav_last") || "0") || 0; cav_cd_ms = parseInt(localStorage.getItem("lp_cav_cd") || "0") || 0; cav_next = parseInt(localStorage.getItem("lp_cav_next") || "0") || 0; } catch (e) {}
function cav_set_next(t) { cav_next = t; try { localStorage.setItem("lp_cav_next", String(t)); } catch (e) {} }
function cav_cooldown() { try { var c = (G.items.tracker || {}).cavalry || {}; return cav_cd_ms || ((c.cooldown_base || 600000) + (c.cooldown_per_level || 60000) * character.level); } catch (e) { return 3600000; } }
function cav_ready() { return has_tracker() && Date.now() >= Math.max(cav_next, cav_last + cav_cooldown()); }
function has_tracker() { return locate_item("tracker") >= 0; }
function team_cav_ready() { // Begleiter mit Tracktrix, dessen Cavalry bereit ist und der bei mir steht
    var out = null; ["priest", "ranger"].forEach(function (k) { if (out || !team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 90000 || !st.cav || !st.cav.has || st.cav.next > Date.now()) return; var p = get_player(TEAM[k]); if (!p || p.map != character.map || distance(character, p) > 200) return; out = k; });
    return out;
}
function any_cav_ready() { return cav_ready() || !!team_cav_ready(); }
function call_cavalry(why) {
    if (!cav_ready()) { var tk = team_cav_ready(); if (tk) { team_send(TEAM[tk], { t: "cavalry", why: why }); var st = team_state[TEAM[tk]]; if (st && st.cav) st.cav.next = Date.now() + 3600000; game_log("Cavalry: " + TEAM_LABEL[tk] + " ruft den Trupp (" + why + ")"); return; } }
    if (!has_tracker()) { game_log("Cavalry: kein Tracktrix im Inventar"); return; }
    cav_last = Date.now(); try { localStorage.setItem("lp_cav_last", String(cav_last)); } catch (e) {} cav_set_next(cav_last + cav_cooldown());
    try { parent.socket.emit("interaction", { type: "cavalry" }); game_log("Cavalry gerufen (" + why + ")"); } catch (e) { game_log("Cavalry: " + err_txt(e)); }
}
try {
    if (parent.__lp_cav_fn) parent.socket.off("game_response", parent.__lp_cav_fn);
    parent.__lp_cav_fn = function (data) { try { if (!data || data.interaction != "cavalry") return; cav_msg = JSON.stringify(data).slice(0, 200); game_log("Cavalry-Antwort: " + cav_msg); if (data.next_call > Date.now()) cav_set_next(data.next_call); else if (data.cooldown_ms > 1000) cav_set_next(Date.now() + data.cooldown_ms); if (data.failed) { cav_last = 0; game_log("Cavalry: " + (data.reason == "cooldown" ? "Abklingzeit, bereit in " + fmt_time(Math.max(0, cav_next - Date.now())) : "fehlgeschlagen (" + (data.reason || "?") + ")")); } else game_log("Cavalry ist unterwegs – 90 s aus dem Weg bleiben, der Trupp räumt"); } catch (e) {} };
    parent.socket.on("game_response", parent.__lp_cav_fn);
} catch (e) {}
var cav_checked = 0;
function cavalry_tick() { // automatisch: am Spot stehen >= 3 gelevelte/zu starke Exemplare in 320 px und kein normales Ziel -> Trupp rufen
    if (!cav_on || SOLO || paused || event_mode || fleeing || Date.now() - cav_checked < 10000) return; cav_checked = Date.now();
    if (!any_cav_ready()) return;
    var farm = current_spot; if (!farm) return;
    var strong = 0, weak = 0;
    for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead || m.mtype != farm || distance(character, m) > 320) continue; if ((m.level || 1) >= 5 || too_strong(m)) strong++; else weak++; }
    if (strong >= 3 && weak == 0) call_cavalry(strong + "x gelevelte " + farm + " in Reichweite, keine normalen");
}
var last_gain = Date.now(), stuck_count = 0;
function session_tick() {
    var before = sess.xp;
    if (character.level > sess.last_level) sess.xp += (G.levels[sess.last_level] - sess.last_xp) + character.xp;
    else sess.xp += Math.max(0, character.xp - sess.last_xp);
    if (sess.xp > before) last_gain = Date.now();
    sess.last_xp = character.xp; sess.last_level = character.level;
    var dg = character.gold - sess.last_gold; if (dg > 0) sess.gold += dg; sess.last_gold = character.gold;
    day_tick(sess.xp - before, dg > 0 ? dg : 0);
}
function clamp_pos(el, x, y) {
    var w = parent.window.innerWidth || 1200, h = parent.window.innerHeight || 800;
    x = Math.max(0, Math.min(x, w - 80)); y = Math.max(0, Math.min(y, h - 40));
    el.style.left = x + "px"; el.style.top = y + "px";
}
function init_panel() {
    var doc = parent.document;
    var old = doc.getElementById("lp_panel"); if (old) old.remove();
    var oc = doc.getElementById("lp_char"); if (oc) oc.remove();
    var st = doc.getElementById("lp_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_style";
    st.textContent = ":root{--lp-alpha:1;--lp-fs:12px;--lp-acc:#2e7d32;--lp-acc2:#4caf50}"
      + "#lp_panel{position:fixed;left:10px;top:130px;z-index:2147483000;pointer-events:auto;width:470px;background:rgba(20,22,28,var(--lp-alpha));color:#e6e6e6;font:var(--lp-fs)/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(36,41,54,var(--lp-alpha));cursor:move;border-bottom:1px solid #3a3f4b;touch-action:none;position:relative}"
      + "#lp_head b{flex:1;font-size:13px;letter-spacing:.3px}#lp_head .lp_state{font-size:11px;padding:1px 7px;border-radius:10px;background:var(--lp-acc)}"
      + ".lp_sec{border-top:1px solid #2a2f3a;margin-top:4px;padding-top:2px}.lp_sec .lp_sech{cursor:pointer;color:#9aa3b2}.lp_sec .lp_sech:hover{color:#fff}.lp_sec .lp_sech .lp_secv{color:#c9ced8;margin-left:6px;font-size:11px}"
      + "#lp_set{display:none;position:absolute;right:6px;top:30px;width:270px;background:#1b202b;border:1px solid #3a4152;border-radius:6px;padding:8px 10px;z-index:6;font-size:11.5px;cursor:default;box-shadow:0 6px 20px rgba(0,0,0,.6);user-select:none}#lp_set.open{display:block}"
      + "#lp_set label{display:flex;align-items:center;gap:8px;margin:5px 0;color:#9aa3b2;white-space:nowrap}#lp_set input[type=range]{flex:1;min-width:60px}#lp_set input[type=number]{width:52px;background:#1c2029;color:#eee;border:1px solid #555;font-size:11px;text-align:right}#lp_set .lp_sw{width:15px;height:15px;border-radius:3px;border:1px solid #555;cursor:pointer;display:inline-block}#lp_set .lp_sw.sel{outline:2px solid #fff}#lp_set .lp_tab{display:flex;gap:4px;margin-bottom:6px}#lp_set .lp_tab button.on{background:var(--lp-acc)}#lp_set h4{margin:2px 0 4px;color:#e6e6e6;font-size:12px}"
      + "#lp_head .lp_state.pause{background:#c62828}#lp_head .lp_state.busy{background:#ef6c00}"
      + "#lp_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_body{padding:8px 10px;max-height:calc(100vh - 200px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}"
      + "#lp_list{position:fixed;left:500px;top:130px;z-index:2147483000;pointer-events:auto;width:430px;background:rgba(20,22,28,var(--lp-alpha));color:#e6e6e6;font:var(--lp-fs)/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_list_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(36,41,54,var(--lp-alpha));cursor:move;border-bottom:1px solid #3a3f4b}#lp_list_head b{flex:1;font-size:13px}#lp_list_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_list_body{padding:6px 10px;max-height:calc(100vh - 200px);overflow-y:auto;overflow-x:hidden}#lp_list_body button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#2f3440;color:#eee;border:1px solid #555;border-radius:3px}#lp_list_body button.on{background:var(--lp-acc);border-color:var(--lp-acc2)}#lp_list_body input[type=checkbox]{accent-color:var(--lp-acc2)}"
      + ".lp_hunts{display:grid;grid-template-columns:auto auto 1fr;gap:1px 10px;font-size:11.5px;margin:2px 0 4px}.lp_hunts .lp_hn{color:#9aa3b2}.lp_hunts .lp_hm{color:#e6e6e6;white-space:nowrap}"
      + ".lp_grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:6px}.lp_grid div{white-space:normal}.lp_k{color:#9aa3b2}"
      + ".lp_bar{display:inline-block;width:80px;height:8px;background:#2a2e38;border-radius:4px;vertical-align:middle;margin-left:6px;overflow:hidden}.lp_bar i{display:block;height:100%}"
      + ".lp_spot{background:rgba(28,32,41,var(--lp-alpha));border:1px solid #2f3440;border-radius:4px;padding:6px 8px;margin:4px 0 6px}.lp_spot .lp_big{font-size:15px;font-weight:600}"
      + ".lp_row{display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap}.lp_row .lp_mode{color:#8ab4f8;flex:1}#lp_body button{white-space:nowrap}"
      + "#lp_body button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#2f3440;color:#eee;border:1px solid #555;border-radius:3px}#lp_body button:hover{background:#3d4453}#lp_body button.on{background:var(--lp-acc);border-color:var(--lp-acc2)}#lp_body input[type=checkbox]{accent-color:var(--lp-acc2)}"
      + "table.lp_t{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px}table.lp_t th{color:#9aa3b2;font-weight:normal;text-align:right;padding:2px 4px;border-bottom:1px solid #3a3f4b;cursor:pointer}table.lp_t th:hover{color:#fff}table.lp_t th.sorted{color:#8ab4f8}table.lp_t th:first-child,table.lp_t td:first-child{text-align:left}"
      + "table.lp_t td{padding:2px 4px;text-align:right;white-space:nowrap}table.lp_t td[title]{cursor:help;text-decoration:underline dotted #666}table.lp_t tr:nth-child(even) td{background:#181b22}table.lp_t tr.cur td{background:#20302a;color:#c8f0d0}table.lp_t td.old{color:#8a8f99}"
      + "table.lp_wish td{white-space:normal;word-break:break-word;overflow-wrap:anywhere;overflow:hidden;vertical-align:top;line-height:1.3}table.lp_wish th{white-space:normal;vertical-align:bottom}table.lp_wish select{max-width:100%;box-sizing:border-box}";
    doc.head.appendChild(st);

    var div = doc.createElement("div"); div.id = "lp_panel";
    div.innerHTML = "<div id='lp_head'><b>LogicPlan " + BOT_VERSION + "</b><span class='lp_state' id='lp_state'>läuft</span><button data-act='chartoggle' title='Charakter & Inventar'>Char</button><button data-act='wikitoggle' title='Items, Monster, NPCs nachschlagen'>Wiki</button><button data-act='mkttoggle' title='Alle Händlerangebote aller Server'>Markt</button><button id='lp_toggle' title='Monsterliste ein-/ausblenden'>▾</button><button id='lp_mini' title='Fenster verkleinern/vergrößern'>▭</button><button id='lp_gear' title='Einstellungen'>⚙</button><div id='lp_set'></div></div><div id='lp_body'></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_panel_pos") || "null"); if (p) clamp_pos(div, p.x, p.y); } catch (e) {}

    // Maus-Ereignisse in der Capture-Phase am Fenster abgreifen (vor dem Spiel)
    var win = parent.window, drag = null, head = div.querySelector("#lp_head");
    var collapsed = false; try { collapsed = localStorage.getItem("lp_panel_collapsed") == "1"; } catch (e) {}
    div.__collapsed = collapsed;
    try { div.__gear = localStorage.getItem("lp_panel_gear") == "1"; } catch (e) { div.__gear = false; }
    try { div.__wish = localStorage.getItem("lp_panel_wish") != "0"; } catch (e) { div.__wish = true; }
    try { div.__mini = localStorage.getItem("lp_panel_mini") == "1"; } catch (e) { div.__mini = false; }
    try { div.__arb = localStorage.getItem("lp_panel_arb") == "1"; } catch (e) { div.__arb = false; }
    div.__sec = { haendler: false, zielbau: false, wartung: false }; try { var so2 = JSON.parse(localStorage.getItem("lp_sec") || "null"); if (so2) for (var sk3 in so2) div.__sec[sk3] = !!so2[sk3]; } catch (e) {}
    try { apply_settings(); } catch (e) {}
    var inside = function (e) { var c = parent.document.getElementById("lp_char"), w = parent.document.getElementById("lp_wiki"), l = parent.document.getElementById("lp_list"), mk = parent.document.getElementById("lp_mkt"), tc = e.target && e.target.closest ? e.target.closest(".lp_tchar") : null; return e.target && (div.contains(e.target) || (c && c.contains(e.target)) || (w && w.contains(e.target)) || (l && l.contains(e.target)) || (mk && mk.contains(e.target)) || !!tc); };
    var onDown = function (e) {
        if (!inside(e)) return;
        var sp0 = div.querySelector("#lp_set"); if (sp0 && sp0.contains(e.target)) { if (e.target.tagName != "INPUT") e.stopPropagation(); else e.stopPropagation(); return; } // Einstellungen: kein Ziehen
        if (e.target.tagName == "BUTTON") { e.stopPropagation(); return; }
        var c = parent.document.getElementById("lp_char"), ch = c && c.querySelector("#lp_char_head");
        if (head.contains(e.target)) { drag = { el: div, key: "lp_panel_pos", dx: e.clientX - div.offsetLeft, dy: e.clientY - div.offsetTop }; e.preventDefault(); }
        else if (ch && ch.contains(e.target)) { drag = { el: c, key: "lp_char_pos", dx: e.clientX - c.offsetLeft, dy: e.clientY - c.offsetTop }; e.preventDefault(); }
        else { var w = parent.document.getElementById("lp_wiki"), wh = w && w.querySelector("#lp_wiki_head"); if (wh && wh.contains(e.target)) { drag = { el: w, key: "lp_wiki_pos", dx: e.clientX - w.offsetLeft, dy: e.clientY - w.offsetTop }; e.preventDefault(); }
               else { var l = parent.document.getElementById("lp_list"), lh = l && l.querySelector("#lp_list_head"); if (lh && lh.contains(e.target)) { drag = { el: l, key: "lp_list_pos", dx: e.clientX - l.offsetLeft, dy: e.clientY - l.offsetTop }; e.preventDefault(); }
                      else { var mk = parent.document.getElementById("lp_mkt"), mkh = mk && mk.querySelector("#lp_mkt_head"); if (mkh && mkh.contains(e.target)) { drag = { el: mk, key: "lp_mkt_pos", dx: e.clientX - mk.offsetLeft, dy: e.clientY - mk.offsetTop }; e.preventDefault(); }
                             else { var tch = e.target.closest ? e.target.closest(".lp_tchar_head") : null, tcw = tch && tch.parentNode; if (tcw) { drag = { el: tcw, key: "lp_tchar_pos_" + tcw.getAttribute("data-tchar"), dx: e.clientX - tcw.offsetLeft, dy: e.clientY - tcw.offsetTop }; e.preventDefault(); } } } } }
        if (e.target.tagName == "INPUT" || e.target.tagName == "SELECT") { e.stopPropagation(); return; }
        e.stopPropagation();
    };
    var onMove = function (e) { if (!drag) return; clamp_pos(drag.el, e.clientX - drag.dx, e.clientY - drag.dy); e.preventDefault(); e.stopPropagation(); };
    var onUp = function (e) { if (!drag) return; try { localStorage.setItem(drag.key, JSON.stringify({ x: drag.el.offsetLeft, y: drag.el.offsetTop })); } catch (x) {} drag = null; e.stopPropagation(); };
    var onClick = function (e) {
        if (!inside(e)) return;
        e.stopPropagation();
        var b = e.target;
        var wc = b.closest ? b.closest("[data-wcat],[data-wsort],[data-wopt]") : null;
        if (wc) { var cv = wc.getAttribute("data-wcat"), sv = wc.getAttribute("data-wsort"), ov = wc.getAttribute("data-wopt"); if (cv) { wiki.cat = wiki.cat == cv ? null : cv; wiki.page = null; wiki.hist = []; } else if (sv) wiki.sort = sv; else if (ov == "mage") wiki.mage_only = !wiki.mage_only; render_wiki(); return; }
        var wl = b.closest ? b.closest("[data-wiki],[data-wtab]") : null;
        if (wl) { var wt = wl.getAttribute("data-wtab"), wv = wl.getAttribute("data-wiki"); if (wt) { wiki.tab = wt; wiki.page = null; wiki.hist = []; wiki.cat = null; render_wiki(); } else if (wv == "back") wiki_back(); else { var ci = wv.indexOf(":"); wiki_go(wv.slice(0, ci), wv.slice(ci + 1)); } return; }
        var tile = b.closest ? b.closest("[data-inv],[data-slot-eq]") : null;
        if (tile) { var ii = tile.getAttribute("data-inv"), se = tile.getAttribute("data-slot-eq"); if (ii != null) inv_click(parseInt(ii)); else if (se) { unequip(se); game_log(se + " abgelegt"); } return; }
        if (b.tagName == "TH" && b.getAttribute("data-sort")) { set_sort(b.getAttribute("data-sort")); return; }
        var mkel = b.closest ? b.closest("[data-mf],[data-msort],[data-mcsort],[data-act='mbuy'],[data-act='msell'],[data-act='mgoto'],[data-act='mtrip'],[data-act='marb'],[data-act='mview'],[data-act='mmore'],[data-mg]") : null;
        if (mkel) { var mkr = false; try { mkr = market_click(mkel); } catch (mke) { game_log("Markt-Fehler: " + err_txt(mke) + (mke && mke.stack ? " @ " + String(mke.stack).split("\n")[1] : "")); mkr = true; } if (mkr) return; }
        if (b.tagName != "BUTTON") return;
        if (b.id == "lp_list_close") { div.__collapsed = true; try { localStorage.setItem("lp_panel_collapsed", "1"); } catch (x) {} last_panel = 0; return; }
        if (b.id == "lp_toggle") { div.__collapsed = !div.__collapsed; try { localStorage.setItem("lp_panel_collapsed", div.__collapsed ? "1" : "0"); } catch (x) {} last_panel = 0; return; }
        if (b.id == "lp_gear") { var sp = div.querySelector("#lp_set"); sp.classList.toggle("open"); if (sp.classList.contains("open")) render_settings(sp); return; }
        if (b.getAttribute("data-set")) { settings_click(b); return; }
        if (b.getAttribute("data-sec")) { var sk2 = b.getAttribute("data-sec"); div.__sec[sk2] = !div.__sec[sk2]; try { localStorage.setItem("lp_sec", JSON.stringify(div.__sec)); } catch (x) {} last_panel = 0; return; }
        if (b.id == "lp_mini") { div.__mini = !div.__mini; try { localStorage.setItem("lp_panel_mini", div.__mini ? "1" : "0"); } catch (x) {} last_panel = 0; return; }
        var act = b.getAttribute("data-act"), mon = b.getAttribute("data-mon");
        if (act == "farm") { user_manual = mon; preempt("Farmen " + mon, function () { set_manual_spot(mon); }); }
        else if (act == "auto") { if (manual_spot || !auto_on) { auto_on = true; try { localStorage.setItem("lp_auto_on", "1"); } catch (x) {} preempt("Automatik", set_auto_spot); } else { auto_on = false; try { localStorage.setItem("lp_auto_on", "0"); } catch (x) {} need_repick = true; current_spot = null; stop("smart"); busy = false; change_target(null); game_log("Automatik aus – nur Jagden; ohne machbare Jagd wartet das Team bei Daisy"); } }
        else if (act == "reset") reset_measurements();
        else if (act == "hide") hide_mon(mon, true); else if (act == "show") hide_mon(mon, false);
        else if (act == "worth") { only_worth = !only_worth; save_hidden(); }
        else if (act == "trip") { var tl = server_tip(), tf = tl[parseInt(b.getAttribute("data-idx"))]; if (tf) preempt("Serverwechsel", function () { start_trip(tf); }); }
        else if (act == "autotrip") { auto_trip = !auto_trip; try { localStorage.setItem("lp_auto_trip", auto_trip ? "1" : "0"); } catch (x) {} game_log("Serverkäufe automatisch: " + (auto_trip ? "an" : "aus")); last_panel = 0; }
        else if (act == "buyalt") { var bs = b.getAttribute("data-slot"), bi = b.getAttribute("data-item"); preempt("Zwischenlösung " + bi, function () { return buy_alternative(bs, bi); }); }
        else if (act == "farmwish") { var fm = b.getAttribute("data-mon"); user_manual = fm; preempt("Farmen " + fm, function () { set_manual_spot(fm); }); }
        else if (act == "wishreset") reset_wish_to_worn();
        else if (act == "wishist") { var slots_ = b.getAttribute("data-slot") == "*" ? Object.keys(SLOT_TYPES) : [b.getAttribute("data-slot")]; slots_.forEach(function (is_) { var iw = character.slots[is_]; var keep = wish_cfg[is_] && wish_cfg[is_].max; wish_cfg[is_] = iw && G.items[iw.name] ? { item: iw.name, level: iw.level || 0 } : { item: "" }; if (keep) wish_cfg[is_].max = keep; }); save_wish_cfg(); game_log("Zielbau: Ist-Stand übernommen (" + slots_.length + " Slots, Limits bleiben)"); }
        else if (act == "buyoffer") { var bo = offers_for_slot(b.getAttribute("data-slot"))[parseInt(b.getAttribute("data-idx"))]; if (bo) buy_confirm = { key: offer_key(bo), offer: bo, slot: b.getAttribute("data-slot"), t: Date.now() }; }
        else if (act == "buyno") buy_confirm = null;
        else if (act == "give") give_to_team(b.getAttribute("data-k"));
        else if (act == "givetokens") { ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var nm = TEAM[k], st = team_state[nm], p = get_player(nm); if (st && st.cav && st.cav.has) { game_log("[" + TEAM_LABEL[k] + "] hat schon einen Tracktrix"); return; } if (!p || p.rip || p.map != character.map || distance(character, p) > 350) { game_log("[" + TEAM_LABEL[k] + "] nicht neben mir – keine Tokens gegeben"); return; } var ti = locate_item("monstertoken"); if (ti < 0 || (character.items[ti].q || 0) < 4) { game_log("Tokens: weniger als 4 übrig"); return; } try { send_item(nm, ti, 4); game_log("[" + TEAM_LABEL[k] + "] 4 Monster-Tokens gegeben – kauft beim nächsten Daisy-Besuch einen Tracktrix"); } catch (e) { game_log("Tokens geben: " + err_txt(e)); } }); last_panel = 0; }
        else if (act == "merchtest") start_merch_test();
        else if (act == "teamlogs") { for (var tk2 in TEAM) { try { var arr = JSON.parse(localStorage.getItem("lp_tlog_" + TEAM[tk2]) || "[]"); game_log("=== " + TEAM_LABEL[tk2] + " – gespeichertes Log (" + arr.length + " Zeilen) ==="); arr.forEach(function (e) { game_log("[" + TEAM_LABEL[tk2] + " " + new Date(e.t).toLocaleTimeString() + "] " + e.m); }); } catch (x) { game_log(TEAM_LABEL[tk2] + ": Log nicht lesbar"); } } var so = null; try { so = localStorage.getItem("lp_stand_orders_" + TEAM.merch); } catch (x) {} game_log("Stand-Aufträge: " + (so || "keine") + " · Händler-Stand (gespeichert): " + (function () { try { return localStorage.getItem("lp_listed_" + TEAM.merch) || "leer"; } catch (x) { return "?"; } })()); }
        else if (act == "goldback") { ["merch", "priest", "ranger"].forEach(function (k) { if (team_on[k] && team_running(TEAM[k])) team_send(TEAM[k], { t: "goldback" }); }); game_log("Gold holen: Händler bringt alles über " + fmt(MG.target) + ", Priest/Ranger alles über " + fmt(MG.esc_max)); }
        else if (act == "eventon") { event_on = !event_on; try { localStorage.setItem("lp_event_on", event_on ? "1" : "0"); } catch (x) {} game_log("Event-Teilnahme: " + (event_on ? "an" : "aus")); last_event_check = 0; }
        else if (act == "arbtrip") start_arb_trip(b.getAttribute("data-sv"));
        else if (act == "marketscan") market_scan_now();
        else if (act == "arbauto") { arb_auto = !arb_auto; try { localStorage.setItem("lp_arb_auto", arb_auto ? "1" : "0"); } catch (x) {} game_log("Handelsreisen automatisch: " + (arb_auto ? "an (ab " + fmt(ARB_TRIP_MIN) + " Gewinn)" : "aus")); last_panel = 0; }
        else if (act == "team") { var tk = b.getAttribute("data-k"); team_on[tk] = !team_on[tk]; save_team(); last_team_tick = 0; game_log("Team: " + TEAM[tk] + " " + (team_on[tk] ? "an" : "aus")); }
        else if (act == "arbtoggle") { div.__arb = !div.__arb; try { localStorage.setItem("lp_panel_arb", div.__arb ? "1" : "0"); } catch (x) {} }
        else if (act == "buyok") { if (buy_confirm) { var bc = buy_confirm; buy_confirm = null; preempt("Kauf " + bc.offer.name, function () { return buy_offer_now(bc.slot, bc.offer); }); } }
        else if (act == "twnow") { var nk = b.getAttribute("data-k"); preempt("Zielbau " + TEAM_LABEL[nk], function () { return team_build_now(nk); }); }
        else if (act == "twstat") { team_wish_stat = !team_wish_stat; try { localStorage.setItem("lp_teamwish_stat", team_wish_stat ? "1" : "0"); } catch (x) {} game_log("Team-Zielbau: Attribut-Scroll " + (team_wish_stat ? "an" : "aus")); }
        else if (act == "twtoggle") { var tk = b.getAttribute("data-k"); div["__tw_" + tk] = !div["__tw_" + tk]; }
        else if (act == "twmode") { team_wish_mode = team_wish_mode >= 2 ? 1 : 2; try { localStorage.setItem("lp_teamwish_mode", String(team_wish_mode)); } catch (x) {} game_log("Team-Zielbau: " + (team_wish_mode >= 2 ? "NPC + Marktangebote" : "nur NPC-Teile")); }
        else if (act == "twclear") { team_wish[b.getAttribute("data-k")] = {}; save_team_wish(); }
        else if (act == "twist") { var ik = b.getAttribute("data-k"), ist = team_state[TEAM[ik]]; if (!ist || !ist.slots) game_log("Team-Zielbau: keine Statusmeldung von " + TEAM_LABEL[ik]); else { team_wish[ik] = {}; TEAM_WISH_SLOTS.forEach(function (sl) { var w = ist.slots[sl]; if (w && G.items[w.name]) team_wish[ik][sl] = { item: w.name, level: w.level || 0 }; }); save_team_wish(); game_log("Team-Zielbau " + TEAM_LABEL[ik] + ": Ist-Stand übernommen"); } }
        else if (act == "wishtoggle") { div.__wish = !div.__wish; try { localStorage.setItem("lp_panel_wish", div.__wish ? "1" : "0"); } catch (x) {} }
        else if (act == "pauseafter") { pause_after = !pause_after; try { localStorage.setItem("lp_pause_after", pause_after ? "1" : "0"); } catch (x) {} game_log("Nach manueller Aktion: " + (pause_after ? "pausieren" : "weiterfarmen")); last_panel = 0; }
        else if (act == "unblock") { var nb = 0; Object.keys(blocked_spots).forEach(function (k) { if (blocked_spots[k] !== true) { delete blocked_spots[k]; nb++; } }); nb += Object.keys(hunt_bad).length; hunt_bad = {}; try { localStorage.setItem("lp_hunt_bad", "{}"); } catch (x) {} flee_log = {}; hunt_cooldown_until = 0; need_repick = true; game_log("Sperren aufgehoben (" + nb + ")"); }
        else if (act == "cavalry") call_cavalry("manuell");
        else if (act == "cavauto") { cav_on = !cav_on; try { localStorage.setItem("lp_cav_on", cav_on ? "1" : "0"); } catch (x) {} game_log("Cavalry-Automatik " + (cav_on ? "an" : "aus")); }
        else if (act == "waitteam") { wait_team_on = !wait_team_on; try { localStorage.setItem("lp_wait_team", wait_team_on ? "1" : "0"); } catch (x) {} game_log("Auf Team warten " + (wait_team_on ? "an (ab " + Math.round(wait_team_danger * 100) + " % Gefahr)" : "aus")); }

        else if (act == "hunt") { hunt_on = !hunt_on; try { localStorage.setItem("lp_hunt", hunt_on ? "1" : "0"); } catch (x) {} game_log("Monster Hunt " + (hunt_on ? "an" : "aus")); }
        else if (act == "huntabandon") preempt("Jagd aufgeben", hunt_abandon);
        else if (act == "focus") { focus_mode = !focus_mode; try { localStorage.setItem("lp_focus", focus_mode ? "1" : "0"); } catch (x) {} tidy_next = 0; if (focus_mode && pending_upgrade == "auto") pending_upgrade = null; game_log("Fokus-Modus " + (focus_mode ? "an – nur farmen/hunten, Nebenroutinen aus" : "aus – alle Routinen wieder aktiv")); }
        else if (act == "bycatch") { bycatch = !bycatch; try { localStorage.setItem("lp_bycatch", bycatch ? "1" : "0"); } catch (x) {} game_log("Beifang " + (bycatch ? "an" : "aus")); }
        else if (act == "sortinv") preempt("Inventar sortieren", sort_inventory, true);
        else if (act == "compound") preempt("Compound", compound_only);
        else if (act == "tidy") preempt("Aufräumen", tidy_now);
        else if (act == "bank") preempt("Bank aufräumen", bank_cleanup_now);
        else if (act == "banksort") preempt("Bank sortieren", bank_sort_now);
        else if (act == "copylog") copy_log();
        else if (act == "goal") start_goal(b.getAttribute("data-slot"));
        else if (act == "slotnow") { var fs = b.getAttribute("data-slot"); preempt("Slot " + fs, function () { return focus_slot(fs); }); }
        else if (act == "goalstop") stop_goal("manuell");
        else if (act == "goalskip") { goal_skip[b.getAttribute("data-item")] = Date.now(); save_goal_skip(); goal_cache_t = 0; }
        else if (act == "chartoggle") toggle_char_panel();
        else if (act == "tchar") toggle_tchar_panel(b.getAttribute("data-nm"));
        else if (act == "wikitoggle") toggle_wiki_panel();
        else if (act == "mkttoggle") toggle_market_panel();
        else if (act == "donate") { if (!team_on.merch || !team_running(TEAM.merch)) game_log("Spenden: Händler läuft nicht"); else { last_donate = Date.now(); team_send(TEAM.merch, { t: "donate", gold: donate_amt, target: 200 }); game_log("Spenden: Händler bringt " + fmt(donate_amt) + " Gold zu Ron"); } }
        else if (act == "donateauto") { donate_auto = !donate_auto; try { localStorage.setItem("lp_donate_auto", donate_auto ? "1" : "0"); } catch (x) {} game_log("Spenden-Automatik " + (donate_auto ? "an – Händler spendet alles über der Nachfüllgrenze bis Lv " + DONATE_LVL : "aus")); last_panel = 0; }
        else if (act == "bankstatus") { try { bank_status_log(); } catch (e) { game_log("Bank-Status: " + err_txt(e)); } }
        else if (act == "mbcancel") { if (merch_buy && merch_buy.stage == "away") game_log("Einkauf: Reise läuft, Abbruch erst nach Rückkehr"); else mb_fail("manuell abgebrochen"); }
        else if (act == "geartoggle") { div.__gear = !div.__gear; try { localStorage.setItem("lp_panel_gear", div.__gear ? "1" : "0"); } catch (x) {} }
        else if (act == "clearlog") { log_buf = []; try { localStorage.setItem("lp_log", "[]"); } catch (x) {} _game_log("Log-Puffer geleert"); }
        last_panel = 0;
    };
    if (parent.__lp_panel_h) { var H = parent.__lp_panel_h; ["pointerdown", "mousedown"].forEach(function (t) { win.removeEventListener(t, H.down, true); }); ["pointermove", "mousemove"].forEach(function (t) { win.removeEventListener(t, H.move, true); }); ["pointerup", "mouseup"].forEach(function (t) { win.removeEventListener(t, H.up, true); }); win.removeEventListener("click", H.click, true); if (H.change) win.removeEventListener("change", H.change, true); if (H.input) win.removeEventListener("input", H.input, true); if (H.key) ["keydown", "keyup", "keypress"].forEach(function (t) { win.removeEventListener(t, H.key, true); }); }
    ["pointerdown", "mousedown"].forEach(function (t) { win.addEventListener(t, onDown, true); });
    ["pointermove", "mousemove"].forEach(function (t) { win.addEventListener(t, onMove, true); });
    ["pointerup", "mouseup"].forEach(function (t) { win.addEventListener(t, onUp, true); });
    win.addEventListener("click", onClick, true);
    win.addEventListener("input", function (e) { try { var t = e.target; if (t && t.getAttribute && t.getAttribute("data-setk") && t.type == "range" && inside(e)) settings_input(t); } catch (x) {} }, true);
    var onChange = function (e) {
        if (!inside(e)) return;
        var t = e.target; if (!t || (t.tagName != "SELECT" && t.tagName != "INPUT")) return;
        if (t.getAttribute("data-setk")) { settings_input(t); return; }
        if (t.getAttribute("data-mgk") == "donate") { var dv = parse_mio(t.value); if (dv >= 1000) { donate_amt = dv; try { localStorage.setItem("lp_donate_amt", String(dv)); } catch (x) {} game_log("Spendenbetrag: " + fmt(dv)); } try { t.blur(); } catch (x) {} return; }
        if (t.getAttribute("data-mgk")) { var mgk2 = t.getAttribute("data-mgk"); if (mgk2 == "esc") { var ev = parse_mio(t.value); if (ev >= 10000) MG.esc_max = ev; } else { var mv3 = parse_mio(t.value); if (mv3 > 0) MG[mgk2] = mv3; } if (MG.min > MG.target) MG.min = MG.target; mg_save(); game_log("Händler-Kasse: Ziel " + fmt(MG.target) + ", nachfüllen unter " + fmt(MG.min) + ", Priest/Ranger max. " + fmt(MG.esc_max)); try { t.blur(); } catch (x) {} return; }
        if (t.getAttribute("data-msel")) { mkt[t.getAttribute("data-msel")] = t.value; mkt_show = 0; save_mkt(); try { t.blur(); } catch (x) {} render_market(); return; }
        var ws = t.getAttribute("data-wslot"), wl = t.getAttribute("data-wlvl"), wm = t.getAttribute("data-wmax");
        var tws = t.getAttribute("data-twslot"), twl = t.getAttribute("data-twlvl"), twm = t.getAttribute("data-twmax");
        if (tws || twl || twm) {
            var parts = (tws || twl || twm).split(":"), tk = parts[0], tsl = parts[1]; if (!team_wish[tk]) team_wish[tk] = {}; var tc = team_wish[tk][tsl] || {};
            if (tws) { var v0 = t.value; if (!v0) tc = {}; else { var d1 = G.items[v0]; tc.item = v0; if (typeof tc.level != "number") tc.level = d1 && d1.upgrade ? Math.min(TEAM_BUILD_MAX_LEVEL, is_buyable(v0) ? 7 : 5) : 0; } game_log("Zielbau " + TEAM_LABEL[tk] + " " + tsl + ": " + (tc.item ? tc.item + " +" + tc.level : "kein Ziel")); }
            else if (twl) { tc.level = parseInt(t.value) || 0; game_log("Zielbau " + TEAM_LABEL[tk] + " " + tsl + ": " + tc.item + " +" + tc.level); }
            else { var mv2 = parse_mio(t.value); if (mv2 > 0) tc.max = mv2; else delete tc.max; game_log("Zielbau " + TEAM_LABEL[tk] + " " + tsl + ": Preislimit " + (mv2 > 0 ? fmt(mv2) : "Standard " + fmt(TEAM_BUILD_DEFAULT_MAX))); }
            team_wish[tk][tsl] = tc; save_team_wish(); try { t.blur(); } catch (x) {} return;
        }
        if (t.getAttribute("data-fixprice")) { var fpn = t.getAttribute("data-fixprice"), fpv = parse_mio(t.value); var fo = stand_orders[fpn] || (stand_orders[fpn] = { since: Date.now() }); if (fpv > 0) { fo.fixed = fpv; fo.price = fpv; } else { delete fo.fixed; } fo.t = Date.now(); save_stand_orders(); game_log("Stand-Auftrag " + fpn + ": " + (fpv > 0 ? "fester Preis " + fmt(fpv) : "automatische Preisleiter") + " – Händler passt den Stand an, sobald er den Slot sieht"); try { t.blur(); } catch (x) {} last_panel = 0; return; }
        if (t.getAttribute("data-arbmin")) { var am = parse_mio(t.value); if (am > 0) { ARB_TRIP_MIN = am; try { localStorage.setItem("lp_arb_min", String(am)); } catch (x) {} game_log("Handelsreise ab " + fmt(am) + " Gewinn"); } try { t.blur(); } catch (x) {} last_panel = 0; return; }
        if (t.getAttribute("data-give")) { give_sel = t.value === "" ? -1 : parseInt(t.value); try { t.blur(); } catch (x) {} return; }
        if (t.getAttribute("data-strict")) { set_strict(t.getAttribute("data-strict"), t.checked); last_panel = 0; return; }
        if (t.getAttribute("data-huntok")) { var hm = t.getAttribute("data-huntok"); set_hunt_allow(hm, t.checked); if (t.checked) { if (hunt_bad[hm]) { delete hunt_bad[hm]; try { localStorage.setItem("lp_hunt_bad", JSON.stringify(hunt_bad)); } catch (x) {} } if (blocked_spots[hm]) delete blocked_spots[hm]; flee_log[hm] = []; game_log("Sperren für " + hm + " aufgehoben"); } last_hunt_check = 0; last_panel = 0; return; }
        if (t.getAttribute("data-huntttk")) { var tv = parseFloat(String(t.value).replace(",", ".")); if (isFinite(tv) && tv > 0) { hunt_max_ttk = tv; try { localStorage.setItem("lp_hunt_max_ttk", String(tv)); } catch (x) {} game_log("Jagd-Grenze: max. " + tv + " s pro Kill"); } return; }
        if (t.getAttribute("data-huntmax")) { var hv = parseFloat(String(t.value).replace(",", ".")); if (isFinite(hv) && hv > 0 && hv <= 100) { hunt_max_danger = hv / 100; try { localStorage.setItem("lp_hunt_max_danger", String(hunt_max_danger)); } catch (x) {} game_log("Jagd-Gefahrgrenze: " + Math.round(hv) + " %"); hunt_skipped = null; last_hunt_check = 0; } try { t.blur(); } catch (x) {} last_panel = 0; return; }
        if (wm) { var mv = parse_mio(t.value), cm = wish_cfg[wm] || { item: wish_item(wm) || "", level: wish_level(wm) }; if (mv > 0) cm.max = mv; else delete cm.max; wish_cfg[wm] = cm; save_wish_cfg(); game_log("Zielbau " + wm + ": Preislimit " + (mv > 0 ? fmt(mv) : "automatisch")); try { t.blur(); } catch (x) {} return; }
        if (ws) { var v = t.value, oldmax = wish_cfg[ws] && wish_cfg[ws].max; if (!v) wish_cfg[ws] = { item: "" }; else wish_cfg[ws] = { item: v, level: default_target_level(G.items[v]) }; if (oldmax) wish_cfg[ws].max = oldmax; save_wish_cfg(); game_log("Zielbau " + ws + ": " + (v ? v + " +" + wish_cfg[ws].level : "kein Ziel")); }
        else if (wl) { var c = wish_cfg[wl] || { item: wish_item(wl) }; c.level = parseInt(t.value); wish_cfg[wl] = c; save_wish_cfg(); game_log("Zielbau " + wl + ": " + c.item + " +" + c.level); }
    };
    win.addEventListener("change", onChange, true);
    var onInput = function (e) { var t = e.target; if (t && t.id == "lp_wiki_q") { wiki.q = t.value; wiki.page = null; render_wiki(); } else if (t && t.id == "lp_mkt_q") { mkt.q = t.value; mkt_show = 0; render_market(); } };
    var onKeyCap = function (e) { var t = e.target; if (t && (t.id == "lp_wiki_q" || (t.tagName == "INPUT" && inside(e)))) { e.stopPropagation(); if (e.key == "Escape") t.blur(); if (e.key == "Enter" && (t.getAttribute("data-wmax") || t.getAttribute("data-mgk") || t.getAttribute("data-huntmax") || t.getAttribute("data-huntttk") || t.getAttribute("data-arbmin") || t.getAttribute("data-twmax") || t.getAttribute("data-fixprice")) && e.type == "keydown") { try { t.dispatchEvent(new Event("change", { bubbles: true })); } catch (x) {} } } }; // Tasten im Suchfeld nicht ans Spiel/Bot weitergeben
    win.addEventListener("input", onInput, true);
    ["keydown", "keyup", "keypress"].forEach(function (t) { win.addEventListener(t, onKeyCap, true); });
    parent.__lp_panel_h = { down: onDown, move: onMove, up: onUp, click: onClick, change: onChange, input: onInput, key: onKeyCap };
    return div;
}
// ---------- Charakter- & Inventar-Fenster ----------
var char_panel = null;
function inv_click(i) {
    var it = character.items[i]; if (!it) return;
    var def = G.items[it.name]; if (!def) return;
    if (def.type == "pot" || def.type == "elixir" || /^(hpot|mpot|elixir)/.test(it.name)) { equip(i); game_log(it.name + " benutzt"); return; }
    var slot = slot_for_item(def);
    if (slot) { equip(i); game_log(it.name + "+" + (it.level || 0) + " angelegt"); }
}
function item_tip(it) {
    var def = G.items[it.name] || {}; var lines = [def.name || it.name + (it.level ? " +" + it.level : "")];
    ["int", "str", "dex", "vit", "stat", "attack", "range", "armor", "resistance", "hp", "mp", "speed", "frequency", "evasion", "reflection"].forEach(function (k) { if (def[k]) lines.push(k + " " + def[k]); });
    if (it.stat_type) lines.push("Attribut-Scroll: " + it.stat_type + (it.stat_type != main_stat_name() ? " (falsch für dich – U setzt INT)" : ""));
    if (def.upgrade || def.compound) lines.push("Bewertung jetzt: " + Math.round(item_score(it)) + " · auf +" + projected_level(def) + ": " + Math.round(gear_score(def, projected_level(def))));
    if (def.g) lines.push("Preis " + fmt(def.g));
    if (it.q) lines.push("Anzahl " + it.q);
    return lines.join("\n");
}
function tile_color(it) {
    var n = it.name, def = G.items[n] || {};
    if (/^hpot/.test(n)) return "#5a2323"; if (/^mpot/.test(n)) return "#233a5a"; if (/^elixir/.test(n)) return "#3d2a5a";
    if (/scroll/.test(n)) return "#4a3d1e"; if (EVENT_ITEMS.test(n)) return "#5a3a4a";
    if (def.compound) return "#2f4a3a"; if (def.upgrade) return "#2c3d55"; if (def.e || def.type == "material") return "#3a3a3a";
    return "#2a2e38";
}
function short(n) { return n.length > 9 ? n.slice(0, 8) + "…" : n; }
function tile_html(it, attrs) {
    if (!it) return "<div class='lp_tile empty' " + attrs + "></div>";
    var lv = it.level ? "<span class='lv'>+" + it.level + "</span>" : "", q = it.q > 1 ? "<span class='q'>" + it.q + "</span>" : "";
    return "<div class='lp_tile' style='background:" + tile_color(it) + "' title='" + esc(item_tip(it)) + "' " + attrs + "><span class='nm'>" + esc(short(it.name)) + "</span>" + lv + q + "</div>";
}
function ensure_char_style() {
    var doc = parent.document, st = doc.getElementById("lp_char_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_char_style";
    st.textContent = ".lp_tchar{position:fixed;left:520px;top:150px;z-index:2147483000;pointer-events:auto;width:420px;background:#14161c;color:#e6e6e6;font:12px/1.35 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + ".lp_tchar_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b}.lp_tchar_head b{flex:1;font-size:13px}.lp_tchar_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + ".lp_tchar_body{padding:8px 10px;max-height:calc(100vh - 200px);overflow-y:auto}.lp_tchar .lp_tile{cursor:default}.lp_tchar .lp_tile:hover{border-color:#444a58}"
      + ".lp_hpbar{height:9px;background:#2a2e38;border-radius:4px;overflow:hidden;margin:2px 0 4px}.lp_hpbar i{display:block;height:100%}"
      + "#lp_char{position:fixed;left:500px;top:130px;z-index:2147483000;pointer-events:auto;width:420px;background:#14161c;color:#e6e6e6;font:12px/1.35 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_char_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b}#lp_char_head b{flex:1;font-size:13px}"
      + "#lp_char_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_char_body{padding:8px 10px;max-height:calc(100vh - 200px);overflow-y:auto}"
      + ".lp_cols{display:flex;gap:10px}.lp_eq{display:grid;grid-template-columns:repeat(4,52px);gap:4px}.lp_stats{flex:1;font-size:11.5px}.lp_stats div{display:flex;justify-content:space-between;padding:1px 0;border-bottom:1px solid #22262f}.lp_stats .lp_k{color:#9aa3b2}"
      + ".lp_inv{display:grid;grid-template-columns:repeat(7,52px);gap:4px;margin-top:8px}"
      + ".lp_tile{position:relative;width:52px;height:44px;border:1px solid #444a58;border-radius:4px;box-sizing:border-box;padding:3px 4px;cursor:pointer;overflow:hidden}.lp_tile:hover{border-color:#8ab4f8}"
      + ".lp_tile.empty{background:#1a1d24;border-style:dashed;cursor:default}.lp_tile.eqempty{border-color:#7a3030}.lp_tile .nm{font-size:10.5px;display:block;white-space:nowrap}.lp_tile .lv{position:absolute;right:3px;bottom:2px;font-size:10px;color:#ffd54f}.lp_tile .q{position:absolute;left:4px;bottom:2px;font-size:10px;color:#9aa3b2}.lp_tile .sl{position:absolute;left:4px;bottom:2px;font-size:9px;color:#6b7280}"
      + ".lp_xp{height:8px;background:#2a2e38;border-radius:4px;overflow:hidden;margin:4px 0 6px}.lp_xp i{display:block;height:100%;background:#7e57c2}";
    doc.head.appendChild(st);
}
var CHAR_EQ = [["earring1", "Ohr"], ["helmet", "Helm"], ["earring2", "Ohr"], ["amulet", "Amulett"], ["mainhand", "Waffe"], ["chest", "Rüstung"], ["offhand", "Nebenh."], ["cape", "Umhang"], ["ring1", "Ring"], ["pants", "Hose"], ["ring2", "Ring"], ["orb", "Orb"], ["belt", "Gürtel"], ["shoes", "Schuhe"], ["gloves", "Handsch."], ["elixir", "Elixier"]];
// ---------- Team-Fenster: Charakter & Inventar von Priest/Ranger/Händler (live aus deren Fenster, sonst letzte Meldung) ----------
var tchar_panels = {}, tchar_open = {}; try { tchar_open = JSON.parse(localStorage.getItem("lp_tchar_open") || "{}"); } catch (e) {}
function tchar_key(nm) { for (var k in TEAM) if (TEAM[k] == nm) return k; return null; }
function init_tchar_panel(nm) {
    var doc = parent.document, id = "lp_tchar_" + nm.toLowerCase(), old = doc.getElementById(id); if (old) old.remove();
    if (!doc.getElementById("lp_char_style")) ensure_char_style();
    var div = doc.createElement("div"); div.id = id; div.className = "lp_tchar"; div.setAttribute("data-tchar", nm);
    div.innerHTML = "<div class='lp_tchar_head'><b>" + esc(TEAM_LABEL[tchar_key(nm)] || nm) + " – " + esc(nm) + "</b><span class='lp_k' data-tchar-state style='font-size:11px'></span><button data-act='tchar' data-nm='" + esc(nm) + "' title='Fenster schließen'>✕</button></div><div class='lp_tchar_body'></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_tchar_pos_" + nm) || "null"); if (p) clamp_pos(div, p.x, p.y); else { var idx = Object.keys(tchar_panels).length; clamp_pos(div, 520 + idx * 40, 150 + idx * 40); } } catch (e) {}
    return div;
}
function toggle_tchar_panel(nm) {
    var p = tchar_panels[nm], on = !(p && p.parentNode);
    if (on) { tchar_panels[nm] = init_tchar_panel(nm); tchar_open[nm] = true; update_tchar_panels(); } else { p.remove(); delete tchar_panels[nm]; delete tchar_open[nm]; }
    try { localStorage.setItem("lp_tchar_open", JSON.stringify(tchar_open)); } catch (e) {}
}
function tchar_live(nm) { try { var w = team_windows()[nm]; var ch = w && w.win && w.win.character; if (ch && ch.name == nm && ch.items) return ch; } catch (e) {} return null; }
function update_tchar_panels() {
    for (var nm in tchar_panels) {
        var div = tchar_panels[nm]; if (!div || !div.parentNode) { delete tchar_panels[nm]; continue; }
        var ch = tchar_live(nm), st = team_state[nm], k = tchar_key(nm), h = "";
        var stx = div.querySelector("[data-tchar-state]");
        if (!ch && !st) { if (stx) stx.textContent = "keine Daten"; div.querySelector(".lp_tchar_body").innerHTML = "<div class='lp_k'>Kein Fenster und keine Statusmeldung von " + esc(nm) + " – ist der Charakter gestartet?</div>"; continue; }
        var c = ch || {}, lvl = ch ? ch.level : st.level, hp = ch ? ch.hp : st.hp, mhp = ch ? ch.max_hp : st.max_hp, mp = ch ? ch.mp : (st.mp_pct != null && st.max_mp ? Math.round(st.mp_pct * st.max_mp) : null), mmp = ch ? ch.max_mp : st.max_mp, gold = ch ? ch.gold : st.gold;
        var state_txt = (st && st.state ? st.state : "") + (st && st.hunt && st.hunt.c > 0 ? " · Jagd " + st.hunt.id + " " + st.hunt.c : "") + (ch ? "" : st ? " · Stand vor " + Math.round((Date.now() - st.t) / 1000) + " s (kein Live-Zugriff)" : "");
        if (stx) stx.textContent = (ch && ch.rip) ? "TOT" : state_txt;
        var hpp = mhp ? Math.round(hp / mhp * 100) : 0, mpp = mmp && mp != null ? Math.round(mp / mmp * 100) : 0;
        var xp_pct = ch ? Math.round(ch.xp / (G.levels[ch.level] || 1) * 100) : null;
        h += "<div><span class='lp_k'>Level</span> <b>" + (lvl != null ? lvl : "?") + "</b>" + (xp_pct != null ? " <span class='lp_k'>(" + xp_pct + "%)</span>" : "") + " &nbsp; <span class='lp_k'>Gold</span> <b>" + (gold != null ? fmt(gold) : "?") + "</b>" + (ch ? " &nbsp; <span class='lp_k'>Karte</span> " + esc(ch.map || "?") + " " + Math.round(ch.x || 0) + "," + Math.round(ch.y || 0) : st && st.map ? " &nbsp; <span class='lp_k'>Karte</span> " + esc(st.map) : "") + "</div>";
        if (xp_pct != null) h += "<div class='lp_xp'><i style='width:" + xp_pct + "%'></i></div>";
        h += "<div><span class='lp_k'>HP</span> " + (hp != null ? hp + " / " + mhp + " (" + hpp + "%)" : "?") + "</div><div class='lp_hpbar'><i style='width:" + hpp + "%;background:" + (hpp < 35 ? "#e53935" : "#43a047") + "'></i></div>";
        h += "<div><span class='lp_k'>MP</span> " + (mp != null ? mp + " / " + mmp + " (" + mpp + "%)" : "?") + "</div><div class='lp_hpbar'><i style='width:" + mpp + "%;background:#1e88e5'></i></div>";
        if (ch) {
            var hpots = 0, mpots = 0; ch.items.forEach(function (it) { if (!it) return; if (/^hpot/.test(it.name)) hpots += it.q || 1; else if (/^mpot/.test(it.name)) mpots += it.q || 1; });
            h += "<div style='margin:4px 0 6px'><span class='lp_k'>Tränke</span> " + hpots + " / " + mpots + " &nbsp; <span class='lp_k'>frei</span> " + ch.esize + " / " + ch.items.length + (ch.s && ch.s.mluck ? " &nbsp; <span class='lp_k'>mluck</span> " + fmt_time(ch.s.mluck.ms) : "") + "</div>";
            h += "<div class='lp_cols'><div class='lp_eq'>";
            CHAR_EQ.forEach(function (e) { var it = ch.slots && ch.slots[e[0]]; h += it ? tile_html(it, "").replace("</div>", "<span class='sl'>" + e[1] + "</span></div>") : "<div class='lp_tile empty eqempty' title='" + e[1] + " – leer'><span class='sl'>" + e[1] + "</span></div>"; });
            h += "</div><div class='lp_stats'>";
            [["Angriff", Math.round(ch.attack || 0)], ["Tempo", (ch.frequency || 0).toFixed(2) + "/s"], ["Reichweite", ch.range], ["Rüstung", ch.armor], ["Resistenz", ch.resistance], ["Laufen", ch.speed], ["INT", ch.int], ["STR", ch.str], ["DEX", ch.dex], ["VIT", ch.vit], ["XP-Bonus", (ch.xp_bonus || 0) + "%"], ["Gold-Bonus", (ch.gold_bonus || 0) + "%"]].forEach(function (r) { h += "<div><span class='lp_k'>" + r[0] + "</span><span>" + (r[1] != null ? r[1] : "?") + "</span></div>"; });
            h += "</div></div><div class='lp_inv'>";
            for (var i = 0; i < ch.items.length; i++) h += tile_html(ch.items[i], "");
            h += "</div>";
        } else {
            h += "<div style='margin:4px 0'><span class='lp_k'>Tränke</span> " + (st.hpots != null ? st.hpots + " / " + (st.mpots || 0) : "?") + (st.free != null ? " &nbsp; <span class='lp_k'>frei</span> " + st.free : "") + (st.tokens != null ? " &nbsp; <span class='lp_k'>Tokens</span> " + st.tokens : "") + "</div>";
            if (st.slots) { h += "<div class='lp_eq'>"; CHAR_EQ.forEach(function (e) { var it = st.slots[e[0]]; h += it ? tile_html(it, "").replace("</div>", "<span class='sl'>" + e[1] + "</span></div>") : "<div class='lp_tile empty eqempty' title='" + e[1] + " – leer'><span class='sl'>" + e[1] + "</span></div>"; }); h += "</div>"; }
            h += "<div class='lp_k' style='margin-top:6px'>Inventar nur mit Live-Zugriff sichtbar (Charakter läuft nicht in diesem Browserfenster).</div>";
        }
        div.querySelector(".lp_tchar_body").innerHTML = h;
    }
}
try { for (var tnm in tchar_open) if (tchar_open[tnm] && TEAM_NAMES.indexOf(tnm) >= 0) tchar_panels[tnm] = init_tchar_panel(tnm); } catch (e) {}
function init_char_panel() {
    var doc = parent.document, old = doc.getElementById("lp_char"); if (old) old.remove();
    ensure_char_style();
    var div = doc.createElement("div"); div.id = "lp_char";
    div.innerHTML = "<div id='lp_char_head'><b>" + esc(character.name) + " – Charakter & Inventar</b><button data-act='chartoggle'>✕</button></div><div id='lp_char_body'></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_char_pos") || "null"); if (p) clamp_pos(div, p.x, p.y); } catch (e) {}
    return div;
}
function toggle_char_panel() {
    var on = !(char_panel && char_panel.parentNode);
    if (on) { char_panel = init_char_panel(); update_char_panel(); } else { char_panel.remove(); char_panel = null; }
    try { localStorage.setItem("lp_char_open", on ? "1" : "0"); } catch (e) {}
}
function update_char_panel() {
    if (!char_panel || !char_panel.parentNode) return;
    var EQ = [["earring1", "Ohr"], ["helmet", "Helm"], ["earring2", "Ohr"], ["amulet", "Amulett"], ["mainhand", "Waffe"], ["chest", "Rüstung"], ["offhand", "Nebenh."], ["cape", "Umhang"], ["ring1", "Ring"], ["pants", "Hose"], ["ring2", "Ring"], ["orb", "Orb"], ["belt", "Gürtel"], ["shoes", "Schuhe"], ["gloves", "Handsch."], ["elixir", "Elixier"]];
    var h = "<div class='lp_cols'><div class='lp_eq'>";
    EQ.forEach(function (e) { var it = character.slots[e[0]]; h += it ? tile_html(it, "data-slot-eq='" + e[0] + "'").replace("</div>", "<span class='sl'>" + e[1] + "</span></div>") : "<div class='lp_tile empty eqempty' title='" + e[1] + " – leer'><span class='sl'>" + e[1] + "</span></div>"; });
    h += "</div><div class='lp_stats'>";
    var xp_pct = Math.round(character.xp / (G.levels[character.level] || 1) * 100);
    var rows = [["Level", character.level + " (" + xp_pct + "%)"], ["Gold", fmt(character.gold)], ["HP", character.hp + " / " + character.max_hp], ["MP", character.mp + " / " + character.max_mp],
                ["Angriff", Math.round(character.attack)], ["Tempo (Angr.)", (character.frequency || 0).toFixed(2) + "/s"], ["Reichweite", character.range], ["Rüstung", character.armor], ["Resistenz", character.resistance], ["Laufen", character.speed],
                ["INT", character.int], ["STR", character.str], ["DEX", character.dex], ["VIT", character.vit], ["XP-Bonus", (character.xp_bonus || 0) + "%"], ["Gold-Bonus", (character.gold_bonus || 0) + "%"], ["Inventar", (character.items.length - character.esize) + " / " + character.items.length]];
    rows.forEach(function (r) { h += "<div><span class='lp_k'>" + r[0] + "</span><span>" + r[1] + "</span></div>"; });
    h += "</div></div><div class='lp_xp'><i style='width:" + xp_pct + "%'></i></div><div class='lp_inv'>";
    for (var i = 0; i < character.items.length; i++) h += tile_html(character.items[i], "data-inv='" + i + "'");
    h += "</div>";
    char_panel.querySelector("#lp_char_body").innerHTML = h;
}
var panel = init_panel();
try { if (localStorage.getItem("lp_char_open") == "1") { char_panel = init_char_panel(); } } catch (e) {}
// ---------- Kampf-Modell: Monster gegen meine Werte ----------
function dmg_mult(defense) { return Math.max(0.05, Math.min(1.32, 1 - 0.001 * defense)); } // Näherung der Spielformel
function my_dps_vs(d) {
    var magical = character.ctype == "mage" || character.ctype == "priest";
    var def = magical ? (d.resistance || 0) - (character.rpiercing || 0) : (d.armor || 0) - (character.apiercing || 0);
    var hit = magical ? 1 : 1 - (d.evasion || 0) / 100;
    return character.attack * (character.frequency || 1) * dmg_mult(def) * hit;
}
function mon_dps(d) { return (d.attack || 0) * (d.frequency || 1) * (1 + (d.crit || 0) / 100); }
function mon_dps_on_me(d) {
    if (d.damage_type == "pure") return mon_dps(d); // "pure": ignoriert Rüstung und Widerstand
    var def = d.damage_type == "magical" ? (character.resistance || 0) - (d.rpiercing || 0) : (character.armor || 0) - (d.apiercing || 0);
    return mon_dps(d) * dmg_mult(def);
}
function pack_factor(d) { // aggressive Monster mit großer Reichweite ziehen im Pulk: bis zu 3 gleichzeitige Angreifer einrechnen
    if (!(d.aggro > 0) || !(d.range >= 250)) return 1;
    var n = 3; try { var id = null; for (var k in G.monsters) if (G.monsters[k] === d) { id = k; break; } if (id) n = Math.min(3, Math.max(1, spawn_count(id))); } catch (e) {}
    return n;
}
// Team-Beitrag: Ranger-Schaden und Priester-Heilung zählen, wenn sie leben, gemeldet haben und neben mir stehen
function team_member_active(key) {
    if (!team_on[key]) return null; var nm = TEAM[key], st = team_state[nm]; if (!st || Date.now() - st.t > 90000 || st.state == "tot" || !(st.attack > 0)) return null;
    var p = null; try { p = get_player(nm); } catch (e) {} if (!p || p.rip || p.map != character.map || distance(character, p) > 400) return null;
    return st;
}
function team_dps_vs(d) { // zusätzlicher Schaden des Rangers (physisch, gegen Rüstung) und des Priesters (magisch, anteilig – er heilt auch)
    var out = 0, r = team_member_active("ranger"), pr = team_member_active("priest");
    if (r) out += r.attack * (r.frequency || 1) * dmg_mult((d.armor || 0)) * (1 - (d.evasion || 0) / 100);
    if (pr) out += pr.attack * (pr.frequency || 1) * dmg_mult((d.resistance || 0)) * 0.4;
    return out;
}
function team_heal_rate() { var pr = team_member_active("priest"); return pr ? pr.attack * (pr.frequency || 1) * 0.6 : 0; } // Heilung ≈ Angriffswert je Zauber, ein Teil der Zeit geht in Angriffe
function team_bonus_txt() { var r = team_member_active("ranger"), pr = team_member_active("priest"); return r || pr ? " mit Team (" + (r ? "Ranger" : "") + (r && pr ? "+" : "") + (pr ? "Priest" : "") + ")" : ""; }
function mon_ttk(d) { // Sekunden pro Kill inkl. Lebensraub
    var dps = my_dps_vs(d) + team_dps_vs(d); if (dps <= 0) return Infinity;
    var heal = mon_dps(d) * (d.lifesteal || 0) / 100;
    var net = dps - heal; if (net <= 0) return Infinity;
    return (d.hp || 0) / net;
}
function mon_danger(d) { // Anteil meiner HP, den ein Kill kostet
    var ttk = mon_ttk(d); if (!isFinite(ttk)) return Infinity;
    var incoming = Math.max(0, mon_dps_on_me(d) * pack_factor(d) + my_dps_vs(d) * (d.reflection || 0) / 100 - team_heal_rate());
    return incoming * ttk / character.max_hp;
}
// Anzahl gleichzeitiger Spawns eines Monstertyps (alle Karten)
var spawn_count_cache = {};
function spawn_count(mon) {
    if (spawn_count_cache[mon] != null) return spawn_count_cache[mon];
    var n = 0;
    for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.monsters || md.ignore) continue; md.monsters.forEach(function (e) { if (e.type == mon) n += e.count || 1; }); }
    spawn_count_cache[mon] = n || 1; return spawn_count_cache[mon];
}
function mon_xph_raw(d, mon) {
    var ttk = mon_ttk(d); if (!isFinite(ttk)) return 0;
    var kills_h = 3600 / (ttk + 2) * 0.8;
    if (mon && d.respawn) kills_h = Math.min(kills_h, spawn_count(mon) * 3600 / d.respawn);
    return (d.xp || 0) * kills_h;
}
// Kalibrierung: Median von gemessen/geschätzt über alle gemessenen Spots (Spielformel + Boni)
var calib_cache = { t: 0, f: 1 };
function xp_calibration() {
    if (Date.now() - calib_cache.t < 30000) return calib_cache.f;
    var ratios = [];
    for (var m in farm_stats) { var st = farm_stats[m]; if (!st || !st.xp_h || !G.monsters[m]) continue; var raw = mon_xph_raw(G.monsters[m], m); if (raw > 0) ratios.push(st.xp_h / raw); }
    ratios.sort(function (a, b) { return a - b; });
    calib_cache = { t: Date.now(), f: ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1 };
    return calib_cache.f;
}
function mon_xph_est(d, mon) { return mon_xph_raw(d, mon) * xp_calibration(); }
function mon_strength(d) { return Math.sqrt(mon_dps(d) * (d.hp || 0) * (1 + (d.resistance || 0) / 100)) / 10; }
function mon_tooltip(m) {
    var d = G.monsters[m];
    return ["HP " + d.hp, "Angriff " + d.attack + " x" + (d.frequency || 1) + "/s (" + (d.damage_type || "physical") + ")", "Rüstung " + (d.armor || 0), "Resistenz " + (d.resistance || 0),
            "Ausweichen " + (d.evasion || 0) + "%", "Reflexion " + (d.reflection || 0) + "%", "Lebensraub " + (d.lifesteal || 0) + "%", "Krit " + (d.crit || 0) + "%",
            "Durchdringung A/R " + (d.apiercing || 0) + "/" + (d.rpiercing || 0), "Tempo " + (d.speed || 0) + " (ich " + character.speed + ")", "XP " + d.xp, "Respawn " + (d.respawn || "?") + " s", "Spawns " + spawn_count(m)].join("\n");
}
var sort_key = "xph", sort_dir = -1;
try { var sv = JSON.parse(localStorage.getItem("lp_sort") || "null"); if (sv) { sort_key = sv.k; sort_dir = sv.d; } } catch (e) {}
function set_sort(k) { if (sort_key == k) sort_dir = -sort_dir; else { sort_key = k; sort_dir = (k == "name" ? 1 : -1); } try { localStorage.setItem("lp_sort", JSON.stringify({ k: sort_key, d: sort_dir })); } catch (e) {} last_panel = 0; }
function sort_value(m, k) {
    if (k == "hunt") return hunt_allowed(m) ? 1 : 0;
    if (k == "strict") return strict_mon(m) ? 1 : 0;
    var d = G.monsters[m], st = farm_stats[m];
    switch (k) {
        case "name": return m;
        case "danger": return mon_danger(d);
        case "ttk": return mon_ttk(d);
        case "xpest": return mon_xph_est(d, m);
        case "xpk": return d.xp || 0;
        case "xph": return st ? st.xp_h : estimate(m) * 100;
        case "gph": return st ? st.gold_h : 0;
        case "ang": return st && st.attack || 0;
    }
    return 0;
}
function fmt(n) { n = Math.round(n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
function fmt_time(ms) { if (!isFinite(ms) || ms < 0) return "-"; var m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; }
function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function bar(pct, color) { return "<span class='lp_bar'><i style='width:" + Math.max(0, Math.min(100, pct)) + "%;background:" + color + "'></i></span>"; }
var set_tab = "look";
function render_settings(sp) {
    var acc = Object.keys(ACCENTS).map(function (k) { var c = ACCENTS[k]; return "<button class='lp_sw" + (SET.accent == k ? " sel" : "") + "' data-set='accent' data-v='" + k + "' style='background:" + c[0] + "' title='" + k + "'></button>"; }).join(" ");
    var h = "<div class='lp_tab'><button data-set='tab' data-v='look'" + (set_tab == "look" ? " class='on'" : "") + ">Darstellung</button><button data-set='tab' data-v='fight'" + (set_tab == "fight" ? " class='on'" : "") + ">Kampf &amp; Team</button><button data-set='tab' data-v='hunt'" + (set_tab == "hunt" ? " class='on'" : "") + ">Jagd &amp; Log</button></div>";
    if (set_tab == "look") h += "<label>Transparenz <input type='range' data-setk='alpha' min='40' max='100' value='" + Math.round(SET.alpha * 100) + "'></label>"
        + "<label>Schriftgröße <input type='range' data-setk='font' min='10' max='15' step='0.5' value='" + SET.font + "'></label>"
        + "<label>Akzentfarbe " + acc + "</label>"
        + "<label><button data-set='resetpos'>Panelposition zurücksetzen</button></label>";
    else if (set_tab == "fight") h += "<h4>Auf Team warten</h4><label>Anhalten, wenn Priest/Ranger weiter zurück als <input type='number' data-setk='wait_behind' min='200' max='1500' step='50' value='" + SET.wait_behind + "'> px</label>"
        + "<label>Sammelpunkt vor Team-Spots <input type='number' data-setk='rally' min='150' max='800' step='50' value='" + SET.rally + "'> px</label>"
        + "<label>Rückzug beim Warten unter <input type='number' data-setk='hold_flee' min='20' max='90' step='5' value='" + SET.hold_flee + "'> % HP</label>"
        + "<h4>Tränke</h4><label>Heiltrank ab <input type='number' data-setk='hp_pot' min='20' max='80' step='5' value='" + SET.hp_pot + "'> % HP</label>"
        + "<label>Manatrank ab <input type='number' data-setk='mp_pot' min='20' max='90' step='5' value='" + SET.mp_pot + "'> % MP</label>"
        + "<h4>Automatik</h4><label>Gold <input type='range' data-setk='xp_weight' min='0' max='100' step='10' value='" + SET.xp_weight + "'> XP <span style='color:#e6e6e6'>" + SET.xp_weight + " % XP</span></label>";
    else h += "<label><input type='checkbox' data-setk='team_hunt_first'" + (SET.team_hunt_first ? " checked" : "") + "> Laufende Team-Jagd zuerst beenden</label>"
        + "<label><input type='checkbox' data-setk='hunt_town_only'" + (SET.hunt_town_only ? " checked" : "") + "> Neue Jagd nur holen, wenn ohnehin in der Stadt</label>"
        + "<label><input type='checkbox' data-setk='log_pots'" + (SET.log_pots ? " checked" : "") + "> Trank-Zeilen im Log anzeigen</label>";
    h += "<div style='color:#6b7280;margin-top:6px'>Gilt für alle Chars, wird gespeichert.</div>";
    sp.innerHTML = h;
}
function settings_click(b) {
    var k = b.getAttribute("data-set"), v = b.getAttribute("data-v");
    if (k == "tab") set_tab = v;
    else if (k == "accent") { SET.accent = v; save_settings(); }
    else if (k == "resetpos") { try { localStorage.removeItem("lp_panel_pos"); } catch (e) {} clamp_pos(panel, 10, 130); }
    var sp = panel.querySelector("#lp_set"); if (sp) render_settings(sp);
}
function settings_input(t) {
    var k = t.getAttribute("data-setk"); if (!(k in SET)) return;
    if (t.type == "checkbox") SET[k] = !!t.checked;
    else { var v = parseFloat(String(t.value).replace(",", ".")); if (!isFinite(v)) return; if (k == "alpha") v = v / 100; SET[k] = v; }
    save_settings();
    if (k == "xp_weight") { need_repick = true; var sp = panel.querySelector("#lp_set"); if (sp && t.type == "range") { var lab = t.parentNode.querySelector("span"); if (lab) lab.textContent = SET.xp_weight + " % XP"; } }
}
function market_scroll_summary() { try { var ws = watch_summary("scroll3"); if (!ws) return ""; return "Scroll " + (ws.ask ? "ab " + fmt(ws.ask.price) : "kein Verkäufer") + (ws.bid ? " / Kaufauftrag " + fmt(ws.bid.price) : ""); } catch (e) { return ""; } }
function lp_sec(key, title, summary, body) { // einklappbarer Abschnitt
    var open = panel.__sec[key];
    return "<div class='lp_sec'><div class='lp_row' style='margin:2px 0'><button data-sec='" + key + "' class='lp_sech' style='background:none;border:none;padding:0;text-align:left;flex:1;font-size:inherit'>" + (open ? "▾" : "▸") + " <b style='color:#c9ced8;font-weight:600'>" + title + "</b>" + (open ? "" : "<span class='lp_secv'>" + summary + "</span>") + "</button></div>" + (open ? body : "") + "</div>";
}
var list_panel = null;
function init_list_panel() {
    var doc = parent.document, old = doc.getElementById("lp_list"); if (old) old.remove();
    var div = doc.createElement("div"); div.id = "lp_list";
    div.innerHTML = "<div id='lp_list_head'><b>Monster</b><button id='lp_list_close' title='Liste ausblenden (▾ im Hauptfenster blendet sie wieder ein)'>✕</button></div><div id='lp_list_body'></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_list_pos") || "null"); if (p) clamp_pos(div, p.x, p.y); else clamp_pos(div, Math.min(parent.window.innerWidth - 440, (panel ? panel.offsetLeft + panel.offsetWidth : 480) + 10), panel ? panel.offsetTop : 130); } catch (e) {}
    return div;
}
function hunts_grid_html() { // Jagden als kleine Tabelle: Wer · Monster n · Status
    if (SOLO) return "";
    var th = team_hunt_pick(), q = mh_quest(), rows = [];
    function status(id, c, ms, mine) {
        if (!id || !(c > 0)) return "<span class='lp_k'>keine Jagd</span>";
        var left = ms > 0 ? " <span class='lp_k'>· noch " + fmt_time(ms).replace(/\s.*$/, "") + "</span>" : "";
        var ok = mine ? hunt_target_ok(id) : (th && th.id == id), run = current_spot == id && !paused;
        if (ok) return (run ? "<span style='color:#4caf50'>läuft</span>" : "<span style='color:#8ab4f8'>machbar" + (mine ? "" : " – als Nächstes") + "</span>") + left;
        if (!mine && hunt_allowed(id) && !spot_blocked(id) && !hunt_bad_for(id)) return "<span style='color:#8ab4f8'>wartet" + (th ? " (nach " + esc(th.who) + ")" : "") + "</span>" + left;
        var why = hunt_skip_reason(id); if (/nicht erlaubt|kein Häkchen/.test(why)) why = "Jagd nicht freigegeben";
        return "<span style='color:#ffb74d'>" + esc(why) + "</span>" + left;
    }
    rows.push(["Mage", q && q.c > 0 ? esc(q.id) + " " + q.c : "–", status(q && q.id, q && q.c, q && q.ms, true)]);
    ["priest", "ranger"].forEach(function (k) { if (!team_on[k]) return; var st = team_state[TEAM[k]]; if (!st || Date.now() - st.t > 120000) { rows.push([TEAM_LABEL[k], "?", "<span class='lp_k'>keine Meldung</span>"]); return; } var h = st.hunt; rows.push([TEAM_LABEL[k], h && h.c > 0 ? esc(h.id) + " " + h.c : "–", status(h && h.id, h && h.c, h && h.ms != null ? Math.max(0, h.ms - (Date.now() - st.t)) : null, false)]); });
    var w = wait_txt(); try { var hs2 = hunt_slot_state(); rows.push(["<span class='lp_k'>Slot</span>", "", hs2.busy ? "<span class='lp_k'>belegt: " + esc(hs2.holder) + "</span>" : "<span class='lp_k'>frei – holt " + esc(hs2.fetcher == character.name ? "Mage" : hs2.fetcher == TEAM.priest ? "Priest" : hs2.fetcher == TEAM.ranger ? "Ranger" : "niemand (alle haben eine Jagd)") + "</span>"]); } catch (e) {}
    return "<div class='lp_hunts'>" + rows.map(function (r) { return "<span class='lp_hn'>" + r[0] + "</span><span class='lp_hm'>" + r[1] + "</span><span>" + r[2] + "</span>"; }).join("") + "</div>" + (w ? "<div style='color:#ffb74d;font-size:11px'>" + esc(w) + "</div>" : "");
}
function update_panel() {
    if (!panel || !panel.parentNode) panel = init_panel();
    var hp = Math.round(character.hp / character.max_hp * 100), mp = Math.round(character.mp / character.max_mp * 100);
    var state = panel.querySelector("#lp_state");
    var st_txt = !bot_running ? "AUS" : paused ? "PAUSE" : handing ? "Übergabe" : upgrading ? "Upgrade" : pending_upgrade ? "Upgrade wartet" : kissing ? "Kuss" : fleeing ? "Rückzug" : exchanging ? "Tausch" : pontying ? "Ponty" : marketing ? "Markt" : hunting ? "Daisy" : busy ? "unterwegs" : "farmt"; if (focus_mode && bot_running && !paused) st_txt += " (Fokus)";
    state.textContent = st_txt; state.className = "lp_state" + ((paused || !bot_running) ? " pause" : (upgrading || pending_upgrade || kissing || fleeing || exchanging || busy) ? " busy" : "");
    panel.querySelector("#lp_toggle").textContent = panel.__collapsed ? "▸" : "▾";
    var mini_b = panel.querySelector("#lp_mini"); if (mini_b) { mini_b.textContent = panel.__mini ? "▣" : "▭"; mini_b.title = panel.__mini ? "Fenster vergrößern" : "Fenster verkleinern"; }

    var sh = Math.max(1 / 60, (Date.now() - sess.start) / 3600000);
    var cur_xp_h = 0, cur_gold_h = 0;
    if (meas) { var mh = Math.max(1 / 60, (Date.now() - meas.start - meas.paused_ms) / 3600000); cur_xp_h = meas.xp / mh; cur_gold_h = meas.gold / mh; }
    else if (current_spot && farm_stats[current_spot]) { cur_xp_h = farm_stats[current_spot].xp_h; cur_gold_h = farm_stats[current_spot].gold_h; }
    var meas_txt = "";
    if (meas && !meas.manual) { var rem = EVAL_MS - (Date.now() - meas.start - meas.paused_ms - (meas.pause_start ? Date.now() - meas.pause_start : 0)); meas_txt = "Messung, noch " + Math.max(0, Math.ceil(rem / 60000)) + " min"; }
    else if (meas && meas.manual) meas_txt = "fest seit " + fmt_time(Date.now() - meas.start);
    var rate = cur_xp_h || sess.xp / sh;
    var a = anniv();
    var kiss_txt = a && a.active ? (a.available === false ? "erledigt" : (a.live && a.target ? "JETZT: " + esc(a.target) : "nächste in " + fmt_time(a.next - Date.now()))) : "-";

    if (panel.__mini) { // Kompaktansicht: eine Zeile Status + die wichtigsten Knöpfe
        var hm = "<div class='lp_grid' style='margin-bottom:2px'><div><span class='lp_k'>Lv</span> " + character.level + " · <span class='lp_k'>Gold</span> " + fmt(character.gold) + " · <span class='lp_k'>frei</span> " + character.esize + "</div>"
          + "<div><span class='lp_k'>HP</span> " + hp + "%" + bar(hp, hp < 35 ? "#e53935" : "#43a047") + " <span class='lp_k'>MP</span> " + mp + "%</div>"
          + "<div style='grid-column:1/3'><span class='lp_k'>Spot</span> <b>" + esc(current_spot || "-") + "</b> · " + fmt(cur_xp_h) + " XP/h · " + fmt(cur_gold_h) + " G/h · <span class='lp_k'>Hunt</span> " + esc(mh_txt()) + "</div>"
          + "<div style='grid-column:1/3'><span class='lp_k'>Heute</span> " + esc(day_text(day)) + "</div></div>" + team_html()
          + "<div class='lp_row'><span class='lp_mode'>" + (manual_spot ? "fest (" + esc(manual_spot) + ")" : auto_on ? "automatisch" : "nur Jagden") + "</span><button data-act='auto'" + (manual_spot || !auto_on ? "" : " class='on'") + ">Auto</button><button data-act='focus'" + (focus_mode ? " class='on'" : "") + ">Fokus</button><button data-act='hunt'" + (hunt_on ? " class='on'" : "") + ">Hunt</button><button data-act='pauseafter'" + (pause_after ? " class='on'" : "") + ">Danach: " + (pause_after ? "Pause" : "Farmen") + "</button><button data-act='copylog'>Log</button></div>";
        try { var ae0 = parent.document.activeElement; if (ae0 && ae0.tagName == "SELECT" && panel.contains(ae0)) return; } catch (e) {}
        try { if (panel.__w != 470) { panel.__w = 470; panel.style.width = "470px"; clamp_pos(panel, panel.offsetLeft, panel.offsetTop); } } catch (e) {}
        panel.querySelector("#lp_body").innerHTML = hm; if (list_panel && list_panel.parentNode) { list_panel.remove(); list_panel = null; } return;
    }
    var a2 = a && a.active;
    var h = "<div class='lp_grid'>"
      + "<div><span class='lp_k'>Level</span> " + character.level + " &nbsp; <span class='lp_k'>Gold</span> " + fmt(character.gold) + "</div><div><span class='lp_k'>Session</span> " + fmt_time(sh * 3600000) + " · <span class='lp_k'>frei</span> " + character.esize + "</div>"
      + "<div style='grid-column:1/3;white-space:normal'><span class='lp_k'>Heute</span> " + esc(day_text(day)) + "</div>"
      + "<div><span class='lp_k'>HP</span> " + hp + "%" + bar(hp, hp < 35 ? "#e53935" : "#43a047") + "</div><div><span class='lp_k'>MP</span> " + mp + "%" + bar(mp, "#1e88e5") + " &nbsp; <span class='lp_k'>Tränke</span> " + pots_total(POTS_HP) + "/" + pots_total(POTS_MP) + "</div>"
      + "<div style='grid-column:1/3;color:#6b7280;font-size:11px'>Elixier " + (character.slots.elixir ? "an" : "aus") + " · Kuss " + kiss_txt + (a2 ? " · Kuchen " + (6 - missing_slices().length) + "/6" + (missing_slices().length ? " (fehlt: " + esc(missing_slices().map(function (n) { return n.replace("slice_", ""); }).join(", ")) + ")" : quantity("sixcake") ? " · Sixfold Cake ×" + quantity("sixcake") : ", bereit zum Backen") : "") + " · Ref " + fmt(gold_per_hour()) + " G/h</div>"
      + "</div>";
    h += "<div class='lp_spot'><div><span class='lp_k'>Spot</span> <b>" + esc(current_spot || (auto_on ? "-" : "nur Jagden")) + "</b>" + (meas_txt ? " <span class='lp_k'>(" + meas_txt + ")</span>" : "") + "</div>"
      + "<div class='lp_big'>" + fmt(cur_xp_h) + " XP/h &nbsp;·&nbsp; " + fmt(cur_gold_h) + " G/h</div>"
      + "<div class='lp_k'>Session " + fmt(sess.xp / sh) + " XP/h · " + fmt(sess.gold / sh) + " G/h · nächstes Level in " + (rate > 0 ? fmt_time((G.levels[character.level] - character.xp) / rate * 3600000) : "-") + "</div></div>";
    h += "<div class='lp_row'><span class='lp_mode'>Modus: " + (manual_spot ? "fest (" + esc(manual_spot) + ")" : auto_on ? "automatisch" : "<span style='color:#ffb74d'>nur Jagden" + (current_spot ? "" : " – wartet bei Daisy") + "</span>") + "</span><button data-act='auto'" + (manual_spot || !auto_on ? "" : " class='on'") + " title='an: Automatik wählt den Spot (Lückenfüller) · aus: nur Jagden, sonst warten bei Daisy'>Auto</button><button data-act='bycatch'" + (bycatch ? " class='on'" : "") + " title='andere sichere Monster in der Nähe mit angreifen'>Beifang</button><button data-act='focus'" + (focus_mode ? " class='on'" : "") + " title='nur farmen/hunten: kein Kuss, Ponty, Markt, Kuchen, keine Ausrüstungsautomatik'>Fokus</button></div>";
    var cav_left = Math.max(0, Math.max(cav_next, cav_last + cav_cooldown()) - Date.now());
    h += "<div class='lp_row'><span class='lp_k'>Aktionen</span><button data-act='copylog' title='Bot-Log in die Zwischenablage'>Log kopieren</button><button data-act='pauseafter'" + (pause_after ? " class='on'" : "") + " title='Nach Buttons/Tasten pausieren statt weiterfarmen'>Danach: " + (pause_after ? "Pause" : "Farmen") + "</button><button data-act='unblock' title='Alle Spot-/Jagd-Sperren (Tod, Rückzüge) aufheben'>Sperren aufheben</button><button data-act='cavalry' title='Tracktrix: Lv-100-Trupp rufen, räumt bis zu 24 Monster im Umkreis (90 s) – wer bereit ist: Magier, sonst Priest/Ranger mit eigenem Tracktrix'" + (any_cav_ready() ? " style='color:#C6AA62'" : "") + ">Cavalry " + (cav_ready() ? "bereit" : team_cav_ready() ? "bereit (" + TEAM_LABEL[team_cav_ready()] + ")" : "(" + Math.ceil(cav_left / 60000) + " min" + (function () { var m = null; ["priest", "ranger"].forEach(function (k) { var st = team_state[TEAM[k]]; if (team_on[k] && st && st.cav && st.cav.has) { var l = Math.ceil(Math.max(0, st.cav.next - Date.now()) / 60000); if (m == null || l < m) m = l; } }); return m != null ? ", Team " + m + " min" : ""; })() + ")") + "</button><button data-act='cavauto'" + (cav_on ? " class='on'" : "") + " title='Cavalry automatisch rufen, wenn am Spot nur gelevelte Exemplare stehen'>Cav-Auto</button></div>";
    h += event_html();
    h += "<div class='lp_sec'><div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Hunt: <span style='color:#e6e6e6'>" + esc(mh_txt()) + "</span> · " + tokens() + " Tokens</span><button data-act='hunt'" + (hunt_on ? " class='on'" : "") + " title='Monster Hunt automatisch (Rundlauf Magier → Priest → Ranger)'>Hunt</button>" + (mh_quest() ? "<button data-act='huntabandon'>Abbrechen</button>" : "") + "</div>"
      + hunts_grid_html() + "</div>";
    h += "<div class='lp_sec'>" + team_html() + "</div>";
    // Händler (eingeklappt)
    var mst0 = team_state[TEAM.merch], stand_txt = mst0 && Date.now() - mst0.t < 60000 ? esc(mst0.state || "") : "keine Meldung";
    var tips = server_tip(); var sc = market_scroll_summary();
    h += lp_sec("haendler", "Händler", stand_txt + (sc ? " · " + sc : "") + " · " + (tips.length ? tips.length + " Serverfund" + (tips.length > 1 ? "e" : "") : "kein Serverfund") + (arb_auto ? " · Handelsreise Auto" : ""),
        (merch_buy ? "<div class='lp_row'><span class='lp_k'>Einkauf:</span> <span style='color:#8ab4f8'>" + esc(mb_stage_txt()) + "</span><button data-act='mbcancel' title='Einkauf abbrechen (Gold kommt bei der nächsten Abholung zurück)'>Abbrechen</button></div>" : "") + "<div class='lp_row'><span class='lp_k'>Aktionen</span>" + (team_on.merch ? "<button data-act='goldback' title='Händler bringt alles über seinem Zielbestand, Priest/Ranger alles über ihrem Maximum zu dir'>Gold holen" + (mst0 && mst0.gold ? " (" + fmt(mst0.gold) + ")" : "") + "</button>" : "") + "<span class='lp_k' style='margin-left:6px'>Kasse:</span> <input data-mgk='target' value='" + esc(fmt_mio(MG.target)) + "' title='Zielbestand des Händlers in Mio. – er füllt bei dir auf, wenn er unter die Nachfüllgrenze fällt' style='width:44px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'> <span class='lp_k'>Mio · nachfüllen unter</span> <input data-mgk='min' value='" + esc(fmt_mio(MG.min)) + "' title='Nachfüllgrenze des Händlers in Mio.' style='width:44px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'> <span class='lp_k'>Mio · Priest/Ranger max.</span> <input data-mgk='esc' value='" + esc(fmt_mio(MG.esc_max)) + "' title='Priest/Ranger geben alles über diesem Betrag (in Mio.) an dich ab' style='width:44px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'> <span class='lp_k'>Mio</span>" + "<button data-act='mkttoggle' title='Markt-Fenster: alle Angebote aller Server, filterbar'>Markt</button><button data-act='marketscan' title='Alle Händlerstände jetzt abfragen: Zielbau-Angebote und Schnäppchen unter NPC-Wert'" + (scanning_now ? " class='on'" : "") + ">" + (scanning_now ? "Scan läuft…" : "Schnäppchen scannen") + "</button></div>"
        + (team_on.merch ? "<div class='lp_row'><span class='lp_k'>Spenden (Ron):</span> <input data-mgk='donate' value='" + esc(fmt_mio(donate_amt)) + "' title='Betrag in Mio., den der Händler bei Ron gegen XP spendet (4,8 XP/Gold bei leerer Schatzkammer)' style='width:44px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'> <span class='lp_k'>Mio</span><button data-act='donate' title='Händler läuft zu Ron und spendet den Betrag in 100k-Schritten (Kasse bleibt über der Nachfüllgrenze)'>Spenden</button><button data-act='donateauto'" + (donate_auto ? " class='on'" : "") + " title='Händler spendet automatisch alles über der Nachfüllgrenze, bis er Lv " + DONATE_LVL + " hat (mluck)'>Auto bis Lv " + DONATE_LVL + "</button>" + (mst0 && mst0.level != null ? "<span class='lp_k'>Händler Lv " + mst0.level + (mst0.level >= 40 ? " – mluck aktiv" : ", bis Lv 40 noch ~" + fmt(Math.round(lvl_xp_between(mst0.level, 40) / (donate_rate || 4.8))) + " Gold" + (donate_rate ? " (" + donate_rate.toFixed(2) + " XP/Gold gemessen)" : "")) + "</span>" : "") + "</div>" : "")
        + "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'><span class='lp_k'>Serverwechsel:</span> <span style='font-size:11px'>" + server_tip_html() + "</span></div>" + arb_html(panel) + arb_trip_html() + watch_html());
    // Zielbau (eingeklappt)
    var tw_sum = ["priest", "ranger"].filter(function (k) { return team_on[k]; }).map(function (k) { var cfgs = team_wish[k] || {}, n = 0, done = 0; TEAM_WISH_SLOTS.forEach(function (sl) { var c = cfgs[sl]; if (c && c.item) { n++; var s2 = tw_status(k, sl); if (s2 && s2.state == "fertig") done++; } }); return TEAM_LABEL[k] + " " + (n ? done + "/" + n : "–"); }).join(" · ");
    h += lp_sec("zielbau", "Zielbau", "Ich " + esc(wish_text()) + (tw_sum ? " · " + tw_sum : "") + (AUTO_GEAR ? " · Reserve " + fmt(WISH_RESERVE) : ""),
        "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Zielbau " + wish_text() + (AUTO_GEAR ? " · automatisch, Reserve " + fmt(WISH_RESERVE) : "") + "</span><button data-act='wishist' data-slot='*' title='alle Slots auf das setzen, was du gerade trägst – Preislimits bleiben erhalten'>Ist</button><button data-act='wishreset' title='alle Ziele auf das Getragene setzen und alle Limits löschen'>Zielbau = aktuelle Ausrüstung</button><button data-act='wishtoggle'>" + (panel.__wish ? "▾" : "▸") + " Liste</button></div>" + (panel.__wish ? wish_ui_html() : "") + team_wish_html(panel));
    // Wartung (eingeklappt)
    h += lp_sec("wartung", "Wartung", "Inv sortieren · Compound · Aufräumen · Bank",
        "<div class='lp_row'><button data-act='sortinv' title='Inventar sortieren'>Inv ⇅</button><button data-act='compound' title='Schmuck compounden (getragen + ungetragen)'>Compound</button><button data-act='tidy' title='Schrott verkaufen, Rest in die Bank'>Aufräumen</button><button data-act='bank' title='Schrott aus der Bank holen und verkaufen'>Bank aufräumen</button><button data-act='banksort' title='Bank nach Gruppen sortieren, Reiter lückenlos füllen'>Bank ⇅</button><button data-act='bankstatus' title='Alle Bankfächer ins Log: Belegung, gesperrt/frei, Preis'>Bank-Status</button><button data-act='reset' title='alle Messwerte verwerfen und neu messen'>Neu messen</button><button data-act='clearlog' title='Log-Puffer leeren'>Log leeren</button></div>");
    // Monsterliste
    var hr = "";
    if (!panel.__collapsed) {
        var cols = [["name", "Monster"], ["hunt", "Jagd"], ["strict", "Team"], ["danger", "Gefahr"], ["xph", "XP/h"], ["gph", "G/h"]];
        hr += "<div class='lp_k' style='font-size:11px;margin-top:4px'>Gefahr mit Team" + (team_bonus_txt() ? team_bonus_txt().replace(/^ mit Team/, "") : "") + " · ×" + xp_calibration().toFixed(1) + " kalibriert (" + Object.keys(farm_stats).length + " Spots)</div>";
        hr += "<table class='lp_t'><tr>" + cols.map(function (c) { return "<th data-sort='" + c[0] + "'" + (sort_key == c[0] ? " class='sorted'" : "") + ">" + c[1] + (sort_key == c[0] ? (sort_dir < 0 ? " ▾" : " ▴") : "") + "</th>"; }).join("") + "<th></th></tr>";
        var mons = visible_mons();
        mons.sort(function (x, y) { var a1 = sort_value(x, sort_key), b1 = sort_value(y, sort_key); return (a1 < b1 ? -1 : a1 > b1 ? 1 : 0) * sort_dir; });
        mons.forEach(function (m) {
            var st = farm_stats[m], d = G.monsters[m], oldc = st && !stats_valid(st) ? " class='old'" : "";
            var dg = mon_danger(d), ttk = mon_ttk(d);
            var tip = "s/Kill " + (isFinite(ttk) ? ttk.toFixed(1) : "∞") + " · XP/Kill " + fmt(d.xp) + " · Schätzung " + fmt(mon_xph_est(d, m)) + " XP/h" + (st && st.attack ? " · ANG bei Messung " + st.attack : "") + "\n" + mon_tooltip(m);
            hr += "<tr" + (m == current_spot ? " class='cur'" : "") + "><td title='" + esc(tip) + "'>" + esc(m) + (st && st.deaths ? " <span style='color:#ef5350'>†" + st.deaths + "</span>" : "") + "</td>"
               + "<td><input type='checkbox' data-huntok='" + m + "'" + (hunt_allowed(m) ? " checked" : "") + " title='Jagd auf " + esc(m) + " erlauben (auch für die Automatik)'></td>"
               + "<td><input type='checkbox' data-strict='" + m + "'" + (strict_mon(m) ? " checked" : "") + " title='Team-Pflicht: Sammelpunkt vor dem Spot, Angriff erst mit Priest und Ranger < 250 px; Priest/Ranger ziehen nie selbst'></td>"
               + "<td style='color:" + (dg > 0.35 ? "#ef5350" : dg > 0.15 ? "#ffb74d" : "#81c784") + "'>" + (isFinite(dg) ? Math.round(dg * 100) + "%" : "∞") + "</td>"
               + "<td" + oldc + ">" + (st ? fmt(st.xp_h) : "-") + "</td><td" + oldc + ">" + (st ? fmt(st.gold_h) : "-") + "</td>"
               + "<td><button data-act='farm' data-mon='" + m + "'" + (m == manual_spot ? " class='on'" : "") + ">Farmen</button> <button data-act='hide' data-mon='" + m + "' title='ausblenden' style='padding:1px 5px'>✕</button></td></tr>";
        });
        var hid = Object.keys(hidden_mons).filter(function (m) { return G.monsters[m]; });
        if (hid.length) hr += "<tr><td colspan='7' style='text-align:left;color:#9aa3b2;white-space:normal'>Ausgeblendet: " + hid.map(function (m) { return esc(m) + " <button data-act='show' data-mon='" + m + "' style='padding:0 4px'>↩</button>"; }).join(" ") + "</td></tr>";
        hr += "</table>";
    }
    try { var ae = parent.document.activeElement; if (ae && (ae.tagName == "SELECT" || ae.tagName == "INPUT") && (panel.contains(ae) || (list_panel && list_panel.contains(ae)))) return; } catch (e) {}
    try { var wantW = panel.__wish && panel.__sec.zielbau ? 900 : 470; if (panel.__w != wantW) { panel.__w = wantW; panel.style.width = wantW + "px"; clamp_pos(panel, panel.offsetLeft, panel.offsetTop); } } catch (e) {}
    panel.querySelector("#lp_body").innerHTML = h;
    if (!panel.__collapsed) { if (!list_panel || !list_panel.parentNode) list_panel = init_list_panel(); list_panel.querySelector("#lp_list_body").innerHTML = hr; }
    else if (list_panel && list_panel.parentNode) { list_panel.remove(); list_panel = null; }
}
var last_panel = 0;

// ---------- Hänger-Erkennung ----------
var unsticking = false;
async function check_stuck() {
    if (unsticking || paused || busy || upgrading || kissing || fleeing || exchanging || !has_weapon()) { if (busy || paused || upgrading || kissing || fleeing || exchanging) last_gain = Date.now(); return; }
    if (Date.now() - last_gain < STUCK_MS) return;
    unsticking = true; busy = true; stuck_count++;
    game_log("Festgefahren? " + Math.round(STUCK_MS / 60000) + " min ohne XP – setze Position zurück (" + stuck_count + ")");
    set_message("Neustart Weg");
    try {
        stop("smart"); stop("move"); change_target(null);
        if (stuck_count % 3 == 0) await travel_place("town"); // jedes dritte Mal über die Stadt
        var mon = pick_farm_monster();
        await smart_move(mon);
    } catch (e) { blocked_spots[pick_farm_monster()] = true; need_repick = true; }
    last_gain = Date.now(); unsticking = false; busy = false;
}

// ---------- Statusanzeige ----------
var last_status = 0;
function status_message(prefix) {
    if (Date.now() - last_status < 3000) return;
    last_status = Date.now();
    var st = current_spot && farm_stats[current_spot];
    var txt = prefix || (current_spot || "");
    if (meas) {
        var h = Math.max(1, Date.now() - meas.start - meas.paused_ms) / 3600000;
        txt += " " + Math.round(meas.xp / h / 1000) + "k/" + Math.round(meas.gold / h / 1000) + "k";
    } else if (st) txt += " " + Math.round(st.xp_h / 1000) + "k/" + Math.round(st.gold_h / 1000) + "k";
    set_message(txt);
}

// ---------- Inventar aufräumen: Schrott verkaufen, Rest in die Bank ----------
var EQUIP_TYPES = ["helmet", "chest", "pants", "shoes", "gloves", "cape", "weapon", "shield", "quiver", "source", "misc_offhand"]; // Schmuck nie verkaufen (Compound)
function is_junk(it) { // kaufbare Standardausrüstung ohne Level/Attribut; ungetragener kaufbarer Schmuck +0 in Einzelstücken; fremde Elixiere; HP-Schmuck
    var def = G.items[it.name]; if (!def) return false;
    if (is_team_wish_item(it)) return false; // Team-Zielbau-Teile bleiben
    if (HP_JEWELRY.test(it.name)) return true;
    if (def.type == "elixir" && !/^elixirint/.test(it.name)) return true;
    if (def.compound) return is_buyable(it.name) && (it.level || 0) == 0 && !equipped_names()[it.name] && find_inv_indices(it.name, 0).length < 3;
    if (EQUIP_TYPES.indexOf(def.type) < 0) return false;
    if ((it.level || 0) > 0 || it.stat_type) return false;
    return is_buyable(it.name);
}
// Überzählige Kopien von Ausrüstung: je Name bleibt neben dem getragenen Teil eine Kopie (die beste, bzw. bei kaufbaren Teilen die Reserve).
// Alle weiteren Kopien bis +DUP_MAX_LEVEL werden verkauft. Kopien in der Bank zählen mit.
var DUP_MAX_LEVEL = 5, DUP_KEEP = 1;
var bank_cache = null; try { bank_cache = JSON.parse(localStorage.getItem("lp_bank_cache_" + character.name) || "null"); } catch (e) {}
function bank_snapshot() { // Bankinhalt merken, solange wir drin stehen – außerhalb der Bank kennt das Spiel ihn nicht
    if (character.bank && typeof character.bank == "object") { var snap = {}; for (var pack in character.bank) if (pack.indexOf("items") == 0 && Array.isArray(character.bank[pack])) snap[pack] = character.bank[pack].map(function (b) { return b ? { name: b.name, level: b.level, q: b.q } : null; }); bank_cache = snap; try { localStorage.setItem("lp_bank_cache_" + character.name, JSON.stringify(snap)); } catch (e) {} }
}
function all_copies(name) { // Inventar + Bank (bzw. letzter Bankstand), ohne getragene
    var out = [];
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name) out.push({ it: it, where: "inv", i: i }); }
    var bank = character.bank || bank_cache || {};
    for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; for (var k = 0; k < bank[pack].length; k++) { var b = bank[pack][k]; if (b && b.name == name) out.push({ it: b, where: pack, i: k }); } }
    out.sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    return out;
}
function dup_protected(it) {
    var def = G.items[it.name] || {};
    if (is_team_wish_item(it)) return true;
    if (it.p || it.stat_type || EVENT_ITEMS.test(it.name)) return true;
    if (def.compound) return (it.level || 0) < COMPOUND_SPARE_MAX || (it.level || 0) > COMPOUND_TARGET; // fertiger Schmuck: nur die Stufe(n) am Ziel zählen als Duplikate
    return (it.level || 0) > DUP_MAX_LEVEL || !def.upgrade;
}
function dup_keep_n(name) { return (G.items[name] || {}).compound ? 3 : dup_keep(name); }
var RESERVE_COPIES = 3; // Zielitems, die nicht beim NPC nachkaufbar sind: so viele Kopien als Reserve halten (Inventar + Bank)
function dup_keep(name) { // Zielitem: Reserven behalten; sonst eine Kopie
    if (on_wishlist(name)) return is_buyable(name) ? DUP_KEEP + 1 : RESERVE_COPIES;
    for (var g in goal_cache) { var t = goal_cache[g] && goal_cache[g].target; if (t && t.item == name) return DUP_KEEP + 1; }
    return DUP_KEEP;
}
function reserve_count(name) { var n = 0; all_copies(name).forEach(function (c) { n++; }); return n; } // ohne getragenes Teil
function reserve_wants(name, level, price) { // günstige Kopie eines nicht nachkaufbaren Zielitems als Reserve kaufen?
    var def = G.items[name]; if (!def || !on_wishlist(name) || is_buyable(name) || !def.upgrade) return false;
    var worn = false; for (var sl in character.slots) { var w = character.slots[sl]; if (w && w.name == name) worn = true; }
    if (!worn) return false; // Reserven nur für das, was getragen wird (das Zielitem selbst kauft die Wunschliste)
    if (reserve_count(name) >= RESERVE_COPIES) return false;
    var cap = Math.max(def.g * 3, 20000);
    return price <= cap && price <= Math.max(0, wish_budget());
}
function surplus_copies(name) { return all_copies(name).filter(function (c) { return !dup_protected(c.it); }).slice(dup_keep_n(name)); }
function duplicate_indices() { // Inventar-Indizes überzähliger Kopien
    var seen = {}, out = [];
    for (var i = 0; i < character.items.length; i++) {
        var it = character.items[i]; if (!it || seen[it.name] || dup_protected(it)) continue;
        seen[it.name] = true;
        surplus_copies(it.name).forEach(function (c) { if (c.where == "inv") out.push(c.i); });
    }
    return out;
}
async function sell_duplicates() { // im Laden stehen
    var idx = duplicate_indices(); if (!idx.length) return 0;
    var names = [];
    idx.sort(function (a, b) { return b - a; });
    for (var i = 0; i < idx.length; i++) { var it = character.items[idx[i]]; if (!it) continue; names.push(it.name + "+" + (it.level || 0)); await sell_measured(idx[i], 1); }
    game_log("Duplikate verkauft: " + names.join(", "));
    return idx.length;
}
// Lohnt sich Aufbewahrung (Inventar/Bank)? Sonst verkaufen.
function worth_keeping(it) {
    var def = G.items[it.name]; if (!def) return true;
    if (is_team_wish_item(it)) return true;
    if (HP_JEWELRY.test(it.name)) return false;
    if (on_wishlist(it.name)) return true;
    if (should_keep(it)) return true;
    if (def.e || def.type == "gem" || def.type == "quest" || def.type == "token" || def.type == "box" || def.type == "material" || def.type == "cscroll" || def.type == "uscroll" || def.type == "pscroll") return true;
    if (EVENT_ITEMS.test(it.name) || /^slice_|cake|gift/i.test(it.name)) return true;
    if ((it.level || 0) >= KEEP_MIN_LEVEL || (def.g || 0) >= KEEP_MIN_VALUE || it.stat_type) return true;
    if (def.compound && ((it.level || 0) >= 1 || find_inv_indices(it.name, it.level || 0).length >= 3)) return true;
    for (var sl in goal_cache) { var t = goal_cache[sl] && goal_cache[sl].target; if (t && t.item == it.name) return true; }
    if (bought_recently(it.name)) return true;
    return false;
}
function should_keep(it) { return is_team_wish_item(it) || (equipped_names()[it.name] && ((it.level || 0) > 0 || !is_buyable(it.name))) || (G.items[it.name] && G.items[it.name].compound && (equipped_names()[it.name] || find_inv_indices(it.name, it.level || 0).length >= 3)) || KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name) || EVENT_ITEMS.test(G.items[it.name] && G.items[it.name].name || ""); }
var tidy_next = 0;
// ---------- Priester ausrüsten: überzählige Teile des Magiers, die für ihn besser sind ----------
var last_priest_gear = 0;
function fits_class(def, ctype, slot) { // wie fits_slot, für eine andere Klasse
    var t = SLOT_TYPES[slot]; if (!t || !def) return false;
    if (def.class && def.class.indexOf(ctype) < 0) return false;
    var cl = G.classes[ctype] || {};
    if (t == "weapon") return !!def.wtype && (cl.mainhand || {})[def.wtype];
    if (t == "offhand") return (cl.offhand || {})[def.type];
    return def.type == t;
}
function spare_for_priest(key) { // [{i, slot, gain}] – Inventarteile, die der Magier entbehren kann und die das Teammitglied verbessern
    key = key || "priest"; var ctype = TEAM_CTYPE[key];
    var st = team_state[TEAM[key]]; if (!st || !st.slots) return [];
    var out = [], used = {};
    var slots = ["mainhand", "offhand", "helmet", "chest", "pants", "shoes", "gloves", "cape", "ring1", "ring2", "earring1", "earring2", "amulet", "belt", "orb"];
    slots.forEach(function (slot) {
        var worn = st.slots[slot], ws = worn && G.items[worn.name] ? gear_score(G.items[worn.name], worn.level || 0) : 0, best = null;
        for (var i = 0; i < character.items.length; i++) {
            var it = character.items[i]; if (!it || used[i]) continue; var def = G.items[it.name]; if (!def || !fits_class(def, ctype, slot)) continue;
            if (KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name) || is_team_wish_item(it)) continue;
            if (on_wishlist(it.name)) { // Zielbau-Teil des Magiers
                if (def.compound) { // Schmuck: Kopien nur abgeben, wenn alle Slots mit diesem Teil ihr Ziel erreicht haben (dann ist das Compound-Material übrig)
                    var all_done = true, any = false; for (var sl2 in SLOT_TYPES) { var w2 = character.slots[sl2]; if (w2 && w2.name == it.name) { any = true; if ((w2.level || 0) < wish_level(sl2)) all_done = false; } }
                    if (!any || !all_done) continue;
                } else {
                    var copies = 0; for (var c = 0; c < character.items.length; c++) if (character.items[c] && character.items[c].name == it.name) copies++; if (copies <= RESERVE_COPIES || i == backup_index(it.name)) continue;
                }
            }
            if (equipped_names()[it.name] && i == backup_index(it.name)) continue; // beste Reserve des Getragenen bleibt
            var sc = gear_score(def, it.level || 0); if (sc <= ws * 1.05 || sc <= 0) continue;
            if (!best || sc > best.sc) best = { i: i, slot: slot, sc: sc, gain: sc - ws };
        }
        if (best) { used[best.i] = true; out.push(best); }
    });
    return out;
}
var gear_turn = 0;
function priest_gear_tick() { // alle 2 min: steht Priester/Ranger neben uns, bekommt er bessere Teile (abwechselnd)
    if (Date.now() - last_priest_gear < 2 * 60000 || busy || handing || upgrading || paused) return; last_priest_gear = Date.now();
    var keys = ["priest", "ranger"].filter(function (k) { return team_on[k]; }); if (!keys.length) return;
    var key = keys[gear_turn++ % keys.length], nm = TEAM[key], lab = TEAM_LABEL[key];
    var p = get_player(nm); if (!p || p.rip || p.map != character.map || distance(character, p) > 350) return;
    var list = spare_for_priest(key); if (!list.length) return;
    list.sort(function (a, b) { return a.i - b.i; });
    (async function () { for (var k = list.length - 1; k >= 0; k--) { var g = list[k], it = character.items[g.i]; if (!it) continue; try { team_send(nm, { t: "gear", name: it.name, level: it.level || 0, slot: g.slot }); send_item(nm, g.i, 1); game_log("[" + lab + "] bekommt " + it.name + "+" + (it.level || 0) + " für " + g.slot + " (+" + Math.round(g.gain) + " Wert)"); } catch (e) { game_log("Team-Ausrüstung: " + err_txt(e)); } await sleep(400); } })();
}
var last_energize = 0;
function energize_tick() { // Mana an den Ranger, wenn er leer läuft und wir genug haben
    if (!team_on.ranger || Date.now() - last_energize < 5000 || character.mp < character.max_mp * 0.5) return;
    var st = team_state[TEAM.ranger]; if (!st || Date.now() - st.t > 60000 || !(st.mp_pct < 0.35)) return;
    var r = get_player(TEAM.ranger); if (!r || r.rip || r.map != character.map || distance(character, r) > ((G.skills.energize && G.skills.energize.range) || 320)) return;
    try { if (can_use("energize")) { last_energize = Date.now(); use_skill("energize", r); } } catch (e) {}
}
// ---------- Stufe 2: Händler holt Loot ab (statt Stadtgang des Magiers) ----------
var handing = false, last_pickup = 0, pickup_state = null; // pickup_state: {t, ready, done}
function merchant_available() { // Händler läuft, meldet sich, lebt, ist nicht gerade selbst unterwegs mit einer Abholung
    if (!team_on.merch || !team_running(TEAM.merch) || arb_job) return false;
    var st = team_state[TEAM.merch]; if (!st || Date.now() - st.t > 90000) return false;
    if (st.state == "tot" || /Abholung|verkauft|Bank/.test(st.state || "")) return false;
    return Date.now() - last_pickup > 3 * 60000;
}
function handover_plan() { // was der Händler mitnehmen soll: [{i, action}] – sell / bank / stand
    var out = [], eq = equipped_names(), dups = duplicate_indices();
    for (var i = 0; i < character.items.length; i++) {
        var it = character.items[i]; if (!it || it.name.indexOf("stand") == 0) continue;
        if (merch_needs[it.name]) { out.push({ i: i, action: "bank", name: it.name, level: it.level || 0, q: it.q || 1 }); continue; } // vom Händler angefragt (behält, was er braucht)
        if (KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name)) continue;
        var def = G.items[it.name]; if (!def) continue;
        var action = null;
        if (is_junk(it) || (!worth_keeping(it) && !eq[it.name]) || dups.indexOf(i) >= 0) action = "sell";
        else if (!should_keep(it)) action = "bank";
        else if (bankable_extra(it, i)) action = "bank";
        if (!action) continue;
        if (action == "sell" && !on_wishlist(it.name) && npc_value(it.name, it.level) >= 15000 && (def.upgrade || def.compound)) action = "stand"; // Wertvolles am Stand zu Spielerpreisen anbieten
        out.push({ i: i, action: action, name: it.name, level: it.level || 0, q: it.q || 1 });
    }
    return out;
}
async function merchant_pickup(reason) { // Händler rufen, Items übergeben, Tränke entgegennehmen; false = nicht geklappt (dann alter Stadtgang)
    if (handing) return false;
    handing = true; busy = true; last_pickup = Date.now();
    var ok = false;
    try {
        var need_hp = Math.max(0, 150 - pots_total(POTS_HP)), need_mp = Math.max(0, 150 - pots_total(POTS_MP));
        var plan = handover_plan();
        pickup_state = { t: Date.now(), ready: false, done: false };
        var mbj = merch_buy && (merch_buy.stage == "calling" || merch_buy.stage == "fetching") ? merch_buy : null;
        team_send(TEAM.merch, { t: "pickup", reason: reason, buy: mbj && mbj.stage == "calling" && mbj.kind != "sell" ? Object.assign({}, mbj.o, { id: mbj.id, q: mbj.q, mode: mbj.mode }) : null, sellreq: mbj && mbj.stage == "calling" && mbj.kind == "sell" ? Object.assign({}, mbj.o, { id: mbj.id, q: mbj.q, mode: mbj.mode }) : null, fetch: mbj && mbj.stage == "fetching" ? [{ name: mbj.o.name, level: mbj.o.level }] : null, items: plan.length, pots: { hp: need_hp >= 30 ? need_hp : 0, mp: need_mp >= 30 ? need_mp : 0, hp_t: pick_pot_tier(POTS_HP), mp_t: pick_pot_tier(POTS_MP) }, team_pots: team_pots_need(), map: character.map, x: Math.round(character.x), y: Math.round(character.y) });
        game_log("Händler gerufen (" + reason + "): " + plan.length + " Items" + (need_hp >= 30 || need_mp >= 30 ? ", Tränke " + need_hp + "/" + need_mp : ""));
        set_message("Händler kommt");
        var t0 = Date.now(), m = null;
        while (Date.now() - t0 < 4 * 60000 && !character.rip) { // warten, bis er neben uns steht (weiter kämpfen tut der Magier in der Zeit nicht – er steht)
            m = get_player(TEAM.merch); if (m && m.map == character.map && distance(character, m) < 300 && pickup_state.ready) break;
            if (paused) throw "PAUSE";
            await sleep(500);
        }
        if (!(m && m.map == character.map && distance(character, m) < 300)) { game_log("Händler nicht angekommen – mache den Stadtgang selbst"); team_send(TEAM.merch, { t: "pickup_cancel" }); return false; }
        // Übergabe: erst Ansage, dann Item
        var given = 0, plan2 = handover_plan(); // frisch, Indizes können sich verschoben haben
        for (var k = 0; k < plan2.length; k++) {
            var p = plan2[k], it = character.items[p.i]; if (!it || it.name != p.name) continue;
            team_send(TEAM.merch, { t: "item", name: p.name, level: p.level, q: p.q, action: p.action });
            try { send_item(TEAM.merch, p.i, p.q); given++; } catch (e) { game_log("Übergabe " + p.name + ": " + err_txt(e)); }
            await sleep(350);
            var mm = get_player(TEAM.merch); if (!mm || mm.map != character.map || distance(character, mm) > 350) { game_log("Händler weg – Übergabe abgebrochen"); break; }
        }
        if (mbj && mbj.stage == "calling" && mbj.kind == "sell" && merch_buy && merch_buy.id == mbj.id) { var left = mbj.q, sent = 0; for (var si = 0; si < character.items.length && left > 0; si++) { var sit = character.items[si]; if (!sit || sit.name != mbj.o.name || (sit.level || 0) != (mbj.o.level || 0)) continue; var sq = Math.min(left, sit.q || 1); team_send(TEAM.merch, { t: "item", name: sit.name, level: sit.level || 0, q: sq, action: "hold" }); try { send_item(TEAM.merch, si, sq); sent += sq; left -= sq; } catch (e) { game_log("Verkauf: Übergabe fehlgeschlagen – " + err_txt(e)); break; } await sleep(400); } if (sent) { mbj.item_sent = true; mb_save(); game_log("Verkauf: " + sent + "× " + mbj.o.name + " an den Händler übergeben"); } }
        if (mbj && mbj.stage == "calling" && mbj.kind != "sell" && merch_buy && merch_buy.id == mbj.id) { try { send_gold(TEAM.merch, mbj.gold); mbj.gold_sent = true; mb_save(); game_log("Einkauf: " + fmt(mbj.gold) + " Gold an den Händler übergeben"); } catch (e) { game_log("Einkauf: Gold-Übergabe fehlgeschlagen – " + err_txt(e)); } await sleep(400); }
        // Gold-Überschuss vom Händler kommt von selbst (er schickt); wir melden fertig
        team_send(TEAM.merch, { t: "done", given: given });
        game_log("Übergabe an Händler: " + given + " Items – frei jetzt " + character.esize);
        var t1 = Date.now(); while (Date.now() - t1 < 8000 && !pickup_state.done) await sleep(300); // Tränke/Gold entgegennehmen
        ok = true;
    } catch (e) { if (e != "PAUSE") game_log("Abholung: " + err_txt(e)); }
    handing = false; busy = false; pickup_state = null;
    return ok;
}
var tidy_force = false, give_done = {}; // Button: kompletter Durchgang unabhängig vom Füllstand
async function tidy_inventory() {
    var min_free = focus_mode ? FOCUS_MIN_FREE : INV_MIN_FREE;
    if (busy || upgrading || paused || (!tidy_force && (character.esize >= min_free || Date.now() < tidy_next))) return;
    if (!tidy_force && merchant_available()) { // Stufe 2: Händler holt ab, Magier bleibt am Spot
        var done = await merchant_pickup("Inventar voll");
        if (done) { if (character.esize < min_free) tidy_next = Date.now() + 5 * 60000; return; }
    }
    busy = true;
    var free_before = character.esize, target_free = tidy_force ? 99 : focus_mode ? FOCUS_TARGET_FREE : INV_TARGET_FREE;
    try {
        // 1. verkaufen (im Fokus-Modus auf jeden Fall zum Händler: dort werden auch die Tränke aufgefüllt)
        var junk = [];
        for (var i = 0; i < character.items.length; i++) { var jt = character.items[i]; if (jt && (is_junk(jt) || (!worth_keeping(jt) && !equipped_names()[jt.name]))) junk.push(i); }
        var dups = duplicate_indices();
        if (junk.length || dups.length || focus_mode) {
            set_message("Verkaufen"); await travel_place("potions");
            for (var j = 0; j < junk.length; j++) { var it = character.items[junk[j]]; if (!it) continue; await sell_measured(junk[j], it.q || 1); }
            if (junk.length) game_log("Inventar: " + junk.length + " Schrott-Items verkauft");
            await sell_duplicates();
            if (focus_mode) { try { var hp_t = pick_pot_tier(POTS_HP), mp_t = pick_pot_tier(POTS_MP), pp = G.items[hp_t].g + G.items[mp_t].g, need = Math.max(0, 150 - Math.min(pots_total(POTS_HP), pots_total(POTS_MP))), amt = Math.min(need, Math.floor((spendable() * 0.7) / pp)); if (amt >= 10) { buy(hp_t, amt); buy(mp_t, amt); await sleep(500); game_log("Tränke aufgefüllt: " + amt + " " + hp_t + " / " + amt + " " + mp_t); } } catch (e) { game_log("Tränke: " + err_txt(e)); } }
        }
        // 2. Schmuck-Dreiergruppen compounden, wenn wir eh unterwegs sind (nicht im Fokus-Modus: Stadtgang kurz halten)
        if (!focus_mode && character.esize < target_free && has_compound_triples()) { try { await compound_spares(); } catch (e) { if (e == "PAUSE") throw e; } }
        // 3. Rest in die Bank (vorher: Teile für leere Slots zurückholen) – so lange, bis INV_TARGET_FREE Plätze frei sind
        if (character.esize < target_free) {
            set_message("Bank"); await travel_place("bank"); await sleep(800);
            await retrieve_for_empty_slots();
            try { await retrieve_better_from_bank(); } catch (e) {}
            var n = 0;
            for (var k = 0; k < character.items.length; k++) {
                var it2 = character.items[k]; if (!it2 || should_keep(it2)) continue;
                bank_store(k); n++; await sleep(300);
            }
            // reicht noch nicht: auch wartenden Schmuck (Einzelstücke/Paare) und überzählige Reserven einlagern
            var extra = 0;
            if (character.esize < target_free) {
                var order = [];
                for (var k2 = 0; k2 < character.items.length; k2++) { var it3 = character.items[k2]; if (it3 && bankable_extra(it3, k2)) order.push({ i: k2, r: extra_rank(it3) }); }
                order.sort(function (a, b) { return a.r - b.r; });
                for (var o = 0; o < order.length && character.esize < target_free; o++) { bank_store(order[o].i); extra++; await sleep(300); }
            }
            try { bank_status_log(); } catch (e) {}
            game_log("Inventar: " + (n + extra) + " Items in die Bank gelegt" + (extra ? " (davon " + extra + " Schmuck/Reserven)" : "") + " – frei: " + character.esize + (bank_free_slots() < BANK_MIN_FREE ? ", Bank fast voll (" + bank_free_slots() + ")" : ""));
            if (bank_free_slots() < BANK_MIN_FREE) await bank_cleanup();
        }
    } catch (e) { game_log("Inventar-Fehler: " + err_txt(e)); }
    if (character.esize < min_free) { tidy_next = Date.now() + 5 * 60000; if (character.esize <= free_before) game_log("Inventar bleibt voll (" + character.esize + " frei) – nächster Versuch in 5 min"); }
    busy = false;
}

// Was darf zusätzlich in die Bank, wenn es eng wird? (bleibt sonst zum Compounden/als Reserve im Inventar)
function has_compound_triples() {
    var g = {};
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || it.p || it.stat_type || HP_JEWELRY.test(it.name)) continue; var def = G.items[it.name]; if (!def || !def.compound || (it.level || 0) >= COMPOUND_SPARE_MAX) continue; var k = it.name + "/" + (it.level || 0); g[k] = (g[k] || 0) + 1; if (g[k] >= 3) return true; }
    return false;
}
function bankable_extra(it, idx) {
    var def = G.items[it.name]; if (!def || KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name)) return false;
    var eq = equipped_names();
    if (def.compound) {
        if (!eq[it.name]) return true;                                   // ungetragener Schmuck (wartet auf Dreiergruppe)
        var same = find_inv_indices(it.name, it.level || 0);             // Kopien des getragenen Schmucks: 3 je Stufe bleiben (ein Compound-Satz), Rest in die Bank
        return same.indexOf(idx) >= 3;
    }
    if (eq[it.name] && def.upgrade) return true; // Reserven des Getragenen: alle in die Bank (werden bei Bedarf geholt)
    return false;
}
function extra_rank(it) { var def = G.items[it.name] || {}; return def.compound ? (it.level || 0) : 10 + (it.level || 0); } // niedrige Stufen zuerst weg
// ---------- Bank aufräumen: Schrott zurückholen und verkaufen ----------
function bank_free_slots() { var bank = character.bank || {}, free = 0, any = false; for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; any = true; bank[pack].forEach(function (it) { if (!it) free++; }); } return any ? free : 999; }
var bank_cleaning = false;
async function bank_cleanup() { // muss in der Bank stehen (oder läuft hin)
    if (bank_cleaning) return; bank_cleaning = true;
    try {
        if (character.map != "bank") { set_message("Bank"); await travel_place("bank"); await sleep(800); }
        var rounds = 0, sold_total = 0;
        while (rounds++ < 6) {
            var bank = character.bank || {}, pulled = 0;
            for (var pack in bank) {
                if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
                for (var i = 0; i < bank[pack].length && character.esize > 2; i++) {
                    var it = bank[pack][i]; if (!it) continue;
                    var is_dup = !dup_protected(it) && surplus_copies(it.name).some(function (c) { return c.where == pack && c.i == i; });
                    if (!is_dup && (worth_keeping(it) || equipped_names()[it.name])) continue;
                    try { bank_retrieve(pack, i); pulled++; await sleep(350); } catch (e) {}
                }
            }
            if (!pulled) break;
            set_message("Verkaufen"); await travel_place("potions");
            var sold = 0;
            for (var k = 0; k < character.items.length; k++) { var jt = character.items[k]; if (jt && !worth_keeping(jt) && !equipped_names()[jt.name]) { await sell_measured(k, jt.q || 1); sold++; } }
            sold += await sell_duplicates();
            sold_total += sold;
            game_log("Bank aufräumen: " + pulled + " geholt, " + sold + " verkauft");
            await travel_place("bank"); await sleep(800);
        }
        game_log("Bank aufgeräumt: " + sold_total + " Items verkauft, frei jetzt " + bank_free_slots() + " Plätze");
        // Schmuck: Dreiergruppen aus Bank + Inventar zusammenziehen und compounden (spart 2 Plätze je Gruppe)
        try { await bank_compound_jewelry(); } catch (e) { if (e == "PAUSE") throw e; game_log("Schmuck-Compound-Fehler: " + err_txt(e)); }
        // übrig gebliebene Dreiergruppen compounden, danach Einzelstücke verkaufen
        try { await compound_spares(); } catch (e) {}
        var rest = 0;
        for (var r2 = 0; r2 < character.items.length; r2++) { var it2 = character.items[r2]; if (it2 && G.items[it2.name] && G.items[it2.name].compound && !equipped_names()[it2.name] && (it2.level || 0) == 0 && find_inv_indices(it2.name, 0).length < 3) rest++; }
        try { await bank_sort(); } catch (e) {}
        if (rest) { await travel_place("potions"); for (var r3 = 0; r3 < character.items.length; r3++) { var it3 = character.items[r3]; if (it3 && G.items[it3.name] && G.items[it3.name].compound && !equipped_names()[it3.name] && (it3.level || 0) == 0 && find_inv_indices(it3.name, 0).length < 3) { await sell_measured(r3, 1); } } game_log("Übrige Schmuck-Einzelstücke verkauft: " + rest); }
    } catch (e) { game_log("Bank-Aufräum-Fehler: " + err_txt(e)); }
    bank_cleaning = false;
}
async function bank_compound_jewelry() { // muss in der Bank stehen
    for (var round = 0; round < 4; round++) {
        var eq = equipped_names(), cnt = {}, bank = character.bank || {};
        var tally = function (it) { var def = G.items[it.name]; if (!def || !def.compound || it.p || it.stat_type || HP_JEWELRY.test(it.name) || (it.level || 0) >= COMPOUND_SPARE_MAX) return null; var k = it.name + "/" + (it.level || 0); cnt[k] = (cnt[k] || 0) + 1; return k; };
        character.items.forEach(function (it) { if (it) tally(it); });
        var in_bank = [];
        for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; for (var i = 0; i < bank[pack].length; i++) { var b = bank[pack][i]; if (!b) continue; var k = tally(b); if (k) in_bank.push({ pack: pack, i: i, k: k }); } }
        var groups = Object.keys(cnt).filter(function (k) { return cnt[k] >= 3; });
        if (!groups.length) { if (round == 0) game_log("Bank: keine Schmuck-Dreiergruppen"); return; }
        // Kopien aus der Bank holen, bis je Gruppe 3n im Inventar liegen
        var pulled = 0;
        for (var g = 0; g < groups.length; g++) {
            var k = groups[g], name = k.split("/")[0], lvl = parseInt(k.split("/")[1]);
            var want = Math.floor(cnt[k] / 3) * 3 - find_inv_indices(name, lvl).length;
            var src = in_bank.filter(function (x) { return x.k == k; }).sort(function (a, b) { return a.pack == b.pack ? b.i - a.i : (a.pack < b.pack ? 1 : -1); }); // von hinten holen, damit Indizes stabil bleiben
            for (var j = 0; j < src.length && want > 0 && character.esize > 2; j++) { try { bank_retrieve(src[j].pack, src[j].i); pulled++; want--; await sleep(350); } catch (e) {} }
        }
        if (!has_compound_triples()) return;
        game_log("Bank: " + pulled + " Schmuckteile geholt, compounde " + groups.join(", "));
        await compound_spares();
        await travel_place("bank"); await sleep(800);
        // Ergebnisse und Reste zurück in die Bank, wenn das Inventar eng wird
        for (var r = character.items.length - 1; r >= 0 && character.esize < INV_TARGET_FREE; r--) { var it = character.items[r]; if (it && bankable_extra(it, r)) { try { bank_store(r); await sleep(300); } catch (e) {} } }
    }
}
// ---------- Bank sortieren ----------
function bank_status_log() { // alle Bankfächer: Karte, Belegung, freigeschaltet oder Preis
    var bp = null; try { bp = parent.bank_packs || (parent.G && parent.G.bank_packs) || (typeof bank_packs != "undefined" ? bank_packs : null); } catch (e) {} var bk = (character.bank && typeof character.bank == "object") ? character.bank : (bank_cache || {}), lines = [], total = 0, free = 0;
    var keys = bp ? Object.keys(bp) : Object.keys(bk).filter(function (k) { return k.indexOf("items") == 0; });
    keys.sort(function (a, b) { return parseInt(a.replace("items", "")) - parseInt(b.replace("items", "")); }).forEach(function (k) {
        var meta = bp && bp[k], arr = bk[k];
        if (Array.isArray(arr)) { var used = arr.filter(function (x) { return !!x; }).length; total += arr.length; free += arr.length - used; lines.push(k + " (" + (meta ? meta[0] : "?") + "): " + used + "/" + arr.length); }
        else lines.push(k + " (" + (meta ? meta[0] : "?") + "): gesperrt" + (meta ? ", " + fmt(meta[1]) + " Gold" : ""));
    });
    game_log("Bank: " + (character.bank ? "" : "(letzter Stand, nicht in der Bank) ") + free + " von " + total + " Plätzen frei · " + (lines.length ? lines.join(" · ") : "keine Fächer bekannt (Preisliste " + (bp ? "da" : "fehlt") + ", Bankdaten " + (Object.keys(bk).length ? "da" : "fehlen") + ")"));
}
function bank_packs() { var b = character.bank || {}; return Object.keys(b).filter(function (k) { return k.indexOf("items") == 0 && Array.isArray(b[k]); }).sort(); }
function bank_item_key(it) { return [inv_rank(it), it.name, -(it.level || 0)]; }
function bank_cmp(a, b) { var ka = bank_item_key(a), kb = bank_item_key(b); for (var i = 0; i < 3; i++) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; }
async function bank_sort() {
    if (character.map != "bank") { set_message("Bank"); await travel_place("bank"); await sleep(800); }
    var packs = bank_packs(); if (!packs.length) { game_log("Bank: keine Daten"); return; }
    var ops = 0, moves = 0;
    // Zielreihenfolge
    var all = [];
    packs.forEach(function (p) { character.bank[p].forEach(function (it, i) { if (it) all.push({ it: it, pack: p, i: i }); }); });
    all.sort(function (a, b) { return bank_cmp(a.it, b.it); });
    var slots_per = character.bank[packs[0]].length;
    for (var pos = 0; pos < all.length && ops < 400; pos++) {
        check_pause();
        var tp = packs[Math.floor(pos / slots_per)], ts = pos % slots_per; if (!tp) break;
        // aktuelles Item an Zielposition? (frisch aus character.bank)
        var cur = character.bank[tp][ts], want = all[pos].it;
        var same = function (a, b) { return a && b && a.name == b.name && (a.level || 0) == (b.level || 0) && (a.q || 1) == (b.q || 1); };
        if (same(cur, want)) continue;
        // wo liegt das gewünschte Item jetzt? (erstes passendes ab Zielposition)
        var src = null;
        for (var pi = 0; pi < packs.length && !src; pi++) for (var si = 0; si < slots_per; si++) { var gp = pi * slots_per + si; if (gp < pos) continue; var cand = character.bank[packs[pi]][si]; if (same(cand, want)) { src = { pack: packs[pi], i: si }; break; } }
        if (!src) continue;
        try {
            if (src.pack == tp) { bank_swap(tp, ts, src.i); ops++; }
            else {
                if (character.esize < 2) { game_log("Bank sortieren: Inventar zu voll"); break; }
                var before = character.esize;
                if (cur) { bank_retrieve(tp, ts); await sleep(350); }
                bank_retrieve(src.pack, src.i); await sleep(350);
                var di = -1; for (var k = character.items.length - 1; k >= 0; k--) { if (same(character.items[k], want)) { di = k; break; } }
                if (di >= 0) { bank_store(di, tp, ts); await sleep(350); }
                if (cur) { var ci = -1; for (var k2 = character.items.length - 1; k2 >= 0; k2--) { if (same(character.items[k2], cur)) { ci = k2; break; } } if (ci >= 0) { bank_store(ci, src.pack, src.i); await sleep(350); } }
                ops += 2; moves++;
            }
            await sleep(250);
        } catch (e) { game_log("Bank sortieren Fehler: " + err_txt(e)); break; }
    }
    game_log("Bank sortiert (" + ops + " Schritte, " + moves + " Reiterwechsel)");
}
async function bank_sort_now() {
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal"); return; }
    unpause("Bank sortieren"); busy = true;
    try { await bank_sort(); } catch (e) { game_log(e == "PAUSE" ? "Sortieren abgebrochen" : "Fehler: " + err_txt(e)); } finally { busy = false; }
    after_action("Bank sortieren");
}
async function bank_cleanup_now() {
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal"); return; }
    unpause("Bank aufräumen"); busy = true;
    try { await bank_cleanup(); } finally { busy = false; }
    after_action("Bank aufräumen");
}

// ---------- Notfall-Rückzug ----------
var fleeing = false;
function attackers_on_me() {
    var n = 0;
    for (var id in parent.entities) { var e = parent.entities[id]; if (e && e.type == "monster" && !e.dead && e.target == character.name) n++; }
    return n;
}
var flee_log = {}; // Spot -> Zeitpunkte der Rückzüge (für die Sperre)
function note_retreat() { // 3 Rückzüge wegen niedriger HP (≤50 %) am selben Spot in 10 min -> Spot 30 min sperren (Jagd: übersprungen)
    if (character.hp > character.max_hp * 0.5) return; // Rückzug mit noch viel HP (Boss in Sicht o. ä.) zählt nicht
    var m = pick_farm_monster(); if (!m) return;

    var now = Date.now(), arr = (flee_log[m] || []).filter(function (t) { return now - t < 10 * 60000; }); arr.push(now); flee_log[m] = arr;
    if (arr.length < 3) return;
    flee_log[m] = [];
    if (hunt_spot == m) { game_log("3 Rückzüge (HP zu niedrig) bei " + m + " in 10 min – Jagd wird übersprungen, Monster 30 min gesperrt"); hunt_skipped = m; hunt_reset(LEVELED_BLOCK_MS); try { var q = mh_quest(); hunt_cooldown_until = Date.now() + ((q && q.ms) || 1800000); } catch (e) {} return; }
    blocked_spots[m] = now + LEVELED_BLOCK_MS; need_repick = true; meas = null;
    game_log("3 Rückzüge (HP zu niedrig) bei " + m + " in 10 min – Spot 30 min " + (manual_spot == m ? "ausgesetzt, solange wählt die Automatik" : "gesperrt"));
}
async function check_flee() {
    if (fleeing || paused || upgrading || kissing) return;
    var hp = character.hp / character.max_hp;
    var n = attackers_on_me();
    var strong = false, oneshot = false; for (var sid in parent.entities) { var se = parent.entities[sid]; if (se && se.type == "monster" && !se.dead && se.target == character.name && too_strong(se)) { strong = true; if ((se.attack || (G.monsters[se.mtype] || {}).attack || 0) >= character.max_hp * 0.5) oneshot = true; break; } }
    if (!strong && !event_mode) { for (var bid2 in parent.entities) { var be = parent.entities[bid2]; if (be && be.type == "monster" && !be.dead && (G.monsters[be.mtype] || {}).boss && distance(character, be) < 350 && (be.attack || (G.monsters[be.mtype] || {}).attack || 0) >= character.max_hp * 0.3) { strong = true; oneshot = true; game_log("Boss " + be.mtype + " in der Nähe – weg hier"); break; } } } // Event-/Weltbosse (Icegolem usw.) nicht abwarten
    if (strong && (hp < 0.8 || oneshot)) {
        fleeing = true; busy = true; if (!event_mode) note_retreat();
        var pr = null; try { pr = team_on.priest ? get_player(TEAM.priest) : null; } catch (e) {}
        var pst = team_state[TEAM.priest], priest_ok = pr && !pr.rip && pst && Date.now() - pst.t < 60000 && pr.map == character.map && distance(character, pr) < 400;
        if (priest_ok) { // Heiler in der Nähe: zu ihm laufen und dort hochheilen lassen, statt in die Stadt
            game_log("Zu starker Angreifer – Rückzug zum Priester (HP " + Math.round(hp * 100) + "%)");
            try { stop("smart"); change_target(null); team_send(TEAM.priest, { t: "help" }); var t0 = Date.now(); while (Date.now() - t0 < 15000 && !character.rip && character.hp < character.max_hp * 0.9) { var p2 = get_player(TEAM.priest); if (p2 && p2.map == character.map) { var dx = character.x - p2.x, dy = character.y - p2.y, dd = Math.hypot(dx, dy) || 1; if (dd > 60) move(p2.x + dx / dd * 40, p2.y + dy / dd * 40); } await sleep(400); } } catch (e) {}
            var still = false; for (var sid2 in parent.entities) { var se2 = parent.entities[sid2]; if (se2 && se2.type == "monster" && !se2.dead && se2.target == character.name && too_strong(se2)) { still = true; break; } }
            if (character.hp >= character.max_hp * 0.6 && !character.rip) { fleeing = false; busy = false; if (still) { need_repick = true; game_log("Angreifer noch da – Spot wechseln"); } return; }
            game_log("Priester reicht nicht – Rückzug in die Stadt");
        } else game_log("Zu starker Angreifer – sofortiger Rückzug (HP " + Math.round(hp * 100) + "%)");
        try { stop("smart"); change_target(null); await travel_place("town"); while (character.hp < character.max_hp * 0.9 && !character.rip) await sleep(1000); } catch (e) {} fleeing = false; busy = false; return;
    }

    if (n < FLEE_ATTACKERS || hp > KITE_HP) return;
    fleeing = true; busy = true; if (!event_mode) note_retreat();
    try {
        if (hp > FLEE_HP) {
            // Kiten: vom Schwarm wegziehen, heilen, zurück
            game_log("Zurückweichen: HP " + Math.round(hp * 100) + "%, " + n + " Angreifer");
            set_message("ZURÜCK");
            stop("smart");
            var t0 = Date.now();
            while (Date.now() - t0 < 20000 && !character.rip) {
                var cx = 0, cy = 0, k = 0;
                for (var id in parent.entities) { var e = parent.entities[id]; if (e && e.type == "monster" && !e.dead && e.target == character.name) { cx += e.x; cy += e.y; k++; } }
                if (!k || character.hp / character.max_hp > 0.7) break;
                cx /= k; cy /= k;
                var dx = character.x - cx, dy = character.y - cy, d = Math.hypot(dx, dy) || 1;
                var tx = character.x + dx / d * 150, ty = character.y + dy / d * 150;
                if (can_move_to(tx, ty)) move(tx, ty); else move(character.x - dx / d * 150, character.y - dy / d * 150);
                await sleep(500);
            }
            if (character.hp / character.max_hp > FLEE_HP) { fleeing = false; busy = false; return; }
        }
        game_log("Rückzug in die Stadt! HP " + Math.round(character.hp / character.max_hp * 100) + "%");
        set_message("RÜCKZUG");
        stop("smart");
        await travel_place("town");
        while (character.hp < character.max_hp * 0.8 && !character.rip) await sleep(1000);
        game_log("Erholt, zurück zum Spot");
    } catch (e) {}
    fleeing = false; busy = false;
}

// ---------- 10-Jahre-Event: Kuss-Runde ----------
var kiss_done_round = null, kissing = false, kiss_fail_round = null;
try { kiss_done_round = JSON.parse(localStorage.getItem("lp_kiss_done") || "null"); } catch (e) {}
function kiss_mark_done(round) { kiss_done_round = round; try { localStorage.setItem("lp_kiss_done", JSON.stringify(round)); } catch (e) {} }
function kiss_buff_active() { return !!(character.s && character.s.anniversary_kiss); }
function anniv() { return parent.S && parent.S.anniversary; }
// ---------- Sixfold Cake: 6 Stücke + 100k bei Mira ----------
function missing_slices() { return SLICES.filter(function (n) { return quantity(n) < 1; }); }
var cake_next = rt("cake_next", 0), baking = false;
async function check_cake() {
    if (baking || busy || upgrading || kissing || fleeing || exchanging || paused || Date.now() < cake_next) return;
    if (!anniv() || !anniv().active || !G.craft.sixcake) return;
    if (missing_slices().length || spendable() < CAKE_CRAFT_COST || character.esize < 1) return;
    baking = true; busy = true; cake_next = Date.now() + 10 * 60000;
    try {
        var npc = find_npc("anniversary_baker"); if (!npc) throw "Mira nicht gefunden";
        set_message("Kuchen backen"); await travel({ map: npc.map, x: npc.x, y: npc.y + 20 });
        var before = quantity("sixcake");
        try { auto_craft("sixcake"); } catch (e) { throw "craft: " + err_txt(e); }
        await sleep(2500);
        if (quantity("sixcake") > before) game_log("Sixfold Cake gebacken (" + quantity("sixcake") + " im Inventar) – Tausch per G");
        else game_log("Kuchen backen hat nicht geklappt (Stücke " + (6 - missing_slices().length) + "/6, Gold " + fmt(character.gold) + ")");
    } catch (e) { game_log("Kuchen-Fehler: " + err_txt(e)); }
    busy = false; baking = false;
}
function kiss_round_open() {
    var a = anniv();
    if (!KISS_ENABLED || !a || !a.active || !a.live || !a.target || a.available === false) return false;
    if (a.round == kiss_done_round || a.round == kiss_fail_round) return false;
    if (kiss_buff_active() && a.live && (a.expires || 0) - Date.now() > 20 * 60000 - 60000) return false; // Buff frisch = diese Runde schon belohnt
    if (a.expires && Date.now() > a.expires - 15000) return false;
    return true;
}
async function kiss_routine() {
    if (SOLO || kissing || upgrading || fleeing || busy || marketing || server_trip || !kiss_round_open()) return; // nicht während Kauf/Routine/Serverreise
    var a = anniv(); var round = a.round, name = a.target;
    kissing = true; busy = true;
    game_log("Kuss-Runde " + round + ": laufe zu " + name + " (" + a.map + " " + a.x + "," + a.y + ")");
    try { ["priest", "ranger", "merch"].forEach(function (k) { if (team_on[k] && team_running(TEAM[k])) team_send(TEAM[k], { t: "kiss", name: name, map: a.map, x: a.x, y: a.y, round: round, expires: a.expires || 0 }); }); } catch (e) {}
    set_message("Kuss: " + name);
    try {
        stop("smart");
        await travel({ map: a.map, x: a.x, y: a.y });
        var range = (G.skills.ikissyou && G.skills.ikissyou.range) || 50;
        var t_end = Math.min(a.expires || Date.now() + 240000, Date.now() + 240000);
        var ok = false, tries = 0, clean = 0;
        var snap = function () { var o = { gift: quantity("anniversarygift"), slices: 0, buffs: Object.keys(character.s || {}).join(",") }; character.items.forEach(function (i) { if (i && /^slice_/.test(i.name)) o.slices += i.q || 1; }); return o; };
        var before = snap();
        var rewarded = function () { var n = snap(); return n.gift > before.gift || n.slices > before.slices || n.buffs != before.buffs; };
        while (Date.now() < t_end && !paused) {
            a = anniv();
            if (!a || a.round != round) break;
            if (a.available === false || rewarded()) { ok = true; break; }
            var ent = get_player(name);
            if (!ent) {
                if (a.map == character.map && distance(character, { x: a.x, y: a.y }) > 30) { move(a.x, a.y); }
                await sleep(1000); continue;
            }
            if (distance(character, ent) > range - 5) { move(ent.x, ent.y); await sleep(400); continue; }
            if (!is_on_cooldown("ikissyou")) {
                tries++;
                var failed = false;
                try { await use_skill("ikissyou", ent); } catch (e) { failed = true; var rs = String(e && e.reason || e); if (/claimed/i.test(rs)) { ok = true; game_log("Kuss: Runde war schon belohnt"); break; } game_log("Kuss-Fehler: " + rs); }
                await sleep(2000);
                if (rewarded() || kiss_buff_active()) { ok = true; break; }
                if (!failed && ++clean >= 2) { ok = true; break; } // zweimal ohne Fehler -> als erledigt werten
                if (tries >= 5) break;
            } else await sleep(500);
        }
        if (ok) game_log("Buffs jetzt: " + Object.keys(character.s || {}).join(",") + " | Gifts " + quantity("anniversarygift"));
        if (ok) { kiss_mark_done(round); day_count("kisses"); game_log("Kuss belohnt (Runde " + round + ")"); }
        else { kiss_fail_round = round; game_log("Kuss diese Runde nicht geschafft"); }
    } catch (e) { kiss_fail_round = round; game_log("Kuss-Routine abgebrochen: " + err_txt(e)); }
    kissing = false; busy = false;
}

// ---------- Anniversary Gifts bei Xyn eintauschen (Taste G) ----------
var exchanging = false;
function err_txt(e) { if (e == "ABORT") return "abgebrochen"; if (e == "PAUSE") return "Pause"; try { return typeof e == "string" ? e : (e && (e.reason || e.message)) ? (e.reason || e.message) : JSON.stringify(e).slice(0, 120); } catch (x) { return String(e); } }
function exchange_npc_for(name) { // Quest-Items (Muscheln, Leder, Splitter) haben eigene NPCs, sonst Xyn
    var def = G.items[name]; if (def && def.quest) { for (var id in G.npcs) if (G.npcs[id].quest == def.quest) return id; }
    return "exchange";
}
async function go_exchange_npc(name) { var npc = exchange_npc_for(name); if (npc == "exchange") return travel_place("exchange"); var pos = find_npc(npc); if (!pos) throw "NPC " + npc + " nicht gefunden"; return travel({ map: pos.map, x: pos.x, y: pos.y }); }
function exchangeable(it) { var d = G.items[it.name]; return d && d.e && (it.q || 1) >= d.e; }
async function exchange_gifts() {
    if (exchanging) { game_log("Tausch läuft bereits"); return; }
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal G drücken"); return; }
    unpause("Xyn-Tausch");
    exchanging = true; busy = true;
    try {
        // 1. tauschbare Sachen aus der Bank holen
        set_message("Bank"); await travel_place("bank"); await sleep(800);
        await retrieve_for_empty_slots();
        var bank = character.bank || {}, got = 0;
        for (var pack in bank) {
            if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
            for (var i = 0; i < bank[pack].length; i++) { var bi = bank[pack][i]; if (bi && G.items[bi.name] && G.items[bi.name].e && character.esize > 2) { try { bank_retrieve(pack, i); got++; await sleep(400); } catch (e) {} } }
        }
        if (got) game_log("Aus der Bank geholt: " + got + " tauschbare Stapel");
        // 2. alles tauschen (NPC je Item)
        var todo = character.items.filter(function (it) { return it && exchangeable(it); }).map(function (it) { return it.name; });
        if (!todo.length) { game_log("Nichts zum Tauschen"); }
        else {
            var names = todo.filter(function (n, i, a) { return a.indexOf(n) == i; });
            game_log("Tausche: " + names.map(function (n) { return n + " bei " + ((G.npcs[exchange_npc_for(n)] || {}).name || "?"); }).join(", "));
            var done = 0;
            for (var ni = 0; ni < names.length && !paused; ni++) {
                var nm = names[ni];
                set_message("Tausch " + nm); stop("smart");
                try { await go_exchange_npc(nm); } catch (e) { game_log("Kein NPC für " + nm + ": " + err_txt(e)); continue; }
                var fails = 0;
                while (!paused) {
                    var idx = locate_item(nm); if (idx < 0 || !exchangeable(character.items[idx])) break;
                    if (character.esize < 2) { game_log("Inventar voll – Tausch gestoppt"); break; }
                    var before = quantity(nm);
                    try { await exchange(idx); } catch (e) {}
                    await sleep(1200);
                    while (character.q && character.q.exchange) await sleep(500);
                    await sleep(300);
                    if (quantity(nm) < before) { done++; fails = 0; set_message("Tausch " + done); }
                    else if (++fails >= 3) { game_log("Tausch klappt nicht bei " + nm); break; }
                }
            }
            game_log("Fertig: " + done + " Tauschvorgänge");
        }
    } catch (e) { game_log("Tausch-Fehler: " + err_txt(e)); }
    exchanging = false; busy = false;
    after_action("Tausch");
}

// ---------- Muscheln beim Fischer gegen Elixiere tauschen ----------
var shelling = false, shells_retry_at = rt("shells_retry_at", 0);
async function check_seashells() {
    if (shelling || busy || upgrading || paused || quantity("seashell") < SHELLS_PER_TRIP || Date.now() < shells_retry_at) return;
    shelling = true; busy = true;
    try {
        game_log("Tausche " + quantity("seashell") + " Muscheln bei " + ((G.npcs[exchange_npc_for("seashell")] || {}).name || "?"));
        set_message("Muscheln"); stop("smart"); await go_exchange_npc("seashell");
        var done = 0, fails = 0;
        while (quantity("seashell") >= 20 && character.esize > 1 && !paused) {
            var idx = locate_item("seashell"), before = quantity("seashell");
            try { await exchange(idx); } catch (e) {}
            await wait_queue("exchange");
            if (quantity("seashell") < before) { done++; fails = 0; } else if (++fails >= 3) break;
        }
        var got = ELIXIRS.map(function (n) { return quantity(n) ? quantity(n) + "x " + n : null; }).filter(Boolean).join(", ");
        game_log("Muscheln getauscht: " + done + "x – INT-Elixiere jetzt: " + (got || "keine"));
        if (!done) { shells_retry_at = Date.now() + 30 * 60000; game_log("Muschel-Tausch klappt nicht – nächster Versuch in 30 min"); }
    } catch (e) { game_log("Muschel-Tausch-Fehler: " + err_txt(e)); shells_retry_at = Date.now() + 30 * 60000; }
    shelling = false; busy = false;
    if (!paused) go_to_farm_spot();
}

// ---------- Monster Hunt (Daisy) ----------
var hunting = false, last_hunt_check = rt("last_hunt_check", 0), hunt_cooldown_until = rt("hunt_cooldown_until", 0), hunt_prev = null, hunt_spot = null, hunt_bad_tries = 0;
try { if (parent.__lp_saved_hunt) { hunt_prev = parent.__lp_saved_hunt.prev; hunt_spot = parent.__lp_saved_hunt.spot; parent.__lp_saved_hunt = null; } } catch (e) {}
function mh_quest() { return character.s && character.s.monsterhunt; }
function mh_txt() { var q = mh_quest(); if (!q) return "keine Jagd"; return q.id + " " + (q.c || 0) + " übrig · " + fmt_time(q.ms || 0); }
function tokens() { return quantity("monstertoken"); }
async function daisy() { var pos = find_npc("monsterhunter"); if (!pos) throw "Daisy nicht gefunden"; await travel({ map: pos.map, x: pos.x, y: pos.y }); }
var hunt_max_danger = 0.50; try { var hmd = parseFloat(localStorage.getItem("lp_hunt_max_danger")); if (isFinite(hmd) && hmd > 0) hunt_max_danger = hmd; if (localStorage.getItem("lp_hunt_max_v212") != "1") { localStorage.setItem("lp_hunt_max_v212", "1"); if (hunt_max_danger < 0.5) { hunt_max_danger = 0.5; localStorage.setItem("lp_hunt_max_danger", "0.5"); } } } catch (e) {} // Jagden nur bis zu dieser Gefahr (Anteil HP je Kill)
var hunt_max_ttk = 30; try { var hmt = parseFloat(localStorage.getItem("lp_hunt_max_ttk")); if (isFinite(hmt) && hmt > 0) hunt_max_ttk = hmt; } catch (e) {} // Jagd gilt als zu schwer, wenn ein Kill (mit Team) länger dauert
function hunt_danger_ok(id) { var d = G.monsters[id]; return !!d && mon_danger(d) <= hunt_max_danger && mon_ttk(d) <= hunt_max_ttk; }
var AREA_RADIUS = 450;
function rect_dist(a, b) { var dx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2])), dy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3])); return Math.hypot(dx, dy); }
function mon_rects(mon, map) { var out = []; var md = G.maps[map]; if (!md || !md.monsters) return out; md.monsters.forEach(function (e) { if (e.type != mon) return; if (e.boundary) out.push(e.boundary); if (e.boundaries) e.boundaries.forEach(function (b) { if (b[0] == map) out.push([b[1], b[2], b[3], b[4]]); }); }); return out; }
function deadly_neighbor(t) { var d = G.monsters[t]; if (!d) return false; if (d.boss) return true; if (!(d.aggro > 0)) return false; return !!hidden_mons[t] || d.attack >= character.max_hp * 0.5 || mon_danger(d) > 1; } // auch vom Nutzer ausgeblendete (✕) aggressive Monster gelten als tödliche Nachbarn // aggressiv und tödlich (2 Treffer / Kill kostet mehr als meine HP)
function hunt_area_threats(id) { // aggressive tödliche Nachbarn in der Nähe der Spawnfelder (z. B. booboo/mrgreen bei stoneworm)
    var found = {}; try { for (var map in G.maps) { var mine = mon_rects(id, map); if (!mine.length) continue; var md = G.maps[map]; (md.monsters || []).forEach(function (e) { if (e.type == id || found[e.type] || !deadly_neighbor(e.type)) return; var rs = mon_rects(e.type, map); for (var i = 0; i < rs.length && !found[e.type]; i++) for (var j = 0; j < mine.length; j++) if (rect_dist(rs[i], mine[j]) <= AREA_RADIUS) { found[e.type] = true; break; } }); } } catch (e) {}
    return Object.keys(found);
}
var hunt_allow = {}; try { hunt_allow = JSON.parse(localStorage.getItem("lp_hunt_allow") || "{}"); } catch (e) {} // Jagd erlaubt je Monster (Häkchen in der Liste); ohne Eintrag: nur grüne Spots (<= 10 %) ohne tödliche Nachbarn
function hunt_allowed(id) { // feste Entscheidung je Monster: Häkchen; ohne Häkchen wird einmalig ein Vorschlag berechnet und gespeichert (kein Hin und Her durch schwankende Gefahrwerte)
    if (id in hunt_allow) return !!hunt_allow[id];
    var d = G.monsters[id]; if (!d) return false;
    var ok = !hidden_mons[id] && mon_danger(d) <= 0.10 && mon_ttk(d) <= 30 && !hunt_area_threats(id).length;
    hunt_allow[id] = ok; try { localStorage.setItem("lp_hunt_allow", JSON.stringify(hunt_allow)); } catch (e) {}
    return ok;
}
function set_hunt_allow(id, on) { hunt_allow[id] = !!on; try { localStorage.setItem("lp_hunt_allow", JSON.stringify(hunt_allow)); } catch (e) {} game_log("Jagd auf " + id + (on ? " erlaubt" : " gesperrt")); }
var hunt_bad = {}; try { hunt_bad = JSON.parse(localStorage.getItem("lp_hunt_bad") || "{}"); } catch (e) {} // Monster, bei denen wir gestorben sind: 24 h keine Jagd darauf
function hunt_bad_for(id) { var t = hunt_bad[id]; if (!t) return false; if (Date.now() - t > 24 * 3600000) { delete hunt_bad[id]; return false; } return true; }
function note_hunt_bad(id) { if (!id) return; hunt_bad[id] = Date.now(); try { localStorage.setItem("lp_hunt_bad", JSON.stringify(hunt_bad)); } catch (e) {} }
function hunt_target_ok(id) { return id && G.monsters[id] && hunt_allowed(id) && !spot_blocked(id) && !hunt_bad_for(id); } // Jagd-Häkchen entscheidet (auch bei iceroamer – der friert ein, Team-Häkchen empfohlen) // Jagd nur nach Häkchen in der Liste (plus Tod/Spot-Sperre)
function hunt_skip_reason(id) { var d = G.monsters[id]; if (!d) return "unbekannt"; if (hunt_bad_for(id)) return "heute dort gestorben"; if (spot_blocked(id)) return "Spot gesperrt"; if (!hunt_allowed(id)) return "Jagd in der Liste nicht erlaubt"; return "unbekannter Grund"; if (mon_ttk(d) > hunt_max_ttk) return "zu schwer: " + (isFinite(mon_ttk(d)) ? Math.round(mon_ttk(d)) : "∞") + " s/Kill > " + hunt_max_ttk + " s"; if (!hunt_danger_ok(id)) return Math.round(mon_danger(d) * 100) + " % > " + Math.round(hunt_max_danger * 100) + " %" + team_bonus_txt(); if (!is_safe_monster(id)) return "nicht sicher"; if (spot_blocked(id)) return "gesperrt"; if (!team_safe(id)) return "zu stark für den Priester"; return "ausgeblendet"; }
async function spend_tokens() { // Set-Teile kaufen, günstigstes fehlendes zuerst
    if (SOLO) { await spend_tokens_for_main(); return; }
    var want = MH_SET.filter(function (n) { var def = G.items[n]; var sl = slot_for_item(def); var worn = character.slots[sl]; return !(worn && worn.name == n) && locate_item(n) < 0; })
        .sort(function (a, b) { return (G.tokens.monstertoken[a] || 99) - (G.tokens.monstertoken[b] || 99); });
    for (var i = 0; i < want.length; i++) {
        var cost = G.tokens.monstertoken[want[i]]; if (!cost || tokens() < cost || character.esize < 2) continue;
        try { exchange_buy("monstertoken", want[i]); await sleep(1500); } catch (e) {}
        if (locate_item(want[i]) >= 0) game_log("Tokens: " + want[i] + " gekauft (" + cost + " Tokens, " + tokens() + " übrig)"); else game_log("Tokens: Kauf von " + want[i] + " nicht bestätigt");
    }
}
async function spend_tokens_for_main() { // Zweit-Charakter: Set-Teile, die dem Hauptmagier fehlen, kaufen und in die Bank legen (Bank ist accountweit)
    var miss = []; try { miss = JSON.parse(window.localStorage.getItem("lp_mh_missing") || "[]"); } catch (e) {}
    var bought = [];
    for (var i = 0; i < miss.length; i++) { var m = miss[i]; if (!m.cost || tokens() < m.cost || character.esize < 2 || locate_item(m.name) >= 0) continue; try { exchange_buy("monstertoken", m.name); await sleep(1500); } catch (e) {} if (locate_item(m.name) >= 0) { bought.push(m.name); game_log("Tokens: " + m.name + " für " + MAIN_NAME + " gekauft (" + m.cost + " Tokens, " + tokens() + " übrig)"); } }
    if (!bought.length) return;
    try { await travel_place("bank"); await sleep(800); for (var b = 0; b < bought.length; b++) { var bi = locate_item(bought[b]); if (bi >= 0) { bank_store(bi); await sleep(400); } } game_log("Tokens: " + bought.join(", ") + " in die Bank gelegt – " + MAIN_NAME + " holt es beim nächsten Bankgang"); } catch (e) { game_log("Tokens: Bank-Fehler " + err_txt(e)); }
}
async function check_monsterhunt() {
    if (event_mode) return; // Event hat Vorrang

    if (!hunt_on || hunting || busy || upgrading || kissing || fleeing || exchanging || paused || !has_weapon()) return;
    if (Date.now() - last_hunt_check < 15000) return;
    last_hunt_check = Date.now();
    var q = mh_quest();
    // 1. Jagd läuft, noch Kills offen -> Spot auf Jagdmonster
    if (q && q.c > 0) {
        if (!hunt_target_ok(q.id)) { if (hunt_spot || !hunt_skipped) { hunt_skipped = q.id; game_log("Jagd auf " + q.id + " übersprungen (" + hunt_skip_reason(q.id) + ") – läuft aus, normal farmen"); if (hunt_spot) hunt_reset(0); hunt_cooldown_until = Date.now() + (q.ms || 1800000); } return; } // unsicher -> läuft ab, normal weiterfarmen
        if (q.ms && q.ms < MH_MIN_LEFT_MS && q.c > 3) return; // kaum noch Zeit: nicht mehr wechseln
        if (SET.team_hunt_first && hunt_spot != q.id && team_hunt_logged && current_spot == team_hunt_logged && team_hunt_logged != q.id) { // laufende Team-Jagd zuerst zu Ende bringen
            var th0 = team_hunt_pick(); if (th0 && th0.id == team_hunt_logged) { if (Date.now() - own_hunt_wait_logged > 120000) { own_hunt_wait_logged = Date.now(); game_log("Eigene Jagd " + q.c + "x " + q.id + " wartet, bis die Team-Jagd " + team_hunt_logged + " (" + th0.who + ") fertig ist"); } return; }
        }
        if (hunt_spot != q.id) { hunt_spot = q.id; game_log("Monster Hunt: " + q.c + "x " + q.id + " (" + fmt_time(q.ms || 0) + ")"); set_manual_spot(q.id); }
        return;
    }
    // 2. Jagd erledigt -> abgeben; oder keine Jagd -> neue holen
    if (Date.now() < hunt_cooldown_until) return;
    if (SET.hunt_town_only && !(q && q.c == 0)) { var dpos = find_npc("monsterhunter"); if (!dpos || character.map != dpos.map || distance(character, dpos) > 900) return; } // neue Jagd nur holen, wenn wir ohnehin in der Stadt sind
    var hs = hunt_slot_state(), may_take = !hs.busy && hs.fetcher == character.name; // Team holt nur eine Jagd zur Zeit
    if (!(q && q.c == 0) && !may_take) { if (Date.now() - hunt_slot_logged > 180000) { hunt_slot_logged = Date.now(); game_log("Keine neue Jagd: " + (hs.busy ? hs.holder + " läuft" : "holt gerade " + (hs.fetcher == TEAM.priest ? "Priest" : hs.fetcher == TEAM.ranger ? "Ranger" : "niemand"))); } return; }
    hunting = true; busy = true;
    try {
        var before_tok = tokens(), before_gold = character.gold;
        await daisy();
        var r = null; try { r = await interact("monsterhunt"); } catch (e) { r = e; }
        await sleep(800);
        var q2 = mh_quest();
        if (q && q.c == 0) { day_count("hunts"); game_log("Monster Hunt abgegeben: +" + (tokens() - before_tok) + " Tokens, +" + fmt(character.gold - before_gold) + " Gold (" + tokens() + " Tokens gesamt)"); }
        if (!q2 && !may_take) { hs = hunt_slot_state(); may_take = !hs.busy && hs.fetcher == character.name; if (!may_take) game_log("Jagd abgegeben, keine neue geholt: " + (hs.busy ? hs.holder + " läuft" : "Priest/Ranger holt")); }
        if (!q2 && may_take) { try { r = await interact("monsterhunt"); } catch (e) { r = e; } await sleep(800); q2 = mh_quest(); }
        if (q2 && q2.c > 0) {
            if (hunt_target_ok(q2.id)) { hunt_bad_tries = 0; game_log("Neue Jagd: " + q2.c + "x " + q2.id + " (" + fmt_time(q2.ms || 0) + ")"); }
            else {
                hunt_bad_tries++;
                game_log("Jagd auf " + q2.id + " übersprungen (" + hunt_skip_reason(q2.id) + ") – gebe sie auf");
                try { await interact("monsterhunt"); } catch (e) {} await sleep(800);
                if (mh_quest() && mh_quest().c > 0) { game_log("Aufgeben nicht möglich – Jagd läuft aus, normal weiterfarmen"); hunt_cooldown_until = Date.now() + (mh_quest().ms || 1800000); }
                else if (hunt_bad_tries >= 3) { hunt_cooldown_until = Date.now() + 10 * 60000; hunt_bad_tries = 0; game_log("3x unsichere Jagd – 10 min Pause"); }
            }
        } else if (!q2) { game_log("Keine Jagd erhalten (" + JSON.stringify(r || {}).slice(0, 80) + ") – nächster Versuch in 5 min"); hunt_cooldown_until = Date.now() + 5 * 60000; }
        await spend_tokens();
        if (hunt_spot && !(mh_quest() && mh_quest().c > 0)) hunt_reset(0);
    } catch (e) { game_log("Monster-Hunt-Fehler: " + err_txt(e)); hunt_cooldown_until = Date.now() + 5 * 60000; }
    hunting = false; busy = false;
    if (!paused) go_to_farm_spot();
}
var hunt_skipped = null, own_hunt_wait_logged = 0;
function hunt_reset(block_ms) { // Jagd-Spot verlassen, zum Nutzer-Modus zurück
    var m = hunt_spot;
    if (m && block_ms) blocked_spots[m] = Date.now() + block_ms;
    hunt_prev = null; hunt_spot = null;
    manual_spot = user_manual; need_repick = true; current_spot = null; meas = null; save_state();
}
async function hunt_abandon(auto) { // auto: vom Bot selbst ausgelöst (kein "Danach: Pause")
    var q = mh_quest();
    if (!q) { game_log("Keine Jagd aktiv"); hunt_reset(0); return; }
    busy = true;
    try { await daisy(); try { await interact("monsterhunt"); } catch (e) {} await sleep(800); }
    catch (e) { game_log("Jagd-Fehler: " + err_txt(e)); }
    busy = false;
    var still = mh_quest();
    if (still && still.c > 0) { hunt_cooldown_until = Date.now() + (still.ms || 1800000); game_log("Aufgeben nicht möglich – Jagd auf " + still.id + " läuft in " + fmt_time(still.ms || 0) + " aus, solange normal farmen"); }
    else { hunt_cooldown_until = Date.now() + 60000; game_log("Jagd aufgegeben"); }
    hunt_reset(LEVELED_BLOCK_MS);
    if (auto) { if (!paused) go_to_farm_spot(); } else after_action("Jagd aufgeben");
}

// ---------- Tränke kaufen: beste Stufe, die das Gold hergibt ----------
function pick_pot_tier(list) { // list ist "beste zuerst"
    for (var i = 0; i < list.length; i++) if (is_buyable(list[i]) && spendable() >= G.items[list[i]].g * 300) return list[i];
    return list[list.length - 1];
}
function check_potions() {
    if (busy) return;
    if (focus_mode) { if (pots_total(POTS_HP) >= FOCUS_POT_MIN && pots_total(POTS_MP) >= FOCUS_POT_MIN) return; } // Fokus: Nachkauf normalerweise beim Inventar-Stadtgang, hier nur der Notfall
    else if (pots_total(POTS_HP) >= 30 && pots_total(POTS_MP) >= 30) return;
    var hp_t = pick_pot_tier(POTS_HP), mp_t = pick_pot_tier(POTS_MP);
    var price = G.items[hp_t].g + G.items[mp_t].g;
    var amount = Math.min(150, Math.floor((spendable() * 0.7) / price));
    if (amount < 20) return;
    if (merchant_available() && pots_total(POTS_HP) >= 10 && pots_total(POTS_MP) >= 10 && !manual_lock) { merchant_pickup("Tränke").then(function (ok) { if (!ok) { /* Fallback beim nächsten Tick: Händler ist 3 min gesperrt */ } }); return; } // Händler bringt Tränke; nur bei fast leeren Vorräten selbst laufen

    busy = true; set_message("Tränke kaufen");
    travel_place("potions").then(function () {
        buy(hp_t, amount); buy(mp_t, amount);
        game_log("Tränke gekauft: " + amount + " " + hp_t + " / " + amount + " " + mp_t);
    }).catch(function () {}).then(function () { busy = false; });
}

// ---------- Hilfsfunktionen ----------
function npc_selling(name) {
    for (var id in G.npcs) { var n = G.npcs[id]; if (n.items && n.items.indexOf(name) >= 0) return id; }
    return null;
}
function is_buyable(name) { return npc_selling(name) != null; }
function target_level(name, manual) { return is_buyable(name) ? UPGRADE_TARGET : (manual ? RISKY_TARGET_DROP : SAFE_TARGET_DROP); }

function equipped_slots(kind) {
    var list = [];
    for (var slot in character.slots) {
        if (slot.indexOf("trade") == 0) continue;
        var it = character.slots[slot]; if (!it) continue;
        var def = G.items[it.name]; if (!def || !def[kind]) continue;
        list.push(slot);
    }
    return list;
}
function slots_to_upgrade(manual) {
    return equipped_slots("upgrade").filter(function (s) { var it = character.slots[s]; return (it.level || 0) < target_level(it.name, manual) || (is_buyable(it.name) && !has_backup(it.name)); });
}
var stat_impossible_logged = {};
function slots_without_stat() {
    return equipped_slots("upgrade").filter(function (s) { var it = character.slots[s]; if (it.stat_type == STAT_TYPE) return false; var d = G.items[it.name]; var ok = d && d.stat && (it.level || 0) <= grade0_max(it.name); if (!ok) { var k = it.name + "+" + (it.level || 0); if (!stat_impossible_logged[k]) { stat_impossible_logged[k] = true; game_log(it.name + "+" + (it.level || 0) + ": Attribut nicht möglich (" + (d && d.stat ? "Qualität 1 ab +" + (grade0_max(it.name) + 1) + ", Scroll nur davor" : "kein Attributwert") + ")"); } } return !!ok; });
}
function inv_count(name, level) { return find_inv_indices(name, level).length; }
function base_equiv(name) { var sum = 0; for (var l = 0; l < COMPOUND_TARGET; l++) sum += inv_count(name, l) * Math.pow(3, l); return sum; }
// Compound sinnvoll? -> irgendein Level hat (inkl. angelegtem) >= 3 Kopien, oder kaufbar und bezahlbar
function slot_target(slot, def_upgrade, def_compound) { // Zielstufe des getragenen Teils: Zielbau-Stufe, wenn es das Zielitem ist, sonst Vorgabe
    var it = character.slots[slot]; if (!it) return 0;
    if (wish_item(slot) == it.name) return wish_level(slot);
    var d = G.items[it.name] || {};
    return d.compound ? def_compound : def_upgrade;
}
function can_compound(slot) {
    var it = character.slots[slot]; if (!it) return false;
    var tgt = slot_target(slot, 0, COMPOUND_TARGET); if ((it.level || 0) >= tgt) return false;
    for (var l = 0; l < tgt; l++) if (inv_count(it.name, l) + ((it.level || 0) == l ? 1 : 0) >= 3) return true;
    if (!is_buyable(it.name)) return false;
    var need = Math.pow(3, tgt) - base_equiv(it.name) - Math.pow(3, it.level || 0);
    return need <= 0 || spendable() >= need * G.items[it.name].g * 1.3;
}
function slots_to_compound() { return equipped_slots("compound").filter(can_compound).filter(function (sl) { return !HP_JEWELRY.test(character.slots[sl].name); }); }
function find_inv_index(name, level) {
    for (var i = character.items.length - 1; i >= 0; i--) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) == level) return i; }
    return -1;
}
function find_inv_indices(name, level) {
    var r = [];
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) == level) r.push(i); }
    return r;
}
async function go_to_npc(npc) {
    var pos = find_npc(npc); if (!pos) return false;
    await smart_move({ map: pos.map, x: pos.x, y: pos.y }); return true;
}
async function wait_queue(key) {
    await sleep(1500);
    while (character.q && character.q[key]) await sleep(500);
    await sleep(500);
}

async function buy_items(name, count, ignore_reserve) {
    var npc = npc_selling(name);
    if (!npc) { game_log(name + " ist nicht beim NPC kaufbar"); return false; }
    var cost = G.items[name].g * count;
    var available = ignore_reserve ? character.gold : spendable();
    if (available < cost) { game_log(name + " x" + count + ": zu wenig freies Gold (" + cost + ")"); return false; }
    if (character.esize < count) { game_log("Inventar zu voll für " + name + " x" + count); return false; }
    set_message("Kaufe " + name);
    if (!await go_to_npc(npc)) return false;
    buy(name, count); await sleep(800);
    return find_inv_indices(name, 0).length >= 1;
}
async function buy_and_equip(name, ignore_reserve) {
    if (!await buy_items(name, 1, ignore_reserve)) return false;
    var idx = find_inv_index(name, 0); if (idx < 0) return false;
    equip(idx); await sleep(600); return true;
}

// ---------- Leere Slots aus dem Inventar füllen ----------
var last_slot_check = 0;
async function check_gear_slots() {
    if (Date.now() - last_slot_check < 10000 || upgrading || busy) return;
    last_slot_check = Date.now();
    for (var slot in SLOT_TYPES) { if (slot == "mainhand") continue; if (!character.slots[slot]) await reequip_slot(slot); }
    await ensure_best_equipped();
}
// Immer das aktuell beste Teil je Slot tragen (Inventar vs. getragen)
async function ensure_best_equipped() {
    for (var slot in SLOT_TYPES) {
        var worn = character.slots[slot]; if (!worn) continue;
        var b = best_inv_for_slot(slot); if (b < 0) continue;
        var cand = character.items[b]; if (!cand) continue;
        if (item_score(cand) > item_score(worn) * 1.02) { game_log(slot + ": " + cand.name + "+" + (cand.level || 0) + " ist besser als " + worn.name + "+" + (worn.level || 0) + " – angelegt"); equip(b, slot); await sleep(600); }
    }
}

// ---------- Waffe ----------
async function check_weapon() {
    if (has_weapon() || busy || upgrading) return;

    for (var i = 0; i < character.items.length; i++) {
        var it = character.items[i];
        if (it && G.items[it.name].wtype && G.items[it.name].class && G.items[it.name].class.indexOf(character.ctype) >= 0) {
            game_log("Waffe aus Inventar angelegt: " + it.name);
            equip(i); await sleep(600);
            if (has_weapon()) return;
        }
    }

    var best = null, best_price = -1;
    for (var w = 0; w < FALLBACK_WEAPONS.length; w++) {
        var nm = FALLBACK_WEAPONS[w];
        if (!is_buyable(nm)) continue;
        var p = G.items[nm].g;
        if (p <= character.gold && p > best_price) { best = nm; best_price = p; }
    }
    if (best) {
        busy = true; game_log("Keine Waffe – kaufe " + best + " (" + best_price + " Gold)");
        await buy_and_equip(best, true);
        busy = false;
        return;
    }

    var cheapest = null;
    for (var c = 0; c < FALLBACK_WEAPONS.length; c++) {
        if (is_buyable(FALLBACK_WEAPONS[c]) && (cheapest == null || G.items[FALLBACK_WEAPONS[c]].g < G.items[cheapest].g)) cheapest = FALLBACK_WEAPONS[c];
    }
    if (Date.now() - last_weapon_log > 60000) {
        last_weapon_log = Date.now();
        game_log("Ohne Waffe bei " + NO_WEAPON_MONSTER + " – spare für " + cheapest + " (" + (cheapest ? G.items[cheapest].g : "?") + " Gold, habe " + character.gold + ")");
    }
}

// ---------- Buttons: nur Compound / nur Aufräumen ----------
function unpause(why) { if (paused) { paused = false; game_log("Pause aufgehoben (" + why + ")"); } }
async function compound_only() {
    if (upgrading) { game_log("Upgrade läuft bereits"); return; }
    if (busy || routine_running()) { game_log("Gerade beschäftigt – gleich nochmal"); return; }
    unpause("Compound");
    upgrading = true; busy = true; set_message("Compound");
    try {
        var cs = slots_to_compound();
        game_log("Compound: " + cs.length + " getragene Slots" );
        for (var c = 0; c < cs.length; c++) { check_pause(); await compound_slot(cs[c]); }
        await compound_spares();
    } catch (e) { game_log(e == "PAUSE" ? "Compound durch Pause abgebrochen" : e == "ABORT" ? "Compound abgebrochen" : "Compound-Fehler: " + err_txt(e)); }
    upgrading = false; busy = false;
    after_action("Compound");
}
async function tidy_now() {
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal"); return; }
    unpause("Aufräumen");
    // 1. Priest/Ranger bringen alles außer Tränken/Tokens zum Magier, Händler räumt selbst (Bank)
    var givers = ["priest", "ranger"].filter(function (k) { return team_on[k] && team_running(TEAM[k]); });
    if (team_on.merch && team_running(TEAM.merch)) team_send(TEAM.merch, { t: "tidy" });
    if (givers.length) {
        busy = true; give_done = {}; givers.forEach(function (k) { team_send(TEAM[k], { t: "givemage" }); });
        game_log("Aufräumen: " + givers.map(function (k) { return TEAM_LABEL[k]; }).join("/") + " bringen alles außer Tränken zu mir – ich warte (frei: " + character.esize + ")");
        set_message("Team-Übergabe"); var t0 = Date.now();
        while (Date.now() - t0 < 120000 && givers.some(function (k) { return !give_done[TEAM[k]]; }) && !character.rip) await sleep(500);
        var late = givers.filter(function (k) { return !give_done[TEAM[k]]; }); if (late.length) game_log("Aufräumen: keine Rückmeldung von " + late.map(function (k) { return TEAM_LABEL[k]; }).join("/") + " – mache weiter");
        busy = false;
    }
    // 2. dann eigenes Inventar
    tidy_force = true; tidy_next = 0;
    try { await tidy_inventory(); } finally { tidy_force = false; }
    if (!paused) { try { await sort_inventory(); } catch (e) {} }
    game_log("Aufräumen fertig – frei: " + character.esize + " (behalten: Tränke, Scrolls, Event, 3er-Sets Schmuck, Ziel-Items – Reserven liegen in der Bank)");
    after_action("Aufräumen");
}

// ---------- Inventar sortieren (Button) ----------
var sorting_inv = false;
function inv_rank(it) {
    var n = it.name, def = G.items[n] || {};
    if (/^hpot/.test(n)) return 0; if (/^mpot/.test(n)) return 1; if (/^elixir/.test(n)) return 2;
    if (/^(scroll|cscroll)/.test(n)) return 3; if (/scroll$/.test(n)) return 4;
    if (EVENT_ITEMS.test(n)) return 5;
    if (equipped_names()[n]) return 6;              // Reserven der getragenen Ausrüstung
    if (def.compound) return 7;                      // Schmuck
    if (def.upgrade) return 8;                       // sonstige Ausrüstung
    if (def.type == "material" || def.e) return 9;   // Materialien / tauschbar
    return 10;
}
async function sort_inventory() {
    if (sorting_inv) return;
    sorting_inv = true;
    try {
        var items = [];
        for (var i = 0; i < character.items.length; i++) if (character.items[i]) items.push({ i: i, it: character.items[i] });
        items.sort(function (a, b) {
            var ra = inv_rank(a.it), rb = inv_rank(b.it); if (ra != rb) return ra - rb;
            if (a.it.name != b.it.name) return a.it.name < b.it.name ? -1 : 1;
            return (b.it.level || 0) - (a.it.level || 0);
        });
        var n = 0;
        for (var pos = 0; pos < items.length; pos++) {
            var cur = character.items[pos];
            var want = items[pos].it;
            if (cur && cur.name == want.name && (cur.level || 0) == (want.level || 0) && cur.q == want.q) continue;
            // Index des gewünschten Items suchen (ab pos)
            var from = -1;
            for (var j = pos; j < character.items.length; j++) { var it = character.items[j]; if (it && it.name == want.name && (it.level || 0) == (want.level || 0) && it.q == want.q) { from = j; break; } }
            if (from < 0 || from == pos) continue;
            swap(from, pos); n++;
            await sleep(120);
        }
        game_log("Inventar sortiert (" + n + " Verschiebungen)");
    } catch (e) { game_log("Sortier-Fehler: " + err_txt(e)); }
    sorting_inv = false;
}

// ---------- Ponty: gebrauchte Items prüfen und kaufen ----------
var last_ponty = rt("last_ponty", 0), ponty_logged = false, pontying = false;
function ponty_offer() { // Angebot abfragen (Socket), Promise mit Liste
    return new Promise(function (resolve) {
        var done = false;
        var h = function (data) { if (done) return; done = true; try { parent.socket.off("secondhands", h); } catch (e) {} resolve(data || []); };
        try { parent.socket.on("secondhands", h); parent.socket.emit("secondhands"); } catch (e) { resolve([]); }
        setTimeout(function () { if (!done) { done = true; try { parent.socket.off("secondhands", h); } catch (e) {} resolve([]); } }, 4000);
    });
}
function item_score(it) { return gear_score(G.items[it.name], it.level || 0, it.stat_type); }
function slot_for_item(def) { for (var sl in SLOT_TYPES) if (fits_slot(def, sl)) return sl; return null; }
async function check_ponty(force) {
    if (pontying || kissing || fleeing || exchanging || (!force && upgrading)) return;
    if (!force && (busy || Date.now() - last_ponty < PONTY_INTERVAL)) return;
    var npc = G.npcs.secondhands ? "secondhands" : null;
    if (!npc) { last_ponty = Date.now(); return; }
    var was_busy = busy; pontying = true; busy = true; last_ponty = Date.now();
    try {
        set_message("Ponty");
        if (!await go_to_npc(npc)) throw "Ponty nicht gefunden";
        var offer = await ponty_offer();
        if (!ponty_logged) { ponty_logged = true; game_log("Ponty-Angebot: " + (offer.length ? offer.map(function (o) { return o.name + (o.level ? "+" + o.level : "") + (o.price ? "@" + fmt(o.price) : ""); }).join(", ") : "leer/unbekannt")); }
        var bought = 0;
        offer.forEach(function (o) { var def = G.items[o.name]; if (def && slot_for_item(def)) { var pr = o.price || Math.round(def.g * Math.pow(2, o.level || 0) * 3); var prev = market_valid(o.name); if (!prev || pr < prev.price) note_market(o.name, o.level, pr, "Ponty"); } });
        var wl_offers = offer.map(function (po) { var pdef = G.items[po.name]; if (!pdef) return null; var pprice = po.price || Math.round(pdef.g * Math.pow(2, po.level || 0) * 3); var wsl = wish_wants(po.name, po.level, pprice); return wsl ? { o: po, price: pprice, slot: wsl, gain: gear_score(pdef, po.level || 0) - (character.slots[wsl] ? item_score(character.slots[wsl]) : 0) } : null; }).filter(Boolean);
        wl_offers.sort(function (a, b) { return (b.gain / Math.max(1, b.price)) - (a.gain / Math.max(1, a.price)); }); // bester Wertgewinn je Gold zuerst
        var wl_done = {};
        for (var wp = 0; wp < wl_offers.length; wp++) { var W = wl_offers[wp]; if (wl_done[W.slot]) continue; if (await wish_buy_from_offer({ name: W.o.name, level: W.o.level, price: W.price }, async function () { parent.socket.emit("sbuy", { rid: W.o.rid }); return true; })) wl_done[W.slot] = true; }
        for (var rp = 0; rp < offer.length && character.esize > 2; rp++) { var ro = offer[rp], rdef = G.items[ro.name]; if (!rdef) continue; var rprice = ro.price || Math.round(rdef.g * Math.pow(2, ro.level || 0) * 3); if (!reserve_wants(ro.name, ro.level, rprice)) continue; var rb = character.esize; try { parent.socket.emit("sbuy", { rid: ro.rid }); } catch (e) {} await sleep(1500); if (character.esize < rb) game_log("Reserve gekauft: " + ro.name + "+" + (ro.level || 0) + " für " + fmt(rprice) + " (jetzt " + reserve_count(ro.name) + "/" + RESERVE_COPIES + ")"); }
        var pslots = {};
        for (var i = 0; i < offer.length; i++) {
            var o = offer[i], def = G.items[o.name]; if (!def) continue;
            var slot = slot_for_item(def); if (!slot || pslots[slot]) continue;
            var price = o.price || Math.round(def.g * Math.pow(2, o.level || 0) * 3);
            if (price > spendable() * 0.5 || character.esize < 2) continue;
            if (!on_wishlist(o.name) && !(alt_target && alt_target.name == o.name)) continue; // außerhalb des Zielbaus nur per Zwischenlösung-Button
            var cur = character.slots[slot], cur_s = cur ? item_score(cur) : 0;
            if ((cur && cur.name == o.name && (cur.level || 0) >= (o.level || 0)) || locate_item(o.name) >= 0 || bought_recently(o.name)) continue;
            goal_cache_t = 0; compute_goals();
            var is_goal = goal_cache[slot] && goal_cache[slot].want_market == o.name;
            var better_now = cur ? item_score(o) >= cur_s * GEAR_MIN_GAIN : true;
            if (!is_goal && !better_now) continue;
            game_log("Ponty: kaufe " + o.name + "+" + (o.level || 0) + " für " + slot + " (" + fmt(price) + " Gold) – Grund: " + (is_goal ? "Empfehlung Markt" : "jetzt besser (" + Math.round(item_score(o)) + " vs " + Math.round(cur_s) + (cur ? " " + cur.name + "+" + (cur.level || 0) : " leer") + ")"));
            note_bought(o.name);
            var before = character.esize;
            try { parent.socket.emit("sbuy", { rid: o.rid }); } catch (e) {}
            await sleep(1500);
            if (character.esize < before) {
                pslots[slot] = true; bought++;
                var idx = find_inv_index(o.name, o.level || 0), curNow = character.slots[slot];
                if (idx >= 0 && (!curNow || item_score(character.items[idx]) > item_score(curNow))) { equip(idx, slot); await sleep(600); }
                else game_log(o.name + " bleibt im Inventar (aktuelles Teil ist jetzt noch besser) – U zieht es hoch");
            } else game_log("Ponty: Kauf nicht bestätigt (" + o.name + ")");
        }
        if (bought) game_log("Ponty: " + bought + " Item(s) gekauft und angelegt");
    } catch (e) { game_log("Ponty-Fehler: " + err_txt(e)); }
    pontying = false; busy = was_busy && upgrading; // innerhalb der Upgrade-Routine bleibt busy gesetzt
}

// ---------- Marktstände anderer Spieler ----------
var last_market = rt("last_market", 0), marketing = false;
function market_offers() { // alle Angebote sichtbarer Stände
    var out = [];
    for (var id in parent.entities) {
        var p = parent.entities[id];
        if (!p || p.type != "character" || !p.stand || !p.slots) continue;
        for (var sl in p.slots) {
            if (sl.indexOf("trade") != 0) continue;
            var it = p.slots[sl]; if (!it || !it.price || it.b) continue; // b = Kaufgesuch
            out.push({ seller: p, slot: sl, name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, id: p.id, stat_type: it.stat_type });
        }
    }
    return out;
}
async function check_market(force) {
    if (marketing || kissing || fleeing || exchanging || pontying || (!force && upgrading)) return;
    if (!force && (busy || Date.now() - last_market < MARKET_INTERVAL)) return;
    var was_busy = busy; marketing = true; busy = true; last_market = Date.now();
    try {
        set_message("Markt"); await travel_place("town"); await sleep(1500);
        var offers = market_offers(), bought = 0;
        offers.forEach(function (o) { var def = G.items[o.name]; if (def && slot_for_item(def)) { var prev = market_valid(o.name); if (!prev || o.price < prev.price) note_market(o.name, o.level, o.price, "Stand " + o.seller.name); } });
        game_log("Markt: " + offers.length + " Angebote an " + offers.filter(function (o, i, a) { return a.findIndex(function (x) { return x.id == o.id; }) == i; }).length + " Ständen");
        offers.sort(function (a, b) { return a.price - b.price; });
        for (var e0 = 0; e0 < offers.length; e0++) { var eo = offers[e0]; if (/^elixirint/.test(eo.name) && eo.price <= ELIXIR_MAX_PRICE && eo.price <= spendable() && character.esize > 1) { if (distance(character, eo.seller) > 300) { try { await smart_move({ x: eo.seller.x, y: eo.seller.y + 30 }); } catch (e) { continue; } } try { trade_buy(eo.seller, eo.slot, Math.min(eo.q, 3)); game_log("Markt: " + eo.name + " gekauft (" + fmt(eo.price) + ")"); await sleep(800); } catch (e) {} } }
        var mw = offers.map(function (wo) { var wsl = wish_wants(wo.name, wo.level, wo.price); var d = G.items[wo.name]; return wsl && d ? { o: wo, slot: wsl, gain: gear_score(d, wo.level || 0) - (character.slots[wsl] ? item_score(character.slots[wsl]) : 0) } : null; }).filter(Boolean);
        mw.sort(function (a, b) { return (b.gain / Math.max(1, b.o.price)) - (a.gain / Math.max(1, a.o.price)); });
        var mw_done = {};
        for (var w0 = 0; w0 < mw.length; w0++) { var wo = mw[w0].o; if (mw_done[mw[w0].slot]) continue; if (distance(character, wo.seller) > 300) { try { await smart_move({ x: wo.seller.x, y: wo.seller.y + 30 }); } catch (e) { continue; } } if (await wish_buy_from_offer(wo, async function () { trade_buy(wo.seller, wo.slot, 1); return true; })) mw_done[mw[w0].slot] = true; }
        for (var r0 = 0; r0 < offers.length && character.esize > 2; r0++) { var rof = offers[r0]; if (!reserve_wants(rof.name, rof.level, rof.price)) continue; if (distance(character, rof.seller) > 300) { try { await smart_move({ x: rof.seller.x, y: rof.seller.y + 30 }); } catch (e) { continue; } } var rb2 = character.esize; try { trade_buy(rof.seller, rof.slot, 1); } catch (e) {} await sleep(1500); if (character.esize < rb2) game_log("Reserve gekauft: " + rof.name + "+" + (rof.level || 0) + " für " + fmt(rof.price) + " (jetzt " + reserve_count(rof.name) + "/" + RESERVE_COPIES + ")"); }
        if (anniv() && anniv().active) for (var s0 = 0; s0 < offers.length; s0++) { var so = offers[s0]; if (SLICES.indexOf(so.name) < 0 || quantity(so.name) > 0 || so.price > SLICE_MAX_PRICE || so.price > spendable() || character.esize < 2) continue; if (distance(character, so.seller) > 300) { try { await smart_move({ x: so.seller.x, y: so.seller.y + 30 }); } catch (e) { continue; } } try { trade_buy(so.seller, so.slot, 1); await sleep(1000); if (quantity(so.name) > 0) game_log("Markt: Kuchenstück " + so.name + " gekauft (" + fmt(so.price) + ") – fehlen noch " + missing_slices().length); } catch (e) {} }
        var bought_slots = {};
        for (var i = 0; i < offers.length; i++) {
            var o = offers[i], def = G.items[o.name]; if (!def) continue;
            var slot = slot_for_item(def); if (!slot || bought_slots[slot]) continue;
            if (o.price > spendable() * 0.5 || character.esize < 2) continue;
            if (!on_wishlist(o.name) && !(alt_target && alt_target.name == o.name)) continue;
            var cur = character.slots[slot], cur_s = cur ? item_score(cur) : 0;
            if ((cur && cur.name == o.name && (cur.level || 0) >= (o.level || 0)) || locate_item(o.name) >= 0 || bought_recently(o.name)) continue; // schon vorhanden
            goal_cache_t = 0; compute_goals();
            var is_goal = goal_cache[slot] && goal_cache[slot].want_market == o.name;
            var better_now = cur ? item_score(o) >= cur_s * GEAR_MIN_GAIN : true;
            if (!is_goal && !better_now) continue;
            var reason = is_goal ? "Empfehlung Markt" : "jetzt besser (" + Math.round(item_score(o)) + " vs " + Math.round(cur_s) + (cur ? " " + cur.name + "+" + (cur.level || 0) : " leer") + ")";
            note_bought(o.name);
            if (distance(character, o.seller) > 300) { try { await smart_move({ x: o.seller.x, y: o.seller.y + 30 }); } catch (e) { continue; } }
            game_log("Markt: kaufe " + o.name + "+" + o.level + " für " + slot + " von " + o.seller.name + " (" + fmt(o.price) + " Gold) – Grund: " + reason);
            var before = character.esize;
            try { trade_buy(o.seller, o.slot, 1); } catch (e) { game_log("Markt-Kauf fehlgeschlagen: " + e); continue; }
            await sleep(1500);
            if (character.esize < before) { bought_slots[slot] = true; bought++; var idx = find_inv_index(o.name, o.level); var curNow = character.slots[slot]; if (idx >= 0 && (!curNow || item_score(character.items[idx]) > item_score(curNow))) { equip(idx, slot); await sleep(600); } else game_log(o.name + " bleibt im Inventar (aktuelles Teil ist jetzt noch besser) – U zieht es hoch"); }
        }
        if (bought) game_log("Markt: " + bought + " Item(s) gekauft und angelegt");
    } catch (e) { game_log("Markt-Fehler: " + err_txt(e)); }
    marketing = false; busy = was_busy && upgrading;
}

// ---------- Ausrüstungs-Ziele: nächstbesseres Item je Slot + Beschaffungsweg ----------
var gear_goal = null;        // aktiver Beschaffungsauftrag {slot, item, steps:[...], step:0, started, expect_ms}
var goal_skip = {}; try { goal_skip = JSON.parse(localStorage.getItem("lp_goal_skip") || "{}"); } catch (e) {}
function save_goal_skip() { try { localStorage.setItem("lp_goal_skip", JSON.stringify(goal_skip)); } catch (e) {} }

function drop_sources(item) { // Monster, die item droppen: [{mon, chance}]
    var out = [], dm = (G.drops && G.drops.monsters) || {};
    for (var m in dm) dm[m].forEach(function (d) { if (d[1] == item && G.monsters[m]) out.push({ mon: m, chance: d[0] }); });
    return out;
}
function kills_per_hour(mon) { var d = G.monsters[mon], ttk = mon_ttk(d); if (!isFinite(ttk)) return 0; var k = 3600 / (ttk + 2) * 0.8; if (d.respawn) k = Math.min(k, spawn_count(mon) * 3600 / d.respawn); return k; }
function best_farm_source(item) { // sicherstes/schnellstes Monster für item
    var best = null;
    drop_sources(item).forEach(function (src) {
        if (!is_safe_monster(src.mon) || EXCLUDE[src.mon]) return;
        var h = 1 / (src.chance * Math.max(0.01, kills_per_hour(src.mon)));
        if (!best || h < best.hours) best = { mon: src.mon, chance: src.chance, hours: h };
    });
    return best;
}
function exchange_source(item) { // Tauschitem (z.B. leather -> cape)
    for (var t in G.drops) {
        if (!G.items[t] || !G.items[t].e || !Array.isArray(G.drops[t])) continue;
        var total = 0; G.drops[t].forEach(function (d) { total += d[0] || 0; });
        for (var i = 0; i < G.drops[t].length; i++) if (G.drops[t][i][1] == item) return { base: t, need: G.items[t].e, weight: G.drops[t][i][0], total: total };
    }
    return null;
}
// Plan für ein Item: Liste von Schritten oder null (nicht machbar). depth begrenzt Rekursion
function plan_for(item, qty, depth) {
    qty = qty || 1; depth = depth || 0;
    var have = quantity(item); if (have >= qty) return [];
    var need = qty - have;
    if (is_buyable(item)) { if (G.items[item].g * need <= spendable()) return [{ type: "buy", item: item, qty: need, hours: 0 }]; return null; }
    var fs = best_farm_source(item);
    if (fs) return [{ type: "farm", mon: fs.mon, item: item, qty: qty, hours: fs.hours * need }];
    if (depth < 1 && G.craft && G.craft[item]) {
        var c = G.craft[item], steps = [], hours = 0, ok = true;
        c.items.forEach(function (ing) { if (!ok) return; var sub = plan_for(ing[1], ing[0], depth + 1); if (!sub) { ok = false; return; } sub.forEach(function (st) { steps.push(st); hours += st.hours || 0; }); });
        if (ok && (c.cost || 0) <= spendable()) { steps.push({ type: "craft", item: item, npc: c.quest || "craftsman", hours: 0 }); return steps; }
    }
    if (depth < 1) {
        var ex = exchange_source(item);
        if (ex) { var sub2 = plan_for(ex.base, ex.need * Math.max(1, Math.ceil(ex.total / Math.max(0.0001, ex.weight))), depth + 1); if (sub2) { sub2.push({ type: "exchange", item: ex.base, want: item, hours: 0 }); return sub2; } }
    }
    return null; // sonst: Markt/Ponty (läuft ohnehin)
}
function plan_text(steps, t) {
    if (!steps) return t && t.slow ? "zu lang (~" + Math.round(t.hours) + " h) – Markt/Ponty" : "Markt/Ponty" + (t && t.price ? " (~" + fmt(t.price) + " Gold)" : "");
    if (!steps.length) return "im Inventar";
    return steps.map(function (st) {
        if (st.type == "buy") return "kaufen";
        if (st.type == "farm") return st.mon + " (" + (st.qty > 1 ? st.qty + "x " : "") + st.item + ", ~" + (st.hours < 1 ? Math.round(st.hours * 60) + " min" : st.hours.toFixed(1) + " h") + ")";
        if (st.type == "craft") return "craften bei " + (G.npcs[st.npc] ? G.npcs[st.npc].name : st.npc);
        if (st.type == "exchange") return "tauschen (" + st.item + ")";
        return st.type;
    }).join(" → ");
}
// ---------- Wirtschaftlichkeit: Upgrade vs. Farmen vs. Markt ----------
// Referenz Gold/h: höchster je gemessener Wert (bleibt gespeichert, auch bei Pausen)
var best_gph = 0; try { best_gph = parseFloat(localStorage.getItem("lp_best_gph") || "0") || 0; } catch (e) {}
function update_best_gph(v) { if (v > best_gph) { best_gph = v; try { localStorage.setItem("lp_best_gph", String(best_gph)); } catch (e) {} } }
function gold_per_hour() {
    for (var m in farm_stats) if ((farm_stats[m].n || 1) >= 2) update_best_gph(farm_stats[m].gold_h || 0);
    var sh = (Date.now() - sess.start) / 3600000; if (sh > 0.25) update_best_gph(sess.gold / sh);
    return best_gph || 100000;
}
function scroll_price_for(def, level) { // Scrollpreis für Upgrade/Compound von level -> level+1
    var g = def.grades || [], grade = 0; for (var i = 0; i < g.length; i++) if (level >= g[i]) grade = i + 1; grade = Math.min(grade, 2);
    var nm = (def.upgrade ? "scroll" : "cscroll") + grade; return G.items[nm] ? G.items[nm].g : 1000;
}
function base_price(def, name) { return is_buyable(name) ? def.g : Math.max(def.g * MARKET_FACTOR, 50000); } // nicht kaufbare: mind. 50k am Markt
function cost_to_reach(name, level) { // erwartete Gesamtkosten, ein Item von 0 auf level zu bringen (inkl. Verluste)
    var def = G.items[name], c = base_price(def, name);
    for (var l = 0; l < level; l++) {
        var p = def.upgrade ? success_p("u", l) : success_p("c", l);
        if (def.compound) c = (3 * c + scroll_price_for(def, l)) / p; else c = (c + scroll_price_for(def, l)) / p;
    }
    return c;
}
function step_cost(name, level) { var def = G.items[name]; var p = def.upgrade ? success_p("u", level) : success_p("c", level); var own = cost_to_reach(name, level); return def.compound ? (2 * own + scroll_price_for(def, level)) / p + own * (1 - p) / p : (scroll_price_for(def, level) + own * (1 - p)) / p; }
function max_level(def) { return def.upgrade ? 10 : def.compound ? 5 : 0; }
var goal_cache = {}, goal_cache_t = 0;
function compute_goals() {
    if (Date.now() - goal_cache_t < 30000) return goal_cache;
    goal_cache_t = Date.now(); goal_cache = {};
    var gph = gold_per_hour(), budget = Math.max(150000, gph * 24 + Math.max(0, spendable()));
    for (var slot in SLOT_TYPES) {
        var cur = character.slots[slot], cur_def = cur && G.items[cur.name], lvl = cur ? (cur.level || 0) : 0;
        var cur_s = cur ? gear_score(cur_def, lvl) : 0, options = [];
        // A) aktuelles Teil weiter upgraden
        var is_wish = cur && wish_item(slot) == cur.name;
        var armor_cap = is_wish ? wish_level(slot) : cur_def && cur_def.compound ? COMPOUND_TARGET : cur_def && is_buyable(cur.name) ? UPGRADE_TARGET : (slot == "mainhand" ? WEAPON_SAFE_TARGET : SAFE_TARGET_DROP);
        if (!is_wish) armor_cap = 0; // nur Zielbau-Teile werden ausgebaut – auch bei U
        if (cur && lvl < max_level(cur_def) && lvl < armor_cap && (cur_def.upgrade || cur_def.compound)) {
            var gain = gear_score(cur_def, lvl + 1) - cur_s, cost = step_cost(cur.name, lvl);
            if (gain > 0) options.push({ kind: "upgrade", item: cur.name, to: lvl + 1, gain: gain, cost: cost, hours: cost / gph, ratio: gain / cost });
        }
        // B/C) andere Items: farmen oder Markt
        var cands = [];
        for (var name in G.items) { var def = G.items[name]; if (!fits_slot(def, slot) || (cur && name == cur.name) || (goal_skip[name] && Date.now() - goal_skip[name] < 24 * 3600000)) continue; var pl = Math.min(projected_level(def), def.upgrade ? UPGRADE_TARGET : COMPOUND_TARGET); var sc = gear_score(def, pl); var cur_pot = cur ? gear_score(cur_def, Math.max(lvl, projected_level(cur_def))) : 0; if (sc > cur_s * 1.05 && sc > cur_pot * 1.05) cands.push({ name: name, pl: pl, score: sc }); }
        cands.sort(function (a, b) { return b.score - a.score; });
        var best_farm = null, best_market = null, farm_checked = 0;
        for (var i = 0; i < Math.min(cands.length, 80); i++) {
            var cd = cands[i], def2 = G.items[cd.name], up_cost = cost_to_reach(cd.name, cd.pl) - base_price(def2, cd.name);
            var gain2 = cd.score - cur_s;
            if (farm_checked < 25) { var plan = plan_for(cd.name, 1, 0); if (plan) { farm_checked++; var hrs = plan.reduce(function (a, b) { return a + (b.hours || 0); }, 0); if (hrs <= GOAL_MAX_HOURS) { var c2 = hrs * gph + up_cost + (plan.some(function (st) { return st.type == "buy"; }) ? base_price(def2, cd.name) : 0); var o2 = { kind: "farm", item: cd.name, plan: plan, hours: c2 / gph, farm_hours: hrs, gain: gain2, cost: c2, ratio: gain2 / Math.max(1, c2), pl: cd.pl }; if (!best_farm || o2.ratio > best_farm.ratio) best_farm = o2; } } }
            var seen = market_valid(cd.name);
            if (seen) { var lv0 = seen.level || 0, up3 = Math.max(0, cost_to_reach(cd.name, cd.pl) - cost_to_reach(cd.name, lv0)); var c3 = seen.price + up3; var o3 = { kind: "market", item: cd.name, price: seen.price, where: seen.where, level: lv0, gain: gain2, cost: c3, hours: c3 / gph, ratio: gain2 / Math.max(1, c3), pl: cd.pl }; if (!best_market || o3.ratio > best_market.ratio) best_market = o3; }
        }
        if (best_farm) options.push(best_farm); if (best_market) options.push(best_market);
        options.sort(function (a, b) { return b.ratio - a.ratio; });
        goal_cache[slot] = { cur: cur, options: options, target: best_farm ? { item: best_farm.item, plan: best_farm.plan, hours: best_farm.farm_hours } : null, want_market: best_market && options[0] === best_market ? best_market.item : null };
    }
    return goal_cache;
}
function hrs_txt(h) { return h < 1 ? Math.round(h * 60) + " min" : h.toFixed(1) + " h"; }
function option_text(o) {
    var per = " (+" + Math.round(o.gain) + " Wert, ~" + hrs_txt(o.hours) + " ≙ " + fmt(o.cost) + ")";
    if (o.kind == "upgrade") return "Upgrade auf +" + o.to + per + " Chance " + success_txt(G.items[o.item].upgrade ? "u" : "c", o.to - 1);
    if (o.kind == "farm") return (o.farm_hours > 0 ? "Farmen: " + o.item + " ~" + hrs_txt(o.farm_hours) : "NPC: " + o.item) + " (+" + Math.round(o.gain) + " Wert" + (o.hours - o.farm_hours > 0.1 ? ", danach Ausbau ~" + hrs_txt(o.hours - o.farm_hours) : "") + ")";
    if (o.kind == "market") return "Markt (" + o.where + "): " + o.item + (o.level ? "+" + o.level : "") + " für " + fmt(o.price) + per;
    return o.kind;
}
function start_goal(slot) {
    var g = compute_goals()[slot]; if (!g || !g.target || !g.target.plan) { game_log("Für " + slot + " gibt es keinen automatischen Weg"); return; }
    unpause("Beschaffen");
    gear_goal = { slot: slot, item: g.target.item, steps: g.target.plan, step: 0, started: Date.now(), step_started: Date.now() };
    game_log("Beschaffung gestartet: " + g.target.item + " für " + slot + " – " + plan_text(g.target.plan));
}
function stop_goal(reason) { if (gear_goal) { game_log("Beschaffung beendet: " + gear_goal.item + (reason ? " (" + reason + ")" : "")); } gear_goal = null; if (manual_spot && goal_spot) { manual_spot = user_manual; goal_spot = null; need_repick = true; } goal_cache_t = 0; }
var goal_spot = null, goal_busy = false;
async function run_goal() {
    if (!gear_goal || goal_busy || upgrading || kissing || fleeing || exchanging || pontying || marketing) return;
    var st = gear_goal.steps[gear_goal.step];
    if (!st) { // fertig: Ziel-Item anlegen
        goal_busy = true;
        var idx = find_inv_index(gear_goal.item, 0); if (idx < 0) for (var i = 0; i < character.items.length; i++) if (character.items[i] && character.items[i].name == gear_goal.item) { idx = i; break; }
        var curG = character.slots[gear_goal.slot];
        if (idx >= 0 && (!curG || item_score(character.items[idx]) > item_score(curG))) { equip(idx, gear_goal.slot); await sleep(600); game_log(gear_goal.item + " angelegt (" + gear_goal.slot + ")"); }
        else if (idx >= 0) game_log(gear_goal.item + " im Inventar – aktuelles Teil ist jetzt noch besser, U zieht das neue hoch");
        stop_goal("fertig"); goal_busy = false; return;
    }
    if (st.type == "farm") {
        if (quantity(st.item) >= st.qty) { gear_goal.step++; gear_goal.step_started = Date.now(); if (manual_spot == goal_spot) { manual_spot = user_manual; goal_spot = null; need_repick = true; } return; }
        if (manual_spot != st.mon) { goal_spot = st.mon; set_manual_spot(st.mon); }
        var limit = Math.max(20 * 60 * 1000, st.hours * 3600000 * GOAL_GIVEUP_FACTOR);
        if (Date.now() - gear_goal.step_started > limit) { goal_skip[gear_goal.item] = Date.now(); save_goal_skip(); stop_goal("Zeitlimit beim Farmen von " + st.item); }
        return;
    }
    if (busy) return;
    goal_busy = true; busy = true;
    try {
        if (st.type == "buy") { await buy_items(st.item, st.qty); }
        else if (st.type == "craft") {
            set_message("Craften"); if (!await go_to_npc(st.npc)) throw "NPC " + st.npc + " nicht gefunden";
            var before = quantity(st.item);
            try { await auto_craft(st.item); } catch (e) { game_log("Craft-Fehler: " + (e && e.reason || e)); }
            await sleep(2000);
            if (quantity(st.item) <= before && find_inv_index(st.item, 0) < 0) throw "Craft nicht gelungen (" + st.item + ")";
            game_log(st.item + " gecraftet");
        }
        else if (st.type == "exchange") {
            set_message("Tauschen"); await go_exchange_npc(st.item);
            var tries = 0;
            while (quantity(st.want) < 1 && quantity(st.item) >= G.items[st.item].e && tries++ < 30 && character.esize > 1) { var ix = locate_item(st.item); try { await exchange(ix); } catch (e) {} await wait_queue("exchange"); }
            if (quantity(st.want) < 1) throw "Tausch ergab kein " + st.want;
        }
        gear_goal.step++; gear_goal.step_started = Date.now();
    } catch (e) { stop_goal("Fehler: " + e); }
    goal_busy = false; busy = false;
}

// ---------- Bessere kaufbare Ausrüstung ----------
var SLOT_TYPES = { helmet: "helmet", chest: "chest", pants: "pants", shoes: "shoes", gloves: "gloves", cape: "cape", mainhand: "weapon", offhand: "offhand", ring1: "ring", ring2: "ring", earring1: "earring", earring2: "earring", amulet: "amulet", belt: "belt", orb: "orb" };


// ---------- Wiki im Spiel: Items, Monster, NPCs aus den Spieldaten (G) ----------
var wiki_panel = null, wiki = { q: "", tab: "items", page: null, hist: [], cat: null, mage_only: true, sort: "score" };
var WIKI_CATS = [["helmet", "Kopf"], ["chest", "Brust"], ["pants", "Hose"], ["shoes", "Schuhe"], ["gloves", "Handschuhe"], ["cape", "Umhang"], ["mainhand", "Waffe"], ["offhand", "Nebenhand"], ["ring1", "Ring"], ["earring1", "Ohrring"], ["amulet", "Amulett"], ["belt", "Gürtel"], ["orb", "Orb"], ["_scroll", "Scrolls"], ["_pot", "Tränke/Elixiere"], ["_mat", "Material/Tausch"], ["_other", "Sonstiges"]];
function wiki_cat_items(cat) { // Items einer Kategorie
    var out = [];
    for (var n in G.items) {
        var d = G.items[n]; if (!d || d.ignore) continue;
        var ok = false;
        if (cat.charAt(0) != "_") { ok = SLOT_TYPES[cat] && fits_slot_any(d, cat); if (ok && wiki.mage_only && d.class && d.class.indexOf(character.ctype) < 0) ok = false; }
        else if (cat == "_scroll") ok = /scroll$/.test(d.type || "") || /scroll/.test(n);
        else if (cat == "_pot") ok = d.type == "pot" || d.type == "elixir";
        else if (cat == "_mat") ok = d.type == "material" || d.type == "quest" || d.type == "token" || d.type == "gem" || d.type == "box" || !!d.e;
        else if (cat == "_other") ok = !slot_for_item(d) && !/scroll/.test(n) && d.type != "pot" && d.type != "elixir" && d.type != "material" && d.type != "quest" && d.type != "token" && d.type != "gem" && d.type != "box" && !d.e;
        if (!ok) continue;
        out.push({ name: n, def: d, score: gear_score(d, 0), tscore: gear_score(d, default_target_level(d)) });
    }
    return out;
}
function fits_slot_any(def, slot) { // wie fits_slot, aber ohne Klassenfilter (für die Wiki-Übersicht)
    var t = SLOT_TYPES[slot]; if (!t) return false;
    if (t == "weapon") return !!def.wtype;
    if (t == "offhand") return def.type == "source" || def.type == "misc_offhand" || def.type == "quiver" || def.type == "shield";
    return def.type == t;
}
function wiki_cat_html(cat) {
    var list = wiki_cat_items(cat).filter(function (x) { return wiki_match(x.name, x.def, wiki.q); });
    var equip = cat.charAt(0) != "_";
    var srt = wiki.sort; list.sort(function (a, b) { return srt == "name" ? String(a.def.name || a.name).localeCompare(String(b.def.name || b.name)) : srt == "g" ? (b.def.g || 0) - (a.def.g || 0) : srt == "tscore" ? b.tscore - a.tscore : b.score - a.score; });
    var h = "<div style='margin:2px 0 6px;color:#9aa3b2'>" + list.length + " Items" + (equip ? " · <button data-wopt='mage'" + (wiki.mage_only ? " class='on'" : "") + ">nur " + esc(character.ctype) + "</button>" : "") + " · Sortierung: <button data-wsort='score'" + (srt == "score" ? " class='on'" : "") + ">Wert +0</button> <button data-wsort='tscore'" + (srt == "tscore" ? " class='on'" : "") + ">Wert Ziel</button> <button data-wsort='name'" + (srt == "name" ? " class='on'" : "") + ">Name</button> <button data-wsort='g'" + (srt == "g" ? " class='on'" : "") + ">Preis</button></div>";
    h += "<table class='lp_wt' style='width:100%'><tr><th>Item</th>" + (equip ? "<th>INT</th><th>ATK</th><th>ARM</th><th>RES</th><th>Wert +0</th><th>Ziel</th>" : "<th>Typ</th><th>Preis</th>") + "<th style='text-align:left'>Quelle</th></tr>";
    list.slice(0, 150).forEach(function (x) {
        var d = x.def, worn = false; for (var sl in character.slots) { var w = character.slots[sl]; if (w && w.name == x.name) worn = true; }
        var src = item_vendors(x.name).length ? "NPC " + fmt(d.g) : (function () { for (var t in G.tokens) if (G.tokens[t][x.name]) return "Tokens " + G.tokens[t][x.name]; var dr = item_drop_sources(x.name); if (dr.length) return "Drop " + ((G.monsters[dr[0].mon] || {}).name || dr[0].mon) + " " + (dr[0].p * 100).toFixed(dr[0].p < 0.001 ? 3 : 1) + "%"; if (G.craft && G.craft[x.name]) return "Rezept"; return "Markt"; })();
        h += "<tr class='lp_wl' data-wiki='item:" + x.name + "'" + (worn ? " style='color:#4caf50'" : "") + "><td>" + esc(d.name || x.name) + (worn ? " ✓" : "") + (d.class && d.class.indexOf(character.ctype) < 0 ? " <small style='color:#9aa3b2'>(" + d.class.join("/") + ")</small>" : "") + "</td>"
           + (equip ? "<td>" + (d.int || d.stat ? (d.int || 0) + (d.stat ? "+" : "") : "-") + "</td><td>" + (d.attack || "-") + "</td><td>" + (d.armor || "-") + "</td><td>" + (d.resistance || "-") + "</td><td>" + Math.round(x.score) + "</td><td>" + Math.round(x.tscore) + " <small>+" + default_target_level(d) + "</small></td>" : "<td>" + esc(d.type || "") + "</td><td>" + fmt(d.g || 0) + "</td>")
           + "<td style='text-align:left;color:#9aa3b2'>" + esc(src) + "</td></tr>";
    });
    return h + "</table>";
}
function init_wiki_panel() {
    var doc = parent.document, old = doc.getElementById("lp_wiki"); if (old) old.remove();
    var st = doc.getElementById("lp_wiki_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_wiki_style";
    st.textContent = "#lp_wiki{position:fixed;left:520px;top:160px;z-index:2147483000;pointer-events:auto;width:460px;background:#14161c;color:#e6e6e6;font:12px/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.5)}"
      + "#lp_wiki_head{display:flex;align-items:center;gap:6px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b}#lp_wiki_head b{flex:1;font-size:13px}"
      + "#lp_wiki button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}#lp_wiki button.on{background:#2e7d32;border-color:#4caf50}"
      + "#lp_wiki_bar{display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid #3a3f4b;align-items:center}#lp_wiki_q{flex:1;font:12px 'Segoe UI',Arial;padding:3px 6px;background:#1c2029;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_wiki_body{padding:8px 10px;max-height:calc(100vh - 260px);overflow-y:auto;overscroll-behavior:contain}"
      + ".lp_wl{cursor:pointer;padding:2px 4px;border-radius:3px}.lp_wl:hover{background:#2a2e38}.lp_wl small{color:#9aa3b2}"
      + "a.lp_wk{color:#8ab4f8;cursor:pointer;text-decoration:none}a.lp_wk:hover{text-decoration:underline}"
      + "table.lp_wt{border-collapse:collapse;font-size:11.5px;margin:4px 0}table.lp_wt td,table.lp_wt th{padding:2px 6px;border-bottom:1px solid #2f3440;text-align:right}table.lp_wt th{color:#9aa3b2;font-weight:normal}table.lp_wt td:first-child,table.lp_wt th:first-child{text-align:left}"
      + ".lp_wh{color:#9aa3b2;margin-top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.5px}";
    doc.head.appendChild(st);
    var div = doc.createElement("div"); div.id = "lp_wiki";
    div.innerHTML = "<div id='lp_wiki_head'><b>Wiki</b><button data-wtab='items'>Items</button><button data-wtab='monsters'>Monster</button><button data-wtab='npcs'>NPCs</button><button data-act='wikitoggle'>✕</button></div>"
      + "<div id='lp_wiki_bar'><button data-wiki='back' title='zurück'>◂</button><input id='lp_wiki_q' placeholder='Suche (Name oder Kürzel) …' value=''></div><div id='lp_wiki_body'></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_wiki_pos") || "null"); if (p) clamp_pos(div, p.x, p.y); } catch (e) {}
    return div;
}
function toggle_wiki_panel() {
    var on = !(wiki_panel && wiki_panel.parentNode);
    if (on) { wiki_panel = init_wiki_panel(); render_wiki(); } else { wiki_panel.remove(); wiki_panel = null; }
    try { localStorage.setItem("lp_wiki_open", on ? "1" : "0"); } catch (e) {}
}
function wiki_go(type, id) { if (wiki.page) wiki.hist.push(wiki.page); wiki.page = { type: type, id: id }; render_wiki(); }
function wiki_back() { wiki.page = wiki.hist.pop() || null; render_wiki(); }
function wk(type, id, label) { return "<a class='lp_wk' data-wiki='" + type + ":" + id + "'>" + esc(label || id) + "</a>"; }
function wiki_match(id, obj, q) { if (!q) return true; q = q.toLowerCase(); return id.toLowerCase().indexOf(q) >= 0 || String(obj.name || "").toLowerCase().indexOf(q) >= 0; }
function item_drop_sources(n) { var out = []; for (var m in G.drops.monsters) (G.drops.monsters[m] || []).forEach(function (x) { if (x[1] == n) out.push({ mon: m, p: x[0] }); }); out.sort(function (a, b) { return b.p - a.p; }); return out; }
function item_vendors(n) { var out = []; for (var id in G.npcs) { var x = G.npcs[id]; if (x.items && x.items.indexOf(n) >= 0) out.push(id); } return out; }
function scroll_for_level(def, lvl) { var g = def.grades || []; for (var i = 0; i < g.length; i++) if (lvl < g[i]) return i; return g.length; }
function render_wiki() {
    if (!wiki_panel || !wiki_panel.parentNode) return;
    wiki_panel.querySelectorAll("[data-wtab]").forEach(function (b) { b.className = b.getAttribute("data-wtab") == wiki.tab ? "on" : ""; });
    var h = "", q = wiki.q, pg = wiki.page;
    if (pg && pg.type == "item" && G.items[pg.id]) h = wiki_item(pg.id);
    else if (pg && pg.type == "mon" && G.monsters[pg.id]) h = wiki_monster(pg.id);
    else if (pg && pg.type == "npc" && G.npcs[pg.id]) h = wiki_npc(pg.id);
    else {
        var rows = [], n = 0;
        if (wiki.tab == "items") {
            h += "<div style='display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px'>" + WIKI_CATS.map(function (c) { return "<button data-wcat='" + c[0] + "'" + (wiki.cat == c[0] ? " class='on'" : "") + ">" + c[1] + "</button>"; }).join("") + "</div>";
            if (wiki.cat) { wiki_panel.querySelector("#lp_wiki_body").innerHTML = h + wiki_cat_html(wiki.cat); return; }
            if (!q) { wiki_panel.querySelector("#lp_wiki_body").innerHTML = h + "<div style='color:#9aa3b2'>Kategorie wählen oder suchen.</div>"; return; }
        }
        if (wiki.tab == "items") { for (var i in G.items) { var d = G.items[i]; if (!wiki_match(i, d, q)) continue; if (n++ > 80) break; rows.push("<div class='lp_wl' data-wiki='item:" + i + "'>" + esc(d.name || i) + " <small>" + i + " · " + esc(d.type || "") + (d.g ? " · " + fmt(d.g) + " G" : "") + "</small></div>"); } }
        else if (wiki.tab == "monsters") { for (var m in G.monsters) { var md = G.monsters[m]; if (!wiki_match(m, md, q)) continue; if (n++ > 80) break; rows.push("<div class='lp_wl' data-wiki='mon:" + m + "'>" + esc(md.name || m) + " <small>" + m + " · HP " + fmt(md.hp) + " · XP " + fmt(md.xp) + (is_safe_monster(m) ? " · <span style='color:#4caf50'>sicher</span>" : "") + "</small></div>"); } }
        else { for (var p in G.npcs) { var nd = G.npcs[p]; if (!wiki_match(p, nd, q)) continue; if (n++ > 80) break; rows.push("<div class='lp_wl' data-wiki='npc:" + p + "'>" + esc(nd.name || p) + " <small>" + p + " · " + esc(nd.role || "") + "</small></div>"); } }
        h += rows.length ? rows.join("") : "<div style='color:#9aa3b2'>nichts gefunden</div>";
    }
    wiki_panel.querySelector("#lp_wiki_body").innerHTML = h;
}
function wiki_item(n) {
    var d = G.items[n], h = "<div style='font-size:14px;font-weight:600'>" + esc(d.name || n) + " <small style='color:#9aa3b2;font-weight:normal'>" + n + " · " + esc(d.type || "") + (d.wtype ? "/" + d.wtype : "") + (d.class ? " · " + d.class.join("/") : "") + (d.set ? " · Set " + d.set : "") + "</small></div>";
    if (d.explanation) h += "<div style='color:#9aa3b2;font-style:italic'>" + esc(d.explanation) + "</div>";
    h += "<div class='lp_wh'>Werte</div><div>Basis: " + (esc(stat_line(d)) || "-") + "</div>";
    if (d.upgrade || d.compound) {
        h += "<div>je Stufe (" + (d.compound ? "Compound, 3 gleiche Teile" : "Upgrade") + "): " + esc(stat_line(d.upgrade || d.compound)) + "</div>";
        h += "<table class='lp_wt'><tr><th>Stufe</th><th>Wert</th><th>Scroll</th><th>Chance</th></tr>";
        var mx = d.compound ? 7 : 12, kind = d.compound ? "c" : "u";
        for (var L = 0; L <= mx; L++) { var gr = scroll_for_level(d, L), sc = (d.compound ? "cscroll" : "scroll") + gr; h += "<tr><td>+" + L + "</td><td>" + Math.round(gear_score(d, L)) + "</td><td>" + (L < mx ? sc + " (" + fmt((G.items[sc] || {}).g || 0) + ")" : "-") + "</td><td>" + (L < mx ? success_txt(kind, L) : "") + "</td></tr>"; }
        h += "</table>";
    }
    var sl = slot_for_item(d); if (sl) { var worn = character.slots[sl]; h += "<div>Passt in <b>" + sl + "</b>" + (worn ? " – du trägst " + wk("item", worn.name, worn.name) + "+" + (worn.level || 0) + " (Wert " + Math.round(item_score(worn)) + ")" : " – Slot leer") + "</div>"; }
    h += "<div class='lp_wh'>Quellen</div>";
    var v = item_vendors(n); if (v.length) h += "<div>NPC: " + v.map(function (id) { return wk("npc", id, (G.npcs[id].name || id)); }).join(", ") + " für " + fmt(d.g) + " Gold</div>";
    for (var t in G.tokens) if (G.tokens[t][n]) h += "<div>Tokens: " + G.tokens[t][n] + "× " + t + "</div>";
    var dr = item_drop_sources(n); if (dr.length) h += "<div>Drops: " + dr.slice(0, 12).map(function (x) { return wk("mon", x.mon, (G.monsters[x.mon] || {}).name || x.mon) + " " + (x.p * 100).toFixed(x.p < 0.001 ? 4 : 2) + "%"; }).join(", ") + "</div>";
    if (G.craft && G.craft[n]) h += "<div>Rezept: " + G.craft[n].items.map(function (x) { return x[0] + "× " + wk("item", x[1], (G.items[x[1]] || {}).name || x[1]); }).join(" + ") + (G.craft[n].cost ? " + " + fmt(G.craft[n].cost) + " Gold" : "") + (G.craft[n].quest ? " bei " + esc(G.craft[n].quest) : "") + "</div>";
    if (d.e) h += "<div>Tauschbar (" + d.e + " Stück) bei " + wk("npc", exchange_npc_for(n), (G.npcs[exchange_npc_for(n)] || {}).name || "?") + "</div>";
    var used = []; for (var c in G.craft) if (G.craft[c].items.some(function (x) { return x[1] == n; })) used.push(c); if (used.length) h += "<div>Zutat für: " + used.map(function (c) { return wk("item", c, (G.items[c] || {}).name || c); }).join(", ") + "</div>";
    if (!v.length && !dr.length && !(G.craft && G.craft[n])) h += "<div style='color:#9aa3b2'>keine bekannte Quelle außer Markt/Ponty/Tausch</div>";
    var seen = market_valid(n); if (seen) h += "<div>Zuletzt am Markt: " + fmt(seen.price) + " Gold (+" + seen.level + ") bei " + esc(seen.where) + "</div>";
    var go = global_offers.filter(function (o) { return o.name == n; }).sort(function (a, b) { return a.price - b.price; }).slice(0, 4);
    if (go.length) h += "<div>Händler (alle Server): " + go.map(offer_txt).map(esc).join(" · ") + "</div>";
    return h;
}
function wiki_monster(m) {
    var d = G.monsters[m], h = "<div style='font-size:14px;font-weight:600'>" + esc(d.name || m) + " <small style='color:#9aa3b2;font-weight:normal'>" + m + "</small></div>";
    h += "<table class='lp_wt'><tr><th>HP</th><th>Angriff</th><th>Typ</th><th>Tempo</th><th>Rüstung</th><th>Resist.</th><th>Ausweichen</th><th>Reflekt.</th><th>XP</th><th>Respawn</th></tr>"
       + "<tr><td>" + fmt(d.hp) + "</td><td>" + d.attack + " ×" + (d.frequency || 1) + "</td><td>" + (d.damage_type || "-") + "</td><td>" + d.speed + "</td><td>" + (d.armor || 0) + "</td><td>" + (d.resistance || 0) + "</td><td>" + (d.evasion || 0) + "%</td><td>" + (d.reflection || 0) + "%</td><td>" + fmt(d.xp) + "</td><td>" + (d.respawn || "-") + " s</td></tr></table>";
    var flags = []; if (d.aggro) flags.push("aggressiv"); if (d.rage) flags.push("Wut"); if (d.abilities) flags.push("Fähigkeiten: " + Object.keys(d.abilities).join(", ")); if (d.boss) flags.push("Boss"); if (d.cooperative) flags.push("kooperativ"); if (d.special) flags.push("Sonder"); if (d.lifesteal) flags.push("Lebensraub " + d.lifesteal + "%");
    if (flags.length) h += "<div>" + esc(flags.join(" · ")) + "</div>";
    var ttk = mon_ttk(d), dg = mon_danger(d);
    h += "<div class='lp_wh'>Für mich</div><div>" + (is_safe_monster(m) ? "<span style='color:#4caf50'>sicher</span>" : "<span style='color:#e57373'>nicht sicher</span>") + " · Kill in " + (isFinite(ttk) ? ttk.toFixed(1) + " s" : "∞") + " · kostet " + (isFinite(dg) ? Math.round(dg * 100) + " % HP" : "-") + " · geschätzt " + fmt(mon_xph_est(d, m)) + " XP/h" + (farm_stats[m] ? " · gemessen " + fmt(farm_stats[m].xp_h) + " XP/h, " + fmt(farm_stats[m].gold_h) + " G/h" : "") + "</div>";
    var maps = []; for (var mp in G.maps) { var md = G.maps[mp]; if (!md.monsters) continue; var c = 0; md.monsters.forEach(function (e) { if (e.type == m) c += e.count || 1; }); if (c) maps.push((md.name || mp) + " (" + c + ")"); }
    h += "<div class='lp_wh'>Wo</div><div>" + (maps.length ? esc(maps.join(", ")) : "nur Event/Spawn") + "</div>";
    var dr = (G.drops.monsters[m] || []).slice().sort(function (a, b) { return b[0] - a[0]; });
    h += "<div class='lp_wh'>Drops</div><div>" + (dr.length ? dr.map(function (x) { var it = x[1]; return (G.items[it] ? wk("item", it, G.items[it].name || it) : esc(String(it))) + " " + (x[0] * 100).toFixed(x[0] < 0.001 ? 4 : 2) + "%"; }).join(", ") : "keine Item-Drops (nur Gold)") + "</div>";
    if (mh_quest() && mh_quest().id == m) h += "<div>Aktuelle Jagd: noch " + mh_quest().c + "</div>";
    return h;
}
function wiki_npc(id) {
    var d = G.npcs[id], h = "<div style='font-size:14px;font-weight:600'>" + esc(d.name || id) + " <small style='color:#9aa3b2;font-weight:normal'>" + id + " · " + esc(d.role || "") + "</small></div>";
    if (d.says) h += "<div style='color:#9aa3b2;font-style:italic'>„" + esc(d.says) + "“</div>";
    var where = []; for (var mp in G.maps) { (G.maps[mp].npcs || []).forEach(function (x) { if (x.id == id) where.push((G.maps[mp].name || mp) + (x.position ? " (" + Math.round(x.position[0]) + "," + Math.round(x.position[1]) + ")" : "")); }); }
    h += "<div class='lp_wh'>Wo</div><div>" + (where.length ? esc(where.join(", ")) : "-") + "</div>";
    if (d.items && d.items.length) h += "<div class='lp_wh'>Verkauft</div><div>" + d.items.filter(Boolean).map(function (n) { return wk("item", n, (G.items[n] || {}).name || n) + " (" + fmt((G.items[n] || {}).g || 0) + ")"; }).join(", ") + "</div>";
    if (d.quest) h += "<div>Quest/Tausch: " + esc(d.quest) + "</div>";
    if (d.token) h += "<div>Token-Händler: " + esc(d.token) + " – " + Object.keys(G.tokens[d.token] || {}).map(function (n) { return wk("item", n, n) + " " + G.tokens[d.token][n]; }).join(", ") + "</div>";
    return h;
}
// ---------- Wunschliste: fester Zielbau für den Magier ----------
// Schaden kommt aus INT und Waffenangriff. Rüstung gibt je Stufe nur +1 INT, deshalb zuerst Waffe, Buch und INT-Schmuck.
var WISH_RESERVE = SOLO ? 30000 : 1000000;          // so viel Gold bleibt bei Käufen/Upgrades immer übrig
var DEFAULT_WISHLIST = {              // Vorgabe je Slot (beste Wahl zuerst) – per Zielbau-Auswahl im Panel überschreibbar
    mainhand: ["harbringer", "firestaff", "froststaff"],
    offhand:  ["wbook1", "wbook0"],
    earring1: ["cearring", "intearring"], earring2: ["cearring", "intearring"],
    amulet:   ["t2intamulet", "intamulet"],
    belt:     ["intbelt"],
    orb:      ["orbofint", "orbg"],
    ring1:    ["cring", "intring", "ringsj"], ring2: ["cring", "intring", "ringsj"],
    helmet: ["mmhat"], chest: ["mmarmor"], pants: ["mmpants"], gloves: ["mmgloves"], shoes: ["mmshoes"]
};
var WISHLIST = {};                    // aktive Liste je Slot (aus Zielbau-Auswahl oder Vorgabe)
var wish_cfg = {}; try { wish_cfg = JSON.parse(localStorage.getItem("lp_wish_" + character.name) || "{}"); } catch (e) {}
function save_wish_cfg() { try { localStorage.setItem("lp_wish_" + character.name, JSON.stringify(wish_cfg)); } catch (e) {} rebuild_wishlist(); goal_cache_t = 0; last_panel = 0; }
function rebuild_wishlist() { // Vorgabe je Slot: das getragene Teil auf seiner jetzigen Stufe (nichts passiert, bis du etwas änderst)
    WISHLIST = {};
    for (var sl2 in SLOT_TYPES) {
        var c = wish_cfg[sl2];
        if (c && c.item && G.items[c.item]) WISHLIST[sl2] = [c.item];
        else if (c && c.item === "") continue;
        else { var w = character.slots[sl2]; if (w && G.items[w.name]) { WISHLIST[sl2] = [w.name]; wish_cfg[sl2] = { item: w.name, level: w.level || 0, auto: true }; } }
    }
}
function reset_wish_to_worn() { wish_cfg = {}; for (var sl in SLOT_TYPES) { var w = character.slots[sl]; wish_cfg[sl] = w && G.items[w.name] ? { item: w.name, level: w.level || 0 } : { item: "" }; } save_wish_cfg(); game_log("Zielbau auf aktuelle Ausrüstung gesetzt – nichts wird verändert, bis du einen Slot umstellst"); }
function default_target_level(def) { // Vorgabe: kaufbare Teile +7 / +3, seltene (nicht nachkaufbare) vorsichtiger +5 / +2 – im Zielbau änderbar
    var name = null; for (var n in G.items) if (G.items[n] === def) { name = n; break; }
    var buyable = name ? is_buyable(name) : false;
    if (def.compound) return buyable ? COMPOUND_TARGET : 2;
    if (def.upgrade) return buyable ? AUTO_ARMOR_MAX : 5;
    return 0;
}
function wish_item(slot) { return (WISHLIST[slot] || [])[0] || null; }
function wish_level(slot) { // gewünschte Stufe für das Zielitem des Slots
    var c = wish_cfg[slot], it = wish_item(slot); if (!it) return 0;
    if (c && c.item == it && typeof c.level == "number") return c.level;
    var w = character.slots[slot]; if (w && w.name == it) return w.level || 0;
    return default_target_level(G.items[it]);
}
function cand_level(d, slot) { // Stufe, auf der Kandidaten bewertet werden: die im Zielbau eingestellte Stufe des Slots (auf das Maximum des Typs begrenzt), sonst die Vorgabe
    var c = wish_cfg[slot], L = c && typeof c.level == "number" ? c.level : wish_item(slot) ? wish_level(slot) : default_target_level(d);
    var mx = d.compound ? 7 : d.upgrade ? 12 : 0; return Math.max(0, Math.min(mx, L));
}
function slot_candidates(slot) { // alle Items, die in den Slot passen (Klasse beachtet), nach Wert auf der eingestellten Zielstufe sortiert
    var out = [];
    for (var n in G.items) { var d = G.items[n]; if (!d || d.ignore || !d.type || !fits_slot(d, slot)) continue; if (!d.upgrade && !d.compound && !d.int && !d.attack) continue; var L = cand_level(d, slot); out.push({ name: n, def: d, level: L, score: gear_score(d, L) }); }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
}
function stat_line(st) { var keys = ["int", "str", "dex", "vit", "attack", "range", "frequency", "hp", "mp", "armor", "resistance", "rpiercing", "apiercing", "evasion", "luck", "gold", "xp", "speed", "stat"]; var p = []; keys.forEach(function (k) { if (st && st[k]) p.push((k == "stat" ? "Hauptattr." : k) + " " + st[k]); }); return p.join(", "); }
function item_source(n) { var d = G.items[n], src = []; if (is_buyable(n)) src.push("NPC " + fmt(d.g)); for (var t in G.tokens) if (G.tokens[t][n]) src.push(t + " " + G.tokens[t][n]); var mons = []; for (var m in G.drops.monsters) (G.drops.monsters[m] || []).forEach(function (x) { if (x[1] == n) mons.push(m + " " + (x[0] * 100).toFixed(2) + "%"); }); if (mons.length) src.push("Drop: " + mons.slice(0, 4).join(", ")); return src.length ? src.join(" · ") : "nur Markt/Ponty"; }
function item_tooltip(n, L) { var d = G.items[n]; if (typeof L != "number") L = default_target_level(d); return (d.name || n) + " [" + n + "]\nBasis: " + (stat_line(d) || "-") + "\nje Stufe (" + (d.compound ? "Compound" : "Upgrade") + "): " + (stat_line(d.upgrade || d.compound) || "-") + "\nQuelle: " + item_source(n) + "\nWert +0: " + Math.round(gear_score(d, 0)) + ", auf +" + L + ": " + Math.round(gear_score(d, L)); }
// Bauen oder kaufen? Erwartete Kosten des eigenen Ausbaus (inkl. Zerstörungsrisiko) gegen das beste Angebot aller Server
function build_vs_buy(slot) {
    var item = wish_item(slot); if (!item) return null;
    var def = G.items[item], tl = wish_level(slot), worn = character.slots[slot];
    var have = worn && worn.name == item ? (worn.level || 0) : -1;
    if (have < 0) { var inv = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == item && (it.level || 0) > inv) inv = it.level || 0; } if (inv >= 0) have = inv; }
    var build = { from: have, cost: 0, p: 1, possible: true, note: "" };
    if (have >= tl) { build.cost = 0; build.note = "Ziel erreicht"; }
    else {
        var start = have >= 0 ? have : 0;
        if (have < 0) {
            var tok = G.tokens && G.tokens.monstertoken && G.tokens.monstertoken[item];
            if (is_buyable(item)) build.cost += base_price(def, item);
            else if (tok) { build.note = "Basis: " + tok + " Monstertokens (hast " + tokens() + ")"; if (tokens() < tok) build.possible = false; }
            else { build.possible = false; build.note = "Basis fehlt (nur Drop/Markt)"; }
        }
        for (var l = start; l < tl; l++) { build.cost += step_cost(item, l); build.p *= def.compound ? success_p("c", l) : success_p("u", l); }
        if (!def.compound && !is_buyable(item) && have >= 0) build.note = "Verlustrisiko " + Math.round((1 - build.p) * 100) + " % (nicht nachkaufbar)";
    }
    var offers = global_offers.filter(function (o) { return o.name == item && o.price <= Math.max(0, slot_budget(slot)); });
    var best = null;
    offers.forEach(function (o) {
        var rest = 0, pr = 1; for (var l = o.level; l < tl; l++) { rest += step_cost(item, l); pr *= def.compound ? success_p("c", l) : success_p("u", l); }
        var total = o.price + rest;
        if (!best || total < best.total) best = { price: o.price, level: o.level, server: o.server, seller: o.seller, same: o.same, rest: rest, total: total, p: pr };
    });
    if (!build.possible) build.cost = 0;
    var over = best && !wish_wants(item, best.level, best.price) ? true : false; // Angebot da, aber über der Preisgrenze
    var verdict;
    if (have >= tl) verdict = "fertig";
    else if (!best) verdict = build.possible ? "bauen (kein Angebot)" : (/tokens/i.test(build.note) ? "Tokens sammeln (Monster Hunt)" : "warten (kein Angebot, keine Basis)");
    else if (over) verdict = (build.possible ? "bauen" : "warten") + " – Angebot über Preisgrenze (" + fmt(best.price) + ", Limit im Zielbau anheben oder direkt „Kaufen“)";
    else if (!build.possible) verdict = "kaufen (einzige Option)";
    else verdict = best.total < build.cost * 0.9 ? "kaufen (spart ~" + fmt(build.cost - best.total) + ")" : build.cost < best.total * 0.9 ? "bauen (spart ~" + fmt(best.total - build.cost) + ")" : "egal (ähnlich teuer)";
    return { item: item, target: tl, build: build, buy: best, verdict: verdict };
}
function bvb_html(slot) {
    var r = build_vs_buy(slot); if (!r) return "-";
    var b = r.build, o = r.buy, col = /^kaufen/.test(r.verdict) ? "#8ab4f8" : /^bauen/.test(r.verdict) ? "#4caf50" : "#9aa3b2";
    var h = "<div style='color:" + col + ";font-weight:600'>" + esc(r.verdict) + "</div>";
    h += "<div style='color:#9aa3b2'>bauen: " + (b.from >= r.target ? "–" : (b.possible ? "~" + fmt(b.cost) + (b.from >= 0 ? " ab +" + b.from : " ab Kauf") + (b.p < 0.999 ? ", überlebt " + Math.round(b.p * 100) + " %" : "") : "nicht möglich – " + b.note)) + "</div>";
    h += "<div style='color:#9aa3b2'>kaufen: " + (o ? fmt(o.price) + " für +" + o.level + (o.rest ? " + ~" + fmt(o.rest) + " Ausbau" : "") + " = ~" + fmt(o.total) + " (" + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + ")" : "kein Angebot") + "</div>";
    return h;
}
var alt_target = null; // Zwischenlösung, die per Button gekauft werden soll
function alt_offer_for(slot) { // günstiges Teil, das JETZT besser wäre als das Getragene (kein Zielitem), aus gesehenen Angeboten: Markt/Ponty hier + Händler dieser Server
    var worn = character.slots[slot], ws = worn ? item_score(worn) * 1.1 : 0, wish = wish_item(slot), best = null;
    var consider = function (name, level, price, where, same) {
        var def = G.items[name]; if (!def || !fits_slot(def, slot) || name == wish || price > NONWISH_MAX_PRICE || price > Math.max(0, wish_budget())) return;
        var sc = gear_score(def, level || 0); if (sc <= ws) return;
        var v = (sc - ws) / price; if (!best || v > best.v) best = { name: name, level: level || 0, price: price, where: where, same: same, score: sc, v: v };
    };
    for (var n in market_seen) { var m = market_valid(n); if (m) consider(n, m.level, m.price, m.where, true); }
    global_offers.forEach(function (o) { if (o.same) consider(o.name, o.level, o.price, o.seller, true); });
    return best;
}
function alt_html(slot) {
    var a = alt_offer_for(slot); if (!a) return "<span style='color:#9aa3b2'>–</span>";
    var worn = character.slots[slot];
    return "<span title='" + esc(item_tooltip(a.name)) + "'>" + esc(a.name) + "+" + a.level + " " + fmt(a.price) + "<br><small style='color:#9aa3b2'>" + esc(a.where) + " · Wert " + Math.round(a.score) + (worn ? " statt " + Math.round(item_score(worn)) : "") + "</small></span> <button data-act='buyalt' data-slot='" + slot + "' data-item='" + a.name + "' title='nur auf Klick, nie automatisch'>Kaufen</button>";
}
async function buy_alternative(slot, name) {
    var a = alt_offer_for(slot); if (!a || a.name != name) { game_log("Zwischenlösung " + name + " nicht mehr im Angebot"); return; }
    alt_target = { name: a.name, level: a.level, price: a.price };
    upgrading = true; busy = true;
    try {
        game_log("Zwischenlösung: kaufe " + a.name + "+" + a.level + " für " + slot + " (" + fmt(a.price) + ", " + a.where + ")");
        if (/ponty/i.test(a.where)) await check_ponty(true); else await check_market(true);
        var here = global_finds.concat(global_offers).filter(function (o) { return o.same && o.name == a.name; })[0];
        if (here && locate_item(a.name) < 0) await buy_find(Object.assign({ slot: slot }, here));
        await ensure_best_equipped();
    } catch (e) { game_log("Zwischenlösung: " + err_txt(e)); }
    alt_target = null; upgrading = false; busy = false;
    after_action("Zwischenlösung");
}
function farm_html(slot) { // Zielitem als Drop farmbar?
    var item = wish_item(slot); if (!item) return "";
    var worn = character.slots[slot]; if (worn && worn.name == item) return "";
    var src = best_farm_source(item); if (!src) return "";
    return "<div style='margin-top:3px'><small style='color:#9aa3b2'>Farmen: " + esc(src.mon) + " " + (src.chance * 100).toFixed(src.chance < 0.001 ? 3 : 2) + " % ≈ " + fmt_time(src.hours * 3600000) + "</small> <button data-act='farmwish' data-mon='" + src.mon + "' title='diesen Spot fest farmen (Automatik über Auto zurück)'>Farmen</button></div>";
}
function wish_ui_html() { // Zielbau-Tabelle
    var h = "<table class='lp_t lp_wish' style='table-layout:fixed;width:100%'><colgroup><col style='width:58px'><col style='width:158px'><col style='width:46px'><col style='width:135px'><col style='width:175px'><col style='width:150px'><col style='width:110px'><col style='width:48px'></colgroup><tr><th style='text-align:left'>Slot</th><th style='text-align:left'>Zielitem (Wert auf eingestellter Stufe)</th><th title='Zielstufe · max = Preislimit in Mio.'>Stufe / Limit</th><th style='text-align:left'>Stand</th><th style='text-align:left'>Bauen oder kaufen?</th><th style='text-align:left'>Angebote alle Server (★ = hier)</th><th style='text-align:left'>Zwischenlösung (nur auf Klick)</th><th></th></tr>";
    for (var slot in SLOT_TYPES) {
        var cands = slot_candidates(slot).slice(0, 60), cur = wish_item(slot), worn = character.slots[slot];
        var sel = "<select data-wslot='" + slot + "' style='max-width:150px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>";
        sel += "<option value=''" + (!cur ? " selected" : "") + ">– kein Ziel –</option>";
        cands.forEach(function (c) { sel += "<option value='" + c.name + "'" + (c.name == cur ? " selected" : "") + " title='" + esc(item_tooltip(c.name, c.level)) + "'>" + esc((c.def.name && c.def.name != c.name ? c.def.name + " [" + c.name + "]" : c.name)) + " (" + Math.round(c.score) + ")</option>"; });
        sel += "</select>";
        var lv = "";
        if (cur) { var d = G.items[cur], mx = d.compound ? 7 : 12, wl = wish_level(slot); lv = "<select data-wlvl='" + slot + "' style='font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>"; for (var L = 0; L <= mx; L++) lv += "<option value='" + L + "'" + (L == wl ? " selected" : "") + ">+" + L + "</option>"; lv += "</select>"; }
        if (cur) { var smx = slot_max(slot); lv += "<br><input data-wmax='" + slot + "' value='" + (smx ? fmt_mio(smx) : "") + "' placeholder='max' style='width:40px;font-size:10px;margin-top:2px;background:#1c2029;color:#eee;border:1px solid " + (smx ? "#ffb74d" : "#555") + ";text-align:right' title='Preislimit in Mio. Gold für dieses Zielitem (z. B. 3 oder 1,5) – leer = automatische Grenze" + (smx ? "\naktuell " + fmt(smx) : "") + "'>"; }
        var stand = worn ? esc(worn.name) + "+" + (worn.level || 0) : "<span style='color:#ef5350'>leer</span>";
        if (cur && !is_buyable(cur) && G.items[cur].upgrade) stand += " <small style='color:#9aa3b2'>Reserve " + reserve_count(cur) + "/" + RESERVE_COPIES + "</small>";
        if (cur) { var ok = worn && worn.name == cur, done = ok && (worn.level || 0) >= wish_level(slot); stand = "<span style='color:" + (done ? "#4caf50" : ok ? "#8ab4f8" : "#e57373") + "' title='" + esc(cur + " – " + item_tooltip(cur, wish_level(slot))) + "'>" + stand + (done ? " ✓" + (wish_cfg[slot] && wish_cfg[slot].auto ? " <small>(Ist-Stand)</small>" : "") : ok ? " → +" + wish_level(slot) : " → " + esc(cur)) + "</span>"; }
        h += "<tr><td style='text-align:left'>" + slot + "</td><td style='text-align:left'>" + sel + "</td><td style='text-align:center'>" + lv + "</td><td style='text-align:left'>" + stand + "</td><td style='text-align:left;font-size:11px'>" + (cur ? bvb_html(slot) + farm_html(slot) : "-") + "</td><td style='text-align:left'>" + offers_html(slot) + "</td><td style='text-align:left;font-size:11px'>" + alt_html(slot) + "</td><td style='text-align:center'><button data-act='slotnow' data-slot='" + slot + "' title='diesen Slot jetzt angehen'>Jetzt</button></td></tr>";
    }
    return h + "</table>";
}

var WISH_MAX = { harbringer: 4000000, firestaff: 2500000, froststaff: 2500000, wbook1: 5000000, wbook0: 800000, cearring: 2000000, intearring: 800000, t2intamulet: 2500000, intamulet: 800000, intbelt: 800000, orbofint: 2500000, orbg: 500000, cring: 2000000, intring: 500000, ringsj: 300000, mmhat: 1500000, mmarmor: 1500000, mmpants: 1500000, mmgloves: 1500000, mmshoes: 2000000 };
var HP_JEWELRY = /^(hpamulet|hpbelt)$/;   // nur HP – für Magierschaden wertlos, wird verkauft statt compoundet
var AUTO_GEAR = true, AUTO_GEAR_INTERVAL = 30 * 60000, last_auto_gear = Math.max(rt("last_auto_gear", 0), Date.now() - 20 * 60000), WEAPON_SAFE_TARGET = 7, AUTO_ARMOR_MAX = 7;
var NONWISH_MAX_PRICE = 400000; // Käufe außerhalb des Zielbaus ("jetzt besser") nur bis zu diesem Preis
var auto_mode = false; // läuft die Ausrüstungsroutine gerade automatisch?
var last_best_check = 0;
function best_equip_tick() {
    if (busy || upgrading || paused || Date.now() - last_best_check < 5 * 60000) return; last_best_check = Date.now();
    if (bank_better_for().length) { busy = true; retrieve_better_from_bank().catch(function () {}).then(function () { busy = false; if (!paused) go_to_farm_spot(); }); }
    else ensure_best_equipped().catch(function () {});
}
function wish_rank(slot, name) { var l = WISHLIST[slot]; if (!l) return -1; var i = l.indexOf(name); return i < 0 ? -1 : l.length - i; } // höher = besser, -1 = nicht auf der Liste
function on_wishlist(name) { for (var sl in WISHLIST) if (WISHLIST[sl].indexOf(name) >= 0) return true; return false; }
function wish_budget() { return character.gold - WISH_RESERVE; }
function wish_inv_rank(slot) { var best = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it) best = Math.max(best, wish_rank(slot, it.name)); } return best; }
var focus_only = null; // während "Jetzt": nur dieser Slot darf kaufen
function parse_mio(v) { var t = String(v || "").trim().toLowerCase().replace(/mio\.?|m|€|g|\s/g, "").replace(",", "."); var n = parseFloat(t); if (!isFinite(n) || n <= 0) return 0; return n >= 10000 ? Math.round(n) : Math.round(n * 1000000); } // "3" / "1,5" = Mio., große Zahlen = Gold
function fmt_mio(g) { var m = g / 1000000; return (Math.round(m * 100) / 100).toString().replace(".", ","); }
function slot_max(slot) { var c = wish_cfg[slot]; return c && c.max > 0 ? c.max : 0; } // vom Nutzer gesetztes Preislimit je Slot (0 = automatische Grenze)
function slot_budget(slot) { return slot_max(slot) ? character.gold : wish_budget(); } // mit eigenem Limit darf auch die Goldreserve angegriffen werden
function wish_wants(name, level, price, force_slot) { // Slot, für den dieses Angebot die Wunschliste verbessert – sonst null; force_slot: vom Nutzer erzwungener Kauf (nur Gold muss reichen)
    var def = G.items[name]; if (!def || price == null) return null;
    if (force_slot) return price <= character.gold ? force_slot : null;
    for (var slot in WISHLIST) {
        if (focus_only && slot != focus_only) continue;
        var r = wish_rank(slot, name); if (r < 0) continue;
        var tl = wish_level(slot), own = 0; try { own = cost_to_reach(name, Math.min(Math.max(level || 0, 0), tl)) * 1.5; } catch (e) {}
        var cap = Math.max(WISH_MAX[name] || 0, def.g * 8, is_buyable(name) ? 0 : own, slot_max(slot)); // nicht kaufbare: bis zu den eigenen Baukosten bis zur angebotenen Stufe (inkl. Risiko); eigenes Limit im Zielbau hebt die Grenze
        if (price > cap || price > slot_budget(slot)) continue;
        var worn = character.slots[slot], wr = worn ? Math.max(0, wish_rank(slot, worn.name)) : 0;
        if (wish_inv_rank(slot) >= r && !(worn && worn.name == name)) continue; // liegt schon (besser) im Inventar
        if (r > wr) return slot;
        if (r == wr && worn && (level || 0) > (worn.level || 0) && ((level || 0) >= tl || ((level || 0) >= (worn.level || 0) + 2 && price <= cap / 2))) return slot; // gleiches Teil höher: auf Zielstufe immer, sonst deutlich höher und günstig
    }
    return null;
}
function wish_status() { // je Slot: getragen / fehlt
    var out = [];
    for (var slot in WISHLIST) {
        var l = WISHLIST[slot], worn = character.slots[slot], r = worn ? Math.max(0, wish_rank(slot, worn.name)) : 0;
        var inv = wish_inv_rank(slot);
        var name = worn ? worn.name : null, seen = market_valid(l[0]) || (l[1] ? market_valid(l[1]) : null);
        var top = r == l.length && (!worn || (worn.level || 0) >= wish_level(slot));
        out.push({ slot: slot, have: r > 0, top: top, worn: name, want: l[0], inv: inv > r, seen: seen, rank: r, max: l.length });
    }
    return out;
}
function wish_text() { var st = wish_status(), have = st.filter(function (x) { return x.have; }).length; return have + "/" + st.length; }
function wish_html() {
    var st = wish_status(), parts = [];
    st.forEach(function (x) {
        var col = x.top ? "#4caf50" : x.have ? "#8ab4f8" : "#e57373";
        var txt = x.have ? x.worn : x.want;
        var tip = x.have ? (x.top ? "erledigt" : "getragen: " + x.worn + " – besser wäre " + WISHLIST[x.slot][0]) : "fehlt: " + x.want + (x.seen ? " (gesehen für " + fmt(x.seen.price) + " bei " + x.seen.where + ")" : " – noch nirgends gesehen");
        parts.push("<span title='" + esc(tip) + "' style='color:" + col + "'>" + esc(x.slot) + ": " + esc(txt) + (x.inv ? " (im Inv.)" : "") + "</span>");
    });
    return parts.join(" · ");
}
async function wish_buy_from_offer(o, buy_fn) { // o: {name, level, price, force?, slot?}; buy_fn: async -> true bei Erfolg
    var slot = wish_wants(o.name, o.level, o.price, o.force ? o.slot : null);
    if (!slot) { game_log("Kauf " + o.name + "+" + (o.level || 0) + " abgelehnt: " + (o.price > character.gold ? "nicht genug Gold" : "über Preisgrenze")); return false; }
    if (character.esize < 2) { game_log("Kauf " + o.name + ": Inventar voll"); return false; }
    game_log((slot == "markt" ? "Markt: kaufe " : "Wunschliste: kaufe ") + o.name + "+" + (o.level || 0) + (slot == "markt" ? "" : " für " + slot) + " (" + fmt(o.price) + " Gold)");
    var before = character.esize;
    try { if (!await buy_fn()) return false; } catch (e) { game_log("Wunschliste: Kauf fehlgeschlagen – " + err_txt(e)); return false; }
    await sleep(1500);
    if (character.esize >= before) { game_log("Wunschliste: " + o.name + " nicht erhalten"); return false; }
    note_bought(o.name);
    try { global_offers = global_offers.filter(function (g) { return !(g.name == o.name && g.level == (o.level || 0) && g.price == o.price && g.seller == o.seller); }); if (o.seller) global_offers = global_offers.filter(function (g) { return !(g.seller == o.seller && g.name == o.name && g.price == o.price); }); global_finds = global_finds.filter(function (g) { return !(g.name == o.name && g.price == o.price && g.seller == o.seller); }); server_targets = server_targets.filter(function (g) { return !(g.name == o.name && g.price == o.price && g.seller == o.seller); }); save_server_targets(); last_global_scan = 0; parent.__lp_global_offers = global_offers; } catch (e) {}
    var idx = -1, bl = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == o.name && (it.level || 0) > bl) { idx = i; bl = it.level || 0; } }
    if (idx >= 0 && slot != "markt") {
        var worn_now = character.slots[slot];
        if (!worn_now || item_score(character.items[idx]) >= item_score(worn_now)) { try { equip(idx, slot); await sleep(800); game_log("Wunschliste: " + o.name + "+" + bl + " angelegt (" + slot + ") – jetzt " + wish_text()); } catch (e) {} }
        else game_log("Wunschliste: " + o.name + "+" + bl + " bleibt im Inventar – " + worn_now.name + "+" + (worn_now.level || 0) + " ist aktuell stärker (" + Math.round(item_score(worn_now)) + " vs " + Math.round(item_score(character.items[idx])) + "), wird erst ausgebaut");
    }
    return true;
}
async function rebuild_with_stat(slot, tgt) { // neue Kopie mit Attribut (Scroll vor dem Sprung auf Qualität 1) bauen, anlegen, altes Teil verkaufen
    var worn = character.slots[slot], name = worn.name;
    game_log("Slot " + slot + ": " + name + "+" + (worn.level || 0) + " hat kein " + STAT_TYPE.toUpperCase() + " und nimmt keinen Scroll mehr – baue neue Kopie mit Attribut bis +" + tgt);
    await travel_place("upgrade");
    for (var tries = 0; tries < 30; tries++) {
        check_pause();
        // Startkopie: beste Kopie ohne Attribut-Konflikt unter Qualität 1 (Reserve), sonst neu kaufen
        var start = -1, sl = -1;
        for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && !it.p && (it.stat_type == STAT_TYPE || !it.stat_type) && (it.level || 0) <= grade0_max(name) && (it.level || 0) > sl) { sl = it.level || 0; start = i; } }
        if (start < 0) { if (!is_buyable(name)) { game_log(name + " nicht nachkaufbar – kein Neubau"); return; } if (!await buy_items(name, 1)) return; sl = 0; }
        var r = await upgrade_inv(name, sl, tgt, STAT_TYPE);
        if (r.stopped) return;
        if (r.destroyed) { game_log(name + " beim Neubau zerstört – nächster Versuch"); continue; }
        var ni = -1; for (var j = 0; j < character.items.length; j++) { var it2 = character.items[j]; if (it2 && it2.name == name && (it2.level || 0) >= tgt && it2.stat_type == STAT_TYPE) { ni = j; break; } }
        if (ni < 0) { game_log(name + "+" + tgt + " ohne Attribut geworden – bleibt als Reserve, nächster Versuch"); continue; }
        equip(ni, slot); await sleep(800);
        game_log("Slot " + slot + ": " + name + "+" + tgt + " mit " + STAT_TYPE.toUpperCase() + " angelegt");
        // altes Teil (ohne Attribut, Qualität 1) verkaufen
        var oi = -1; for (var k = 0; k < character.items.length; k++) { var it3 = character.items[k]; if (it3 && it3.name == name && (it3.level || 0) >= tgt && it3.stat_type != STAT_TYPE) { oi = k; break; } }
        if (oi >= 0) { await travel_place("potions"); var g0 = character.gold; await sell_measured(oi, 1); game_log("Altes " + name + "+" + tgt + " verkauft (+" + fmt(character.gold - g0) + ")"); }
        if (!has_backup(name) && is_buyable(name)) { await travel_place("upgrade"); await ensure_backup(name); }
        return;
    }
}
async function focus_slot(slot) { // Button "Jetzt": diesen Slot sofort verbessern – Wunschliste am Markt/Ponty, sonst getragenes Teil ausbauen
    if (upgrading) { game_log("Upgrade läuft bereits"); return; }
    var worn = character.slots[slot], want = (WISHLIST[slot] || [])[0];
    game_log("Slot " + slot + " gezielt: getragen " + (worn ? worn.name + "+" + (worn.level || 0) : "leer") + (want ? ", Wunsch " + WISHLIST[slot].join(" > ") : ""));
    upgrading = true; busy = true; set_message(slot); focus_only = slot;
    var saved_reserve = GOLD_RESERVE; GOLD_RESERVE = Math.max(GOLD_RESERVE, WISH_RESERVE);
    try {
        var r0 = worn ? Math.max(0, wish_rank(slot, worn.name)) : 0;
        if (WISHLIST[slot] && r0 < WISHLIST[slot].length) {
            var hit = null; try { hit = await scan_all_merchants(true, slot); } catch (e) { game_log("Händlerscan: " + err_txt(e)); }
            var ofs = offers_for_slot(slot).slice(0, 4);
            game_log("Angebote für " + slot + (ofs.length ? ": " + ofs.map(offer_txt).join(" · ") : ": nichts Besseres auf allen Servern"));
            var bvb = build_vs_buy(slot); if (bvb) game_log("Bauen oder kaufen (" + bvb.item + " +" + bvb.target + "): " + bvb.verdict + " – bauen " + (bvb.build.possible ? "~" + fmt(bvb.build.cost) + (bvb.build.p < 0.999 ? " (überlebt " + Math.round(bvb.build.p * 100) + " %)" : "") : "nicht möglich (" + bvb.build.note + ")") + ", kaufen " + (bvb.buy ? "~" + fmt(bvb.buy.total) + " auf " + pretty_server(bvb.buy.server) : "kein Angebot"));
            if (hit) { pending_buy = null; try { await buy_find(hit); } catch (e) { game_log("Händler-Kauf: " + err_txt(e)); } }
            await check_ponty(true); await check_market(true);
        }
        await reequip_slot(slot); await ensure_best_equipped();
        if (bank_better_for(slot).length) { await retrieve_better_from_bank(slot); }
        worn = character.slots[slot];
        if (worn && G.items[worn.name].compound) { check_pause(); await travel_place("compound"); await compound_slot(slot); await compound_spares(); await ensure_best_equipped(); }
        else if (worn && G.items[worn.name].upgrade) {
            var tgt = slot_target(slot, is_buyable(worn.name) ? UPGRADE_TARGET : (slot == "mainhand" ? WEAPON_SAFE_TARGET : SAFE_TARGET_DROP), 0);
            if ((worn.level || 0) < tgt) { check_pause(); game_log("Slot " + slot + ": " + worn.name + " +" + (worn.level || 0) + " → +" + tgt + " (Chance nächste Stufe " + success_txt("u", worn.level || 0) + ")"); await travel_place("upgrade"); await process_slot(slot, tgt); }
            else if (wish_item(slot) == worn.name && worn.stat_type != STAT_TYPE && G.items[worn.name].stat && (worn.level || 0) > grade0_max(worn.name)) { check_pause(); await rebuild_with_stat(slot, tgt); }
            else game_log("Slot " + slot + ": " + worn.name + "+" + (worn.level || 0) + " ist schon auf Zielstufe +" + tgt);
        }
        worn = character.slots[slot];
        var st = wish_status().filter(function (x) { return x.slot == slot; })[0];
        game_log("Slot " + slot + ": jetzt " + (worn ? worn.name + "+" + (worn.level || 0) : "leer") + (st && !st.top ? " – Wunsch " + WISHLIST[slot][0] + (st.seen ? " zuletzt gesehen für " + fmt(st.seen.price) + " bei " + st.seen.where : " bisher nirgends angeboten") : " – Wunschliste erfüllt"));
    } catch (e) { game_log("Slot " + slot + ": " + err_txt(e)); }
    focus_only = null; GOLD_RESERVE = saved_reserve; upgrading = false; busy = false;
    after_action("Slot");
}
function auto_gear_tick() { // regelmäßig Gold in Ausrüstung umsetzen (Waffe -> Schmuck -> Rüstung), ohne U
    if (!AUTO_GEAR || busy || upgrading || paused || pending_upgrade || Date.now() - last_auto_gear < AUTO_GEAR_INTERVAL) return;
    last_auto_gear = Date.now();
    if (wish_budget() < 300000) return;
    pending_upgrade = "auto";
}

// ---------- Alle Händler auf allen Servern nach Wunschlisten-Items durchsuchen ----------
var GLOBAL_SCAN_INTERVAL = 15 * 60000, last_global_scan = rt("last_global_scan", 0), global_finds = [], global_logged = {}, pending_buy = null, global_debug_done = false;
var global_offers = []; try { global_offers = parent.__lp_global_offers || []; } catch (e) {}
// ---------- Arbitrage (Schritt 1: nur messen und anzeigen) ----------
var ARB_MIN_PROFIT = 5000, ARB_MIN_MARGIN = 0.15, ARB_DEFAULT_FACTOR = 0.6; // NPC-Verkaufsfaktor wird beim ersten Verkauf gemessen
var arb_offers = []; try { arb_offers = parent.__lp_arb_offers || []; } catch (e) {}
var sell_factor = 0; try { sell_factor = parseFloat(localStorage.getItem("lp_sell_factor") || "0") || 0; } catch (e) {}
function is_pvp_server(sv) { return /pvp/i.test(String(sv || "")); } // PVP-Server: dort wird nicht hingewechselt
function npc_value(name, level) { // NPC-Itemwert laut Spiel (mit Stufe), Fallback: Grundpreis
    try { if (typeof parent.calculate_item_value == "function") { var v = parent.calculate_item_value({ name: name, level: level || 0 }); if (isFinite(v) && v > 0) return v; } } catch (e) {}
    var d = G.items[name]; return d && d.g ? d.g : 0;
}
function npc_sell_price(name, level) { return npc_value(name, level) * (sell_factor || ARB_DEFAULT_FACTOR); }
async function sell_measured(idx, q) { // Verkauf über den Bot: gezahltes Gold mit dem NPC-Wert vergleichen (Faktor lernen, je Stufe protokollieren)
    var it = character.items[idx]; if (!it) return; var snap = { name: it.name, level: it.level || 0, q: q || it.q || 1 }, g0 = character.gold;
    try { sell(idx, snap.q); } catch (e) {} await sleep(300);
    try { note_sell(snap, character.gold - g0); } catch (e) {}
}
var sell_seen = {};
function note_sell(it, delta) { // nach einem NPC-Verkauf: gezahltes Gold mit dem Itemwert vergleichen -> Faktor lernen
    var v = npc_value(it.name, it.level) * (it.q || 1); if (!(delta > 0) || !(v > 0)) return;
    var f = Math.round(delta / v * 1000) / 1000; if (f > 2 || f < 0.05) return;
    var key = it.name + "+" + (it.level || 0); if (!sell_seen[key] || Math.abs(sell_seen[key] - f) > 0.02) { sell_seen[key] = f; game_log("Verkauf " + key + (it.q > 1 ? " ×" + it.q : "") + ": NPC zahlte " + fmt(delta) + " = " + Math.round(f * 100) + " % von Wert " + fmt(v) + ((it.level || 0) > 0 && sell_factor && Math.abs(f - sell_factor) > 0.02 ? " – weicht vom +0-Faktor ab!" : "")); }
    if ((it.level || 0) > 0 && sell_factor) return; // Faktor nur von +0-Verkäufen lernen, +Items werden nur verglichen
    if (!sell_factor || Math.abs(f - sell_factor) > 0.02) { sell_factor = f; try { localStorage.setItem("lp_sell_factor", String(f)); } catch (e) {} game_log("NPC zahlt " + Math.round(f * 100) + " % des Itemwerts (" + it.name + (it.level ? "+" + it.level : "") + ": " + fmt(delta) + " für Wert " + fmt(v) + ")"); }
}
function arb_profit(o) { return npc_sell_price(o.name, o.level) - o.price; }
function arb_list() { return arb_offers.filter(function (o) { return o.profit >= ARB_MIN_PROFIT && o.profit >= o.price * ARB_MIN_MARGIN && (o.same || !is_pvp_server(o.server)); }).sort(function (a, b) { return (b.same - a.same) || (b.profit - a.profit); }); }
function arb_html(panel) {
    var list = arb_list(), sum = 0, here = 0; list.forEach(function (o) { sum += o.profit; if (o.same) here += o.profit; });
    var head = "<span class='lp_k'>Handel (NPC-Arbitrage):</span> " + (!global_offers.length && !arb_offers.length ? "<span style='color:#9aa3b2'>noch kein Scan</span>" : list.length ? "<span style='color:#8ab4f8'>" + list.length + " Angebote, Gewinn ~" + fmt(sum) + (here ? " (davon hier " + fmt(here) + ")" : " (alle auf anderen Servern)") + "</span>" : "<span style='color:#9aa3b2'>nichts Lohnendes (" + arb_offers.length + " Angebote geprüft)</span>") + " <small style='color:#6b7280'>NPC-Faktor " + (sell_factor ? Math.round(sell_factor * 100) + " % gemessen" : Math.round(ARB_DEFAULT_FACTOR * 100) + " % geschätzt") + "</small>";
    head += (list.length ? " <button data-act='arbtoggle'>" + (panel.__arb ? "▾" : "▸") + " anzeigen</button>" : "");
    if (!panel.__arb || !list.length) return "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'>" + head + "</div>";
    var h = "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'>" + head + "</div><table class='lp_t' style='font-size:11px'><tr><th style='text-align:left'>Item</th><th>Kauf</th><th>NPC zahlt</th><th>Gewinn</th><th style='text-align:left'>Server</th><th style='text-align:left'>Händler</th></tr>";
    list.slice(0, 15).forEach(function (o) { h += "<tr><td>" + esc(o.name) + (o.level ? "+" + o.level : "") + (o.q > 1 ? " ×" + o.q : "") + "</td><td>" + fmt(o.price) + "</td><td>" + fmt(Math.round(npc_sell_price(o.name, o.level))) + "</td><td style='color:#4caf50'>" + fmt(Math.round(o.profit)) + "</td><td style='text-align:left'>" + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + "</td><td style='text-align:left'>" + esc(o.seller) + "</td></tr>"; });
    return h + "</table>";
}
// ---------- Wertsachen über den Händlerstand verkaufen (aus der Bank): Preisspiegel aller Server, Preis wird automatisch gesetzt ----------
var WATCH_ITEMS = { scroll3: true }; // Items, für die Kaufaufträge/Verkaufspreise gesammelt und die der Händler am Stand anbietet
var watch_prices = {}, watch_logged = {}; try { watch_prices = parent.__lp_watch_prices || {}; } catch (e) {} // Preisspiegel überlebt den Neustart
var stand_orders = {}; try { stand_orders = JSON.parse(localStorage.getItem("lp_stand_orders_" + TEAM.merch) || "{}"); } catch (e) {} // name -> { price, t, floor, since }
function save_stand_orders() { try { localStorage.setItem("lp_stand_orders_" + TEAM.merch, JSON.stringify(stand_orders)); } catch (e) {} }
function watch_summary(name) { var w = watch_prices[name]; if (!w) return null; var bid = w.bids.slice().sort(function (a, b) { return b.price - a.price; })[0], ask = w.asks.slice().sort(function (a, b) { return a.price - b.price; })[0]; return { bid: bid, ask: ask, n_ask: w.asks.length, n_bid: w.bids.length }; }
function stand_price_for(name) { // Zielpreis: unter dem günstigsten Verkäufer, deutlich über dem besten Kaufauftrag; sinkt 5 % pro Tag bis zum Boden (bester Kaufauftrag +10 %)
    var g = (G.items[name] || {}).g || 0, ws = watch_summary(name), bid = ws && ws.bid ? ws.bid.price : 0, ask = ws && ws.ask ? ws.ask.price : 0;
    var start = ask ? Math.min(ask * 0.97, g) : g * 0.9; if (bid) start = Math.max(start, bid * 1.3);
    var floor = Math.max(bid * 1.1, g * 0.5);
    var o = stand_orders[name]; var days = o && o.since ? (Date.now() - o.since) / 86400000 : 0;
    var price = Math.max(floor, start * Math.pow(0.95, Math.floor(days)));
    return Math.round(price / 1000000) * 1000000;
}
function watch_after_scan() {
    for (var name in WATCH_ITEMS) {
        var ws = watch_summary(name), o = stand_orders[name];
        var txt = name + ": " + (ws && ws.bid ? "bester Kaufauftrag " + fmt(ws.bid.price) + " (" + pretty_server(ws.bid.server) + ", " + ws.bid.seller + ")" : "kein Kaufauftrag") + " · " + (ws && ws.ask ? "günstigster Verkäufer " + fmt(ws.ask.price) + " (" + pretty_server(ws.ask.server) + ", " + ws.ask.seller + ", " + ws.n_ask + " Anbieter)" : "kein Verkäufer");
        if (watch_logged[name] != txt) { watch_logged[name] = txt; game_log("Preisspiegel " + txt); }
        // Auftrag an den Händler: Item liegt in der Bank (oder er hat es schon) -> am Stand anbieten
        var in_bank = false; try { var bk = character.bank || bank_cache || {}; for (var pk in bk) if (pk.indexOf("items") == 0 && Array.isArray(bk[pk])) bk[pk].forEach(function (it) { if (it && it.name == name) in_bank = true; }); } catch (e) {}
        var ms = team_state[TEAM.merch], merch_has = ms && ms.orders && ms.orders[name];
        if (in_bank || merch_has || o) {
            if (!o) { o = stand_orders[name] = { since: Date.now() }; }
            var np = o.fixed ? o.fixed : stand_price_for(name);
            if (np != o.price) { o.price = np; o.t = Date.now(); save_stand_orders(); game_log("Stand-Auftrag " + name + ": " + fmt(np) + (ws && ws.bid ? " (Kaufauftrag " + fmt(ws.bid.price) + ")" : "") + " – Händler holt es aus der Bank und stellt es aus"); }
        }
    }
}
function watch_html() {
    var h = "";
    for (var name in WATCH_ITEMS) { var ws = watch_summary(name), o = stand_orders[name], ms = team_state[TEAM.merch], st = ms && ms.orders && ms.orders[name];
        h += "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'><span class='lp_k'>" + esc((G.items[name] || {}).name || name) + ":</span> " + (!ws ? "<span class='lp_k'>noch kein Scan</span>" : ws.bid ? "Kaufauftrag " + fmt(ws.bid.price) : "kein Kaufauftrag") + " · " + (ws && ws.ask ? "Verkäufer ab " + fmt(ws.ask.price) + " (" + ws.n_ask + ")" : "kein Verkäufer") + (o ? " · <span style='color:#8ab4f8'>Stand: " + fmt(o.price) + (st ? " – " + esc(st) : " – wartet auf Händler") + "</span>" : "") + " <input data-fixprice='" + name + "' value='" + (o && o.fixed ? esc(fmt_mio(o.fixed)) : "") + "' placeholder='fest, Mio.' title='fester Standpreis in Mio. (leer = automatische Preisleiter)' style='width:60px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'></div>"; }
    return h;
}
// ---------- Arbitrage Stufe 2: der Händler reist im Hintergrund (eigenes Fenster auf dem Zielserver) ----------
var ARB_TRIP_MIN = 100000; try { ARB_TRIP_MIN = parseInt(localStorage.getItem("lp_arb_min") || "0") || 100000; } catch (e) {}
var arb_auto = true; try { arb_auto = localStorage.getItem("lp_arb_auto") != "0"; } catch (e) {}
var arb_job = null; try { arb_job = JSON.parse(localStorage.getItem("lp_arb_job_" + TEAM.merch) || "null"); if (arb_job && arb_job.done) arb_job = null; } catch (e) {}
var arb_hist = []; try { arb_hist = JSON.parse(localStorage.getItem("lp_arb_hist") || "[]"); } catch (e) {}
var last_arb_trip = rt("last_arb_trip", 0), last_arb_check = 0;
function arb_save_job() { try { if (arb_job) localStorage.setItem("lp_arb_job_" + TEAM.merch, JSON.stringify(arb_job)); else localStorage.removeItem("lp_arb_job_" + TEAM.merch); } catch (e) {} }
function arb_by_server() { // lohnende Angebote je fremdem Server (kein PVP), nach Gewinn sortiert
    var by = {};
    arb_list().forEach(function (o) { if (o.same || is_pvp_server(o.server)) return; var k = norm_server(o.server); if (!by[k]) by[k] = { key: k, server: o.server, offers: [], profit: 0 }; by[k].offers.push(o); by[k].profit += o.profit; });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.profit - a.profit; });
}
function arb_blocked() { // warum gerade keine Reise möglich ist (null = möglich)
    if (!team_on.merch) return "Händler aus";
    if (arb_job) return "Reise läuft";
    if (merch_test) return "Servertest läuft";
    if (server_trip) return "Magier auf Serverreise";
    if (handing || pickup_state) return "Abholung läuft";
    if (Date.now() - last_arb_trip < 15 * 60000) return "Pause bis " + Math.ceil((15 * 60000 - (Date.now() - last_arb_trip)) / 60000) + " min";
    return null;
}
function start_arb_trip(server_key) {
    var why = arb_blocked(); if (why) { game_log("Handelsreise nicht möglich: " + why); return; }
    var g = arb_by_server().filter(function (x) { return x.key == server_key; })[0]; if (!g) { game_log("Handelsreise: keine Angebote für " + server_key); return; }
    var sp = split_server(norm_server(g.server).toUpperCase()); if (!sp) { game_log("Handelsreise: Server unbekannt (" + g.server + ")"); return; }
    var nm = TEAM.merch, ms = team_state[nm], gold = ms && ms.gold || 0;
    arb_job = { id: Date.now(), server: g.server, region: sp.region, sid: sp.id, offers: g.offers.slice(0, 20).map(function (o) { return { name: o.name, level: o.level, price: o.price, q: o.q, seller: o.seller, map: o.map, x: o.x, y: o.y, tslot: o.tslot, profit: Math.round(o.profit) }; }), t: Date.now(), stage: "stopped", profit: Math.round(g.profit) };
    arb_save_job(); try { localStorage.removeItem("lp_arb_result_" + nm); } catch (e) {}
    last_arb_trip = Date.now();
    try { if (active_chars()[nm]) stop_character(nm); } catch (e) {}
    try { parent.__lp_team_restart_after = Date.now() + 12 * 60000; } catch (e) {}
    game_log("Handelsreise: Händler fährt nach " + pretty_server(g.server) + " (" + g.offers.length + " Angebote, Gewinn ~" + fmt(g.profit) + (gold ? ", Kapital " + fmt(gold) : "") + ")"); last_panel = 0;
}
function arb_tick() {
    if (!arb_job) {
        if (arb_auto && Date.now() - last_arb_check > 30000) { last_arb_check = Date.now(); if (!arb_blocked()) { var g = arb_by_server()[0]; if (g && g.profit >= ARB_TRIP_MIN) start_arb_trip(g.key); } }
        return;
    }
    var nm = TEAM.merch, el = Date.now() - arb_job.t;
    if (arb_job.stage == "stopped" && el > 15000) {
        try { start_char_on_server(nm, arb_job.region, arb_job.sid); arb_job.stage = "away"; arb_job.t = Date.now(); arb_save_job(); game_log("Handelsreise: Händler-Fenster auf " + pretty_server(arb_job.server) + " angelegt"); } catch (e) { game_log("Handelsreise: Fenster-Fehler " + err_txt(e)); arb_finish(null, "Fenster-Fehler"); }
        return;
    }
    if (arb_job.stage == "away") {
        var res = null; try { res = JSON.parse(localStorage.getItem("lp_arb_result_" + nm) || "null"); } catch (e) {}
        if (res && res.id == arb_job.id) { arb_job.res = res; if (res.done) { arb_finish(res); return; } }
        if (el > 10 * 60000) { arb_finish(res, "Zeitüberschreitung"); }
    }
}
function arb_finish(res, why) {
    var nm = TEAM.merch, sv = arb_job.server;
    if (res && res.wrong_server) game_log("Handelsreise: Händler ist auf " + (res.server || "?").toUpperCase() + " gelandet statt " + pretty_server(sv) + " – abgebrochen");
    else if (res && res.done && arb_job.sellonly) game_log("Verkaufsreise " + pretty_server(sv) + ": " + (res.sold ? res.sold + " verkauft für " + fmt(res.earned) : "nichts verkauft" + (res.log && res.log.length ? " – " + res.log.slice(-1)[0] : "")) + " · Händler kommt zurück");
    else if (res && res.done && arb_job.keep) game_log("Einkaufsreise " + pretty_server(sv) + ": " + (res.bought ? res.bought + " gekauft (" + fmt(res.spent) + ")" : "nichts gekauft" + (res.log && res.log.length ? " – " + res.log.slice(-1)[0] : "")) + " · Händler kommt zurück");
    else if (res && res.done) game_log("Handelsreise " + pretty_server(sv) + ": " + res.bought + " gekauft (" + fmt(res.spent) + "), " + res.sold + " verkauft (" + fmt(res.earned) + ") → Gewinn " + fmt(res.profit || 0) + (res.skipped ? ", " + res.skipped + " übersprungen" : "") + " · Händler hat jetzt " + fmt(res.gold || 0) + " Gold");
    else game_log("Handelsreise " + pretty_server(sv) + " abgebrochen: " + (why || "keine Rückmeldung") + (res && res.log ? " – zuletzt: " + res.log.slice(-2).join(" | ") : ""));
    if (arb_job.keep && merch_buy && merch_buy.id == arb_job.buy_id && !(res && res.done && (res.bought || res.sold))) { mb_fail(res && res.done ? "auf der Reise nichts gekauft" : (why || "keine Rückmeldung")); }
    if (!arb_job.keep) arb_hist.push({ t: Date.now(), server: sv, profit: res && res.done ? (res.profit || 0) : null, bought: res ? res.bought || 0 : 0, why: why || null }); if (arb_hist.length > 20) arb_hist = arb_hist.slice(-20); try { localStorage.setItem("lp_arb_hist", JSON.stringify(arb_hist)); } catch (e) {}
    try { var f = parent.document.getElementById("ichar" + nm.toLowerCase()); if (f) f.remove(); } catch (e) {}
    try { if (active_chars()[nm]) stop_character(nm); } catch (e) {}
    try { parent.__lp_team_restart_after = Date.now() + 20000; } catch (e) {}
    arb_offers = arb_offers.filter(function (o) { return norm_server(o.server) != norm_server(sv); }); try { parent.__lp_arb_offers = arb_offers; } catch (e) {}
    arb_job = null; arb_save_job(); last_panel = 0;
}
function arb_trip_html() {
    var h = "";
    if (arb_job) { var el = Math.round((Date.now() - arb_job.t) / 1000), r = arb_job.res; h += "<div class='lp_row'><span class='lp_k'>Handelsreise:</span> <span style='color:#8ab4f8'>" + esc(pretty_server(arb_job.server)) + " – " + (arb_job.stage == "stopped" ? "Händler wird abgemeldet" : r ? r.bought + "/" + arb_job.offers.length + " gekauft" + (r.sold ? ", " + r.sold + " verkauft" : "") + (r.log && r.log.length ? " · " + esc(r.log[r.log.length - 1]) : "") : "unterwegs") + " (" + el + " s)</span></div>"; }
    else {
        var groups = arb_by_server(), bl = arb_blocked();
        h += "<div class='lp_row' style='flex-wrap:wrap'><span class='lp_k'>Handelsreise:</span> <button data-act='arbauto'" + (arb_auto ? " class='on'" : "") + " title='Händler fährt automatisch, sobald ein Server diesen Gewinn hergibt'>Auto</button> ab <input data-arbmin='1' value='" + esc(fmt_mio(ARB_TRIP_MIN)) + "' style='width:52px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'> Gewinn" + (bl ? " <span style='color:#9aa3b2'>(" + esc(bl) + ")</span>" : "") + (groups.length ? " · " + groups.slice(0, 4).map(function (g) { return esc(pretty_server(g.server)) + " ~" + fmt(Math.round(g.profit)) + " <button data-act='arbtrip' data-sv='" + esc(g.key) + "' style='padding:0 5px'" + (bl ? " disabled" : "") + ">Reise</button>"; }).join(" · ") : " <span style='color:#9aa3b2'>keine lohnenden Server</span>");
        var last = arb_hist[arb_hist.length - 1]; if (last) h += " <small style='color:#6b7280'>· letzte: " + esc(pretty_server(last.server)) + " " + (last.profit != null ? (last.profit >= 0 ? "+" : "") + fmt(last.profit) : "abgebrochen") + "</small>";
        h += "</div>";
    }
    return h;
}
function offers_for_slot(slot) { // beste Angebote aller Server für einen Slot: Wunschliste zuerst, dann nach Wert je Gold; nur besser als getragen und bezahlbar
    var worn = character.slots[slot], ws = worn ? item_score(worn) * 1.02 : 0;
    var list = global_offers.filter(function (o) { var def = G.items[o.name]; return def && fits_slot(def, slot) && o.score > ws && o.price <= character.gold; }); // bis zum vollen Goldstand anzeigen – gekauft wird automatisch nur innerhalb der Grenze, darüber per Kaufen-Knopf
    list.forEach(function (o) { o.wish = wish_rank(slot, o.name); });
    list.sort(function (a, b) { if ((b.wish > 0) != (a.wish > 0)) return (b.wish > 0) - (a.wish > 0); if (a.wish > 0 && b.wish > 0 && a.wish != b.wish) return b.wish - a.wish; var sa = a.stat_type == STAT_TYPE, sb = b.stat_type == STAT_TYPE; if (sa != sb) return sb - sa; return (b.score - ws) / b.price - (a.score - ws) / a.price; });
    return list;
}
function offer_txt(o) { return o.name + "+" + o.level + (o.stat_type ? " [" + o.stat_type + "]" : "") + " " + fmt(o.price) + " (" + pretty_server(o.server) + (o.same ? " ★" : "") + ", " + o.seller + ")"; }
var buy_confirm = null; // { key, offer, slot, t } – Kaufen-Knopf wartet auf Bestätigung
function offer_key(o) { return o.name + "|" + o.level + "|" + o.price + "|" + o.seller + "|" + o.server; }
function offers_html(slot) {
    var list = offers_for_slot(slot).slice(0, 3);
    if (!list.length) return "<span style='color:#9aa3b2'>" + (global_offers.length ? "nichts Besseres im Angebot" : "noch kein Scan") + "</span>";
    if (buy_confirm && Date.now() - buy_confirm.t > 20000) buy_confirm = null;
    return list.map(function (o, i) {
        var k = offer_key(o), btn;
        if (buy_confirm && buy_confirm.key == k) btn = "<br><span style='color:#ffb74d'>für " + fmt(o.price) + (o.same ? " hier" : " auf " + esc(pretty_server(o.server)) + " (Serverwechsel)") + " kaufen?</span> <button data-act='buyok' data-slot='" + slot + "' data-idx='" + i + "' class='on'>Ja</button> <button data-act='buyno'>Nein</button>";
        else btn = " <button data-act='buyoffer' data-slot='" + slot + "' data-idx='" + i + "' style='padding:0 5px' title='dieses Angebot kaufen – ohne Preisgrenze, nur Gold muss reichen" + (o.same ? "" : "; auf anderem Server: hin, kaufen, zurück") + "'>" + (o.price > character.gold ? "zu teuer" : "Kaufen") + "</button>";
        return "<span style='color:" + (o.same ? "#4caf50" : (o.wish > 0 ? "#8ab4f8" : "#e6e6e6")) + "' title='" + esc((o.wish > 0 ? "Wunschliste · " : "Alternative · ") + "Wert " + Math.round(o.score) + " · Händler " + o.seller + " auf " + o.server + (o.same ? " (dieser Server)" : "")) + "'>" + esc(o.name) + "+" + o.level + (o.stat_type ? " <b style='color:" + (o.stat_type == STAT_TYPE ? "#4caf50" : "#9aa3b2") + "'>[" + esc(o.stat_type) + "]</b>" : "") + " " + fmt(o.price) + " <small>" + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + "</small></span>" + btn;
    }).join("<br>");
}
async function buy_offer_now(slot, o) { // vom Nutzer bestätigter Kauf eines konkreten Angebots (Preisgrenze übersteuert)
    var f = Object.assign({}, o, { slot: slot, force: true, t: Date.now() });
    if (f.price > character.gold) { game_log("Kauf " + f.name + ": nicht genug Gold (" + fmt(f.price) + ")"); return; }
    if (!f.same) { game_log("Kauf auf " + pretty_server(f.server) + ": " + f.name + "+" + f.level + " für " + fmt(f.price) + " – Serverwechsel"); server_targets.push(f); save_server_targets(); start_trip(f); return; }
    busy = true; marketing = true;
    try { game_log("Kaufe " + f.name + "+" + f.level + " für " + fmt(f.price) + " bei " + f.seller + " (manuell, ohne Preisgrenze)"); var ok = await buy_find(f); if (ok) await ensure_best_equipped(); else game_log("Kauf " + f.name + " nicht möglich"); }
    catch (e) { game_log("Kauf " + f.name + ": " + err_txt(e)); }
    busy = false; marketing = false;
    after_action("Kauf " + f.name);
}
function my_server() { try { return String((parent.server_region || "") + (parent.server_identifier || "")).replace(/\s+/g, "").toLowerCase(); } catch (e) { return ""; } }
function norm_server(sv) { return String(sv || "").replace(/^SR_/i, "").replace(/\s+/g, "").toLowerCase(); }
function pretty_server(sv) { var n = String(sv || "").replace(/^SR_/i, ""); var m = n.match(/^(EU|US|ASIA)(.*)$/i); if (!m) return n; var reg = { EU: "Europas", US: "Americas", ASIA: "Eastlands" }[m[1].toUpperCase()] || m[1]; return reg + " " + m[2]; }
// Serverwechsel: Funde auf anderen Servern merken; nach manuellem Wechsel dorthin automatisch kaufen
var server_targets = []; try { server_targets = JSON.parse(localStorage.getItem("lp_server_targets") || "[]"); } catch (e) {}
function save_server_targets() { try { localStorage.setItem("lp_server_targets", JSON.stringify(server_targets)); } catch (e) {} }
function server_tip() { // bester Fund auf einem anderen Server, nur wenn Kaufen laut Vergleich lohnt
    var list = server_targets.filter(function (f) { if (Date.now() - f.t >= 45 * 60000 || f.same) return false; var r = build_vs_buy(f.slot); return !r || !/^bauen|^fertig/.test(r.verdict); });
    list.sort(function (a, b) { return (wish_rank(b.slot, b.name) - wish_rank(a.slot, a.name)) || (a.price - b.price); });
    return list;
}
function server_tip_html() {
    var list = server_tip();
    if (!list.length) return "<span style='color:#9aa3b2'>kein Fund auf anderen Servern</span>";
    return list.slice(0, 3).map(function (f, i) { return "<span style='color:#8ab4f8'>→ <b>" + esc(pretty_server(f.server)) + "</b>: " + esc(f.name) + "+" + f.level + " für " + fmt(f.price) + " (" + esc(f.seller) + ")</span> <button data-act='trip' data-idx='" + i + "' title='Server wechseln, kaufen, zurückkommen – vollautomatisch'>Wechseln & kaufen</button>"; }).join(" · ") + " <button data-act='autotrip'" + (auto_trip ? " class='on'" : "") + " title='Serverkäufe ohne Nachfrage durchführen, wenn Kaufen laut Vergleich lohnt'>automatisch</button>";
}
function check_server_arrival() { // nach Serverwechsel: liegt hier ein gemerkter Fund? -> sofort kaufen
    var mine = my_server(); if (!mine) return;
    var here = server_targets.filter(function (f) { return Date.now() - f.t < 45 * 60000 && norm_server(f.server) == mine && wish_wants(f.name, f.level, f.price, f.force ? f.slot : null); });
    if (!here.length) return;
    here.sort(function (a, b) { return a.price - b.price; });
    pending_buy = here[0]; pending_buy.same = true;
    if (paused) { paused = false; game_log("Serverwechsel erkannt (" + pretty_server(mine) + ") – kaufe " + here[0].name + "+" + here[0].level + " bei " + here[0].seller); }
    server_after_buy_pause = true;
}
var server_after_buy_pause = false;
// ---------- Automatischer Serverwechsel: hin, kaufen, zurück ----------
var server_trip = null; try { server_trip = JSON.parse(localStorage.getItem("lp_server_trip") || "null"); } catch (e) {}
function save_trip() { try { if (server_trip) localStorage.setItem("lp_server_trip", JSON.stringify(server_trip)); else localStorage.removeItem("lp_server_trip"); } catch (e) {} }
var auto_trip = false; try { auto_trip = localStorage.getItem("lp_auto_trip") == "1"; } catch (e) {}
function split_server(sv) { var n = String(sv || "").replace(/^SR_/i, ""); var m = n.match(/^(EU|US|ASIA)(.*)$/i); return m ? { region: m[1].toUpperCase(), id: m[2] } : null; }
function switch_server(region, id) { // wie der Klick auf "Wechseln" im Welt-Fenster
    game_log("Serverwechsel nach " + pretty_server(region + id) + " …");
    try { var ac0 = active_chars(); TEAM_NAMES.forEach(function (nm) { if (ac0[nm]) { try { stop_character(nm); } catch (e) {} } }); parent.__lp_team_restart_after = Date.now() + 20000; } catch (e) {} // Team bleibt zuhause, wird nach der Rückkehr neu gestartet
    try { if (typeof parent.change_server == "function") { parent.change_server(region, id); return; } } catch (e) {}
    try { parent.location.href = "/character/" + encodeURIComponent(character.name) + "/in/" + region + "/" + id + "/"; } catch (e) { game_log("Serverwechsel fehlgeschlagen: " + err_txt(e)); }
}
function start_trip(f) { // f: Fund auf anderem Server
    if (SOLO) return;
    var home = { region: parent.server_region, id: parent.server_identifier }, tgt = split_server(f.server);
    if (!home.region || !tgt) { game_log("Serverwechsel: Server unbekannt"); return; }
    if (arb_job) { game_log("Serverwechsel verschoben: Händler ist gerade auf Handelsreise"); return; }
    server_trip = { home: home, target: tgt, find: f, t: Date.now(), stage: "out" }; save_trip();
    switch_server(tgt.region, tgt.id);
}
function end_trip(msg) { if (!server_trip) return; var home = server_trip.home; game_log(msg + " – zurück nach " + pretty_server(home.region + home.id)); server_trip.stage = "back"; save_trip(); switch_server(home.region, home.id); }
function check_trip_on_start() { // nach dem Laden: sind wir unterwegs?
    if (!server_trip) return;
    if (server_trip.stage == "out") { try { parent.__lp_team_restart_after = Date.now() + 15 * 60000; } catch (e) {} } // auf dem fremden Server kein Team starten
    if (Date.now() - server_trip.t > 20 * 60000) { server_trip = null; save_trip(); return; }
    var mine = my_server();
    if (server_trip.stage == "out" && mine == norm_server(server_trip.target.region + server_trip.target.id)) {
        var f = server_trip.find;
        if (!wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) { end_trip("Angebot passt nicht mehr"); return; }
        pending_buy = Object.assign({}, f, { same: true }); server_after_buy_pause = false; trip_buying = true; paused = false;
        game_log("Angekommen auf " + pretty_server(mine) + " – kaufe " + f.name + "+" + f.level + " bei " + f.seller);
    } else if (server_trip.stage == "back" && mine == norm_server(server_trip.home.region + server_trip.home.id)) {
        game_log("Zurück auf " + pretty_server(mine) + " – Serverkauf abgeschlossen"); server_trip = null; save_trip(); paused = false; try { parent.__lp_team_restart_after = Date.now() + 10000; } catch (e) {}
    }
}
var trip_buying = false;
function collect_merchants(obj, out, depth) { // Antwortstruktur defensiv durchsuchen: Objekte mit name + slots
    if (!obj || depth > 6) return;
    if (Array.isArray(obj)) { obj.forEach(function (x) { collect_merchants(x, out, depth + 1); }); return; }
    if (typeof obj != "object") return;
    if (obj.slots && obj.name && typeof obj.slots == "object") { out.push(obj); return; }
    for (var k in obj) collect_merchants(obj[k], out, depth + 1);
}
// ---------- Markt-Fenster: alle Händlerangebote aller Server auf einen Blick ----------
var mkt_show = 0; // sichtbare Zeilen (wächst mit „weitere anzeigen“, Filterwechsel setzt zurück)
var market_all = [], market_scan_t = 0, market_n_merch = 0, market_panel = null, market_job = null, mkt_rows = [];
try { market_all = parent.__lp_market_all || []; market_scan_t = parent.__lp_market_t || 0; market_n_merch = parent.__lp_market_n || 0; } catch (e) {}
var market_hist = {}; try { market_hist = JSON.parse(localStorage.getItem("lp_market_hist") || "{}"); } catch (e) {} // "name+lv" -> letzte Scan-Minimalpreise (Ø Markt)
var mkt = { f: { schn: true, ziel: true, watch: true, team: true, buy: false, all: false, arb: true }, q: "", sv: "", slot: "", sort: "price", dir: 1, view: "kompakt", csort: "span", cdir: -1, open: {} };
try { var mk0 = JSON.parse(localStorage.getItem("lp_mkt") || "null"); if (mk0) { for (var mk1 in mk0) mkt[mk1] = mk0[mk1]; mkt.q = ""; mkt.open = {}; if (!mkt.view) mkt.view = "kompakt"; if (!mkt.csort) { mkt.csort = "span"; mkt.cdir = -1; } } } catch (e) {}
function save_mkt() { try { localStorage.setItem("lp_mkt", JSON.stringify(mkt)); } catch (e) {} }
function market_note_scan(merchants) { // aus dem Rohscan: komplette Angebotsliste + Preisgeschichte
    var mine = my_server(), all = [], mins = {};
    merchants.forEach(function (m) {
        for (var sl in m.slots) {
            if (sl.indexOf("trade") != 0) continue; var it = m.slots[sl]; if (!it || !it.price || !G.items[it.name]) continue;
            var o = { name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, b: !!it.b, seller: m.name, server: m.server || "?", same: norm_server(m.server) == mine, map: m.map, x: m.x, y: m.y, tslot: sl, stat_type: it.stat_type || null, t: Date.now() };
            all.push(o);
            if (!o.b) { var k = o.name + "+" + o.level; if (!(k in mins) || o.price < mins[k]) mins[k] = o.price; }
        }
    });
    if (!all.length) return;
    market_all = all; market_scan_t = Date.now(); market_n_merch = merchants.length;
    try { parent.__lp_market_all = all; parent.__lp_market_t = market_scan_t; parent.__lp_market_n = market_n_merch; } catch (e) {}
    for (var k2 in mins) market_hist[k2] = (market_hist[k2] || []).concat(mins[k2]).slice(-8);
    var keys = Object.keys(market_hist); if (keys.length > 4000) keys.slice(0, keys.length - 4000).forEach(function (k3) { delete market_hist[k3]; });
    try { localStorage.setItem("lp_market_hist", JSON.stringify(market_hist)); } catch (e) {}
    render_market();
}
function market_avg(name, level) { var h = market_hist[name + "+" + (level || 0)]; if (!h || h.length < 3) return 0; var s = h.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
var MKT_SLOT_LABEL = { weapon: "Waffe", helmet: "Helm", chest: "Rüstung", pants: "Hose", shoes: "Schuhe", gloves: "Handschuhe", cape: "Umhang", ring: "Schmuck", earring: "Schmuck", amulet: "Schmuck", belt: "Schmuck", orb: "Schmuck", shield: "Nebenhand", quiver: "Nebenhand", source: "Nebenhand", cscroll: "Schriftrollen", uscroll: "Schriftrollen", pscroll: "Schriftrollen", offering: "Schriftrollen", elixir: "Elixiere", pot: "Tränke" };
function mkt_slot_of(name) { var d = G.items[name] || {}; return MKT_SLOT_LABEL[d.type] || (d.s ? "Material" : "Sonstiges"); }
function mkt_team_wants(name) { var best = null; for (var k in team_wish) { var c = team_wish[k] || {}; for (var sl in c) if (c[sl] && c[sl].item == name) { var lv = c[sl].level || 0; if (best == null || lv < best) best = lv; } } return best; } // niedrigstes gewünschtes Level oder null
function mkt_wish_level(name) { var best = null; for (var slot in WISHLIST) { if (wish_rank(slot, name) < 0) continue; var lv = wish_level(slot) || 0; if (best == null || lv < best) best = lv; } return best; }
var mkt_min = {}, mkt_dupname = {}; // Item+Lv -> günstigstes Verkaufsangebot; Anzeigename -> Kürzel-Liste
function mkt_index() {
    mkt_min = {}; var byname = {};
    market_all.forEach(function (o) { var nm = (G.items[o.name] || {}).name || o.name; (byname[nm] = byname[nm] || {})[o.name] = true; if (o.b) return; var k = o.name + "+" + o.level; if (!mkt_min[k] || o.price < mkt_min[k].price) { var n0 = mkt_min[k] ? mkt_min[k]._cnt : 0; mkt_min[k] = o; o._cnt = n0; } mkt_min[k]._cnt = (mkt_min[k]._cnt || 0) + 1; });
    mkt_dupname = {}; for (var nm2 in byname) if (Object.keys(byname[nm2]).length > 1) mkt_dupname[nm2] = true;
}
function mkt_label(name) { var nm = (G.items[name] || {}).name || name; return esc(nm) + (mkt_dupname[nm] ? " <small style='color:#6b7280'>" + esc(name) + "</small>" : ""); }
function mkt_tags(o) { // welche Chips passen zu diesem Angebot
    var t = {};
    if (o.b) { t.buy = true; return t; }
    var p = arb_profit(o); if (p >= ARB_MIN_PROFIT && p >= o.price * ARB_MIN_MARGIN) t.schn = true;
    var zl = mkt_wish_level(o.name); if (zl != null && o.level >= zl) { t.ziel = true; if (!wish_wants(o.name, o.level, o.price)) t.ziel_teuer = true; } // nur ab Ziel-Level; über Preislimit = grau
    if (WATCH_ITEMS[o.name]) t.watch = true;
    var tl = mkt_team_wants(o.name); if (tl != null && o.level >= tl) t.team = true;
    return t;
}
function mkt_ref(o) { var a = market_avg(o.name, o.level), n = npc_sell_price(o.name, o.level); return { avg: a, npc: n, ref: a || n }; }
function init_market_panel() {
    var doc = parent.document, old = doc.getElementById("lp_mkt"); if (old) old.remove();
    var st = doc.getElementById("lp_mkt_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_mkt_style";
    st.textContent = "#lp_mkt{position:fixed;left:540px;top:180px;z-index:2147483000;pointer-events:auto;width:920px;background:rgba(20,22,28,var(--lp-alpha));color:#e6e6e6;font:var(--lp-fs)/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_mkt_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(36,41,54,var(--lp-alpha));cursor:move;border-bottom:1px solid #3a3f4b}#lp_mkt_head b{font-size:13px}#lp_mkt_head .lp_k{flex:1}"
      + "#lp_mkt button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#2f3440;color:#eee;border:1px solid #555;border-radius:3px}#lp_mkt button.on{background:var(--lp-acc);border-color:var(--lp-acc2)}#lp_mkt button.gold{color:#C6AA62;border-color:#7a6a3a}#lp_mkt button:disabled{opacity:.4;cursor:default}"
      + "#lp_mkt_bar{display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid #2a2f3a;flex-wrap:wrap}.lp_chip{background:#1f2430;border:1px solid #3a4152;border-radius:12px;padding:1px 9px;font-size:11px;cursor:pointer;color:#c9ced8}.lp_chip.on{background:var(--lp-acc);border-color:var(--lp-acc2);color:#fff}.lp_chip small{color:#9aa3b2;margin-left:3px}.lp_chip.on small{color:#dfe}"
      + "#lp_mkt_q{background:#1c2029;color:#eee;border:1px solid #555;border-radius:3px;padding:2px 6px;font:11px 'Segoe UI',Arial;width:130px}#lp_mkt select{background:#1c2029;color:#eee;border:1px solid #555;border-radius:3px;font:11px 'Segoe UI',Arial;padding:1px 4px}"
      + "#lp_mkt_body{padding:4px 10px 8px;max-height:calc(100vh - 260px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}#lp_mkt table{width:100%;border-collapse:collapse}#lp_mkt th,#lp_mkt td{padding:3px 6px;text-align:right;border-bottom:1px solid #22262f;white-space:nowrap}#lp_mkt th{color:#9aa3b2;font-weight:normal;font-size:11px;cursor:pointer;position:sticky;top:0;background:#14161c}#lp_mkt th.sorted{color:#8ab4f8}#lp_mkt tr.lp_mg td:first-child{white-space:normal}#lp_mkt table{table-layout:auto;max-width:100%}#lp_mkt td:last-child{white-space:nowrap}#lp_mkt td.l,#lp_mkt th.l{text-align:left}#lp_mkt tr.here td{background:rgba(30,45,30,.5)}"
      + ".lp_tag{display:inline-block;font-size:10px;padding:0 5px;border-radius:8px;margin-left:4px;vertical-align:1px}.lp_tag.s{background:#1e3a20;color:#7ed67e;border:1px solid #2e7d32}.lp_tag.z{background:#1e2a3f;color:#8ab4f8;border:1px solid #3a5f9a}.lp_tag.b{background:#3a2e1e;color:#ffb74d;border:1px solid #8a6a2e}.lp_tag.k{background:#2a2233;color:#c9a0f0;border:1px solid #6a4a8a}.lp_tag.t{background:#1e3a3a;color:#7ed6d6;border:1px solid #2e7d7d}"
      + "#lp_mkt_foot{padding:4px 10px;border-top:1px solid #2a2f3a;color:#9aa3b2;font-size:11px;display:flex;gap:14px;flex-wrap:wrap}";
    doc.head.appendChild(st);
    var div = doc.createElement("div"); div.id = "lp_mkt";
    div.innerHTML = "<div id='lp_mkt_head'><b>Markt</b><span class='lp_k' id='lp_mkt_info'></span><button data-act='marketscan' class='gold'>Jetzt scannen</button><button data-act='mkttoggle' title='Fenster schließen'>✕</button></div><div id='lp_mkt_bar'></div><div id='lp_mkt_body'></div><div id='lp_mkt_foot'><span><b style='color:#7ed67e'>grün</b> unter NPC-Wert</span><span><b style='color:#8ab4f8'>blau</b> Zielbau</span><span><b style='color:#ffb74d'>orange</b> Beobachtung</span><span><b style='color:#7ed6d6'>türkis</b> Team-Wunsch</span><span><b style='color:#c9a0f0'>lila</b> Kaufgesuch</span><span style='margin-left:auto'>Δ = Aufschlag zum günstigsten Angebot · bei Kaufgesuchen: Gebot zum günstigsten Verkäufer</span></div>";
    doc.body.appendChild(div);
    try { var p = JSON.parse(localStorage.getItem("lp_mkt_pos") || "null"); if (p) clamp_pos(div, p.x, p.y); else clamp_pos(div, Math.max(0, (parent.window.innerWidth || 1200) - 900), 120); } catch (e) {}
    return div;
}
function toggle_market_panel() {
    var on = !(market_panel && market_panel.parentNode);
    if (on) { market_panel = init_market_panel(); render_market(); } else { market_panel.remove(); market_panel = null; }
    try { localStorage.setItem("lp_mkt_open", on ? "1" : "0"); } catch (e) {}
}
function mkt_basic_ok(o, q) { // Server-, Slot- und Suchfilter (ohne Chips)
    if (mkt.sv && (mkt.sv == "here" ? !o.same : norm_server(o.server) != mkt.sv)) return false;
    if (mkt.slot && mkt_slot_of(o.name) != mkt.slot) return false;
    if (q) { var nm = ((G.items[o.name] || {}).name || o.name).toLowerCase(); if (nm.indexOf(q) < 0 && o.name.toLowerCase().indexOf(q) < 0 && o.seller.toLowerCase().indexOf(q) < 0) return false; }
    return true;
}
function mkt_gkey(o) { var d = G.items[o.name] || {}; return d.s ? o.name : o.name + "+" + o.level + "|" + (o.stat_type || ""); } // Stapelware je Item, Ausrüstung je Item+Level+Stat-Typ
function mkt_groups() { // Kompakt: je Item günstigstes Angebot + bestes Kaufgesuch
    var q = (mkt.q || "").toLowerCase(), rows = mkt_filtered(), g = {};
    rows.forEach(function (o) { if (o.b) return; var k = mkt_gkey(o); var gr = g[k] || (g[k] = { key: k, name: o.name, level: o.level, stat_type: o.stat_type, sells: [], bids: [], tags: {} }); gr.sells.push(o); for (var t in o._tags) gr.tags[t] = true; });
    market_all.forEach(function (o) { if (!o.b || !mkt_basic_ok(o, q)) return; var k = mkt_gkey(o), mn0 = mkt_min[o.name + "+" + o.level], isarb = !!(mn0 && o.price >= mn0.price); var gr = g[k]; if (!gr) { if (!(mkt.f.buy || (mkt.f.arb && isarb))) return; /* reine Kaufgesuche nur mit Chip Kaufgesuche oder Arbitrage-Chip */ gr = g[k] = { key: k, name: o.name, level: o.level, stat_type: o.stat_type, sells: [], bids: [], tags: { buy: true } }; } o._tags = o._tags || mkt_tags(o); if (isarb) gr.tags.arb = true; gr.bids.push(o); });
    var out = Object.keys(g).map(function (k) { var gr = g[k]; gr.sells.sort(function (a, b) { return a.price - b.price; }); gr.bids.sort(function (a, b) { return b.price - a.price; }); gr.ask = gr.sells[0] || null; gr.bid = gr.bids[0] || null; gr.span = gr.ask && gr.bid ? (gr.bid.price - gr.ask.price) / gr.ask.price : null; return gr; });
    var k2 = mkt.csort, d = mkt.cdir;
    out.sort(function (a, b) {
        if (k2 == "name") return d * ((G.items[a.name] || {}).name || a.name).localeCompare((G.items[b.name] || {}).name || b.name) || a.level - b.level;
        if (k2 == "level") return d * (a.level - b.level) || (a.ask ? a.ask.price : 1e15) - (b.ask ? b.ask.price : 1e15);
        if (k2 == "bid") return d * ((a.bid ? a.bid.price : -1) - (b.bid ? b.bid.price : -1));
        if (k2 == "price") return d * ((a.ask ? a.ask.price : 1e15) - (b.ask ? b.ask.price : 1e15));
        var sa = a.span == null ? -1e9 : a.span, sb = b.span == null ? -1e9 : b.span; return d * (sa - sb) || (a.ask ? a.ask.price : 0) - (b.ask ? b.ask.price : 0);
    });
    return out;
}
function mkt_tags_html(t) { return (t.schn ? "<span class='lp_tag s'>Schnäppchen</span>" : "") + (t.ziel ? "<span class='lp_tag z'" + (t.ziel_teuer ? " style='opacity:.45' title='über deinem Preislimit'" : "") + ">Zielbau</span>" : "") + (t.watch ? "<span class='lp_tag b'>Beobachtung</span>" : "") + (t.team ? "<span class='lp_tag t'>Team</span>" : "") + (t.buy && !t.arb ? "<span class='lp_tag k'>Kaufgesuch</span>" : "") + (t.arb ? "<span class='lp_tag s'>zahlt mehr als Kauf</span>" : ""); }
function mkt_filtered() {
    var q = (mkt.q || "").toLowerCase(), out = [], seen = {};
    mkt_index();
    market_all.forEach(function (o) {
        var dk = o.name + "+" + o.level + "|" + o.price + "|" + o.seller + "|" + (o.b ? "b" : "s"); if (seen[dk]) { seen[dk]._n++; seen[dk].q += o.q; return; } // gleicher Händler, gleiches Item, gleicher Preis (mehrere Standslots)
        o._n = 1; seen[dk] = o;
        var tags = mkt_tags(o);
        var mn0 = o.b ? mkt_min[o.name + "+" + o.level] : null, isarb = !!(mn0 && o.price >= mn0.price);
        if (o.b) { if (!mkt.f.buy && !(mkt.f.arb && isarb)) return; } else if (!mkt.f.all) { var hit = false; for (var k in tags) if (mkt.f[k]) hit = true; if (!hit) return; }
        if (!mkt_basic_ok(o, q)) return;
        var r = mkt_ref(o), mn = mkt_min[o.name + "+" + o.level]; o._tags = tags; o._ref = r; o._min = mn; o._slot = mkt_slot_of(o.name);
        o._delta = mn && mn.price > 0 ? (o.price - mn.price) / mn.price : null; // Verkauf: Aufschlag zum günstigsten Angebot; Kaufgesuch: Gebot zum günstigsten Verkäufer (≥ 0 = Arbitrage)
        if (o.b && o._delta != null && o._delta >= 0) tags.arb = true;
        out.push(o);
    });
    var k = mkt.sort, d = mkt.dir;
    out.sort(function (a, b) {
        var va, vb;
        if (k == "name") { va = ((G.items[a.name] || {}).name || a.name); vb = ((G.items[b.name] || {}).name || b.name); return d * va.localeCompare(vb); }
        if (k == "level") { va = a.level; vb = b.level; } else if (k == "delta") { va = a._delta == null ? 1e9 * d : a._delta; vb = b._delta == null ? 1e9 * d : b._delta; }
        else if (k == "seller") return d * a.seller.localeCompare(b.seller); else if (k == "server") return d * ((b.same - a.same) || a.server.localeCompare(b.server));
        else { va = a.price; vb = b.price; }
        return d * (va - vb) || a.price - b.price;
    });
    return out;
}
function mkt_action_html(o, i) {
    if (o.b) { var have = inv_count(o.name, o.level), viam2 = merch_can_buy() && !is_pvp_server(o.server); var why = !have ? "nicht in deinem Inventar" : is_pvp_server(o.server) ? "PVP-Server" : (!o.same && !viam2) ? "anderer Server – nur über den Händler möglich (" + (merch_buy ? "Einkauf/Verkauf läuft" : "Händler aus") + ")" : ""; return "<button data-act='msell' data-i='" + i + "' title='" + esc(why || (viam2 ? "Händler holt " + Math.min(have, o.q || 1) + "× " + o.name + " bei dir ab" + (o.same ? "" : ", reist nach " + pretty_server(o.server)) + " und verkauft für " + fmt(o.price) + " je Stück" : "Magier läuft zum Käufer und verkauft " + Math.min(have, o.q || 1) + "× " + o.name)) + "'" + (why ? " disabled" : "") + ">Verkaufen" + (have ? " (" + Math.min(have, o.q || 1) + ")" : "") + (viam2 || !have ? "" : " (Magier)") + "</button>"; }
    if (o.same) { var viam = merch_can_buy() && MB_SAFE_MAPS[o.map]; return "<button data-act='mbuy' data-i='" + i + "' title='" + (viam ? "Händler holt das Gold beim Magier, kauft und bringt es – Magier farmt weiter" : merch_buy ? "Einkauf läuft schon – Magier kauft selbst" : !team_on.merch || !team_running(TEAM.merch) ? "Händler aus – Magier kauft selbst" : "Verkäufer steht auf " + (o.map || "?") + " (für den Händler zu gefährlich) – Magier kauft selbst") + "'>Kaufen" + (viam ? "" : " (Magier)") + "</button> <button data-act='mgoto' data-i='" + i + "' title='nur hinlaufen und pausieren – du schaust selbst'>Hin</button>"; }
    if (is_pvp_server(o.server)) return "<span class='lp_k' title='PVP-Server – kein Serverwechsel'>PVP</span>";
    var viat = merch_can_buy();
    var h = "<button data-act='mtrip' data-i='" + i + "' title='" + (viat ? "Händler holt das Gold, reist auf den Server, kauft und bringt es – Magier farmt weiter" : "Magier wechselt selbst auf diesen Server, kauft und kommt zurück") + " (" + (o.price > character.gold ? "zu wenig Gold" : "Gold reicht") + ")'" + (server_trip || arb_job || merch_buy || o.price > character.gold ? " disabled" : "") + ">Serverkauf" + (viat ? "" : " (Magier)") + "</button>";
    if (o._tags.schn) h += " <button data-act='marb' data-i='" + i + "' title='Händler reist auf diesen Server und kauft alle lohnenden Angebote dort'" + (arb_blocked() ? " disabled" : "") + ">Handelsreise</button>";
    return h;
}
function render_market() {
    if (!market_panel || !market_panel.parentNode) return;
    try { render_market_inner(); } catch (e) { game_log("Markt-Anzeige: " + err_txt(e) + (e && e.stack ? " @ " + String(e.stack).split("\n")[1] : "")); }
}
function render_market_inner() {
    try { var ae = parent.document.activeElement; if (ae && ae.id == "lp_mkt_q") { var keep = true; } } catch (e) {}
    var rows = mkt_filtered(); mkt_rows = rows;
    var cnt = { all: 0, schn: 0, ziel: 0, watch: 0, team: 0, buy: 0, arb: 0 };
    var q0 = (mkt.q || "").toLowerCase();
    market_all.forEach(function (o) { if (!mkt_basic_ok(o, q0)) return; var t = mkt_tags(o); if (o.b) { cnt.buy++; var mn0 = mkt_min[o.name + "+" + o.level]; if (mn0 && o.price >= mn0.price) cnt.arb++; } else { cnt.all++; for (var k in t) if (cnt[k] != null) cnt[k]++; } }); // Zähler gelten für den gesetzten Server-/Slot-/Suchfilter
    market_panel.querySelector("#lp_mkt_info").textContent = market_scan_t ? "Scan vor " + fmt_time(Date.now() - market_scan_t) + " · " + market_n_merch + " Händler · " + cnt.all + " Angebote · " + cnt.buy + " Kaufgesuche" : "noch kein Scan";
    var chip = function (k, lab) { return "<span class='lp_chip" + (mkt.f[k] ? " on" : "") + "' data-mf='" + k + "'>" + lab + "<small>" + cnt[k] + "</small></span>"; };
    var servers = {}; market_all.forEach(function (o) { servers[norm_server(o.server)] = o.server; });
    var slots = {}; market_all.forEach(function (o) { slots[mkt_slot_of(o.name)] = true; });
    var bar = chip("schn", "Schnäppchen") + chip("ziel", "Zielbau") + chip("watch", "Beobachtung") + chip("team", "Team-Wünsche") + chip("arb", "Kaufgesuch > Kaufpreis") + chip("buy", "Kaufgesuche") + chip("all", "Alle") + " <button data-act='mview' title='Kompakt: eine Zeile je Item (günstigstes Angebot + bestes Kaufgesuch), Klick auf die Zeile klappt alle Angebote auf · Einzeln: jedes Angebot als Zeile'>" + (mkt.view == "kompakt" ? "Kompakt" : "Einzeln") + "</button>"
      + "<span style='flex:1'></span><input id='lp_mkt_q' placeholder='Suche: Item / Händler …' value='" + esc(mkt.q) + "'>"
      + "<select data-msel='sv'><option value=''>alle Server</option><option value='here'" + (mkt.sv == "here" ? " selected" : "") + ">nur hier (" + esc(pretty_server(my_server())) + ")</option>" + Object.keys(servers).sort().map(function (k) { return "<option value='" + k + "'" + (mkt.sv == k ? " selected" : "") + ">" + esc(pretty_server(servers[k])) + "</option>"; }).join("") + "</select>"
      + "<select data-msel='slot'><option value=''>alle Slots</option>" + Object.keys(slots).sort().map(function (k) { return "<option value='" + esc(k) + "'" + (mkt.slot == k ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + "</select>";
    if (!keep) market_panel.querySelector("#lp_mkt_bar").innerHTML = bar;
    var h = "";
    if (!market_all.length) h = "<div style='color:#9aa3b2;padding:6px 0'>noch kein Scan – „Jetzt scannen“ drücken</div>";
    else if (mkt.view == "kompakt") h = mkt_compact_html();
    else {
        var th = function (k, lab, left) { return "<th class='" + (left ? "l " : "") + (mkt.sort == k ? "sorted" : "") + "' data-msort='" + k + "'>" + lab + (mkt.sort == k ? (mkt.dir > 0 ? " ▲" : " ▼") : "") + "</th>"; };
        h = "<table><tr>" + th("name", "Item", true) + th("level", "Lv") + th("price", "Preis") + "<th title='günstigstes Verkaufsangebot desselben Items+Level auf allen Servern'>günstigst</th>" + th("delta", "Δ") + th("seller", "Händler", true) + th("server", "Server · Karte", true) + "<th></th></tr>";
        if (!rows.length) h += "<tr><td class='l' colspan='8' style='color:#9aa3b2'>nichts passt zu den Filtern</td></tr>";
        var lim2 = mkt_show || 200; rows.slice(0, lim2).forEach(function (o, i) { h += mkt_row_html(o, i, false); });
        if (rows.length > lim2) h += "<tr><td class='l' colspan='8'><button data-act='mmore'>" + Math.min(200, rows.length - lim2) + " weitere anzeigen</button> <span style='color:#6b7280'>(" + lim2 + " von " + rows.length + ")</span></td></tr>";
        h += "</table>";
    }
    market_panel.querySelector("#lp_mkt_body").innerHTML = h;
    market_panel.querySelectorAll("[data-act='marketscan']").forEach(function (b) { b.textContent = scanning_now ? "Scan läuft…" : "Jetzt scannen"; b.disabled = !!scanning_now; });
}
function mkt_row_html(o, i, sub) { // eine Angebotszeile (Einzelansicht oder aufgeklappt unter einer Kompaktzeile)
    var d = G.items[o.name] || {}, t = o._tags || {}, r = o._ref || mkt_ref(o), mn = o._min || mkt_min[o.name + "+" + o.level];
    var dl = o._delta, dc = dl == null ? "#6b7280" : o.b ? (dl >= 0 ? "#4caf50" : "#9aa3b2") : dl <= 0.001 ? "#4caf50" : dl >= 1 ? "#ef5350" : dl >= 0.25 ? "#ffb74d" : "#9aa3b2";
    var dtxt = dl == null ? "–" : (!o.b && mn && mn._cnt < 2) ? "<span style='color:#6b7280'>einziges</span>" : (!o.b && dl <= 0.001) ? "günstigst" : (dl > 0 ? "+" : "") + Math.round(dl * 100) + " %";
    var tip = o.name + (o.stat_type ? " · " + o.stat_type : "") + " · " + (o._slot || mkt_slot_of(o.name)) + (o.q > 1 ? " · Menge " + o.q : "") + (o._n > 1 ? " · " + o._n + " Standslots" : "") + " · NPC-Wert " + (r.npc ? fmt(Math.round(r.npc)) : "–") + (r.avg ? " · Ø Markt " + fmt(r.avg) + " (" + (market_hist[o.name + "+" + o.level] || []).length + " Scans)" : "") + (mn ? " · günstigst bei " + mn.seller + " (" + pretty_server(mn.server) + ")" : "");
    var first = sub ? "<td class='l' style='padding-left:22px;color:#9aa3b2'>" + (o.b ? "Kaufgesuch" : "Angebot") + "</td>" : "<td class='l'>" + mkt_label(o.name) + mkt_tags_html(t) + "</td>";
    return "<tr" + (o.same ? " class='here'" : "") + (sub ? " style='font-size:11px'" : "") + " title='" + esc(tip) + "'>" + first + "<td>" + (d.s ? "×" + o.q : "+" + o.level) + (o._n > 1 && !d.s ? " <small style='color:#6b7280'>×" + o._n + "</small>" : "") + "</td><td style='color:" + (o.b ? "#c9a0f0" : t.schn ? "#4caf50" : "#e6e6e6") + "'>" + fmt(o.price) + "</td><td class='lp_k'>" + (mn ? fmt(mn.price) + (mn.same ? " ★" : "") : "—") + "</td><td style='color:" + dc + "'>" + dtxt + "</td><td class='l'>" + esc(o.seller) + "</td><td class='l'>" + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + " · " + esc(o.map || "?") + "</td><td>" + mkt_action_html(o, i) + "</td></tr>";
}
function mkt_compact_html() {
    var groups = mkt_groups(); mkt_rows = [];
    var th = function (k, lab, left, tip) { return "<th class='" + (left ? "l " : "") + (mkt.csort == k ? "sorted" : "") + "' data-mcsort='" + k + "'" + (tip ? " title='" + tip + "'" : "") + ">" + lab + (mkt.csort == k ? (mkt.cdir > 0 ? " ▲" : " ▼") : "") + "</th>"; };
    var h = "<table><tr>" + th("name", "Item", true) + th("level", "Lv") + th("price", "günstigstes Angebot", false, "Preis · Händler · Server (Anzahl Anbieter)") + th("bid", "bestes Kaufgesuch", false, "Gebot · Händler · Server (Anzahl Gesuche)") + th("span", "Spanne", false, "Kaufgesuch minus günstigstes Angebot – grün = jemand zahlt mehr, als der Kauf kostet") + "<th></th></tr>";
    if (!groups.length) h += "<tr><td class='l' colspan='6' style='color:#9aa3b2'>nichts passt zu den Filtern" + (mkt.slot || mkt.sv || mkt.q ? " (aktiv: " + esc([mkt.slot, mkt.sv ? (mkt.sv == "here" ? "nur hier" : pretty_server(mkt.sv)) : "", mkt.q ? "Suche „" + mkt.q + "“" : ""].filter(Boolean).join(", ")) + ")" : "") + "</td></tr>";
    var idx = function (o) { mkt_rows.push(o); return mkt_rows.length - 1; };
    var lim = mkt_show || 150;
    groups.slice(0, lim).forEach(function (gr) {
        var d = G.items[gr.name] || {}, a = gr.ask, b = gr.bid, open = !!mkt.open[gr.key];
        var atxt = a ? "<span style='color:" + (gr.tags.schn ? "#4caf50" : "#e6e6e6") + "'>" + fmt(a.price) + "</span> <span class='lp_k'>" + esc(a.seller) + " · " + esc(pretty_server(a.server)) + (a.same ? " ★" : "") + (gr.sells.length > 1 ? " (" + gr.sells.length + ")" : "") + "</span>" : "<span class='lp_k'>–</span>";
        var btxt = b ? "<span style='color:#c9a0f0'>" + fmt(b.price) + "</span>" + (d.s && b.q > 1 ? " <span class='lp_k'>×" + b.q + "</span>" : "") + " <span class='lp_k'>" + esc(b.seller) + " · " + esc(pretty_server(b.server)) + (b.same ? " ★" : "") + (gr.bids.length > 1 ? " (" + gr.bids.length + ")" : "") + "</span>" : "<span class='lp_k'>–</span>";
        var sp = gr.span, sc = sp == null ? "#6b7280" : sp >= 0 ? "#4caf50" : "#9aa3b2", stxt = sp == null ? "–" : (sp > 0 ? "+" : "") + Math.round(sp * 100) + " %";
        var act = (a ? mkt_action_html(a, idx(a)) : "") + (b && inv_count(b.name, b.level) ? " " + mkt_action_html(b, idx(b)) : "");
        h += "<tr class='lp_mg" + (a && a.same ? " here" : "") + "' data-mg='" + esc(gr.key) + "' style='cursor:pointer'><td class='l'><span style='color:#6b7280;display:inline-block;width:10px'>" + (open ? "▾" : "▸") + "</span>" + mkt_label(gr.name) + (gr.stat_type ? " <small style='color:#9aa3b2'>" + esc(gr.stat_type) + "</small>" : "") + mkt_tags_html(gr.tags) + "</td><td>" + (d.s ? "–" : "+" + gr.level) + "</td><td>" + atxt + "</td><td>" + btxt + "</td><td style='color:" + sc + "'>" + stxt + "</td><td>" + act + "</td></tr>";
        if (open) { gr.sells.concat(gr.bids).forEach(function (o) { var dl = o._delta != null ? o._delta : (a && a.price > 0 ? (o.price - a.price) / a.price : null); var dc = dl == null ? "#6b7280" : o.b ? (dl >= 0 ? "#4caf50" : "#9aa3b2") : dl <= 0.001 ? "#4caf50" : dl >= 1 ? "#ef5350" : dl >= 0.25 ? "#ffb74d" : "#9aa3b2"; var dtxt = dl == null ? "" : (!o.b && dl <= 0.001) ? "günstigst" : (dl > 0 ? "+" : "") + Math.round(dl * 100) + " %";
            h += "<tr" + (o.same ? " class='here'" : "") + " style='font-size:11px'><td class='l' style='padding-left:22px'><span class='lp_k'>" + (o.b ? "Kaufgesuch" : "Angebot") + "</span> " + esc(o.seller) + " <span class='lp_k'>· " + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + " · " + esc(o.map || "?") + (o.stat_type ? " · " + esc(o.stat_type) : "") + "</span></td><td>" + (d.s ? "×" + o.q : "+" + o.level) + (o._n > 1 && !d.s ? " <small style='color:#6b7280'>×" + o._n + "</small>" : "") + "</td><td style='color:" + (o.b ? "#c9a0f0" : "#e6e6e6") + "'>" + fmt(o.price) + "</td><td></td><td style='color:" + dc + "'>" + dtxt + "</td><td>" + mkt_action_html(o, idx(o)) + "</td></tr>"; }); }
    });
    if (groups.length > lim) h += "<tr><td class='l' colspan='6'><button data-act='mmore'>" + Math.min(150, groups.length - lim) + " weitere anzeigen</button> <span style='color:#6b7280'>(" + lim + " von " + groups.length + ")</span></td></tr>";
    return h + "</table>";
}
function market_click(b) { // Klicks im Markt-Fenster (true = verarbeitet)
    var mf = b.getAttribute("data-mf"), ms = b.getAttribute("data-msort"), mcs = b.getAttribute("data-mcsort"), mg = b.getAttribute("data-mg"), act = b.getAttribute("data-act"), i = parseInt(b.getAttribute("data-i"));
    if (mf) { mkt.f[mf] = !mkt.f[mf]; game_log("Markt-Filter " + mf + ": " + (mkt.f[mf] ? "an" : "aus")); if (mf == "all" && mkt.f.all) { for (var fk in mkt.f) if (fk != "all") mkt.f[fk] = false; } else if (mf != "all" && mkt.f[mf]) mkt.f.all = false; mkt_show = 0; save_mkt(); render_market(); return true; } // „Alle“ ist exklusiv zu den anderen Chips
    if (act == "mmore") { var body = market_panel && market_panel.querySelector("#lp_mkt_body"), stop = body ? body.scrollTop : 0; mkt_show = (mkt_show || (mkt.view == "kompakt" ? 150 : 200)) + (mkt.view == "kompakt" ? 150 : 200); render_market(); try { if (body) body.scrollTop = stop; } catch (e) {} return true; }
    if (act == "mview") { mkt.view = mkt.view == "kompakt" ? "alle" : "kompakt"; save_mkt(); render_market(); return true; }
    if (mcs) { if (mkt.csort == mcs) mkt.cdir = -mkt.cdir; else { mkt.csort = mcs; mkt.cdir = (mcs == "name" || mcs == "level" || mcs == "price") ? 1 : -1; } save_mkt(); render_market(); return true; }
    if (mg && !act) { mkt.open[mg] = !mkt.open[mg]; render_market(); return true; }
    if (ms) { if (mkt.sort == ms) mkt.dir = -mkt.dir; else { mkt.sort = ms; mkt.dir = (ms == "name" || ms == "seller" || ms == "server" || ms == "price") ? 1 : -1; } save_mkt(); render_market(); return true; }
    if (!act) return false; var o = mkt_rows[i];
    if (act == "mbuy" && o && merch_can_buy() && MB_SAFE_MAPS[o.map]) { merch_buy_start(o, "here"); render_market(); return true; }
    if (act == "mbuy" && o) { market_job = { mode: "buy", o: o }; game_log("Markt: kaufe " + o.name + (o.level ? "+" + o.level : "") + " für " + fmt(o.price) + " bei " + o.seller + " – laufe hin"); run_market_job(); return true; }
    if (act == "msell" && o && merch_can_buy() && !is_pvp_server(o.server)) { merch_sell_start(o); render_market(); return true; }
    if (act == "msell" && o && o.same) { market_job = { mode: "sell", o: o }; game_log("Markt: verkaufe " + o.name + (o.level ? "+" + o.level : "") + " an " + o.seller + " für " + fmt(o.price) + " – laufe hin"); run_market_job(); return true; }
    if (act == "mgoto" && o) { market_job = { mode: "goto", o: o }; game_log("Markt: laufe zu " + o.seller + " (" + (o.map || "?") + ")"); run_market_job(); return true; }
    if (act == "mtrip" && o && merch_can_buy() && !is_pvp_server(o.server)) { merch_buy_start(o, "trip"); render_market(); return true; }
    if (act == "mtrip" && o) { var f = global_finds.filter(function (x) { return x.name == o.name && x.seller == o.seller && x.price == o.price; })[0]; if (!f) f = { name: o.name, level: o.level, price: o.price, q: o.q, seller: o.seller, server: o.server, map: o.map, x: o.x, y: o.y, tslot: o.tslot, slot: "markt", force: true, market: true, t: Date.now() }; game_log("Serverkauf: " + o.name + (o.level ? "+" + o.level : "") + " für " + fmt(o.price) + " bei " + o.seller + " auf " + pretty_server(o.server)); start_trip(f); render_market(); return true; }
    if (act == "marb" && o) { start_arb_trip(norm_server(o.server)); render_market(); return true; }
    return false;
}
async function run_market_job() { // Klick im Markt-Fenster: hinlaufen und kaufen bzw. nur hinlaufen
    if (!market_job || busy || upgrading || kissing || fleeing || handing) return;
    var j = market_job, o = j.o; market_job = null; busy = true; marketing = true; paused = false;
    try {
        set_message(j.mode == "goto" ? "Markt: hin" : j.mode == "sell" ? "Markt: Verkauf" : "Markt: Kauf");
        if (o.map && o.x != null) await travel({ map: o.map, x: o.x, y: o.y + 30 });
        if (j.mode == "sell") {
            var buyer = get_player(o.seller); if (buyer && distance(character, buyer) > 250) { try { await travel({ map: buyer.map || character.map, x: buyer.x, y: buyer.y + 30 }); } catch (e) {} buyer = get_player(o.seller); }
            if (!buyer || !buyer.slots) game_log("Markt: Käufer " + o.seller + " nicht (mehr) hier");
            else {
                var bs = null, bsl = o.tslot; var c0 = buyer.slots[bsl]; if (c0 && c0.b && c0.name == o.name && (c0.level || 0) == (o.level || 0) && c0.price >= o.price * 0.95) bs = c0; else for (var sl2 in buyer.slots) { var c2 = buyer.slots[sl2]; if (sl2.indexOf("trade") == 0 && c2 && c2.b && c2.name == o.name && (c2.level || 0) == (o.level || 0) && c2.price >= o.price * 0.95) { bs = c2; bsl = sl2; break; } }
                if (!bs) game_log("Markt: Kaufgesuch bei " + o.seller + " nicht mehr da oder niedriger");
                else { var qs = Math.max(1, Math.min(bs.q || 1, inv_count(o.name, o.level))), g1 = character.gold; try { await trade_sell(buyer, bsl, qs); } catch (e) { try { trade_sell(buyer, bsl, qs); } catch (e2) {} } await sleep(1500); game_log("Markt: " + o.name + (o.level ? "+" + o.level : "") + (qs > 1 ? " ×" + qs : "") + (character.gold > g1 ? " verkauft für " + fmt(character.gold - g1) : " – Verkauf nicht bestätigt (Gold unverändert)")); }
            }
        }
        else if (j.mode == "goto") { paused = true; set_message("PAUSE"); game_log("Markt: bei " + o.seller + " – Bot pausiert, damit du in Ruhe schauen kannst (Pause aufheben zum Weiterfarmen)"); }
        else {
            var lo = await locate_offer(o);
            if (lo) {
                var d = G.items[o.name] || {}, price = lo.it.price, q = d.s ? Math.max(1, Math.min(lo.it.q || 1, Math.floor(spendable() / price))) : 1;
                if (price * q > character.gold) game_log("Markt: nicht genug Gold für " + o.name + " (" + fmt(price) + ")");
                else if (character.esize < 1) game_log("Markt: Inventar voll");
                else { var g0 = character.gold; trade_buy(lo.seller, lo.slot, q); await sleep(1500); game_log("Markt: " + o.name + (o.level ? "+" + o.level : "") + (q > 1 ? " ×" + q : "") + (character.gold < g0 ? " gekauft für " + fmt(g0 - character.gold) : " – Kauf nicht bestätigt (Gold unverändert)")); }
            }
        }
    } catch (e) { game_log("Markt: " + err_txt(e)); }
    busy = false; marketing = false;
    if (!paused) go_to_farm_spot();
}
// ---------- Einkauf über den Händler: Gold holen, kaufen (hier oder per Reise), zum Magier bringen ----------
var MG = { target: 5000000, min: 1000000, esc_max: 2000000 }; try { var mg0 = JSON.parse(localStorage.getItem("lp_merch_gold") || "null"); if (mg0) for (var mgk in mg0) MG[mgk] = mg0[mgk]; if (MG.esc_max < 2000000 && localStorage.getItem("lp_mg_v264") != "1") { MG.esc_max = 2000000; localStorage.setItem("lp_mg_v264", "1"); localStorage.setItem("lp_merch_gold", JSON.stringify(MG)); } } catch (e) {} // Händler-Kasse: Ziel, Nachfüllgrenze, Obergrenze Priest/Ranger
var donate_auto = false, DONATE_LVL = 40, donate_amt = 500000, last_donate = 0, donate_rate = 0; try { donate_rate = parseFloat(localStorage.getItem("lp_donate_rate") || "0") || 0; } catch (e) {} try { donate_auto = localStorage.getItem("lp_donate_auto") == "1"; donate_amt = parseInt(localStorage.getItem("lp_donate_amt") || "500000") || 500000; } catch (e) {}
function lvl_xp_between(a, b) { var s = 0; for (var l = a; l < b; l++) s += G.levels[l] || 0; return s; }
function donate_tick() { // Auto: Händler spendet bei Ron, solange er unter DONATE_LVL ist und die Kasse über der Nachfüllgrenze liegt
    if (!donate_auto || SOLO || !team_on.merch || !team_running(TEAM.merch) || Date.now() - last_donate < 90000) return;
    var st = team_state[TEAM.merch]; if (!st || Date.now() - st.t > 90000 || st.level == null) return;
    if (st.level >= DONATE_LVL) { donate_auto = false; try { localStorage.setItem("lp_donate_auto", "0"); } catch (e) {} game_log("Spenden-Automatik: Händler hat Lv " + st.level + " erreicht – aus"); last_panel = 0; return; }
    if (/Abholung|Reise|spendet|Einkauf|Verkauf|Lieferung|räumt/.test(st.state || "") || merch_buy || arb_job) return;
    var avail = Math.floor(((st.gold || 0) - MG.min) / 100000) * 100000; if (avail < 100000) return;
    last_donate = Date.now(); team_send(TEAM.merch, { t: "donate", gold: Math.min(avail, 2000000), target: DONATE_LVL }); game_log("Spenden-Automatik: " + fmt(Math.min(avail, 2000000)) + " Gold bei Ron (Händler Lv " + st.level + ")");
}
function mg_save() { try { localStorage.setItem("lp_merch_gold", JSON.stringify(MG)); } catch (e) {} last_panel = 0; }
var merch_buy = null; try { merch_buy = JSON.parse(localStorage.getItem("lp_merch_buy") || "null"); } catch (e) {}
var MB_SAFE_MAPS = { main: true, bank: true, winterland: true };
function inv_count(name, level) { var q = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) == (level || 0)) q += it.q || 1; } return q; }
function mb_save() { try { if (merch_buy) localStorage.setItem("lp_merch_buy", JSON.stringify(merch_buy)); else localStorage.removeItem("lp_merch_buy"); } catch (e) {} last_panel = 0; }
function merch_can_buy() { return !SOLO && team_on.merch && team_running(TEAM.merch) && !merch_buy && !arb_job && !server_trip; }
function mb_stage_txt() { if (!merch_buy) return ""; var j = merch_buy, o = j.o, nm = o.name + (o.level ? "+" + o.level : ""); if (j.kind == "sell") { var sst = { call: "wartet auf Gelegenheit, Händler zu rufen", calling: "Händler holt das Item", selling: "Händler verkauft an " + o.seller, trip: "Reise wird gestartet", away: "Händler verkauft auf " + pretty_server(o.server) }[j.stage] || j.stage; return "Verkauf " + j.q + "× " + nm + " (" + fmt(o.price) + ") – " + sst; }
    var st = { direct: "Auftrag geht an den Händler (eigene Kasse)", call: "wartet auf Gelegenheit, Händler zu rufen", calling: "Händler unterwegs zum Gold holen", buying: "Händler kauft bei " + o.seller, deliver: "Händler bringt es", trip: "Reise wird gestartet", away: "Händler auf " + pretty_server(o.server), fetch: "Händler wird zum Abholen gerufen", fetching: "Händler bringt es" }[j.stage] || j.stage; return nm + " (" + fmt(o.price) + (j.q > 1 ? " ×" + j.q : "") + ") – " + st; }
function merch_buy_start(o, mode) {
    if (!merch_can_buy()) { game_log("Einkauf über Händler nicht möglich" + (merch_buy ? " – läuft schon: " + mb_stage_txt() : arb_job ? " – Handelsreise läuft" : "")); return false; }
    var mst = team_state[TEAM.merch], mgold = mst && mst.gold != null ? mst.gold : 0, budget = spendable() + Math.max(0, mgold - 50000);
    var d = G.items[o.name] || {}, q = d.s ? Math.max(1, Math.min(o.q || 1, Math.floor(budget / o.price))) : 1;
    var need = Math.ceil(o.price * q * 1.05) + 2000, own = mgold - 50000 >= need; // Händler zahlt aus eigener Kasse, wenn sie reicht
    var gold = 0;
    if (!own) { var gap = need - Math.max(0, mgold - 50000), top = Math.max(gap, MG.target - mgold); if (spendable() >= top) gold = top; else if (spendable() >= gap) gold = gap; else { game_log("Einkauf: zu wenig Gold – nötig " + fmt(gap) + " zusätzlich zur Händlerkasse (" + fmt(mgold) + "), verfügbar " + fmt(spendable()) + " über der Reserve"); return false; } }
    merch_buy = { id: Date.now(), o: { name: o.name, level: o.level || 0, price: o.price, q: o.q, seller: o.seller, server: o.server, map: o.map, x: o.x, y: o.y, tslot: o.tslot }, q: q, gold: gold, mode: mode, stage: own ? (mode == "here" ? "direct" : "trip") : "call", t: Date.now(), tries: 0 }; mb_save();
    game_log("Einkauf über Händler: " + o.name + (o.level ? "+" + o.level : "") + (q > 1 ? " ×" + q : "") + " für " + fmt(o.price) + (mode == "trip" ? " auf " + pretty_server(o.server) : " bei " + o.seller) + (own ? " – aus der Händlerkasse (" + fmt(mgold) + ")" : " – Händler holt " + fmt(gold) + " Gold"));
    return true;
}
function merch_sell_start(o) {
    if (!merch_can_buy()) { game_log("Verkauf über Händler nicht möglich" + (merch_buy ? " – läuft schon: " + mb_stage_txt() : arb_job ? " – Handelsreise läuft" : "")); return false; }
    var have = inv_count(o.name, o.level); if (!have) { game_log("Verkauf: " + o.name + " nicht im Inventar"); return false; }
    var q = Math.max(1, Math.min(o.q || 1, have));
    merch_buy = { id: Date.now(), kind: "sell", o: { name: o.name, level: o.level || 0, price: o.price, q: o.q, seller: o.seller, server: o.server, map: o.map, x: o.x, y: o.y, tslot: o.tslot }, q: q, gold: 0, mode: o.same ? "here" : "trip", stage: "call", t: Date.now(), tries: 0 }; mb_save();
    game_log("Verkauf über Händler: " + q + "× " + o.name + (o.level ? "+" + o.level : "") + " an " + o.seller + " für " + fmt(o.price) + " je Stück" + (o.same ? "" : " auf " + pretty_server(o.server)) + " – Händler holt das Item");
    return true;
}
function mb_fail(why) { if (!merch_buy) return; game_log("Einkauf abgebrochen: " + why + " (" + mb_stage_txt() + ")"); merch_buy = null; mb_save(); }
function mb_done(msg) { if (!merch_buy) return; game_log("Einkauf fertig: " + msg); merch_buy = null; mb_save(); }
function merch_buy_tick() {
    if (!merch_buy) return; var j = merch_buy, el = Date.now() - j.t;
    if (j.stage == "direct") { if (!team_running(TEAM.merch)) { if (el > 5 * 60000) mb_fail("Händler läuft nicht"); return; } team_send(TEAM.merch, { t: "buy", buy: Object.assign({}, j.o, { id: j.id, q: j.q, mode: "here" }) }); j.stage = "buying"; j.t = Date.now(); mb_save(); return; }
    if (j.stage == "call" || j.stage == "fetch") {
        if (busy || handing || paused || upgrading || fleeing || kissing || exchanging || character.rip) return;
        if (!merchant_available()) { if (el > 8 * 60000) mb_fail("Händler nicht verfügbar"); return; }
        var was = j.stage; j.stage = was == "call" ? "calling" : "fetching"; j.t = Date.now(); mb_save();
        merchant_pickup(was == "call" ? "Einkauf" : "Einkauf abholen").then(function (ok) {
            if (!merch_buy || merch_buy.id != j.id) return;
            if (was == "call" && j.kind == "sell") { if (!ok || !j.item_sent) { j.stage = "call"; j.t = Date.now(); j.tries++; if (j.tries >= 3) mb_fail("Händler kam nicht / Item nicht übergeben"); mb_save(); return; } j.stage = j.mode == "here" ? "selling" : "trip"; j.t = Date.now(); mb_save(); return; }
            if (was == "call") { if (!ok || !j.gold_sent) { j.stage = "call"; j.t = Date.now(); j.tries++; if (j.tries >= 3) mb_fail("Händler kam nicht / Gold nicht übergeben"); mb_save(); return; } j.stage = j.mode == "here" ? "buying" : "trip"; j.t = Date.now(); mb_save(); }
            else { if (ok && j.got) mb_done(j.o.name + (j.got > 1 ? " ×" + j.got : "") + " erhalten"); else { j.stage = "fetch"; j.t = Date.now(); j.tries++; if (j.tries >= 4) mb_fail("Abholung nicht gelungen – Item liegt beim Händler"); mb_save(); } }
        });
        return;
    }
    if (j.stage == "buying" || j.stage == "deliver" || j.stage == "selling") { if (el > 12 * 60000) mb_fail("keine Rückmeldung vom Händler"); return; }
    if (j.stage == "trip") { if (arb_job) return; var why = arb_blocked(); if (why && !/Pause bis/.test(why)) { mb_fail("Reise nicht möglich: " + why); return; } if (why) return; mb_start_trip(); return; }
    if (j.stage == "away") { if (!arb_job) { if (j.kind == "sell") { mb_done("Verkaufsreise beendet – Erlös liegt in der Händlerkasse"); return; } j.stage = "fetch"; j.t = Date.now(); j.tries = 0; mb_save(); } else if (el > 20 * 60000) mb_fail("Reise ohne Ende"); return; }
}
function mb_start_trip() { // Handelsreise mit genau diesem Angebot, Item wird behalten
    var j = merch_buy, o = j.o, sp = split_server(norm_server(o.server).toUpperCase()); if (!sp) { mb_fail("Server unbekannt (" + o.server + ")"); return; }
    var nm = TEAM.merch;
    arb_job = { id: Date.now(), server: o.server, region: sp.region, sid: sp.id, offers: [{ name: o.name, level: o.level, price: o.price, q: j.q, seller: o.seller, map: o.map, x: o.x, y: o.y, tslot: o.tslot, profit: 0, sell: j.kind == "sell" }], t: Date.now(), stage: "stopped", profit: 0, keep: true, sellonly: j.kind == "sell", buy_id: j.id };
    arb_save_job(); try { localStorage.removeItem("lp_arb_result_" + nm); } catch (e) {}
    last_arb_trip = Date.now();
    try { if (active_chars()[nm]) stop_character(nm); } catch (e) {}
    try { parent.__lp_team_restart_after = Date.now() + 12 * 60000; } catch (e) {}
    j.stage = "away"; j.t = Date.now(); mb_save();
    game_log((j.kind == "sell" ? "Verkauf" : "Einkauf") + ": Händler reist nach " + pretty_server(o.server) + " für " + o.name + (o.level ? "+" + o.level : ""));
}
var scanning_now = false;
async function market_scan_now() { // Knopf im Händler-Bereich: sofortiger Scan, Ergebnis ins Log
    if (scanning_now) return; scanning_now = true; last_panel = 0; game_log("Schnäppchen-Scan gestartet …"); render_market();
    try {
        await scan_all_merchants(true);
        var al = arb_list();
        if (!al.length) game_log("Schnäppchen: nichts unter NPC-Wert gefunden");
        else game_log("Schnäppchen: " + al.length + " Angebote unter NPC-Wert – " + al.slice(0, 5).map(function (o) { return o.name + (o.level ? "+" + o.level : "") + " " + fmt(o.price) + " → " + fmt(Math.round(npc_sell_price(o.name, o.level))) + " (" + pretty_server(o.server) + ", +" + fmt(o.profit) + ")"; }).join(", "));
        if (global_finds.length) game_log("Zielbau: " + global_finds.length + " passende Angebote" + (global_finds.filter(function (f) { return f.same; }).length ? ", davon " + global_finds.filter(function (f) { return f.same; }).length + " hier" : ""));
    } catch (e) { game_log("Schnäppchen-Scan: " + err_txt(e)); }
    scanning_now = false; last_panel = 0; render_market();
}
async function scan_all_merchants(force, only_slot) {
    if (!force && Date.now() - last_global_scan < GLOBAL_SCAN_INTERVAL) return null;
    last_global_scan = Date.now();
    var res = null, merchants = [], raw = "";
    // Der Spielclient schickt JSON per POST an /api/<method> (aus parent.api_call abgelesen)
    try {
        var r = await fetch("https://adventure.land/api/pull_merchants", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json; charset=utf-8" }, body: "{}" });
        raw = await r.text(); try { res = JSON.parse(raw); } catch (e) { res = raw; }
        collect_merchants(res, merchants, 0);
    } catch (e) { raw = "fetch-Fehler: " + err_txt(e); }
    if (!merchants.length) { // Fallback: Händlerliste des Clients selbst laden und auslesen
        try { if (typeof parent.load_merchants == "function") { parent.load_merchants(); await sleep(3000); } collect_merchants(parent.merchants, merchants, 0); } catch (e) {}
    }
    if (!global_debug_done) { global_debug_done = true; try { game_log("Händler-Abfrage: " + merchants.length + " Händler" + (merchants[0] ? ", Felder: " + Object.keys(merchants[0]).slice(0, 14).join(",") : "") + " | Antwort: " + String(raw).slice(0, 220).replace(/\s+/g, " ") + " | parent.merchants: " + (parent.merchants ? (Array.isArray(parent.merchants) ? "Array[" + parent.merchants.length + "]" : "Keys " + Object.keys(parent.merchants).slice(0, 8).join(",")) : "-")); } catch (e) {} }
    try { market_note_scan(merchants); } catch (e) { game_log("Markt-Liste: " + err_txt(e)); }
    var finds = [], mine = my_server(), all = [], arb = []; watch_prices = {};
    merchants.forEach(function (m) {
        for (var sl in m.slots) {
            if (sl.indexOf("trade") != 0) continue;
            var it = m.slots[sl]; if (!it || !it.price) continue;
            if (WATCH_ITEMS[it.name]) { var wl = (watch_prices[it.name] = watch_prices[it.name] || { asks: [], bids: [], t: Date.now() }); (it.b ? wl.bids : wl.asks).push({ price: it.price, q: it.q || 1, seller: m.name, server: m.server || "?", level: it.level || 0 }); }
            if (it.b) continue;
            var d0 = G.items[it.name];
            if (d0) { var ao = { name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, seller: m.name, server: m.server || "?", same: norm_server(m.server) == mine, map: m.map, x: m.x, y: m.y, tslot: sl, t: Date.now() }; ao.profit = arb_profit(ao); if (ao.profit > 0) arb.push(ao); }
            if (d0 && slot_for_item(d0)) all.push({ name: it.name, level: it.level || 0, price: it.price, seller: m.name, server: m.server || "?", same: norm_server(m.server) == mine, map: m.map, x: m.x, y: m.y, tslot: sl, stat_type: it.stat_type || null, score: gear_score(d0, it.level || 0, it.stat_type), t: Date.now() });
            if (!on_wishlist(it.name)) continue;
            if (norm_server(m.server) != mine && is_pvp_server(m.server)) continue; // kein Serverwechsel auf PVP-Server
            var slot = wish_wants(it.name, it.level || 0, it.price);
            if (!slot || (only_slot && slot != only_slot)) continue;
            finds.push({ name: it.name, level: it.level || 0, price: it.price, seller: m.name, server: m.server || "?", map: m.map, x: m.x, y: m.y, slot: slot, tslot: sl, same: norm_server(m.server) == mine, stat_type: it.stat_type || null, t: Date.now() });
        }
    });
    try { parent.__lp_watch_prices = watch_prices; } catch (e) {}
    try { watch_after_scan(); } catch (e) {}
    finds.sort(function (a, b) { return (b.same - a.same) || ((b.stat_type == STAT_TYPE) - (a.stat_type == STAT_TYPE)) || (a.price - b.price); }); // hier zuerst, dann mit passendem Attribut, dann Preis
    global_finds = finds; global_offers = all; arb_offers = arb; try { parent.__lp_global_offers = all; parent.__lp_arb_offers = arb; } catch (e) {}
    var al = arb_list(); if (al.length) { var ak = al.slice(0, 3).map(function (o) { return o.name + (o.level ? "+" + o.level : "") + " " + fmt(o.price) + "→" + fmt(Math.round(npc_sell_price(o.name, o.level))) + " (" + pretty_server(o.server) + ")"; }).join(", "); if (!global_logged["arb:" + ak]) { global_logged["arb:" + ak] = true; game_log("Handel: " + al.length + " Angebote unter NPC-Wert, z. B. " + ak); } }
    server_targets = finds.filter(function (f) { return !f.same; }); save_server_targets();
    finds.forEach(function (f) { var k = f.name + f.seller + f.price; if (!global_logged[k]) { global_logged[k] = true; game_log("Gefunden: " + f.name + "+" + f.level + " für " + fmt(f.price) + " bei " + f.seller + " (" + pretty_server(f.server) + (f.same ? ", dieser Server – kaufe" : ", anderer Server") + ")"); } });
    var here = finds.filter(function (f) { return f.same; })[0];
    if (here && !pending_buy) pending_buy = here;
    last_panel = 0;
    if (auto_trip && !focus_mode && !here && !server_trip && !busy && !upgrading && !paused) { var tip = server_tip()[0]; if (tip) { game_log("Serverkauf automatisch: " + tip.name + "+" + tip.level + " für " + fmt(tip.price) + " auf " + pretty_server(tip.server)); start_trip(tip); } }
    if (force) game_log("Händlerscan" + (only_slot ? " für " + only_slot : "") + ": " + finds.length + " passende Angebote" + (finds.length ? " (" + finds.filter(function (f) { return f.same; }).length + " auf diesem Server)" : ""));
    return here || null;
}
async function locate_offer(f) { // Händler anlaufen und das Angebot in seinen Stand-Slots suchen; null mit Log, wenn nicht da
    var seller = get_player(f.seller);
    if (seller && distance(character, seller) > 250) { try { await travel({ map: seller.map || character.map, x: seller.x, y: seller.y + 30 }); } catch (e) {} seller = get_player(f.seller); }
    if (!seller || !seller.slots) { game_log("Händler " + f.seller + " nicht (mehr) hier" + (seller ? " (keine Stand-Daten, Abstand " + Math.round(distance(character, seller)) + ")" : "")); return null; }
    var it = seller.slots[f.tslot], slot = f.tslot;
    if (!it || it.name != f.name || (it.level || 0) != (f.level || 0) || it.price > f.price * 1.05) { it = null; for (var sl in seller.slots) { var c = seller.slots[sl]; if (sl.indexOf("trade") == 0 && c && !c.b && c.name == f.name && (c.level || 0) == (f.level || 0) && c.price <= f.price * 1.05) { it = c; slot = sl; break; } } }
    if (!it) { var cur = seller.slots[f.tslot]; game_log("Angebot bei " + f.seller + " nicht mehr da (Abstand " + Math.round(distance(character, seller)) + ", Slot " + f.tslot + ": " + (cur ? cur.name + "+" + (cur.level || 0) + " " + fmt(cur.price || 0) : "leer") + ", Stand-Slots: " + Object.keys(seller.slots).filter(function (k) { return k.indexOf("trade") == 0 && seller.slots[k]; }).length + ")"); return null; }
    return { seller: seller, it: it, slot: slot };
}
async function buy_find(f) { // Treffer auf eigenem Server sofort kaufen (innerhalb einer laufenden Routine)
    if (!f || !wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) return false;
    set_message("Kauf " + f.name);
    if (f.map && f.x != null) await travel({ map: f.map, x: f.x, y: f.y + 30 });
    var lo = await locate_offer(f); if (!lo) return false; var seller = lo.seller, it = lo.it;
    return wish_buy_from_offer({ name: it.name, level: it.level || 0, price: it.price, force: !!f.force, slot: f.slot, seller: f.seller }, async function () { trade_buy(seller, lo.slot, 1); return true; });
}
async function run_pending_buy() { // zum Händler auf diesem Server laufen und kaufen
    if (!pending_buy || busy || upgrading || kissing || fleeing || paused) return;
    var f = pending_buy; pending_buy = null;
    if (!wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) return;
    busy = true; marketing = true;
    try {
        set_message("Kauf " + f.name);
        if (f.map && f.x != null) await travel({ map: f.map, x: f.x, y: f.y + 30 });
        var lo = await locate_offer(f);
        if (lo) { var seller = lo.seller, it = lo.it, dq = G.items[it.name] || {}, qn = f.market && dq.s ? Math.max(1, Math.min(it.q || 1, Math.floor(spendable() / it.price))) : 1; await wish_buy_from_offer({ name: it.name, level: it.level || 0, price: it.price, force: !!f.force, slot: f.slot, seller: f.seller }, async function () { trade_buy(seller, lo.slot, qn); return true; }); }
    } catch (e) { game_log("Händler-Kauf: " + err_txt(e)); }
    busy = false; marketing = false;
    if (trip_buying) { trip_buying = false; server_targets = server_targets.filter(function (x) { return !(x.name == f.name && x.seller == f.seller); }); save_server_targets(); end_trip("Kauf auf " + pretty_server(my_server()) + (locate_item(f.name) >= 0 || (character.slots[f.slot] && character.slots[f.slot].name == f.name) ? " erledigt" : " nicht möglich")); return; }
    if (server_after_buy_pause) { server_after_buy_pause = false; server_targets = server_targets.filter(function (x) { return !(x.name == f.name && x.seller == f.seller); }); save_server_targets(); paused = true; set_message("PAUSE"); game_log("Kauf auf " + pretty_server(my_server()) + " erledigt – jetzt zurück auf deinen Server wechseln, dann P"); return; }
    if (!paused) go_to_farm_spot();
}
function global_html() {
    if (!global_finds.length) return "<span style='color:#9aa3b2'>nichts auf anderen Servern gefunden (Scan alle 15 min)</span>";
    return global_finds.slice(0, 6).map(function (f) { return "<span style='color:" + (f.same ? "#4caf50" : "#8ab4f8") + "' title='" + esc(f.seller + " auf " + f.server) + "'>" + esc(f.name) + "+" + f.level + " " + fmt(f.price) + " (" + esc(f.server) + ")</span>"; }).join(" · ");
}
// Ausrüstungswert: Hauptattribut (Magier: INT, "stat" zählt mit) stark gewichtet; level = projiziertes Upgrade-/Compound-Level
function main_stat_name() { return character.ctype == "mage" || character.ctype == "priest" ? "int" : character.ctype == "warrior" ? "str" : "dex"; }
function stat_weights(st, stat_type) { // stat_type: Attributrichtung des konkreten Items (Scroll); "stat" zählt nur, wenn sie zum Hauptattribut passt
    var main = st[main_stat_name()] || 0;
    var stat_ok = !stat_type || stat_type == main_stat_name();
    return (main + (stat_ok ? (st.stat || 0) : 0)) * 30 + (st.attack || 0) * 3 + (st.range || 0) * 0.5 + (st.frequency || 0) * 5 + (st.hp || 0) * 0.05 + (st.mp || 0) * 0.1 + (st.armor || 0) * 0.5 + (st.resistance || 0) * 0.5 + (st.rpiercing || 0) * 0.8;
}
function gear_score(def, level, stat_type) {
    if (!def) return 0;
    var sc = stat_weights(def, stat_type), lv = level || 0;
    if (lv > 0) { if (def.upgrade) sc += lv * stat_weights(def.upgrade, stat_type); else if (def.compound) sc += lv * stat_weights(def.compound, stat_type); }
    return sc;
}
function projected_level(def) { return def.upgrade ? UPGRADE_TARGET : def.compound ? COMPOUND_TARGET : 0; }
function fits_slot(def, slot) {
    var t = SLOT_TYPES[slot]; if (!t) return false;
    if (def.class && def.class.indexOf(character.ctype) < 0) return false;
    if (t == "weapon") return !!def.wtype && (G.classes[character.ctype].mainhand || {})[def.wtype];
    if (t == "offhand") return (G.classes[character.ctype].offhand || {})[def.type];
    return def.type == t;
}
function best_buyable_for(slot) {
    var best = null, best_s = 0;
    for (var name in G.items) {
        var def = G.items[name];
        if (!fits_slot(def, slot) || !is_buyable(name)) continue;
        if (def.g > spendable() * 0.5) continue;
        var sc = gear_score(def);
        if (sc > best_s) { best_s = sc; best = name; }
    }
    return best;
}
async function buy_better_gear() {
    for (var slot in SLOT_TYPES) {
        check_pause();
        var cur = character.slots[slot];
        var cand = best_buyable_for(slot);
        if (!cand) continue;
        var cur_s = cur ? item_score(cur) : 0;
        if (cur && cand == cur.name) continue;
        if (gear_score(G.items[cand]) < cur_s * GEAR_MIN_GAIN) continue;
        game_log("Bessere Ausrüstung für " + slot + ": " + cand + " (" + G.items[cand].g + " Gold)");
        await buy_and_equip(cand);
    }
}

async function fill_empty_slots() {
    for (var slot in FILL_SLOTS) {
        check_pause();
        if (character.slots[slot]) continue;
        var options = FILL_SLOTS[slot];
        for (var i = 0; i < options.length; i++) {
            if (!is_buyable(options[i])) continue;
            if (spendable() < G.items[options[i]].g) break;
            game_log("Slot " + slot + " leer – kaufe " + options[i]);
            if (await buy_and_equip(options[i])) break;
        }
    }
}

// ---------- Compound (Schmuck): erst Inventar-Kopien nutzen, Rest zukaufen ----------
async function compound_slot(slot) {
    var it = character.slots[slot]; if (!it || !can_compound(slot)) return;
    var name = it.name, lvl = it.level || 0, target = slot_target(slot, 0, COMPOUND_TARGET);

    unequip(slot); await sleep(600);
    var need = Math.pow(3, target) - base_equiv(name);
    if (need > 0 && is_buyable(name)) {
        var cost = need * G.items[name].g;
        if (spendable() >= cost * 1.3 && character.esize >= need + 2) { game_log(name + ": kaufe " + need + " Stück zum Compounden"); await buy_items(name, need); }
        else game_log(name + ": " + need + " Kopien fehlen, nutze nur vorhandene");
    }
    try {
        await travel_place("compound");
        for (var l = 0; l < target; l++) {
            while (spendable() > 0) {
                check_pause();
                var idx = find_inv_indices(name, l);
                if (idx.length < 3) break;
                var scroll = "cscroll" + best_scroll_grade(G.items[name], l, "c", cost_to_reach(name, l));
                if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
                var sc = locate_item(scroll);
                if (sc < 0) { game_log("keine " + scroll); break; }
                set_message(name + " +" + l + " x3");
                var prev_n1 = find_inv_indices(name, l + 1).length;
                try { await compound(idx[0], idx[1], idx[2], sc); } catch (e) {}
                await wait_queue("compound");
                var okc2 = find_inv_indices(name, l + 1).length > prev_n1;
                if (okc2) { record_attempt("c", l, true); game_log(name + " +" + (l + 1) + " erstellt"); }
                else { record_attempt("c", l, false); game_log(name + " compound fehlgeschlagen (+" + l + " x3 verloren)"); }
            }
        }
    } finally {
        for (var b = target; b >= 0; b--) { var e = find_inv_index(name, b); if (e >= 0) { equip(e, slot); await sleep(600); break; } }
    }
}

// ---------- Ungetragenen Schmuck compounden ----------
function equipped_names() { var n = {}; for (var sl in character.slots) { var it = character.slots[sl]; if (it && sl.indexOf("trade") != 0) n[it.name] = true; } return n; }
async function compound_spares() {
    var eq = equipped_names();
    var groups = {}; // name -> {level -> count}
    character.items.forEach(function (it) {
        if (!it || it.p || it.stat_type || HP_JEWELRY.test(it.name)) return; var def = G.items[it.name]; if (!def || !def.compound) return;
        groups[it.name] = groups[it.name] || {}; var l = it.level || 0; groups[it.name][l] = (groups[it.name][l] || 0) + 1;
    });
    var todo = Object.keys(groups).filter(function (n) { for (var l in groups[n]) if (l < COMPOUND_SPARE_MAX && groups[n][l] >= 3) return true; return false; });
    if (!todo.length) { game_log("Schmuck: keine Dreiergruppen unter +" + COMPOUND_SPARE_MAX); return; }
    game_log("Schmuck compounden: " + todo.join(", "));
    await travel_place("compound");
    for (var t = 0; t < todo.length; t++) {
        var name = todo[t];
        for (var l = 0; l < COMPOUND_SPARE_MAX; l++) {
            while (spendable() > 0) {
                check_pause();
                var idx = find_inv_indices(name, l);
                if (idx.length < 3) break;
                var scroll = "cscroll" + best_scroll_grade(G.items[name], l, "c", cost_to_reach(name, l));
                if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
                var sc = locate_item(scroll);
                if (sc < 0) { game_log("keine " + scroll); break; }
                set_message(name + " +" + l + " x3");
                var prev_n1s = find_inv_indices(name, l + 1).length, prev_n = idx.length, cerr = null;
                try { await compound(idx[0], idx[1], idx[2], sc); } catch (e) { cerr = e; }
                await wait_queue("compound");
                var now_n = find_inv_indices(name, l).length;
                if (find_inv_indices(name, l + 1).length > prev_n1s) { record_attempt("c", l, true); game_log(name + " +" + (l + 1) + " erstellt"); }
                else if (now_n < prev_n) { record_attempt("c", l, false); game_log(name + " compound (+" + l + ") fehlgeschlagen"); }
                else { game_log(name + " compound (+" + l + ") nicht ausgeführt" + (cerr ? ": " + err_txt(cerr) : "") + " – überspringe"); break; } // nichts verbraucht -> nicht endlos wiederholen
            }
        }
    }
}

// ---------- Upgrade + Attribut + Compound ----------
// Ein Inventar-Item (name, level) schrittweise bis target upgraden. Rückgabe: {level, destroyed}
function grade0_max(name) { var g = (G.items[name] || {}).grades; return g && g.length ? g[0] - 1 : 99; } // höchste Stufe, auf der ein Teil noch Qualität 0 hat (Attribut-Scroll möglich)
function stat_possible(it) { var d = G.items[it.name]; return !!(d && d.stat && !it.stat_type && (it.level || 0) <= grade0_max(it.name)); }
var stat_scroll_failed = {};
async function apply_stat_scroll(idx, st) { // Attribut-Scroll auf ein Inventarteil (muss noch Qualität 0 sein)
    var it = character.items[idx]; if (!it || !st || !stat_possible(it)) return false;
    var scroll = st + "scroll", price = (G.items[scroll] || {}).g || 0, key = it.name + "+" + (it.level || 0);
    if (stat_scroll_failed[key] || !price || spendable() < price) return false;
    if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
    var sc = locate_item(scroll); if (sc < 0) { game_log(scroll + " nicht gekauft"); return false; }
    var nm = it.name, lv = it.level || 0;
    set_message(nm + " +" + st.toUpperCase());
    try { await upgrade(idx, sc); } catch (e) {}
    await wait_queue("upgrade");
    var i2 = find_inv_index(nm, lv), it2 = i2 >= 0 ? character.items[i2] : null;
    if (it2 && it2.stat_type == st) { game_log(nm + "+" + lv + " hat jetzt " + st.toUpperCase() + " (vor dem Schritt auf Qualität 1)"); return true; }
    stat_scroll_failed[key] = true; game_log(nm + "+" + lv + ": Attribut-Scroll nicht angenommen"); return false;
}
async function upgrade_inv(name, level, target, stat_want) { // stat_want: Attribut, das vor dem Sprung auf Qualität 1 gesetzt wird
    while (level < target) {
        check_pause();
        var idx = find_inv_index(name, level);
        if (idx < 0) return { level: level, destroyed: true };
        if (stat_want && level == grade0_max(name)) { try { await apply_stat_scroll(idx, stat_want); } catch (e) {} idx = find_inv_index(name, level); if (idx < 0) return { level: level, destroyed: true }; } // letzter Schritt mit Qualität 0: Attribut jetzt oder nie
        var scroll = "scroll" + best_scroll_grade(G.items[name], level, "u", cost_to_reach(name, level));
        if (spendable() < G.items[scroll].g) { game_log("Reserve erreicht – Upgrade gestoppt"); return { level: level, destroyed: false, stopped: true }; }
        if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
        var sidx = locate_item(scroll);
        if (sidx < 0) { game_log("keine " + scroll); return { level: level, destroyed: false, stopped: true }; }
        var n_same = find_inv_indices(name, level).length, n_next = find_inv_indices(name, level + 1).length;
        set_message(name + " +" + level + " -> +" + (level + 1));
        try { await upgrade(idx, sidx); } catch (e) {}
        await wait_queue("upgrade");
        var m_same = find_inv_indices(name, level).length, m_next = find_inv_indices(name, level + 1).length;
        if (m_next > n_next) { record_attempt("u", level, true); level++; game_log(name + " ist jetzt +" + level); }
        else if (m_same == n_same) { record_attempt("u", level, false); game_log(name + " Upgrade fehlgeschlagen, Item erhalten"); }
        else { record_attempt("u", level, false); game_log("!!! " + name + " +" + level + " ZERSTÖRT !!!"); return { level: level, destroyed: true }; }
    }
    return { level: level, destroyed: false };
}
function bank_backup(name) { // Reservekopie in der Bank (Snapshot): kaufbar >= BACKUP_LEVEL, sonst jede
    var min = is_buyable(name) ? BACKUP_LEVEL : 0, bk = (character.bank && typeof character.bank == "object") ? character.bank : bank_cache; if (!bk) return false;
    for (var pk in bk) if (pk.indexOf("items") == 0 && Array.isArray(bk[pk])) for (var i = 0; i < bk[pk].length; i++) { var it = bk[pk][i]; if (it && it.name == name && (it.level || 0) >= min) return true; }
    return false;
}
async function fetch_backup(name) { // Reservekopie aus der Bank holen (beste Stufe), true wenn danach im Inventar
    if (backup_index(name) >= 0) return true; if (!bank_backup(name) || character.esize < 1) return false;
    try { if (character.map != "bank") { set_message("Bank"); await travel_place("bank"); await sleep(800); } } catch (e) { return false; }
    var bk = character.bank || {}, min = is_buyable(name) ? BACKUP_LEVEL : 0, best = null;
    for (var pk in bk) if (pk.indexOf("items") == 0 && Array.isArray(bk[pk])) for (var i = 0; i < bk[pk].length; i++) { var it = bk[pk][i]; if (it && it.name == name && (it.level || 0) >= min && (!best || (it.level || 0) > best.lv)) best = { pack: pk, i: i, lv: it.level || 0 }; }
    if (!best) return false;
    try { bank_retrieve(best.pack, best.i); await sleep(600); game_log("Reserve aus der Bank geholt: " + name + "+" + best.lv); } catch (e) { return false; }
    return backup_index(name) >= 0;
}
function has_backup(name) { return backup_index(name) >= 0 || bank_backup(name); }
function backup_index(name) { // beste Inventar-Kopie: kaufbar >= BACKUP_LEVEL, nicht kaufbar jede Kopie
    var best = -1, bl = -1, min = is_buyable(name) ? BACKUP_LEVEL : 0;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) >= min && (it.level || 0) > bl) { best = i; bl = it.level || 0; } }
    return best;
}
async function ensure_backup(name) { // Reservekopie auf +BACKUP_LEVEL herstellen
    for (var tries = 0; tries < 3; tries++) {
        if (backup_index(name) >= 0) return true;
        // höchste angefangene Kopie unter Reserve-Stufe weiterverwenden (nicht jedes Mal neu kaufen)
        var start = -1, sl = -1;
        for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && !it.p && !it.stat_type && (it.level || 0) < BACKUP_LEVEL && (it.level || 0) > sl) { sl = it.level || 0; start = i; } }
        if (start < 0) { if (!await buy_items(name, 1)) return false; await travel_place("upgrade"); sl = 0; }
        var r = await upgrade_inv(name, sl, BACKUP_LEVEL);
        if (r.stopped) return false;
        if (!r.destroyed) { game_log("Reserve " + name + " +" + BACKUP_LEVEL + " bereit"); return true; }
    }
    return false;
}
// Teile für leere Slots aus der Bank holen (muss in der Bank stehen)
async function retrieve_for_empty_slots() {
    var bank = character.bank || {}, got = 0;
    for (var slot in SLOT_TYPES) {
        if (character.slots[slot] || slot == "mainhand") continue;
        var best = null, bs = -1;
        for (var pack in bank) {
            if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
            for (var i = 0; i < bank[pack].length; i++) { var it = bank[pack][i]; if (!it || !G.items[it.name] || !fits_slot(G.items[it.name], slot)) continue; var sc = item_score(it); if (sc > bs) { bs = sc; best = { pack: pack, i: i, it: it }; } }
        }
        if (best && character.esize > 0) { try { bank_retrieve(best.pack, best.i); got++; await sleep(500); await reequip_slot(slot); } catch (e) {} }
    }
    if (got) game_log("Aus der Bank für leere Slots geholt: " + got);
}
// Reserven aus der Bank zurückholen (für getragene kaufbare Teile ohne Reserve im Inventar)
function bank_better_for(only_slot) { // Bankteile, die besser sind als das Getragene (oder Slot leer)
    var out = [], bank = character.bank || {};
    for (var slot in SLOT_TYPES) {
        if (only_slot && slot != only_slot) continue;
        var worn = character.slots[slot], ws = worn ? item_score(worn) * 1.02 : 0, best = null;
        for (var pack in bank) {
            if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
            for (var i = 0; i < bank[pack].length; i++) { var it = bank[pack][i]; if (!it || !G.items[it.name] || !fits_slot(G.items[it.name], slot)) continue; var sc = item_score(it); if (sc > ws && (!best || sc > best.sc)) best = { pack: pack, i: i, it: it, sc: sc, slot: slot }; }
        }
        if (best) out.push(best);
    }
    return out;
}
async function retrieve_better_from_bank(only_slot) { // läuft zur Bank, wenn dort etwas Besseres liegt
    var list = bank_better_for(only_slot); if (!list.length) return 0;
    if (character.map != "bank") { set_message("Bank"); await travel_place("bank"); await sleep(800); list = bank_better_for(only_slot); }
    var got = 0;
    list.sort(function (a, b) { return (a.pack == b.pack) ? b.i - a.i : (a.pack < b.pack ? 1 : -1); });
    for (var k = 0; k < list.length && character.esize > 1; k++) { try { bank_retrieve(list[k].pack, list[k].i); got++; await sleep(500); game_log("Aus der Bank geholt: " + list[k].it.name + "+" + (list[k].it.level || 0) + " (besser für " + list[k].slot + ")"); } catch (e) {} }
    if (got) { await sleep(500); await ensure_best_equipped(); }
    return got;
}
async function fetch_backups_from_bank() {
    var need = equipped_slots("upgrade").map(function (sl) { return character.slots[sl].name; })
        .filter(function (n, i, a) { return a.indexOf(n) == i && is_buyable(n) && backup_index(n) < 0; });
    var empty_slots = Object.keys(SLOT_TYPES).filter(function (sl) { return sl != "mainhand" && !character.slots[sl]; });
    if (!need.length && !empty_slots.length) return;
    set_message("Bank: Reserven"); await travel_place("bank"); await sleep(800);
    await retrieve_for_empty_slots();
    var bank = character.bank || {}; var got = 0;
    for (var pack in bank) {
        if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
        for (var i = 0; i < bank[pack].length; i++) {
            var it = bank[pack][i];
            if (!it || need.indexOf(it.name) < 0 || (it.level || 0) < BACKUP_LEVEL || character.esize < 1) continue;
            if (backup_index(it.name) >= 0) continue;
            try { bank_retrieve(pack, i); got++; await sleep(400); } catch (e) {}
        }
    }
    if (got) game_log("Reserven aus der Bank geholt: " + got);
}
function best_inv_for_slot(slot) { // bestes Inventar-Item, das in den Slot passt
    var best = -1, bs = -1;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || !G.items[it.name]) continue; if (!fits_slot(G.items[it.name], slot)) continue; var sc = item_score(it); if (sc > bs) { bs = sc; best = i; } }
    return best;
}
async function reequip_slot(slot) { if (character.slots[slot]) return; var b = best_inv_for_slot(slot); if (b >= 0) { game_log("Slot " + slot + " leer – lege " + character.items[b].name + "+" + (character.items[b].level || 0) + " an"); equip(b, slot); await sleep(600); } }
async function process_slot(slot, goal) {
    try { await process_slot_inner(slot, goal); }
    finally { try { await reequip_slot(slot); } catch (e) {} }
}
async function process_slot_inner(slot, goal) {
    var item = character.slots[slot]; if (!item) return;
    var name = item.name, buyable = is_buyable(name);
    var rebuys = 0;
    while (rebuys <= MAX_REBUYS) {
        check_pause();
        // Nichts angelegt? -> Reserve anlegen, ggf. vorher neu bauen
        if (!character.slots[slot]) {
            if (backup_index(name) < 0) await fetch_backup(name);
            if (backup_index(name) < 0) {
                if (!buyable) { game_log(name + ": zerstört, nicht kaufbar – Slot bleibt leer"); break; }
                if (!await ensure_backup(name)) { game_log(name + ": Neubau nicht möglich"); break; }
            }
            var b = backup_index(name); if (b < 0) break;
            equip(b, slot); await sleep(600);
            game_log(name + " +" + (character.slots[slot] ? character.slots[slot].level || 0 : "?") + " angelegt");
        }
        var cur = character.slots[slot]; if (!cur) break;
        var lvl = cur.level || 0;
        // Reserve sicherstellen (die angelegte zählt nicht mit)
        if (buyable && !has_backup(name)) { if (!await ensure_backup(name)) { game_log(name + ": keine Reserve möglich – kein Risiko-Upgrade"); break; } }
        if (lvl >= goal) break;
        unequip(slot); await sleep(600);
        var r = await upgrade_inv(name, lvl, goal, wish_item(slot) == name ? STAT_TYPE : null);
        if (r.destroyed) { rebuys++; continue; } // Schleifenanfang legt Reserve an / baut neu
        var best = -1, bl = -1;
        for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) > bl) { best = i; bl = it.level || 0; } }
        if (best >= 0) { equip(best, slot); await sleep(600); }
        if (r.stopped) break;
        if (r.level >= goal) { if (buyable && !has_backup(name)) await ensure_backup(name); break; }
    }
}

// Upgrades nach Empfehlung: pro Durchlauf je Slot ein Schritt, solange "Upgrade" die Empfehlung bleibt
async function upgrade_by_recommendation() {
    var skipped = {};
    for (var pass = 0; pass < 60; pass++) {
        check_pause();
        goal_cache_t = 0; var goals = compute_goals();
        // global bester Schritt (Wert je Aufwand) unter allen Upgrade-Empfehlungen
        var best = null;
        for (var slot in goals) {
            var rec = goals[slot].options && goals[slot].options[0]; if (!rec || rec.kind != "upgrade" || skipped[slot]) continue;
            var it = character.slots[slot]; if (!it || G.items[it.name].compound) continue;
            if (!best || rec.ratio > best.rec.ratio) best = { slot: slot, rec: rec, it: it };
        }
        // Inventar-Items, die auf Zielstufe besser wären als das getragene: hochziehen, bis sie es überholen
        if (!best) {
            for (var i = 0; i < character.items.length; i++) {
                var iv = character.items[i]; if (!iv || !G.items[iv.name] || !G.items[iv.name].upgrade || skipped["inv" + iv.name]) continue;
                var sl2 = slot_for_item(G.items[iv.name]); if (!sl2) continue;
                var worn = character.slots[sl2]; if (!worn || worn.name == iv.name) continue;
                if (!on_wishlist(iv.name) && !(gear_goal && gear_goal.item == iv.name)) continue; // nur Zielbau-Teile hochziehen, kein Zufallskram
                var cap2 = wish_item(sl2) == iv.name ? wish_level(sl2) : (is_buyable(iv.name) ? UPGRADE_TARGET : (sl2 == "mainhand" ? WEAPON_SAFE_TARGET : SAFE_TARGET_DROP));
                var lv2 = iv.level || 0; if (lv2 >= cap2) continue;
                if (gear_score(G.items[iv.name], cap2) <= item_score(worn) * 1.05) continue;
                var c5 = step_cost(iv.name, lv2); if (c5 > spendable()) { skipped["inv" + iv.name] = true; continue; }
                game_log("Nächster Schritt (Inventar): " + iv.name + " +" + lv2 + " → +" + (lv2 + 1) + " (~" + fmt(c5) + ")");
                await travel_place("upgrade");
                var r5 = await upgrade_inv(iv.name, lv2, lv2 + 1, wish_item(sl2) == iv.name ? STAT_TYPE : null);
                if (r5.stopped) skipped["inv" + iv.name] = true;
                var bi = -1, bl = -1; for (var j = 0; j < character.items.length; j++) { var it2 = character.items[j]; if (it2 && it2.name == iv.name && (it2.level || 0) > bl) { bi = j; bl = it2.level || 0; } }
                if (bi >= 0 && item_score(character.items[bi]) > item_score(character.slots[sl2])) { equip(bi, sl2); await sleep(600); game_log(iv.name + " +" + bl + " ist jetzt besser – angelegt"); }
                best = { cont: true }; break;
            }
            if (best && best.cont) continue;
        }
        if (!best) break;
        var name = best.it.name, lvl = best.it.level || 0, buyable = is_buyable(name);
        if (!buyable && lvl >= SAFE_TARGET_DROP && !has_backup(name)) { game_log(name + ": Drop-Item ohne Reserve – bleibt bei +" + lvl); skipped[best.slot] = true; continue; }
        if (best.rec.cost > spendable()) { game_log(name + " +" + (lvl + 1) + ": zu teuer (~" + fmt(best.rec.cost) + ")"); skipped[best.slot] = true; continue; }
        game_log("Nächster Schritt: " + name + " +" + lvl + " → +" + (lvl + 1) + " (~" + fmt(best.rec.cost) + ")");
        await travel_place("upgrade");
        await process_slot(best.slot, lvl + 1);
        var now = character.slots[best.slot];
        if (!now || now.name != name || (now.level || 0) <= lvl) { skipped[best.slot] = true; game_log(name + ": kein Fortschritt (jetzt " + (now ? now.name + "+" + (now.level || 0) : "leer") + ") – Slot in diesem Durchlauf übersprungen"); }
    }
}
async function upgrade_routine(auto_run) {
    var manual = !auto_run;
    if (upgrading) { if (manual) game_log("Upgrade läuft bereits"); return; }
    if (busy) { pending_upgrade = auto_run ? "auto" : "U"; if (manual) { unpause("Upgrade vorgemerkt"); game_log("Upgrade vorgemerkt – startet, sobald er frei ist"); } return; }
    pending_upgrade = null;
    if (!has_weapon()) { game_log("Keine Waffe – kein Upgrade"); return; }
    if (manual) unpause("Upgrade");
    var saved_reserve = GOLD_RESERVE; GOLD_RESERVE = Math.max(GOLD_RESERVE, WISH_RESERVE); // bei Ausrüstungsarbeit bleibt 1 M Gold liegen
    auto_mode = !manual; goal_cache_t = 0;
    try { await upgrade_routine_inner(manual); } finally { GOLD_RESERVE = saved_reserve; auto_mode = false; goal_cache_t = 0; }
}
async function upgrade_routine_inner(manual) {

    var stat_scroll = STAT_TYPE + "scroll", stat_price = G.items[stat_scroll].g;
    var empty = Object.keys(FILL_SLOTS).filter(function (s) { return !character.slots[s]; }).length;
    var up_slots = Object.keys(compute_goals()).filter(function (sl) { var o = goal_cache[sl].options; return o && o[0] && o[0].kind == "upgrade"; });
    var stat_slots = spendable() >= stat_price ? slots_without_stat() : [];
    var comp_slots = slots_to_compound();
    var gear = Object.keys(SLOT_TYPES).some(function (sl) { var c = best_buyable_for(sl), cur = character.slots[sl]; return c && (!cur || (c != cur.name && gear_score(G.items[c]) >= item_score(cur) * GEAR_MIN_GAIN)); });
    var spares = (function () { var eq = equipped_names(), g = {}; character.items.forEach(function (it) { if (it && G.items[it.name] && G.items[it.name].compound && !eq[it.name] && (it.level || 0) < COMPOUND_SPARE_MAX) { var k = it.name + "|" + (it.level || 0); g[k] = (g[k] || 0) + 1; } }); return Object.keys(g).some(function (k) { return g[k] >= 3; }); })();
    var weapon_todo = character.slots.mainhand && G.items[character.slots.mainhand.name].upgrade && wish_item("mainhand") == character.slots.mainhand.name && (character.slots.mainhand.level || 0) < slot_target("mainhand", is_buyable(character.slots.mainhand.name) ? UPGRADE_TARGET : WEAPON_SAFE_TARGET, 0);
    var wish_todo = wish_status().some(function (x) { return !x.have && x.seen; });
    if (!empty && !gear && !spares && !up_slots.length && !stat_slots.length && !comp_slots.length && !weapon_todo && !wish_todo) { if (manual) game_log("Nichts zu tun (oder zu wenig freies Gold: " + fmt(spendable()) + ")"); return; }
    if (character.esize < 2) { game_log("Upgrade: Inventar zu voll"); return; }

    upgrading = true; busy = true; set_message("Upgrade");
    game_log((manual ? "Upgrade-Routine: " : "Ausrüstung (automatisch): ") + empty + " leere Slots, " + up_slots.length + " Upgrades, " + stat_slots.length + " Attribut, " + comp_slots.length + " Compound, Wunschliste " + wish_text() + " (frei: " + fmt(spendable()) + " Gold)");

    try {
        // 0. Schmuck zuerst (billig): getragen + ungetragen
        comp_slots = slots_to_compound();
        for (var c0 = 0; c0 < comp_slots.length; c0++) { check_pause(); await compound_slot(comp_slots[c0]); }
        await compound_spares();
        if (empty) await fill_empty_slots();
        await buy_better_gear();
        try { var ghit = await scan_all_merchants(true); if (ghit) { pending_buy = null; await buy_find(ghit); } } catch (e) { game_log("Händlerscan: " + err_txt(e)); }
        await check_ponty(true);
        await check_market(true);

        await fetch_backups_from_bank();
        try { await retrieve_better_from_bank(); } catch (e) {}
        // 1. Waffe zuerst (größter Hebel): kaufbare bis +UPGRADE_TARGET mit Reserve, seltene bis +WEAPON_SAFE_TARGET
        var mh = character.slots.mainhand;
        if (mh && G.items[mh.name].upgrade && wish_item("mainhand") == mh.name) { check_pause(); await process_slot("mainhand", slot_target("mainhand", is_buyable(mh.name) ? UPGRADE_TARGET : WEAPON_SAFE_TARGET, 0)); }
        // 2. Rest nach Wert je Aufwand
        await upgrade_by_recommendation();
        // Team-Zielbau (Priest/Ranger) läuft NICHT hier mit – nur über den Knopf "Jetzt" (team_build_now)

        stat_slots = spendable() >= stat_price ? slots_without_stat().filter(function (sl) { return wish_item(sl) == character.slots[sl].name; }) : [];
        if (stat_slots.length) {
            await travel_place("scrolls");
            for (var j = 0; j < stat_slots.length; j++) {
                check_pause();
                if (spendable() < stat_price) { game_log("Attribut-Scroll: Reserve erreicht"); break; }
                var s = stat_slots[j], it = character.slots[s]; if (!it) continue;
                var nm = it.name, lv = it.level || 0;
                if (quantity(stat_scroll) < 1) { buy(stat_scroll, 1); await sleep(600); }
                var sc = locate_item(stat_scroll); if (sc < 0) { game_log("Attribut-Scroll nicht gekauft"); break; }
                unequip(s); await sleep(600);
                var ix = find_inv_index(nm, lv); if (ix < 0) break;
                try {
                    set_message(nm + " +" + STAT_TYPE.toUpperCase());
                    try { await upgrade(ix, sc); } catch (e) {}
                    await wait_queue("upgrade");
                } finally {
                    var ix2 = find_inv_index(nm, lv);
                    if (ix2 >= 0) {
                        game_log(nm + (character.items[ix2].stat_type == STAT_TYPE ? " hat jetzt " + STAT_TYPE.toUpperCase() : ": Attribut-Scroll nicht angenommen"));
                        equip(ix2); await sleep(600);
                    } else game_log("!!! " + nm + " nach Attribut-Scroll weg !!!");
                }
            }
        }


    } catch (e) {
        if (e == "PAUSE") game_log("Upgrade-Routine durch Pause abgebrochen");
        else game_log("Routine-Fehler: " + err_txt(e));
    }

    try { await ensure_best_equipped(); } catch (e) {}
    // Aufräumen: überzählige Kopien (angefangene Reserven, Duplikate) verkaufen, damit nichts liegen bleibt
    try { if (!aborted() && !paused && duplicate_indices().length) { set_message("Verkaufen"); await travel_place("potions"); await sell_duplicates(); } } catch (e) {}
    game_log("Routine beendet (Gold: " + fmt(character.gold) + ", frei: " + character.esize + ")");
    upgrading = false; busy = false;
    if (manual) after_action("Upgrade"); else if (!paused) go_to_farm_spot();
}

// ---------- Hauptschleife ----------
function start_main() {
  if (main_timer) clearInterval(main_timer);
  main_timer = parent.__lp_main_timer = setInterval(function () {
    heal_logic(); loot();
    if (character.rip) { if (!rip_counted) { rip_counted = true; day_count("deaths"); game_log("Gestorben (heute " + day.deaths + "x)"); try { var hq = mh_quest(); if (hq && hq.c > 0 && hunt_spot == hq.id) { game_log("Tod bei der Jagd auf " + hq.id + " – Jagd abgebrochen, Jagd-Häkchen für " + hq.id + " entfernt"); note_hunt_bad(hq.id); set_hunt_allow(hq.id, false); hunt_reset(30 * 60000); hunt_cooldown_until = Date.now() + (hq.ms || 1800000); } else if (current_spot && !event_mode) { blocked_spots[current_spot] = Date.now() + LEVELED_BLOCK_MS; note_hunt_bad(current_spot); if (hunt_allow[current_spot]) { set_hunt_allow(current_spot, false); } game_log("Tod bei " + current_spot + " – Jagd-Häkchen entfernt, Spot 30 min " + (manual_spot == current_spot ? "ausgesetzt, solange wählt die Automatik" : "gesperrt")); need_repick = true; meas = null; } } catch (e) {} } if (meas) finish_measure(true); respawn(); busy = false; fleeing = false; kissing = false; return; }
    rip_counted = false;
    session_tick();
    if (Date.now() - last_panel > 2000) { last_panel = Date.now(); try { update_panel(); update_char_panel(); update_tchar_panels(); } catch (e) {} }
    try { if (!SOLO) { merch_test_tick(); arb_tick(); merch_buy_tick(); donate_tick(); event_tick(); } team_tick(); team_broadcast(); if (!SOLO) { team_read_logs(); team_inject(); } bank_snapshot(); if (!manual_lock && !paused && !SOLO) { priest_gear_tick(); energize_tick(); team_wish_handover_tick(); } } catch (e) {}
    if (paused) return;
    measure_tick();

    busy_watchdog(); check_flee();
    if (!manual_lock) { // während einer manuell ausgelösten Aktion startet nichts Automatisches dazwischen
        if (pending_upgrade == "auto" && focus_mode) pending_upgrade = null; // Fokus: keine automatische Ausrüstungsroutine, auch keine noch wartende
        if (pending_upgrade && !busy && !upgrading) { var auto_run = pending_upgrade == "auto"; pending_upgrade = null; upgrade_routine(auto_run); }
        if (focus_mode) { // nur das Nötigste: Scan (bewegt nichts), manuelle Ziele, fehlende Ausrüstung, Inventar erst wenn fast voll, Not-Tränke, Hunt-Abwicklung
            scan_all_merchants(); if (market_job) run_market_job(); if (pending_buy && (pending_buy.force || trip_buying)) run_pending_buy(); run_goal(); check_weapon(); check_gear_slots(); tidy_inventory(); check_potions(); check_stuck(); check_monsterhunt();
        } else {
            auto_gear_tick(); best_equip_tick(); scan_all_merchants(); run_pending_buy(); run_goal(); check_weapon(); check_gear_slots(); check_elixir(); kiss_routine(); tidy_inventory(); check_potions(); check_stuck(); cavalry_tick(); check_ponty(false); check_market(false); check_seashells(); check_monsterhunt(); check_cake();
        }
    }
    if (spot_travel && busy && !fleeing && strict_mon(current_spot) && !escort_near()) { // Team-Spot: kurz vor dem Spawnfeld sammeln, erst geschlossen rein
        var rs0 = mon_rects(current_spot, character.map), pt0 = [character.x, character.y, character.x, character.y], dmin0 = Infinity; for (var ri = 0; ri < rs0.length; ri++) dmin0 = Math.min(dmin0, rect_dist(rs0[ri], pt0));
        if (dmin0 < RALLY_DIST) { team_wait_stop = true; stop("smart"); spot_travel = false; busy = false; last_go = Date.now(); set_message("Sammelpunkt"); wait_log("Sammelpunkt " + Math.round(dmin0) + " px vor " + current_spot + " – warte auf Priest/Ranger, dann geschlossen rein"); return; }
    }
    if (spot_travel && busy && !fleeing) { var fm0 = current_spot; if (wait_team_on && !SOLO && !event_mode && escorts().length) { var beh = escort_behind(); if (beh) { /* unterwegs immer auf Priest/Ranger warten (jeder Spot); allein kämpfen ist separat geregelt */ team_wait_stop = true; stop("smart"); spot_travel = false; busy = false; last_go = Date.now(); set_message(wait_txt()); wait_log(wait_txt() + " – halte an (" + fm0 + ")"); return; } } }
    if (busy || is_moving(character)) return;

    var farm = pick_farm_monster();
    var target = get_targeted_monster();
    if (target && target.id != last_target_id && !priority_mon(target.mtype)) { change_target(null); target = null; } // angeklicktes/fremdes Ziel ignorieren – der Bot verfolgt nur Ziele, die er selbst gesetzt hat (Team folgt sonst deinem Klick)
    var beh = (wait_team_on && !SOLO && !event_mode && escorts().length) ? escort_behind(strict_mon(farm) ? WAIT_NEAR : WAIT_BEHIND) : null;
    var hold = spot_needs_team(farm) && !!beh; // Team hängt zurück: kein neues Ziel, nur Verteidigung

    if (target && !is_valid_target(target)) {
        log_ignored(target, "zu stark");
        change_target(null);
        target = null;
    }

    var pt = priority_target(); if (pt && (!target || target.mtype != pt.mtype)) { target = pt; if (prio_logged != pt.id) { prio_logged = pt.id; game_log("Seltener Spawn: " + pt.mtype + " in " + Math.round(distance(character, pt)) + " px – greife an, Team fokussiert mit"); } change_target(pt); }
    if (!target) { var tt = team_threat(); if (tt) target = tt; }
    if (!target && hold) { // Team hängt zurück: nur Angreifer auf mich abwehren, sonst stehen bleiben
        for (var hid in parent.entities) { var he = parent.entities[hid]; if (is_valid_target(he) && he.target == character.name) { target = he; break; } }
        if (!target) { set_message(wait_txt()); wait_log(wait_txt() + " – kämpfe nicht allein bei " + farm); if (!rally_back(farm)) meet_escort(); return; }
        if (character.hp < character.max_hp * SET.hold_flee / 100 || strict_mon(farm)) { game_log("Ohne Team von " + target.mtype + " angegriffen (HP " + Math.round(character.hp / character.max_hp * 100) + " %" + (strict_mon(farm) ? ", Team-Pflicht" : "") + ") – Rückzug in die Stadt statt allein zu kämpfen"); fleeing = true; busy = true; (async function () { try { stop("smart"); change_target(null); await travel_place("town"); while (character.hp < character.max_hp * 0.9 && !character.rip) await sleep(1000); } catch (e) {} fleeing = false; busy = false; })(); return; }
        wait_log("verteidige mich gegen " + target.mtype + " (Team fehlt noch)"); change_target(target);
    }
    if (!target) {
        var aggro = attackers_on_me();
        // Farm-Monster: nächstes freies Exemplar, aber nur wenn es (auch gelevelt) noch sicher ist
        var best_d = 1e9, seen_farm = false, strong_wait = false;
        for (var mid in parent.entities) {
            var m = parent.entities[mid];
            if (!m || m.type != "monster" || m.dead || m.mtype != farm) continue;
            if (m.target && m.target != character.name) continue;
            if (aggro >= MAX_AGGRO && m.target != character.name) continue;
            if (too_strong(m)) { seen_farm = true; if (distance(character, m) < 300) log_ignored(m, "gelevelt/zu stark"); continue; }
            if (beh && !m.target && (strict_mon(m.mtype) || (m.level || 1) > 1 || mon_danger(G.monsters[m.mtype] || {}) > wait_team_danger)) { strong_wait = true; continue; } // starkes/gelevelte Exemplar: erst ziehen, wenn Priest/Ranger da sind
            var d = distance(character, m); if (d < best_d) { best_d = d; target = m; }
        }
        if (!target && strong_wait) { set_message(wait_txt()); wait_log(wait_txt() + " – starke/gelevelte " + farm + " erst mit Team"); for (var sid3 in parent.entities) { var se3 = parent.entities[sid3]; if (is_valid_target(se3) && se3.target == character.name) { target = se3; break; } } if (!target) return; }
        all_leveled_check(farm, seen_farm, !!target); // nur gelevelte in Sicht -> nach 45 s ausweichen
        if (!target && bycatch && aggro < MAX_AGGRO) { // Beifang: nächstes sicheres Monster in der Nähe
            var bd = BYCATCH_RANGE;
            for (var bid in parent.entities) { var bm = parent.entities[bid]; if (!bm || bm.type != "monster" || bm.dead || bm.mtype == farm) continue; if (!is_safe_monster(bm.mtype) || hidden_mons[bm.mtype] || too_strong(bm)) continue; if (bm.target && bm.target != character.name) continue; var dd = distance(character, bm); if (dd < bd) { bd = dd; target = bm; } }
        }
        if (!target) { // Angreifer nur erledigen, wenn sie nah sind; sonst weiter zum Spot
            for (var id in parent.entities) { var e = parent.entities[id]; if (is_valid_target(e) && e.target == character.name && distance(character, e) < 120) { target = e; break; } }
        }
        if (!target && event_mode && !fleeing) { if (event_boss_step()) return; }
        if (target) change_target(target); else { go_to_farm_spot(); return; }
    }

    if (last_target_id != target.id) { last_target_id = target.id; if (Date.now() - last_team_cast > 1500) { last_team_cast = 0; team_broadcast(); } } // neues Ziel sofort ans Team (Fokus)
    if (!is_in_range(target)) move(character.x + (target.x - character.x) / 2, character.y + (target.y - character.y) / 2);
    else if (can_attack(target)) {
        if (!try_cburst()) { status_message(); attack(target); }
    }
  }, 1000 / 4);
}
rebuild_wishlist();
setTimeout(function () { try { check_trip_on_start(); if (!server_trip) check_server_arrival(); } catch (e) {} }, 4000);
try { if (localStorage.getItem("lp_wiki_open") == "1") { wiki_panel = init_wiki_panel(); render_wiki(); } } catch (e) {}
try { if (localStorage.getItem("lp_mkt_open") == "1") { market_panel = init_market_panel(); render_market(); } } catch (e) {}
start_main();
