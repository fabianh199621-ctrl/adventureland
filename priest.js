// ===== Adventure Land – LogicPlan Priester (F4llenPriest) – Stufe 1 =====
// Folgt dem Magier, heilt ihn und sich, nimmt die Party-Einladung an, greift erst ab PRIEST_ATTACK_LEVEL mit an.
// Meldungen gehen per Charakter-Nachricht an den Magier ("[Priest] …").
var PRIEST_VERSION = "v149";
var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var PRIEST_ATTACK_LEVEL = 20;      // vorher nur folgen und heilen
var FOLLOW_DIST = 120, FOLLOW_MAX = 220;
var HEAL_MAGE_BELOW = 0.75, HEAL_SELF_BELOW = 0.6, FLEE_BELOW = 0.35;
var mage = null, p_paused = false, last_log = {}, last_status = 0, last_move = 0, last_pots_ask = 0, moving = false;
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Priest] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: state, hp: character.hp, max_hp: character.max_hp, map: character.map }); } catch (e) {} }
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") p_paused = data.paused; }
    else if (data.t == "state") p_paused = !!data.paused;
}
function on_party_invite(name) { if (name == MAGE) { try { accept_party_invite(name); say_once("party", "Party mit " + MAGE + " angenommen", 3600000); } catch (e) {} } }
function on_party_request(name) { if (name == MAGE) { try { accept_party_request(name); } catch (e) {} } }
function mage_entity() { try { return get_player(MAGE); } catch (e) { return null; } }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function has_pot(kind) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name.indexOf(kind) == 0) return i; } return -1; }
function use_pot(kind) { var i = has_pot(kind); if (i >= 0) { try { equip(i); return true; } catch (e) {} } return false; }
function my_attacker() { for (var id in parent.entities) { var m = parent.entities[id]; if (m && m.type == "monster" && !m.dead && m.target == character.name) return m; } return null; }
async function follow() { // hinter dem Magier bleiben, Karte wechseln, wenn nötig
    var t = mage_entity();
    if (t && character.map == t.map) {
        var d = dist(character, t);
        if (d > FOLLOW_MAX) { if (!moving) { moving = true; try { await smart_move({ map: t.map, x: t.x - (t.x - character.x) * FOLLOW_DIST / d, y: t.y - (t.y - character.y) * FOLLOW_DIST / d }); } catch (e) {} moving = false; } }
        else if (d > FOLLOW_DIST && !is_moving(character)) { try { move(character.x + (t.x - character.x) * 0.5, character.y + (t.y - character.y) * 0.5); } catch (e) {} }
        return;
    }
    if (mage && Date.now() - mage.t < 30000 && !moving && Date.now() - last_move > 8000) { // Magier nicht in Sicht: zu seiner gemeldeten Position
        last_move = Date.now(); moving = true; status("unterwegs zum Magier");
        try { await smart_move({ map: mage.map, x: mage.x, y: mage.y }); } catch (e) {}
        moving = false;
    }
}
function heal_target(t) { try { if (typeof heal == "function") heal(t); else use_skill("heal", t); return true; } catch (e) { return false; } }
async function tick() {
    if (character.rip) { status("tot"); await sleep(15000); try { respawn(); } catch (e) {} await sleep(5000); return; }
    if (p_paused) { status("Pause"); if (is_moving(character)) { try { stop("move"); stop("smart"); } catch (e) {} } return; }
    // Selbstschutz
    var hpr = character.hp / character.max_hp, mpr = character.mp / character.max_mp;
    if (hpr < HEAL_SELF_BELOW) { if (can_use("heal") && character.mp > 30) heal_target(character); else if (!use_pot("hpot")) { try { use_skill("regen_hp"); } catch (e) {} } }
    if (mpr < 0.3) { if (!use_pot("mpot")) { try { use_skill("regen_mp"); } catch (e) {} } }
    if (has_pot("hpot") < 0 && mage && Date.now() - last_pots_ask > 5 * 60000) { var me = mage_entity(); if (me && character.map == me.map && dist(character, me) < 350) { last_pots_ask = Date.now(); try { send_cm(MAGE, { t: "pots?" }); } catch (e) {} } }
    var att = my_attacker();
    if (att && hpr < FLEE_BELOW) { var me2 = mage_entity(); if (me2) { try { move(me2.x, me2.y); } catch (e) {} } status("flieht"); return; }
    // Magier heilen
    var t = mage_entity();
    if (t && !t.rip && t.hp / t.max_hp < HEAL_MAGE_BELOW && dist(character, t) <= (G.skills.heal && G.skills.heal.range || 200) && can_use("heal") && character.mp > 30) { heal_target(t); status("heilt"); return; }
    // Party-Heilung, wenn beide angeschlagen
    if (t && hpr < 0.7 && t.hp / t.max_hp < 0.7 && can_use("partyheal") && character.mp > 400) { try { use_skill("partyheal"); } catch (e) {} }
    // Mitkämpfen ab bestimmtem Level: das Ziel des Magiers oder meinen Angreifer
    if (character.level >= PRIEST_ATTACK_LEVEL || att) {
        var tgt = att; if (!tgt && mage && mage.tgt && parent.entities[mage.tgt] && !parent.entities[mage.tgt].dead) tgt = parent.entities[mage.tgt];
        if (tgt && is_in_range(tgt) && can_attack(tgt)) { try { attack(tgt); } catch (e) {} status("kämpft"); return; }
    }
    status(t ? "bei dir" : "sucht dich");
    await follow();
}
try { window.on_cm = on_cm; if (typeof on_party_invite == "function") window.on_party_invite = on_party_invite; if (typeof on_party_request == "function") window.on_party_request = on_party_request; } catch (e) {}
try { send_cm(MAGE, { t: "hello", v: PRIEST_VERSION }); } catch (e) {}
say("Priester " + PRIEST_VERSION + " gestartet (Lv " + character.level + ")");
(async function () { while (true) { try { await tick(); } catch (e) { say_once("err", "Fehler: " + (e && e.message ? e.message : e), 60000); } await sleep(300); } })();
