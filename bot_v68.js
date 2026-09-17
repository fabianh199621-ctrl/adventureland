// ===== Adventure Land – Vollautomatik Magier (nichts einstellen) =====
// P = Pause (stoppt auch Upgrades) – Start immer im Pause-Modus
// N = neueste Version von GitHub laden und neu starten
// U = sichere Upgrades: kaufbare Items: Reserve +5 im Inventar, getragenes Teil bis +8; Drop-Items +3; INT-Scrolls; Schmuck +2; bessere Ausrüstung kaufen
// K = wie U, aber Drop-Items bis +5 (Risiko!)
// L = Farm-Statistik (XP/h, Gold/h je Monster) ins Log
// D = Event-Daten anzeigen (Diagnose für 10-Jahre-Event)
// G = bei Xyn alles Tauschbare eintauschen (Gifts, Muscheln, Edelsteine, Leder …), holt vorher aus der Bank
// Upgrades laufen NUR auf Tastendruck. GOLD_RESERVE wird nie angetastet.
// Wird per Loader aus GitHub geladen: https://github.com/fabianh199621-ctrl/adventureland

var BOT_VERSION = "v68";
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
game_log("LogicPlan-Skript " + BOT_VERSION + " gestartet – PAUSIERT. P = Start/Pause, N = neu laden, U = sichere Upgrades, K = alle Upgrades, L = Statistik, G = Gifts tauschen");

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
function market_valid(name) { var m = market_seen[name]; return m && (Date.now() - m.t) < 24 * 3600000 ? m : null; }
var UP_P = [1, 1, 1, 1, 0.98, 0.95, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2];   // Upgrade-Erfolg je Stufe (Näherung)
var CO_P = [1, 1, 0.9, 0.7, 0.5, 0.35];                                 // Compound-Erfolg je Stufe (Näherung)
var COMPOUND_SPARE_MAX = 3;          // ungetragener Schmuck im Inventar wird bis hierhin compoundet
var STAT_TYPE = "int";
var FALLBACK_WEAPONS = ["staff", "stick"];
var NO_WEAPON_MONSTER = "goo";
var MAX_TARGET_HP_FACTOR = 5;
// Kandidaten für Farmspots – ungeeignete (zu stark) werden automatisch aussortiert
var CANDIDATES = ["goo", "crab", "bee", "croc", "armadillo", "squig", "squigtoad", "poisio",
                  "tortoise", "frog", "rat", "minimush", "snake", "osnake", "scorpion", "spider",
                  "arcticbee", "boar", "crabx", "bat", "cgoo"];
var EXCLUDE = { iceroamer: true };   // gezielt ausgeschlossen (Einfrieren)
var hidden_mons = {}; try { hidden_mons = JSON.parse(localStorage.getItem("lp_hidden") || "{}"); } catch (e) {}
var only_worth = false; try { only_worth = localStorage.getItem("lp_only_worth") == "1"; } catch (e) {}
var WORTH_TOP = 5;                   // "nur lohnende": die 5 besten nach geschätzten XP/h
function save_hidden() { try { localStorage.setItem("lp_hidden", JSON.stringify(hidden_mons)); localStorage.setItem("lp_only_worth", only_worth ? "1" : "0"); } catch (e) {} }
function hide_mon(m, hide) { if (hide) hidden_mons[m] = true; else delete hidden_mons[m]; save_hidden(); if (hide && (current_spot == m || manual_spot == m)) set_auto_spot(); last_panel = 0; }
function is_worth(m) {
    if (!only_worth) return true;
    var top = CANDIDATES.filter(function (x) { return is_safe_monster(x) && !hidden_mons[x]; })
        .sort(function (a, b) { return mon_xph_est(G.monsters[b], b) - mon_xph_est(G.monsters[a], a); }).slice(0, WORTH_TOP);
    return top.indexOf(m) >= 0;
}
function visible_mons() { return CANDIDATES.filter(function (m) { return is_safe_monster(m) && !hidden_mons[m] && is_worth(m); }); }
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
var KEEP_ITEMS = /^(hpot|mpot|elixir|scroll|cscroll|intscroll|strscroll|dexscroll|vitscroll|tracker)/;
var POTS_HP = ["hpot1", "hpot0"], POTS_MP = ["mpot1", "mpot0"]; // beste zuerst
var ELIXIR = "elixirint0";           // wird aktiv gehalten, wenn kaufbar
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
var manual_spot = null; // per Button fest gewählter Spot (kein Messen)
var meas = null; // laufende Messung
// Laufende Messung / Spot aus letztem Lauf wiederherstellen
try {
    var saved = JSON.parse(localStorage.getItem("lp_state_" + character.name) || "null");
    if (saved && (Date.now() - saved.t) < 30 * 60 * 1000) {
        current_spot = saved.spot || null; need_repick = !current_spot; manual_spot = saved.manual || null;
        if (saved.meas) { meas = saved.meas; meas.last_xp = character.xp; meas.last_level = character.level; meas.last_gold = character.gold; meas.pause_start = 0; }
        if (current_spot) game_log("Weiter bei Spot " + current_spot + (meas ? " (Messung läuft weiter)" : ""));
    }
} catch (e) {}
var last_state_save = 0;
function save_state() {
    try { localStorage.setItem("lp_state_" + character.name, JSON.stringify({ t: Date.now(), spot: current_spot, meas: meas, manual: manual_spot })); } catch (e) {}
}
var cburst_logged = false;

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function spendable() { return character.gold - GOLD_RESERVE; }
function check_pause() { if (paused) throw "PAUSE"; }
function has_weapon() { return !!character.slots.mainhand; }

// Fähigkeit nutzbar? (Klasse + Level aus den Spieldaten)
function skill_available(name) {
    var s = G.skills[name];
    if (!s) return false;
    if (s.class && s.class.indexOf(character.ctype) < 0) return false;
    if (s.level && character.level < s.level) return false;
    return true;
}

function is_valid_target(m) {
    if (!m || m.type != "monster" || m.dead) return false;
    if (m.max_hp > character.max_hp * MAX_TARGET_HP_FACTOR) return false;
    if (m.mtype == pick_farm_monster()) return true;
    return m.target == character.name;
}

// ---------- Tasten (direkt per Tastatur, unabhängig vom Loader) ----------
function on_key(ev) {
    var t = ev.target;
    if (t && (t.tagName == "INPUT" || t.tagName == "TEXTAREA" || t.isContentEditable)) return; // nicht beim Tippen
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    var k = (ev.key || "").toUpperCase();
    if (k == "P") toggle_pause();
    else if (k == "N") reload_bot();
    else if (k == "U") upgrade_routine(false);
    else if (k == "K") upgrade_routine(true);
    else if (k == "L") log_stats();
    else if (k == "D") event_debug();
    else if (k == "G") exchange_gifts();
}
// alte Snippet-Belegungen aus früheren Versionen entfernen
try { unmap_key("P"); unmap_key("U"); unmap_key("K"); unmap_key("L"); } catch (e) {}
// alten Handler (von vorherigem Run) entfernen, dann neu registrieren
if (parent.__logicplan_keyhandler) parent.document.removeEventListener("keydown", parent.__logicplan_keyhandler);
parent.__logicplan_keyhandler = on_key;
parent.document.addEventListener("keydown", on_key);

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
    out.kiss_skill = G.skills.ikissyou || null;
    show_json(out);
    game_log("Event-Diagnose angezeigt (Fenster) – bitte Screenshot");
}

