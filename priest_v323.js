// ===== Adventure Land – LogicPlan Priester (F4llenPriest) – Stufe 1 =====
// Folgt dem Magier, heilt ihn und sich, nimmt die Party-Einladung an, greift erst ab PRIEST_ATTACK_LEVEL mit an.
// Meldungen gehen per Charakter-Nachricht an den Magier ("[Priest] …").
var PRIEST_VERSION = "v323";
// Generationswechsel: wird das Skript per N neu eingespielt, beendet sich die alte Schleife von selbst (kein Neu-Einloggen)
try { window.__lp_gen = (window.__lp_gen || 0) + 1; } catch (e) {}
var MY_GEN = window.__lp_gen, HAD_OLD = MY_GEN > 1; // Achtung: globale Namen werden beim Neu-Einspielen überschrieben, daher Generation immer lokal (g) festhalten

var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var PRIEST_ATTACK_LEVEL = 20;      // vorher nur folgen und heilen
var FOLLOW_DIST = 120, FOLLOW_MAX = 220;
var HEAL_MAGE_BELOW = 0.9, HEAL_SELF_BELOW = 0.6, FLEE_BELOW = 0.35, help_until = 0;
var path_fail = 0, mage = null, p_paused = false, last_log = {}, last_status = 0, last_move = 0, last_pots_ask = 0, moving = false;
var GEAR_SLOTS = ["helmet", "chest", "pants", "shoes", "gloves", "mainhand"], POT_MIN = 30, POT_BUY = 800, GOLD_WANT = 250000, GOLD_MIN = 20000; // POT_MIN 30 = nur Notfall-Selbstkauf; normal bringt der Händler die Tränke (auf 800), sobald unter 300
var shopping = false, last_shop = 0, last_gold_ask = 0;
function have_item(n) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == n) return i; } return -1; }
function pot_count(kind) { var n = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name.indexOf(kind) == 0) n += it.q || 1; } return n; }
function npc_pos(id) { for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.npcs) continue; for (var i = 0; i < md.npcs.length; i++) { var n = md.npcs[i]; if (n.id == id && n.position) return { map: map, x: n.position[0], y: n.position[1] }; } } return null; }
function npc_selling(item) { for (var id in G.npcs) { var n = G.npcs[id]; if (n && n.items && n.items.indexOf(item) >= 0) return id; } return null; }
function fits(def, slot) { if (!def || def.ignore) return false; if (def.class && def.class.indexOf("priest") < 0) return false; if (slot == "mainhand") return def.type == "weapon" && def.wtype != "bow" && def.wtype != "crossbow"; return def.type == slot; }
function cheapest_for(slot) { // günstigstes NPC-Teil, das in den Slot passt
    var best = null;
    for (var n in G.items) { var d = G.items[n]; if (!fits(d, slot) || !d.g || d.g > 60000) continue; var npc = npc_selling(n); if (!npc) continue; if (!best || d.g < best.g) best = { name: n, g: d.g, npc: npc }; }
    return best;
}
function missing_gear() { return GEAR_SLOTS.filter(function (sl) { return !character.slots[sl]; }); }
function junk_items() { // Ausrüstung, die die Automatik nie anlegen würde: nicht getragen und nicht besser als das Getragene (oder nicht für meine Klasse)
    var out = [];
    for (var i = 0; i < character.items.length; i++) {
        var it = character.items[i]; if (!it) continue; var d = G.items[it.name]; if (!d || /^(hpot|mpot|mm)/.test(it.name)) continue; // mm* = Token-Set für den Magier
        if ((d.g || 0) >= 50000 || (it.level || 0) >= 4 || it.stat_type) continue; // wertvolle Teile nie beim NPC verkaufen – gehen beim Aufräumen an den Magier (Bank/Stand)
        if (!(d.type && ALL_SLOTS_TYPES[d.type]) && !d.wtype) continue; // keine Ausrüstung
        var useful = false, fits_me = false;
        for (var slot in ALL_SLOTS) { if (!fits_any(d, slot)) continue; fits_me = true; var worn = character.slots[slot]; var ws = worn ? gear_score(G.items[worn.name], worn.level || 0, worn.stat_type) : 0; if (gear_score(d, it.level || 0, it.stat_type) > ws * 1.02) useful = true; }
        if (!useful || !fits_me) out.push(i);
    }
    return out;
}
function cheap_junk() { return junk_items().filter(function (i) { var it = character.items[i], d = G.items[it.name] || {}; return !/^mm|^(dex|int|str|vit)(ring|earring|amulet|belt)$/.test(it.name) && (d.g || 0) < 10000 && (it.level || 0) <= 2; }); } // nur Billiges verkaufen – Seltenes/Hochgestuftes bleibt (Bank)
var ALL_SLOTS_TYPES = { helmet: 1, chest: 1, pants: 1, shoes: 1, gloves: 1, cape: 1, weapon: 1, ring: 1, earring: 1, amulet: 1, belt: 1, orb: 1, quiver: 1, shield: 1, source: 1, misc_offhand: 1 };
function shop_needed() { return pot_count("hpot") < POT_MIN || pot_count("mpot") < POT_MIN || missing_gear().some(function (sl) { return !!cheapest_for(sl); }) || (character.esize < 3 && junk_items().length > 0); } // leere Slots nur, wenn es dafür etwas beim NPC zu kaufen gibt – sonst alle 5 min umsonst in die Stadt
var kiss_req = null, last_event_give = 0;
async function do_kiss(k) { // Kuss-Runde des Events mitmachen: zur Zielperson, ikissyou bis Belohnung (Geschenk/Kuchenstück/Buff)
    kiss_req = null; shopping = true;
    try {
        status("Kuss"); try { stop("smart"); stop("move"); } catch (e) {}
        try { await smart_move({ map: k.map, x: k.x, y: k.y }); } catch (e) {}
        var range = (G.skills.ikissyou && G.skills.ikissyou.range) || 50, t_end = Date.now() + 180000, ok = false;
        var snap = function () { var o = { gift: 0, slices: 0, buff: !!(character.s && character.s.anniversary_kiss) }; character.items.forEach(function (i) { if (!i) return; if (i.name == "anniversarygift") o.gift += i.q || 1; if (/^slice_/.test(i.name)) o.slices += i.q || 1; }); return o; };
        var before = snap();
        while (Date.now() < t_end) {
            var n = snap(); if (n.gift > before.gift || n.slices > before.slices || (n.buff && !before.buff)) { ok = true; break; }
            var ent = get_player(k.name); if (!ent) { await sleep(1000); continue; }
            if (dist(character, ent) > range - 5) { try { move(ent.x, ent.y); } catch (e) {} await sleep(400); continue; }
            if (!is_on_cooldown("ikissyou")) { try { await use_skill("ikissyou", ent); } catch (e) { var rs = String(e && e.reason || e); if (/claimed/i.test(rs)) { ok = true; break; } } await sleep(2000); }
            else await sleep(500);
        }
        say(ok ? "Kuss belohnt (Runde " + k.round + ")" : "Kuss: keine Belohnung (Runde " + k.round + ")");
    } catch (e) { say("Kuss: " + (e && e.message ? e.message : e)); }
    shopping = false;
}
function event_handover() { // Geschenke/Kuchenstücke an den Magier geben, wenn er in Reichweite steht
    if (Date.now() - last_event_give < 60000) return; var m = mage_entity(); if (!m || m.map != character.map || dist(character, m) > 300) return;
    last_event_give = Date.now();
    for (var i = character.items.length - 1; i >= 0; i--) { var it = character.items[i]; if (it && (it.name == "anniversarygift" || /^slice_/.test(it.name))) { try { send_item(MAGE, i, it.q || 1); say(it.name + (it.q > 1 ? " ×" + it.q : "") + " an " + MAGE + " übergeben"); } catch (e) {} } }
}
async function enter_bank() { // sicher in die Bank: smart_move, sonst zur Tür laufen und selbst durchgehen
    for (var t = 0; t < 3 && character.map != "bank"; t++) {
        try { stop("smart"); stop("move"); } catch (e) {}
        try { await smart_move("bank"); } catch (e) { say("Weg zur Bank (" + (t + 1) + "): " + (e && (e.reason || e.message) || JSON.stringify(e))); }
        for (var w = 0; w < 15 && character.map != "bank"; w++) await sleep(200);
        if (character.map == "bank") break;
        if (character.map == "main") { // Tür-Fallback: main-Tür zur Bank (aus den Kartendaten), hinlaufen, durchgehen
            var door = null; (G.maps.main.doors || []).forEach(function (d) { if (d[4] == "bank") door = d; });
            if (door) { var dx = door[0] + door[2] / 2, dy = door[1] + door[3] / 2; try { await smart_move({ map: "main", x: dx, y: dy }); } catch (e) {} for (var w1 = 0; w1 < 10 && is_moving(character); w1++) await sleep(200);
                say("Bank-Tür: stehe bei " + Math.round(character.x) + "," + Math.round(character.y) + " (Tür " + Math.round(dx) + "," + Math.round(dy) + ") – gehe durch");
                try { parent.socket.emit("transport", { to: "bank", s: door[5] || 0 }); } catch (e) {} for (var w2 = 0; w2 < 25 && character.map != "bank"; w2++) await sleep(200); }
        }
    }
    if (character.map != "bank") return false;
    for (var w3 = 0; w3 < 25 && !character.bank; w3++) await sleep(200);
    return !!character.bank;
}
var give_req = 0, cav_next = 0; try { cav_next = parseInt(localStorage.getItem("lp_cav_next_" + character.name) || "0") || 0; } catch (e) {}
try { if (parent.__lp_cav_fn_sub) parent.socket.off("game_response", parent.__lp_cav_fn_sub); parent.__lp_cav_fn_sub = function (d) { try { if (!d || d.interaction != "cavalry") return; if (d.next_call > Date.now()) cav_next = d.next_call; else if (d.cooldown_ms > 1000) cav_next = Date.now() + d.cooldown_ms; if (d.failed) cav_next = Math.max(cav_next, Date.now() + 60000); try { localStorage.setItem("lp_cav_next_" + character.name, String(cav_next)); } catch (e) {} send_cm(MAGE, { t: "cavres", ok: !d.failed, assigned: d.assigned, reason: d.reason, next: cav_next }); } catch (e) {} }; parent.socket.on("game_response", parent.__lp_cav_fn_sub); } catch (e) {}
async function go_give_mage() { // alles außer Tränken/Tokens/Tracker zum Magier bringen und übergeben
    give_req = 0; shopping = true; var n = 0, left = 0, names = [];
    try {
        for (var w = 0; w < 20 && moving; w++) await sleep(500);
        try { stop("smart"); stop("move"); } catch (e) {}
        status("Übergabe");
        var m = mage_entity(), tgt = m && character.map == m.map ? { map: m.map, x: m.x, y: m.y } : (mage ? { map: mage.map, x: mage.x, y: mage.y } : null);
        if (!tgt) throw "Magier-Position unbekannt";
        for (var i = 0; i < 4; i++) { try { await smart_move(tgt); } catch (e) {} m = mage_entity(); if (m && character.map == m.map && dist(character, m) < 200) break; if (mage) tgt = { map: mage.map, x: mage.x, y: mage.y }; }
        m = mage_entity(); if (!m || character.map != m.map || dist(character, m) > 300) throw "Magier nicht erreicht (" + character.map + ")";
        for (var j = character.items.length - 1; j >= 0; j--) { var it = character.items[j]; if (!it) continue; if (/^(hpot|mpot)/.test(it.name) || it.name == "tracker" || it.name == "computer") continue;
            if (mage && mage.free != null && mage.free <= 1) { left++; continue; }
            try { send_item(MAGE, j, it.q || 1); n++; names.push(it.name + (it.q > 1 ? "×" + it.q : "")); } catch (e) { left++; } await sleep(350); }
        say("Übergabe: " + n + " Posten an " + MAGE + (left ? ", " + left + " nicht (Magier voll)" : "") + (names.length ? " – " + names.join(", ") : ""));
    } catch (e) { say("Übergabe: " + (e && e.message ? e.message : e)); }
    try { send_cm(MAGE, { t: "given", n: n, left: left }); } catch (e) {}
    shopping = false;
}
var tidy_req = 0, goldback_req = 0, last_goldback = 0, GOLD_MAX = 2000000;
function gold_handback() { // alles über GOLD_MAX an den Magier, wenn er in Reichweite steht (auf Befehl sofort, sonst alle 5 min prüfen)
    var over = character.gold - GOLD_MAX; if (over < (goldback_req ? 1000 : 50000)) { if (goldback_req) { goldback_req = 0; say("Gold: nichts über " + GOLD_MAX + " (habe " + character.gold + ")"); } return; }
    if (!goldback_req && Date.now() - last_goldback < 5 * 60000) return;
    var m = mage_entity(); if (!m || m.map != character.map || dist(character, m) > 350) return;
    last_goldback = Date.now(); goldback_req = 0; var g0 = character.gold; try { send_gold(MAGE, over); } catch (e) { say("Gold übergeben fehlgeschlagen: " + (e && e.reason || e)); return; }
    say("Gold übergeben: " + over + " an " + MAGE + " (behalte " + GOLD_MAX + ")");
}
async function go_tidy() { // Aufräumen auf Befehl des Magiers: Schrott verkaufen, Rest in die Bank, Tränke und Tokens behalten
    shopping = true; tidy_req = 0;
    try {
        for (var w = 0; w < 20 && moving; w++) await sleep(500);
        try { stop("smart"); stop("move"); } catch (e) {}
        status("räumt auf");
        var junk = cheap_junk(), sold = 0;
        if (junk.length) { try { await smart_move("potions"); for (var j = junk.length - 1; j >= 0; j--) { var ij = character.items[junk[j]]; if (ij) { try { sell(junk[j], ij.q || 1); sold++; } catch (e) {} await sleep(300); } } } catch (e) {} }
        var bank = []; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it) continue; if (/^(hpot|mpot)/.test(it.name) || it.name == "monstertoken" || it.name == "tracker" || it.name == "computer") continue; bank.push(i); }
        var stored = 0;
        var failed = 0;
        var last_err = "";
        if (bank.length) { try { if (!(await enter_bank())) throw "Bank nicht erreicht (Karte " + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + ")";
            for (var b = bank.length - 1; b >= 0; b--) { var ib = character.items[bank[b]]; if (!ib) continue; var e0 = character.esize; try { var pr = bank_store(bank[b]); if (pr && pr.then) pr.then(null, function (e) { last_err = String(e && e.reason || e); }); } catch (e) { last_err = String(e && e.reason || e); } await sleep(600); if (character.esize > e0) stored++; else failed++; } } catch (e) { say("Bank: " + (e && e.message || e)); } }
        say("Aufgeräumt: " + sold + " verkauft, " + stored + " in die Bank" + (failed ? ", " + failed + " nicht abgelegt (" + (last_err || "kein Fehler gemeldet") + ")" : "") + " – frei " + character.esize);
    } catch (e) { say("Aufräumen: " + (e && e.message ? e.message : e)); }
    shopping = false;
}
async function go_shopping() { // in die Stadt: fehlende Ausrüstung und Tränke kaufen, dann zurück
    shopping = true; last_shop = Date.now();
    try {
        for (var w = 0; w < 20 && moving; w++) await sleep(500); // laufende Folge-Bewegung ausklingen lassen
        try { stop("smart"); stop("move"); } catch (e) {}
        var plan = [];
        missing_gear().forEach(function (sl) { var c = cheapest_for(sl); if (c) plan.push(c); });
        var cost = plan.reduce(function (a, c) { return a + c.g; }, 0) + 2 * POT_BUY * 100;
        if (character.gold < cost) { say_once("shopgold", "Einkauf braucht " + cost + " Gold, habe " + character.gold + " – warte auf Gold", 300000); return; }
        var needp = pot_count("hpot") < POT_MIN || pot_count("mpot") < POT_MIN; say((needp || plan.length) ? "Einkauf: " + (plan.length ? plan.map(function (c) { return c.name; }).join(", ") + (needp ? " und " : "") : "") + (needp ? "Tränke" : "") : "Stadtgang: Jagd abgeben/holen");
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
        var junk = cheap_junk();
        if (junk.length) { try { await smart_move("potions"); for (var j3 = junk.length - 1; j3 >= 0; j3--) { var ij3 = character.items[junk[j3]]; if (ij3) { try { sell(junk[j3], ij3.q || 1); } catch (e) {} await sleep(300); } } say("Alte Ausrüstung verkauft: " + junk.length); } catch (e) {} }
        try { await hunt_town_step(); } catch (e) { say("Jagd/Daisy: " + (e && e.message || e)); }
        // anlegen
        for (var i2 = 0; i2 < character.items.length; i2++) { var it = character.items[i2]; if (!it) continue; var d = G.items[it.name]; for (var k = 0; k < GEAR_SLOTS.length; k++) { var sl = GEAR_SLOTS[k]; if (!character.slots[sl] && fits(d, sl)) { try { equip(i2); await sleep(400); say(it.name + " angelegt"); } catch (e) {} break; } } }
    } catch (e) { say("Einkauf-Fehler: " + (e && e.message ? e.message : e)); }
    shopping = false;
}
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Priest] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function worn_summary() { var o = {}; for (var sl in character.slots) { var it = character.slots[sl]; if (it && sl.indexOf("trade") != 0) o[sl] = { name: it.name, level: it.level || 0 }; } return o; }
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", hpots: pot_count("hpot"), mpots: pot_count("mpot"), cav: { has: have_item("tracker") >= 0, next: cav_next }, level: character.level, state: character.rip ? "tot" : state, hp: character.hp, max_hp: character.max_hp, mp_pct: character.mp / character.max_mp, map: character.map, free: character.esize, attack: character.attack, frequency: character.frequency, tokens: pot_count("monstertoken"), hunt: (mh_q() ? { id: mh_q().id, c: mh_q().c || 0, ms: mh_q().ms || 0 } : null), slots: worn_summary() }); } catch (e) {} }
var gear_incoming = [];
async function equip_incoming() { // vom Magier erhaltene Teile anlegen, ersetzte Teile beim nächsten Einkauf verkaufen
    while (gear_incoming.length) {
        var g = gear_incoming.shift(); var idx = -1;
        for (var w = 0; w < 10 && idx < 0; w++) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == g.name && (it.level || 0) == g.level) { idx = i; break; } } if (idx < 0) await sleep(500); }
        if (idx < 0) { say("Teil " + g.name + " nicht angekommen"); continue; }
        try { equip(idx, g.slot); await sleep(600); if (g.manual) manual_choice[g.slot] = g.name + "+" + g.level; say(g.name + "+" + g.level + " angelegt (" + g.slot + (g.manual ? ", von dir gewählt – bleibt an" : "") + ")"); } catch (e) { say("Anlegen " + g.name + ": " + (e && e.reason || e)); }
    }
    last_autoequip = 0; try { await auto_equip(); } catch (e) {}
    try { send_cm(MAGE, { t: "st", hpots: pot_count("hpot"), mpots: pot_count("mpot"), level: character.level, state: last_state || "bei dir", hp: character.hp, max_hp: character.max_hp, mp_pct: character.mp / character.max_mp, map: character.map, free: character.esize, attack: character.attack, frequency: character.frequency, tokens: pot_count("monstertoken"), hunt: (mh_q() ? { id: mh_q().id, c: mh_q().c || 0, ms: mh_q().ms || 0 } : null), slots: worn_summary() }); } catch (e) {}
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

