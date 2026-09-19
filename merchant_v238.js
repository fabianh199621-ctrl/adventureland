// ===== Adventure Land – LogicPlan Händler (F4llenMerch) – Stufe 1 =====
// Läuft unsichtbar neben dem Magier. Aufgaben: Stand kaufen und öffnen, Loot abholen/verkaufen/einlagern,
// Startgold vom Magier holen. mluck ist abgeschaltet (braucht Lv 40, Händler levelt praktisch nicht) – USE_MLUCK/LEVEL_MODE. Meldungen gehen per Charakter-Nachricht an den Magier und erscheinen dort als "[Merch] …".
var MERCH_VERSION = "v238";
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
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: character.rip ? "tot" : state, gold: character.gold, stand: !!character.stand, map: character.map, hp: character.hp, max_hp: character.max_hp, orders: order_state }); } catch (e) {} }
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
    else if (data.t == "goldback") { goldback_req = Date.now(); }
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
function pot_stock(n) { var q = 0; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == n) q += it.q || 1; } return q; }
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
        var tp0 = req.team_pots || []; if (tp0.length) { var thp = 0, tmp = 0; tp0.forEach(function (x) { thp += x.hp || 0; tmp += x.mp || 0; }); thp = Math.max(0, thp - pot_stock("hpot0")); tmp = Math.max(0, tmp - pot_stock("mpot0")); var tcost = thp * (G.items.hpot0.g || 0) + tmp * (G.items.mpot0.g || 0); if (character.gold >= tcost + 5000) { try { await smart_move("potions"); if (thp) await buy("hpot0", thp); if (tmp) await buy("mpot0", tmp); await sleep(600); say("Tränke gekauft für " + tp0.map(function (x) { return x.name; }).join("/") + ": " + thp + " hpot0 / " + tmp + " mpot0"); } catch (e) { say("Trankkauf Team: " + (e && e.reason || e)); } } else say("Zu wenig Gold für Team-Tränke (" + tcost + ")"); }
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
        // Tränke für Priest/Ranger (hpot0/mpot0) übergeben, wenn sie neben dem Magier stehen
        var tp = req.team_pots || []; for (var ti = 0; ti < tp.length; ti++) { var tn = tp[ti]; var tpl = null; var tw = Date.now(); while (Date.now() - tw < 60000) { try { tpl = get_player(tn.name); } catch (e) { tpl = null; } if (tpl && tpl.map == character.map && Math.hypot(character.x - tpl.x, character.y - tpl.y) <= 300) break; if (tpl && tpl.map == character.map && Math.hypot(character.x - tpl.x, character.y - tpl.y) <= 600) { try { move(character.x + (tpl.x - character.x) * 0.5, character.y + (tpl.y - character.y) * 0.5); } catch (e) {} } status("wartet auf " + tn.name); await sleep(2000); } if (!tpl || tpl.map != character.map || Math.hypot(character.x - tpl.x, character.y - tpl.y) > 300) { say("Tränke für " + tn.name + ": nicht in Reichweite – behalte sie für die nächste Abholung"); continue; } var gv = 0; for (var tj = 0; tj < character.items.length; tj++) { var tit = character.items[tj]; if (!tit) continue; var want = tit.name == "hpot0" ? tn.hp : tit.name == "mpot0" ? tn.mp : 0; if (want > 0) { var q = Math.min(want, tit.q || 1); try { send_item(tn.name, tj, q); gv += q; if (tit.name == "hpot0") tn.hp -= q; else tn.mp -= q; await sleep(300); } catch (e) {} } } if (gv) say(gv + " Tränke an " + tn.name + " übergeben"); }
        var gave_gold = 0; if (character.gold > GOLD_HANDBACK) { gave_gold = character.gold - GOLD_KEEP; try { send_gold(MAGE, gave_gold); } catch (e) { gave_gold = 0; } }
        try { send_cm(MAGE, { t: "delivered", pots: gave_pots, gold: gave_gold }); } catch (e) {}
        say("Übernommen: " + Object.keys(manifest).length + " Posten" + (gave_pots ? ", " + gave_pots + " Tränke übergeben" : "") + (gave_gold ? ", " + gave_gold + " Gold übergeben" : ""));
    } catch (e) { say("Abholung: " + (e && e.message ? e.message : e)); }
    await process_inventory();
}
async function process_inventory() { // in der Stadt: verkaufen, an den Stand, in die Bank
    var sell = [], stand = [], bank = [];
    var silk = 0;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || it.name == STAND_ITEM || /^(hpot|mpot)/.test(it.name)) continue;
        if (it.name == "rod" || it.name == "pickaxe" || it.name == "staff" || it.name == "blade" || stand_orders[it.name]) continue; // Werkzeug, Zutaten und Auftrags-Items bleiben
        if (it.name == "spidersilk") { silk += it.q || 1; if (silk <= 2) continue; }
        var a = manifest[item_key(it.name, it.level)] || (/^(bronzenugget|coat1|helmet1|pants1|gloves1|shoes1)$/.test(it.name) ? "sell" : "bank"); (a == "sell" ? sell : a == "stand" ? stand : bank).push(i); }
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
    for (var sl in character.slots) { if (sl.indexOf("trade") != 0 || !character.slots[sl]) continue; var rec = listed[sl]; if (!rec) { listed[sl] = { name: character.slots[sl].name, level: character.slots[sl].level || 0, t: Date.now() }; continue; } if (!rec.order && !precious(character.slots[sl]) && Date.now() - rec.t > STAND_MAX_AGE) old.push(sl); }
    for (var sl2 in listed) if (!character.slots[sl2]) { if (listed[sl2].price) say("Verkauft am Stand: " + listed[sl2].name + "+" + listed[sl2].level + " für " + listed[sl2].price); delete listed[sl2]; }
    save_listed();
    if (!old.length) return;
    say("Ladenhüter: " + old.length + " Items vom Stand zum NPC");
    try { for (var k = 0; k < old.length; k++) { try { unequip(old[k]); } catch (e) {} await sleep(400); manifest[item_key(listed[old[k]].name, listed[old[k]].level)] = "sell"; delete listed[old[k]]; } save_listed(); await process_inventory(); } catch (e) { say("Ladenhüter: " + (e && e.message || e)); }
}

