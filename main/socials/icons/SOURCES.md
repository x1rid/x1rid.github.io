# Link icon sources

Replacements for the old `.webp`/`.gif` badge pair. One square SVG per link,
all rendered on a 64×64 grid. Preference order used:

1. an older version of the platform's logo,
2. a generated icon when no usable old mark exists,
3. the present logo.

| Link | File | Version | Source |
|------|------|---------|--------|
| GitHub | `github.svg` | present (mark unchanged since 2008) | Simple Icons |
| Hugging Face | `huggingface.svg` | present | Simple Icons |
| LinkedIn | `linkedin.svg` | generated badge (2003–2012 "in" square style) | generated for this site |
| Email | `email.svg` | generated envelope | generated for this site |
| Reddit | `reddit.svg` | classic Snoo | Simple Icons |
| Discord | `discord.svg` | classic Clyde mark | Simple Icons |
| Instagram | `instagram.svg` | classic camera outline | Simple Icons |
| Snapchat | `snapchat.svg` | present ghost | Simple Icons |
| TikTok | `tiktok.svg` | present note | Simple Icons |
| Twitter | `twitter.svg` | **old bird (pre-2023)** | Wikimedia Commons, recoloured to #1DA1F2 |
| Telegram | `telegram.svg` | present plane | Simple Icons |
| WhatsApp | `whatsapp.svg` | present bubble | Simple Icons |
| Facebook | `facebook.svg` | **2013 icon** | Wikimedia Commons |
| Steam | `steam.svg` | present mark | Simple Icons |
| Xbox | `xbox.svg` | generated 2001 orb | generated for this site |
| Riot Games | `riotgames.svg` | present mark | Simple Icons |
| Epic Games | `epicgames.svg` | present mark | Simple Icons |
| itch.io | `itchio.svg` | present mark | Simple Icons |
| Ubisoft Connect | `ubisoft.svg` | present swirl | Simple Icons |
| EA | `ea.svg` | present monogram | Simple Icons |
| GOG | `gog.svg` | present wordmark | Simple Icons |
| YouTube | `youtube.svg` | present | Simple Icons |
| Pinterest | `pinterest.svg` | present | Simple Icons |
| Threads | `threads.svg` | present, recoloured white | Simple Icons |
| Bluesky | `bluesky.svg` | present | Simple Icons |
| Twitch | `twitch.svg` | present | Simple Icons |
| Tumblr | `tumblr.svg` | present, recoloured white | Simple Icons |
| Mastodon | `mastodon.svg` | present | Simple Icons |
| PlayStation Network | `playstation.svg` | present | Simple Icons |
| Nintendo Switch | `nintendoswitch.svg` | present | Simple Icons v13 (removed from current CDN) |
| Battle.net | `battlenet.svg` | present | Simple Icons |
| GitLab | `gitlab.svg` | present | Simple Icons |
| DEV Community | `devto.svg` | present, recoloured white | Simple Icons |
| Stack Overflow | `stackoverflow.svg` | present | Simple Icons |
| Medium | `medium.svg` | present, recoloured white | Simple Icons |
| Substack | `substack.svg` | present | Simple Icons |
| CodePen | `codepen.svg` | present, recoloured white | Simple Icons v13 (removed from current CDN) |
| Kaggle | `kaggle.svg` | present | Simple Icons |
| Behance | `behance.svg` | present | Simple Icons |
| Dribbble | `dribbble.svg` | present | Simple Icons |
| ArtStation | `artstation.svg` | present | Simple Icons |
| Letterboxd | `letterboxd.svg` | present | Simple Icons |
| Goodreads | `goodreads.svg` | present, lightened for dark tiles | Simple Icons |
| Last.fm | `lastfm.svg` | present | Simple Icons |
| Spotify | `spotify.svg` | present | Simple Icons |
| Strava | `strava.svg` | present | Simple Icons |

Notes:

- Simple Icons is CC0; brand marks remain trademarks of their owners.
- The pre-2023 Twitter bird, the 2013 Facebook icon and the 2001 Xbox orb were
  the only usable "old" versions found. Old Discord and Reddit files on
  Wikimedia were wordmarks, too wide for a square tile, so their classic marks
  (which kept the same silhouette) stand in.
- The old Instagram camera found on Commons was a 20×20 raster, so the classic
  camera outline from Simple Icons is used instead.
- Black/dark marks (Threads, DEV, Medium, CodePen, Tumblr) are rendered white;
  Goodreads is lightened so it stays visible on the dark tile. Fill colours
  live in the SVG files.
- No hover animation is baked into these files. Every hover effect lives in
  `main/css/links.css` and is scoped to the link-exchange tiles only.
