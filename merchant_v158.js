// ===== Adventure Land – LogicPlan Händler (F4llenMerch) – Stufe 1 =====
// Läuft unsichtbar neben dem Magier. Aufgaben: Stand kaufen und öffnen, dem Magier regelmäßig mluck geben,
// Startgold vom Magier holen. Meldungen gehen per Charakter-Nachricht an den Magier und erscheinen dort als "[Merch] …".
var MERCH_VERSION = "v158";
var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var STAND_ITEM = "stand0";
var MLUCK_EVERY = 25 * 60000;      // mluck hält 60 min, wir frischen ab 25 min Restlaufzeit auf
var GOLD_WANT = 100000, GOLD_MIN = 60000;
var MLUCK_LEVEL = (G.skills.mluck && G.skills.mluck.level) || 40; // mluck erst ab diesem Level: bis dahin in der Party beim Magier mitleveln
var FOLLOW_DIST = 140, FOLLOW_MAX = 240, moving = false, last_follow_move = 0;
var mage = null;                   // letzte Meldung des Magiers { map, x, y, mluck, paused, t }
var m_paused = false, task = null, last_log = {}, stand_pos = null, last_mluck_try = 0, last_gold_ask = 0, last_status = 0, started = Date.now();
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Merch] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: state, gold: character.gold, stand: !!character.stand, map: character.map, hp: character.hp, max_hp: character.max_hp }); } catch (e) {} }
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") m_paused = data.paused; }
    else if (data.t == "state") { m_paused = !!data.paused; }
    else if (data.t == "nogold") { if (!data.near) say_once("nogold", "Gold: Magier nicht in Reichweite"); }
}
function on_party_invite(name) { if (name == MAGE) { try { accept_party_invite(name); say_once("party", "Party mit " + MAGE + " angenommen (mitleveln bis Lv " + MLUCK_LEVEL + ")", 3600000); } catch (e) {} } }
function on_party_request(name) { if (name == MAGE) { try { accept_party_request(name); } catch (e) {} } }
function my_attacker() { for (var id in parent.entities) { var m = parent.entities[id]; if (m && m.type == "monster" && !m.dead && m.target == character.name) return m; } return null; }
async function follow_mage() { // in der Level-Phase hinter dem Magier bleiben (Abstand halten, nie angreifen)
    var t = mage_entity();
    if (t && character.map == t.map) {
        var d = Math.hypot(character.x - t.x, character.y - t.y);
        if (d > FOLLOW_MAX && !moving) { moving = true; try { await smart_move({ map: t.map, x: t.x - (t.x - character.x) * FOLLOW_DIST / d, y: t.y - (t.y - character.y) * FOLLOW_DIST / d }); } catch (e) {} moving = false; }
        return;
    }
    if (mage && Date.now() - mage.t < 30000 && !moving && Date.now() - last_follow_move > 8000) { last_follow_move = Date.now(); moving = true; try { await smart_move({ map: mage.map, x: mage.x, y: mage.y }); } catch (e) {} moving = false; }
}
function npc_pos(id) { // Position eines NPCs aus den Kartendaten
    for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.npcs) continue; for (var i = 0; i < md.npcs.length; i++) { var n = md.npcs[i]; if (n.id == id && n.position) return { map: map, x: n.position[0], y: n.position[1] }; } }
    return null;
}
function npc_selling(item) { for (var id in G.npcs) { var n = G.npcs[id]; if (n && n.items && n.items.indexOf(item) >= 0) return id; } return null; }
function home_spot() { // Standplatz: neben dem Startpunkt der Stadt
    if (stand_pos) return stand_pos;
    var sp = G.maps.main && G.maps.main.spawns && G.maps.main.spawns[0];
    stand_pos = sp ? { map: "main", x: sp[0] + 60, y: sp[1] - 30 } : { map: "main", x: 0, y: -60 };
    return stand_pos;
}
function dist_to(p) { return character.map != p.map ? 1e9 : Math.hypot(character.x - p.x, character.y - p.y); }
async function go(p, tol) { // hinlaufen, mit Wiederholung
    for (var i = 0; i < 3; i++) { if (dist_to(p) <= (tol || 40)) return true; try { await smart_move({ map: p.map, x: p.x, y: p.y }); } catch (e) { await sleep(1500); } }
    return dist_to(p) <= (tol || 40) + 60;
}
function stand_open() { return !!character.stand; }
function stand_on() { var i = locate_item(STAND_ITEM); if (i < 0) return false; try { if (typeof open_stand == "function") open_stand(i); else if (typeof parent.open_merchant == "function") parent.open_merchant(i); else throw "keine Stand-Funktion"; return true; } catch (e) { say_once("stand_err", "Stand öffnen: " + e); return false; } }
function stand_off() { try { if (typeof close_stand == "function") close_stand(); else if (typeof parent.close_merchant == "function") parent.close_merchant(); } catch (e) {} }
function mage_entity() { try { return get_player(MAGE); } catch (e) { return null; } }
function mluck_needed() { // Magier ohne mluck, mit fremdem mluck oder unter 25 min Rest
    if (!mage) return false; var ml = mage.mluck;
    if (!ml) return true; if (ml.f && ml.f != character.name) return true; return (ml.ms || 0) < MLUCK_EVERY;
}
async function do_buy_stand() {
    var npc = npc_selling(STAND_ITEM), price = G.items[STAND_ITEM] ? G.items[STAND_ITEM].g : 0;
    if (!npc) { say_once("nostandnpc", "Kein NPC verkauft " + STAND_ITEM); return; }
    if (character.gold < price) { say_once("standgold", "Stand kostet " + price + ", habe " + character.gold + " – warte auf Gold vom Magier"); return; }
    var pos = npc_pos(npc); if (!pos) { say_once("nostandpos", "NPC " + npc + " nicht gefunden"); return; }
    say("Kaufe Stand bei " + npc); await go(pos, 60);
    try { await buy(STAND_ITEM, 1); await sleep(800); } catch (e) { say("Standkauf: " + e); }
    if (locate_item(STAND_ITEM) >= 0) say("Stand gekauft");
}
async function do_mluck() {
    if (!mage) return;
    last_mluck_try = Date.now();
    stand_off();
    say("Gehe zum Magier für mluck (" + mage.map + " " + mage.x + "," + mage.y + ")");
    for (var i = 0; i < 4; i++) {
        var tgt = mage_entity();
        if (tgt && character.map == tgt.map && Math.hypot(character.x - tgt.x, character.y - tgt.y) < 300) break;
        var p = tgt && character.map == tgt.map ? { map: tgt.map, x: tgt.x, y: tgt.y } : { map: mage.map, x: mage.x, y: mage.y };
        await go(p, 120);
        if (mage && Date.now() - mage.t < 10000 && (mage.map != p.map || Math.hypot(mage.x - p.x, mage.y - p.y) > 200)) continue; // Magier ist weitergezogen
    }
    var t = mage_entity();
    if (!t) { say("Magier nicht in Sicht – mluck später"); return; }
    var ok = false;
    for (var k = 0; k < 6; k++) {
        t = mage_entity() || t; var dd = character.map == t.map ? Math.hypot(character.x - t.x, character.y - t.y) : 1e9;
        if (dd > 250) { await go({ map: t.map, x: t.x, y: t.y }, 150); continue; } // dranbleiben, falls der Magier weiterzieht
        var why = null;
        try { var r = await use_skill("mluck", t); if (r && r.failed) throw r; say("mluck auf " + MAGE + " gegeben"); ok = true; break; } catch (e) { why = e && (e.reason || e.message || (typeof e == "string" ? e : JSON.stringify(e).slice(0, 120))); await sleep(1200); }
    }
    if (!ok) { var sk = G.skills.mluck || {}; say_once("mluckfail", "mluck nicht gelungen: " + (why || "unbekannt") + " (Abstand " + Math.round(character.map == t.map ? Math.hypot(character.x - t.x, character.y - t.y) : -1) + ", Skill ab Lv " + (sk.level || "?") + ", Reichweite " + (sk.range || "?") + ", Magier-mluck von " + (mage && mage.mluck ? mage.mluck.f + (mage.mluck.strong ? " (stark)" : "") : "-") + ")", 120000); }
    // Gold holen, wenn wir schon hier sind
    if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 120000) { last_gold_ask = Date.now(); try { send_cm(MAGE, { t: "gold?", amount: GOLD_WANT }); } catch (e) {} await sleep(1500); }
}
async function do_home() {
    var h = home_spot();
    if (dist_to(h) > 60) { say_once("home", "Zurück zum Stand", 300000); await go(h, 40); }
    if (!stand_open() && locate_item(STAND_ITEM) >= 0) { if (stand_on()) say_once("standopen", "Stand geöffnet", 3600000); }
}
async function loop() {
    while (true) {
        try {
            if (character.rip) { stand_off(); await sleep(15000); respawn(); await sleep(5000); continue; }
            if (m_paused) { if (stand_open()) stand_off(); status("Pause"); await sleep(3000); continue; }
            if (locate_item(STAND_ITEM) < 0) { status("kein Stand"); await do_buy_stand(); if (locate_item(STAND_ITEM) < 0 && mage && character.gold < (G.items[STAND_ITEM].g || 0) && Date.now() - last_gold_ask > 120000) { await do_mluck(); } await sleep(5000); continue; }
            if (character.level < MLUCK_LEVEL) { // Level-Phase: Stand zu, beim Magier mitlaufen (Party-XP), bei Angriff zum Magier flüchten
                if (stand_open()) stand_off();
                say_once("levelmode", "Lv " + character.level + " – mluck erst ab Lv " + MLUCK_LEVEL + ", levle in der Party beim Magier mit", 1800000);
                if (character.hp < character.max_hp * 0.5) { var hp_i = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && /^hpot/.test(it.name)) { hp_i = i; break; } } if (hp_i >= 0) { try { equip(hp_i); } catch (e) {} } else { try { use_skill("regen_hp"); } catch (e) {} } }
                var att = my_attacker(); var me = mage_entity();
                if (att && me && character.map == me.map) { try { move(me.x, me.y); } catch (e) {} status("flieht"); await sleep(500); continue; }
                status("levelt"); await follow_mage(); await sleep(1000); continue;
            }
            if (mluck_needed() && Date.now() - last_mluck_try > 5 * 60000 && !mage.paused) { status("mluck"); await do_mluck(); continue; }
            if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 30 * 60000) { status("Gold holen"); await do_mluck(); continue; }
            status(stand_open() ? "Stand" : "unterwegs");
            await do_home();
        } catch (e) { say("Fehler: " + (e && e.message ? e.message : e)); }
        await sleep(3000);
    }
}
try { window.on_cm = on_cm; if (typeof on_party_invite == "function") window.on_party_invite = on_party_invite; if (typeof on_party_request == "function") window.on_party_request = on_party_request; } catch (e) {}
try { send_cm(MAGE, { t: "hello", v: MERCH_VERSION }); } catch (e) {}
say("Händler " + MERCH_VERSION + " gestartet (Lv " + character.level + ", " + character.gold + " Gold" + (locate_item(STAND_ITEM) >= 0 ? ", Stand vorhanden" : ", kein Stand") + ")");
loop();
