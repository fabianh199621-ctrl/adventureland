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

var BOT_VERSION = "v151";
if (character.ctype != "mage") { // Händler/Priester haben versehentlich das Magier-Skript bekommen (alter Loader): passendes Skript nachladen
    (function () {
        var role = character.ctype == "merchant" || /merch/i.test(character.name) ? "merchant" : "priest";
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
var CANDIDATES = ["goo", "crab", "bee", "croc", "armadillo", "squig", "squigtoad", "poisio",
                  "tortoise", "frog", "rat", "minimush", "snake", "osnake", "scorpion", "spider",
                  "arcticbee", "boar", "crabx", "bat", "cgoo"];
var EXCLUDE = { iceroamer: true };   // gezielt ausgeschlossen (Einfrieren)
var hidden_mons = {}; try { hidden_mons = JSON.parse(localStorage.getItem("lp_hidden") || "{}"); } catch (e) {}
var only_worth = false; try { only_worth = localStorage.getItem("lp_only_worth") == "1"; } catch (e) {}
var bycatch = true; try { bycatch = localStorage.getItem("lp_bycatch") != "0"; } catch (e) {}
var focus_mode = false; try { focus_mode = localStorage.getItem("lp_focus") == "1"; } catch (e) {} // Fokus: nur farmen/hunten, keine Nebenroutinen
var FOCUS_MIN_FREE = 3, FOCUS_TARGET_FREE = 20, FOCUS_POT_MIN = 50;
var BYCATCH_RANGE = 250;             // Beifang: andere sichere Monster in dieser Entfernung angreifen
var hunt_on = true; try { hunt_on = localStorage.getItem("lp_hunt") != "0"; } catch (e) {}
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
async function preempt(why, action) {
    if (busy || routine_running()) {
        game_log("Breche laufende Aktion ab (" + why + ")");
        abort_requested = true; stop("smart"); stop("move");
        var t0 = Date.now();
        while ((busy || routine_running()) && Date.now() - t0 < 6000) await new Promise(function (r) { setTimeout(r, 150); });
        abort_requested = false;
        if (busy || routine_running()) clear_flags();
        await new Promise(function (r) { setTimeout(r, 400); });
    }
    if (paused) unpause(why);
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
function too_strong(m) {
    var base = G.monsters[m.mtype]; if (!base) return true;
    var d = Object.assign({}, base);
    if (m.max_hp) d.hp = m.max_hp;
    if (m.attack) d.attack = m.attack;
    if (m.frequency) d.frequency = m.frequency;
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
var leveled_since = 0;
function all_leveled_check(farm, seen, valid) {
    if (!seen || valid) { leveled_since = 0; return; }
    if (!leveled_since) { leveled_since = Date.now(); return; }
    if (Date.now() - leveled_since < LEVELED_WAIT_MS) return;
    leveled_since = 0;
    if (hunt_spot == farm) { game_log("Alle " + farm + " gelevelt – Jagd wird aufgegeben"); hunt_abandon(); return; }
    blocked_spots[farm] = Date.now() + LEVELED_BLOCK_MS;
    game_log("Alle " + farm + " gelevelt – Spot 30 min " + (manual_spot == farm ? "ausgesetzt, solange wählt die Automatik" : "gesperrt"));
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
    if (m.mtype == pick_farm_monster()) return m.target == character.name || !too_strong(m); // Angreifer wehren wir ab, sonst nur ungelevelte/sichere Exemplare
    if (m.max_hp > character.max_hp * MAX_TARGET_HP_FACTOR) return false;
    if (bycatch && is_safe_monster(m.mtype) && !hidden_mons[m.mtype] && (!m.target || m.target == character.name)) return true;
    return m.target == character.name;
}


// ---------- Team: Händler und Priester (laufen unsichtbar im selben Fenster, gestartet vom Magier) ----------
var TEAM = { merch: "F4llenMerch", priest: "F4llenPriest" };
var TEAM_NAMES = [TEAM.merch, TEAM.priest];
var team_on = { merch: true, priest: true }; try { var to = JSON.parse(localStorage.getItem("lp_team") || "null"); if (to) team_on = to; } catch (e) {}
function save_team() { try { localStorage.setItem("lp_team", JSON.stringify(team_on)); } catch (e) {} }
var team_state = {}; // letzte Statusmeldung je Charakter { level, state, t, ... }
var last_team_tick = 0, last_team_cast = 0, last_party_try = 0, team_start_at = {};
function team_slot() { try { if (typeof LP_CODE_SLOT != "undefined" && LP_CODE_SLOT) return LP_CODE_SLOT; } catch (e) {} try { return parent.LP_CODE_SLOT || 1; } catch (e) { return 1; } }
function active_chars() { try { return (typeof get_active_characters == "function" ? get_active_characters() : parent.get_active_characters()) || {}; } catch (e) { return {}; } }
function team_running(name) { var a = active_chars(); return !!a[name]; }
function team_tick() { // fehlende Teammitglieder starten, abgeschaltete stoppen; Party pflegen
    if (Date.now() - last_team_tick < 20000) return; last_team_tick = Date.now();
    try { if (parent.__lp_team_restart_after && Date.now() < parent.__lp_team_restart_after) return; } catch (e) {}
    var act = active_chars();
    for (var k in TEAM) {
        var nm = TEAM[k], on = !!team_on[k], running = !!act[nm];
        if (on && !running) { if (Date.now() - (team_start_at[nm] || 0) > 60000) { team_start_at[nm] = Date.now(); try { var res = start_character(nm, team_slot()); game_log("Team: starte " + nm + " (Code-Slot " + team_slot() + ") – aktiv: " + JSON.stringify(act)); if (res && typeof res.then == "function") (function (who) { res.then(function (r) { game_log("Team: " + who + " Start-Antwort: " + JSON.stringify(r).slice(0, 120)); }, function (e) { game_log("Team: " + who + " Start abgelehnt: " + JSON.stringify(e).slice(0, 160)); }); })(nm); } catch (e) { game_log("Team: " + nm + " konnte nicht gestartet werden – " + err_txt(e)); } } }
        else if (!on && running) { try { stop_character(nm); game_log("Team: " + nm + " gestoppt"); } catch (e) {} }
    }
    // Party: Priester einladen, wenn er läuft und nicht dabei ist
    if (team_on.priest && act[TEAM.priest] && Date.now() - last_party_try > 60000) { var inparty = character.party && parent.party && parent.party[TEAM.priest]; if (!inparty) { last_party_try = Date.now(); try { send_party_invite(TEAM.priest); } catch (e) {} } }
}
var team_inject_t = {};
function team_windows() { // Fenster der mitgestarteten Charaktere finden (gleiche Herkunft, daher zugreifbar)
    var out = {};
    try { var fr = parent.document.querySelectorAll("iframe"); for (var i = 0; i < fr.length; i++) { try { var cw = fr[i].contentWindow; var nm = cw && cw.character && cw.character.name; if (nm && TEAM_NAMES.indexOf(nm) >= 0) { var ci = cw.document && cw.document.querySelector("iframe"); out[nm] = { win: cw, code: ci && ci.contentWindow }; } } catch (e) {} } } catch (e) {}
    return out;
}
function team_inject() { // läuft im Fenster des Teammitglieds nicht unser Skript (falscher Code-Slot), spielen wir es direkt ein
    var wins = team_windows();
    for (var k in TEAM) {
        var nm = TEAM[k], w = wins[nm]; if (!w || !team_on[k]) continue;
        if (Date.now() - (team_inject_t[nm] || 0) < 45000) continue;
        var cw = w.code, have = null;
        try { have = cw && (cw.MERCH_VERSION || cw.PRIEST_VERSION); } catch (e) {}
        if (have == BOT_VERSION) continue;
        team_inject_t[nm] = Date.now();
        if (!cw) { // das Spiel hat für den Charakter noch keinen Code-Frame angelegt: Code-Start anstoßen (läuft dessen eigenen, meist leeren Slot), danach spielen wir unser Skript ein
            try { if (typeof w.win.start_runner == "function") { w.win.start_runner(); game_log("Team: " + nm + " – Code-Start angestoßen"); } else game_log("Team: " + nm + " – kein Code-Frame und kein start_runner"); } catch (e) { game_log("Team: " + nm + " start_runner: " + err_txt(e)); }
            continue;
        }
        var role = k == "merch" ? "merchant" : "priest";
        game_log("Team: " + nm + " – spiele " + role + "_" + BOT_VERSION + ".js ein" + (have ? " (bisher " + have + ")" : ""));
        (function (nm, cw, role) {
            fetch(BOT_BASE + role + "_" + BOT_VERSION + ".js", { cache: "no-store" }).then(function (r) { return r.text(); }).then(function (code) { try { cw.eval(code); game_log("Team: " + nm + " – Skript eingespielt"); } catch (e) { game_log("Team: " + nm + " – Einspielen fehlgeschlagen: " + err_txt(e)); } }).catch(function (e) { game_log("Team: " + nm + " – Laden fehlgeschlagen: " + e); });
        })(nm, cw, role);
    }
}
var team_log_seen = {};
function team_read_logs() { // Händler/Priester schreiben ihr Log in den gemeinsamen Speicher (localStorage), der Magier zeigt es an
    for (var k in TEAM) { var nm = TEAM[k]; try { if (!team_log_seen[nm]) { team_log_seen[nm] = Date.now() - 3000; continue; } var arr = JSON.parse(localStorage.getItem("lp_tlog_" + nm) || "[]"); var seen = team_log_seen[nm]; for (var i = 0; i < arr.length; i++) { var ln = arr[i]; if (ln.t > seen) { team_log_seen[nm] = ln.t; game_log("[" + (k == "merch" ? "Merch" : "Priest") + "] " + ln.m); } } } catch (e) {} }
}
var cm_selftest = 0;
function team_broadcast() { // alle 5 s: wo bin ich, was mache ich (für Händler und Priester)
    if (Date.now() - last_team_cast < 5000) return; last_team_cast = Date.now();
    var act = active_chars(), ml = character.s && character.s.mluck;
    var msg = { t: "me", map: character.map, x: Math.round(character.x), y: Math.round(character.y), level: character.level, hp: character.hp, max_hp: character.max_hp, paused: paused || !bot_running, spot: current_spot, tgt: last_target_id, mluck: ml ? { f: ml.f, ms: ml.ms, strong: !!ml.strong } : null, in: character.in };
    for (var k in TEAM) { var nm = TEAM[k]; if (team_on[k] && act[nm]) { try { send_cm(nm, msg); } catch (e) {} } }
}
function team_send(name, data) { try { send_cm(name, data); } catch (e) {} }
function on_cm(name, data) { // Nachrichten der eigenen Charaktere
    if (name == character.name && data && data.t == "ping") { cm_selftest = 2; game_log("Team: Nachrichtenkanal funktioniert (Selbsttest)"); return; }
    if (TEAM_NAMES.indexOf(name) < 0 || !data || typeof data != "object") return;
    var who = name == TEAM.merch ? "Merch" : "Priest";
    try {
        if (data.t == "log") { /* kommt bereits über den gemeinsamen Speicher */ }
        else if (data.t == "st") { team_state[name] = Object.assign({ t: Date.now() }, data); last_panel = 0; }
        else if (data.t == "hello") { game_log("[" + who + "] verbunden (" + (data.v || "?") + ")"); team_send(name, { t: "state", paused: paused || !bot_running, spot: current_spot }); team_broadcast(); }
        else if (data.t == "gold?") { var p = get_player(name); var amt = Math.min(data.amount || 100000, Math.max(0, character.gold - WISH_RESERVE)); if (p && distance(character, p) < 400 && amt >= 1000) { send_gold(name, amt); game_log("[" + who + "] " + fmt(amt) + " Gold übergeben"); } else team_send(name, { t: "nogold", near: !!(p && distance(character, p) < 400) }); }
        else if (data.t == "pots?") { var pp = get_player(name); if (pp && distance(character, pp) < 400) { var gave = 0; [POTS_HP, POTS_MP].forEach(function (list) { var idx = -1, q = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && list.indexOf(it.name) >= 0 && (it.q || 0) > q) { idx = i; q = it.q; } } if (idx >= 0 && q >= 60) { send_item(name, idx, 25); gave++; } }); if (gave) game_log("[" + who + "] Tränke übergeben"); } }
    } catch (e) { game_log("Team-Nachricht: " + err_txt(e)); }
}
try { window.on_cm = on_cm; parent.window.__lp_on_cm = on_cm; } catch (e) {} // Hook global machen (eval-Scope ist nicht global)
setTimeout(function () { try { cm_selftest = 1; send_cm(character.name, { t: "ping" }); setTimeout(function () { if (cm_selftest != 2) game_log("Team: Selbsttest – keine Nachricht angekommen (on_cm greift nicht)"); }, 5000); } catch (e) { game_log("Team: send_cm-Fehler " + err_txt(e)); } }, 3000);
function team_html() {
    var parts = [];
    for (var k in TEAM) { var nm = TEAM[k], st = team_state[nm], run = team_running(nm), lab = k == "merch" ? "Merch" : "Priest"; var raw = active_chars()[nm]; parts.push("<span style='color:" + (team_on[k] ? (run ? "#4caf50" : "#ffb74d") : "#9aa3b2") + "'>" + lab + (st && Date.now() - st.t < 60000 ? " Lv " + st.level + " · " + esc(st.state || "") : run ? " (" + esc(String(raw)) + ", keine Meldung)" : team_on[k] ? " (aus/offline)" : "") + "</span> <button data-act='team' data-k='" + k + "'" + (team_on[k] ? " class='on'" : "") + " style='padding:0 5px'>" + (team_on[k] ? "an" : "aus") + "</button>"); }
    return "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'><span class='lp_k'>Team:</span> " + parts.join(" · ") + "</div>";
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
    try { out.chance_keys = Object.keys(parent).filter(function (k) { return /chance|probab|upgrade|compound|grade/i.test(k); }).map(function (k) { return k + ":" + typeof parent[k]; }); } catch (e) {}
    try { out.upgrade_fn = String(parent.upgrade || "").slice(0, 900); out.calc_grade = String(parent.calculate_item_grade || "").slice(0, 400); } catch (e) {}
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
            parent.__lp_resume = { paused: paused, t: Date.now(), timers: { last_ponty: last_ponty, last_market: last_market, shells_retry_at: shells_retry_at, hunt_cooldown_until: hunt_cooldown_until, cake_next: cake_next, last_hunt_check: last_hunt_check, last_global_scan: last_global_scan, last_auto_gear: last_auto_gear } }; // Zustand für die neue Version
            if (main_timer) clearInterval(main_timer); main_timer = null; parent.__lp_main_timer = null;
            stop("smart"); stop("move");
            try { var ac = active_chars(); TEAM_NAMES.forEach(function (nm) { if (ac[nm]) { try { stop_character(nm); } catch (e) {} } }); parent.__lp_team_restart_after = Date.now() + 15000; } catch (e) {} // Team lädt danach ebenfalls die neue Version (Neustart erst nach dem Abmelden)
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
function team_escort() { // mitlaufender, noch schwacher Priester?
    if (!team_on.priest) return null; var st = team_state[TEAM.priest];
    if (!st || Date.now() - st.t > 120000 || !team_running(TEAM.priest)) return null;
    return st.level < TEAM_ESCORT_LEVEL ? st : null;
}
function team_safe(mon) { // Spot für den Priester tragbar: Monsterlevel nahe seinem Level, Angriff klein gegen seine HP
    var esc = team_escort(); if (!esc) return true;
    var d = G.monsters[mon]; if (!d) return true;
    var php = esc.max_hp || (60 + esc.level * 30);
    return (d.level || 1) <= esc.level + 3 && d.attack * 4 <= php;
}
var team_safe_warned = 0;
function candidate_list() {
    var list = visible_mons().filter(function (m) {
        if (spot_blocked(m)) return false;
        if (!team_safe(m)) return false;
        var st = farm_stats[m];
        if (st && st.unsafe_until && character.level < st.unsafe_until) return false;
        return true;
    });
    list.sort(function (a, b) { return estimate(b) - estimate(a); });
    return list.slice(0, MEASURE_TOP);
}
function choose_spot() {
    var cands = candidate_list();
    if (!cands.length) return team_escort() ? "bee" : "goo";
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
    if (manual_spot && !spot_blocked(manual_spot)) { if (current_spot != manual_spot) { current_spot = manual_spot; need_repick = false; meas = null; save_state(); } if (!team_safe(manual_spot) && Date.now() - team_safe_warned > 600000) { team_safe_warned = Date.now(); game_log("Achtung: Spot " + manual_spot + " ist für den Priester (Lv " + team_escort().level + ") zu gefährlich – fester Spot bleibt, aber er wird dort sterben"); } return current_spot; }
    if (current_spot && !team_safe(current_spot)) { if (Date.now() - team_safe_warned > 600000) { team_safe_warned = Date.now(); game_log("Spot " + current_spot + " für den Priester (Lv " + team_escort().level + ") zu gefährlich – wähle einen leichteren, bis er Lv " + TEAM_ESCORT_LEVEL + " ist"); } need_repick = true; }
    if (!current_spot || need_repick) { current_spot = choose_spot(); need_repick = false; save_state(); }
    return current_spot;
}
// Buttons: fester Spot / Automatik / neu messen
function set_manual_spot(mon) {
    manual_spot = mon; meas = null; Object.keys(blocked_spots).forEach(function (k) { if (blocked_spots[k] === true) delete blocked_spots[k]; }); need_repick = true; current_spot = mon;
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
    if (paused || Date.now() - last_go < 5000) return;
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
    travel(mon)
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
        game_log("Heiltrank " + hpot.name + " (HP " + Math.round(hp * 100) + "%)"); equip(hpot.idx); day_count("pots");
    } else if (mp < 0.3 && mpot && missing_mp >= mpot.gives * 0.8) {
        game_log("Manatrank " + mpot.name + " (MP " + Math.round(mp * 100) + "%)"); equip(mpot.idx); day_count("pots");
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
    st.textContent = "#lp_panel{position:fixed;left:10px;top:130px;z-index:2147483000;pointer-events:auto;width:470px;background:#14161c;color:#e6e6e6;font:12px/1.4 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b;touch-action:none}"
      + "#lp_head b{flex:1;font-size:13px;letter-spacing:.3px}#lp_head .lp_state{font-size:11px;padding:1px 7px;border-radius:10px;background:#2e7d32}"
      + "#lp_head .lp_state.pause{background:#c62828}#lp_head .lp_state.busy{background:#ef6c00}"
      + "#lp_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_body{padding:8px 10px;max-height:calc(100vh - 200px);overflow-y:auto;overscroll-behavior:contain}"
      + ".lp_grid{display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:6px}.lp_grid div{white-space:nowrap}.lp_k{color:#9aa3b2}"
      + ".lp_bar{display:inline-block;width:80px;height:8px;background:#2a2e38;border-radius:4px;vertical-align:middle;margin-left:6px;overflow:hidden}.lp_bar i{display:block;height:100%}"
      + ".lp_spot{background:#1c2029;border:1px solid #2f3440;border-radius:4px;padding:6px 8px;margin:4px 0 6px}.lp_spot .lp_big{font-size:15px;font-weight:600}"
      + ".lp_row{display:flex;gap:6px;align-items:center;margin:4px 0}.lp_row .lp_mode{color:#8ab4f8;flex:1}"
      + "#lp_body button{font:11px 'Segoe UI',Arial;padding:1px 7px;cursor:pointer;background:#2f3440;color:#eee;border:1px solid #555;border-radius:3px}#lp_body button:hover{background:#3d4453}#lp_body button.on{background:#2e7d32;border-color:#4caf50}"
      + "table.lp_t{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:4px}table.lp_t th{color:#9aa3b2;font-weight:normal;text-align:right;padding:2px 4px;border-bottom:1px solid #3a3f4b;cursor:pointer}table.lp_t th:hover{color:#fff}table.lp_t th.sorted{color:#8ab4f8}table.lp_t th:first-child,table.lp_t td:first-child{text-align:left}"
      + "table.lp_t td{padding:2px 4px;text-align:right;white-space:nowrap}table.lp_t td[title]{cursor:help;text-decoration:underline dotted #666}table.lp_t tr:nth-child(even) td{background:#181b22}table.lp_t tr.cur td{background:#20302a;color:#c8f0d0}table.lp_t td.old{color:#8a8f99}"
      + "table.lp_wish td{white-space:normal;word-break:break-word;overflow-wrap:anywhere;overflow:hidden;vertical-align:top;line-height:1.3}table.lp_wish th{white-space:normal;vertical-align:bottom}table.lp_wish select{max-width:100%;box-sizing:border-box}";
    doc.head.appendChild(st);

    var div = doc.createElement("div"); div.id = "lp_panel";
    div.innerHTML = "<div id='lp_head'><b>LogicPlan " + BOT_VERSION + "</b><span class='lp_state' id='lp_state'>läuft</span><button data-act='chartoggle' title='Charakter & Inventar'>Char</button><button data-act='wikitoggle' title='Items, Monster, NPCs nachschlagen'>Wiki</button><button id='lp_toggle' title='Monster-Tabelle ein-/ausklappen'>▾</button><button id='lp_mini' title='Fenster verkleinern/vergrößern'>▭</button></div><div id='lp_body'></div>";
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
    var inside = function (e) { var c = parent.document.getElementById("lp_char"), w = parent.document.getElementById("lp_wiki"); return e.target && (div.contains(e.target) || (c && c.contains(e.target)) || (w && w.contains(e.target))); };
    var onDown = function (e) {
        if (!inside(e)) return;
        if (e.target.tagName == "BUTTON") { e.stopPropagation(); return; }
        var c = parent.document.getElementById("lp_char"), ch = c && c.querySelector("#lp_char_head");
        if (head.contains(e.target)) { drag = { el: div, key: "lp_panel_pos", dx: e.clientX - div.offsetLeft, dy: e.clientY - div.offsetTop }; e.preventDefault(); }
        else if (ch && ch.contains(e.target)) { drag = { el: c, key: "lp_char_pos", dx: e.clientX - c.offsetLeft, dy: e.clientY - c.offsetTop }; e.preventDefault(); }
        else { var w = parent.document.getElementById("lp_wiki"), wh = w && w.querySelector("#lp_wiki_head"); if (wh && wh.contains(e.target)) { drag = { el: w, key: "lp_wiki_pos", dx: e.clientX - w.offsetLeft, dy: e.clientY - w.offsetTop }; e.preventDefault(); } }
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
        if (b.tagName != "BUTTON") return;
        if (b.id == "lp_toggle") { div.__collapsed = !div.__collapsed; try { localStorage.setItem("lp_panel_collapsed", div.__collapsed ? "1" : "0"); } catch (x) {} last_panel = 0; return; }
        if (b.id == "lp_mini") { div.__mini = !div.__mini; try { localStorage.setItem("lp_panel_mini", div.__mini ? "1" : "0"); } catch (x) {} last_panel = 0; return; }
        var act = b.getAttribute("data-act"), mon = b.getAttribute("data-mon");
        if (act == "farm") { user_manual = mon; preempt("Farmen " + mon, function () { set_manual_spot(mon); }); } else if (act == "auto") preempt("Automatik", set_auto_spot); else if (act == "reset") reset_measurements();
        else if (act == "hide") hide_mon(mon, true); else if (act == "show") hide_mon(mon, false);
        else if (act == "worth") { only_worth = !only_worth; save_hidden(); }
        else if (act == "trip") { var tl = server_tip(), tf = tl[parseInt(b.getAttribute("data-idx"))]; if (tf) preempt("Serverwechsel", function () { start_trip(tf); }); }
        else if (act == "autotrip") { auto_trip = !auto_trip; try { localStorage.setItem("lp_auto_trip", auto_trip ? "1" : "0"); } catch (x) {} game_log("Serverkäufe automatisch: " + (auto_trip ? "an" : "aus")); last_panel = 0; }
        else if (act == "buyalt") { var bs = b.getAttribute("data-slot"), bi = b.getAttribute("data-item"); preempt("Zwischenlösung " + bi, function () { return buy_alternative(bs, bi); }); }
        else if (act == "farmwish") { var fm = b.getAttribute("data-mon"); user_manual = fm; preempt("Farmen " + fm, function () { set_manual_spot(fm); }); }
        else if (act == "wishreset") reset_wish_to_worn();
        else if (act == "wishist") { var is_ = b.getAttribute("data-slot"), iw = character.slots[is_]; var keep = wish_cfg[is_] && wish_cfg[is_].max; wish_cfg[is_] = iw && G.items[iw.name] ? { item: iw.name, level: iw.level || 0 } : { item: "" }; if (keep) wish_cfg[is_].max = keep; save_wish_cfg(); game_log("Zielbau " + is_ + ": Ist-Stand übernommen (" + (iw ? iw.name + "+" + (iw.level || 0) : "leer") + ")"); }
        else if (act == "buyoffer") { var bo = offers_for_slot(b.getAttribute("data-slot"))[parseInt(b.getAttribute("data-idx"))]; if (bo) buy_confirm = { key: offer_key(bo), offer: bo, slot: b.getAttribute("data-slot"), t: Date.now() }; }
        else if (act == "buyno") buy_confirm = null;
        else if (act == "team") { var tk = b.getAttribute("data-k"); team_on[tk] = !team_on[tk]; save_team(); last_team_tick = 0; game_log("Team: " + TEAM[tk] + " " + (team_on[tk] ? "an" : "aus")); }
        else if (act == "arbtoggle") { div.__arb = !div.__arb; try { localStorage.setItem("lp_panel_arb", div.__arb ? "1" : "0"); } catch (x) {} }
        else if (act == "buyok") { if (buy_confirm) { var bc = buy_confirm; buy_confirm = null; preempt("Kauf " + bc.offer.name, function () { return buy_offer_now(bc.slot, bc.offer); }); } }
        else if (act == "wishtoggle") { div.__wish = !div.__wish; try { localStorage.setItem("lp_panel_wish", div.__wish ? "1" : "0"); } catch (x) {} }
        else if (act == "pauseafter") { pause_after = !pause_after; try { localStorage.setItem("lp_pause_after", pause_after ? "1" : "0"); } catch (x) {} game_log("Nach manueller Aktion: " + (pause_after ? "pausieren" : "weiterfarmen")); last_panel = 0; }
        else if (act == "hunt") { hunt_on = !hunt_on; try { localStorage.setItem("lp_hunt", hunt_on ? "1" : "0"); } catch (x) {} game_log("Monster Hunt " + (hunt_on ? "an" : "aus")); }
        else if (act == "huntabandon") preempt("Jagd aufgeben", hunt_abandon);
        else if (act == "focus") { focus_mode = !focus_mode; try { localStorage.setItem("lp_focus", focus_mode ? "1" : "0"); } catch (x) {} tidy_next = 0; if (focus_mode && pending_upgrade == "auto") pending_upgrade = null; game_log("Fokus-Modus " + (focus_mode ? "an – nur farmen/hunten, Nebenroutinen aus" : "aus – alle Routinen wieder aktiv")); }
        else if (act == "bycatch") { bycatch = !bycatch; try { localStorage.setItem("lp_bycatch", bycatch ? "1" : "0"); } catch (x) {} game_log("Beifang " + (bycatch ? "an" : "aus")); }
        else if (act == "sortinv") preempt("Inventar sortieren", sort_inventory);
        else if (act == "compound") preempt("Compound", compound_only);
        else if (act == "tidy") preempt("Aufräumen", tidy_now);
        else if (act == "bank") preempt("Bank aufräumen", bank_cleanup_now);
        else if (act == "banksort") preempt("Bank sortieren", bank_sort_now);
        else if (act == "copylog") copy_log();
        else if (act == "goal") start_goal(b.getAttribute("data-slot"));
        else if (act == "focus") { var fs = b.getAttribute("data-slot"); preempt("Slot " + fs, function () { return focus_slot(fs); }); }
        else if (act == "goalstop") stop_goal("manuell");
        else if (act == "goalskip") { goal_skip[b.getAttribute("data-item")] = Date.now(); save_goal_skip(); goal_cache_t = 0; }
        else if (act == "chartoggle") toggle_char_panel();
        else if (act == "wikitoggle") toggle_wiki_panel();
        else if (act == "geartoggle") { div.__gear = !div.__gear; try { localStorage.setItem("lp_panel_gear", div.__gear ? "1" : "0"); } catch (x) {} }
        else if (act == "clearlog") { log_buf = []; try { localStorage.setItem("lp_log", "[]"); } catch (x) {} _game_log("Log-Puffer geleert"); }
        last_panel = 0;
    };
    if (parent.__lp_panel_h) { var H = parent.__lp_panel_h; ["pointerdown", "mousedown"].forEach(function (t) { win.removeEventListener(t, H.down, true); }); ["pointermove", "mousemove"].forEach(function (t) { win.removeEventListener(t, H.move, true); }); ["pointerup", "mouseup"].forEach(function (t) { win.removeEventListener(t, H.up, true); }); win.removeEventListener("click", H.click, true); if (H.change) win.removeEventListener("change", H.change, true); if (H.input) win.removeEventListener("input", H.input, true); if (H.key) ["keydown", "keyup", "keypress"].forEach(function (t) { win.removeEventListener(t, H.key, true); }); }
    ["pointerdown", "mousedown"].forEach(function (t) { win.addEventListener(t, onDown, true); });
    ["pointermove", "mousemove"].forEach(function (t) { win.addEventListener(t, onMove, true); });
    ["pointerup", "mouseup"].forEach(function (t) { win.addEventListener(t, onUp, true); });
    win.addEventListener("click", onClick, true);
    var onChange = function (e) {
        if (!inside(e)) return;
        var t = e.target; if (!t || (t.tagName != "SELECT" && t.tagName != "INPUT")) return;
        var ws = t.getAttribute("data-wslot"), wl = t.getAttribute("data-wlvl"), wm = t.getAttribute("data-wmax");
        if (t.getAttribute("data-huntmax")) { var hv = parseFloat(String(t.value).replace(",", ".")); if (isFinite(hv) && hv > 0 && hv <= 100) { hunt_max_danger = hv / 100; try { localStorage.setItem("lp_hunt_max_danger", String(hunt_max_danger)); } catch (x) {} game_log("Jagd-Gefahrgrenze: " + Math.round(hv) + " %"); hunt_skipped = null; last_hunt_check = 0; } try { t.blur(); } catch (x) {} last_panel = 0; return; }
        if (wm) { var mv = parse_mio(t.value), cm = wish_cfg[wm] || { item: wish_item(wm) || "", level: wish_level(wm) }; if (mv > 0) cm.max = mv; else delete cm.max; wish_cfg[wm] = cm; save_wish_cfg(); game_log("Zielbau " + wm + ": Preislimit " + (mv > 0 ? fmt(mv) : "automatisch")); try { t.blur(); } catch (x) {} return; }
        if (ws) { var v = t.value, oldmax = wish_cfg[ws] && wish_cfg[ws].max; if (!v) wish_cfg[ws] = { item: "" }; else wish_cfg[ws] = { item: v, level: default_target_level(G.items[v]) }; if (oldmax) wish_cfg[ws].max = oldmax; save_wish_cfg(); game_log("Zielbau " + ws + ": " + (v ? v + " +" + wish_cfg[ws].level : "kein Ziel")); }
        else if (wl) { var c = wish_cfg[wl] || { item: wish_item(wl) }; c.level = parseInt(t.value); wish_cfg[wl] = c; save_wish_cfg(); game_log("Zielbau " + wl + ": " + c.item + " +" + c.level); }
    };
    win.addEventListener("change", onChange, true);
    var onInput = function (e) { var t = e.target; if (t && t.id == "lp_wiki_q") { wiki.q = t.value; wiki.page = null; render_wiki(); } };
    var onKeyCap = function (e) { var t = e.target; if (t && (t.id == "lp_wiki_q" || (t.tagName == "INPUT" && inside(e)))) { e.stopPropagation(); if (e.key == "Escape") t.blur(); if (e.key == "Enter" && (t.getAttribute("data-wmax") || t.getAttribute("data-huntmax")) && e.type == "keydown") { try { t.dispatchEvent(new Event("change", { bubbles: true })); } catch (x) {} } } }; // Tasten im Suchfeld nicht ans Spiel/Bot weitergeben
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
function init_char_panel() {
    var doc = parent.document, old = doc.getElementById("lp_char"); if (old) old.remove();
    var st = doc.getElementById("lp_char_style"); if (st) st.remove();
    st = doc.createElement("style"); st.id = "lp_char_style";
    st.textContent = "#lp_char{position:fixed;left:500px;top:130px;z-index:2147483000;pointer-events:auto;width:420px;background:#14161c;color:#e6e6e6;font:12px/1.35 'Segoe UI',Arial,sans-serif;border:1px solid #3a3f4b;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none;overflow:hidden}"
      + "#lp_char_head{display:flex;align-items:center;gap:8px;padding:6px 10px;background:linear-gradient(#2b3140,#1e222c);cursor:move;border-bottom:1px solid #3a3f4b}#lp_char_head b{flex:1;font-size:13px}"
      + "#lp_char_head button{font:11px 'Segoe UI',Arial;padding:0 6px;cursor:pointer;background:#3a3f4b;color:#eee;border:1px solid #555;border-radius:3px}"
      + "#lp_char_body{padding:8px 10px;max-height:calc(100vh - 200px);overflow-y:auto}"
      + ".lp_cols{display:flex;gap:10px}.lp_eq{display:grid;grid-template-columns:repeat(4,52px);gap:4px}.lp_stats{flex:1;font-size:11.5px}.lp_stats div{display:flex;justify-content:space-between;padding:1px 0;border-bottom:1px solid #22262f}.lp_stats .lp_k{color:#9aa3b2}"
      + ".lp_inv{display:grid;grid-template-columns:repeat(7,52px);gap:4px;margin-top:8px}"
      + ".lp_tile{position:relative;width:52px;height:44px;border:1px solid #444a58;border-radius:4px;box-sizing:border-box;padding:3px 4px;cursor:pointer;overflow:hidden}.lp_tile:hover{border-color:#8ab4f8}"
      + ".lp_tile.empty{background:#1a1d24;border-style:dashed;cursor:default}.lp_tile.eqempty{border-color:#7a3030}.lp_tile .nm{font-size:10.5px;display:block;white-space:nowrap}.lp_tile .lv{position:absolute;right:3px;bottom:2px;font-size:10px;color:#ffd54f}.lp_tile .q{position:absolute;left:4px;bottom:2px;font-size:10px;color:#9aa3b2}.lp_tile .sl{position:absolute;left:4px;bottom:2px;font-size:9px;color:#6b7280}"
      + ".lp_xp{height:8px;background:#2a2e38;border-radius:4px;overflow:hidden;margin:4px 0 6px}.lp_xp i{display:block;height:100%;background:#7e57c2}";
    doc.head.appendChild(st);
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
    var st_txt = !bot_running ? "AUS" : paused ? "PAUSE" : upgrading ? "Upgrade" : pending_upgrade ? "Upgrade wartet" : kissing ? "Kuss" : fleeing ? "Rückzug" : exchanging ? "Tausch" : pontying ? "Ponty" : marketing ? "Markt" : hunting ? "Daisy" : busy ? "unterwegs" : "farmt"; if (focus_mode && bot_running && !paused) st_txt += " (Fokus)";
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
          + "<div class='lp_row'><span class='lp_mode'>" + (manual_spot ? "fest (" + esc(manual_spot) + ")" : "automatisch") + "</span><button data-act='auto'" + (manual_spot ? "" : " class='on'") + ">Auto</button><button data-act='focus'" + (focus_mode ? " class='on'" : "") + ">Fokus</button><button data-act='tidy' title='Schrott verkaufen, Rest in die Bank'>Aufräumen</button><button data-act='pauseafter'" + (pause_after ? " class='on'" : "") + ">Danach: " + (pause_after ? "Pause" : "Farmen") + "</button><button data-act='copylog'>Log</button></div>";
        try { var ae0 = parent.document.activeElement; if (ae0 && ae0.tagName == "SELECT" && panel.contains(ae0)) return; } catch (e) {}
        try { if (panel.__w != 470) { panel.__w = 470; panel.style.width = "470px"; clamp_pos(panel, panel.offsetLeft, panel.offsetTop); } } catch (e) {}
        panel.querySelector("#lp_body").innerHTML = hm; return;
    }
    var h = "<div class='lp_grid'>"
      + "<div><span class='lp_k'>Level</span> " + character.level + "</div><div><span class='lp_k'>Gold</span> " + fmt(character.gold) + "</div>"
      + "<div style='grid-column:1/3'><span class='lp_k'>Heute</span> " + esc(day_text(day)) + "</div>"
      + (a && a.active ? "<div style='grid-column:1/3'><span class='lp_k'>Kuchen</span> " + (6 - missing_slices().length) + "/6 Stücke" + (missing_slices().length ? " (fehlt: " + esc(missing_slices().map(function (n) { return n.replace("slice_", ""); }).join(", ")) + ")" : quantity("sixcake") ? ", Sixfold Cake ×" + quantity("sixcake") : ", bereit zum Backen") + "</div>" : "")
      + "<div><span class='lp_k'>HP</span> " + hp + "%" + bar(hp, hp < 35 ? "#e53935" : "#43a047") + "</div><div><span class='lp_k'>MP</span> " + mp + "%" + bar(mp, "#1e88e5") + "</div>"
      + "<div><span class='lp_k'>Tränke</span> " + pots_total(POTS_HP) + " / " + pots_total(POTS_MP) + "</div><div><span class='lp_k'>Elixier</span> " + (character.slots.elixir ? "an" : "aus") + " · <span class='lp_k'>frei</span> " + character.esize + "</div>"
      + "<div><span class='lp_k'>Session</span> " + fmt_time(sh * 3600000) + " · <span class='lp_k'>Ref</span> " + fmt(gold_per_hour()) + " G/h</div><div><span class='lp_k'>Kuss</span> " + kiss_txt + "</div>"
      + "</div>";
    h += "<div class='lp_spot'><div><span class='lp_k'>Spot</span> <b>" + esc(current_spot || "-") + "</b>" + (meas_txt ? " <span class='lp_k'>(" + meas_txt + ")</span>" : "") + "</div>"
      + "<div class='lp_big'>" + fmt(cur_xp_h) + " XP/h &nbsp;·&nbsp; " + fmt(cur_gold_h) + " G/h</div>"
      + "<div class='lp_k'>Session " + fmt(sess.xp / sh) + " XP/h · " + fmt(sess.gold / sh) + " G/h · nächstes Level in " + (rate > 0 ? fmt_time((G.levels[character.level] - character.xp) / rate * 3600000) : "-") + "</div></div>";
    h += "<div class='lp_row'><span class='lp_mode'>Modus: " + (manual_spot ? "fest (" + esc(manual_spot) + ")" : "automatisch") + "</span><button data-act='auto'" + (manual_spot ? "" : " class='on'") + ">Auto</button><button data-act='reset'>Neu messen</button><button data-act='worth'" + (only_worth ? " class='on'" : "") + " title='nur die 5 besten nach geschätzten XP/h'>Top 5</button><button data-act='bycatch'" + (bycatch ? " class='on'" : "") + " title='andere sichere Monster in der Nähe mit angreifen'>Beifang</button><button data-act='focus'" + (focus_mode ? " class='on'" : "") + " title='nur farmen/hunten: kein Kuss, Ponty, Markt, Kuchen, keine Ausrüstungsautomatik; Inventar erst unter 3 freien Plätzen bis 20 frei aufräumen (mit Tränken)'>Fokus</button><button data-act='sortinv' title='Inventar sortieren'>Inv ⇅</button></div>"
      + "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Aktionen</span><button data-act='compound' title='Schmuck compounden (getragen + ungetragen)'>Compound</button><button data-act='tidy' title='Schrott verkaufen, Rest in die Bank'>Aufräumen</button><button data-act='bank' title='Schrott aus der Bank holen und verkaufen'>Bank aufräumen</button><button data-act='banksort' title='Bank nach Gruppen sortieren, Reiter lückenlos füllen'>Bank ⇅</button><button data-act='copylog' title='Bot-Log in die Zwischenablage'>Log kopieren</button><button data-act='pauseafter'" + (pause_after ? " class='on'" : "") + " title='Nach Buttons/Tasten pausieren statt weiterfarmen'>Danach: " + (pause_after ? "Pause" : "Farmen") + "</button><button data-act='clearlog' title='Log-Puffer leeren' style='padding:1px 5px'>✕</button></div>";
    h += "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Hunt: <span style='color:#e6e6e6'>" + esc(mh_txt()) + "</span> · " + tokens() + " Tokens</span><button data-act='hunt'" + (hunt_on ? " class='on'" : "") + " title='Monster Hunt automatisch'>Hunt</button><input data-huntmax='1' value='" + Math.round(hunt_max_danger * 100) + "' title='Jagden nur bis zu dieser Gefahr in % (HP-Anteil je Kill); darüber wird die Jagd übersprungen' style='width:34px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555;text-align:right'><span class='lp_k' style='font-size:11px'>%</span>" + (mh_quest() ? "<button data-act='huntabandon'>Abbrechen</button>" : "") + "</div>";
    h += "<div class='lp_row' style='flex-wrap:wrap;line-height:1.6'><span class='lp_k'>Serverwechsel:</span> <span style='font-size:11px'>" + server_tip_html() + "</span></div>";
    h += arb_html(panel);
    h += team_html();
    h += "<div class='lp_row'><span class='lp_mode' style='color:#9aa3b2'>Zielbau " + wish_text() + (AUTO_GEAR ? " · automatisch, Reserve " + fmt(WISH_RESERVE) : "") + "</span><button data-act='wishreset' title='alle Ziele auf das Getragene setzen'>Zielbau = aktuelle Ausrüstung</button><button data-act='wishtoggle'>" + (panel.__wish ? "▾" : "▸") + " Zielbau</button></div>";
    if (panel.__wish) h += wish_ui_html();
    if (!panel.__collapsed) {
        var cols = [["name", "Monster"], ["danger", "Gefahr"], ["ttk", "s/Kill"], ["xpk", "XP/Kill"], ["xpest", "XP/h*"], ["xph", "XP/h"], ["gph", "G/h"], ["ang", "ANG"]];
        h += "<div class='lp_k' style='font-size:11px;margin-top:4px'>Schätzung kalibriert ×" + xp_calibration().toFixed(1) + " (aus " + Object.keys(farm_stats).length + " gemessenen Spots)</div>";
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
    try { var ae = parent.document.activeElement; if (ae && (ae.tagName == "SELECT" || ae.tagName == "INPUT") && panel.contains(ae)) return; } catch (e) {}
    try { var wantW = panel.__wish ? 900 : 470; if (panel.__w != wantW) { panel.__w = wantW; panel.style.width = wantW + "px"; clamp_pos(panel, panel.offsetLeft, panel.offsetTop); } } catch (e) {}
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
function all_copies(name) { // Inventar + Bank, ohne getragene
    var out = [];
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name) out.push({ it: it, where: "inv", i: i }); }
    var bank = character.bank || {};
    for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; for (var k = 0; k < bank[pack].length; k++) { var b = bank[pack][k]; if (b && b.name == name) out.push({ it: b, where: pack, i: k }); } }
    out.sort(function (a, b) { return (b.it.level || 0) - (a.it.level || 0); });
    return out;
}
function dup_protected(it) {
    var def = G.items[it.name] || {};
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
function should_keep(it) { return (equipped_names()[it.name] && ((it.level || 0) > 0 || !is_buyable(it.name))) || (G.items[it.name] && G.items[it.name].compound && (equipped_names()[it.name] || find_inv_indices(it.name, it.level || 0).length >= 3)) || KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name) || EVENT_ITEMS.test(G.items[it.name] && G.items[it.name].name || ""); }
var tidy_next = 0;
var tidy_force = false; // Button: kompletter Durchgang unabhängig vom Füllstand
async function tidy_inventory() {
    var min_free = focus_mode ? FOCUS_MIN_FREE : INV_MIN_FREE;
    if (busy || upgrading || paused || (!tidy_force && (character.esize >= min_free || Date.now() < tidy_next))) return;
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
    if (eq[it.name] && def.upgrade) return backup_index(it.name) != idx; // Reserven: nur die beste bleibt
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
async function check_flee() {
    if (fleeing || paused || upgrading || kissing) return;
    var hp = character.hp / character.max_hp;
    var n = attackers_on_me();
    var strong = false; for (var sid in parent.entities) { var se = parent.entities[sid]; if (se && se.type == "monster" && !se.dead && se.target == character.name && too_strong(se)) { strong = true; break; } }
    if (strong && hp < 0.8) { fleeing = true; busy = true; game_log("Zu starker Angreifer – sofortiger Rückzug (HP " + Math.round(hp * 100) + "%)"); try { stop("smart"); change_target(null); await travel_place("town"); while (character.hp < character.max_hp * 0.9 && !character.rip) await sleep(1000); } catch (e) {} fleeing = false; busy = false; return; }
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
    if (kissing || upgrading || fleeing || !kiss_round_open()) return;
    var a = anniv(); var round = a.round, name = a.target;
    kissing = true; busy = true;
    game_log("Kuss-Runde " + round + ": laufe zu " + name + " (" + a.map + " " + a.x + "," + a.y + ")");
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
var hunt_max_danger = 0.10; try { var hmd = parseFloat(localStorage.getItem("lp_hunt_max_danger")); if (isFinite(hmd) && hmd > 0) hunt_max_danger = hmd; } catch (e) {} // Jagden nur bis zu dieser Gefahr (Anteil HP je Kill)
function hunt_danger_ok(id) { var d = G.monsters[id]; return !!d && mon_danger(d) <= hunt_max_danger; }
function hunt_target_ok(id) { return id && G.monsters[id] && is_safe_monster(id) && hunt_danger_ok(id) && !hidden_mons[id] && !EXCLUDE[id] && !spot_blocked(id) && team_safe(id); }
function hunt_skip_reason(id) { var d = G.monsters[id]; if (!d) return "unbekannt"; if (!hunt_danger_ok(id)) return Math.round(mon_danger(d) * 100) + " % > " + Math.round(hunt_max_danger * 100) + " %"; if (!is_safe_monster(id)) return "nicht sicher"; if (spot_blocked(id)) return "gesperrt"; if (!team_safe(id)) return "zu stark für den Priester"; return "ausgeblendet"; }
async function spend_tokens() { // Set-Teile kaufen, günstigstes fehlendes zuerst
    var want = MH_SET.filter(function (n) { var def = G.items[n]; var sl = slot_for_item(def); var worn = character.slots[sl]; return !(worn && worn.name == n) && locate_item(n) < 0; })
        .sort(function (a, b) { return (G.tokens.monstertoken[a] || 99) - (G.tokens.monstertoken[b] || 99); });
    for (var i = 0; i < want.length; i++) {
        var cost = G.tokens.monstertoken[want[i]]; if (!cost || tokens() < cost || character.esize < 2) continue;
        try { exchange_buy("monstertoken", want[i]); await sleep(1500); } catch (e) {}
        if (locate_item(want[i]) >= 0) game_log("Tokens: " + want[i] + " gekauft (" + cost + " Tokens, " + tokens() + " übrig)"); else game_log("Tokens: Kauf von " + want[i] + " nicht bestätigt");
    }
}
async function check_monsterhunt() {
    if (!hunt_on || hunting || busy || upgrading || kissing || fleeing || exchanging || paused || !has_weapon()) return;
    if (Date.now() - last_hunt_check < 15000) return;
    last_hunt_check = Date.now();
    var q = mh_quest();
    // 1. Jagd läuft, noch Kills offen -> Spot auf Jagdmonster
    if (q && q.c > 0) {
        if (!hunt_target_ok(q.id)) { if (hunt_spot || !hunt_skipped) { hunt_skipped = q.id; game_log("Jagd auf " + q.id + " übersprungen (" + hunt_skip_reason(q.id) + ") – läuft aus, normal farmen"); if (hunt_spot) hunt_reset(0); hunt_cooldown_until = Date.now() + (q.ms || 1800000); } return; } // unsicher -> läuft ab, normal weiterfarmen
        if (q.ms && q.ms < MH_MIN_LEFT_MS && q.c > 3) return; // kaum noch Zeit: nicht mehr wechseln
        if (hunt_spot != q.id) { hunt_spot = q.id; game_log("Monster Hunt: " + q.c + "x " + q.id + " (" + fmt_time(q.ms || 0) + ")"); set_manual_spot(q.id); }
        return;
    }
    // 2. Jagd erledigt -> abgeben; oder keine Jagd -> neue holen
    if (Date.now() < hunt_cooldown_until) return;
    hunting = true; busy = true;
    try {
        var before_tok = tokens(), before_gold = character.gold;
        await daisy();
        var r = null; try { r = await interact("monsterhunt"); } catch (e) { r = e; }
        await sleep(800);
        var q2 = mh_quest();
        if (q && q.c == 0) { day_count("hunts"); game_log("Monster Hunt abgegeben: +" + (tokens() - before_tok) + " Tokens, +" + fmt(character.gold - before_gold) + " Gold (" + tokens() + " Tokens gesamt)"); }
        if (!q2) { try { r = await interact("monsterhunt"); } catch (e) { r = e; } await sleep(800); q2 = mh_quest(); }
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
var hunt_skipped = null;
function hunt_reset(block_ms) { // Jagd-Spot verlassen, zum Nutzer-Modus zurück
    var m = hunt_spot;
    if (m && block_ms) blocked_spots[m] = Date.now() + block_ms;
    hunt_prev = null; hunt_spot = null;
    manual_spot = user_manual; need_repick = true; current_spot = null; meas = null; save_state();
}
async function hunt_abandon() {
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
    after_action("Jagd aufgeben");
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
    return equipped_slots("upgrade").filter(function (s) { var it = character.slots[s]; return (it.level || 0) < target_level(it.name, manual) || (is_buyable(it.name) && backup_index(it.name) < 0); });
}
function slots_without_stat() {
    return equipped_slots("upgrade").filter(function (s) { return character.slots[s].stat_type != STAT_TYPE; });
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
    tidy_force = true; tidy_next = 0;
    try { await tidy_inventory(); } finally { tidy_force = false; }
    if (!paused) { try { await sort_inventory(); } catch (e) {} }
    game_log("Aufräumen fertig – frei: " + character.esize + " (behalten: Tränke, Scrolls, Event, getragene Reserve, 3er-Sets Schmuck, Ziel-Items)");
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
var WISH_RESERVE = 1000000;          // so viel Gold bleibt bei Käufen/Upgrades immer übrig
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
    var h = "<table class='lp_t lp_wish' style='table-layout:fixed;width:100%'><colgroup><col style='width:58px'><col style='width:158px'><col style='width:46px'><col style='width:135px'><col style='width:175px'><col style='width:150px'><col style='width:110px'><col style='width:48px'></colgroup><tr><th style='text-align:left'>Slot</th><th style='text-align:left'>Zielitem (Wert auf eingestellter Stufe)</th><th title='Zielstufe · Ist = auf Getragenes setzen · max = Preislimit in Mio.'>Stufe / Limit</th><th style='text-align:left'>Stand</th><th style='text-align:left'>Bauen oder kaufen?</th><th style='text-align:left'>Angebote alle Server (★ = hier)</th><th style='text-align:left'>Zwischenlösung (nur auf Klick)</th><th></th></tr>";
    for (var slot in SLOT_TYPES) {
        var cands = slot_candidates(slot).slice(0, 60), cur = wish_item(slot), worn = character.slots[slot];
        var sel = "<select data-wslot='" + slot + "' style='max-width:150px;font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>";
        sel += "<option value=''" + (!cur ? " selected" : "") + ">– kein Ziel –</option>";
        cands.forEach(function (c) { sel += "<option value='" + c.name + "'" + (c.name == cur ? " selected" : "") + " title='" + esc(item_tooltip(c.name, c.level)) + "'>" + esc(c.def.name || c.name) + " (" + Math.round(c.score) + ")</option>"; });
        sel += "</select>";
        var lv = "";
        if (cur) { var d = G.items[cur], mx = d.compound ? 7 : 12, wl = wish_level(slot); lv = "<select data-wlvl='" + slot + "' style='font-size:11px;background:#1c2029;color:#eee;border:1px solid #555'>"; for (var L = 0; L <= mx; L++) lv += "<option value='" + L + "'" + (L == wl ? " selected" : "") + ">+" + L + "</option>"; lv += "</select>"; }
        lv += "<br><button data-act='wishist' data-slot='" + slot + "' style='padding:0 4px;font-size:10px;margin-top:2px' title='Zielitem und Stufe auf das setzen, was du gerade trägst'>Ist</button>";
        if (cur) { var smx = slot_max(slot); lv += "<br><input data-wmax='" + slot + "' value='" + (smx ? fmt_mio(smx) : "") + "' placeholder='max' style='width:40px;font-size:10px;margin-top:2px;background:#1c2029;color:#eee;border:1px solid " + (smx ? "#ffb74d" : "#555") + ";text-align:right' title='Preislimit in Mio. Gold für dieses Zielitem (z. B. 3 oder 1,5) – leer = automatische Grenze" + (smx ? "\naktuell " + fmt(smx) : "") + "'>"; }
        var stand = worn ? esc(worn.name) + "+" + (worn.level || 0) : "<span style='color:#ef5350'>leer</span>";
        if (cur && !is_buyable(cur) && G.items[cur].upgrade) stand += " <small style='color:#9aa3b2'>Reserve " + reserve_count(cur) + "/" + RESERVE_COPIES + "</small>";
        if (cur) { var ok = worn && worn.name == cur, done = ok && (worn.level || 0) >= wish_level(slot); stand = "<span style='color:" + (done ? "#4caf50" : ok ? "#8ab4f8" : "#e57373") + "' title='" + esc(cur + " – " + item_tooltip(cur, wish_level(slot))) + "'>" + stand + (done ? " ✓" + (wish_cfg[slot] && wish_cfg[slot].auto ? " <small>(Ist-Stand)</small>" : "") : ok ? " → +" + wish_level(slot) : " → " + esc(cur)) + "</span>"; }
        h += "<tr><td style='text-align:left'>" + slot + "</td><td style='text-align:left'>" + sel + "</td><td style='text-align:center'>" + lv + "</td><td style='text-align:left'>" + stand + "</td><td style='text-align:left;font-size:11px'>" + (cur ? bvb_html(slot) + farm_html(slot) : "-") + "</td><td style='text-align:left'>" + offers_html(slot) + "</td><td style='text-align:left;font-size:11px'>" + alt_html(slot) + "</td><td style='text-align:center'><button data-act='focus' data-slot='" + slot + "' title='diesen Slot jetzt angehen'>Jetzt</button></td></tr>";
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
async function wish_buy_from_offer(o, buy_fn) { // o: {name, level, price, ...}; buy_fn: async -> true bei Erfolg
    var slot = wish_wants(o.name, o.level, o.price); if (!slot || character.esize < 2) return false;
    game_log("Wunschliste: kaufe " + o.name + "+" + (o.level || 0) + " für " + slot + " (" + fmt(o.price) + " Gold)");
    var before = character.esize;
    try { if (!await buy_fn()) return false; } catch (e) { game_log("Wunschliste: Kauf fehlgeschlagen – " + err_txt(e)); return false; }
    await sleep(1500);
    if (character.esize >= before) { game_log("Wunschliste: " + o.name + " nicht erhalten"); return false; }
    note_bought(o.name);
    var idx = -1, bl = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == o.name && (it.level || 0) > bl) { idx = i; bl = it.level || 0; } }
    if (idx >= 0) {
        var worn_now = character.slots[slot];
        if (!worn_now || item_score(character.items[idx]) >= item_score(worn_now)) { try { equip(idx, slot); await sleep(800); game_log("Wunschliste: " + o.name + "+" + bl + " angelegt (" + slot + ") – jetzt " + wish_text()); } catch (e) {} }
        else game_log("Wunschliste: " + o.name + "+" + bl + " bleibt im Inventar – " + worn_now.name + "+" + (worn_now.level || 0) + " ist aktuell stärker (" + Math.round(item_score(worn_now)) + " vs " + Math.round(item_score(character.items[idx])) + "), wird erst ausgebaut");
    }
    return true;
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
function offers_for_slot(slot) { // beste Angebote aller Server für einen Slot: Wunschliste zuerst, dann nach Wert je Gold; nur besser als getragen und bezahlbar
    var worn = character.slots[slot], ws = worn ? item_score(worn) * 1.02 : 0;
    var list = global_offers.filter(function (o) { var def = G.items[o.name]; return def && fits_slot(def, slot) && o.score > ws && o.price <= character.gold; }); // bis zum vollen Goldstand anzeigen – gekauft wird automatisch nur innerhalb der Grenze, darüber per Kaufen-Knopf
    list.forEach(function (o) { o.wish = wish_rank(slot, o.name); });
    list.sort(function (a, b) { if ((b.wish > 0) != (a.wish > 0)) return (b.wish > 0) - (a.wish > 0); if (a.wish > 0 && b.wish > 0 && a.wish != b.wish) return b.wish - a.wish; return (b.score - ws) / b.price - (a.score - ws) / a.price; });
    return list;
}
function offer_txt(o) { return o.name + "+" + o.level + " " + fmt(o.price) + " (" + pretty_server(o.server) + (o.same ? " ★" : "") + ", " + o.seller + ")"; }
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
        return "<span style='color:" + (o.same ? "#4caf50" : (o.wish > 0 ? "#8ab4f8" : "#e6e6e6")) + "' title='" + esc((o.wish > 0 ? "Wunschliste · " : "Alternative · ") + "Wert " + Math.round(o.score) + " · Händler " + o.seller + " auf " + o.server + (o.same ? " (dieser Server)" : "")) + "'>" + esc(o.name) + "+" + o.level + " " + fmt(o.price) + " <small>" + esc(pretty_server(o.server)) + (o.same ? " ★" : "") + "</small></span>" + btn;
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
    try { if (typeof parent.change_server == "function") { parent.change_server(region, id); return; } } catch (e) {}
    try { parent.location.href = "/character/" + encodeURIComponent(character.name) + "/in/" + region + "/" + id + "/"; } catch (e) { game_log("Serverwechsel fehlgeschlagen: " + err_txt(e)); }
}
function start_trip(f) { // f: Fund auf anderem Server
    var home = { region: parent.server_region, id: parent.server_identifier }, tgt = split_server(f.server);
    if (!home.region || !tgt) { game_log("Serverwechsel: Server unbekannt"); return; }
    server_trip = { home: home, target: tgt, find: f, t: Date.now(), stage: "out" }; save_trip();
    switch_server(tgt.region, tgt.id);
}
function end_trip(msg) { if (!server_trip) return; var home = server_trip.home; game_log(msg + " – zurück nach " + pretty_server(home.region + home.id)); server_trip.stage = "back"; save_trip(); switch_server(home.region, home.id); }
function check_trip_on_start() { // nach dem Laden: sind wir unterwegs?
    if (!server_trip) return;
    if (Date.now() - server_trip.t > 20 * 60000) { server_trip = null; save_trip(); return; }
    var mine = my_server();
    if (server_trip.stage == "out" && mine == norm_server(server_trip.target.region + server_trip.target.id)) {
        var f = server_trip.find;
        if (!wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) { end_trip("Angebot passt nicht mehr"); return; }
        pending_buy = Object.assign({}, f, { same: true }); server_after_buy_pause = false; trip_buying = true; paused = false;
        game_log("Angekommen auf " + pretty_server(mine) + " – kaufe " + f.name + "+" + f.level + " bei " + f.seller);
    } else if (server_trip.stage == "back" && mine == norm_server(server_trip.home.region + server_trip.home.id)) {
        game_log("Zurück auf " + pretty_server(mine) + " – Serverkauf abgeschlossen"); server_trip = null; save_trip(); paused = false;
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
    var finds = [], mine = my_server(), all = [], arb = [];
    merchants.forEach(function (m) {
        for (var sl in m.slots) {
            if (sl.indexOf("trade") != 0) continue;
            var it = m.slots[sl]; if (!it || !it.price || it.b) continue;
            var d0 = G.items[it.name];
            if (d0) { var ao = { name: it.name, level: it.level || 0, price: it.price, q: it.q || 1, seller: m.name, server: m.server || "?", same: norm_server(m.server) == mine, map: m.map, x: m.x, y: m.y, tslot: sl, t: Date.now() }; ao.profit = arb_profit(ao); if (ao.profit > 0) arb.push(ao); }
            if (d0 && slot_for_item(d0)) all.push({ name: it.name, level: it.level || 0, price: it.price, seller: m.name, server: m.server || "?", same: norm_server(m.server) == mine, map: m.map, x: m.x, y: m.y, tslot: sl, score: gear_score(d0, it.level || 0, it.stat_type), t: Date.now() });
            if (!on_wishlist(it.name)) continue;
            if (norm_server(m.server) != mine && is_pvp_server(m.server)) continue; // kein Serverwechsel auf PVP-Server
            var slot = wish_wants(it.name, it.level || 0, it.price);
            if (!slot || (only_slot && slot != only_slot)) continue;
            finds.push({ name: it.name, level: it.level || 0, price: it.price, seller: m.name, server: m.server || "?", map: m.map, x: m.x, y: m.y, slot: slot, tslot: sl, same: norm_server(m.server) == mine, t: Date.now() });
        }
    });
    finds.sort(function (a, b) { return (b.same - a.same) || (a.price - b.price); });
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
async function buy_find(f) { // Treffer auf eigenem Server sofort kaufen (innerhalb einer laufenden Routine)
    if (!f || !wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) return false;
    set_message("Kauf " + f.name);
    if (f.map && f.x != null) await travel({ map: f.map, x: f.x, y: f.y + 30 });
    var seller = get_player(f.seller);
    if (!seller || !seller.slots) { game_log("Händler " + f.seller + " nicht (mehr) hier"); return false; }
    var it = seller.slots[f.tslot];
    if (!it || it.name != f.name || it.price > f.price * 1.05) { game_log("Angebot bei " + f.seller + " nicht mehr da"); return false; }
    return wish_buy_from_offer({ name: it.name, level: it.level || 0, price: it.price }, async function () { trade_buy(seller, f.tslot, 1); return true; });
}
async function run_pending_buy() { // zum Händler auf diesem Server laufen und kaufen
    if (!pending_buy || busy || upgrading || kissing || fleeing || paused) return;
    var f = pending_buy; pending_buy = null;
    if (!wish_wants(f.name, f.level, f.price, f.force ? f.slot : null)) return;
    busy = true; marketing = true;
    try {
        set_message("Kauf " + f.name);
        if (f.map && f.x != null) await travel({ map: f.map, x: f.x, y: f.y + 30 });
        var seller = get_player(f.seller);
        if (!seller || !seller.slots) { game_log("Händler " + f.seller + " nicht (mehr) hier"); }
        else {
            var it = seller.slots[f.tslot];
            if (!it || it.name != f.name || it.price > f.price * 1.05) { game_log("Angebot bei " + f.seller + " nicht mehr da"); }
            else await wish_buy_from_offer({ name: it.name, level: it.level || 0, price: it.price }, async function () { trade_buy(seller, f.tslot, 1); return true; });
        }
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
async function upgrade_inv(name, level, target) {
    while (level < target) {
        check_pause();
        var idx = find_inv_index(name, level);
        if (idx < 0) return { level: level, destroyed: true };
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
                var r5 = await upgrade_inv(iv.name, lv2, lv2 + 1);
                if (r5.stopped) skipped["inv" + iv.name] = true;
                var bi = -1, bl = -1; for (var j = 0; j < character.items.length; j++) { var it2 = character.items[j]; if (it2 && it2.name == iv.name && (it2.level || 0) > bl) { bi = j; bl = it2.level || 0; } }
                if (bi >= 0 && item_score(character.items[bi]) > item_score(character.slots[sl2])) { equip(bi, sl2); await sleep(600); game_log(iv.name + " +" + bl + " ist jetzt besser – angelegt"); }
                best = { cont: true }; break;
            }
            if (best && best.cont) continue;
        }
        if (!best) break;
        var name = best.it.name, lvl = best.it.level || 0, buyable = is_buyable(name);
        if (!buyable && lvl >= SAFE_TARGET_DROP && backup_index(name) < 0) { game_log(name + ": Drop-Item ohne Reserve – bleibt bei +" + lvl); skipped[best.slot] = true; continue; }
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
    if (character.rip) { if (!rip_counted) { rip_counted = true; day_count("deaths"); game_log("Gestorben (heute " + day.deaths + "x)"); try { var hq = mh_quest(); if (hq && hq.c > 0 && hunt_spot == hq.id) { game_log("Tod bei der Jagd auf " + hq.id + " – Jagd abgebrochen, Monster 30 min gesperrt"); hunt_reset(30 * 60000); hunt_cooldown_until = Date.now() + (hq.ms || 1800000); } } catch (e) {} } if (meas) finish_measure(true); respawn(); busy = false; fleeing = false; kissing = false; return; }
    rip_counted = false;
    session_tick();
    if (Date.now() - last_panel > 2000) { last_panel = Date.now(); try { update_panel(); update_char_panel(); } catch (e) {} }
    try { team_tick(); team_broadcast(); team_read_logs(); team_inject(); } catch (e) {}
    if (paused) return;
    measure_tick();

    busy_watchdog(); check_flee();
    if (!manual_lock) { // während einer manuell ausgelösten Aktion startet nichts Automatisches dazwischen
        if (pending_upgrade == "auto" && focus_mode) pending_upgrade = null; // Fokus: keine automatische Ausrüstungsroutine, auch keine noch wartende
        if (pending_upgrade && !busy && !upgrading) { var auto_run = pending_upgrade == "auto"; pending_upgrade = null; upgrade_routine(auto_run); }
        if (focus_mode) { // nur das Nötigste: Scan (bewegt nichts), manuelle Ziele, fehlende Ausrüstung, Inventar erst wenn fast voll, Not-Tränke, Hunt-Abwicklung
            scan_all_merchants(); if (pending_buy && (pending_buy.force || trip_buying)) run_pending_buy(); run_goal(); check_weapon(); check_gear_slots(); tidy_inventory(); check_potions(); check_stuck(); check_monsterhunt();
        } else {
            auto_gear_tick(); best_equip_tick(); scan_all_merchants(); run_pending_buy(); run_goal(); check_weapon(); check_gear_slots(); check_elixir(); kiss_routine(); tidy_inventory(); check_potions(); check_stuck(); check_ponty(false); check_market(false); check_seashells(); check_monsterhunt(); check_cake();
        }
    }
    if (busy || is_moving(character)) return;

    var farm = pick_farm_monster();
    var target = get_targeted_monster();

    if (target && !is_valid_target(target)) {
        log_ignored(target, "zu stark");
        change_target(null);
        target = null;
    }

    if (!target) { var tt = team_threat(); if (tt) target = tt; }
    if (!target) {
        var aggro = attackers_on_me();
        // Farm-Monster: nächstes freies Exemplar, aber nur wenn es (auch gelevelt) noch sicher ist
        var best_d = 1e9, seen_farm = false;
        for (var mid in parent.entities) {
            var m = parent.entities[mid];
            if (!m || m.type != "monster" || m.dead || m.mtype != farm) continue;
            if (m.target && m.target != character.name) continue;
            if (aggro >= MAX_AGGRO && m.target != character.name) continue;
            if (too_strong(m)) { seen_farm = true; if (distance(character, m) < 300) log_ignored(m, "gelevelt/zu stark"); continue; }
            var d = distance(character, m); if (d < best_d) { best_d = d; target = m; }
        }
        all_leveled_check(farm, seen_farm, !!target); // nur gelevelte in Sicht -> nach 45 s ausweichen
        if (!target && bycatch && aggro < MAX_AGGRO) { // Beifang: nächstes sicheres Monster in der Nähe
            var bd = BYCATCH_RANGE;
            for (var bid in parent.entities) { var bm = parent.entities[bid]; if (!bm || bm.type != "monster" || bm.dead || bm.mtype == farm) continue; if (!is_safe_monster(bm.mtype) || hidden_mons[bm.mtype] || too_strong(bm)) continue; if (bm.target && bm.target != character.name) continue; var dd = distance(character, bm); if (dd < bd) { bd = dd; target = bm; } }
        }
        if (!target) { // Angreifer nur erledigen, wenn sie nah sind; sonst weiter zum Spot
            for (var id in parent.entities) { var e = parent.entities[id]; if (is_valid_target(e) && e.target == character.name && distance(character, e) < 120) { target = e; break; } }
        }
        if (target) change_target(target); else { go_to_farm_spot(); return; }
    }

    last_target_id = target.id;
    if (!is_in_range(target)) move(character.x + (target.x - character.x) / 2, character.y + (target.y - character.y) / 2);
    else if (can_attack(target)) {
        if (!try_cburst()) { status_message(); attack(target); }
    }
  }, 1000 / 4);
}
rebuild_wishlist();
setTimeout(function () { try { check_trip_on_start(); if (!server_trip) check_server_arrival(); } catch (e) {} }, 4000);
try { if (localStorage.getItem("lp_wiki_open") == "1") { wiki_panel = init_wiki_panel(); render_wiki(); } } catch (e) {}
start_main();
