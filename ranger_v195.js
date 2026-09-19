// ===== Adventure Land – LogicPlan Ranger (F4llenRanger) =====
// Folgt dem Magier, greift dessen Ziel an (Supershot, Hunter's Mark, 3-/5-Shot), versorgt sich selbst mit NPC-Ausrüstung und Tränken.
// Meldungen gehen per Charakter-Nachricht an den Magier ("[Ranger] …").
var RANGER_VERSION = "v195";
// Generationswechsel: wird das Skript per N neu eingespielt, beendet sich die alte Schleife von selbst (kein Neu-Einloggen)
try { window.__lp_gen = (window.__lp_gen || 0) + 1; } catch (e) {}
var MY_GEN = window.__lp_gen, HAD_OLD = MY_GEN > 1; // Achtung: globale Namen werden beim Neu-Einspielen überschrieben, daher Generation immer lokal (g) festhalten

var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var RANGER_ATTACK_LEVEL = 1; // greift von Anfang an mit an (Fernkampf)
var FOLLOW_DIST = 120, FOLLOW_MAX = 220;
var HEAL_SELF_BELOW = 0.6, FLEE_BELOW = 0.35;
var mage = null, p_paused = false, last_log = {}, last_status = 0, last_move = 0, last_pots_ask = 0, moving = false;
var GEAR_SLOTS = ["helmet", "chest", "pants", "shoes", "gloves", "mainhand"], POT_MIN = 30, POT_BUY = 80, GOLD_WANT = 100000, GOLD_MIN = 20000;
var shopping = false, last_shop = 0, last_gold_ask = 0;
function pot_count(kind) { var n = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name.indexOf(kind) == 0) n += it.q || 1; } return n; }
function npc_pos(id) { for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.npcs) continue; for (var i = 0; i < md.npcs.length; i++) { var n = md.npcs[i]; if (n.id == id && n.position) return { map: map, x: n.position[0], y: n.position[1] }; } } return null; }
function npc_selling(item) { for (var id in G.npcs) { var n = G.npcs[id]; if (n && n.items && n.items.indexOf(item) >= 0) return id; } return null; }
function fits(def, slot) { if (!def || def.ignore) return false; if (def.class && def.class.indexOf("ranger") < 0) return false; if (slot == "mainhand") return def.type == "weapon" && (def.wtype == "bow" || def.wtype == "crossbow"); return def.type == slot; }
function cheapest_for(slot) { // günstigstes NPC-Teil, das in den Slot passt
    var best = null;
    for (var n in G.items) { var d = G.items[n]; if (!fits(d, slot) || !d.g || d.g > 60000) continue; var npc = npc_selling(n); if (!npc) continue; if (!best || d.g < best.g) best = { name: n, g: d.g, npc: npc }; }
    return best;
}
function missing_gear() { return GEAR_SLOTS.filter(function (sl) { return !character.slots[sl]; }); }
function junk_items() { // Ausrüstung, die die Automatik nie anlegen würde: nicht getragen und nicht besser als das Getragene (oder nicht für meine Klasse)
    var out = [];
    for (var i = 0; i < character.items.length; i++) {
        var it = character.items[i]; if (!it) continue; var d = G.items[it.name]; if (!d || /^(hpot|mpot)/.test(it.name)) continue;
        if (!(d.type && ALL_SLOTS_TYPES[d.type]) && !d.wtype) continue; // keine Ausrüstung
        var useful = false, fits_me = false;
        for (var slot in ALL_SLOTS) { if (!fits_any(d, slot)) continue; fits_me = true; var worn = character.slots[slot]; var ws = worn ? gear_score(G.items[worn.name], worn.level || 0, worn.stat_type) : 0; if (gear_score(d, it.level || 0, it.stat_type) > ws * 1.02) useful = true; }
        if (!useful || !fits_me) out.push(i);
    }
    return out;
}
var ALL_SLOTS_TYPES = { helmet: 1, chest: 1, pants: 1, shoes: 1, gloves: 1, cape: 1, weapon: 1, ring: 1, earring: 1, amulet: 1, belt: 1, orb: 1, quiver: 1, shield: 1, source: 1, misc_offhand: 1 };
function shop_needed() { return pot_count("hpot") < POT_MIN || pot_count("mpot") < POT_MIN || missing_gear().length > 0 || (character.esize < 3 && junk_items().length > 0); }
async function go_shopping() { // in die Stadt: fehlende Ausrüstung und Tränke kaufen, dann zurück
    shopping = true; last_shop = Date.now();
    try {
        for (var w = 0; w < 20 && moving; w++) await sleep(500); // laufende Folge-Bewegung ausklingen lassen
        try { stop("smart"); stop("move"); } catch (e) {}
        var plan = [];
        missing_gear().forEach(function (sl) { var c = cheapest_for(sl); if (c) plan.push(c); });
        var cost = plan.reduce(function (a, c) { return a + c.g; }, 0) + 2 * POT_BUY * 100;
        if (character.gold < cost) { say_once("shopgold", "Einkauf braucht " + cost + " Gold, habe " + character.gold + " – warte auf Gold", 300000); return; }
        say("Einkauf: " + (plan.length ? plan.map(function (c) { return c.name; }).join(", ") + " und " : "") + "Tränke");
        status("kauft ein");
        var by_npc = {}; plan.forEach(function (c) { (by_npc[c.npc] = by_npc[c.npc] || []).push(c); });
        for (var npc in by_npc) { var pos = npc_pos(npc); if (!pos) continue; try { await smart_move({ map: pos.map, x: pos.x, y: pos.y + 20 }); } catch (e) {} for (var i = 0; i < by_npc[npc].length; i++) { try { await buy(by_npc[npc][i].name, 1); await sleep(400); } catch (e) { say("Kauf " + by_npc[npc][i].name + ": " + (e && e.reason || e)); } } }
        if (pot_count("hpot") < POT_MIN || pot_count("mpot") < POT_MIN) {
            var okp = false;
            for (var tr = 0; tr < 3 && !okp; tr++) {
                try { await smart_move("potions"); } catch (e) {}
                try { await buy("hpot0", POT_BUY); await buy("mpot0", POT_BUY); await sleep(500); okp = pot_count("hpot") >= POT_MIN; if (okp) say("Tränke gekauft: " + POT_BUY + "/" + POT_BUY); } catch (e) { var pn = npc_selling("hpot0"), pp = pn && npc_pos(pn); say_once("potfail", "Tränke: " + (e && e.reason || e) + (pp && character.map == pp.map ? " (Abstand " + Math.round(Math.hypot(character.x - pp.x, character.y - pp.y)) + ")" : " (Karte " + character.map + ")"), 120000); await sleep(1500); }
            }
        }
        // ersetzte/überflüssige Ausrüstung beim NPC verkaufen
        var junk = junk_items();
        if (junk.length) { try { await smart_move("potions"); for (var j3 = junk.length - 1; j3 >= 0; j3--) { var ij3 = character.items[junk[j3]]; if (ij3) { try { sell(junk[j3], ij3.q || 1); } catch (e) {} await sleep(300); } } say("Alte Ausrüstung verkauft: " + junk.length); } catch (e) {} }
        // anlegen
        for (var i2 = 0; i2 < character.items.length; i2++) { var it = character.items[i2]; if (!it) continue; var d = G.items[it.name]; for (var k = 0; k < GEAR_SLOTS.length; k++) { var sl = GEAR_SLOTS[k]; if (!character.slots[sl] && fits(d, sl)) { try { equip(i2); await sleep(400); say(it.name + " angelegt"); } catch (e) {} break; } } }
    } catch (e) { say("Einkauf-Fehler: " + (e && e.message ? e.message : e)); }
    shopping = false;
}
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Ranger] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function worn_summary() { var o = {}; for (var sl in character.slots) { var it = character.slots[sl]; if (it && sl.indexOf("trade") != 0) o[sl] = { name: it.name, level: it.level || 0 }; } return o; }
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: character.rip ? "tot" : state, hp: character.hp, max_hp: character.max_hp, mp_pct: character.mp / character.max_mp, map: character.map, free: character.esize, attack: character.attack, frequency: character.frequency, slots: worn_summary() }); } catch (e) {} }
var gear_incoming = [];
async function equip_incoming() { // vom Magier erhaltene Teile anlegen, ersetzte Teile beim nächsten Einkauf verkaufen
    while (gear_incoming.length) {
        var g = gear_incoming.shift(); var idx = -1;
        for (var w = 0; w < 10 && idx < 0; w++) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == g.name && (it.level || 0) == g.level) { idx = i; break; } } if (idx < 0) await sleep(500); }
        if (idx < 0) { say("Teil " + g.name + " nicht angekommen"); continue; }
        try { equip(idx, g.slot); await sleep(600); if (g.manual) manual_choice[g.slot] = g.name + "+" + g.level; say(g.name + "+" + g.level + " angelegt (" + g.slot + (g.manual ? ", von dir gewählt – bleibt an" : "") + ")"); } catch (e) { say("Anlegen " + g.name + ": " + (e && e.reason || e)); }
    }
    last_autoequip = 0; try { await auto_equip(); } catch (e) {}
    try { send_cm(MAGE, { t: "st", level: character.level, state: last_state || "bei dir", hp: character.hp, max_hp: character.max_hp, mp_pct: character.mp / character.max_mp, map: character.map, free: character.esize, attack: character.attack, frequency: character.frequency, slots: worn_summary() }); } catch (e) {}
}
// ---------- Auto-Anlegen: besseres Teil im Inventar (egal woher) wird angelegt ----------
var ALL_SLOTS = { helmet: "helmet", chest: "chest", pants: "pants", shoes: "shoes", gloves: "gloves", cape: "cape", mainhand: "weapon", offhand: "offhand", ring1: "ring", ring2: "ring", earring1: "earring", earring2: "earring", amulet: "amulet", belt: "belt", orb: "orb" };
function main_stat() { return character.ctype == "priest" || character.ctype == "mage" ? "int" : character.ctype == "warrior" ? "str" : "dex"; }
function stat_w(st, stat_type) { var ms = main_stat(), main = st[ms] || 0, ok = !stat_type || stat_type == ms; return (main + (ok ? (st.stat || 0) : 0)) * 30 + (st.attack || 0) * 3 + (st.range || 0) * 0.5 + (st.frequency || 0) * 5 + (st.hp || 0) * 0.05 + (st.mp || 0) * 0.1 + (st.armor || 0) * 0.5 + (st.resistance || 0) * 0.5 + (st.rpiercing || 0) * 0.8; }
function gear_score(def, level, stat_type) { if (!def) return 0; var sc = stat_w(def, stat_type), lv = level || 0; if (lv > 0) { if (def.upgrade) sc += lv * stat_w(def.upgrade, stat_type); else if (def.compound) sc += lv * stat_w(def.compound, stat_type); } return sc; }
function fits_any(def, slot) { // Klassenregeln des Spiels (G.classes) statt fester Liste
    var t = ALL_SLOTS[slot]; if (!t || !def || def.ignore) return false; if (def.class && def.class.indexOf(character.ctype) < 0) return false;
    var cl = G.classes[character.ctype] || {};
    if (t == "weapon") return !!def.wtype && !!(cl.mainhand || {})[def.wtype];
    if (t == "offhand") return !!(cl.offhand || {})[def.type];
    return def.type == t;
}
var last_autoequip = 0, autoequip_busy = false, manual_choice = {}; // manual_choice[slot]: vom Spieler gegebenes Teil, wird nicht durch die Automatik ersetzt
async function auto_equip() { // alle 30 s: pro Slot das beste Teil aus Inventar + getragen anlegen
    if (autoequip_busy || shopping || character.rip || Date.now() - last_autoequip < 30000) return; last_autoequip = Date.now(); autoequip_busy = true;
    try {
        var used = {}, n = 0;
        for (var slot in ALL_SLOTS) {
            var worn = character.slots[slot]; if (worn && manual_choice[slot] == worn.name + "+" + (worn.level || 0)) continue;
            var ws = worn ? gear_score(G.items[worn.name], worn.level || 0, worn.stat_type) : 0, best = null;
            for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || used[i]) continue; var d = G.items[it.name]; if (!fits_any(d, slot)) continue; var sc = gear_score(d, it.level || 0, it.stat_type); if (sc > ws * 1.02 && sc > 0 && (!best || sc > best.sc)) best = { i: i, sc: sc }; }
            if (!best) continue;
            var it2 = character.items[best.i]; used[best.i] = true;
            try { equip(best.i, slot); await sleep(700); n++; say(it2.name + "+" + (it2.level || 0) + " angelegt (" + slot + (worn ? ", statt " + worn.name + "+" + (worn.level || 0) : "") + ")"); } catch (e) { say("Anlegen " + it2.name + ": " + (e && e.reason || e)); }
        }
    } catch (e) { say_once("aeq", "Auto-Anlegen: " + (e && e.message ? e.message : e), 60000); }
    autoequip_busy = false;
}
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") p_paused = data.paused; }
    else if (data.t == "state") p_paused = !!data.paused;
    else if (data.t == "gear") { gear_incoming.push(data); if (gear_incoming.length == 1) setTimeout(equip_incoming, 800); }
    else if (data.t == "join") { try { var jr = join(data.event); if (jr && typeof jr.then == "function") jr.then(function () { say("Event " + data.event + ": angekommen"); }, function (e) { say("Event-Sprung fehlgeschlagen: " + (e && e.reason || JSON.stringify(e).slice(0, 80))); }); } catch (e) { say("Event-Sprung: " + (e && e.message || e)); } }
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
var last_mark = 0;
function skill_ready(name) { var sk = G.skills[name]; if (!sk) return false; if (sk.level && character.level < sk.level) return false; if (sk.mp && character.mp < sk.mp + 50) return false; try { return can_use(name); } catch (e) { return false; } }
function targets_near(n) { var out = []; for (var id in parent.entities) { var m = parent.entities[id]; if (m && m.type == "monster" && !m.dead && is_in_range(m) && (m.target == character.name || m.target == MAGE || (mage && mage.tgt == m.id))) out.push(m); } return out.slice(0, n); }
async function tick() {
    if (character.rip) { status("tot"); await sleep(15000); try { respawn(); } catch (e) {} await sleep(5000); return; }
    // Pause des Magiers: trotzdem folgen, heilen, verteidigen und sein Ziel mitangreifen (volle Unterstützung beim manuellen Spielen)
    var hpr = character.hp / character.max_hp, mpr = character.mp / character.max_mp;
    if (hpr < HEAL_SELF_BELOW) { if (!use_pot("hpot")) { try { use_skill("regen_hp"); } catch (e) {} } }
    if (mpr < 0.3) { if (!use_pot("mpot")) { try { use_skill("regen_mp"); } catch (e) {} } }
    if (shopping) return;
    if (!my_attacker() && Date.now() - last_autoequip > 30000) { await auto_equip(); }
    if (character.gold < GOLD_MIN && mage && Date.now() - last_gold_ask > 3 * 60000) { var mg = mage_entity(); if (mg && character.map == mg.map && dist(character, mg) < 350) { last_gold_ask = Date.now(); try { send_cm(MAGE, { t: "gold?", amount: GOLD_WANT }); } catch (e) {} } }
    if (shop_needed() && character.gold >= GOLD_MIN && Date.now() - last_shop > 5 * 60000 && !my_attacker() && !moving) { go_shopping(); return; }
    if (has_pot("hpot") < 0 && character.gold < GOLD_MIN && mage && Date.now() - last_pots_ask > 5 * 60000) { var me = mage_entity(); if (me && character.map == me.map && dist(character, me) < 350) { last_pots_ask = Date.now(); try { send_cm(MAGE, { t: "pots?" }); } catch (e) {} } }
    var att = my_attacker(), t = mage_entity();
    if (att && ((att.attack || (G.monsters[att.mtype] || {}).attack || 0) >= character.max_hp * 0.5)) { var dxo = character.x - att.x, dyo = character.y - att.y, lo = Math.hypot(dxo, dyo) || 1; try { move(character.x + dxo / lo * 200, character.y + dyo / lo * 200); } catch (e) {} status("weicht Boss aus"); return; } // Ein-Treffer-Gegner (Giga Crab): sofort weg
    if (att && hpr < FLEE_BELOW) { if (t) { try { move(t.x, t.y); } catch (e) {} } status("flieht"); return; }
    // Kampf: eigener Angreifer zuerst, sonst das Ziel des Magiers
    var tgt = att; if (!tgt && mage && mage.tgt && parent.entities[mage.tgt] && !parent.entities[mage.tgt].dead) tgt = parent.entities[mage.tgt];
    if (tgt && !character.slots.mainhand) { status("ohne Bogen"); await follow(); return; }
    if (tgt && is_in_range(tgt)) {
        var multi = targets_near(5);
        if (multi.length >= 5 && skill_ready("5shot")) { try { use_skill("5shot", multi); } catch (e) {} }
        else if (multi.length >= 3 && skill_ready("3shot")) { try { use_skill("3shot", multi.slice(0, 3)); } catch (e) {} }
        else if (skill_ready("supershot")) { try { use_skill("supershot", tgt); } catch (e) {} }
        if (tgt.hp > character.attack * 8 && Date.now() - last_mark > 8000 && skill_ready("huntersmark")) { last_mark = Date.now(); try { use_skill("huntersmark", tgt); } catch (e) {} }
        if (can_attack(tgt)) { try { attack(tgt); } catch (e) {} }
        status("kämpft"); return;
    }
    if (tgt && !is_in_range(tgt) && dist(character, tgt) < 400 && !is_moving(character)) { try { move(character.x + (tgt.x - character.x) * 0.4, character.y + (tgt.y - character.y) * 0.4); } catch (e) {} status("kämpft"); return; }
    status(t ? "bei dir" : "sucht dich");
    await follow();
}
try { window.on_cm = on_cm; if (typeof on_party_invite == "function") window.on_party_invite = on_party_invite; if (typeof on_party_request == "function") window.on_party_request = on_party_request; } catch (e) {}

// Tod: unabhängig von der Hauptschleife wiederbeleben (falls die irgendwo hängt)
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
try { send_cm(MAGE, { t: "hello", v: RANGER_VERSION }); } catch (e) {}
say("Ranger " + RANGER_VERSION + " gestartet (Lv " + character.level + ")");
(async function () { var g = MY_GEN; if (HAD_OLD) { say("neue Version " + (typeof PRIEST_VERSION != "undefined" ? PRIEST_VERSION : RANGER_VERSION) + " übernommen"); await sleep(1500); } while (window.__lp_gen == g) { try { await tick(); } catch (e) { say_once("err", "Fehler: " + (e && e.message ? e.message : e), 60000); } await sleep(300); } })();