// ---------- eigene Monsterjagd (Daisy) + Tokens für den Magier ----------
var last_hunt_town = 0, hunt_reported = "";
function mh_q() { return character.s && character.s.monsterhunt; }
var boot_t = Date.now();
function hunt_may_take() { if (!mage) return Date.now() - boot_t > 90000; return Date.now() - mage.t > 90000 || mage.hunt_go == character.name; } // ohne Magier-Meldung erst nach 90 s selbst entscheiden // Magier gibt frei, wer die nächste Jagd holt (nur eine Team-Jagd zur Zeit)
function hunt_town_needed() { var q = mh_q(); return (q && q.c == 0 && Date.now() - last_hunt_town > 60000) || (!q && hunt_may_take() && Date.now() - last_hunt_town > 60000); } // fertig: sofort abgeben und neue holen; keine Jagd: alle 10 min versuchen // keine Jagd oder fertig: zu Daisy
function daisy_pos() { try { for (var map in G.maps) { var md = G.maps[map]; if (!md || !md.npcs) continue; for (var i = 0; i < md.npcs.length; i++) { var n = md.npcs[i]; if (n.id == "monsterhunter" && n.position) return { map: map, x: n.position[0], y: n.position[1] }; } } } catch (e) {} return null; }
async function hunt_town_step() { // in der Stadt: Jagd abgeben/holen, Tokens in Set-Teile für den Magier umsetzen (in die Bank)
    last_hunt_town = Date.now();
    var dp = daisy_pos(); if (!dp) return;
    try { await smart_move({ map: dp.map, x: dp.x, y: dp.y + 20 }); } catch (e) { return; }
    var q = mh_q(), t0 = pot_count("monstertoken");
    if (q && q.c == 0) { try { await interact("monsterhunt"); } catch (e) {} await sleep(800); say("Jagd abgegeben (+" + (pot_count("monstertoken") - t0) + " Tokens, " + pot_count("monstertoken") + " gesamt)"); }
    q = mh_q();
    if (!q) { if (hunt_may_take()) { try { await interact("monsterhunt"); } catch (e) {} await sleep(800); q = mh_q(); if (q) say("Neue Jagd: " + q.c + "x " + q.id); } else { last_hunt_town = Date.now() + 14 * 60000; say("Keine neue Jagd geholt: " + (mage && mage.hunt_holder ? mage.hunt_holder + " läuft" : "ein anderer holt") + " – nächster Versuch in 15 min"); } }
    // Tokens: fehlende Set-Teile des Magiers kaufen und in die Bank legen
    var miss = []; // Tokens werden nicht automatisch ausgegeben (Set-Teile/Tracker kauft Fabian manuell)
    var bought = [];
    for (var i = 0; i < miss.length; i++) { var m = miss[i]; if (!m.cost || pot_count("monstertoken") < m.cost || character.esize < 2) continue; try { exchange_buy("monstertoken", m.name); await sleep(1500); } catch (e) {} if (have_item(m.name) >= 0) { bought.push(m.name); say("Tokens: " + m.name + " für " + MAGE + " gekauft (" + m.cost + ")"); } }
    if (bought.length) { try { await smart_move("bank"); await sleep(800); for (var b = 0; b < bought.length; b++) { var bi = have_item(bought[b]); if (bi >= 0) { bank_store(bi); await sleep(400); } } say("Tokens: " + bought.join(", ") + " in die Bank gelegt"); } catch (e) { say("Bank: " + (e && e.message || e)); } }
}
function spot_target_near() { // freies, ungeleveltes Exemplar des aktuellen Team-Spots in der Nähe (nur ohne Team-Häkchen)
    if (!mage || !mage.spot || Date.now() - mage.t > 15000 || p_paused) return null; var sp = mage.spot, base = G.monsters[sp] || {}; if ((base.attack || 0) * 8 > character.max_hp) return null;
    var best = null, bd = 240;
    for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead || m.mtype != sp) continue; if (m.target && m.target != character.name) continue; if (character.map != "goobrawl" && ((m.level || 1) > 1 || (base.hp && m.max_hp > base.hp * 1.3))) continue; /* Goo-Prügelei: gebuffte Goos sind gewollt */ var d = Math.hypot(character.x - m.x, character.y - m.y); if (d < bd) { bd = d; best = m; } }
    return best;
}
function hunt_target_near() { // Jagdmonster in der Nähe, das noch niemand fremdes angreift
    var q = mh_q(); if (!q || !(q.c > 0)) return null; if (mage && mage.spot && mage.spot != q.id) return null; if (mage && mage.strict) return null; /* Team-Pflicht (Häkchen beim Magier): nur der Magier zieht */ var best = null, bd = 260; // eigene Jagd nur anpulen, wenn das Team gerade dort farmt
    for (var id in parent.entities) { var m = parent.entities[id]; if (!m || m.type != "monster" || m.dead || m.mtype != q.id) continue; if (m.target && m.target != character.name && m.target != MAGE) continue; var base = G.monsters[m.mtype] || {}; if (!m.target && ((m.level || 1) > 1 || (base.hp && m.max_hp > base.hp * 1.3) || (base.attack || 0) * 8 > character.max_hp)) continue; /* gelevelte/starke Exemplare zieht der Magier zuerst (Aggro), wir folgen seinem Ziel */ var d = Math.hypot(character.x - m.x, character.y - m.y); if (d < bd) { bd = d; best = m; } } // gelevelte Exemplare (Lv >3 / >1,6x HP) nicht selbst anpulen – der Magier lässt sie auch aus
    return best;
}
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") p_paused = data.paused; if (data.mg && data.mg.esc_max > 0) GOLD_MAX = data.mg.esc_max; }
    else if (data.t == "goldback") { goldback_req = Date.now(); }
    else if (data.t == "state") p_paused = !!data.paused;
    else if (data.t == "town") { try { stop("smart"); moving = false; use_skill("town"); say("zurück in die Stadt (Event vorbei)"); } catch (e) {} }
    else if (data.t == "join") { try { var jr = join(data.event); if (jr && typeof jr.then == "function") jr.then(function () { say("Event " + data.event + ": angekommen"); }, function (e) { say("Event-Sprung fehlgeschlagen: " + (e && e.reason || JSON.stringify(e).slice(0, 80))); }); } catch (e) { say("Event-Sprung: " + (e && e.message || e)); } }
    else if (data.t == "tidy") { tidy_req = Date.now(); say("Aufräumen angefordert"); }
    else if (data.t == "cavalry") { if (have_item("tracker") < 0) { try { send_cm(MAGE, { t: "cavres", ok: false, reason: "kein Tracktrix" }); } catch (e) {} } else { cav_next = Date.now() + 3600000; try { localStorage.setItem("lp_cav_next_" + character.name, String(cav_next)); } catch (e) {} try { parent.socket.emit("interaction", { type: "cavalry" }); say("Cavalry gerufen (" + (data.why || "Magier") + ")"); } catch (e) {} } }
    else if (data.t == "givemage") { give_req = Date.now(); say("Übergabe an den Magier angefordert"); }
    else if (data.t == "kiss") { kiss_req = data; say("Kuss-Runde " + data.round + ": " + data.name + " (" + data.map + ")"); }
    else if (data.t == "help") { help_until = Date.now() + 20000; try { stop("smart"); } catch (e) {} moving = false; }
    else if (data.t == "gear") { gear_incoming.push(data); if (gear_incoming.length == 1) setTimeout(equip_incoming, 800); }
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
        if (d > FOLLOW_MAX) { if (!moving) { moving = true; var fx = t.x - (t.x - character.x) * FOLLOW_DIST / d, fy = t.y - (t.y - character.y) * FOLLOW_DIST / d, okf = false; try { await smart_move({ map: t.map, x: fx, y: fy }); okf = true; } catch (e) {} if (!okf) { try { await smart_move({ map: t.map, x: t.x, y: t.y }); } catch (e2) {} } moving = false; } } // Zielpunkt vor dem Magier nicht erreichbar (Wand/Wasser): direkt zu seiner Position
        else if (d > FOLLOW_DIST && !is_moving(character)) { var mx = character.x + (t.x - character.x) * 0.5, my = character.y + (t.y - character.y) * 0.5, straight = true; try { straight = can_move_to(mx, my); } catch (e) {} if (straight) { try { move(mx, my); } catch (e) {} } else if (!moving) { moving = true; try { await smart_move({ map: t.map, x: t.x, y: t.y }); } catch (e) {} moving = false; } } // letzte Meter: gerade Linie blockiert → Wegfindung statt Stehenbleiben
        return;
    }
    if (mage && mage.map == "abtesting" && character.map != "abtesting") { status("wartet (Magier im PvP-Event)"); return; } // PvP-Arena ist nicht erreichbar: bleiben und Spot halten
    if (mage && Date.now() - mage.t < 30000 && !moving && Date.now() - last_move > 8000) { // Magier nicht in Sicht: zu seiner gemeldeten Position
        last_move = Date.now(); moving = true; status("unterwegs zum Magier");
        var ok = false; try { await smart_move({ map: mage.map, x: mage.x, y: mage.y }); ok = true; } catch (e) {}
        if (!ok) { path_fail++; if (path_fail >= 2) { say_once("nopath", "Kein Weg zur Magier-Position (" + mage.map + " " + mage.x + "," + mage.y + ") – gehe zum Kartenanfang und warte", 120000); try { await smart_move(mage.map); } catch (e) {} last_move = Date.now() + 20000; } } else path_fail = 0;
        moving = false;
    }
}
function party_mates() { // andere Party-Mitglieder (außer Magier) in Sicht
    var out = []; try { var pl = parent.party_list || []; for (var i = 0; i < pl.length; i++) { var nm = pl[i]; if (nm == character.name || nm == MAGE) continue; var p = get_player(nm); if (p && p.map == character.map) out.push(p); } } catch (e) {}
    return out;
}
function heal_target(t) { try { if (typeof heal == "function") heal(t); else use_skill("heal", t); return true; } catch (e) { return false; } }
async function tick() {
    if (character.rip) { status("tot"); await sleep(15000); try { respawn(); } catch (e) {} await sleep(5000); return; }
    // Pause des Magiers: trotzdem folgen, heilen, verteidigen und sein Ziel mitangreifen (volle Unterstützung beim manuellen Spielen)
    // Selbstschutz
    var hpr = character.hp / character.max_hp, mpr = character.mp / character.max_mp;
    if (hpr < HEAL_SELF_BELOW) { if (can_use("heal") && character.mp > 30) heal_target(character); else if (!use_pot("hpot")) { try { use_skill("regen_hp"); } catch (e) {} } }
    if (mpr < 0.3) { if (!use_pot("mpot")) { try { use_skill("regen_mp"); } catch (e) {} } }
    if (shopping) return;
    if (give_req && !my_attacker()) { go_give_mage(); return; }
    if (tidy_req && !my_attacker() && !moving) { go_tidy(); return; }
    if (kiss_req && !my_attacker()) { do_kiss(kiss_req); return; }
    try { event_handover(); } catch (e) {}
    try { gold_handback(); } catch (e) {}
    if (!my_attacker() && Date.now() - last_autoequip > 30000) { await auto_equip(); }
    if (character.gold < 40000 && mage && Date.now() - last_gold_ask > 3 * 60000) { var mg = mage_entity(); if (mg && character.map == mg.map && dist(character, mg) < 350) { last_gold_ask = Date.now(); try { send_cm(MAGE, { t: "gold?", amount: Math.max(20000, GOLD_MAX - character.gold) }); } catch (e) {} } }
    var mage_fighting = mage && mage.tgt && Date.now() - mage.t < 15000 && !mage.paused;
    if (((shop_needed() && Date.now() - last_shop > 5 * 60000 && (!mage_fighting || pot_count("hpot") == 0)) || hunt_town_needed()) && character.gold >= GOLD_MIN && !my_attacker() && !moving) { go_shopping(); return; } // Einkauf nicht mitten im Kampf des Magiers (außer ohne Tränke); fertige Jagd wird sofort abgegeben
    if (has_pot("hpot") < 0 && character.gold < GOLD_MIN && mage && Date.now() - last_pots_ask > 5 * 60000) { var me = mage_entity(); if (me && character.map == me.map && dist(character, me) < 350) { last_pots_ask = Date.now(); try { send_cm(MAGE, { t: "pots?" }); } catch (e) {} } }
    var att = my_attacker();
    if (att && ((att.attack || (G.monsters[att.mtype] || {}).attack || 0) >= character.max_hp * 0.5)) { var dxo = character.x - att.x, dyo = character.y - att.y, lo = Math.hypot(dxo, dyo) || 1; try { move(character.x + dxo / lo * 200, character.y + dyo / lo * 200); } catch (e) {} status("weicht Boss aus"); return; } // Ein-Treffer-Gegner (Giga Crab): sofort weg
    if (att && hpr < FLEE_BELOW) { var me2 = mage_entity(); if (me2) { try { move(me2.x, me2.y); } catch (e) {} } status("flieht"); return; }
    // Magier heilen (bei Hilferuf: hinlaufen und Dauerheilung, Angriff hat Pause)
    var t = mage_entity();
    if (Date.now() < help_until && t && !t.rip) { var dh = dist(character, t), hr = (G.skills.heal && G.skills.heal.range) || 200; if (dh > hr - 20 && !is_moving(character)) { try { move(t.x + (character.x - t.x) * 0.5, t.y + (character.y - t.y) * 0.5); } catch (e) {} } if (dh <= hr && can_use("heal") && character.mp > 30) heal_target(t); status("hilft"); return; }
    // Heilen: wer aus der Party (Magier, Ranger, Händler) am schwächsten ist und in Reichweite steht
    var hr2 = (G.skills.heal && G.skills.heal.range) || 200, worst = null, worst_r = HEAL_MAGE_BELOW;
    [t].concat(party_mates()).forEach(function (pm) { if (!pm || pm.rip || !pm.max_hp) return; var r = pm.hp / pm.max_hp; if (r < worst_r && dist(character, pm) <= hr2) { worst_r = r; worst = pm; } });
    if (worst && can_use("heal") && character.mp > 30) { heal_target(worst); status("heilt " + (worst.name == MAGE ? "Magier" : worst.name)); return; }
    // Party-Heilung, wenn mehrere angeschlagen
    var low = [t].concat(party_mates()).filter(function (pm) { return pm && !pm.rip && pm.max_hp && pm.hp / pm.max_hp < 0.7; }).length + (hpr < 0.7 ? 1 : 0);
    if (low >= 2 && can_use("partyheal") && character.mp > 400) { try { use_skill("partyheal"); } catch (e) {} }
    // Mitkämpfen ab bestimmtem Level: das Ziel des Magiers oder meinen Angreifer
    if (character.level >= PRIEST_ATTACK_LEVEL || att) {
        var mtg = mage && mage.tgt ? parent.entities[mage.tgt] : null; if (mtg && mtg.dead) mtg = null; var tgt = null; if (mtg && mage.focus) { tgt = mtg; } else if (mage && mage.strict) { tgt = mtg || att; } else { tgt = att || spot_target_near() || mtg; } /* focus: seltener Spawn des Magiers geht vor */ // Team-Häkchen: nur Ziel des Magiers (Fokus); sonst eigenes freies Exemplar des Spots (schneller bei Massen-Jagden), Ziel des Magiers als Rückfall
        if (tgt && is_in_range(tgt) && can_attack(tgt)) { try { attack(tgt); } catch (e) {} status("kämpft"); return; }
    }
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
try { send_cm(MAGE, { t: "hello", v: PRIEST_VERSION }); } catch (e) {}
say("Priester " + PRIEST_VERSION + " gestartet (Lv " + character.level + ")");
(async function () { var g = MY_GEN; if (HAD_OLD) { say("neue Version " + (typeof PRIEST_VERSION != "undefined" ? PRIEST_VERSION : RANGER_VERSION) + " übernommen"); await sleep(1500); } while (window.__lp_gen == g) { try { await tick(); } catch (e) { say_once("err", "Fehler: " + (e && e.message ? e.message : e), 60000); } await sleep(300); } })();
