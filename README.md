# Adventure Land – LogicPlan Team Bot

A fully automated 4-character team bot for [Adventure Land](https://adventure.land): a **mage** leads, a **priest** and a **ranger** follow and fight with it, and a **merchant** handles trading, supplies and the bank. Written for one specific team (see *Setup*), but the logic is generic.

The bot is written in plain JavaScript for the in-game CODE editor. The UI, logs and comments are in **German**.

## Files

| File | Runs on | What it does |
|---|---|---|
| `loader.js` | every character | Tiny loader you paste into the game. Reads `version.txt` and loads the matching script for the character's class. |
| `bot_vNNN.js` | mage | Team lead: farm logic, team coordination, events, market/bank windows, control panel. Starts the other three characters itself. |
| `priest_vNNN.js` | priest | Follows the mage, heals the team, focuses the mage's target. |
| `ranger_vNNN.js` | ranger | Follows the mage, shoots the mage's target (3shot/5shot/supershot). |
| `merchant_vNNN.js` | merchant | Trading, supplies, bank, mining/fishing. Runs in its own window started by the mage. |
| `version.txt` | – | Current version (e.g. `v319`). The loader always fetches this first, so updating = pushing new files + bumping this line. |

`bot.js`, `priest.js`, `ranger.js`, `merchant.js` are the working copies; the `_vNNN` files are the released versions.

## Features

**Farming (mage + priest + ranger)**
- Automatic farm spot selection by measured XP/h and gold/h, monster danger rating and death history; manual spot override in the panel.
- Team logic: priest/ranger follow, rally points before dangerous spawns, "wait for team" on team-only monsters, grace period after arrival so nobody runs off alone.
- Priest heals and focus-fires the mage's target; ranger uses multi-shot skills; rare spawns (phoenix etc.) get priority for the whole team.
- Monster hunts: accept, team hunts, hand-in, per-monster allow list, auto-disable after a death.
- Flee logic (boss nearby, low HP, team missing), stuck detection, pathing around cliffs/water.
- Bycatch of safe monsters, "strict" mode for team-only monsters.

**Events (one on/off switch, prioritised, interrupt farming/hunting)**
Goo Brawl, Giga Crab, Dragold, Grinch, Wabbit, Snowman, Love Goo, A/B Testing (PvP – mage + ranger join, priest keeps farming).

**Merchant**
- Market scan across all servers, arbitrage trips (start merchant on another server, buy cheap, sell at home), trip cooldown.
- Buys wish-list items for the team (class filter mage/priest/ranger, price caps), delivers them.
- Sells via stand (own prices, 3-day average), NPC-sells junk – valuable items are never NPC-sold, they go to the stand instead.
- Supplies HP/MP potions (800/800) to all characters, collects gold and loot from the team.
- Bank window: NPC value / current market / 3-day average per item, one-click "list on stand" or "NPC-sell".
- Mining and fishing on cooldown, crafts pickaxe/rod itself and buys spidersilk from the market up to a price cap.

**Gear**
- Upgrade / compound routine with budget, best-equip per class, gear handover to priest/ranger.
- Never NPC-sells items above a value threshold; no automatic token spending.

**Misc**
- Kiss/gift, cake, seashells, elixirs, ponty checks.
- Pause mode (P): play the mage manually, the team still supports, the merchant keeps working.
- Ingame control panel, per-character status panels, travel destination display, gold split into loot vs. sales, death analysis in the log.

## Setup

1. Fork or copy the repository so you can host your own files (the loader fetches from `raw.githubusercontent.com`).
2. Change the character names:
   - `bot.js` line ~377: `var TEAM = { merch: "...", priest: "...", ranger: "..." };`
   - `priest.js`, `ranger.js`, `merchant.js` line 9: `var MAGE = "...";`
   - The loader detects the role by class (`character.ctype`) or by the name containing `merch`, `priest` or `ranger`.
3. Rename/copy the files to `bot_vNNN.js` etc. and put the same `vNNN` into `version.txt`.
4. In `loader.js` set `BASE` to your repository's raw URL and `LP_CODE_SLOT` to the code slot number you save the loader in.
5. In the game: open the CODE editor on the **mage**, paste `loader.js` into that slot, save, press **Run**. The mage starts priest, ranger and merchant itself with the same slot (all characters must be on the same account and have the loader in that slot).

To update: push the new `_vNNN` files, change `version.txt`, restart the code in the game.

## Notes

- Everything runs client-side in the game's code runner; there are no credentials in the code.
- Shared state between characters goes through `send_cm` and `localStorage`, so all characters must run in the same browser.
- The merchant's server trips open a second character window on another server; this only works from the mage's window (needs `start_character`).
- No warranty – the bot has been tuned for one team on EU IV; other levels, gear or servers will need adjusted thresholds (see the `SET`/`MG` settings in the panel).
