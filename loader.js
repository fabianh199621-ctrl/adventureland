// Adventure Land – LogicPlan Loader (im CODE-Editor einfügen, "Run" drücken)
// Holt erst die aktuelle Versionsnummer, dann die Datei unter eigenem Namen (kein Cache-Problem)
var BASE = "https://raw.githubusercontent.com/fabianh199621-ctrl/adventureland/main/";
fetch(BASE + "version.txt?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw "HTTP " + r.status; return r.text(); })
    .then(function (v) {
        v = v.trim();
        game_log("Aktuelle Version: " + v);
        return fetch(BASE + "bot_" + v + ".js", { cache: "no-store" }).then(function (r) { if (!r.ok) throw "HTTP " + r.status + " bei bot_" + v + ".js"; return r.text(); });
    })
    .then(function (code) { try { eval(code); } catch (e) { game_log("Startfehler: " + e); } })
    .catch(function (e) { game_log("Code laden fehlgeschlagen: " + e); });
