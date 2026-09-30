# Tonka Construction (browser engine)

A from-scratch TypeScript reimplementation of the engine for the 1996 Windows game _Tonka Construction_, rendered on a `<canvas>` and built with Vite.

This repository contains **no game data**. It reads the art, sound, animations and intro movie from your own copy of the game, which you extract locally. Nothing from the disc is committed, bundled or published, so there is no hosted build.

## Setup

You need your own copy of the CD, either as an `.iso` image or as a folder containing its `DATA` directory.

```bash
pnpm install
pnpm extract "path/to/Tonka Construction.iso"
pnpm dev
```

`pnpm extract` reads the ISO directly (no mounting needed) or a folder, and copies the game files into `public/data/`, which is gitignored. It warns if your `TONKA.EXE` is a different version from the one this engine was built against.

Then open the address Vite prints. If the data hasn't been extracted, the page tells you how to do it.

## Controls

| Input | Action |
| --- | --- |
| Click | Everything: talk, pick up, place, work |
| Click while a character is talking | Skip the line, if it can be skipped |
| Move the mouse while driving | Steer; the vehicle follows mouse motion, turning one step at a time |
| Click while driving | Raise or lower the tool (bucket, blade, hook, chute) |
| Esc / Enter / click during the intro movie | Skip the movie |
| Esc | Release the mouse from the game; click the game to capture it again |
| `-` / `=` | Volume down / up (the speaker button and slider in the bottom-right corner do the same, and the button mutes) |
| Type during sign-in | Enter your name (letters, digits, space, up to 11 characters) |

## How it works

- `tools/extract.ts` reads ISO 9660 images and copies the game's data files.
- `src/formats/` parses the original files: the `MODULExx.DAT` scene packs (palette, background, PackBits sprites, streamed animation chunks with 8-bit PCM audio), WAV, PCX, the `MVE4` intro movie, and the PE resources in `TONKA.EXE` (cursors).
- `src/engine/` is the runtime: an 8-bit indexed framebuffer with palette cycling and fades, the original's timer scheduler, streamed playback at 8 fps, speech and skipping, draw layers with depth sorting, pixel hit testing and collision, drag and drop, 12-heading vehicle steering, ground limits, path autopilot, the activity toolbar, and save/load.
- `src/modules/` holds the per-scene logic: menus and maps, the three garages and truck cabs, the demolition lot, the three city sites, and the quarry, avalanche and desert.

## Differences from the original

The game logic, timings and scene flow follow the original. These are the deliberate changes for the browser:

- **Start screen.** Browsers block sound until the first click, so a "Click to start" button appears before the intro movie.
- **Saves.** The ten save slots are stored in the browser's `localStorage` instead of `save0.dat`–`save9.dat`. Per-scene progress is kept in memory for the session, like the original's `$TEMPnn.sav` files.
- **Auto-save (new).** Once you've signed in, the game saves itself to a separate auto-save slot every time you enter a scene and when you close or hide the tab. The ten manual slots are never touched. If an auto-save exists, the start screen offers **Continue**, which skips the intro movie and puts you back in the scene you left, alongside **New game**.
- **Volume controls (new).** A speaker button and slider in the page corner, plus the `-` and `=` keys. The setting is remembered.
- **Quitting.** After the credits, the page reloads instead of closing a window.
- **Printing.** Print buttons open the current screen in a new window and use the browser's print dialog.
- **Fonts.** The player's name on the sign-in card, time card and certificates is drawn in a bold sans-serif, because the original's custom font isn't on the disc.
- **Mouse input.** The original clipped the cursor to its 640×480 window and warped it back to the vehicle after every move while driving. The browser locks the pointer to the game instead and draws the game's own cursor, clamped to the play area, moving one game pixel per pixel of mouse motion as on the original's full-screen display. Driving uses the relative motion directly, and small motions add up until they make a step, because browsers report far more (and smaller) mouse events than Windows 95 did.
- **Edge scrolling.** The original scrolled as fast as the PC could redraw. It now runs at a fixed rate.
- **Frame rate.** The screen is drawn every display frame instead of only in changed rectangles. Game timing still runs on the original's timers.

## Development

```bash
pnpm dev
pnpm build
pnpm lint
pnpm format
```

`?module=N` in the URL skips the start screen and movie and opens scene `N` directly. `?viewer` opens a scene and sprite browser (PageUp/PageDown scenes, arrows for objects and frames, A/D to scroll).
