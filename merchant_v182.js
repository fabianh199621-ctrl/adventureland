// ===== Adventure Land – LogicPlan Händler (F4llenMerch) – Stufe 1 =====
// Läuft unsichtbar neben dem Magier. Aufgaben: Stand kaufen und öffnen, Loot abholen/verkaufen/einlagern,
// Startgold vom Magier holen. mluck ist abgeschaltet (braucht Lv 40, Händler levelt praktisch nicht) – USE_MLUCK/LEVEL_MODE. Meldungen gehen per Charakter-Nachricht an den Magier und erscheinen dort als "[Merch] …".
var MERCH_VERSION = "v182";
// Generationswechsel: wird das Skript per N neu eingespielt, beendet sich die alte Schleife von selbst (kein Neu-Einloggen)
try { window.__lp_gen = (window.__lp_gen || 0) + 1; } catch (e) {}
var MY_GEN = window.__lp_gen, HAD_OLD = MY_GEN > 1; // Achtung: globale Namen werden beim Neu-Einspielen überschrieben, daher Generation immer lokal (g) festhalten

var MAGE = "F4llen";
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var STAND_ITEM = "stand0";
var MLUCK_EVERY = 25 * 60000;      // mluck hält 60 min, wir frischen ab 25 min Restlaufzeit auf
var GOLD_WANT = 200000, GOLD_MIN = 60000;
var MLUCK_LEVEL = (G.skills.mluck && G.skills.mluck.level) || 40; // mluck erst ab diesem Level
var LEVEL_MODE = false;  // true = unter MLUCK_LEVEL beim Magier mitlaufen (Party-XP); false = immer am Stand bleiben
var USE_MLUCK = false;   // true = mluck auf den Magier versuchen (nur sinnvoll ab MLUCK_LEVEL)
var FOLLOW_DIST = 140, FOLLOW_MAX = 240, moving = false, last_follow_move = 0;
var mage = null;                   // letzte Meldung des Magiers { map, x, y, mluck, paused, t }
var m_paused = false, task = null, last_log = {}, stand_pos = null, last_mluck_try = 0, last_gold_ask = 0, last_status = 0, started = Date.now();
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Merch] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: character.rip ? "tot" : state, gold: character.gold, stand: !!character.stand, map: character.map, hp: character.hp, max_hp: character.max_hp }); } catch (e) {} }
// ---------- Stufe 2: Abholung, Verkauf am Stand/NPC, Bank ----------
var pickup = null, manifest = {}, pickup_done = false, STAND_MARKUP = 1.8, STAND_MAX_AGE = 24 * 3600000, GOLD_KEEP = 150000, GOLD_HANDBACK = 300000;
var listed = {}; try { listed = JSON.parse(localStorage.getItem("lp_listed_" + character.name) || "{}"); } catch (e) {}
function save_listed() { try { localStorage.setItem("lp_listed_" + character.name, JSON.stringify(listed)); } catch (e) {} }
function item_key(name, level) { return name + "+" + (level || 0); }
function npc_val(name, level) { try { if (typeof parent.calculate_item_value == "function") { var v = parent.calculate_item_value({ name: name, level: level || 0 }); if (isFinite(v) && v > 0) return v; } } catch (e) {} var d = G.items[name]; return d && d.g ? d.g : 0; }
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "pickup") { pickup = data; pickup.t = Date.now(); pickup_done = false; manifest = {}; say("Abholung angefordert (" + (data.reason || "") + ", " + (data.items || 0) + " Items" + (data.pots && (data.pots.hp || data.pots.mp) ? ", Tränke " + data.pots.hp + "/" + data.pots.mp : "") + ")"); }
    else if (data.t == "pickup_cancel") { pickup = null; }
    else if (data.t == "item") { manifest[item_key(data.name, data.level)] = data.action || "bank"; }
    else if (data.t == "done") { pickup_done = true; }
    else if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") m_paused = data.paused; }
    else if (data.t == "state") { m_paused = !!data.paused; }
    else if (data.t == "nogold") { if (!data.near) say_once("nogold", "Gold: Magier nicht in Reichweite"); }
}
function on_party_invite(name) { if (name == MAGE) { try { accept_party_invite(name); say_once("party", "Party mit " + MAGE + " angenommen", 3600000); } catch (e) {} } }
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
    say("Gehe zum Magier" + (USE_MLUCK && character.level >= MLUCK_LEVEL ? " für mluck" : " (Gold holen)") + " (" + mage.map + " " + mage.x + "," + mage.y + ")");
    for (var i = 0; i < 4; i++) {
        var tgt = mage_entity();
        if (tgt && character.map == tgt.map && Math.hypot(character.x - tgt.x, character.y - tgt.y) < 300) break;
        var p = tgt && character.map == tgt.map ? { map: tgt.map, x: tgt.x, y: tgt.y } : { map: mage.map, x: mage.x, y: mage.y };
        await go(p, 120);
        if (mage && Date.now() - mage.t < 10000 && (mage.map != p.map || Math.hypot(mage.x - p.x, mage.y - p.y) > 200)) continue; // Magier ist weitergezogen
    }
    var t = mage_entity();
    if (!t) { say("Magier nicht in Sicht – später nochmal"); return; }
    var ok = false;
    var can_mluck = USE_MLUCK && character.level >= MLUCK_LEVEL;
    for (var k = 0; k < 6 && can_mluck; k++) {
        t = mage_entity() || t; var dd = character.map == t.map ? Math.hypot(character.x - t.x, character.y - t.y) : 1e9;
        if (dd > 250) { await go({ map: t.map, x: t.x, y: t.y }, 150); continue; } // dranbleiben, falls der Magier weiterzieht
        var why = null;
        try { var r = await use_skill("mluck", t); if (r && r.failed) throw r; say("mluck auf " + MAGE + " gegeben"); ok = true; break; } catch (e) { why = e && (e.reason || e.message || (typeof e == "string" ? e : JSON.stringify(e).slice(0, 120))); await sleep(1200); }
    }
    if (!ok && can_mluck) { var sk = G.skills.mluck || {}; say_once("mluckfail", "mluck nicht gelungen: " + (why || "unbekannt") + " (Abstand " + Math.round(character.map == t.map ? Math.hypot(character.x - t.x, character.y - t.y) : -1) + ", Skill ab Lv " + (sk.level || "?") + ", Reichweite " + (sk.range || "?") + ", Magier-mluck von " + (mage && mage.mluck ? mage.mluck.f + (mage.mluck.strong ? " (stark)" : "") : "-") + ")", 120000); }
    // Gold holen, wenn wir schon hier sind
    if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 120000) { last_gold_ask = Date.now(); try { send_cm(MAGE, { t: "gold?", amount: GOLD_WANT }); } catch (e) {} await sleep(1500); }
}
async function do_pickup() { // zum Magier, Items entgegennehmen, Tränke/Gold übergeben, dann in der Stadt verarbeiten
    var req = pickup; pickup = null; stand_off();
    var pots_bought = 0;
    try {
        status("Abholung");
        var p = req.pots || {};
        if ((p.hp || p.mp) && p.hp_t && p.mp_t) { // Tränke vorher in der Stadt kaufen
            var cost = (p.hp || 0) * (G.items[p.hp_t].g || 0) + (p.mp || 0) * (G.items[p.mp_t].g || 0);
            if (character.gold >= cost + 5000) { try { await smart_move("potions"); if (p.hp) await buy(p.hp_t, p.hp); if (p.mp) await buy(p.mp_t, p.mp); await sleep(600); pots_bought = (p.hp || 0) + (p.mp || 0); say("Tränke gekauft für den Magier: " + p.hp + " " + p.hp_t + " / " + p.mp + " " + p.mp_t); } catch (e) { say("Trankkauf: " + (e && e.reason || e)); } }
            else say("Zu wenig Gold für Tränke (" + cost + "), bringe keine mit");
        }
        // zum Magier
        var t = mage_entity(), tgt = t && character.map == t.map ? { map: t.map, x: t.x, y: t.y } : (mage ? { map: mage.map, x: mage.x, y: mage.y } : { map: req.map, x: req.x, y: req.y });
        for (var i = 0; i < 4; i++) { await go(tgt, 120); t = mage_entity(); if (t && character.map == t.map && Math.hypot(character.x - t.x, character.y - t.y) < 250) break; if (mage) tgt = { map: mage.map, x: mage.x, y: mage.y }; }
        t = mage_entity();
        if (!t || character.map != t.map || Math.hypot(character.x - t.x, character.y - t.y) > 300) { say("Magier nicht erreicht – Abholung abgebrochen"); return; }
        try { send_cm(MAGE, { t: "ready" }); } catch (e) {}
        var t0 = Date.now(); while (!pickup_done && Date.now() - t0 < 90000) await sleep(300);
        // Tränke und Gold übergeben
        var gave_pots = 0;
        if (pots_bought) { for (var j = 0; j < character.items.length; j++) { var it = character.items[j]; if (it && (it.name == p.hp_t || it.name == p.mp_t)) { try { send_item(MAGE, j, it.q || 1); gave_pots += it.q || 1; await sleep(300); } catch (e) {} } } }
        var gave_gold = 0; if (character.gold > GOLD_HANDBACK) { gave_gold = character.gold - GOLD_KEEP; try { send_gold(MAGE, gave_gold); } catch (e) { gave_gold = 0; } }
        try { send_cm(MAGE, { t: "delivered", pots: gave_pots, gold: gave_gold }); } catch (e) {}
        say("Übernommen: " + Object.keys(manifest).length + " Posten" + (gave_pots ? ", " + gave_pots + " Tränke übergeben" : "") + (gave_gold ? ", " + gave_gold + " Gold übergeben" : ""));
    } catch (e) { say("Abholung: " + (e && e.message ? e.message : e)); }
    await process_inventory();
}
async function process_inventory() { // in der Stadt: verkaufen, an den Stand, in die Bank
    var sell = [], stand = [], bank = [];
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || it.name == STAND_ITEM || /^(hpot|mpot)/.test(it.name)) continue; var a = manifest[item_key(it.name, it.level)] || "bank"; (a == "sell" ? sell : a == "stand" ? stand : bank).push(i); }
    if (!sell.length && !stand.length && !bank.length) { manifest = {}; return; }
    try {
        if (sell.length) { status("verkauft"); await smart_move("potions"); var g0 = character.gold; for (var s1 = sell.length - 1; s1 >= 0; s1--) { var it1 = character.items[sell[s1]]; if (!it1) continue; try { sell_item(sell[s1], it1.q || 1); } catch (e) {} await sleep(300); } say("Beim NPC verkauft: " + sell.length + " Items (+" + (character.gold - g0) + " Gold)"); }
        if (stand.length) { status("Stand bestücken"); await go(home_spot(), 40); if (!stand_open()) stand_on(); await sleep(800); var n = 0; for (var s2 = 0; s2 < stand.length; s2++) { var it2 = character.items[stand[s2]]; if (!it2) continue; var slot = free_trade_slot(); if (!slot) { manifest[item_key(it2.name, it2.level)] = "bank"; bank.push(stand[s2]); continue; } var price = Math.round(npc_val(it2.name, it2.level) * STAND_MARKUP / 100) * 100; try { trade(stand[s2], slot, price, it2.q || 1); listed[slot] = { name: it2.name, level: it2.level || 0, t: Date.now(), price: price }; n++; await sleep(400); } catch (e) { say("Stand " + it2.name + ": " + (e && e.reason || e)); } } save_listed(); if (n) say("Am Stand eingestellt: " + n + " Items (Preis = NPC-Wert × " + STAND_MARKUP + ")"); }
        var bank2 = []; for (var b = 0; b < character.items.length; b++) { var itb = character.items[b]; if (!itb || itb.name == STAND_ITEM || /^(hpot|mpot)/.test(itb.name)) continue; var ab = manifest[item_key(itb.name, itb.level)] || "bank"; if (ab == "bank" || (ab == "stand" && !is_listed_item(itb))) bank2.push(b); }
        if (bank2.length) { status("Bank"); stand_off(); await smart_move("bank"); await sleep(800); var nb = 0; for (var b2 = bank2.length - 1; b2 >= 0; b2--) { try { bank_store(bank2[b2]); nb++; } catch (e) {} await sleep(300); } say("In die Bank gelegt: " + nb + " Items"); }
    } catch (e) { say("Verarbeitung: " + (e && e.message ? e.message : e)); }
    manifest = {};
}
function sell_item(i, q) { try { sell(i, q); } catch (e) { parent.socket.emit("sell", { num: i, quantity: q }); } }
function free_trade_slot() { for (var n = 1; n <= 16; n++) { var sl = "trade" + n; if (!(sl in character.slots)) continue; if (!character.slots[sl]) return sl; } for (var n2 = 1; n2 <= 16; n2++) { if (!character.slots["trade" + n2]) return "trade" + n2; } return null; }
function is_listed_item(it) { for (var sl in character.slots) { if (sl.indexOf("trade") == 0 && character.slots[sl] && character.slots[sl].name == it.name && (character.slots[sl].level || 0) == (it.level || 0)) return true; } return false; }
var last_stand_check = 0;
async function check_stand_age() { // Ladenhüter nach 24 h vom Stand nehmen und beim NPC verkaufen
    if (Date.now() - last_stand_check < 10 * 60000) return; last_stand_check = Date.now();
    var old = [];
    for (var sl in character.slots) { if (sl.indexOf("trade") != 0 || !character.slots[sl]) continue; var rec = listed[sl]; if (!rec) { listed[sl] = { name: character.slots[sl].name, level: character.slots[sl].level || 0, t: Date.now() }; continue; } if (Date.now() - rec.t > STAND_MAX_AGE) old.push(sl); }
    for (var sl2 in listed) if (!character.slots[sl2]) { if (listed[sl2].price) say("Verkauft am Stand: " + listed[sl2].name + "+" + listed[sl2].level + " für " + listed[sl2].price); delete listed[sl2]; }
    save_listed();
    if (!old.length) return;
    say("Ladenhüter: " + old.length + " Items vom Stand zum NPC");
    try { for (var k = 0; k < old.length; k++) { try { unequip(old[k]); } catch (e) {} await sleep(400); manifest[item_key(listed[old[k]].name, listed[old[k]].level)] = "sell"; delete listed[old[k]]; } save_listed(); await process_inventory(); } catch (e) { say("Ladenhüter: " + (e && e.message || e)); }
}
async function do_home() {
    var h = home_spot();
    if (dist_to(h) > 60) { say_once("home", "Zurück zum Stand", 300000); await go(h, 40); }
    if (!stand_open() && locate_item(STAND_ITEM) >= 0) { if (stand_on()) say_once("standopen", "Stand geöffnet", 3600000); }
}
// ---------- Arbitrage-Reise: der Magier startet uns auf einem fremden Server mit einem Auftrag im gemeinsamen Speicher ----------
function my_sv() { try { return String(server.region + server.id).replace(/\s+/g, "").toLowerCase(); } catch (e) { return ""; } }
function norm_sv(sv) { return String(sv || "").replace(/^SR_/i, "").replace(/\s+/g, "").toLowerCase(); }
var arb_job = null, arb_res = null, arb_idle = false;
try { arb_job = JSON.parse(localStorage.getItem("lp_arb_job_" + character.name) || "null"); } catch (e) {}
function arb_save() { try { localStorage.setItem("lp_arb_result_" + character.name, JSON.stringify(arb_res)); } catch (e) {} }
function arb_log(m) { say("Reise: " + m); if (arb_res) { arb_res.log.push(m); if (arb_res.log.length > 30) arb_res.log = arb_res.log.slice(-30); arb_res.t = Date.now(); arb_save(); } }
function count_item(name, level) { var n = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) == (level || 0)) n += it.q || 1; } return n; }
async function run_arbitrage(job) {
    arb_res = { id: job.id, t: Date.now(), server: my_sv(), bought: 0, sold: 0, spent: 0, earned: 0, skipped: 0, log: [], done: false }; arb_save();
    var t0 = Date.now(), bought = {};
    try {
        stand_off(); status("Reise");
        arb_log("auf " + my_sv().toUpperCase() + " mit " + job.offers.length + " Angeboten, " + character.gold + " Gold");
        var offers = job.offers.slice().sort(function (a, b) { return b.profit - a.profit; });
        for (var i = 0; i < offers.length; i++) {
            var o = offers[i]; if (Date.now() - t0 > 6 * 60000) { arb_log("Zeitlimit erreicht"); break; }
            if (character.esize < 2) { arb_log("Inventar voll"); break; }
            if (character.gold < o.price) { arb_res.skipped++; arb_log(o.name + "+" + o.level + ": zu wenig Gold (" + o.price + ")"); continue; }
            if (o.map && o.x != null) { var ok = await go({ map: o.map, x: o.x, y: o.y + 30 }, 120); if (!ok) { arb_res.skipped++; arb_log(o.seller + " nicht erreichbar"); continue; } }
            var seller = null; try { seller = get_player(o.seller); } catch (e) {}
            if (!seller || !seller.slots) { arb_res.skipped++; arb_log("Händler " + o.seller + " nicht (mehr) hier"); continue; }
            var it = seller.slots[o.tslot];
            if (!it || it.name != o.name || (it.level || 0) != (o.level || 0) || it.price > o.price * 1.02) { arb_res.skipped++; arb_log(o.name + "+" + o.level + " bei " + o.seller + " nicht mehr da/teurer"); continue; }
            var n0 = count_item(o.name, o.level), g0 = character.gold;
            try { trade_buy(seller, o.tslot, 1); } catch (e) { try { parent.socket.emit("trade_buy", { slot: o.tslot, id: seller.id, q: "1", rid: it.rid }); } catch (e2) {} }
            await sleep(1200);
            if (count_item(o.name, o.level) > n0) { arb_res.bought++; arb_res.spent += g0 - character.gold; bought[item_key(o.name, o.level)] = (bought[item_key(o.name, o.level)] || 0) + 1; arb_log("gekauft " + o.name + "+" + o.level + " für " + (g0 - character.gold)); }
            else { arb_res.skipped++; arb_log("Kauf " + o.name + "+" + o.level + " nicht gelungen"); }
            arb_save();
        }
        if (arb_res.bought) { // beim NPC verkaufen
            status("verkauft"); await smart_move("potions"); await sleep(500);
            var ge = character.gold;
            for (var k in bought) { var left = bought[k]; for (var j = character.items.length - 1; j >= 0 && left > 0; j--) { var it2 = character.items[j]; if (it2 && item_key(it2.name, it2.level) == k) { try { sell_item(j, 1); } catch (e) {} left--; arb_res.sold++; await sleep(400); } } }
            arb_res.earned = character.gold - ge;
            arb_log("verkauft " + arb_res.sold + " Items für " + arb_res.earned + " Gold – Gewinn " + (arb_res.earned - arb_res.spent));
        } else arb_log("nichts gekauft");
    } catch (e) { arb_log("Fehler: " + (e && e.message ? e.message : e)); }
    arb_res.done = true; arb_res.profit = arb_res.earned - arb_res.spent; arb_res.gold = character.gold; arb_save();
    arb_idle = true; status("Reise fertig");
}
async function loop() {
    var g = MY_GEN;
    if (HAD_OLD) { say("neue Version " + MERCH_VERSION + " übernommen"); await sleep(3000); }
    if (arb_job && !arb_job.done) { // Auftrag vorhanden: nur ausführen, wenn wir wirklich auf dem Zielserver sind
        if (norm_sv(arb_job.server) == my_sv()) { await sleep(1500); await run_arbitrage(arb_job); }
        else if (Date.now() - (arb_job.t || 0) < 15 * 60000) { arb_res = { id: arb_job.id, t: Date.now(), server: my_sv(), done: true, wrong_server: true, log: ["auf " + my_sv().toUpperCase() + " statt " + norm_sv(arb_job.server).toUpperCase() + " gelandet"] }; arb_save(); say("Reise: falscher Server (" + my_sv().toUpperCase() + "), Auftrag verworfen"); }
    }
    while (window.__lp_gen == g) {
        try {
            if (arb_idle) { if (character.rip) { await sleep(15000); respawn(); } await sleep(3000); continue; } // Reise fertig: warten, bis der Magier uns zuhause neu startet
            if (character.rip) { stand_off(); await sleep(15000); respawn(); await sleep(5000); continue; }
            if (m_paused) { if (stand_open()) stand_off(); status("Pause"); await sleep(3000); continue; }
            if (locate_item(STAND_ITEM) < 0) { status("kein Stand"); await do_buy_stand(); if (locate_item(STAND_ITEM) < 0 && mage && character.gold < (G.items[STAND_ITEM].g || 0) && Date.now() - last_gold_ask > 120000) { await do_mluck(); } await sleep(5000); continue; }
            if (pickup) { await do_pickup(); continue; }
            if (LEVEL_MODE && character.level < MLUCK_LEVEL) { // Level-Phase: Stand zu, beim Magier mitlaufen (Party-XP), bei Angriff zum Magier flüchten
                if (stand_open()) stand_off();
                say_once("levelmode", "Lv " + character.level + " – mluck erst ab Lv " + MLUCK_LEVEL + ", levle in der Party beim Magier mit", 1800000);
                if (character.hp < character.max_hp * 0.5) { var hp_i = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && /^hpot/.test(it.name)) { hp_i = i; break; } } if (hp_i >= 0) { try { equip(hp_i); } catch (e) {} } else { try { use_skill("regen_hp"); } catch (e) {} } }
                var att = my_attacker(); var me = mage_entity();
                if (att && me && character.map == me.map) { try { move(me.x, me.y); } catch (e) {} status("flieht"); await sleep(500); continue; }
                status("levelt"); await follow_mage(); await sleep(1000); continue;
            }
            if (USE_MLUCK && character.level >= MLUCK_LEVEL && mluck_needed() && Date.now() - last_mluck_try > 5 * 60000 && !mage.paused) { status("mluck"); await do_mluck(); continue; }
            if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 30 * 60000) { status("Gold holen"); await do_mluck(); continue; }
            status(stand_open() ? "Stand" : "unterwegs");
            await do_home();
            await check_stand_age();
        } catch (e) { say("Fehler: " + (e && e.message ? e.message : e)); }
        await sleep(3000);
    }
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
try { localStorage.setItem("lp_where_" + character.name, JSON.stringify({ sv: (typeof server != "undefined" && server ? server.region + server.id : ""), t: Date.now(), v: MERCH_VERSION })); } catch (e) {} // für den Magier lesbar, auch wenn wir auf einem anderen Server sind (Nachrichten gehen dann nicht)
try { send_cm(MAGE, { t: "hello", v: MERCH_VERSION, sv: (typeof server != "undefined" && server ? server.region + server.id : "") }); } catch (e) {}
say("Händler " + MERCH_VERSION + " gestartet (Lv " + character.level + ", " + character.gold + " Gold" + (locate_item(STAND_ITEM) >= 0 ? ", Stand vorhanden" : ", kein Stand") + ")");
loop();
