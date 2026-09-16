// ===== Adventure Land – Vollautomatik Magier (nichts einstellen) =====
// P = Pause (stoppt auch Upgrades)
// U = sichere Upgrades: kaufbare Items +5, Drop-Items +3, INT-Scrolls, Schmuck +2
// K = alles bis +5, auch Drop-Items (Risiko!)
// Upgrades laufen NUR auf Tastendruck. GOLD_RESERVE wird nie angetastet.
// Wird per Loader aus GitHub geladen: https://github.com/fabianh199621-ctrl/adventureland

var BOT_VERSION = "v21";
game_log("LogicPlan-Skript " + BOT_VERSION + " gestartet – P = Pause, U = sichere Upgrades, K = alle Upgrades");

var GOLD_RESERVE = 20000;
var UPGRADE_TARGET = 5;
var SAFE_TARGET_DROP = 3;
var COMPOUND_TARGET = 2;
var STAT_TYPE = "int";
var FALLBACK_WEAPONS = ["staff", "stick"];
var NO_WEAPON_MONSTER = "goo";
var MAX_TARGET_HP_FACTOR = 5;
var FARM_TABLE = [
    { min: 45, mon: "scorpion" },
    { min: 38, mon: "squig" },
    { min: 30, mon: "armadillo" },
    { min: 18, mon: "croc" },
    { min: 10, mon: "bee" },
    { min: 5,  mon: "crab" },
    { min: 0,  mon: "goo" }
];
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
var CBURST_MIN_TARGETS = 2;
var CBURST_MP_PER_TARGET = 80;
var CBURST_MIN_MP = 0.5;

var busy = false, paused = false, upgrading = false;
var last_weapon_log = 0;
var blocked_spots = {};
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
}
// alten Handler (von vorherigem Run) entfernen, dann neu registrieren
if (parent.__logicplan_keyhandler) parent.document.removeEventListener("keydown", parent.__logicplan_keyhandler);
parent.__logicplan_keyhandler = on_key;
parent.document.addEventListener("keydown", on_key);

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

// ---------- Farmspot ----------
function pick_farm_monster() {
    if (!has_weapon()) return NO_WEAPON_MONSTER;
    for (var i = 0; i < FARM_TABLE.length; i++) {
        var f = FARM_TABLE[i];
        if (character.level >= f.min && !blocked_spots[f.mon]) return f.mon;
    }
    return "goo";
}

function go_to_farm_spot() {
    var mon = pick_farm_monster();
    busy = true; set_message("Laufe zu " + mon);
    smart_move(mon)
        .then(function () {
            if (!get_nearest_monster({ type: mon })) {
                blocked_spots[mon] = true;
                game_log("Spot " + mon + " erreicht, aber keine Monster – überspringe");
            }
        })
        .catch(function () {
            blocked_spots[mon] = true;
            game_log("Spot " + mon + " nicht erreichbar – nehme nächstniedrigeren");
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
function slots_to_compound() {
    return equipped_slots("compound").filter(function (s) { var it = character.slots[s]; return (it.level || 0) < COMPOUND_TARGET && is_buyable(it.name); });
}
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

// ---------- Compound (Schmuck) ----------
async function compound_slot(slot) {
    var it = character.slots[slot]; if (!it) return;
    var name = it.name, lvl = it.level || 0, target = COMPOUND_TARGET;
    var need_base = Math.pow(3, target) - Math.pow(3, lvl);
    var cost = need_base * G.items[name].g;
    if (spendable() < cost * 1.3) { game_log(name + " compound: zu wenig freies Gold (" + cost + ")"); return; }
    if (character.esize < need_base + 2) { game_log(name + " compound: Inventar zu voll (" + need_base + " Plätze nötig)"); return; }

    game_log(name + " +" + lvl + " -> +" + target + ": kaufe " + need_base + " Stück");
    if (!await buy_items(name, need_base)) return;
    unequip(slot); await sleep(600);

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
                if (find_inv_index(name, l + 1) >= 0) game_log(name + " +" + (l + 1) + " erstellt");
                else game_log(name + " compound fehlgeschlagen (+" + l + " x3 verloren)");
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
    if (character.rip) { respawn(); busy = false; return; }
    if (paused) return;

    check_weapon(); check_potions();
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
        if (!target) target = get_nearest_monster({ type: farm });
        if (!target) {
            for (var id in parent.entities) { var e = parent.entities[id]; if (is_valid_target(e) && e.target == character.name) { target = e; break; } }
        }
        if (target) change_target(target); else { go_to_farm_spot(); return; }
    }

    if (!is_in_range(target)) move(character.x + (target.x - character.x) / 2, character.y + (target.y - character.y) / 2);
    else if (can_attack(target)) {
        if (!try_cburst()) { set_message("Angriff " + target.type); attack(target); }
    }
}, 1000 / 4);
