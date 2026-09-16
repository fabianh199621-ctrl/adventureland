// ===== Adventure Land – Vollautomatik Magier (nichts einstellen) =====
// P = Pause (stoppt auch Upgrades)
// U = sichere Upgrades: kaufbare Items +5, Drop-Items +3, INT-Scrolls, Schmuck +2
// K = alles bis +5, auch Drop-Items (Risiko!)
// L = Farm-Statistik (XP/h, Gold/h je Monster) ins Log
// D = Event-Daten anzeigen (Diagnose für 10-Jahre-Event)
// G = Anniversary Gifts bei Xyn eintauschen (manuell)
// Upgrades laufen NUR auf Tastendruck. GOLD_RESERVE wird nie angetastet.
// Wird per Loader aus GitHub geladen: https://github.com/fabianh199621-ctrl/adventureland

var BOT_VERSION = "v32";
game_log("LogicPlan-Skript " + BOT_VERSION + " gestartet – P = Pause, U = sichere Upgrades, K = alle Upgrades, L = Statistik, G = Gifts tauschen");

var GOLD_RESERVE = 20000;
var UPGRADE_TARGET = 5;
var SAFE_TARGET_DROP = 3;
var COMPOUND_TARGET = 2;
var STAT_TYPE = "int";
var FALLBACK_WEAPONS = ["staff", "stick"];
var NO_WEAPON_MONSTER = "goo";
var MAX_TARGET_HP_FACTOR = 5;
// Kandidaten für Farmspots – ungeeignete (zu stark) werden automatisch aussortiert
var CANDIDATES = ["goo", "crab", "bee", "croc", "armadillo", "squig", "squigtoad", "poisio",
                  "tortoise", "frog", "rat", "minimush", "snake", "osnake", "scorpion", "spider",
                  "arcticbee", "boar", "iceroamer", "crabx", "bat", "cgoo"];
var EVAL_MS = 3 * 60 * 1000;         // Messdauer je Spot
var MEASURE_TOP = 6;                 // nur die 6 vielversprechendsten Spots werden gemessen
var REEVAL_MS = 6 * 60 * 60 * 1000;  // Messwerte gelten so lange
var ATTACK_DRIFT = 0.15;             // ... oder bis sich ANG um 15 % geändert hat
var XP_WEIGHT = 1, GOLD_WEIGHT = 1;  // Gewichtung XP/h vs. Gold/h
var HITS_TO_DIE_MIN = 8;             // Monster darf mich nicht in < 8 Schlägen töten
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
var KEEP_ITEMS = /^(hpot|mpot|scroll|cscroll|intscroll|strscroll|dexscroll|vitscroll|tracker)/; // bleibt im Inventar
var EVENT_ITEMS = /cake|gift|anniv|kiss|slice/i;   // Event-Items bleiben im Inventar
var KISS_ENABLED = true;             // 10-Jahre-Event: jede Runde zum Ziel laufen und küssen
var FLEE_HP = 0.25;                  // Rückzug unter 25 % HP ...
var FLEE_ATTACKERS = 2;              // ... wenn mind. 2 Monster auf mich zielen
var CBURST_MIN_TARGETS = 2;
var CBURST_MP_PER_TARGET = 80;
var CBURST_MIN_MP = 0.5;

