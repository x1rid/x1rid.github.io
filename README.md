# x1rid.github.io

A purple/black retro personal homepage. Fully static — no build step, no
dependencies, no framework.

**Live:** https://x1rid.github.io (the root `index.html` redirects to `/main/index.html`)

## Structure

```
index.html          → redirect to ./main/index.html
main/               → the retro homepage
    index.html      → page shell + inline styles
    terminal.css    → terminal / neofetch / webpage-pane styles
    music.css       → music widget + player styles
    mobile.css      → <=760px layout
    custom-cursor.js→ animated GIF cursor + particle trail
    link-exchange.js→ link tiles (animated on hover only)
    splitter.js     → draggable sidebar divider
    music.js        → music widget + player
    terminal.js     → fake terminal + windows/webpage in-page browsing
    assets/         → cursor GIFs
    playlist/       → music tracks + playlist.json (manifest)
    socials/        → profile/social icons (.webp static, .gif animated)
dora/               → doraverse / anushkaverse side project site
l/                  → link-tree page
serve.py            → local dev server (also auto-lists /main/playlist)
```

## Terminal

The `main/` page includes a fake terminal with these commands:

- `cls`
- `dir` / `ls`
- `cd`
- `start` / `open`
- `man`
- `echo`
- `rm`, `rmdir`, `cp`
- `save`, `load`, `saved-files`
- `neofetch`
- `layout compact|normal`
- `promptgap <px>`
- `help`

The terminal also supports command history with Up/Down arrows, Tab autocomplete,
Ctrl+L to clear, and persistent history in `localStorage`. Pages opened with
`open`/`start` stay in the sidebar below Neofetch.

## Music

Tracks live in `main/playlist/`. Add or remove audio files and update
`main/playlist/playlist.json` so the deployed (GitHub Pages) player can find them.
When running the local dev server (`python serve.py`) or any server that exposes a
directory listing, the player picks up new files automatically.

Features:

- Purple/black retro player window
- Autoplays on load, starting minimized in the lower-right dock until the
  dock is tapped (only an explicit "sound off" keeps it silent)
- Draggable dock (position remembered; double-click to re-dock it)
- Draggable title bar with saved position
- Track list, seek, volume and crossfades
- Optional background music remembered between visits

## Custom cursor

`main/custom-cursor.js` replaces the system cursor with an animated GIF (48px)
plus a rainbow particle trail. It only activates on fine pointers with motion
allowed, pauses when the tab is hidden or the pointer leaves the window, and is
hidden if the GIF fails to load.

## Link exchange

Social/gaming tiles use static `.webp` icons; animated `.gif` versions are only
fetched and played while a tile is hovered or focused.

## Development

```
python serve.py [port]   # default 5500
```

Then open http://127.0.0.1:5500/main/index.html

Committing is plain `git`; GitHub Pages serves the repository root.

## License

MIT — see [LICENSE](LICENSE).
