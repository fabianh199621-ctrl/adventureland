// ===== Adventure Land – LogicPlan Jäger (F4llenHunt) =====
// Zweit-Magier, der nur Monsterjagden hält: folgt dem Magier in sicherem Abstand, greift nie an, flieht vor allem,
// holt bei Daisy die Jagd, das Team killt (Party-Kills zählen), er gibt ab und holt die nächste.
// Tokens setzt er in Set-Teile um, die dem Magier fehlen, und legt sie in die Bank.
var HUNTER_VERSION = "v197";
// Generationswechsel: wird das Skript per N neu eingespielt, beendet sich die alte Schleife von selbst (kein Neu-Einloggen)
try { window.__lp_gen = (window.__lp_gen || 0) + 1; } catch (e) {}
var MY_GEN = window.__lp_gen, HAD_OLD = MY_GEN > 1; // globale Namen werden beim Neu-Einspielen überschrieben, daher Generation lokal (g) festhalten

var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var FOLLOW_DIST = 220, FOLLOW_MAX = 320, FLEE_DIST = 260; // weiter hinten als der Priester: nichts soll uns treffen
var POT_MIN = 20, POT_BUY = 40, GOLD_MIN = 5000, GOLD_WANT = 30000;
var mage = null, p_paused = false, last_log = {}, last_status = 0, last_move = 0, moving = false, last_gold_ask = 0, last_pots_ask = 0;
var town_busy = false, last_town = 0, last_hunt_state = "";
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Jäger] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function mh_q() { return character.s && character.s.monsterhunt; }
function pot_count(kind) { var n = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name.indexOf(kind) == 0) n += it.q || 1; } return n; }
function have_item(n) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == n) return i; } return -1; }
function status(state) {
    if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now();
    var q = mh_q();
    try { send_cm(MAGE, { t: "st", level: character.level, state: character.rip ? "tot" : state, hp: character.hp, max_hp: character.max_hp, map: character.map, free: character.esize, gold: character.gold, tokens: pot_count("monstertoken"), hunt: (q ? { id: q.id, c: q.c || 0, ms: q.ms || 0 } : null), hunter: true }); } catch (e) {}
}
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") p_paused = data.paused; }
    else if (data.t == "state") p_paused = !!data.paused;
    else if (data.t == "join") { try { var jr = join(data.event); if (jr && typeof jr.then == "function") jr.then(function () { say("Event " + data.event + ": angekommen"); }, function () {}); } catch (e) {} }
}
function on_party_invite(name) { if (name == MAGE) { try { accept_party_invite(name); say_once("party", "Party mit " + MAGE + " angenommen", 3600000); } catch (e) {} } }
function on_party_request(name) { if (name == MAGE) { try { accept_party_request(name); } catch (e) {} } }
function mage_entity() { try { return get_player(MAGE); } catch (e) { return null; } }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function use_pot(kind) { var i = have_item(kind + "0") >= 0 ? have_item(kind + "0") : -1; if (i < 0) for (var k = 0; k < character.items.length; k++) { var it = character.items[k]; if (it && it.name.indexOf(kind) == 0) { i = k; break; } } if (i >= 0) { try { equip(i); return true; } catch (e) {} } return false; }
function my_attacker() { for (var id in parent.entities) { var m = parent.entities[id]; if (m && m.type == "monster" && !m.dead && m.target == character.name) return m; } return null; }
function nearest_threat(r) { var best = null, bd = r; for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead) continue; var d = dist(character, m); if (d < bd && (m.target == character.name || ((G.monsters[m.mtype] || {}).aggro > 0 && d < 150))) { bd = d; best = m; } } return best; }
function daisy_pos() { try { for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.npcs) continue; for (var i = 0; i < md.npcs.length; i++) { var n = md.npcs[i]; if (n.id == "monsterhunter" && n.position) return { map: map, x: n.position[0], y: n.position[1] }; } } } catch (e) {} return null; }
async function follow() { // hinter dem Magier bleiben, weit genug weg von seinem Kampf
    var t = mage_entity();
    if (t && character.map == t.map) {
        var d = dist(character, t);
        if (d > FOLLOW_MAX) { if (!moving) { moving = true; try { await smart_move({ map: t.map, x: t.x - (t.x - character.x) * FOLLOW_DIST / d, y: t.y - (t.y - character.y) * FOLLOW_DIST / d }); } catch (e) {} moving = false; } }
        else if (d > FOLLOW_DIST && !is_moving(character)) { try { move(character.x + (t.x - character.x) * 0.4, character.y + (t.y - character.y) * 0.4); } catch (e) {} }
        return;
    }
    if (mage && Date.now() - mage.t < 30000 && !moving && Date.now() - last_move > 8000) {
        last_move = Date.now(); moving = true; status("unterwegs zum Magier");
        try { await smart_move({ map: mage.map, x: mage.x, y: mage.y }); } catch (e) {}
        moving = false;
    }
}
function town_needed() { var q = mh_q(); return (!q || q.c == 0) && Date.now() - last_town > 3 * 60000; } // keine Jagd oder fertig -> zu Daisy
async function town_trip() { // Daisy: abgeben/holen; Tokens -> Set-Teile für den Magier -> Bank; Tränke
    town_busy = true; last_town = Date.now(); status("Stadt (Daisy)");
    try {
        var dp = daisy_pos(); if (!dp) { say("Daisy nicht gefunden"); return; }
        try { await smart_move({ map: dp.map, x: dp.x, y: dp.y + 20 }); } catch (e) { say("Weg zu Daisy: " + (e && e.reason || e)); return; }
        var q = mh_q(), t0 = pot_count("monstertoken");
        if (q && q.c == 0) { try { await interact("monsterhunt"); } catch (e) {} await sleep(800); say("Jagd abgegeben (+" + (pot_count("monstertoken") - t0) + " Tokens, " + pot_count("monstertoken") + " gesamt)"); }
        q = mh_q();
        if (!q) { try { await interact("monsterhunt"); } catch (e) {} await sleep(800); q = mh_q(); if (q) say("Neue Jagd: " + q.c + "x " + q.id + " (" + Math.round((q.ms || 0) / 60000) + " min)"); else say("Keine Jagd bekommen"); }
        // Tokens: fehlende Set-Teile des Magiers kaufen und in die Bank legen
        var miss = []; try { miss = JSON.parse(window.localStorage.getItem("lp_mh_missing") || "[]"); } catch (e) {}
        var bought = [];
        for (var i = 0; i < miss.length; i++) { var m = miss[i]; if (!m.cost || pot_count("monstertoken") < m.cost || character.esize < 2) continue; try { exchange_buy("monstertoken", m.name); await sleep(1500); } catch (e) {} if (have_item(m.name) >= 0) { bought.push(m.name); say("Tokens: " + m.name + " für " + MAGE + " gekauft (" + m.cost + ")"); } }
        if (bought.length) { try { await smart_move("bank"); await sleep(800); for (var b = 0; b < bought.length; b++) { var bi = have_item(bought[b]); if (bi >= 0) { bank_store(bi); await sleep(400); } } say("Tokens: " + bought.join(", ") + " in die Bank gelegt"); } catch (e) { say("Bank: " + (e && e.message || e)); } }
        // Tränke
        if (pot_count("hpot") < POT_MIN && character.gold >= POT_BUY * 100) { try { await smart_move("potions"); await buy("hpot0", POT_BUY); await sleep(500); say("Tränke gekauft: " + POT_BUY); } catch (e) {} }
    } catch (e) { say("Stadtgang: " + (e && e.message || e)); }
    town_busy = false;
}
async function tick() {
    if (character.rip) { status("tot"); await sleep(15000); try { respawn(); } catch (e) {} await sleep(5000); return; }
    if (town_busy) return;
    var hpr = character.hp / character.max_hp;
    if (hpr < 0.6) { if (!use_pot("hpot")) { try { use_skill("regen_hp"); } catch (e) {} } }
    // Flucht: irgendetwas hat uns im Visier oder ein aggressives Monster ist nah -> vom Monster weg, Richtung Magier
    var thr = nearest_threat(FLEE_DIST);
    if (thr) { var t = mage_entity(); var dx = character.x - thr.x, dy = character.y - thr.y, l = Math.hypot(dx, dy) || 1; var tx = character.x + dx / l * 220, ty = character.y + dy / l * 220; if (t && character.map == t.map && dist(thr, t) > dist(character, t)) { tx = t.x; ty = t.y; } try { move(tx, ty); } catch (e) {} status("weicht aus"); return; }
    if (town_needed() && !moving) { await town_trip(); return; }
    if (character.gold < GOLD_MIN && mage && Date.now() - last_gold_ask > 5 * 60000) { var mg = mage_entity(); if (mg && character.map == mg.map && dist(character, mg) < 350) { last_gold_ask = Date.now(); try { send_cm(MAGE, { t: "gold?", amount: GOLD_WANT }); } catch (e) {} } }
    var q = mh_q(), hs = q ? (q.id + ":" + q.c) : "keine";
    if (hs != last_hunt_state) { last_hunt_state = hs; last_status = 0; }
    status(q && q.c > 0 ? "Jagd " + q.id + " " + q.c : q ? "Jagd fertig" : "keine Jagd");
    await follow();
}
try { window.on_cm = on_cm; window.on_party_invite = on_party_invite; window.on_party_request = on_party_request; } catch (e) {}
var __dead_since = 0, __dead_logged = false;
(function (g) { var __watch = setInterval(function () {
    if (window.__lp_gen != g) { clearInterval(__watch); return; }
    try {
        if (character.rip) {
            if (!__dead_since) __dead_since = Date.now();
            if (!__dead_logged) { __dead_logged = true; say("gestorben (" + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + ") – Wiederbelebung in 15 s"); }
            if (Date.now() - __dead_since > 15000) { try { respawn(); } catch (e) {} try { if (Date.now() - __dead_since > 40000 && parent.socket) parent.socket.emit("respawn"); } catch (e) {} }
        } else if (__dead_since) { __dead_since = 0; __dead_logged = false; say("wieder da (Lv " + character.level + ")"); }
    } catch (e) {}
}, 3000); })(MY_GEN);
try { send_cm(MAGE, { t: "hello", v: HUNTER_VERSION }); } catch (e) {}
say("Jäger " + HUNTER_VERSION + " gestartet (Lv " + character.level + ", " + pot_count("monstertoken") + " Tokens)");
(async function () { var g = MY_GEN; if (HAD_OLD) { say("neue Version " + HUNTER_VERSION + " übernommen"); await sleep(1500); } while (window.__lp_gen == g) { try { await tick(); } catch (e) { say_once("err", "Fehler: " + (e && e.message ? e.message : e), 60000); } await sleep(300); } })();
