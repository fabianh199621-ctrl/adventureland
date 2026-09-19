// Adventure Land – LogicPlan Loader (im CODE-Editor speichern, "Run" drücken)
// Derselbe Loader für alle Charaktere: Magier lädt bot_vNN.js, Händler merchant_vNN.js, Priester priest_vNN.js.
// Der Magier startet Händler und Priester selbst (start_character) – dafür muss LP_CODE_SLOT der Slot sein, in dem DIESER Loader gespeichert ist.
var LP_CODE_SLOT = 1; // Nummer (oder Name) des Code-Slots mit diesem Loader
var BASE = "https://raw.githubusercontent.com/fabianh199621-ctrl/adventureland/main/";
var LP_ROLE = character.ctype == "merchant" || /merch/i.test(character.name) ? "merchant" : character.ctype == "priest" || /priest/i.test(character.name) ? "priest" : character.ctype == "ranger" || /ranger/i.test(character.name) ? "ranger" : /hunt/i.test(character.name) ? "hunter" : "bot";
try { parent.LP_CODE_SLOT = LP_CODE_SLOT; } catch (e) {}
fetch(BASE + "version.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw "HTTP " + r.status; return r.text(); })
    .then(function (v) {
        v = v.trim();
        game_log("Aktuelle Version: " + v + " (" + LP_ROLE + ")");
        return fetch(BASE + LP_ROLE + "_" + v + ".js", { cache: "no-store" }).then(function (r) { if (!r.ok) throw "HTTP " + r.status + " bei " + LP_ROLE + "_" + v + ".js"; return r.text(); });
    })
    .then(function (code) { try { eval(code); } catch (e) { game_log("Startfehler: " + e); } })
    .catch(function (e) { game_log("Code laden fehlgeschlagen: " + e); });