// ---------- Stufe 3a: Angeln und Bergbau in den Wartezeiten (Werkzeuge beim Handwerker selbst bauen) ----------
var GATHER = true, FISH_SPOTS = [{ map: "main", x: -1368, y: -90 }, { map: "main", x: -1198, y: -288 }], MINE_SPOTS = [{ map: "tunnel", x: -280, y: -10 }, { map: "tunnel", x: -200, y: -50 }];
var TOOL_RECIPES = { rod: ["staff", "spidersilk"], pickaxe: ["staff", "spidersilk", "blade"] };
var last_gather_try = {}, gather_fail = {}, gather_busy = false, last_tool_try = 0, last_silk_ask = 0;
function have_item(n) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == n) return i; } for (var sl in character.slots) { var w = character.slots[sl]; if (w && w.name == n && sl.indexOf("trade") != 0) return -2; } return -1; }
function skill_cd(name) { try { if (typeof is_on_cooldown == "function") return is_on_cooldown(name); } catch (e) {} try { var t = parent.next_skill && parent.next_skill[name]; return t && new Date(t).getTime() > Date.now(); } catch (e) {} return false; }
async function ensure_tool(tool) { // Werkzeug vorhanden? sonst Zutaten kaufen/anfordern und beim Handwerker bauen
    if (have_item(tool) != -1) return true;
    if (Date.now() - last_tool_try < 5 * 60000) return false; last_tool_try = Date.now();
    var need = TOOL_RECIPES[tool], missing = need.filter(function (n) { return have_item(n) == -1; });
    // kaufbare Zutaten (Stab, Klinge) beim NPC holen
    for (var i = 0; i < missing.length; i++) { var n = missing[i]; var npc = npc_selling(n); if (!npc) continue; var pr = (G.items[n] || {}).g || 0; if (character.gold < pr + GOLD_KEEP) { say_once("toolgold", "Werkzeug " + tool + ": zu wenig Gold für " + n, 1800000); return false; } var pos = npc_pos(npc); if (!pos) continue; await go({ map: pos.map, x: pos.x, y: pos.y + 20 }, 60); try { buy(n, 1); await sleep(600); } catch (e) {} }
    missing = need.filter(function (n) { return have_item(n) == -1; });
    if (missing.length) { if (missing.indexOf("spidersilk") >= 0 && Date.now() - last_silk_ask > 10 * 60000) { last_silk_ask = Date.now(); try { send_cm(MAGE, { t: "need", item: "spidersilk", q: 2 }); } catch (e) {} say_once("silk", "Für " + tool + " fehlt Spinnenseide – beim Magier angefragt", 1800000); } else say_once("toolmiss", "Werkzeug " + tool + ": fehlt " + missing.join(", "), 1800000); return false; }
    var cp = npc_pos("craftsman"); if (!cp) return false;
    await go({ map: cp.map, x: cp.x, y: cp.y + 20 }, 60);
    try { if (typeof craft == "function") await craft(tool); else parent.socket.emit("craft", { name: tool }); } catch (e) { say("Handwerker " + tool + ": " + (e && e.reason || e && e.message || JSON.stringify(e).slice(0, 80))); }
    await sleep(1500);
    if (have_item(tool) != -1) { say(tool + " beim Handwerker gebaut"); return true; }
    say("Werkzeug " + tool + " nicht gebaut (Zutaten da: " + need.map(function (n) { return n + (have_item(n) != -1 ? "✓" : "✗"); }).join(" ") + ")"); return false;
}
async function gather(kind) { // kind: "fishing" | "mining"
    var tool = kind == "fishing" ? "rod" : "pickaxe", spots = kind == "fishing" ? FISH_SPOTS : MINE_SPOTS;
    if (!await ensure_tool(tool)) return false;
    stand_off(); status(kind == "fishing" ? "angelt" : "baut ab");
    var ti = have_item(tool), worn = character.slots.mainhand ? character.slots.mainhand.name : null;
    var start = gather_fail[kind] || 0, ok = false, why = null, g0 = character.gold, n0 = character.items.filter(function (x) { return x; }).length;
    for (var si = 0; si < spots.length && !ok; si++) {
        var sp = spots[(start + si) % spots.length];
        if (!await go(sp, 30)) { why = "Platz nicht erreichbar"; continue; }
        if (ti >= 0) { try { equip(ti); await sleep(700); } catch (e) {} ti = -2; }
        try {
            var r = await use_skill(kind); if (r && r.failed) throw r;
            for (var w = 0; w < 40; w++) { await sleep(500); if (!(character.c && character.c[kind])) break; }
            ok = true; gather_fail[kind] = (start + si) % spots.length;
        } catch (e) { why = e && (e.reason || e.message || (typeof e == "string" ? e : JSON.stringify(e).slice(0, 100))); }
    }
    await sleep(1500);
    var gained = [], n1 = 0; character.items.forEach(function (x) { if (x) n1++; });
    if (ok) say((kind == "fishing" ? "Geangelt" : "Abgebaut") + ": " + (character.gold - g0 > 0 ? "+" + (character.gold - g0) + " Gold" : "") + (n1 > n0 ? ", " + (n1 - n0) + " neue Items" : "") + ((character.gold - g0 <= 0 && n1 <= n0) ? "nichts gefangen" : ""));
    else say((kind == "fishing" ? "Angeln" : "Bergbau") + " nicht gelungen: " + (why || "unbekannt") + " (Position " + character.map + " " + Math.round(character.x) + "," + Math.round(character.y) + ")");
    // Werkzeug wieder ablegen (Händler braucht keine Waffe)
    try { if (character.slots.mainhand && (character.slots.mainhand.name == "rod" || character.slots.mainhand.name == "pickaxe")) { unequip("mainhand"); await sleep(500); } } catch (e) {}
    return ok;
}
async function gather_tick() { // in der Hauptschleife: bei freiem Cooldown losziehen
    if (!GATHER || gather_busy || pickup || arb_idle) return false;
    var kinds = ["mining", "fishing"], did = false;
    for (var k = 0; k < kinds.length; k++) {
        var kind = kinds[k];
        if (skill_cd(kind)) continue;
        if (Date.now() - (last_gather_try[kind] || 0) < 10 * 60000) continue;
        last_gather_try[kind] = Date.now(); gather_busy = true;
        try { await gather(kind); } catch (e) { say("Sammeln " + kind + ": " + (e && e.message || e)); }
        gather_busy = false; did = true;
    }
    return did;
}

