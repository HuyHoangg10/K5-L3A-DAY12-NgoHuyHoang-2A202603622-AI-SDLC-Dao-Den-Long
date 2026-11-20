# Phase 4: what I checked by hand

The automated evidence (`docs/evidence/phase-4/README.md`) cannot look at a screen. I checked these in a real browser (the app's browser pane, Chrome, Windows 11, 1280x720 viewport):

| what | how | result |
|---|---|---|
| Every text at least 18 px | script in the page: computed font size of every element that has text (menu, HUD, cards, champion select) | after raising the champion cards and skill buttons: none below 18 px; before the fix it found 11.5 px to 16 px texts there |
| Menu, intro, pause, settings, end card, leaderboard screens | opened each one at 1280x720 | all fit, the settings card scrolls |
| Key rebinding | clicked Jump, pressed E (already used) | warning "E is already used for ..." and the key did not change; "Restore default keys" present |
| Name form | typed `ab` + Enter, then `c_Dev` + Enter on a lost night | short name refused with a message, valid name saved ("Saved! You are number 1 of 1"); Enter in the box saves and no longer starts the next night (found and fixed, see `docs/notes/ai-errors.md` row 18) |
| Leaderboard screen | posted entries to the launcher's API, opened the screen | table with rank, name, score, nights, date; "saved in data/leaderboard.json"; a name of 2 characters was refused by the API (400) |
| Fuel HUD | set three lanterns to 81, 23 and 99 fuel | the low one is red with a warning sign and blinks; "(beep) L2 is running low" subtitle appeared |
| Benchmark window | `npm run bench` | runs, writes `bench.json` (numbers in the README) |

What I did **not** check: Firefox and Safari, a real gamepad-free play-through of all three nights by hand in this session, the sound output (I cannot hear it here), colour-blind mode by a colour-blind person, and the exact look on other GPUs.
