/* ---------------------------------------------------------------------------
 *  iframe-policy.js — which remote hosts can live inside the page pane
 *
 *  Browsers cannot reliably tell us that a frame was refused: an
 *  X-Frame-Options / CSP `frame-ancestors` block still fires `load` and the
 *  document stays cross-origin either way. This is therefore a conservative
 *  host list of sites that answer with those headers, so "Open in page pane"
 *  is never offered for a page that can only render its own error screen.
 *
 *  Unknown hosts stay embeddable: the pane is still useful for local pages and
 *  for the many sites that do allow framing. Embed URLs (YouTube /embed/,
 *  Spotify /embed/, the SoundCloud player, Vimeo's player) stay allowed even
 *  though their parent hosts block ordinary pages.
 * ------------------------------------------------------------------------- */
(() => {
  'use strict';

  const BLOCKED_HOSTS = [
    // Dev / code
    'github.com',
    'githubusercontent.com',
    'githubassets.com',
    'huggingface.co',
    'linkedin.com',
    'stackoverflow.com',
    'stackexchange.com',
    'serverfault.com',
    'superuser.com',
    'replit.com',

    // Social
    'reddit.com',
    'redd.it',
    'redditmedia.com',
    'instagram.com',
    'cdninstagram.com',
    'snapchat.com',
    'twitter.com',
    'x.com',
    't.co',
    'telegram.org',
    't.me',
    'telegram.me',
    'whatsapp.com',
    'whatsapp.net',
    'facebook.com',
    'fb.com',
    'fb.watch',
    'messenger.com',
    'discord.com',
    'discord.gg',
    'discordapp.com',
    'tumblr.com',
    'pinterest.com',
    'pinimg.com',
    'deviantart.com',

    // Play / media
    'steamcommunity.com',
    'steampowered.com',
    'xbox.com',
    'xboxlive.com',
    'riotgames.com',
    'leagueoflegends.com',
    'valorant.com',
    'epicgames.com',
    'ubisoft.com',
    'ubisoftconnect.com',
    'ea.com',
    'origin.com',
    'itch.io',
    'twitch.tv',
    'vimeo.com',
    'soundcloud.com',
    'spotify.com',
    'netflix.com',

    // Commerce / docs / accounts
    'apple.com',
    'microsoft.com',
    'live.com',
    'office.com',
    'outlook.com',
    'bing.com',
    'yahoo.com',
    'medium.com',
    'quora.com',
    'paypal.com',
    'dropbox.com',
    'notion.so',
    'figma.com',
    'canva.com',
    'booking.com',
    'airbnb.com',
    'ebay.com',
    'walmart.com',
    'nytimes.com',
    'bbc.com',
    'bbc.co.uk',
    'cnn.com',
    'imgur.com',
  ];

  /* Country domains cannot be enumerated sensibly, so match the family. */
  const BLOCKED_PATTERNS = [
    /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/,
    /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2,3})?$/,
    /(^|\.)youtube(-nocookie)?\.com$/,
    /(^|\.)youtu\.be$/,
  ];

  function normalizeHost(host) {
    return String(host || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  }

  function isBlockedHost(host) {
    if (!host) return false;
    return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
      || BLOCKED_PATTERNS.some((pattern) => pattern.test(host));
  }

  function isEmbedUrl(host, pathname) {
    const path = String(pathname || '');
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      return path.startsWith('/embed/') || path.startsWith('/playlist/');
    }
    if (host === 'open.spotify.com') return path.startsWith('/embed/');
    if (host === 'w.soundcloud.com') return path.startsWith('/player');
    if (host === 'player.vimeo.com') return true;
    if (/(^|\.)google\.[a-z.]+$/.test(host) && path.startsWith('/maps/embed')) return true;
    return false;
  }

  /* Returns the reason alongside the decision so callers can report it. */
  function embedPolicy(raw) {
    let parsed;
    try {
      parsed = new URL(String(raw || ''), window.location.href);
    } catch (_) {
      return { canEmbed: false, host: '', reason: 'invalid' };
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      /* Relative/local documents are served from this origin: always fine. */
      return { canEmbed: true, host: '', reason: 'local' };
    }

    const host = normalizeHost(parsed.hostname);
    if (isEmbedUrl(host, parsed.pathname)) {
      return { canEmbed: true, host, reason: 'embed' };
    }
    if (isBlockedHost(host)) {
      return { canEmbed: false, host, reason: 'blocked' };
    }
    return { canEmbed: true, host, reason: 'open' };
  }

  function canEmbed(raw) {
    return embedPolicy(raw).canEmbed;
  }

  function hostOf(raw) {
    return embedPolicy(raw).host;
  }

  window.SiteIframes = Object.freeze({
    canEmbed,
    embedPolicy,
    hostOf,
    blockedHosts: Object.freeze(BLOCKED_HOSTS.slice()),
  });
})();