var busy = false, paused = false, upgrading = false;
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
    if (!d) return false;
    if (d.cooperative || d.boss || d.special) return false;
    if (d.attack * HITS_TO_DIE_MIN > character.max_hp) return false;
    if (d.hp > character.attack * HITS_TO_KILL_MAX) return false;
    return true;
}
function stats_valid(st) {
    if (!st || (Date.now() - st.t) >= REEVAL_MS) return false;
    if (st.attack && Math.abs(character.attack - st.attack) / st.attack > ATTACK_DRIFT) return false;
    return true;
}
// Geschätztes Potenzial aus Spieldaten: XP pro Kill / nötige Schläge
function estimate(mon) {
    var d = G.monsters[mon];
    var hits = Math.max(1, Math.ceil(d.hp / Math.max(1, character.attack)));
    return (d.xp || 0) / hits + (d.gold || 0) / hits * 0.5;
}
function candidate_list() {
    var list = CANDIDATES.filter(function (m) {
        if (blocked_spots[m] || !is_safe_monster(m)) return false;
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
    manual_spot = mon; meas = null; blocked_spots = {}; need_repick = true;
    game_log("Fester Farmspot: " + mon); save_state();
    stop("smart"); busy = false;
}
function set_auto_spot() {
    manual_spot = null; meas = null; need_repick = true; current_spot = null;
    game_log("Automatische Spotwahl aktiv"); save_state();
    stop("smart"); busy = false;
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
    if (active >= EVAL_MS && !meas.manual) finish_measure(false);
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

function go_to_farm_spot() {
    var mon = pick_farm_monster();
    busy = true; set_message("Laufe zu " + mon);
    smart_move(mon)
        .then(function () {
            if (!get_nearest_monster({ type: mon }) && !manual_spot) {
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

// ---------- Heilen / Tränke ----------
function heal_logic() {
    if (is_on_cooldown("use_hp")) return;
    var hp = character.hp / character.max_hp, mp = character.mp / character.max_mp;
    var missing_hp = character.max_hp - character.hp, missing_mp = character.max_mp - character.mp;

    if (hp < 0.4 && missing_hp >= 200 && quantity("hpot0") > 0) {
        game_log("Heiltrank genommen (HP " + Math.round(hp * 100) + "%)"); use_skill("use_hp");
    } else if (mp < 0.3 && missing_mp >= 300 && quantity("mpot0") > 0) {
        game_log("Manatrank genommen (MP " + Math.round(mp * 100) + "%)"); use_skill("use_mp");
    } else if (character.hp < character.max_hp) use_skill("regen_hp");
    else if (character.mp < character.max_mp) use_skill("regen_mp");
}

// ---------- Magier: Cburst (erst ab Freischaltungs-Level) ----------
function try_cburst() {
    if (!has_weapon() || !skill_available("cburst")) {
        if (!cburst_logged && G.skills.cburst) { cburst_logged = true; game_log("Cburst erst ab Level " + G.skills.cburst.level); }
        return false;
    }
    if (is_on_cooldown("cburst")) return false;
    if (character.mp / character.max_mp < CBURST_MIN_MP) return false;

    var range = G.skills.cburst.range || 300;
    var targets = [];
    for (var id in parent.entities) {
        var e = parent.entities[id];
        if (!is_valid_target(e)) continue;
        if (distance(character, e) > range) continue;
        targets.push([e.id, CBURST_MP_PER_TARGET]);
    }
    if (targets.length < CBURST_MIN_TARGETS) return false;
    if (character.mp < targets.length * CBURST_MP_PER_TARGET + 100) return false;

    set_message("Cburst x" + targets.length);
    use_skill("cburst", targets);
    return true;
}

// ---------- Eigenes Fenster im Spiel (verschiebbar) ----------
var sess = { start: Date.now(), xp: 0, gold: 0, last_xp: character.xp, last_level: character.level, last_gold: character.gold };
function session_tick() {
    if (character.level > sess.last_level) sess.xp += (G.levels[sess.last_level] - sess.last_xp) + character.xp;
    else sess.xp += Math.max(0, character.xp - sess.last_xp);
    sess.last_xp = character.xp; sess.last_level = character.level;
    var dg = character.gold - sess.last_gold; if (dg > 0) sess.gold += dg; sess.last_gold = character.gold;
}
function init_panel() {
    var doc = parent.document;
    var old = doc.getElementById("lp_panel"); if (old) old.remove();
    var div = doc.createElement("div"); div.id = "lp_panel";
    div.style.cssText = "position:absolute;left:10px;top:130px;z-index:9999;background:rgba(0,0,0,0.78);color:#e8e8e8;font:12px/1.35 monospace;padding:6px 9px;border:1px solid #777;border-radius:3px;min-width:230px;cursor:move;user-select:none;white-space:pre;";
    div.innerHTML = "";
    try { var p = JSON.parse(localStorage.getItem("lp_panel_pos") || "null"); if (p) { div.style.left = p.x + "px"; div.style.top = p.y + "px"; } } catch (e) {}
    doc.body.appendChild(div);
    if (parent.__lp_panel_h) { doc.removeEventListener("mousemove", parent.__lp_panel_h.mm); doc.removeEventListener("mouseup", parent.__lp_panel_h.mu); }
    var drag = null;
    div.addEventListener("mousedown", function (e) { if (e.target.tagName == "BUTTON") return; drag = { dx: e.clientX - div.offsetLeft, dy: e.clientY - div.offsetTop }; e.preventDefault(); });
    div.addEventListener("click", function (e) {
        var b = e.target; if (b.tagName != "BUTTON") return;
        var act = b.getAttribute("data-act"), mon = b.getAttribute("data-mon");
        if (act == "farm") set_manual_spot(mon); else if (act == "auto") set_auto_spot(); else if (act == "reset") reset_measurements();
        e.stopPropagation(); last_panel = 0;
    });
    var mm = function (e) { if (!drag) return; div.style.left = (e.clientX - drag.dx) + "px"; div.style.top = (e.clientY - drag.dy) + "px"; };
    var mu = function () { if (drag) { try { localStorage.setItem("lp_panel_pos", JSON.stringify({ x: div.offsetLeft, y: div.offsetTop })); } catch (e) {} } drag = null; };
    doc.addEventListener("mousemove", mm); doc.addEventListener("mouseup", mu);
    parent.__lp_panel_h = { mm: mm, mu: mu };
    return div;
}
var panel = init_panel();
function fmt(n) { n = Math.round(n || 0); return n >= 1000000 ? (n / 1000000).toFixed(2) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
function fmt_time(ms) { if (!isFinite(ms) || ms < 0) return "-"; var m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; }
function update_panel() {
    if (!panel || !panel.parentNode) panel = init_panel();
    var lines = [];
    var hp = Math.round(character.hp / character.max_hp * 100), mp = Math.round(character.mp / character.max_mp * 100);
    lines.push("LogicPlan " + BOT_VERSION + (paused ? "  [PAUSE]" : upgrading ? "  [UPGRADE]" : kissing ? "  [KUSS]" : fleeing ? "  [RÜCKZUG]" : ""));
    lines.push("Lv " + character.level + "  HP " + hp + "%  MP " + mp + "%  Gold " + fmt(character.gold));
    lines.push("Tränke HP " + quantity("hpot0") + " / MP " + quantity("mpot0") + "  frei " + character.esize);
    var sh = Math.max(1 / 60, (Date.now() - sess.start) / 3600000);
    var cur_xp_h = 0, cur_gold_h = 0;
    if (meas) { var mh = Math.max(1 / 60, (Date.now() - meas.start - meas.paused_ms) / 3600000); cur_xp_h = meas.xp / mh; cur_gold_h = meas.gold / mh; }
    else if (current_spot && farm_stats[current_spot]) { cur_xp_h = farm_stats[current_spot].xp_h; cur_gold_h = farm_stats[current_spot].gold_h; }
    lines.push("Spot " + (current_spot || "-") + (meas ? " (Messung)" : "") + ": " + fmt(cur_xp_h) + " XP/h  " + fmt(cur_gold_h) + " G/h");
    lines.push("Session " + fmt_time(sh * 3600000) + ": " + fmt(sess.xp / sh) + " XP/h  " + fmt(sess.gold / sh) + " G/h");
    var rate = cur_xp_h || sess.xp / sh;
    lines.push("Nächstes Level in " + (rate > 0 ? fmt_time((G.levels[character.level] - character.xp) / rate * 3600000) : "-"));
    var a = anniv();
    if (a && a.active) lines.push("Kuss: " + (a.available === false ? "erledigt" : (a.live && a.target ? "JETZT " + a.target : "nächste in " + fmt_time(a.next - Date.now()))));
    var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
    var html = lines.map(esc).join("\n");
    var BS = "font:11px monospace;padding:0 5px;margin-left:4px;cursor:pointer;background:#333;color:#eee;border:1px solid #888;border-radius:2px;";
    html += "\n<span style='color:#9cf'>Modus: " + (manual_spot ? "fest (" + manual_spot + ")" : "automatisch") + "</span>"
          + " <button data-act='auto' style='" + BS + "'>Auto</button><button data-act='reset' style='" + BS + "'>Neu messen</button>";
    html += "\n--- Monster für Lv " + character.level + " / ANG " + character.attack + " (XP/h | G/h | ANG) ---";
    var mons = CANDIDATES.filter(is_safe_monster);
    mons.sort(function (x, y) { var a = farm_stats[x], b = farm_stats[y]; return ((b && b.xp_h) || estimate(y) * 100) - ((a && a.xp_h) || estimate(x) * 100); });
    mons.forEach(function (m) {
        var st = farm_stats[m];
        var row = (m == current_spot ? "&gt; " : "  ") + esc((m + "          ").slice(0, 10)) + " " + (st ? fmt(st.xp_h) + " | " + fmt(st.gold_h) + " | " + (st.attack || "?") + (st.deaths ? " †" + st.deaths : "") + (stats_valid(st) ? "" : " (alt)") : "  -  |  -  |  -  ");
        row += "<button data-act='farm' data-mon='" + m + "' style='" + BS + (m == manual_spot ? "background:#264;" : "") + "'>Farmen</button>";
        html += "\n" + row;
    });
    panel.innerHTML = html;
}
var last_panel = 0;

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
function is_junk(it) { // kaufbare Standardausrüstung ohne Level/Attribut
    var def = G.items[it.name]; if (!def) return false;
    if (EQUIP_TYPES.indexOf(def.type) < 0) return false;
    if ((it.level || 0) > 0 || it.stat_type) return false;
    return is_buyable(it.name);
}
function should_keep(it) { return (G.items[it.name] && G.items[it.name].compound) || KEEP_ITEMS.test(it.name) || EVENT_ITEMS.test(it.name) || EVENT_ITEMS.test(G.items[it.name] && G.items[it.name].name || ""); }
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
        // 2. Rest in die Bank
        if (character.esize < INV_MIN_FREE + 3) {
            set_message("Bank"); await smart_move("bank");
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
    if (fleeing || paused || upgrading) return;
    if (character.hp / character.max_hp > FLEE_HP || attackers_on_me() < FLEE_ATTACKERS) return;
    fleeing = true; busy = true;
    game_log("Rückzug! HP " + Math.round(character.hp / character.max_hp * 100) + "%, " + attackers_on_me() + " Angreifer");
    set_message("RÜCKZUG");
    try {
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
        var ok = false, tries = 0;
        while (Date.now() < t_end && !paused) {
            a = anniv();
            if (!a || a.round != round) break;
            if (a.available === false) { ok = true; break; }
            var ent = get_player(name);
            if (!ent) {
                // Ziel nicht in Sicht: zur gemeldeten Position nachlaufen
                if (a.map == character.map && distance(character, { x: a.x, y: a.y }) > 30) { move(a.x, a.y); }
                await sleep(1000); continue;
            }
            if (distance(character, ent) > range - 5) { move(ent.x, ent.y); await sleep(400); continue; }
            if (!is_on_cooldown("ikissyou")) {
                tries++;
                try { await use_skill("ikissyou", ent); } catch (e) { game_log("Kuss-Fehler: " + (e && e.reason || e)); }
                await sleep(1500);
                a = anniv();
                if (a && a.available === false) { ok = true; break; }
                if (tries >= 5) break;
            } else await sleep(500);
        }
        if (ok) { kiss_done_round = round; game_log("Kuss belohnt (Runde " + round + ")"); }
        else { kiss_fail_round = round; game_log("Kuss diese Runde nicht geschafft"); }
    } catch (e) { kiss_fail_round = round; game_log("Kuss-Routine abgebrochen: " + e); }
    kissing = false; busy = false;
}

// ---------- Anniversary Gifts bei Xyn eintauschen (Taste G) ----------
var exchanging = false;
async function exchange_gifts() {
    if (exchanging) { game_log("Tausch läuft bereits"); return; }
    if (busy || upgrading) { game_log("Gerade beschäftigt – gleich nochmal G drücken"); return; }
    var n = quantity("anniversarygift");
    if (!n) { game_log("Keine Anniversary Gifts im Inventar"); return; }
    if (paused) { paused = false; game_log("Pause aufgehoben"); }
    exchanging = true; busy = true;
    game_log("Tausche " + n + " Anniversary Gifts bei Xyn");
    set_message("Zu Xyn");
    try {
        stop("smart");
        await smart_move("exchange");
        var done = 0, fails = 0;
        while (quantity("anniversarygift") > 0 && !paused) {
            if (character.esize < 2) { game_log("Inventar voll – Tausch gestoppt (" + quantity("anniversarygift") + " übrig)"); break; }
            var idx = locate_item("anniversarygift");
            var before = quantity("anniversarygift");
            try { await exchange(idx); } catch (e) {}
            await sleep(1200);
            while (character.q && character.q.exchange) await sleep(500);
            await sleep(300);
            if (quantity("anniversarygift") < before) { done++; fails = 0; set_message("Tausch " + done + "/" + n); }
            else if (++fails >= 3) { game_log("Tausch klappt nicht (Xyn nicht erreichbar?)"); break; }
        }
        game_log("Fertig: " + done + " Gifts getauscht");
    } catch (e) { game_log("Tausch-Fehler: " + e); }
    exchanging = false; busy = false;
    if (!paused) go_to_farm_spot();
}

// ---------- Tränke kaufen ----------
function check_potions() {
    if (busy) return;
    if (quantity("hpot0") >= 30 && quantity("mpot0") >= 30) return;
    var price = G.items.hpot0.g + G.items.mpot0.g;
    var amount = Math.min(150, Math.floor((spendable() * 0.7) / price));
    if (amount < 20) return;

    busy = true; set_message("Tränke kaufen");
    smart_move("potions").then(function () {
        buy("hpot0", amount); buy("mpot0", amount);
        game_log("Tränke gekauft: " + amount + " HP / " + amount + " MP");
    }).catch(function () {}).then(function () { busy = false; });
}

// ---------- Hilfsfunktionen ----------
function npc_selling(name) {
    for (var id in G.npcs) { var n = G.npcs[id]; if (n.items && n.items.indexOf(name) >= 0) return id; }
    return null;
}
function is_buyable(name) { return npc_selling(name) != null; }
function target_level(name, manual) { return (manual || is_buyable(name)) ? UPGRADE_TARGET : SAFE_TARGET_DROP; }

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
    return equipped_slots("upgrade").filter(function (s) { var it = character.slots[s]; return (it.level || 0) < target_level(it.name, manual); });
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

// ---------- Upgrade + Attribut + Compound ----------
// manual=false: sichere Upgrades (U) | manual=true: alles bis +5 (K)
async function upgrade_routine(manual) {
    if (upgrading) { game_log("Upgrade läuft bereits"); return; }
    if (busy) { game_log("Gerade beschäftigt (unterwegs) – gleich nochmal drücken"); return; }
    if (!has_weapon()) { game_log("Keine Waffe – kein Upgrade"); return; }
    if (paused) { paused = false; game_log("Pause aufgehoben"); }

    var stat_scroll = STAT_TYPE + "scroll", stat_price = G.items[stat_scroll].g;
    var empty = Object.keys(FILL_SLOTS).filter(function (s) { return !character.slots[s]; }).length;
    var up_slots = slots_to_upgrade(manual);
    var stat_slots = spendable() >= stat_price ? slots_without_stat() : [];
    var comp_slots = slots_to_compound();
    if (!empty && !up_slots.length && !stat_slots.length && !comp_slots.length) { game_log("Nichts zu tun (oder zu wenig freies Gold: " + spendable() + ")"); return; }
    if (character.esize < 2) { game_log("Upgrade: Inventar zu voll"); return; }

    upgrading = true; busy = true; set_message("Upgrade");
    game_log((manual ? "ALLE Upgrades (Risiko)" : "Sichere Upgrades") + ": " + empty + " leere Slots, " + up_slots.length + " Upgrades, " + stat_slots.length + " Attribut, " + comp_slots.length + " Compound (frei: " + spendable() + " Gold)");

    try {
        if (empty) { await fill_empty_slots(); up_slots = slots_to_upgrade(manual); }

        if (up_slots.length) {
            await smart_move("upgrade");
            for (var k = 0; k < up_slots.length; k++) {
                var slot = up_slots[k], item = character.slots[slot]; if (!item) continue;
                var name = item.name, goal = target_level(name, manual), rebuys = 0;

                while (spendable() > 2000) {
                    check_pause();
                    var cur = character.slots[slot];
                    if (!cur || (cur.level || 0) >= goal) break;
                    var lvl = cur.level || 0;

                    unequip(slot); await sleep(600);
                    var idx = find_inv_index(name, lvl);
                    if (idx < 0) { game_log("Upgrade: Item nicht gefunden"); break; }
                    try {
                        var scroll = "scroll" + item_grade(character.items[idx]);
                        if (spendable() < G.items[scroll].g) { game_log("Reserve erreicht – Upgrade gestoppt"); equip(idx); break; }
                        if (quantity(scroll) < 1) { buy(scroll, 1); await sleep(600); }
                        var sidx = locate_item(scroll);
                        if (sidx < 0) { game_log("keine " + scroll); equip(idx); break; }

                        set_message(name + " +" + lvl + " -> +" + (lvl + 1));
                        try { await upgrade(idx, sidx); } catch (e) {}
                        await wait_queue("upgrade");
                    } finally {
                        var after = find_inv_index(name, lvl + 1);
                        if (after >= 0) { game_log(name + " ist jetzt +" + (lvl + 1)); equip(after); await sleep(600); }
                        else if (find_inv_index(name, lvl) >= 0) { if (!paused) game_log(name + " Upgrade fehlgeschlagen, Item erhalten"); equip(find_inv_index(name, lvl)); await sleep(600); }
                        else {
                            game_log("!!! " + name + " ZERSTÖRT !!!");
                            if (++rebuys > 3) { game_log(name + ": zu oft zerstört, abgebrochen"); rebuys = 99; }
                            else if (slot == "mainhand") { rebuys = 99; }
                            else if (await buy_and_equip(name)) await smart_move("upgrade"); else rebuys = 99;
                        }
                    }
                    if (rebuys == 99) break;
                }
            }
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

        comp_slots = slots_to_compound();
        for (var c = 0; c < comp_slots.length; c++) { check_pause(); await compound_slot(comp_slots[c]); }

    } catch (e) {
        if (e == "PAUSE") game_log("Upgrade-Routine durch Pause abgebrochen");
        else game_log("Routine-Fehler: " + e);
    }

    game_log("Routine beendet (Gold: " + character.gold + ")");
    upgrading = false; busy = false;
    if (!paused) go_to_farm_spot();
}

// ---------- Hauptschleife ----------
setInterval(function () {
    heal_logic(); loot();
    if (character.rip) { if (meas) finish_measure(true); respawn(); busy = false; fleeing = false; kissing = false; return; }
    session_tick();
    if (Date.now() - last_panel > 2000) { last_panel = Date.now(); try { update_panel(); } catch (e) {} }
    if (paused) return;
    measure_tick();

    check_weapon(); check_flee(); kiss_routine(); tidy_inventory(); check_potions();
    if (busy || is_moving(character)) return;

    var farm = pick_farm_monster();
    var target = get_targeted_monster();

    if (target && !is_valid_target(target)) {
        game_log("Ziel " + target.mtype + " ignoriert (zu stark)");
        change_target(null);
        target = null;
    }

    if (!target) {
        target = get_nearest_monster({ type: farm, no_target: true });
        if (!target) { // sonst nur Monster, die niemand anderen anvisieren (kein Kill-Klau)
            var best_d = 1e9;
            for (var mid in parent.entities) {
                var m = parent.entities[mid];
                if (!m || m.type != "monster" || m.dead || m.mtype != farm) continue;
                if (m.target && m.target != character.name) continue;
                var d = distance(character, m); if (d < best_d) { best_d = d; target = m; }
            }
        }
        if (!target) {
            for (var id in parent.entities) { var e = parent.entities[id]; if (is_valid_target(e) && e.target == character.name) { target = e; break; } }
        }
        if (target) change_target(target); else { go_to_farm_spot(); return; }
    }

    if (!is_in_range(target)) move(character.x + (target.x - character.x) / 2, character.y + (target.y - character.y) / 2);
    else if (can_attack(target)) {
        if (!try_cburst()) { status_message(); attack(target); }
    }
}, 1000 / 4);
