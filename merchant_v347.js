// ===== Adventure Land – LogicPlan Händler (F4llenMerch) – Stufe 1 =====
// Läuft unsichtbar neben dem Magier. Aufgaben: Stand kaufen und öffnen, Loot abholen/verkaufen/einlagern,
// Startgold vom Magier holen. mluck ist abgeschaltet (braucht Lv 40, Händler levelt praktisch nicht) – USE_MLUCK/LEVEL_MODE. Meldungen gehen per Charakter-Nachricht an den Magier und erscheinen dort als "[Merch] …".
var MERCH_VERSION = "v347";
// Generationswechsel: wird das Skript per N neu eingespielt, beendet sich die alte Schleife von selbst (kein Neu-Einloggen)
try { window.__lp_gen = (window.__lp_gen || 0) + 1; } catch (e) {}
var MY_GEN = window.__lp_gen, HAD_OLD = MY_GEN > 1; // Achtung: globale Namen werden beim Neu-Einspielen überschrieben, daher Generation immer lokal (g) festhalten

var MAGE = "F4llen";
// Fehlgekaufte Angebote (Kauf ohne Antwort): 24 h meiden – der Magier liest die Liste bei der Reiseplanung (lp_arb_bad_<Händler>)
function arb_bad_key(o) { return o.name + "+" + (o.level || 0) + "@" + o.seller + "@" + o.price; }
function arb_bad_note(o, why) { try { var bad = JSON.parse(localStorage.getItem("lp_arb_bad_" + character.name) || "{}"); var now = Date.now(); for (var k in bad) if (bad[k] < now) delete bad[k]; bad[arb_bad_key(o)] = now + 24 * 3600000; localStorage.setItem("lp_arb_bad_" + character.name, JSON.stringify(bad)); } catch (e) {} say("Kauf " + o.name + "+" + (o.level || 0) + " bei " + o.seller + " fehlgeschlagen (" + why + ") – 24 h gemieden"); }
try { localStorage.setItem("lp_tlog_" + character.name, JSON.stringify([{ t: Date.now(), m: "Skript geladen (" + character.ctype + ", Lv " + character.level + ", Server " + (typeof server != "undefined" && server ? (server.region + " " + server.id) : "?") + ")" }])); } catch (e) {}
var STAND_ITEM = "stand0";
var MLUCK_EVERY = 25 * 60000;      // mluck hält 60 min, wir frischen ab 25 min Restlaufzeit auf
var GOLD_WANT = 200000, GOLD_MIN = 60000;
var MLUCK_LEVEL = (G.skills.mluck && G.skills.mluck.level) || 40; // mluck erst ab diesem Level
var LEVEL_MODE = false;  // true = unter MLUCK_LEVEL beim Magier mitlaufen (Party-XP); false = immer am Stand bleiben
var USE_MLUCK = true; // mluck auf den Magier, sobald das Level reicht (MLUCK_LEVEL)   // true = mluck auf den Magier versuchen (nur sinnvoll ab MLUCK_LEVEL)
var FOLLOW_DIST = 140, FOLLOW_MAX = 240, moving = false, last_follow_move = 0;
var mage = null;                   // letzte Meldung des Magiers { map, x, y, mluck, paused, t }
var m_paused = false, task = null, last_log = {}, stand_pos = null, last_mluck_try = 0, last_gold_ask = 0, last_status = 0, started = Date.now();
function say(msg) { try { send_cm(MAGE, { t: "log", msg: msg }); } catch (e) {} try { game_log("[Merch] " + msg); } catch (e) {} try { var k = "lp_tlog_" + character.name, arr = JSON.parse(localStorage.getItem(k) || "[]"); arr.push({ t: Date.now(), m: msg }); if (arr.length > 40) arr = arr.slice(-40); localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} }
function say_once(key, msg, every) { if (last_log[key] && Date.now() - last_log[key] < (every || 600000)) return; last_log[key] = Date.now(); say(msg); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var last_state = null;
// ---------- Bankfächer: Gabrielle (items0) = Ausrüstung, Gabriella (items1) = Drops/Material, Ledia (items2) = Überlauf ----------
var BANK_GEAR_TYPES = { helmet: 1, chest: 1, pants: 1, shoes: 1, gloves: 1, cape: 1, weapon: 1, ring: 1, earring: 1, amulet: 1, belt: 1, orb: 1, quiver: 1, shield: 1, source: 1, misc_offhand: 1 };
var BANK_PACKS = { gear: "items0", mat: "items1", over: "items2" };
function bank_pack_for(it) { var d = (it && G.items[it.name]) || {}; return BANK_GEAR_TYPES[d.type] ? BANK_PACKS.gear : BANK_PACKS.mat; }
function bank_free_in(pack, it) { // freier Platz im Fach (bei stapelbaren Items zuerst ein Stapel mit Luft), -1 = keiner / Fach nicht gekauft
    var p = character.bank && character.bank[pack]; if (!Array.isArray(p)) return -1;
    var d = it && G.items[it.name]; if (d && d.s) { var mx = typeof d.s == "number" ? d.s : 9999; for (var j = 0; j < p.length; j++) { var b = p[j]; if (b && b.name == it.name && (b.level || 0) == (it.level || 0) && (b.q || 1) + (it.q || 1) <= mx) return j; } }
    for (var i = 0; i < p.length; i++) if (!p[i]) return i; return -1;
}
async function bank_put_at(i, pack, s) { // Item i in Fach/Platz legen; hat der Server getauscht statt gestapelt → zurücktauschen und freien Platz nehmen
    var it = character.items[i]; if (!it) return false; var old = character.bank[pack][s], oq = old ? (old.q || 1) : 0, myq = it.q || 1;
    bank_store(i, pack, s); await sleep(500);
    var now = character.items[i], bs = character.bank[pack] && character.bank[pack][s];
    if (old && now && now.name == it.name && (now.q || 1) == oq && bs && bs.name == it.name && (bs.q || 1) == myq) { bank_store(i, pack, s); await sleep(500); var f = -1, p = character.bank[pack]; for (var k = 0; k < p.length; k++) if (!p[k]) { f = k; break; } if (f < 0) return false; bank_store(i, pack, f); await sleep(500); }
    return true;
}
async function bank_put(i) { // ins passende Fach; ist es voll → Ledia; ohne Fächer-Info → wie das Spiel es wählt
    var it = character.items[i]; if (!it) return false;
    var want = bank_pack_for(it), s = bank_free_in(want, it);
    if (s < 0) { want = BANK_PACKS.over; s = bank_free_in(want, it); }
    if (s < 0) { bank_store(i); await sleep(300); return true; }
    return bank_put_at(i, want, s);
}
function item_rules() { try { return JSON.parse(localStorage.getItem("lp_item_rules") || "{}"); } catch (e) { return {}; } } // Item-Regeln aus dem Magier-Fenster (Auto/Behalten/Compound/Stand/NPC/Team)
function type_rules() { try { return JSON.parse(localStorage.getItem("lp_type_rules") || "{}"); } catch (e) { return {}; } } // Typregeln (Fallback, wenn das Item keine eigene Regel hat)
function rule_obj_of(it) { if (!it) return null; var R = item_rules(), r = R[it.name + ((it.level || 0) ? "+" + it.level : "")] || R[it.name]; if (!r) { var d = G.items[it.name] || {}; r = type_rules()[d.type || ""]; } return r || null; }
function rule_of_it(it) { return (rule_obj_of(it) || {}).r || ""; }
function rule_price(it) { var r = rule_obj_of(it); return r && r.r == "stand" && r.price > 0 ? r.price : 0; }
function rule_action(it) { var r = rule_of_it(it); return r == "npc" ? "sell" : r == "stand" ? "stand" : (r == "keep" || r == "comp" || r == "team") ? "bank" : ""; }
function inv_brief() { var out = []; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it) out.push({ n: it.name, l: it.level || 0, q: it.q || 1 }); } return out; }
function status(state) { if (state == last_state && Date.now() - last_status < 30000) return; last_state = state; last_status = Date.now(); try { send_cm(MAGE, { t: "st", level: character.level, state: character.rip ? "tot" : state, gold: character.gold, stand: !!character.stand, map: character.map, inv: inv_brief(), hp: character.hp, max_hp: character.max_hp, orders: order_state, gather: (function () { try { return gather_info(); } catch (e) { return null; } })() }); } catch (e) {} }
// ---------- Stufe 2: Abholung, Verkauf am Stand/NPC, Bank ----------
var pickup = null, manifest = {}, pickup_done = false, STAND_MARKUP = 1.8, STAND_MAX_AGE = 24 * 3600000, GOLD_KEEP = 150000, GOLD_HANDBACK = 300000;
var unlist_req = [];
function stand_live_write(live) { try { localStorage.setItem("lp_stand_live_" + character.name, JSON.stringify({ t: Date.now(), found: !!(stand_live.found || trade_keys_local().length), slots: live || {} })); } catch (e) {} }
var listed = {}; try { listed = JSON.parse(localStorage.getItem("lp_listed_" + character.name) || "{}"); } catch (e) {}
function save_listed() { try { localStorage.setItem("lp_listed_" + character.name, JSON.stringify(listed)); } catch (e) {} }
function item_key(name, level) { return name + "+" + (level || 0); }
function npc_val(name, level) { try { if (typeof parent.calculate_item_value == "function") { var v = parent.calculate_item_value({ name: name, level: level || 0 }); if (isFinite(v) && v > 0) return v; } } catch (e) {} var d = G.items[name]; return d && d.g ? d.g : 0; }
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
var tidy_req = 0, banksort_req = 0, direct_buy = null, donate_req = null, kiss_req = null;
async function do_kiss(k) { // Kuss-Runde: Stand zu, zur Zielperson, ikissyou bis Belohnung, zurück
    kiss_req = null; stand_off(); status("Kuss");
    try {
        if (!(await go({ map: k.map, x: k.x, y: k.y }, 60))) throw "Zielperson nicht erreichbar";
        var range = (G.skills.ikissyou && G.skills.ikissyou.range) || 50, t_end = Date.now() + 180000, ok = false;
        var snap = function () { var o = { gift: 0, slices: 0, buff: !!(character.s && character.s.anniversary_kiss) }; character.items.forEach(function (i) { if (!i) return; if (i.name == "anniversarygift") o.gift += i.q || 1; if (/^slice_/.test(i.name)) o.slices += i.q || 1; }); return o; };
        var before = snap();
        while (Date.now() < t_end) {
            var n = snap(); if (n.gift > before.gift || n.slices > before.slices || (n.buff && !before.buff)) { ok = true; break; }
            var ent = null; try { ent = get_player(k.name); } catch (e) {} if (!ent) { await sleep(1000); continue; }
            if (Math.hypot(character.x - ent.x, character.y - ent.y) > range - 5) { try { move(ent.x, ent.y); } catch (e) {} await sleep(400); continue; }
            if (!is_on_cooldown("ikissyou")) { try { await use_skill("ikissyou", ent); } catch (e) { var rs = String(e && e.reason || e); if (/claimed/i.test(rs)) { ok = true; break; } } await sleep(2000); }
            else await sleep(500);
        }
        say(ok ? "Kuss belohnt (Runde " + k.round + ")" : "Kuss: keine Belohnung (Runde " + k.round + ")");
    } catch (e) { say("Kuss: " + (e && e.message ? e.message : e)); }
}
async function do_donate(req) { // zu Ron (Wizard's Crib) und Gold gegen XP spenden, in 100k-Schritten, mit Protokoll der Rate
    donate_req = null; stand_off(); status("spendet");
    var total = 0, xp_total = 0, lv0 = character.level, step = 100000;
    try {
        if (!(await go({ map: "woffice", x: -24, y: -150 }, 60))) throw "Ron nicht erreichbar";
        while (total < req.gold && character.level < req.target) {
            var amt = Math.min(step, req.gold - total); if (amt < 1000) break;
            if (character.gold - amt < GOLD_MIN) { say("Spende: Kasse würde unter die Nachfüllgrenze fallen (" + character.gold + ") – Stopp"); break; }
            var x0 = character.xp, l0 = character.level, g0 = character.gold;
            try { if (typeof parent.donate == "function") parent.donate(amt); else parent.socket.emit("donate", { gold: amt }); } catch (e) { say("Spende fehlgeschlagen: " + (e && e.message || e)); break; }
            await sleep(1500);
            var spent = g0 - character.gold; if (spent <= 0) { say("Spende: Gold unverändert – Ron hat nicht angenommen (zu wenig? falscher Ort?)"); break; }
            var gained = character.level > l0 ? (G.levels[l0] - x0) + character.xp + (character.level - l0 > 1 ? G.levels[l0 + 1] : 0) : character.xp - x0;
            total += spent; xp_total += gained;
            say("Spende " + spent + " Gold → +" + gained + " XP (" + (gained / spent).toFixed(2) + " XP/Gold) · Lv " + character.level + " " + Math.round(character.xp / G.levels[character.level] * 100) + "%");
        }
    } catch (e) { say("Spende: " + (e && e.message ? e.message : e)); }
    say("Spende fertig: " + total + " Gold → " + xp_total + " XP, Lv " + lv0 + " → " + character.level + (character.level >= MLUCK_LEVEL ? " – mluck verfügbar" : ""));
    try { send_cm(MAGE, { t: "donated", gold: total, xp: xp_total, level: character.level }); } catch (e) {}
}
var GEAR_TYPES = { helmet: 1, chest: 1, pants: 1, shoes: 1, gloves: 1, cape: 1, weapon: 1, ring: 1, earring: 1, amulet: 1, belt: 1, orb: 1, quiver: 1, shield: 1, source: 1, misc_offhand: 1 };
async function do_tidy() { // auf Befehl des Magiers: billige Ausrüstung verkaufen, alles andere in die Bank (Stand-Item, Werkzeug, Tränke, Auftrags- und Einkaufsitems bleiben)
    tidy_req = 0; stand_off(); status("räumt auf");
    manifest = {}; var n_sell = 0, n_bank = 0, n_stand = 0;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || it.name == STAND_ITEM || /^(hpot|mpot)/.test(it.name)) continue;
        if (it.name == "rod" || it.name == "pickaxe" || it.name == "staff" || it.name == "blade" || it.name == "tracker" || it.name == "computer" || mbuild_protected(it.name) || order_for(it.name, it.level) || hold_items[item_key(it.name, it.level)]) continue;
        var ra = rule_action(it); if (ra) { manifest[item_key(it.name, it.level)] = ra; if (ra == "sell") n_sell++; else if (ra == "stand") n_stand++; else n_bank++; continue; } // Regel geht vor
        var d = G.items[it.name] || {}, cheap = (d.type && GEAR_TYPES[d.type]) && !/^mm|^(dex|int|str|vit)(ring|earring|amulet|belt)$/.test(it.name) && (d.g || 0) < 10000 && (it.level || 0) <= 2;
        manifest[item_key(it.name, it.level)] = cheap ? "sell" : "bank"; if (cheap) n_sell++; else n_bank++; }
    say("Aufräumen: " + n_sell + " verkaufen, " + n_stand + " an den Stand, " + n_bank + " in die Bank");
    await process_inventory();
}
async function do_banksort() { // auf Befehl des Magiers: Bankfächer nach Ausrüstung / Material umsortieren (Item raus, ins richtige Fach rein)
    banksort_req = 0; stand_off(); status("sortiert Bank");
    await enter_bank(); for (var w = 0; w < 25 && !character.bank; w++) await sleep(200);
    if (!character.bank) { say("Bank sortieren: Bank nicht erreicht (Karte " + character.map + ")"); return; }
    var moved = 0, skipped = 0, t0 = Date.now(), stop = false;
    for (var pack in character.bank) { if (stop || pack.indexOf("items") != 0 || !Array.isArray(character.bank[pack])) continue;
        for (var i = 0; i < character.bank[pack].length; i++) {
            var it = character.bank[pack][i]; if (!it) continue;
            var want = bank_pack_for(it); if (want == pack || !character.bank[want]) continue;
            var s = bank_free_in(want, it);
            if (s < 0) { if (pack == BANK_PACKS.over || !character.bank[BANK_PACKS.over]) { skipped++; continue; } want = BANK_PACKS.over; s = bank_free_in(want, it); if (s < 0) { skipped++; continue; } }
            if (character.esize < 1) { say("Bank sortieren: Inventar voll, breche ab"); stop = true; break; }
            if (Date.now() - t0 > 5 * 60000) { say("Bank sortieren: Zeitlimit – Rest beim nächsten Mal"); stop = true; break; }
            try { var before = character.items.map(function (x) { return !!x; }); bank_retrieve(pack, i); await sleep(500);
                var ii = -1; for (var k = 0; k < character.items.length; k++) { if (character.items[k] && !before[k]) { ii = k; break; } }
                if (ii < 0) { skipped++; continue; }
                if (await bank_put_at(ii, want, s)) moved++; else { await bank_put(ii); skipped++; }
            } catch (e) { skipped++; }
        }
    }
    bank_snap_write();
    say("Bank sortiert: " + moved + " Items verschoben (Ausrüstung → Gabrielle, Rest → Gabriella)" + (skipped ? ", " + skipped + " nicht (kein Platz im Zielfach)" : ""));
    try { send_cm(MAGE, { t: "banksorted", moved: moved, skipped: skipped }); } catch (e) {}
}
var hold_items = {}; try { hold_items = JSON.parse(localStorage.getItem("lp_hold_" + character.name) || "{}"); } catch (e) {} // gekaufte Items für den Magier: nicht verkaufen/einlagern
function hold_save() { try { localStorage.setItem("lp_hold_" + character.name, JSON.stringify(hold_items)); } catch (e) {} }
function on_cm(name, data) {
    if (name != MAGE || !data) return;
    if (data.t == "pickup") { pickup = data; pickup.t = Date.now(); pickup_done = false; manifest = {}; if (data.buy) say("Einkauf angefordert: " + data.buy.name + (data.buy.level ? "+" + data.buy.level : "") + (data.buy.mode == "trip" ? " auf " + data.buy.server : " bei " + data.buy.seller)); say("Abholung angefordert (" + (data.reason || "") + ", " + (data.items || 0) + " Items" + (data.pots && (data.pots.hp || data.pots.mp) ? ", Tränke " + data.pots.hp + "/" + data.pots.mp : "") + ")"); }
    else if (data.t == "pickup_cancel") { pickup = null; }
    else if (data.t == "goldback") { goldback_req = Date.now(); }
    else if (data.t == "tidy") { tidy_req = Date.now(); say("Aufräumen angefordert"); }
    else if (data.t == "banksort") { banksort_req = Date.now(); say("Bank sortieren angefordert"); }
    else if (data.t == "unlist") { unlist_req.push({ slot: data.slot, name: data.name, t: Date.now() }); }
    else if (data.t == "kiss") { if (data.map == character.map || data.map == "main") { kiss_req = data; say("Kuss-Runde " + data.round + ": " + data.name + " (" + data.map + ")"); } else say("Kuss-Runde " + data.round + " auf " + data.map + " – zu weit, lasse aus"); }
    else if (data.t == "donate" && data.gold > 0) { donate_req = { gold: data.gold, target: data.target || 40 }; say("Spende angefordert: " + data.gold + " Gold bei Ron" + (data.target ? " (bis Lv " + data.target + ")" : "")); }
    else if (data.t == "item") { manifest[item_key(data.name, data.level)] = data.action || "bank"; if (data.action == "hold") { hold_items[item_key(data.name, data.level)] = true; hold_save(); } }
    else if (data.t == "done") { pickup_done = true; }
    else if (data.t == "me") { mage = data; mage.t = Date.now(); if (typeof data.paused == "boolean") m_paused = data.paused; if (data.mg && data.mg.target > 0) { GOLD_KEEP = data.mg.target; GOLD_HANDBACK = data.mg.target + 200000; GOLD_AUTO_BACK = data.mg.target + 500000; GOLD_MIN = data.mg.min || GOLD_MIN; } }
    else if (data.t == "buy" && data.buy) { direct_buy = data.buy; say("Einkauf aus eigener Kasse: " + data.buy.name + (data.buy.level ? "+" + data.buy.level : "") + " bei " + data.buy.seller); }
    else if (data.t == "state") { m_paused = !!data.paused; }
    else if (data.t == "nogold") { if (!data.near) say_once("nogold", "Gold: Magier nicht in Reichweite"); else { last_gold_ask = Date.now() + 20 * 60000; say_once("nogold2", "Kasse: Magier hat nicht genug – nächster Versuch in 30 min", 600000); } }
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
    if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 120000) { last_gold_ask = Date.now(); var g1 = character.gold; try { send_cm(MAGE, { t: "gold?", amount: Math.max(0, GOLD_KEEP - character.gold), kind: "refill" }); } catch (e) {} await sleep(1500); say(character.gold > g1 ? "Kasse aufgefüllt: +" + (character.gold - g1) + " → " + character.gold : "Kasse: Magier konnte nicht auffüllen (habe " + character.gold + ", Ziel " + GOLD_KEEP + ")"); }
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
        var gave_items = 0; for (var gi = character.items.length - 1; gi >= 0; gi--) { var git = character.items[gi]; if (git && (git.name == "anniversarygift" || /^slice_/.test(git.name)) && !hold_items[item_key(git.name, git.level)]) { /* Event-Items zurück an den Magier – außer Verkaufsware für ein Kaufgesuch */ try { send_item(MAGE, gi, git.q || 1); gave_items += git.q || 1; await sleep(300); } catch (e) {} } }
        // Gekaufte Items für den Magier: alle, die noch bei mir liegen, bei jeder Abholung übergeben (nicht nur auf ausdrückliche Anforderung) – Verkaufsware (sellreq) bleibt
        var fetch_keys = {}; (req.fetch || []).forEach(function (fe) { fetch_keys[item_key(fe.name, fe.level)] = true; });
        var sellkey = req.sellreq ? item_key(req.sellreq.name, req.sellreq.level) : null;
        for (var hk in hold_items) { if (hk != sellkey) fetch_keys[hk] = true; }
        var fk = Object.keys(fetch_keys), gave_buy = 0;
        if (fk.length) {
            for (var fi = 0; fi < fk.length; fi++) { var hp2 = fk[fi].split("+"), fname = hp2[0], flv = parseInt(hp2[1] || "0", 10) || 0; for (var fj = character.items.length - 1; fj >= 0; fj--) { var fit = character.items[fj]; if (fit && fit.name == fname && (fit.level || 0) == flv) { try { send_item(MAGE, fj, fit.q || 1); gave_items += fit.q || 1; gave_buy += fit.q || 1; await sleep(350); } catch (e) {} } } delete hold_items[fk[fi]]; }
            hold_save(); if (gave_buy) say("Einkauf übergeben: " + gave_buy + " Item(s)"); else if (req.fetch && req.fetch.length) say("Einkauf: nichts zum Übergeben im Inventar");
        }
        var gave_gold = 0; if (req.buy) { say("Einkaufsgold erhalten – behalte es für den Kauf (" + character.gold + " Gold)"); }
        else if (character.gold > (req.fetch ? GOLD_KEEP + 1000 : GOLD_HANDBACK)) { gave_gold = character.gold - GOLD_KEEP; try { send_gold(MAGE, gave_gold); } catch (e) { gave_gold = 0; } }
        try { send_cm(MAGE, { t: "delivered", pots: gave_pots, gold: gave_gold, items: gave_items || 0 }); } catch (e) {}
        say("Übernommen: " + Object.keys(manifest).length + " Posten" + (gave_pots ? ", " + gave_pots + " Tränke übergeben" : "") + (gave_gold ? ", " + gave_gold + " Gold übergeben" : ""));
    } catch (e) { say("Abholung: " + (e && e.message ? e.message : e)); }
    await process_inventory();
    if (req.sellreq && req.sellreq.mode == "here") await do_market_sell(req.sellreq);
    else if (req.sellreq) say("Verkaufsware an Bord – warte auf die Reise nach " + req.sellreq.server);
    else if (req.buy && req.buy.mode == "here") await do_market_buy(req.buy);
    else if (req.buy && req.buy.mode == "trip") say("Reisegold an Bord – warte auf die Reise nach " + req.buy.server);
}
async function do_market_buy(b) { // Einkauf auf diesem Server: hin, kaufen, zum Magier bringen
    var ok = false, why = "", spent = 0, got = 0;
    try {
        status("Einkauf");
        if (!(await go({ map: b.map, x: b.x, y: b.y + 30 }, 150))) throw "Verkäufer nicht erreichbar";
        var seller = null; try { seller = get_player(b.seller); } catch (e) {}
        if (!seller || !seller.slots) throw "Händler " + b.seller + " nicht (mehr) hier";
        var it = seller.slots[b.tslot], slot = b.tslot;
        if (!it || it.name != b.name || (it.level || 0) != (b.level || 0) || it.price > b.price * 1.05) { it = null; for (var sl in seller.slots) { var c = seller.slots[sl]; if (sl.indexOf("trade") == 0 && c && !c.b && c.name == b.name && (c.level || 0) == (b.level || 0) && c.price <= b.price * 1.05) { it = c; slot = sl; break; } } }
        if (!it) throw "Angebot nicht mehr da oder teurer";
        var q = Math.max(1, Math.min(b.q || 1, it.q || 1, Math.floor(character.gold / it.price)));
        if (character.esize < 1) throw "Inventar voll";
        var n0 = count_item(b.name, b.level), g0 = character.gold;
        try { trade_buy(seller, slot, q); } catch (e) { try { parent.socket.emit("trade_buy", { slot: slot, id: seller.id, q: String(q), rid: it.rid }); } catch (e2) {} }
        await sleep(1500);
        got = count_item(b.name, b.level) - n0; spent = g0 - character.gold;
        if (got <= 0) arb_bad_note(b, character.gold < it.price ? "zu wenig Gold" : "keine Antwort");
        if (got <= 0) throw "Kauf nicht gelungen (" + (character.gold < it.price ? "zu wenig Gold" : "keine Antwort") + ")";
        ok = true; if (!b.for_merch) { hold_items[item_key(b.name, b.level)] = true; hold_save(); }
    } catch (e) { why = e && e.message ? e.message : String(e); }
    say(ok ? "Einkauf: " + b.name + (b.level ? "+" + b.level : "") + (got > 1 ? " ×" + got : "") + " gekauft für " + spent + " Gold" + (b.for_merch ? " (eigener Bedarf, bleibt bei mir)" : "") : "Einkauf fehlgeschlagen: " + why);
    try { send_cm(MAGE, { t: "bought", id: b.id, ok: ok, spent: spent, why: why, q: got }); } catch (e) {}
    if (b.for_merch) return; // Material für mich selbst (z. B. Spinnenseide): nicht zum Magier bringen
    await deliver_to_mage(b, ok);
}
function find_order(buyer, b) { // Kaufgesuch des Käufers für dieses Item finden
    var c0 = buyer.slots[b.tslot]; if (c0 && c0.b && c0.name == b.name && (c0.level || 0) == (b.level || 0) && c0.price >= b.price * 0.95) return { it: c0, slot: b.tslot };
    for (var sl in buyer.slots) { var c = buyer.slots[sl]; if (sl.indexOf("trade") == 0 && c && c.b && c.name == b.name && (c.level || 0) == (b.level || 0) && c.price >= b.price * 0.95) return { it: c, slot: sl }; }
    return null;
}
async function do_market_sell(b) { // Item des Magiers an ein Kaufgesuch auf diesem Server verkaufen
    var ok = false, why = "", earned = 0, q = 0;
    try {
        status("Verkauf");
        if (!(await go({ map: b.map, x: b.x, y: b.y + 30 }, 150))) throw "Käufer nicht erreichbar";
        var buyer = null; try { buyer = get_player(b.seller); } catch (e) {}
        if (!buyer || !buyer.slots) throw "Käufer " + b.seller + " nicht (mehr) hier";
        var ord = find_order(buyer, b); if (!ord) throw "Kaufgesuch nicht mehr da oder niedriger";
        q = Math.max(1, Math.min(ord.it.q || 1, count_item(b.name, b.level))); if (!count_item(b.name, b.level)) throw "Item nicht im Inventar";
        var g0 = character.gold;
        try { await trade_sell(buyer, ord.slot, q); } catch (e) { try { parent.socket.emit("trade_sell", { slot: ord.slot, id: buyer.id, rid: ord.it.rid, q: q }); } catch (e2) {} }
        await sleep(1500); earned = character.gold - g0;
        if (earned <= 0) throw "Verkauf nicht bestätigt (Gold unverändert)";
        ok = true; delete hold_items[item_key(b.name, b.level)]; hold_save();
    } catch (e) { why = e && e.message ? e.message : String(e); }
    say(ok ? "Verkauf: " + q + "× " + b.name + (b.level ? "+" + b.level : "") + " für " + earned + " Gold an " + b.seller : "Verkauf fehlgeschlagen: " + why + " – Item bleibt bei mir");
    try { send_cm(MAGE, { t: "msold", id: b.id, ok: ok, earned: earned, q: q, why: why }); } catch (e) {}
}
async function deliver_to_mage(b, ok) { // Item und Restgold zum Magier bringen
    status("Lieferung");
    var t = mage_entity(), tgt = t && character.map == t.map ? { map: t.map, x: t.x, y: t.y } : (mage ? { map: mage.map, x: mage.x, y: mage.y } : null);
    if (!tgt) { say("Lieferung: Magier-Position unbekannt – Item bleibt bei mir bis zur nächsten Abholung"); return; }
    for (var i = 0; i < 4; i++) { await go(tgt, 120); t = mage_entity(); if (t && character.map == t.map && Math.hypot(character.x - t.x, character.y - t.y) < 250) break; if (mage) tgt = { map: mage.map, x: mage.x, y: mage.y }; }
    t = mage_entity();
    if (!t || character.map != t.map || Math.hypot(character.x - t.x, character.y - t.y) > 300) { say("Lieferung: Magier nicht erreicht – Item bleibt bei mir bis zur nächsten Abholung"); return; }
    var gave = 0; if (ok) { for (var j = character.items.length - 1; j >= 0; j--) { var it = character.items[j]; if (it && it.name == b.name && (it.level || 0) == (b.level || 0)) { try { send_item(MAGE, j, it.q || 1); gave += it.q || 1; await sleep(350); } catch (e) {} } } delete hold_items[item_key(b.name, b.level)]; hold_save(); }
    var gg = 0; if (character.gold > GOLD_KEEP + 1000) { gg = character.gold - GOLD_KEEP; try { send_gold(MAGE, gg); } catch (e) { gg = 0; } }
    try { send_cm(MAGE, { t: "delivered_item", id: b.id, name: b.name, level: b.level, q: gave, gold: gg, ok: ok }); } catch (e) {}
    say("Lieferung: " + (gave ? gave + "× " + b.name + " übergeben" : "kein Item") + (gg ? ", " + gg + " Gold zurück" : ""));
}
async function process_inventory() { // in der Stadt: verkaufen, an den Stand, in die Bank
    var sell = [], stand = [], bank = [];
    var silk = 0;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (!it || it.name == STAND_ITEM || /^(hpot|mpot)/.test(it.name)) continue;
        if (it.name == "rod" || it.name == "pickaxe" || it.name == "staff" || it.name == "blade" || it.name == "anniversarygift" || /^slice_/.test(it.name) || mbuild_protected(it.name) || order_for(it.name, it.level) || hold_items[item_key(it.name, it.level)]) continue; // Werkzeug, Zutaten, Event-Items, Auftrags-Items und Einkäufe für den Magier bleiben
        if (it.name == "spidersilk") { silk += it.q || 1; if (silk <= 2) continue; }
        var a = manifest[item_key(it.name, it.level)] || rule_action(it) || (/^(bronzenugget|coat1|helmet1|pants1|gloves1|shoes1)$/.test(it.name) ? "sell" : "bank"); if (a == "keep") continue; (a == "sell" ? sell : a == "stand" ? stand : bank).push(i); }
    if (!sell.length && !stand.length && !bank.length) { manifest = {}; return; }
    try {
        if (sell.length) { status("verkauft"); await smart_move("potions"); var g0 = character.gold; for (var s1 = sell.length - 1; s1 >= 0; s1--) { var it1 = character.items[sell[s1]]; if (!it1) continue; try { sell_item(sell[s1], it1.q || 1); } catch (e) {} await sleep(300); } say("Beim NPC verkauft: " + sell.length + " Items (+" + (character.gold - g0) + " Gold)"); }
        if (stand.length) { status("Stand bestücken"); await go(home_spot(), 40); if (!stand_open()) stand_on(); await sleep(800); var n = 0; for (var s2 = 0; s2 < stand.length; s2++) { var it2 = character.items[stand[s2]]; if (!it2) continue; var slot = free_trade_slot(); if (!slot) { manifest[item_key(it2.name, it2.level)] = "bank"; bank.push(stand[s2]); continue; } var price = rule_price(it2) || Math.round(npc_val(it2.name, it2.level) * STAND_MARKUP / 100) * 100; try { trade(stand[s2], slot, price, it2.q || 1); listed[slot] = { name: it2.name, level: it2.level || 0, t: Date.now(), price: price }; n++; await sleep(400); } catch (e) { say("Stand " + it2.name + ": " + (e && e.reason || e)); } } save_listed(); if (n) say("Am Stand eingestellt: " + n + " Items (Preis = NPC-Wert × " + STAND_MARKUP + ")"); }
        var bank2 = []; for (var b = 0; b < character.items.length; b++) { var itb = character.items[b]; if (!itb || itb.name == STAND_ITEM || /^(hpot|mpot)/.test(itb.name) || itb.name == "spidersilk" || itb.name == "pickaxe" || itb.name == "rod") continue; var ab = manifest[item_key(itb.name, itb.level)] || "bank"; if (ab == "keep") continue; if (ab == "bank" || (ab == "stand" && !is_listed_item(itb))) bank2.push(b); }
        if (bank2.length) { status("Bank"); stand_off(); var inb = await enter_bank(); var nb = 0, nf = 0, last_err = inb ? "" : "Bank nicht erreicht (Karte " + character.map + ")"; if (character.bank) for (var b2 = bank2.length - 1; b2 >= 0; b2--) { var e0 = character.esize; try { await bank_put(bank2[b2]); } catch (e) { last_err = String(e && e.reason || e); } await sleep(300); if (character.esize > e0) nb++; else nf++; } await sleep(600); bank_snap_write(); say("In die Bank gelegt: " + nb + " Items" + (nf ? ", " + nf + " nicht abgelegt (" + (last_err || "kein Fehler gemeldet") + ")" : "")); }
    } catch (e) { say("Verarbeitung: " + (e && e.message ? e.message : e)); }
    manifest = {};
}
function sell_item(i, q) { try { sell(i, q); } catch (e) { parent.socket.emit("sell", { num: i, quantity: q }); } }
function free_trade_slot() { for (var n = 1; n <= 16; n++) { var sl = "trade" + n; if (!(sl in character.slots)) continue; if (!character.slots[sl]) return sl; } if (trade_keys_local().length) return null; var lv = (stand_live && stand_live.slots) || {}; for (var n2 = 1; n2 <= 16; n2++) { var s2 = "trade" + n2; if (!lv[s2] && !listed[s2]) return s2; } return null; } // ohne sichtbare Slots: bekannte Belegung (Händlerliste + eigene Einträge) statt blind trade1
function is_listed_item(it) { for (var sl in character.slots) { if (sl.indexOf("trade") == 0 && character.slots[sl] && character.slots[sl].name == it.name && (character.slots[sl].level || 0) == (it.level || 0)) return true; } return false; }
var last_stand_check = 0;
async function check_stand_age() { // Ladenhüter nach 24 h vom Stand nehmen und beim NPC verkaufen
    if (Date.now() - last_stand_check < 10 * 60000) return; last_stand_check = Date.now();
    var old = [];
    for (var sl in character.slots) { if (sl.indexOf("trade") != 0 || !character.slots[sl]) continue; var rec = listed[sl]; if (!rec) { listed[sl] = { name: character.slots[sl].name, level: character.slots[sl].level || 0, t: Date.now() }; continue; } if (!rec.order && !precious(character.slots[sl]) && rule_of_it(character.slots[sl]) != "stand" && Date.now() - rec.t > STAND_MAX_AGE) old.push(sl); }
    for (var sl2 in listed) if (!character.slots[sl2]) { if (listed[sl2].price) say("Verkauft am Stand: " + listed[sl2].name + "+" + listed[sl2].level + " für " + listed[sl2].price); delete listed[sl2]; }
    save_listed();
    if (!old.length) return;
    say("Ladenhüter: " + old.length + " Items vom Stand zum NPC");
    try { for (var k = 0; k < old.length; k++) { try { unequip(old[k]); } catch (e) {} await sleep(400); manifest[item_key(listed[old[k]].name, listed[old[k]].level)] = "sell"; delete listed[old[k]]; } save_listed(); await process_inventory(); } catch (e) { say("Ladenhüter: " + (e && e.message || e)); }
}