// ---------- Stand-Aufträge vom Magier: Wertsachen aus der Bank holen und zum vorgegebenen Preis anbieten ----------
var stand_orders = {}, last_orders_check = 0, order_state = {};
function load_orders() { try { stand_orders = JSON.parse(localStorage.getItem("lp_stand_orders_" + character.name) || "{}"); } catch (e) { stand_orders = {}; } }
function precious(it) { return !!it && (/^(scroll[2-9]|cscroll[2-9])$/.test(it.name) || npc_val(it.name, it.level) >= 1000000); } // wird nie automatisch zum NPC gebracht oder umgeräumt
function listed_slot_of(name) { for (var sl in character.slots) { var w = character.slots[sl]; if (sl.indexOf("trade") == 0 && w && w.name == name) return sl; } return null; }
async function fetch_from_bank(name) { // Item aus der Bank holen (Bank ist kontoweit)
    stand_off(); status("Bank"); await smart_move("bank"); await sleep(1000);
    var bank = character.bank || {}; for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; for (var i = 0; i < bank[pack].length; i++) { var it = bank[pack][i]; if (it && it.name == name) { try { bank_retrieve(pack, i); await sleep(800); } catch (e) {} if (have_item(name) >= 0) { say(name + " aus der Bank geholt"); return true; } } } }
    say(name + " nicht in der Bank gefunden"); return false;
}
var slots_logged = false;
function log_trade_slots() { if (slots_logged) return; slots_logged = true; try { var ks = Object.keys(character.slots || {}).filter(function (k) { return k.indexOf("trade") == 0; }); var filled = ks.filter(function (k) { return character.slots[k]; }).map(function (k) { return k + ":" + character.slots[k].name + "@" + character.slots[k].price; }); say("Stand-Slots im Nebenfenster: " + ks.length + " Schlüssel, belegt: " + (filled.join(", ") || "keine")); } catch (e) { say("Stand-Slots: " + e); } }
async function orders_tick() {
    log_trade_slots();
    if (Date.now() - last_orders_check < 60000 || pickup || arb_idle || gather_busy) return false; last_orders_check = Date.now();
    load_orders(); var did = false;
    for (var name in stand_orders) {
        var o = stand_orders[name]; if (!o || !o.price) continue;
        var sl = listed_slot_of(name);
        if (sl) { // schon am Stand: Preis prüfen
            var cur = character.slots[sl];
            if (Math.abs((cur.price || 0) - o.price) > 1000) { try { delete listed[sl]; unequip(sl); await sleep(800); var ix = have_item(name); if (ix < 0) { say("Neu bepreisen " + name + ": nach dem Abnehmen nicht im Inventar?! (Slot " + sl + ") – bitte im Spiel prüfen"); } else { trade(ix, sl, o.price, cur.q || 1); await sleep(800); var chk = character.slots[sl]; if (chk && chk.name == name) { listed[sl] = { name: name, level: 0, t: Date.now(), price: o.price, order: true, gold0: character.gold }; save_listed(); say(name + " am Stand neu bepreist: " + o.price + " (Slot " + sl + ")"); } else { say(name + " wieder ausstellen zu " + o.price + " nicht bestätigt – liegt im Inventar, nächster Versuch"); } } } catch (e) { say("Neu bepreisen " + name + ": " + (e && e.reason || e)); } }
            order_state[name] = "am Stand für " + o.price; continue;
        }
        var ix2 = have_item(name);
        if (ix2 < 0) { var any_slot = Object.keys(character.slots || {}).some(function (k) { return k.indexOf("trade") == 0; }); if (!any_slot) { order_state[name] = "Stand-Slots nicht sichtbar"; continue; } if (order_state[name] == "nicht in Bank" && Date.now() - (o.t || 0) < 3600000) continue; if (!await fetch_from_bank(name)) { order_state[name] = "nicht in Bank"; continue; } ix2 = have_item(name); did = true; }
        if (ix2 < 0) continue;
        await go(home_spot(), 40); if (!stand_open()) stand_on(); await sleep(800);
        var slot = free_trade_slot(); if (!slot) { say("Kein freier Stand-Platz für " + name); continue; }
        try { trade(ix2, slot, o.price, character.items[ix2].q || 1); await sleep(800); listed[slot] = { name: name, level: 0, t: Date.now(), price: o.price, order: true, gold0: character.gold }; save_listed(); say(name + " am Stand ausgestellt für " + o.price); order_state[name] = "am Stand für " + o.price; did = true; } catch (e) { say("Ausstellen " + name + ": " + (e && e.reason || e)); }
    }
    // verkauft? (Eintrag weg, Auftrag noch da)
    for (var sl3 in listed) { var rec = listed[sl3]; if (!rec || !rec.order || character.slots[sl3]) continue;
        var sold = rec.gold0 != null && character.gold >= rec.gold0 + rec.price * 0.9; // wirklich verkauft: nur wenn das Gold entsprechend gestiegen ist
        delete listed[sl3]; save_listed();
        if (sold) { try { send_cm(MAGE, { t: "sold", name: rec.name, price: rec.price }); } catch (e) {} say("VERKAUFT am Stand: " + rec.name + " für " + rec.price + " Gold (Kasse jetzt " + character.gold + ")"); delete stand_orders[rec.name]; try { localStorage.setItem("lp_stand_orders_" + character.name, JSON.stringify(stand_orders)); } catch (e) {} }
        else say(rec.name + " ist nicht mehr am Stand, aber NICHT verkauft (Gold " + character.gold + ") – stelle es wieder aus"); }
    return did;
}
var goldback_req = 0, last_goldback = 0, GOLD_AUTO_BACK = 5000000; // ab 5 M Gold von selbst zum Magier bringen
async function do_goldback() { // zum Magier laufen und alles über GOLD_KEEP übergeben
    goldback_req = 0; last_goldback = Date.now();
    var amt = character.gold - GOLD_KEEP; if (amt < 1000) { say("Gold übergeben: nichts über der Reserve (" + character.gold + ")"); return; }
    if (!mage) { say("Gold übergeben: Magier-Position unbekannt"); return; }
    stand_off(); status("bringt Gold");
    for (var i = 0; i < 4; i++) { var t = mage_entity(); if (t && character.map == t.map && Math.hypot(character.x - t.x, character.y - t.y) < 200) break; var p = t && character.map == t.map ? { map: t.map, x: t.x, y: t.y } : { map: mage.map, x: mage.x, y: mage.y }; await go(p, 100); }
    var t2 = mage_entity(); if (!t2 || character.map != t2.map || Math.hypot(character.x - t2.x, character.y - t2.y) > 300) { say("Gold übergeben: Magier nicht erreicht – nächster Versuch später"); return; }
    var g0 = character.gold; try { send_gold(MAGE, amt); } catch (e) { say("Gold übergeben fehlgeschlagen: " + (e && e.reason || e)); return; }
    await sleep(800); say("Gold übergeben: " + (g0 - character.gold) + " an " + MAGE + " (behalte " + character.gold + ")");
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
            if (m_paused) { status("Pause"); if (!stand_open() && locate_item(STAND_ITEM) >= 0 && dist_to(home_spot()) < 80) stand_on(); await sleep(3000); continue; } // Pause: Stand bleibt offen (Wertsachen bleiben ausgestellt)
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
            if (goldback_req || (character.gold > GOLD_AUTO_BACK && Date.now() - last_goldback > 10 * 60000 && mage && Date.now() - mage.t < 30000)) { await do_goldback(); continue; }
            if (await orders_tick()) continue;
            if (await gather_tick()) continue;
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