function reload_bot() {
    game_log("Lade neueste Version von GitHub …");
    fetch(BOT_BASE + "version.txt?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw "HTTP " + r.status; return r.text(); })
        .then(function (v) {
            v = v.trim();
            if (v == BOT_VERSION) game_log("Bereits aktuell (" + v + ") – starte trotzdem neu");
            return fetch(BOT_BASE + "bot_" + v + ".js", { cache: "no-store" }).then(function (r) { if (!r.ok) throw "HTTP " + r.status + " bei bot_" + v + ".js"; return r.text(); });
        })
        .then(function (code) {
            if (main_timer) clearInterval(main_timer); main_timer = null; parent.__lp_main_timer = null;
            stop("smart"); stop("move");
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
function toggle_pause() {
    paused = !paused;
    if (paused) {
        stop("move"); stop("smart"); busy = false;
        set_message("PAUSE");
        game_log(upgrading ? "Pause – Upgrade wird nach dem aktuellen Schritt abgebrochen" : "Bot pausiert (P zum Fortsetzen)");
    } else {
        set_message("Weiter"); game_log("Bot läuft wieder");
    }
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
function candidate_list() {
    var list = visible_mons().filter(function (m) {
        if (blocked_spots[m]) return false;
        var st = farm_stats[m];
        if (st && st.unsafe_until && character.level < st.unsafe_until) return false;
        return true;
    });
    list.sort(function (a, b) { return estimate(b) - estimate(a); });
    return list.slice(0, MEASURE_TOP);
}
function choose_spot() {
    var cands = candidate_list();
    if (!cands.length) return "goo";
    // 1. noch nicht (oder veraltet) gemessene Spots zuerst
    for (var i = 0; i < cands.length; i++) if (!stats_valid(farm_stats[cands[i]])) { game_log("Messe Spot: " + cands[i]); return cands[i]; }
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
    if (manual_spot) { if (current_spot != manual_spot) { current_spot = manual_spot; need_repick = false; meas = null; save_state(); } return current_spot; }
    if (!current_spot || need_repick) { current_spot = choose_spot(); need_repick = false; save_state(); }
    return current_spot;
}
// Buttons: fester Spot / Automatik / neu messen
function set_manual_spot(mon) {
    manual_spot = mon; meas = null; blocked_spots = {}; need_repick = true; current_spot = mon;
    game_log("Fester Farmspot: " + mon); save_state();
    if (paused) { paused = false; game_log("Pause aufgehoben"); }
    stop("smart"); busy = false;
    change_target(null);
    if (!upgrading && !kissing && !fleeing) go_to_farm_spot(); // sofort losgehen, nicht erst Angreifer abarbeiten
}
function set_auto_spot() {
    manual_spot = null; meas = null; need_repick = true; current_spot = null;
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
            var h = active / 3600000, st = farm_stats[meas.mon] || { deaths: 0 };
            st.xp_h = meas.xp / h; st.gold_h = meas.gold / h; st.t = Date.now(); st.level = character.level; st.attack = character.attack;
            farm_stats[meas.mon] = st; save_stats();
            meas.start = Date.now(); meas.xp = 0; meas.gold = 0; meas.paused_ms = 0; meas.pause_start = 0; save_state();
        }
    }
}
function finish_measure(died) {
    if (!meas) return;
    var active = Math.max(60000, Date.now() - meas.start - meas.paused_ms);
    var h = active / 3600000;
    var st = farm_stats[meas.mon] || { deaths: 0 };
    st.xp_h = meas.xp / h; st.gold_h = meas.gold / h; st.t = Date.now(); st.level = character.level; st.attack = character.attack;
    if (died) { st.deaths = (st.deaths || 0) + 1; if (!manual_spot) { st.unsafe_until = character.level + 3; st.xp_h = 0; } }
    farm_stats[meas.mon] = st; save_stats();
    game_log("Spot " + meas.mon + ": " + Math.round(st.xp_h) + " XP/h, " + Math.round(st.gold_h) + " Gold/h" + (died ? " – GESTORBEN, gesperrt bis Level " + st.unsafe_until : ""));
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
    if (Date.now() - last_go < 5000) return;
    last_go = Date.now();
    var mon = pick_farm_monster();
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
    busy = true; set_message("Laufe zu " + mon);
    smart_move(mon)
        .then(function () {
            if (!get_nearest_monster({ type: mon }) && !manual_spot && !spawn_areas(mon).length) {
                blocked_spots[mon] = true; need_repick = true; meas = null;
                game_log("Spot " + mon + " erreicht, aber keine Monster – überspringe");
            } else if (!meas || meas.mon != mon) { start_measure(mon); save_state(); }
        })
        .catch(function () {
            blocked_spots[mon] = true; need_repick = true; meas = null;
            game_log("Spot " + mon + " nicht erreichbar – überspringe");
        })
        .then(function () { busy = false; });
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
    if (hp < (swarm ? 0.55 : 0.4) && hpot && missing_hp >= hpot.gives * 0.8) {
        game_log("Heiltrank " + hpot.name + " (HP " + Math.round(hp * 100) + "%)"); equip(hpot.idx);
    } else if (mp < 0.3 && mpot && missing_mp >= mpot.gives * 0.8) {
        game_log("Manatrank " + mpot.name + " (MP " + Math.round(mp * 100) + "%)"); equip(mpot.idx);
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
    var idx = locate_item(ELIXIR);
    if (idx >= 0) { equip(idx); game_log("Elixier aktiviert: " + ELIXIR); }
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
var last_gain = Date.now(), stuck_count = 0;
function session_tick() {
    var before = sess.xp;
    if (character.level > sess.last_level) sess.xp += (G.levels[sess.last_level] - sess.last_xp) + character.xp;
    else sess.xp += Math.max(0, character.xp - sess.last_xp);
    if (sess.xp > before) last_gain = Date.now();
    sess.last_xp = character.xp; sess.last_level = character.level;
    var dg = character.gold - sess.last_gold; if (dg > 0) sess.gold += dg; sess.last_gold = character.gold;
}
function init_panel() {
    var doc = parent.document;
    var old = doc.getElementById("lp_panel"); if (old) old.remove();
    var st = doc.getElementById("lp_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_style";
    st.textContent = "#lp_panel{position:fixed;left:10px;top:130px;z-index:2147483000;pointer-events:auto;width:470px;background:#14161c;color:#e6e6e6;font:12px/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b;touch-action:none}"
      + "#lp_head b{flex:1;font-size:13px;letter-spacing:.3px}#lp_head .lp_state{font-size:11px;padding:1px 7px;border-radius:10px;background:#2e7d32}"
      + "#lp_head .lp_state.pause{background:#c62828}#lp_head .lp_state.busy{background:#ef6c00}"
      + "#lp_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_body{padding:8px 10px}"
      + ".lp_grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:6px}.lp_grid div{white-space:nowrap}.lp_k{color:#9aa3b2}"
      + ".lp_bar{display:inline-block;width:80px;height:8px;background:#2a2e38;border-radius:4px;vertical-align:middle;margin-left:6px;overflow:hidden}.lp_bar i{display:block;height:100%}"
      + ".lp_spot{background:#1c2029;border:1px solid #2f3440;border-radius:4px;padding:6px 8px;margin:4px 0 6px}.lp_spot .lp_big{font-size:15px;font-weight:600}"
      + ".lp_row{display:flex;gap:6px;align-items:center;margin:4px 0}.lp_row .lp_mode{color:#8ab4f8;flex:1}"
      + "#lp_body button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#2f3440;color:#eee;border:1px solid #555;border-radius:3px}#lp_body button:hover{background:#3d4453}#lp_body button.on{background:#2e7d32;border-color:#4caf50}"
      + "table.lp_t{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px}table.lp_t th{color:#9aa3b2;font-weight:normal;text-align:right;padding:2px 4px;border-bottom:1px solid #3a3f4b;cursor:pointer}table.lp_t th:hover{color:#fff}table.lp_t th.sorted{color:#8ab4f8}table.lp_t th:first-child,table.lp_t td:first-child{text-align:left}"
      + "table.lp_t td{padding:2px 4px;text-align:right;white-space:nowrap}table.lp_t td[title]{cursor:help;text-decoration:underline dotted #666}table.lp_t tr:nth-child(even) td{background:#181b22}table.lp_t tr.cur td{background:#20302a;color:#c8f0d0}table.lp_t td.old{color:#8a8f99}";
    doc.head.appendChild(st);

    var div = doc.createElement("div"); div.id = "lp_panel";
    div.innerHTML = "<div id='lp_head'><b>LogicPlan " + BOT_VERSION + "</b><span class='lp_state' id='lp_state'>läuft</span><button id='lp_toggle' title='Tabelle ein-/ausklappen'>▾</button></div><div id='lp_body'></div>";
    try { var p = JSON.parse(localStorage.getItem("lp_panel_pos") || "null"); if (p) { div.style.left = p.x + "px"; div.style.top = p.y + "px"; } } catch (e) {}
    doc.body.appendChild(div);

    // Maus-Ereignisse in der Capture-Phase am Fenster abgreifen (vor dem Spiel)
    var win = parent.window, drag = null, head = div.querySelector("#lp_head");
    var collapsed = false; try { collapsed = localStorage.getItem("lp_panel_collapsed") == "1"; } catch (e) {}
    div.__collapsed = collapsed;
    try { div.__gear = localStorage.getItem("lp_panel_gear") == "1"; } catch (e) { div.__gear = false; }
    var inside = function (e) { return e.target && div.contains(e.target); };
    var onDown = function (e) {
        if (!inside(e)) return;
        if (!parent.__lp_evt_logged) { parent.__lp_evt_logged = true; game_log("Panel: Maus erkannt (" + e.type + ")"); }
        if (e.target.tagName == "BUTTON") { e.stopPropagation(); return; }
        if (head.contains(e.target)) { drag = { dx: e.clientX - div.offsetLeft, dy: e.clientY - div.offsetTop }; e.preventDefault(); }
        e.stopPropagation();
    };
    var onMove = function (e) { if (!drag) return; div.style.left = (e.clientX - drag.dx) + "px"; div.style.top = (e.clientY - drag.dy) + "px"; e.preventDefault(); e.stopPropagation(); };
    var onUp = function (e) { if (!drag) return; try { localStorage.setItem("lp_panel_pos", JSON.stringify({ x: div.offsetLeft, y: div.offsetTop })); } catch (x) {} drag = null; e.stopPropagation(); };
    var onClick = function (e) {
        if (!inside(e)) return;
        e.stopPropagation();
        var b = e.target;
        if (b.tagName == "TH" && b.getAttribute("data-sort")) { set_sort(b.getAttribute("data-sort")); return; }
        if (b.tagName != "BUTTON") return;
        if (b.id == "lp_toggle") { div.__collapsed = !div.__collapsed; try { localStorage.setItem("lp_panel_collapsed", div.__collapsed ? "1" : "0"); } catch (x) {} last_panel = 0; return; }
        var act = b.getAttribute("data-act"), mon = b.getAttribute("data-mon");
        if (act == "farm") set_manual_spot(mon); else if (act == "auto") set_auto_spot(); else if (act == "reset") reset_measurements();
        else if (act == "hide") hide_mon(mon, true); else if (act == "show") hide_mon(mon, false);
        else if (act == "worth") { only_worth = !only_worth; save_hidden(); }
        else if (act == "sortinv") sort_inventory();
        else if (act == "compound") compound_only();
        else if (act == "tidy") tidy_now();
        else if (act == "copylog") copy_log();
        else if (act == "goal") start_goal(b.getAttribute("data-slot"));
        else if (act == "goalstop") stop_goal("manuell");
        else if (act == "goalskip") { goal_skip[b.getAttribute("data-item")] = Date.now(); save_goal_skip(); goal_cache_t = 0; }
        else if (act == "geartoggle") { div.__gear = !div.__gear; try { localStorage.setItem("lp_panel_gear", div.__gear ? "1" : "0"); } catch (x) {} }
        else if (act == "clearlog") { log_buf = []; try { localStorage.setItem("lp_log", "[]"); } catch (x) {} _game_log("Log-Puffer geleert"); }
        last_panel = 0;
    };
    if (parent.__lp_panel_h) { var H = parent.__lp_panel_h; ["pointerdown", "mousedown"].forEach(function (t) { win.removeEventListener(t, H.down, true); }); ["pointermove", "mousemove"].forEach(function (t) { win.removeEventListener(t, H.move, true); }); ["pointerup", "mouseup"].forEach(function (t) { win.removeEventListener(t, H.up, true); }); win.removeEventListener("click", H.click, true); }
    ["pointerdown", "mousedown"].forEach(function (t) { win.addEventListener(t, onDown, true); });
    ["pointermove", "mousemove"].forEach(function (t) { win.addEventListener(t, onMove, true); });
    ["pointerup", "mouseup"].forEach(function (t) { win.addEventListener(t, onUp, true); });
    win.addEventListener("click", onClick, true);
    parent.__lp_panel_h = { down: onDown, move: onMove, up: onUp, click: onClick };
    return div;
}
var panel = init_panel();
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
    var def = d.damage_type == "magical" ? (character.resistance || 0) - (d.rpiercing || 0) : (character.armor || 0) - (d.apiercing || 0);
    return mon_dps(d) * dmg_mult(def);
}
function mon_ttk(d) { // Sekunden pro Kill inkl. Lebensraub
    var dps = my_dps_vs(d); if (dps <= 0) return Infinity;
    var heal = mon_dps(d) * (d.lifesteal || 0) / 100;
    var net = dps - heal; if (net <= 0) return Infinity;
    return (d.hp || 0) / net;
}
function mon_danger(d) { // Anteil meiner HP, den ein Kill kostet
    var ttk = mon_ttk(d); if (!isFinite(ttk)) return Infinity;
    var incoming = mon_dps_on_me(d) + my_dps_vs(d) * (d.reflection || 0) / 100;
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
function mon_xph_est(d, mon) {
    var ttk = mon_ttk(d); if (!isFinite(ttk)) return 0;
    var kills_h = 3600 / (ttk + 2) * 0.8;
    if (mon && d.respawn) kills_h = Math.min(kills_h, spawn_count(mon) * 3600 / d.respawn);
    return (d.xp || 0) * kills_h;
}
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
function update_panel() {
    if (!panel || !panel.parentNode) panel = init_panel();
    var hp = Math.round(character.hp / character.max_hp * 100), mp = Math.round(character.mp / character.max_mp * 100);
    var state = panel.querySelector("#lp_state");
    var st_txt = !bot_running ? "AUS" : paused ? "PAUSE" : upgrading ? "Upgrade" : pending_upgrade ? "Upgrade wartet" : kissing ? "Kuss" : fleeing ? "Rückzug" : exchanging ? "Tausch" : pontying ? "Ponty" : marketing ? "Markt" : busy ? "unterwegs" : "farmt";
    state.textContent = st_txt; state.className = "lp_state" + ((paused || !bot_running) ? " pause" : (upgrading || pending_upgrade || kissing || fleeing || exchanging || busy) ? " busy" : "");
    panel.querySelector("#lp_toggle").textContent = panel.__collapsed ? "▸" : "▾";

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

    var h = "<div class='lp_grid'>"
      + "<div><span class='lp_k'>Level</span> " + character.level + "</div><div><span class='lp_k'>Gold</span> " + fmt(character.gold) + "</div>"
      + "<div><span class='lp_k'>HP</span> " + hp + "%" + bar(hp, hp < 35 ? "#e53935" : "#43a047") + "</div><div><span class='lp_k'>MP</span> " + mp + "%" + bar(mp, "#1e88e5") + "</div>"
      + "<div><span class='lp_k'>Tränke</span> " + pots_total(POTS_HP) + " / " + pots_total(POTS_MP) + "</div><div><span class='lp_k'>Elixier</span> " + (character.slots.elixir ? "an" : "aus") + " · <span class='lp_k'>frei</span> " + character.esize + "</div>"
      + "<div><span class='lp_k'>Session</span> " + fmt_time(sh * 3600000) + "</div><div><span class='lp_k'>Kuss</span> " + kiss_txt + "</div>"
      + "</div>";
    h += "<div class='lp_spot'><div><span class='lp_k'>Spot</span> <b>" + esc(current_spot || "-") + "</b>" + (meas_txt ? " <span class='lp_k'>(" + meas_txt + ")</span>" : "") + "</div>"
      + "<div class='lp_big'>" + fmt(cur_xp_h) + " XP/h &nbsp;·&nbsp; " + fmt(cur_gold_h) + " G/h</div>"
      + "<div class='lp_k'>Session " + fmt(sess.xp / sh) + " XP/h · " + fmt(sess.gold / sh) + " G/h · nächstes Level in " + (rate > 0 ? fmt_time((G.levels[character.level] - character.xp) / rate * 3600000) : "-") + "</div></div>";
    h += "<div class='lp_row'><span class='lp_mode'>Modus: " + (manual_spot ? "fest (" + esc(manual_spot) + ")" : "automatisch") + "</span><button data-act='auto'" + (manual_spot ? "" : " class='on'") + ">Auto</button><button data-act='reset'>Neu messen</button><button data-act='worth'" + (only_worth ? " class='on'" : "") + " title='nur die 5 besten nach geschätzten XP/h'>Top 5</button><button data-act='sortinv' title='Inventar sortieren'>Inv ⇅</button></div>"
      + "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Aktionen</span><button data-act='compound' title='Schmuck compounden (getragen + ungetragen)'>Compound</button><button data-act='tidy' title='Schrott verkaufen, Rest in die Bank'>Aufräumen</button><button data-act='copylog' title='Bot-Log in die Zwischenablage'>Log kopieren</button><button data-act='clearlog' title='Log-Puffer leeren' style='padding:1px 5px'>✕</button></div>";
    h += "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Ausrüstung: " + (gear_goal ? "<span style='color:#8ab4f8'>" + esc(gear_goal.item) + " – " + esc(plan_text(gear_goal.steps.slice(gear_goal.step))) + "</span>" : "kein Auftrag") + "</span>"
      + (gear_goal ? "<button data-act='goalstop'>Stopp</button>" : "") + "<button data-act='geartoggle'>" + (panel.__gear ? "▾" : "▸") + " Slots</button></div>";
    if (panel.__gear) {
        var goals = compute_goals();
        h += "<table class='lp_t'><tr><th>Slot</th><th>Aktuell</th><th style='text-align:left'>Empfehlung (Wert je Aufwand)</th><th style='text-align:left'>Alternativen</th><th></th></tr>";
        for (var gs in goals) {
            var g = goals[gs], t = g.target, ops = g.options || [];
            var rec = ops[0], alts = ops.slice(1);
            h += "<tr><td>" + gs + "</td><td>" + (g.cur ? esc(g.cur.name) + "+" + (g.cur.level || 0) : "<span style='color:#ef5350'>leer</span>") + "</td>"
               + "<td style='text-align:left;white-space:normal;max-width:200px'>" + (rec ? esc(option_text(rec)) : "<span style='color:#9aa3b2'>kein Farmweg – nur Markt (noch kein Angebot gesehen)</span>") + "</td>"
               + "<td style='text-align:left;white-space:normal;max-width:170px;color:#9aa3b2'>" + (alts.length ? alts.map(function (o) { return esc(option_text(o)); }).join("<br>") : "-") + "</td>"
               + "<td>" + (t && t.plan ? "<button data-act='goal' data-slot='" + gs + "'" + (gear_goal && gear_goal.slot == gs ? " class='on'" : "") + ">Beschaffen</button>" : "") + (t ? " <button data-act='goalskip' data-item='" + t.item + "' title='dieses Item überspringen' style='padding:1px 5px'>✕</button>" : "") + "</td></tr>";
        }
        h += "</table>";
    }
    if (!panel.__collapsed) {
        var cols = [["name", "Monster"], ["danger", "Gefahr"], ["ttk", "s/Kill"], ["xpk", "XP/Kill"], ["xpest", "XP/h*"], ["xph", "XP/h"], ["gph", "G/h"], ["ang", "ANG"]];
        h += "<table class='lp_t'><tr>" + cols.map(function (c) { return "<th data-sort='" + c[0] + "'" + (sort_key == c[0] ? " class='sorted'" : "") + ">" + c[1] + (sort_key == c[0] ? (sort_dir < 0 ? " ▾" : " ▴") : "") + "</th>"; }).join("") + "<th></th></tr>";
        var mons = visible_mons();
        mons.sort(function (x, y) { var a1 = sort_value(x, sort_key), b1 = sort_value(y, sort_key); return (a1 < b1 ? -1 : a1 > b1 ? 1 : 0) * sort_dir; });
        mons.forEach(function (m) {
            var st = farm_stats[m], d = G.monsters[m], oldc = st && !stats_valid(st) ? " class='old'" : "";
            var dg = mon_danger(d), ttk = mon_ttk(d);
            h += "<tr" + (m == current_spot ? " class='cur'" : "") + "><td title='" + esc(mon_tooltip(m)) + "'>" + esc(m) + (st && st.deaths ? " <span style='color:#ef5350'>†" + st.deaths + "</span>" : "") + "</td>"
               + "<td style='color:" + (dg > 0.35 ? "#ef5350" : dg > 0.15 ? "#ffb74d" : "#81c784") + "'>" + (isFinite(dg) ? Math.round(dg * 100) + "%" : "∞") + "</td><td>" + (isFinite(ttk) ? ttk.toFixed(1) : "∞") + "</td><td>" + fmt(d.xp) + "</td><td>" + fmt(mon_xph_est(d, m)) + "</td>"
               + "<td" + oldc + ">" + (st ? fmt(st.xp_h) : "-") + "</td><td" + oldc + ">" + (st ? fmt(st.gold_h) : "-") + "</td><td" + oldc + ">" + (st && st.attack ? st.attack : "-") + "</td>"
               + "<td><button data-act='farm' data-mon='" + m + "'" + (m == manual_spot ? " class='on'" : "") + ">Farmen</button> <button data-act='hide' data-mon='" + m + "' title='ausblenden' style='padding:1px 5px'>✕</button></td></tr>";
        });
        var hid = Object.keys(hidden_mons).filter(function (m) { return G.monsters[m]; });
        var auto_hid = only_worth ? CANDIDATES.filter(function (m) { return is_safe_monster(m) && !hidden_mons[m] && !is_worth(m); }) : [];
        if (hid.length || auto_hid.length) {
            h += "<tr><td colspan='9' style='text-align:left;color:#9aa3b2;white-space:normal'>Ausgeblendet: "
               + hid.map(function (m) { return esc(m) + " <button data-act='show' data-mon='" + m + "' style='padding:0 4px'>↩</button>"; }).join(" ")
               + (auto_hid.length ? " <span style='color:#6b7280'>(Filter: " + auto_hid.map(esc).join(", ") + ")</span>" : "") + "</td></tr>";
        }
        h += "</table>";
    }
    panel.querySelector("#lp_body").innerHTML = h;
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
        if (stuck_count % 3 == 0) await smart_move("town"); // jedes dritte Mal über die Stadt
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
function is_junk(it) { // kaufbare Standardausrüstung ohne Level/Attribut; ungetragener kaufbarer Schmuck +0 in Einzelstücken
    var def = G.items[it.name]; if (!def) return false;
    if (def.compound) return is_buyable(it.name) && (it.level || 0) == 0 && !equipped_names()[it.name] && find_inv_indices(it.name, 0).length < 3;
    if (EQUIP_TYPES.indexOf(def.type) < 0) return false;
    if ((it.level || 0) > 0 || it.stat_type) return false;
    return is_buyable(it.name);
}
function should_keep(it) { return (equipped_names()[it.name] && (it.level || 0) > 0) || (G.items[it.name] && G.items[it.name].compound && (equipped_names()[it.name] || find_inv_indices(it.name, it.level || 0).length >= 3)) || KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name) || EVENT_ITEMS.test(G.items[it.name] && G.items[it.name].name || ""); }
async function tidy_inventory() {
    if (busy || upgrading || paused || character.esize >= INV_MIN_FREE) return;
    busy = true;
    try {
        // 1. verkaufen
        var junk = [];
        for (var i = 0; i < character.items.length; i++) if (character.items[i] && is_junk(character.items[i])) junk.push(i);
        if (junk.length) {
            set_message("Verkaufen"); await smart_move("potions");
            for (var j = 0; j < junk.length; j++) { var it = character.items[junk[j]]; if (!it) continue; sell(junk[j], it.q || 1); await sleep(300); }
            game_log("Inventar: " + junk.length + " Schrott-Items verkauft");
        }
        // 2. Rest in die Bank (vorher: Teile für leere Slots zurückholen)
        if (character.esize < INV_MIN_FREE + 3) {
            set_message("Bank"); await smart_move("bank"); await sleep(800);
            await retrieve_for_empty_slots();
            var n = 0;
            for (var k = 0; k < character.items.length; k++) {
                var it2 = character.items[k]; if (!it2 || should_keep(it2)) continue;
                bank_store(k); n++; await sleep(300);
            }
            game_log("Inventar: " + n + " Items in die Bank gelegt (frei: " + character.esize + ")");
        }
    } catch (e) { game_log("Inventar-Fehler: " + e); }
    busy = false;
}

// ---------- Notfall-Rückzug ----------
var fleeing = false;
function attackers_on_me() {
    var n = 0;
    for (var id in parent.entities) { var e = parent.entities[id]; if (e && e.type == "monster" && !e.dead && e.target == character.name) n++; }
    return n;
}
async function check_flee() {
    if (fleeing || paused || upgrading || kissing) return;
    var hp = character.hp / character.max_hp;
    var n = attackers_on_me();
    if (n < FLEE_ATTACKERS || hp > KITE_HP) return;
    fleeing = true; busy = true;
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
        await smart_move("town");
        while (character.hp < character.max_hp * 0.8 && !character.rip) await sleep(1000);
        game_log("Erholt, zurück zum Spot");
    } catch (e) {}
    fleeing = false; busy = false;
}

// ---------- 10-Jahre-Event: Kuss-Runde ----------
var kiss_done_round = null, kissing = false, kiss_fail_round = null;
function anniv() { return parent.S && parent.S.anniversary; }
function kiss_round_open() {
    var a = anniv();
    if (!KISS_ENABLED || !a || !a.active || !a.live || !a.target || a.available === false) return false;
    if (a.round == kiss_done_round || a.round == kiss_fail_round) return false;
    if (a.expires && Date.now() > a.expires - 15000) return false;
    return true;
}
async function kiss_routine() {
    if (kissing || upgrading || fleeing || !kiss_round_open()) return;
    var a = anniv(); var round = a.round, name = a.target;
    kissing = true; busy = true;
    game_log("Kuss-Runde " + round + ": laufe zu " + name + " (" + a.map + " " + a.x + "," + a.y + ")");
    set_message("Kuss: " + name);
    try {
        stop("smart");
        await smart_move({ map: a.map, x: a.x, y: a.y });
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
                try { await use_skill("ikissyou", ent); } catch (e) { failed = true; game_log("Kuss-Fehler: " + (e && e.reason || e)); }
                await sleep(2000);
                if (rewarded()) { ok = true; break; }
                if (!failed && ++clean >= 2) { ok = true; break; } // zweimal ohne Fehler -> als erledigt werten
                if (tries >= 5) break;
            } else await sleep(500);
        }
        if (ok) game_log("Buffs jetzt: " + Object.keys(character.s || {}).join(",") + " | Gifts " + quantity("anniversarygift"));
        if (ok) { kiss_done_round = round; game_log("Kuss belohnt (Runde " + round + ")"); }
        else { kiss_fail_round = round; game_log("Kuss diese Runde nicht geschafft"); }
    } catch (e) { kiss_fail_round = round; game_log("Kuss-Routine abgebrochen: " + e); }
    kissing = false; busy = false;
}

// ---------- Anniversary Gifts bei Xyn eintauschen (Taste G) ----------
var exchanging = false;
function exchangeable(it) { var d = G.items[it.name]; return d && d.e && (it.q || 1) >= d.e; }
async function exchange_gifts() {
    if (exchanging) { game_log("Tausch läuft bereits"); return; }
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal G drücken"); return; }
    unpause("Xyn-Tausch");
    exchanging = true; busy = true;
    try {
        // 1. tauschbare Sachen aus der Bank holen
        set_message("Bank"); await smart_move("bank"); await sleep(800);
        await retrieve_for_empty_slots();
        var bank = character.bank || {}, got = 0;
        for (var pack in bank) {
            if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue;
            for (var i = 0; i < bank[pack].length; i++) { var bi = bank[pack][i]; if (bi && G.items[bi.name] && G.items[bi.name].e && character.esize > 2) { try { bank_retrieve(pack, i); got++; await sleep(400); } catch (e) {} } }
        }
        if (got) game_log("Aus der Bank geholt: " + got + " tauschbare Stapel");
        // 2. bei Xyn alles tauschen
        var todo = character.items.filter(function (it) { return it && exchangeable(it); }).map(function (it) { return it.name; });
        if (!todo.length) { game_log("Nichts zum Tauschen"); }
        else {
            game_log("Tausche bei Xyn: " + todo.filter(function (n, i, a) { return a.indexOf(n) == i; }).join(", "));
            set_message("Zu Xyn"); stop("smart"); await smart_move("exchange");
            var done = 0, fails = 0;
            while (!paused) {
                var idx = -1;
                for (var k = 0; k < character.items.length; k++) if (character.items[k] && exchangeable(character.items[k])) { idx = k; break; }
                if (idx < 0) break;
                if (character.esize < 2) { game_log("Inventar voll – Tausch gestoppt"); break; }
                var nm = character.items[idx].name, before = quantity(nm);
                try { await exchange(idx); } catch (e) {}
                await sleep(1200);
                while (character.q && character.q.exchange) await sleep(500);
                await sleep(300);
                if (quantity(nm) < before) { done++; fails = 0; set_message("Tausch " + done); }
                else if (++fails >= 3) { game_log("Tausch klappt nicht bei " + nm); break; }
            }
            game_log("Fertig: " + done + " Tauschvorgänge");
        }
    } catch (e) { game_log("Tausch-Fehler: " + e); }
    exchanging = false; busy = false;
    if (!paused) go_to_farm_spot();
}

// ---------- Tränke kaufen: beste Stufe, die das Gold hergibt ----------
function pick_pot_tier(list) { // list ist "beste zuerst"
    for (var i = 0; i < list.length; i++) if (is_buyable(list[i]) && spendable() >= G.items[list[i]].g * 300) return list[i];
    return list[list.length - 1];
}
function check_potions() {
    if (busy) return;
    if (pots_total(POTS_HP) >= 30 && pots_total(POTS_MP) >= 30) return;
    var hp_t = pick_pot_tier(POTS_HP), mp_t = pick_pot_tier(POTS_MP);
    var price = G.items[hp_t].g + G.items[mp_t].g;
    var amount = Math.min(150, Math.floor((spendable() * 0.7) / price));
    if (amount < 20) return;

    busy = true; set_message("Tränke kaufen");
    smart_move("potions").then(function () {
        buy(hp_t, amount); buy(mp_t, amount);
        game_log("Tränke gekauft: " + amount + " " + hp_t + " / " + amount + " " + mp_t);
        if (is_buyable(ELIXIR) && quantity(ELIXIR) < 3 && spendable() > G.items[ELIXIR].g * 10) { buy(ELIXIR, 5); game_log("5x " + ELIXIR + " gekauft"); }
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
    return equipped_slots("upgrade").filter(function (s) { var it = character.slots[s]; return (it.level || 0) < target_level(it.name, manual) || (is_buyable(it.name) && backup_index(it.name) < 0); });
}
function slots_without_stat() {
    return equipped_slots("upgrade").filter(function (s) { return character.slots[s].stat_type != STAT_TYPE; });
}
function inv_count(name, level) { return find_inv_indices(name, level).length; }
function base_equiv(name) { var sum = 0; for (var l = 0; l < COMPOUND_TARGET; l++) sum += inv_count(name, l) * Math.pow(3, l); return sum; }
// Compound sinnvoll? -> irgendein Level hat (inkl. angelegtem) >= 3 Kopien, oder kaufbar und bezahlbar
function can_compound(slot) {
    var it = character.slots[slot]; if (!it || (it.level || 0) >= COMPOUND_TARGET) return false;
    for (var l = 0; l < COMPOUND_TARGET; l++) if (inv_count(it.name, l) + ((it.level || 0) == l ? 1 : 0) >= 3) return true;
    if (!is_buyable(it.name)) return false;
    var need = Math.pow(3, COMPOUND_TARGET) - base_equiv(it.name) - Math.pow(3, it.level || 0);
    return need <= 0 || spendable() >= need * G.items[it.name].g * 1.3;
}
function slots_to_compound() { return equipped_slots("compound").filter(can_compound); }
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
    unpause("Compound");
    if (busy) { game_log("Gerade unterwegs – gleich nochmal"); return; }
    upgrading = true; busy = true; set_message("Compound");
    try {
        var cs = slots_to_compound();
        game_log("Compound: " + cs.length + " getragene Slots" );
        for (var c = 0; c < cs.length; c++) { check_pause(); await compound_slot(cs[c]); }
        await compound_spares();
    } catch (e) { game_log(e == "PAUSE" ? "Compound durch Pause abgebrochen" : "Compound-Fehler: " + e); }
    upgrading = false; busy = false;
    if (!paused) go_to_farm_spot();
}
async function tidy_now() {
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal"); return; }
    unpause("Aufräumen");
    var saved = INV_MIN_FREE; INV_MIN_FREE = 999; // erzwingen
    try { await tidy_inventory(); } finally { INV_MIN_FREE = saved; }
    if (!paused) go_to_farm_spot();
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
    } catch (e) { game_log("Sortier-Fehler: " + e); }
    sorting_inv = false;
}

// ---------- Ponty: gebrauchte Items prüfen und kaufen ----------
var last_ponty = 0, ponty_logged = false, pontying = false;
function ponty_offer() { // Angebot abfragen (Socket), Promise mit Liste
    return new Promise(function (resolve) {
        var done = false;
        var h = function (data) { if (done) return; done = true; try { parent.socket.off("secondhands", h); } catch (e) {} resolve(data || []); };
        try { parent.socket.on("secondhands", h); parent.socket.emit("secondhands"); } catch (e) { resolve([]); }
        setTimeout(function () { if (!done) { done = true; try { parent.socket.off("secondhands", h); } catch (e) {} resolve([]); } }, 4000);
    });
}
function item_score(it) { return gear_score(G.items[it.name], it.level || 0); }
function slot_for_item(def) { for (var sl in SLOT_TYPES) if (fits_slot(def, sl)) return sl; return null; }
async function check_ponty(force) {
    if (pontying || upgrading || kissing || fleeing || exchanging) return;
    if (!force && (busy || Date.now() - last_ponty < PONTY_INTERVAL)) return;
    var npc = G.npcs.secondhands ? "secondhands" : null;
    if (!npc) { last_ponty = Date.now(); return; }
    pontying = true; busy = true; last_ponty = Date.now();
    try {
        set_message("Ponty");
        if (!await go_to_npc(npc)) throw "Ponty nicht gefunden";
        var offer = await ponty_offer();
        if (!ponty_logged) { ponty_logged = true; game_log("Ponty-Angebot: " + (offer.length ? offer.map(function (o) { return o.name + (o.level ? "+" + o.level : "") + (o.price ? "@" + fmt(o.price) : ""); }).join(", ") : "leer/unbekannt")); }
        var bought = 0;
        offer.forEach(function (o) { var def = G.items[o.name]; if (def && slot_for_item(def)) { var pr = o.price || Math.round(def.g * Math.pow(2, o.level || 0) * 3); var prev = market_valid(o.name); if (!prev || pr < prev.price) note_market(o.name, o.level, pr, "Ponty"); } });
        for (var i = 0; i < offer.length; i++) {
            var o = offer[i], def = G.items[o.name]; if (!def) continue;
            var slot = slot_for_item(def); if (!slot) continue;
            var price = o.price || Math.round(def.g * Math.pow(2, o.level || 0) * 3);
            if (price > spendable() * 0.5 || character.esize < 2) continue;
            var cur = character.slots[slot], cur_s = cur ? item_score(cur) : 0;
            var is_goal = goal_cache[slot] && goal_cache[slot].want_market == o.name;
            if (!is_goal && item_score(o) < cur_s * GEAR_MIN_GAIN) continue;
            game_log("Ponty: kaufe " + o.name + "+" + (o.level || 0) + " für " + slot + " (" + fmt(price) + " Gold)");
            var before = character.esize;
            try { parent.socket.emit("sbuy", { rid: o.rid }); } catch (e) {}
            await sleep(1500);
            if (character.esize < before) {
                var idx = find_inv_index(o.name, o.level || 0);
                if (idx >= 0) { equip(idx, slot); await sleep(600); bought++; }
            } else game_log("Ponty: Kauf nicht bestätigt (" + o.name + ")");
        }
        if (bought) game_log("Ponty: " + bought + " Item(s) gekauft und angelegt");
    } catch (e) { game_log("Ponty-Fehler: " + e); }
    pontying = false; busy = false;
}

// ---------- Marktstände anderer Spieler ----------
var last_market = 0, marketing = false;
function market_offers() { // alle Angebote sichtbarer Stände
    var out = [];
    for (var id in parent.entities) {
        var p = parent.entities[id];
        if (!p || p.type != "character" || !p.stand || !p.slots) continue;
        for (var sl in p.slots) {
            if (sl.indexOf("trade") != 0) continue;
            var it = p.slots[sl]; if (!it || !it.price || it.b) continue; // b = Kaufgesuch
            out.push({ seller: p, slot: sl, name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, id: p.id });
        }
    }
    return out;
}
async function check_market(force) {
    if (marketing || upgrading || kissing || fleeing || exchanging || pontying) return;
    if (!force && (busy || Date.now() - last_market < MARKET_INTERVAL)) return;
    marketing = true; busy = true; last_market = Date.now();
    try {
        set_message("Markt"); await smart_move("town"); await sleep(1500);
        var offers = market_offers(), bought = 0;
        offers.forEach(function (o) { var def = G.items[o.name]; if (def && slot_for_item(def)) { var prev = market_valid(o.name); if (!prev || o.price < prev.price) note_market(o.name, o.level, o.price, "Stand " + o.seller.name); } });
        game_log("Markt: " + offers.length + " Angebote an " + offers.filter(function (o, i, a) { return a.findIndex(function (x) { return x.id == o.id; }) == i; }).length + " Ständen");
        offers.sort(function (a, b) { return a.price - b.price; });
        for (var i = 0; i < offers.length; i++) {
            var o = offers[i], def = G.items[o.name]; if (!def) continue;
            var slot = slot_for_item(def); if (!slot) continue;
            if (o.price > spendable() * 0.5 || character.esize < 2) continue;
            var cur = character.slots[slot], cur_s = cur ? item_score(cur) : 0;
            var is_goal = goal_cache[slot] && goal_cache[slot].want_market == o.name;
            if (!is_goal && cur && item_score(o) < cur_s * GEAR_MIN_GAIN) continue;
            if (distance(character, o.seller) > 300) { try { await smart_move({ x: o.seller.x, y: o.seller.y + 30 }); } catch (e) { continue; } }
            game_log("Markt: kaufe " + o.name + "+" + o.level + " für " + slot + " von " + o.seller.name + " (" + fmt(o.price) + " Gold)");
            var before = character.esize;
            try { trade_buy(o.seller, o.slot, 1); } catch (e) { game_log("Markt-Kauf fehlgeschlagen: " + e); continue; }
            await sleep(1500);
            if (character.esize < before) { var idx = find_inv_index(o.name, o.level); if (idx >= 0) { equip(idx, slot); await sleep(600); bought++; } }
        }
        if (bought) game_log("Markt: " + bought + " Item(s) gekauft und angelegt");
    } catch (e) { game_log("Markt-Fehler: " + e); }
    marketing = false; busy = false;
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
function gold_per_hour() { var best = 0; for (var m in farm_stats) best = Math.max(best, farm_stats[m].gold_h || 0); var sh = (Date.now() - sess.start) / 3600000; if (sh > 0.25) best = Math.max(best, sess.gold / sh); return best || 100000; }
function scroll_price_for(def, level) { // Scrollpreis für Upgrade/Compound von level -> level+1
    var g = def.grades || [], grade = 0; for (var i = 0; i < g.length; i++) if (level >= g[i]) grade = i + 1; grade = Math.min(grade, 2);
    var nm = (def.upgrade ? "scroll" : "cscroll") + grade; return G.items[nm] ? G.items[nm].g : 1000;
}
function base_price(def, name) { return is_buyable(name) ? def.g : Math.max(def.g * MARKET_FACTOR, 50000); } // nicht kaufbare: mind. 50k am Markt
function cost_to_reach(name, level) { // erwartete Gesamtkosten, ein Item von 0 auf level zu bringen (inkl. Verluste)
    var def = G.items[name], c = base_price(def, name);
    for (var l = 0; l < level; l++) {
        var p = def.upgrade ? (UP_P[l] || 0.15) : (CO_P[l] || 0.25);
        if (def.compound) c = (3 * c + scroll_price_for(def, l)) / p; else c = (c + scroll_price_for(def, l)) / p;
    }
    return c;
}
function step_cost(name, level) { var def = G.items[name]; var p = def.upgrade ? (UP_P[level] || 0.15) : (CO_P[level] || 0.25); var own = cost_to_reach(name, level); return def.compound ? (2 * own + scroll_price_for(def, level)) / p + own * (1 - p) / p : (scroll_price_for(def, level) + own * (1 - p)) / p; }
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
        if (cur && lvl < max_level(cur_def) && (cur_def.upgrade || cur_def.compound)) {
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
    if (o.kind == "upgrade") return "Upgrade auf +" + o.to + per;
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
function stop_goal(reason) { if (gear_goal) { game_log("Beschaffung beendet: " + gear_goal.item + (reason ? " (" + reason + ")" : "")); } gear_goal = null; if (manual_spot && goal_spot) { manual_spot = null; goal_spot = null; need_repick = true; } goal_cache_t = 0; }
var goal_spot = null, goal_busy = false;
async function run_goal() {
    if (!gear_goal || goal_busy || upgrading || kissing || fleeing || exchanging || pontying || marketing) return;
    var st = gear_goal.steps[gear_goal.step];
    if (!st) { // fertig: Ziel-Item anlegen
        goal_busy = true;
        var idx = find_inv_index(gear_goal.item, 0); if (idx < 0) for (var i = 0; i < character.items.length; i++) if (character.items[i] && character.items[i].name == gear_goal.item) { idx = i; break; }
        if (idx >= 0) { equip(idx, gear_goal.slot); await sleep(600); game_log(gear_goal.item + " angelegt (" + gear_goal.slot + ")"); }
        stop_goal("fertig"); goal_busy = false; return;
    }
    if (st.type == "farm") {
        if (quantity(st.item) >= st.qty) { gear_goal.step++; gear_goal.step_started = Date.now(); if (manual_spot == goal_spot) { manual_spot = null; goal_spot = null; need_repick = true; } return; }
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
            set_message("Tauschen"); await smart_move("exchange");
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
// Ausrüstungswert: Hauptattribut (Magier: INT, "stat" zählt mit) stark gewichtet; level = projiziertes Upgrade-/Compound-Level
function stat_weights(st) {
    var main = character.ctype == "mage" || character.ctype == "priest" ? (st.int || 0) : character.ctype == "warrior" ? (st.str || 0) : (st.dex || 0);
    return (main + (st.stat || 0)) * 30 + (st.attack || 0) * 3 + (st.range || 0) * 0.5 + (st.frequency || 0) * 5 + (st.hp || 0) * 0.05 + (st.mp || 0) * 0.1 + (st.armor || 0) * 0.5 + (st.resistance || 0) * 0.5 + (st.rpiercing || 0) * 2;
}
function gear_score(def, level) {
    if (!def) return 0;
    var sc = stat_weights(def), lv = level || 0;
    if (lv > 0) { if (def.upgrade) sc += lv * stat_weights(def.upgrade); else if (def.compound) sc += lv * stat_weights(def.compound); }
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
    var name = it.name, lvl = it.level || 0, target = COMPOUND_TARGET;

    unequip(slot); await sleep(600);
    var need = Math.pow(3, target) - base_equiv(name);
    if (need > 0 && is_buyable(name)) {
        var cost = need * G.items[name].g;
        if (spendable() >= cost * 1.3 && character.esize >= need + 2) { game_log(name + ": kaufe " + need + " Stück zum Compounden"); await buy_items(name, need); }
        else game_log(name + ": " + need + " Kopien fehlen, nutze nur vorhandene");
    }
    try {
        await smart_move("compound");
        for (var l = 0; l < target; l++) {
            while (spendable() > 0) {
                check_pause();
                var idx = find_inv_indices(name, l);
                if (idx.length < 3) break;
                var scroll = "cscroll" + item_grade(character.items[idx[0]]);
                if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
                var sc = locate_item(scroll);
                if (sc < 0) { game_log("keine " + scroll); break; }
                set_message(name + " +" + l + " x3");
                try { await compound(idx[0], idx[1], idx[2], sc); } catch (e) {}
                await wait_queue("compound");
                if (find_inv_index(name, l + 1) >= 0 && find_inv_indices(name, l).length == idx.length - 3) game_log(name + " +" + (l + 1) + " erstellt");
                else if (find_inv_indices(name, l).length == idx.length - 3) game_log(name + " compound fehlgeschlagen (+" + l + " x3 verloren)");
                else game_log(name + " +" + (l + 1) + " erstellt");
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
        if (!it) return; var def = G.items[it.name]; if (!def || !def.compound || eq[it.name]) return;
        groups[it.name] = groups[it.name] || {}; var l = it.level || 0; groups[it.name][l] = (groups[it.name][l] || 0) + 1;
    });
    var todo = Object.keys(groups).filter(function (n) { for (var l in groups[n]) if (l < COMPOUND_SPARE_MAX && groups[n][l] >= 3) return true; return false; });
    if (!todo.length) { game_log("Ungetragener Schmuck: keine Dreiergruppen unter +" + COMPOUND_SPARE_MAX); return; }
    game_log("Ungetragenen Schmuck compounden: " + todo.join(", "));
    await smart_move("compound");
    for (var t = 0; t < todo.length; t++) {
        var name = todo[t];
        for (var l = 0; l < COMPOUND_SPARE_MAX; l++) {
            while (spendable() > 0) {
                check_pause();
                var idx = find_inv_indices(name, l);
                if (idx.length < 3) break;
                var scroll = "cscroll" + item_grade(character.items[idx[0]]);
                if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
                var sc = locate_item(scroll);
                if (sc < 0) { game_log("keine " + scroll); break; }
                set_message(name + " +" + l + " x3");
                try { await compound(idx[0], idx[1], idx[2], sc); } catch (e) {}
                await wait_queue("compound");
                if (find_inv_indices(name, l).length == idx.length - 3 && find_inv_index(name, l + 1) >= 0) game_log(name + " +" + (l + 1) + " erstellt");
                else game_log(name + " compound (+" + l + ") fehlgeschlagen");
            }
        }
    }
}

// ---------- Upgrade + Attribut + Compound ----------
// Ein Inventar-Item (name, level) schrittweise bis target upgraden. Rückgabe: {level, destroyed}
async function upgrade_inv(name, level, target) {
    while (level < target) {
        check_pause();
        var idx = find_inv_index(name, level);
        if (idx < 0) return { level: level, destroyed: true };
        var scroll = "scroll" + item_grade(character.items[idx]);
        if (spendable() < G.items[scroll].g) { game_log("Reserve erreicht – Upgrade gestoppt"); return { level: level, destroyed: false, stopped: true }; }
        if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
        var sidx = locate_item(scroll);
        if (sidx < 0) { game_log("keine " + scroll); return { level: level, destroyed: false, stopped: true }; }
        var n_same = find_inv_indices(name, level).length, n_next = find_inv_indices(name, level + 1).length;
        set_message(name + " +" + level + " -> +" + (level + 1));
        try { await upgrade(idx, sidx); } catch (e) {}
        await wait_queue("upgrade");
        var m_same = find_inv_indices(name, level).length, m_next = find_inv_indices(name, level + 1).length;
        if (m_next > n_next) { level++; game_log(name + " ist jetzt +" + level); }
        else if (m_same == n_same) game_log(name + " Upgrade fehlgeschlagen, Item erhalten");
        else { game_log("!!! " + name + " +" + level + " ZERSTÖRT !!!"); return { level: level, destroyed: true }; }
    }
    return { level: level, destroyed: false };
}
function backup_index(name) { // beste Inventar-Kopie >= BACKUP_LEVEL
    var best = -1, bl = -1;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) >= BACKUP_LEVEL && (it.level || 0) > bl) { best = i; bl = it.level || 0; } }
    return best;
}
async function ensure_backup(name) { // Reservekopie auf +BACKUP_LEVEL herstellen
    for (var tries = 0; tries < 3; tries++) {
        if (backup_index(name) >= 0) return true;
        var base = find_inv_index(name, 0);
        if (base < 0) { if (!await buy_items(name, 1)) return false; await smart_move("upgrade"); }
        var r = await upgrade_inv(name, 0, BACKUP_LEVEL);
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
async function fetch_backups_from_bank() {
    var need = equipped_slots("upgrade").map(function (sl) { return character.slots[sl].name; })
        .filter(function (n, i, a) { return a.indexOf(n) == i && is_buyable(n) && backup_index(n) < 0; });
    var empty_slots = Object.keys(SLOT_TYPES).filter(function (sl) { return sl != "mainhand" && !character.slots[sl]; });
    if (!need.length && !empty_slots.length) return;
    set_message("Bank: Reserven"); await smart_move("bank"); await sleep(800);
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
async function process_slot(slot, manual) {
    try { await process_slot_inner(slot, manual); }
    finally { try { await reequip_slot(slot); } catch (e) {} }
}
async function process_slot_inner(slot, manual) {
    var item = character.slots[slot]; if (!item) return;
    var name = item.name, buyable = is_buyable(name), goal = target_level(name, manual);
    var rebuys = 0;
    while (rebuys <= MAX_REBUYS) {
        check_pause();
        // Nichts angelegt? -> Reserve anlegen, ggf. vorher neu bauen
        if (!character.slots[slot]) {
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
        if (buyable && backup_index(name) < 0) { if (!await ensure_backup(name)) { game_log(name + ": keine Reserve möglich – kein Risiko-Upgrade"); break; } }
        if (lvl >= goal) break;
        unequip(slot); await sleep(600);
        var r = await upgrade_inv(name, lvl, goal);
        if (r.destroyed) { rebuys++; continue; } // Schleifenanfang legt Reserve an / baut neu
        var best = -1, bl = -1;
        for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) > bl) { best = i; bl = it.level || 0; } }
        if (best >= 0) { equip(best, slot); await sleep(600); }
        if (r.stopped) break;
        if (r.level >= goal) { if (buyable && backup_index(name) < 0) await ensure_backup(name); break; }
    }
}

// manual=false: sichere Upgrades (U) | manual=true: alles bis +5 (K)
async function upgrade_routine(manual) {
    if (upgrading) { game_log("Upgrade läuft bereits"); return; }
    if (busy) { pending_upgrade = manual ? "K" : "U"; unpause("Upgrade vorgemerkt"); game_log("Upgrade vorgemerkt – startet, sobald er frei ist"); return; }
    pending_upgrade = null;
    if (!has_weapon()) { game_log("Keine Waffe – kein Upgrade"); return; }
    unpause("Upgrade");

    var stat_scroll = STAT_TYPE + "scroll", stat_price = G.items[stat_scroll].g;
    var empty = Object.keys(FILL_SLOTS).filter(function (s) { return !character.slots[s]; }).length;
    var up_slots = slots_to_upgrade(manual);
    var stat_slots = spendable() >= stat_price ? slots_without_stat() : [];
    var comp_slots = slots_to_compound();
    var gear = Object.keys(SLOT_TYPES).some(function (sl) { var c = best_buyable_for(sl), cur = character.slots[sl]; return c && (!cur || (c != cur.name && gear_score(G.items[c]) >= item_score(cur) * GEAR_MIN_GAIN)); });
    var spares = (function () { var eq = equipped_names(), g = {}; character.items.forEach(function (it) { if (it && G.items[it.name] && G.items[it.name].compound && !eq[it.name] && (it.level || 0) < COMPOUND_SPARE_MAX) { var k = it.name + "|" + (it.level || 0); g[k] = (g[k] || 0) + 1; } }); return Object.keys(g).some(function (k) { return g[k] >= 3; }); })();
    if (!empty && !gear && !spares && !up_slots.length && !stat_slots.length && !comp_slots.length) { game_log("Nichts zu tun (oder zu wenig freies Gold: " + spendable() + ")"); return; }
    if (character.esize < 2) { game_log("Upgrade: Inventar zu voll"); return; }

    upgrading = true; busy = true; set_message("Upgrade");
    game_log((manual ? "ALLE Upgrades (Risiko)" : "Sichere Upgrades") + ": " + empty + " leere Slots, " + up_slots.length + " Upgrades, " + stat_slots.length + " Attribut, " + comp_slots.length + " Compound (frei: " + spendable() + " Gold)");

    try {
        // 0. Schmuck zuerst (billig): getragen + ungetragen
        comp_slots = slots_to_compound();
        for (var c0 = 0; c0 < comp_slots.length; c0++) { check_pause(); await compound_slot(comp_slots[c0]); }
        await compound_spares();
        if (empty) await fill_empty_slots();
        await buy_better_gear();
        await check_ponty(true);
        await check_market(true);
        up_slots = slots_to_upgrade(manual);

        await fetch_backups_from_bank();
        up_slots = slots_to_upgrade(manual);
        if (up_slots.length) {
            await smart_move("upgrade");
            for (var k = 0; k < up_slots.length; k++) { check_pause(); await process_slot(up_slots[k], manual); await smart_move("upgrade"); }
        }

        stat_slots = spendable() >= stat_price ? slots_without_stat() : [];
        if (stat_slots.length) {
            await smart_move("scrolls");
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
        else game_log("Routine-Fehler: " + e);
    }

    game_log("Routine beendet (Gold: " + character.gold + ")");
    upgrading = false; busy = false;
    if (!paused) go_to_farm_spot();
}

// ---------- Hauptschleife ----------
function start_main() {
  if (main_timer) clearInterval(main_timer);
  main_timer = parent.__lp_main_timer = setInterval(function () {
    heal_logic(); loot();
    if (character.rip) { if (meas) finish_measure(true); respawn(); busy = false; fleeing = false; kissing = false; return; }
    session_tick();
    if (Date.now() - last_panel > 2000) { last_panel = Date.now(); try { update_panel(); } catch (e) {} }
    if (paused) return;
    measure_tick();

    if (pending_upgrade && !busy && !upgrading) { var pu = pending_upgrade; pending_upgrade = null; upgrade_routine(pu == "K"); }
    run_goal(); check_weapon(); check_gear_slots(); check_flee(); check_elixir(); kiss_routine(); tidy_inventory(); check_potions(); check_stuck(); check_ponty(false); check_market(false);
    if (busy || is_moving(character)) return;

    var farm = pick_farm_monster();
    var target = get_targeted_monster();

    if (target && !is_valid_target(target)) {
        game_log("Ziel " + target.mtype + " ignoriert (zu stark)");
        change_target(null);
        target = null;
    }

    if (!target) {
        var aggro = attackers_on_me();
        if (aggro < MAX_AGGRO) target = get_nearest_monster({ type: farm, no_target: true });
        if (!target) { // sonst nur Monster, die niemand anderen anvisieren (kein Kill-Klau); bei viel Aggro nur eigene Angreifer
            var best_d = 1e9;
            for (var mid in parent.entities) {
                var m = parent.entities[mid];
                if (!m || m.type != "monster" || m.dead || m.mtype != farm) continue;
                if (m.target && m.target != character.name) continue;
                if (aggro >= MAX_AGGRO && m.target != character.name) continue;
                var d = distance(character, m); if (d < best_d) { best_d = d; target = m; }
            }
        }
        if (!target) { // Angreifer nur erledigen, wenn sie nah sind; sonst weiter zum Spot
            for (var id in parent.entities) { var e = parent.entities[id]; if (is_valid_target(e) && e.target == character.name && distance(character, e) < 120) { target = e; break; } }
        }
        if (target) change_target(target); else { go_to_farm_spot(); return; }
    }

    if (!is_in_range(target)) move(character.x + (target.x - character.x) / 2, character.y + (target.y - character.y) / 2);
    else if (can_attack(target)) {
        if (!try_cburst()) { status_message(); attack(target); }
    }
  }, 1000 / 4);
}
start_main();