// ---------- Stufe 3a: Angeln und Bergbau in den Wartezeiten (Werkzeuge beim Handwerker selbst bauen) ----------
var GATHER = true, FISH_SPOTS = [{ map: "main", x: -1368, y: -90 }], MINE_SPOTS = [{ map: "tunnel", x: -280, y: -10 }]; // nur die Plätze, die nachweislich gehen: (-1198,-288) ist kein Angelplatz, (-200,-50) liegt im Maulwurf-Feld (Händler ist dort gestorben)
var TOOL_RECIPES = { rod: ["staff", "spidersilk"], pickaxe: ["staff", "spidersilk", "blade"] };
var last_gather_try = {}, gather_fail = {}, gather_busy = false, last_tool_try = 0, last_silk_ask = 0;
var gather_stats = { mining: { n: 0, gold: 0, items: 0, last: 0 }, fishing: { n: 0, gold: 0, items: 0, last: 0 } }; try { var gs0 = JSON.parse(localStorage.getItem("lp_gather_" + character.name) || "null"); if (gs0) { for (var gk in gs0) gather_stats[gk] = gs0[gk]; } } catch (e) {}
function gather_save() { try { localStorage.setItem("lp_gather_" + character.name, JSON.stringify(gather_stats)); } catch (e) {} }
function gather_info() { // fürs Magier-Panel: Zähler, Werkzeuge, nächster Versuch
    var out = { tools: { pickaxe: have_item("pickaxe") != -1, rod: have_item("rod") != -1 }, stats: gather_stats, next: {} };
    ["mining", "fishing"].forEach(function (k) { var cd = false, rem = 0; try { cd = skill_cd(k); } catch (e) {} try { var ns = parent.next_skill && parent.next_skill[k]; if (ns) rem = new Date(ns).getTime() - Date.now(); } catch (e) {} var wait = Math.max(0, 10 * 60000 - (Date.now() - (last_gather_try[k] || 0))); var m = Math.max(rem, cd ? 60000 : 0, wait); out.next[k] = m > 0 ? (m >= 3600000 ? Math.floor(m / 3600000) + " h " + Math.ceil((m % 3600000) / 60000) + " min" : Math.ceil(m / 60000) + " min") : "bereit"; });
    return out;
}
function have_item(n) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == n) return i; } for (var sl in character.slots) { var w = character.slots[sl]; if (w && w.name == n && sl.indexOf("trade") != 0) return -2; } return -1; }
function skill_cd(name) { try { if (typeof is_on_cooldown == "function") return is_on_cooldown(name); } catch (e) {} try { var t = parent.next_skill && parent.next_skill[name]; return t && new Date(t).getTime() > Date.now(); } catch (e) {} return false; }
async function ensure_tool(tool) { // Werkzeug vorhanden? sonst Zutaten kaufen/anfordern und beim Handwerker bauen
    if (have_item(tool) != -1) return true;
    if (Date.now() - last_tool_try < 5 * 60000) return false; last_tool_try = Date.now();
    var need = TOOL_RECIPES[tool];
    for (var ui = 0; ui < need.length; ui++) { if (have_item(need[ui]) == -2) { try { unequip("mainhand"); await sleep(600); } catch (e) {} } } // Zutat angelegt (z. B. Stab in der Hand) → ablegen, der Handwerker braucht sie im Inventar
    if (have_item("spidersilk") == -1 && need.indexOf("spidersilk") >= 0) { try { await fetch_from_bank("spidersilk", 0, 1); } catch (e) {} } // Seide liegt evtl. in der Bank
    var missing = need.filter(function (n) { return have_item(n) == -1; });
    // kaufbare Zutaten (Stab, Klinge) beim NPC holen
    for (var i = 0; i < missing.length; i++) { var n = missing[i]; var npc = npc_selling(n); if (!npc) continue; var pr = (G.items[n] || {}).g || 0; if (character.gold < pr + 20000) { say_once("toolgold", "Werkzeug " + tool + ": zu wenig Gold für " + n, 1800000); return false; } var pos = npc_pos(npc); if (!pos) continue; await go({ map: pos.map, x: pos.x, y: pos.y + 20 }, 60); try { buy(n, 1); await sleep(600); } catch (e) {} }
    missing = need.filter(function (n) { return have_item(n) == -1; });
    if (missing.length) { if (missing.indexOf("spidersilk") >= 0 && Date.now() - last_silk_ask > 10 * 60000) { last_silk_ask = Date.now(); try { send_cm(MAGE, { t: "need", item: "spidersilk", q: 1 }); } catch (e) {} /* je Werkzeug eine Seide */ say_once("silk", "Für " + tool + " fehlt Spinnenseide – beim Magier angefragt", 1800000); } else say_once("toolmiss", "Werkzeug " + tool + ": fehlt " + missing.join(", "), 1800000); return false; }
    var cp = npc_pos("craftsman"); if (!cp) return false;
    await go({ map: cp.map, x: cp.x, y: cp.y + 20 }, 60);
    var cr = null, crtxt = "";
    try { if (typeof auto_craft == "function") cr = await auto_craft(tool); } catch (e) { cr = { failed: true, reason: e && e.reason || e && e.message || String(e) }; }
    if (cr && (cr.failed || cr.reason)) crtxt = String(cr.reason || "fehlgeschlagen");
    await sleep(1200);
    if (have_item(tool) == -1) { // Rückfall: Zutaten-Slots selbst angeben (G.craft-Reihenfolge, Rest leer)
        try { var slots = need.map(function (n) { return have_item(n); }); while (slots.length < 9) slots.push(null); parent.cr_items = slots; var cr2 = await parent.craft(); if (cr2 && (cr2.failed || cr2.reason)) crtxt += (crtxt ? " / " : "") + "manuell: " + String(cr2.reason || "fehlgeschlagen"); } catch (e2) { crtxt += (crtxt ? " / " : "") + "manuell: " + (e2 && e2.reason || e2 && e2.message || String(e2)); }
    }
    if (crtxt) say("Handwerker " + tool + ": " + crtxt + " (Zutaten-Slots: " + need.map(function (n) { return n + "=" + have_item(n); }).join(", ") + ")");
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
    if (ok) { var gs = gather_stats[kind]; gs.n++; gs.gold += Math.max(0, character.gold - g0); gs.items += Math.max(0, n1 - n0); gs.last = Date.now(); gather_save(); }
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
var order_listed = {}; try { order_listed = JSON.parse(localStorage.getItem("lp_order_listed_" + character.name) || "{}"); } catch (e) {} // Aufträge, die schon einmal am Stand lagen (Item danach weg = verkauft)
function order_listed_save() { try { localStorage.setItem("lp_order_listed_" + character.name, JSON.stringify(order_listed)); } catch (e) {} }
function order_sold(key, o, name, lvl, price) { try { send_cm(MAGE, { t: "sold", name: name, price: price }); } catch (e) {} say("VERKAUFT am Stand: " + name + (lvl ? "+" + lvl : "") + " für " + price + " Gold"); if (o && o.q > 1) { o.q -= 1; } else delete stand_orders[key]; delete order_listed[key]; order_listed_save(); try { localStorage.setItem("lp_stand_orders_" + character.name, JSON.stringify(stand_orders)); } catch (e) {} }
function load_orders() { try { stand_orders = JSON.parse(localStorage.getItem("lp_stand_orders_" + character.name) || "{}"); } catch (e) { stand_orders = {}; } }
function precious(it) { return !!it && (/^(scroll[2-9]|cscroll[2-9])$/.test(it.name) || npc_val(it.name, it.level) >= 1000000); } // wird nie automatisch zum NPC gebracht oder umgeräumt
function order_name(key, o) { return (o && o.name) || String(key).split("+")[0]; }
function order_level(key, o) { if (o && o.level != null) return o.level; var m = String(key).match(/\+(\d+)$/); return m ? parseInt(m[1]) : 0; }
function order_for(name, level) { for (var k in stand_orders) { var o = stand_orders[k]; if (o && order_name(k, o) == name && order_level(k, o) == (level || 0)) return o; } return null; }
// Stand-Slots: im Nebenfenster fehlen die trade-Schlüssel in character.slots oft – dann den eigenen Stand über die Händlerliste des Servers lesen (was alle Spieler sehen)
var stand_live = { t: 0, slots: null, found: false };
function trade_keys_local() { return Object.keys(character.slots || {}).filter(function (k) { return k.indexOf("trade") == 0; }); }
async function stand_slots(force) {
    var ks = trade_keys_local(); if (ks.length) { var o = {}; ks.forEach(function (k) { o[k] = character.slots[k] || null; }); stand_live = { t: Date.now(), slots: o, found: true }; return o; }
    if (!force && Date.now() - stand_live.t < 45000 && stand_live.slots) return stand_live.slots;
    try {
        var r = await fetch("https://adventure.land/api/pull_merchants", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json; charset=utf-8" }, body: "{}" });
        var res = await r.json(), chars = [];
        (function walk(x, d) { if (!x || d > 5) return; if (Array.isArray(x)) { x.forEach(function (y) { walk(y, d + 1); }); return; } if (typeof x != "object") return; if (x.name && x.slots) { chars.push(x); return; } for (var k in x) walk(x[k], d + 1); })(res, 0);
        var me = null; chars.forEach(function (c) { if (c.name == character.name) me = c; });
        var o2 = {}; if (me) for (var k2 in me.slots) if (k2.indexOf("trade") == 0 && me.slots[k2]) o2[k2] = me.slots[k2];
        stand_live = { t: Date.now(), slots: o2, found: !!me }; return o2;
    } catch (e) { return stand_live.slots || {}; }
}
function slot_of_in(slots, name, level) { for (var sl in slots) { var w = slots[sl]; if (w && w.name == name && (level == null || (w.level || 0) == level)) return sl; } return null; }
function free_slot_in(slots) { for (var n = 1; n <= 16; n++) { var sl = "trade" + n; if (trade_keys_local().length && !(sl in character.slots)) continue; if (!slots[sl] && !listed[sl]) return sl; } return null; }
var order_miss_t = {};
function listed_slot_of(name, level) { for (var sl in character.slots) { var w = character.slots[sl]; if (sl.indexOf("trade") == 0 && w && w.name == name && (level == null || (w.level || 0) == level)) return sl; } return null; }
function have_item_lv(name, level) { for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (level == null || (it.level || 0) == level)) return i; } return -1; }
// Bankstand teilen: Bank ist kontoweit – der Händler schreibt beim Bankbesuch denselben Schnappschuss, den der Magier fürs Bank-Fenster nutzt, und liest ihn vor einem Bankgang
function bank_snap_write() { try { if (!character.bank || typeof character.bank != "object") return; var snap = {}; for (var pk in character.bank) if (pk.indexOf("items") == 0 && Array.isArray(character.bank[pk])) snap[pk] = character.bank[pk].map(function (b) { return b ? { name: b.name, level: b.level, q: b.q } : null; }); localStorage.setItem("lp_bank_cache_" + MAGE, JSON.stringify(snap)); localStorage.setItem("lp_bank_cache_t_" + MAGE, String(Date.now())); } catch (e) {} }
function bank_snap_has(name, level) { // true/false laut Schnappschuss, null = kein Schnappschuss
    try { var raw = localStorage.getItem("lp_bank_cache_" + MAGE); if (!raw) return null; var snap = JSON.parse(raw); for (var pk in snap) { var arr = snap[pk]; if (!Array.isArray(arr)) continue; for (var i = 0; i < arr.length; i++) { var it = arr[i]; if (it && it.name == name && (level == null || (it.level || 0) == (level || 0))) return true; } } return false; } catch (e) { return null; }
}
function bank_snap_sig() { try { return (localStorage.getItem("lp_bank_cache_t_" + MAGE) || "") + ":" + (localStorage.getItem("lp_bank_cache_" + MAGE) || "").length; } catch (e) { return ""; } }
var order_miss_sig = {};
async function fetch_from_bank(name, level, q) { // Item aus der Bank holen (Bank ist kontoweit); Stapel: nur die gewünschte Menge
    stand_off(); status("Bank"); await smart_move("bank"); for (var w = 0; w < 25 && !character.bank; w++) await sleep(200);
    bank_snap_write();
    var bank = character.bank || {}; for (var pack in bank) { if (pack.indexOf("items") != 0 || !Array.isArray(bank[pack])) continue; for (var i = 0; i < bank[pack].length; i++) { var it = bank[pack][i]; if (it && it.name == name && (level == null || (it.level || 0) == (level || 0))) { try { bank_retrieve(pack, i); await sleep(800); } catch (e) {} var ix = have_item_lv(name, level); if (ix >= 0) { var have = character.items[ix].q || 1; if (q && have > q && G.items[name] && G.items[name].s) { try { bank_store(ix, pack, i); await sleep(600); } catch (e) {} /* Rest zurück: Stapel teilen geht nur über split – Vereinfachung: ganzer Stapel */ } say(name + (level ? "+" + level : "") + " aus der Bank geholt"); return true; } } } }
    say(name + (level ? "+" + level : "") + " nicht in der Bank gefunden"); return false;
}
var slots_logged = false;
function log_trade_slots() { if (slots_logged) return; slots_logged = true; try { var ks = Object.keys(character.slots || {}).filter(function (k) { return k.indexOf("trade") == 0; }); var filled = ks.filter(function (k) { return character.slots[k]; }).map(function (k) { return k + ":" + character.slots[k].name + "@" + character.slots[k].price; }); say("Stand-Slots im Nebenfenster: " + ks.length + " Schlüssel, belegt: " + (filled.join(", ") || "keine")); } catch (e) { say("Stand-Slots: " + e); } }
var last_npc_orders = 0;
async function npc_orders_tick() { // Aufträge aus dem Bank-Fenster: Item aus der Bank holen und beim NPC verkaufen (Gold in meine Kasse)
    if (Date.now() - last_npc_orders < 60000 || pickup || arb_idle || gather_busy) return false; last_npc_orders = Date.now();
    var orders = {}; try { orders = JSON.parse(localStorage.getItem("lp_npc_orders_" + character.name) || "{}"); } catch (e) { orders = {}; }
    var keys = Object.keys(orders); if (!keys.length) return false;
    var key = keys[0], o = orders[key]; if (!o || !o.name) { delete orders[key]; localStorage.setItem("lp_npc_orders_" + character.name, JSON.stringify(orders)); return false; }
    var q = Math.max(1, o.q || 1), got = false;
    try {
        var ix0 = have_item_lv(o.name, o.level || 0); if (ix0 < 0 || (character.items[ix0].q || 1) < q) got = await fetch_from_bank(o.name, o.level || 0, q); else got = true;
        var ix = have_item_lv(o.name, o.level || 0);
        if (ix < 0) { say("NPC-Verkauf " + o.name + ": nicht gefunden – Auftrag verworfen"); }
        else {
            status("verkauft"); await smart_move("potions"); var g0 = character.gold, qq = Math.min(q, character.items[ix].q || 1);
            try { sell_item(ix, qq); } catch (e) {} await sleep(800);
            var earned = character.gold - g0;
            say("NPC-Verkauf: " + qq + "× " + o.name + (o.level ? "+" + o.level : "") + " für " + earned + " Gold (Kasse " + character.gold + ")");
            try { send_cm(MAGE, { t: "npcsold", key: key, name: o.name, level: o.level || 0, q: qq, gold: earned }); } catch (e) {}
        }
    } catch (e) { say("NPC-Verkauf " + o.name + ": " + (e && e.message || e)); }
    delete orders[key]; try { localStorage.setItem("lp_npc_orders_" + character.name, JSON.stringify(orders)); } catch (e) {}
    await process_inventory();
    return true;
}
async function orders_tick() {
    log_trade_slots();
    if (Date.now() - last_orders_check < 60000 || pickup || arb_idle || gather_busy) return false; last_orders_check = Date.now();
    load_orders(); var did = false;
    var n_orders = 0; for (var k0 in stand_orders) if (stand_orders[k0] && stand_orders[k0].price) n_orders++;
    if (n_orders && !stand_open() && !trade_keys_local().length) { await go(home_spot(), 40); stand_on(); await sleep(1500); } // Stand auf, damit die Slots lesbar sind
    var live = await stand_slots(true); stand_live_write(live);
    var did_unlist = false;
    while (unlist_req.length) { var ur = unlist_req.shift(); did_unlist = true; try { if (!stand_open()) { await go(home_spot(), 40); stand_on(); await sleep(800); } if (character.esize < 1) { say("Vom Stand nehmen: Inventar voll – " + ur.name + " bleibt liegen"); unlist_req = []; break; } unequip(ur.slot); await sleep(800); delete listed[ur.slot]; save_listed(); manifest[item_key(ur.name.split("+")[0], parseInt((ur.name.split("+")[1]) || 0))] = "bank"; say(ur.name + " vom Stand genommen (" + ur.slot + ") – kommt in die Bank"); } catch (e) { say("Vom Stand nehmen: " + e); } }
    if (did_unlist) { try { await process_inventory(); } catch (e) { say("Bank nach Abnehmen: " + (e && e.message || e)); } await go(home_spot(), 40); if (!stand_open()) stand_on(); await sleep(800); live = await stand_slots(true); stand_live_write(live); } // abgenommene Teile sofort in die Bank bringen, dann zurück an den Stand
    for (var key in stand_orders) {
        var o = stand_orders[key]; if (!o || !o.price) continue; var name = order_name(key, o), lvl = order_level(key, o);
        var sl = slot_of_in(live, name, lvl);
        if (sl) { // schon am Stand: Preis prüfen
            var cur = live[sl];
            if (Math.abs((cur.price || 0) - o.price) > 1000) { try { delete listed[sl]; unequip(sl); await sleep(800); var ix = have_item(name); if (ix < 0) { say("Neu bepreisen " + name + ": nach dem Abnehmen nicht im Inventar?! (Slot " + sl + ") – bitte im Spiel prüfen"); } else { trade(ix, sl, o.price, cur.q || 1); await sleep(800); var chk = character.slots[sl]; if (chk && chk.name == name) { listed[sl] = { name: name, level: 0, t: Date.now(), price: o.price, order: true, gold0: character.gold }; save_listed(); say(name + " am Stand neu bepreist: " + o.price + " (Slot " + sl + ")"); } else { say(name + " wieder ausstellen zu " + o.price + " nicht bestätigt – liegt im Inventar, nächster Versuch"); } } } catch (e) { say("Neu bepreisen " + name + ": " + (e && e.reason || e)); } }
            if (!order_listed[key]) { order_listed[key] = Date.now(); order_listed_save(); }
            order_state[key] = "am Stand für " + o.price; continue;
        }
        var ix2 = have_item_lv(name, lvl);
        if (ix2 < 0) { if (!free_slot_in(live)) { order_state[key] = "wartet (Stand voll)"; continue; }
            var snap = bank_snap_has(name, lvl), sig = bank_snap_sig();
            if (snap === false && order_listed[key] && stand_live.found) { order_sold(key, o, name, lvl, o.price); continue; } // lag am Stand, ist weg und nicht in der Bank: verkauft
            if (snap === false) { order_state[key] = "nicht in Bank"; continue; } // Bankstand ist aktuell (schreibt jeder Bankbesuch) – nicht hinlaufen, um es erneut festzustellen // laut Bankstand nicht da: nur nachsehen, wenn sich der Bankstand geändert hat (oder alle 30 min)
            else if (snap === null && Date.now() - (order_miss_t[key] || 0) < 30 * 60000 && order_state[key] == "nicht in Bank") continue;
            if (!await fetch_from_bank(name, lvl, o.q)) { if (order_listed[key]) { order_sold(key, o, name, lvl, o.price); continue; } order_state[key] = "nicht in Bank"; order_miss_t[key] = Date.now(); order_miss_sig[key] = bank_snap_sig(); continue; } ix2 = have_item_lv(name, lvl); did = true; }
        if (ix2 < 0) continue;
        await go(home_spot(), 40); if (!stand_open()) stand_on(); await sleep(800);
        live = await stand_slots(true);
        var slot = free_slot_in(live); if (!slot) { order_state[key] = "wartet (Stand voll)"; say_once("standfull", "Kein freier Stand-Platz (" + Object.keys(live).length + " belegt) – weitere Aufträge warten", 600000); continue; }
        var tq = Math.min(character.items[ix2].q || 1, o.q || (character.items[ix2].q || 1));
        try { trade(ix2, slot, o.price, tq); await sleep(1200); if (have_item_lv(name, lvl) == ix2 && character.items[ix2] && character.items[ix2].name == name && !(character.slots && character.slots[slot] && character.slots[slot].name == name)) { var lv2 = await stand_slots(true); if (!lv2[slot] || lv2[slot].name != name) { order_state[key] = "wartet (Stand voll)"; say_once("standfull", "Stand-Platz " + slot + " nicht verfügbar (Stand voll?) – " + name + " bleibt im Inventar, weitere Aufträge warten", 600000); continue; } } listed[slot] = { name: name, level: lvl, t: Date.now(), price: o.price, q: tq, order: true, key: key, gold0: character.gold }; save_listed(); order_listed[key] = Date.now(); order_listed_save(); live[slot] = { name: name, level: lvl, price: o.price, q: tq }; say(name + (lvl ? "+" + lvl : "") + (tq > 1 ? " ×" + tq : "") + " am Stand ausgestellt für " + o.price); order_state[key] = "am Stand für " + o.price; did = true; } catch (e) { say("Ausstellen " + name + ": " + (e && e.reason || e)); }
    }
    // Auftrag entfernt, Item noch am Stand -> abnehmen (kommt beim nächsten Aufräumen in die Bank)
    for (var sl4 in listed) { var r4 = listed[sl4]; if (!r4 || !r4.order || !(live[sl4] || (character.slots && character.slots[sl4]))) continue; var k4 = r4.key || r4.name; if (!stand_orders[k4] && !order_for(r4.name, r4.level || 0)) { try { unequip(sl4); await sleep(600); } catch (e) {} delete listed[sl4]; save_listed(); manifest[item_key(r4.name, r4.level)] = "bank"; say(r4.name + " vom Stand genommen (Auftrag gelöscht) – kommt in die Bank"); did = true; } }
    // verkauft? (Eintrag weg, Auftrag noch da)
    var live2 = await stand_slots(true); stand_live_write(live2); if (!stand_live.found && !trade_keys_local().length) return did; // Stand nicht sichtbar (zu / nicht in der Liste): nichts als verkauft werten
    for (var sl3 in listed) { var rec = listed[sl3]; if (!rec || !rec.order || live2[sl3]) continue;
        var back = have_item_lv(rec.name, rec.level || 0) >= 0; // Item wieder im Inventar (abgenommen/überschrieben) → nicht verkauft
        var sold = !back && ((rec.gold0 != null && character.gold >= rec.gold0 + rec.price * 0.9) || (Date.now() - (rec.t || 0) > 60000)); // weg vom Stand und nicht im Inventar = verkauft (Gold-Vergleich taugt nicht, die Kasse schwankt durch Tränke/Spenden)
        delete listed[sl3]; save_listed();
        if (sold) { try { send_cm(MAGE, { t: "sold", name: rec.name, price: rec.price }); } catch (e) {} say("VERKAUFT am Stand: " + rec.name + " für " + rec.price + " Gold (Kasse jetzt " + character.gold + ")"); var ko = rec.key || rec.name, oo = stand_orders[ko]; if (oo && oo.q > (rec.q || 1)) { oo.q -= (rec.q || 1); } else delete stand_orders[ko]; try { localStorage.setItem("lp_stand_orders_" + character.name, JSON.stringify(stand_orders)); } catch (e) {} }
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
            if (o.sell) { // Kaufgesuch bedienen (Item vom Magier an Bord)
                if (!count_item(o.name, o.level)) { arb_res.skipped++; arb_log(o.name + ": nicht im Inventar"); continue; }
                if (o.map && o.x != null) { var oks = await go({ map: o.map, x: o.x, y: o.y + 30 }, 120); if (!oks) { arb_res.skipped++; arb_log(o.seller + " nicht erreichbar"); continue; } }
                var buyer = null; try { buyer = get_player(o.seller); } catch (e) {}
                if (!buyer || !buyer.slots) { arb_res.skipped++; arb_log("Käufer " + o.seller + " nicht (mehr) hier"); continue; }
                var ord = find_order(buyer, o); if (!ord) { arb_res.skipped++; arb_log(o.name + ": Kaufgesuch nicht mehr da oder niedriger"); continue; }
                var qs = Math.max(1, Math.min(ord.it.q || 1, count_item(o.name, o.level))), gs = character.gold;
                try { await trade_sell(buyer, ord.slot, qs); } catch (e) { try { parent.socket.emit("trade_sell", { slot: ord.slot, id: buyer.id, rid: ord.it.rid, q: qs }); } catch (e2) {} }
                await sleep(1500);
                if (character.gold > gs) { arb_res.sold += qs; arb_res.earned += character.gold - gs; delete hold_items[item_key(o.name, o.level)]; hold_save(); arb_log("verkauft " + qs + "× " + o.name + " für " + (character.gold - gs)); } else { arb_res.skipped++; arb_log("Verkauf " + o.name + " nicht bestätigt"); }
                arb_save(); continue;
            }
            if (character.esize < 2) { arb_log("Inventar voll"); break; }
            if (character.gold < o.price) { arb_res.skipped++; arb_log(o.name + "+" + o.level + ": zu wenig Gold (" + o.price + ")"); continue; }
            if (o.map && o.x != null) { var ok = await go({ map: o.map, x: o.x, y: o.y + 30 }, 120); if (!ok) { arb_res.skipped++; arb_log(o.seller + " nicht erreichbar"); continue; } }
            var seller = null; try { seller = get_player(o.seller); } catch (e) {}
            if (!seller || !seller.slots) { arb_res.skipped++; arb_log("Händler " + o.seller + " nicht (mehr) hier"); continue; }
            var it = seller.slots[o.tslot];
            if (!it || it.name != o.name || (it.level || 0) != (o.level || 0) || it.price > o.price * 1.02) { arb_res.skipped++; arb_log(o.name + "+" + o.level + " bei " + o.seller + " nicht mehr da/teurer"); continue; }
            var n0 = count_item(o.name, o.level), g0 = character.gold;
            var qb = job.keep ? Math.max(1, Math.min(o.q || 1, it.q || 1, Math.floor(character.gold / it.price))) : 1;
            try { trade_buy(seller, o.tslot, qb); } catch (e) { try { parent.socket.emit("trade_buy", { slot: o.tslot, id: seller.id, q: String(qb), rid: it.rid }); } catch (e2) {} }
            await sleep(1200);
            if (count_item(o.name, o.level) <= n0) arb_bad_note(o, character.gold < it.price ? "zu wenig Gold" : "keine Antwort");
            if (count_item(o.name, o.level) > n0) { if (job.keep && !o.for_merch) { hold_items[item_key(o.name, o.level)] = true; hold_save(); } arb_res.bought++; arb_res.spent += g0 - character.gold; bought[item_key(o.name, o.level)] = (bought[item_key(o.name, o.level)] || 0) + 1; arb_log("gekauft " + o.name + "+" + o.level + " für " + (g0 - character.gold)); }
            else { arb_res.skipped++; arb_log("Kauf " + o.name + "+" + o.level + " nicht gelungen"); }
            arb_save();
        }
        if (arb_res.bought && job.keep) arb_log("behalte " + arb_res.bought + " Item(s) für den Magier");
        else if (arb_res.bought) { // beim NPC verkaufen
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

// ---------- Bauauftrag des Magiers (lp_mbuild_<Magier>): NPC-Teil kaufen, hochziehen/compounden (Massproduction), fertige Teile in die Bank ----------
function mbuild_load() { try { return JSON.parse(localStorage.getItem("lp_mbuild_" + MAGE) || "null"); } catch (e) { return null; } }
function mbuild_save(o) { try { var cur = mbuild_load(); if (cur && cur.name == o.name && cur.level == o.level) { cur.done = o.done; cur.destroyed = o.destroyed; cur.spent = o.spent; cur.step = o.step; if (o.running === false) cur.running = false; o = cur; } localStorage.setItem("lp_mbuild_" + MAGE, JSON.stringify(o)); } catch (e) {} }
function mbuild_protected(name) { var o = mbuild_load(); return !!o && o.name == name; }
function mbuild_running() { var o = mbuild_load(); return !!o && !!o.running && o.done < o.n; }
function item_grade(name, level) { var g = (G.items[name] || {}).grades || [], n = 0; for (var i = 0; i < g.length; i++) if (level >= g[i]) n++; return n; }
function inv_idx(name, level) { var out = []; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == name && (it.level || 0) == level) out.push(i); } return out; }
async function mbuild_wait(key) { await sleep(1200); for (var i = 0; i < 80 && character.q && character.q[key]; i++) await sleep(500); }
async function mbuild_buy(name, n) { var npc = npc_selling(name); if (!npc) return false; var pos = npc_pos(npc); if (!pos) return false; await go(pos, 60); var c0 = 0; character.items.forEach(function (x) { if (x && x.name == name) c0++; }); try { await buy(name, n); } catch (e) { try { parent.socket.emit("buy", { name: name, quantity: n }); } catch (e2) {} } await sleep(900); var c1 = 0; character.items.forEach(function (x) { if (x && x.name == name) c1++; }); return c1 > c0; }
async function mbuild_scroll(scroll) { if (locate_item(scroll) >= 0) return true; try { await buy(scroll, 1); } catch (e) { try { parent.socket.emit("buy", { name: scroll, quantity: 1 }); } catch (e2) {} } await sleep(700); if (locate_item(scroll) >= 0) return true; var npc = npc_selling(scroll), pos = npc && npc_pos(npc); if (pos) { await go(pos, 60); try { await buy(scroll, 1); } catch (e) {} await sleep(700); } return locate_item(scroll) >= 0; }
async function mbuild_gold(want) { // zum Magier und Gold holen (er gibt, was über seiner Reserve frei ist)
    if (Date.now() - last_gold_ask < 90000) return false; last_gold_ask = Date.now();
    var t = mage_entity() || (mage && Date.now() - mage.t < 60000 ? { map: mage.map, x: mage.x, y: mage.y } : null); if (!t) { say("Bauauftrag: Kasse zu klein und Magier nicht erreichbar"); return false; }
    status("Gold fürs Bauen"); await go({ map: t.map, x: t.x, y: t.y }, 150); var g1 = character.gold;
    try { send_cm(MAGE, { t: "gold?", amount: want }); } catch (e) {} await sleep(2500);
    say(character.gold > g1 ? "Bauauftrag: Kasse aufgefüllt +" + (character.gold - g1) + " → " + character.gold : "Bauauftrag: Magier konnte nicht auffüllen (will " + want + ")");
    return character.gold > g1;
}
async function mbuild_bank(o) { // fertige Teile (Zielstufe) in die Bank
    var idx = inv_idx(o.name, o.level); if (!idx.length) return;
    try { await smart_move("bank"); } catch (e) { return; } await sleep(800);
    idx = inv_idx(o.name, o.level); for (var i = idx.length - 1; i >= 0; i--) { try { await bank_put(idx[i]); await sleep(300); } catch (e) {} }
    await sleep(600); bank_snap_write();
    say("Bauauftrag: " + idx.length + "× " + o.name + " +" + o.level + " in die Bank gelegt");
}
var mbuild_active = false, mbuild_pos_ok = false;
async function mbuild_tick() {
    var o = mbuild_load();
    if (!o || !o.running || o.done >= o.n) { if (mbuild_active) { mbuild_active = false; mbuild_pos_ok = false; if (o && inv_idx(o.name, o.level).length) await mbuild_bank(o); } return false; }
    var def = G.items[o.name]; if (!def || !npc_selling(o.name)) { o.running = false; o.step = "nicht kaufbar"; mbuild_save(o); return false; }
    if (!mbuild_active) { mbuild_active = true; say("Bauauftrag: " + o.name + " +" + o.level + " × " + o.n + " (" + o.done + " fertig) – ich baue"); }
    if (stand_open()) stand_off();
    status("baut " + o.name + " +" + o.level);
    var reserve = Math.max(o.reserve || 0, GOLD_MIN), comp = !!def.compound, g0 = character.gold, r = "again";
    try {
        if (character.esize < 4) { if (inv_idx(o.name, o.level).length) { await mbuild_bank(o); return true; } o.running = false; o.step = "Inventar voll"; mbuild_save(o); say("Bauauftrag: Inventar voll – gestoppt"); return true; }
        r = comp ? await mbuild_compound(o, reserve) : await mbuild_upgrade(o, reserve);
        o.spent = (o.spent || 0) + Math.max(0, g0 - character.gold);
        if (r == "done") { o.done++; say("Bauauftrag: " + o.name + " +" + o.level + " fertig (" + o.done + "/" + o.n + ", " + o.destroyed + " zerstört, " + Math.round(o.spent / 1000) + "k Gold)"); if (o.done >= o.n || inv_idx(o.name, o.level).length >= 3) { await mbuild_bank(o); mbuild_pos_ok = false; } }
        if (r == "gold") { o.step = "warte auf Gold (Kasse " + Math.round(character.gold / 1000) + "k, Reserve " + Math.round(reserve / 1000) + "k)"; mbuild_save(o); await mbuild_gold(Math.max(GOLD_KEEP, reserve + def.g * 5 + 200000) - character.gold); mbuild_pos_ok = false; }
        if (r == "stop") { o.running = false; say("Bauauftrag: gestoppt (" + (o.step || "Fehler") + ")"); }
        if (o.done >= o.n) { o.running = false; o.step = "fertig"; say("Bauauftrag fertig: " + o.n + "× " + o.name + " +" + o.level + " in der Bank · " + o.destroyed + " zerstört · " + Math.round(o.spent / 1000) + "k Gold"); }
    } catch (e) { say("Bauauftrag-Fehler: " + (e && e.message ? e.message : e)); }
    mbuild_save(o); return true;
}
async function mbuild_place(kind) { if (mbuild_pos_ok) return; try { await smart_move(kind); mbuild_pos_ok = true; } catch (e) { await sleep(1000); } }
async function mbuild_upgrade(o, reserve) {
    var def = G.items[o.name], lv = -1;
    for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && it.name == o.name && (it.level || 0) < o.level && (it.level || 0) > lv) lv = it.level || 0; }
    if (lv < 0) { if (character.gold - reserve < def.g) return "gold"; o.step = "kaufe " + o.name; mbuild_save(o); if (!await mbuild_buy(o.name, 1)) { o.step = "Kauf " + o.name + " fehlgeschlagen"; return "stop"; } mbuild_pos_ok = false; lv = 0; }
    await mbuild_place("upgrade");
    while (lv < o.level) {
        if (!mbuild_running()) return "again";
        var ii = inv_idx(o.name, lv)[0]; if (ii == null) return "again";
        var scroll = "scroll" + item_grade(o.name, lv), sp = (G.items[scroll] || {}).g || 0;
        if (character.gold - reserve < sp) return "gold";
        if (!await mbuild_scroll(scroll)) { o.step = "keine " + scroll; return "stop"; }
        var si = locate_item(scroll); ii = inv_idx(o.name, lv)[0]; if (ii == null) return "again";
        o.step = "+" + lv + " → +" + (lv + 1); mbuild_save(o);
        try { if (character.level >= 60) use_skill("massproductionpp"); else if (character.level >= 30) use_skill("massproduction"); } catch (e) {} await sleep(300);
        var nS = inv_idx(o.name, lv).length, nN = inv_idx(o.name, lv + 1).length;
        try { await upgrade(ii, si); } catch (e) {}
        await mbuild_wait("upgrade");
        if (inv_idx(o.name, lv + 1).length > nN) lv++;
        else if (inv_idx(o.name, lv).length == nS) { /* fehlgeschlagen, Teil erhalten */ }
        else { o.destroyed++; say("Bauauftrag: " + o.name + " bei +" + lv + " zerstört (" + o.destroyed + ". Mal) – nächstes Teil"); return "again"; }
    }
    return "done";
}
async function mbuild_compound(o, reserve) {
    var def = G.items[o.name], t = o.level, n_t0 = inv_idx(o.name, t).length, l = -1;
    for (var k = t - 1; k >= 0; k--) if (inv_idx(o.name, k).length >= 3) { l = k; break; }
    if (l < 0) { var need = 3 - inv_idx(o.name, 0).length; if (character.gold - reserve < def.g * need) return "gold"; o.step = "kaufe " + need + "× " + o.name; mbuild_save(o); if (!await mbuild_buy(o.name, need)) { o.step = "Kauf fehlgeschlagen"; return "stop"; } mbuild_pos_ok = false; return "again"; }
    await mbuild_place("compound");
    var scroll = "cscroll" + item_grade(o.name, l), sp = (G.items[scroll] || {}).g || 0;
    if (character.gold - reserve < sp) return "gold";
    if (!await mbuild_scroll(scroll)) { o.step = "keine " + scroll; return "stop"; }
    var si = locate_item(scroll), idx = inv_idx(o.name, l), prev = inv_idx(o.name, l + 1).length;
    o.step = "+" + l + " ×3 → +" + (l + 1); mbuild_save(o);
    try { if (character.level >= 60) use_skill("massproductionpp"); else if (character.level >= 30) use_skill("massproduction"); } catch (e) {} await sleep(300);
    try { await compound(idx[0], idx[1], idx[2], si); } catch (e) {}
    await mbuild_wait("compound");
    if (inv_idx(o.name, l + 1).length > prev) say("Bauauftrag: " + o.name + " +" + (l + 1) + " erstellt"); else { o.destroyed++; say("Bauauftrag: Compound +" + l + " ×3 fehlgeschlagen (" + o.destroyed + ". Mal)"); }
    return inv_idx(o.name, t).length > n_t0 ? "done" : "again";
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
            // Pause des Magiers (P) betrifft nur dessen Farmen – der Händler arbeitet normal weiter (Stand, Aufträge, Aufräumen, Einkäufe, Reisen)
            if (locate_item(STAND_ITEM) < 0) { status("kein Stand"); await do_buy_stand(); if (locate_item(STAND_ITEM) < 0 && mage && character.gold < (G.items[STAND_ITEM].g || 0) && Date.now() - last_gold_ask > 120000) { await do_mluck(); } await sleep(5000); continue; }
            if (pickup) { await do_pickup(); continue; }
            if (tidy_req) { await do_tidy(); continue; }
            if (banksort_req) { await do_banksort(); continue; }
            if (donate_req) { await do_donate(donate_req); continue; }
            if (kiss_req) { await do_kiss(kiss_req); continue; }
            if (direct_buy) { var db = direct_buy; direct_buy = null; stand_off(); await do_market_buy(db); continue; }
            if (LEVEL_MODE && character.level < MLUCK_LEVEL) { // Level-Phase: Stand zu, beim Magier mitlaufen (Party-XP), bei Angriff zum Magier flüchten
                if (stand_open()) stand_off();
                say_once("levelmode", "Lv " + character.level + " – mluck erst ab Lv " + MLUCK_LEVEL + ", levle in der Party beim Magier mit", 1800000);
                if (character.hp < character.max_hp * 0.5) { var hp_i = -1; for (var i = 0; i < character.items.length; i++) { var it = character.items[i]; if (it && /^hpot/.test(it.name)) { hp_i = i; break; } } if (hp_i >= 0) { try { equip(hp_i); } catch (e) {} } else { try { use_skill("regen_hp"); } catch (e) {} } }
                var att = my_attacker(); var me = mage_entity();
                if (att && me && character.map == me.map) { try { move(me.x, me.y); } catch (e) {} status("flieht"); await sleep(500); continue; }
                status("levelt"); await follow_mage(); await sleep(1000); continue;
            }
            if (USE_MLUCK && character.level >= MLUCK_LEVEL && mluck_needed() && Date.now() - last_mluck_try > 5 * 60000 && !mage.paused) { status("mluck"); await do_mluck(); continue; }
            if (character.gold < GOLD_MIN && Date.now() - last_gold_ask > 10 * 60000 && mage && Date.now() - mage.t < 30000) { status("Gold holen"); await do_mluck(); continue; }
            if (goldback_req || (character.gold > GOLD_AUTO_BACK && Date.now() - last_goldback > 10 * 60000 && mage && Date.now() - mage.t < 30000)) { await do_goldback(); continue; }
            if (await npc_orders_tick()) continue;
            if (await orders_tick()) continue;
            if (await mbuild_tick()) continue;
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
