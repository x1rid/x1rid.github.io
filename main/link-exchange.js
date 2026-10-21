(() => {
  /* ---------------------------------------------------------------
   * Link Exchange — data + render
   * All links are defined once. Categories are derived from the
   * category field so there is no duplication.
   * --------------------------------------------------------------- */

  const FALLBACK_LINKS = [
    // DEV
    { name: 'GitHub',       category: 'dev',    url: 'https://github.com/x1rid',            icon: './socials/icons/github.svg',      username: 'x1rid' },
    { name: 'Hugging Face', category: 'dev',    url: '#',                                   icon: './socials/icons/huggingface.svg' },
    { name: 'LinkedIn',     category: 'dev',    url: 'https://linkedin.com/in/xrid',        icon: './socials/icons/linkedin.svg',    username: 'xrid' },
    { name: 'GitLab',       category: 'dev',    url: '#',                                   icon: './socials/icons/gitlab.svg' },
    { name: 'DEV Community', category: 'dev',   url: '#',                                   icon: './socials/icons/devto.svg' },
    { name: 'Stack Overflow', category: 'dev',  url: '#',                                   icon: './socials/icons/stackoverflow.svg' },
    { name: 'Medium',       category: 'dev',    url: '#',                                   icon: './socials/icons/medium.svg' },
    { name: 'Substack',     category: 'dev',    url: '#',                                   icon: './socials/icons/substack.svg' },
    { name: 'CodePen',      category: 'dev',    url: '#',                                   icon: './socials/icons/codepen.svg' },
    { name: 'Kaggle',       category: 'dev',    url: '#',                                   icon: './socials/icons/kaggle.svg' },
    // SOCIAL
    { name: 'Email',     category: 'social',   url: 'mailto:ridoanulislam0@gmail.com',     icon: './socials/icons/email.svg',       username: 'ridoanulislam0@gmail.com' },
    { name: 'Reddit',    category: 'social',   url: 'https://reddit.com/user/r3d1bro',     icon: './socials/icons/reddit.svg',      username: 'r3d1bro' },
    { name: 'Discord',   category: 'social',   url: 'https://discord.com/users/558031359050776581', icon: './socials/icons/discord.svg', username: 'x9rid' },
    { name: 'Instagram', category: 'social',   url: 'https://instagram.com/r3d1bruh',      icon: './socials/icons/instagram.svg',   username: 'r3d1bruh' },
    { name: 'Snapchat',  category: 'social',   url: 'https://snapchat.com/add/r3d1bruh',   icon: './socials/icons/snapchat.svg',    username: 'r3d1bruh' },
    { name: 'TikTok',    category: 'social',   url: 'https://tiktok.com/@r3d1bruh',        icon: './socials/icons/tiktok.svg',      username: 'r3d1bruh' },
    { name: 'Twitter',   category: 'social',   url: 'https://x.com/i/user/1190238367666954241', icon: './socials/icons/twitter.svg', username: 'x4rid' },
    { name: 'Telegram',  category: 'social',   url: 'tg://user?id=7798423087',             icon: './socials/icons/telegram.svg',    username: '7798423087' },
    { name: 'WhatsApp',  category: 'social',   url: '#',                                   icon: './socials/icons/whatsapp.svg' },
    { name: 'Facebook',  category: 'social',   url: 'https://www.facebook.com/profile.php?id=100088120805119', icon: './socials/icons/facebook.svg' },
    { name: 'YouTube',   category: 'social',   url: '#',                                   icon: './socials/icons/youtube.svg' },
    { name: 'Pinterest', category: 'social',   url: '#',                                   icon: './socials/icons/pinterest.svg' },
    { name: 'Threads',   category: 'social',   url: '#',                                   icon: './socials/icons/threads.svg' },
    { name: 'Bluesky',   category: 'social',   url: '#',                                   icon: './socials/icons/bluesky.svg' },
    { name: 'Tumblr',    category: 'social',   url: '#',                                   icon: './socials/icons/tumblr.svg' },
    { name: 'Mastodon',  category: 'social',   url: '#',                                   icon: './socials/icons/mastodon.svg' },
    // PLAY
    { name: 'Steam',           category: 'play', url: 'https://steamcommunity.com/profiles/76561199067995946', icon: './socials/icons/steam.svg', friendCode: '1107730218' },
    { name: 'Xbox',            category: 'play', url: '#',                                  icon: './socials/icons/xbox.svg'       },
    { name: 'Riot Games',      category: 'play', url: '#',                                  icon: './socials/icons/riotgames.svg'  },
    { name: 'Epic Games',      category: 'play', url: '#',                                  icon: './socials/icons/epicgames.svg'  },
    { name: 'itch.io',         category: 'play', url: '#',                                  icon: './socials/icons/itchio.svg'     },
    { name: 'Ubisoft Connect', category: 'play', url: '#',                                  icon: './socials/icons/ubisoft.svg'    },
    { name: 'EA',              category: 'play', url: '#',                                  icon: './socials/icons/ea.svg'         },
    { name: 'GOG',             category: 'play', url: '#',                                  icon: './socials/icons/gog.svg'        },
    { name: 'PlayStation Network', category: 'play', url: '#',                              icon: './socials/icons/playstation.svg' },
    { name: 'Nintendo Switch', category: 'play', url: '#',                                  icon: './socials/icons/nintendoswitch.svg' },
    { name: 'Battle.net',      category: 'play', url: '#',                                  icon: './socials/icons/battlenet.svg'  },
    { name: 'Twitch',          category: 'play', url: '#',                                  icon: './socials/icons/twitch.svg'     },
    // MORE
    { name: 'Behance',     category: 'more', url: '#', icon: './socials/icons/behance.svg' },
    { name: 'Dribbble',    category: 'more', url: '#', icon: './socials/icons/dribbble.svg' },
    { name: 'ArtStation',  category: 'more', url: '#', icon: './socials/icons/artstation.svg' },
    { name: 'Letterboxd',  category: 'more', url: '#', icon: './socials/icons/letterboxd.svg' },
    { name: 'Goodreads',   category: 'more', url: '#', icon: './socials/icons/goodreads.svg' },
    { name: 'Last.fm',     category: 'more', url: '#', icon: './socials/icons/lastfm.svg' },
    { name: 'Spotify',     category: 'more', url: '#', icon: './socials/icons/spotify.svg' },
    { name: 'Strava',      category: 'more', url: '#', icon: './socials/icons/strava.svg' },
  ];

  /* Per-tile hover accent. Presentation only — links.json stays data. */
  const TILE_ACCENTS = {
    'GitHub':          '#c9d1d9',
    'Hugging Face':    '#ffd21e',
    'LinkedIn':        '#5aa9ff',
    'Email':           '#f472b6',
    'Reddit':          '#ff4500',
    'Discord':         '#8b9cff',
    'Instagram':       '#ff5d8f',
    'Snapchat':        '#fffc00',
    'TikTok':          '#9ff6ff',
    'Twitter':         '#1da1f2',
    'Telegram':        '#26a5e4',
    'WhatsApp':        '#25d366',
    'Facebook':        '#4f7cff',
    'Steam':           '#66c0f4',
    'Xbox':            '#8fe21c',
    'Riot Games':      '#ff4655',
    'Epic Games':      '#ffffff',
    'itch.io':         '#fa5c5c',
    'Ubisoft Connect': '#c9a6ff',
    'EA':              '#ffffff',
    'GOG':             '#c084fc',
    'GitLab':           '#fc6d26',
    'DEV Community':    '#ffffff',
    'Stack Overflow':   '#f58025',
    'Medium':           '#ffffff',
    'Substack':         '#ff6719',
    'CodePen':          '#ffffff',
    'Kaggle':           '#20beff',
    'YouTube':          '#ff0000',
    'Pinterest':        '#bd081c',
    'Threads':          '#ffffff',
    'Bluesky':          '#0285ff',
    'Tumblr':           '#ffffff',
    'Mastodon':         '#6364ff',
    'PlayStation Network': '#0070d1',
    'Nintendo Switch':  '#e60012',
    'Battle.net':       '#148eff',
    'Twitch':           '#9146ff',
    'Behance':          '#1769ff',
    'Dribbble':         '#ea4c89',
    'ArtStation':       '#13aff0',
    'Letterboxd':       '#00e054',
    'Goodreads':        '#c9a27e',
    'Last.fm':          '#d51007',
    'Spotify':          '#1db954',
    'Strava':           '#fc4c02',
  };

  const FALLBACK_LABELS = {
    all:    'All links',
    social: 'Social links',
    dev:    'Dev links',
    play:   'Play links',
    more:   'More links',
  };

  /* Live data. The arrays above are the offline/file:// fallback and are
     replaced by ./data/links.json when it can be fetched (see the loader at
     the bottom of this file). */
  let LINKS = FALLBACK_LINKS;
  let LABELS = FALLBACK_LABELS;
  let activeCategory = 'all';

  const grid    = document.querySelector('.link-exchange-grid');
  const buttons = Array.from(document.querySelectorAll('[data-link-category]'));
  const railContext = document.querySelector('.rail-context');
  const canHover = window.matchMedia
    ? window.matchMedia('(hover: hover) and (pointer: fine)')
    : { matches: true };
  if (!grid || !buttons.length) return;

  /* ------------------------------------------------------------------
   * renderCategory — replaces grid children with matching links
   * ------------------------------------------------------------------ */
  function hostOf(url) {
    if (!/^https?:\/\//i.test(String(url || ''))) return '';
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  function contactOf(url) {
    const value = String(url || '');
    return /^mailto:/i.test(value) ? value.slice(7).split('?')[0] : '';
  }

  /* Greyed-out tiles (no destination yet) always sort to the end,
     keeping their original relative order. */
  function isPending(link) {
    return !link.url || link.url === '#';
  }

  /* The rail has one transient slot. Tile hover/focus reports a
     destination there; the splitter reports its width. */
  function setRailContext(text) {
    if (!railContext) return;
    const value = text || '';
    if (railContext.textContent !== value) railContext.textContent = value;
  }

  /* Hovering a filter chip marks the tiles it would keep, so the
     taxonomy is visible before the click. No dimming, no reflow. */
  function markRelated(category) {
    const wanted = category && category !== 'all' ? category : null;
    grid.querySelectorAll('.social-tile').forEach((tile) => {
      tile.classList.toggle(
        'is-related',
        Boolean(wanted) && tile.dataset.category === wanted
      );
    });
  }

  function renderCategory(category) {
    activeCategory = category;
    resetMagnetic();

    /* Pending tiles are sorted last; the sort is stable for the rest. */
    const links = (category === 'all'
      ? LINKS
      : LINKS.filter((l) => l.category === category))
      .slice()
      .sort((a, b) => Number(isPending(a)) - Number(isPending(b)));

    const fragment = document.createDocumentFragment();

    links.forEach(({ name, category: linkCategory, url, icon, username, friendCode }, index) => {
      const pending = isPending({ url });
      const tile = document.createElement(pending ? 'div' : 'a');
      const target = contactOf(url) || hostOf(url);

      tile.className = `social-tile${pending ? ' is-pending' : ''}`;
      tile.dataset.category = linkCategory;
      if (username) tile.dataset.username = username;
      if (friendCode) tile.dataset.friendCode = friendCode;
      tile.style.setProperty('--tile-index', String(index));
      tile.style.setProperty('--tile-accent', TILE_ACCENTS[name] || '#c084fc');

      if (pending) {
        /* No destination yet: not a control, and it says so. */
        tile.title = `${name} — link not available yet`;
        tile.setAttribute('role', 'img');
        tile.setAttribute('aria-label', `${name} — link not available yet`);
      } else {
        tile.href = url;
        tile.title = target ? `${name} — ${target}` : name;
        tile.setAttribute('aria-label', `Open ${name}${target ? ` (${target})` : ''}`);
        tile.dataset.context = contactOf(url)
          ? `MAIL: ${target}`
          : target ? `LINK: ${target}` : '';
        if (url.startsWith('http')) {
          tile.target = '_blank';
          tile.rel    = 'noopener noreferrer';
        }
      }

      const frame = document.createElement('span');
      frame.className = 'icon-frame';

      const sheen = document.createElement('span');
      sheen.className = 'frame-sheen';
      sheen.setAttribute('aria-hidden', 'true');

      const pixelLayer = document.createElement('span');
      pixelLayer.className = 'pixel-layer';
      pixelLayer.setAttribute('aria-hidden', 'true');

      const img = document.createElement('img');
      img.src      = icon;
      img.alt      = name;
      img.width    = 64;
      img.height   = 64;
      img.loading  = index < 10 ? 'eager' : 'lazy';
      img.decoding = 'async';

      /* Graceful fallback — keeps the tile and its effects intact on a
         broken image. */
      img.addEventListener('error', () => {
        img.remove();
        const fallback = document.createElement('span');
        fallback.className = 'icon-fallback';
        fallback.textContent = name.slice(0, 2).toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        frame.appendChild(fallback);
      });

      const label = document.createElement('span');
      label.className   = 'badge-label';
      label.textContent = name;

      frame.appendChild(sheen);
      frame.appendChild(pixelLayer);
      frame.appendChild(img);
      tile.appendChild(frame);
      tile.appendChild(label);
      fragment.appendChild(tile);
    });

    grid.replaceChildren(fragment);
    setRailContext('');
    markRelated(null);
    grid.setAttribute('aria-label', LABELS[category] || LABELS.all);
    grid.dataset.state = links.length ? 'ready' : 'empty';

    /* Header metadata mirrors the active filter — real state only. */
    const activeButton = buttons.find((btn) => btn.dataset.linkCategory === category);
    const filterLabel = activeButton ? activeButton.textContent.trim() : category.toUpperCase();
    const countLabel = `${links.length} ${links.length === 1 ? 'link' : 'links'}`;

    const sectionTitle = document.getElementById('main-section-title');
    if (sectionTitle) {
      sectionTitle.dataset.meta = `${countLabel} · filter: ${filterLabel}`;
    }

    /* The grid itself is not a live region: announcing every tile on each
       filter change drowns the result. One short status line is enough. */
    const status = document.getElementById('link-status');
    if (status) status.textContent = `${countLabel} · ${filterLabel}`;

    buttons.forEach((btn) => {
      const active = btn.dataset.linkCategory === category;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /* Filter chips: click filters; hover/focus previews membership.
     The hover preview is pointer-only, so a tap does not flash it. */
  buttons.forEach((btn) => {
    const mark = () => markRelated(btn.dataset.linkCategory);
    const clear = () => markRelated(null);
    btn.addEventListener('click', () => renderCategory(btn.dataset.linkCategory));
    btn.addEventListener('focus', mark);
    btn.addEventListener('blur', clear);
    if (canHover.matches) {
      btn.addEventListener('pointerenter', mark);
      btn.addEventListener('pointerleave', clear);
    }
  });

  /* Tiles report their destination into the rail's context slot, on
     pointer and on keyboard focus alike. Pending tiles stay silent:
     they are not controls, so they must not answer like one. */
  grid.addEventListener('pointerover', (event) => {
    const tile = event.target.closest('.social-tile');
    if (!tile || tile.classList.contains('is-pending')) {
      setRailContext('');
      return;
    }
    setRailContext(tile.dataset.context || '');
  });

  grid.addEventListener('pointerout', (event) => {
    if (grid.contains(event.relatedTarget)) return;
    setRailContext('');
  });

  grid.addEventListener('focusin', (event) => {
    const tile = event.target.closest('.social-tile');
    if (!tile || tile.classList.contains('is-pending')) return;
    setRailContext(tile.dataset.context || '');
  });

  grid.addEventListener('focusout', (event) => {
    if (grid.contains(event.relatedTarget)) return;
    setRailContext('');
  });

  /* ------------------------------------------------------------------
   * Magnetic tiles + pixel feedback
   * The screen leans toward a fine pointer, the sheen tracks it, and a
   * few 4px sparks mark enter / movement / activation. Touch and
   * reduced-motion users keep the colour-only state.
   * ------------------------------------------------------------------ */
  const motionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: null };

  const MAGNET_MAX = 4;
  const TILT_MAX = 2.5;
  const SPARK_INTERVAL = 150;

  let activeTile = null;
  let lastSpark = 0;
  let moveFrame = 0;
  let pendingPoint = null;

  function resetTile(tile) {
    tile.style.setProperty('--move-x', '0px');
    tile.style.setProperty('--move-y', '0px');
    tile.style.setProperty('--rotate-x', '0deg');
    tile.style.setProperty('--rotate-y', '0deg');
    tile.style.setProperty('--pointer-x', '50%');
    tile.style.setProperty('--pointer-y', '50%');
  }

  function releaseMagnetic() {
    if (activeTile) {
      resetTile(activeTile);
      activeTile = null;
    }

    if (moveFrame) {
      cancelAnimationFrame(moveFrame);
      moveFrame = 0;
    }
    pendingPoint = null;
  }

  function resetMagnetic() {
    releaseMagnetic();
    grid.querySelectorAll('.pixel-spark').forEach((spark) => spark.remove());
  }

  function spawnPixels(tile, x, y, count) {
    if (motionQuery.matches) return;

    const layer = tile.querySelector('.pixel-layer');
    if (!layer) return;

    for (let i = 0; i < count; i++) {
      const pixel = document.createElement('span');
      pixel.className = 'pixel-spark';
      pixel.style.left = `${x}px`;
      pixel.style.top = `${y}px`;
      pixel.style.setProperty(
        '--pixel-x',
        `${Math.round((Math.random() - 0.5) * 28)}px`
      );
      pixel.style.setProperty(
        '--pixel-y',
        `${Math.round((Math.random() - 0.5) * 28)}px`
      );

      layer.appendChild(pixel);
      pixel.addEventListener('animationend', () => pixel.remove(), {
        once: true,
      });
    }
  }

  function updateMagnetic(tile, clientX, clientY) {
    const frame = tile.querySelector('.icon-frame');
    if (!frame) return null;

    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const nx = Math.max(-1, Math.min(1, (x / rect.width - 0.5) * 2));
    const ny = Math.max(-1, Math.min(1, (y / rect.height - 0.5) * 2));

    tile.style.setProperty('--move-x', `${nx * MAGNET_MAX}px`);
    tile.style.setProperty('--move-y', `${ny * MAGNET_MAX}px`);
    tile.style.setProperty('--rotate-y', `${nx * TILT_MAX}deg`);
    tile.style.setProperty('--rotate-x', `${-ny * TILT_MAX}deg`);
    tile.style.setProperty('--pointer-x', `${x}px`);
    tile.style.setProperty('--pointer-y', `${y}px`);

    return { x, y };
  }

  grid.addEventListener('pointerover', (event) => {
    if (
      event.pointerType !== 'mouse' ||
      !canHover.matches ||
      motionQuery.matches
    ) {
      return;
    }

    const tile = event.target.closest('.social-tile');
    if (
      !tile ||
      tile.classList.contains('is-pending') ||
      tile === activeTile
    ) {
      return;
    }

    activeTile = tile;
    const point = updateMagnetic(tile, event.clientX, event.clientY);
    if (!point) return;

    lastSpark = performance.now();
    spawnPixels(tile, point.x, point.y, 2);
  });

  grid.addEventListener('pointermove', (event) => {
    if (
      event.pointerType !== 'mouse' ||
      !canHover.matches ||
      motionQuery.matches
    ) {
      return;
    }

    const tile = event.target.closest('.social-tile');
    if (!tile || tile.classList.contains('is-pending')) return;

    activeTile = tile;
    pendingPoint = {
      tile,
      clientX: event.clientX,
      clientY: event.clientY,
    };

    if (moveFrame) return;

    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (!pendingPoint) return;

      const { tile: currentTile, clientX, clientY } = pendingPoint;
      pendingPoint = null;

      const point = updateMagnetic(currentTile, clientX, clientY);
      if (!point) return;

      const now = performance.now();
      if (now - lastSpark > SPARK_INTERVAL) {
        lastSpark = now;
        spawnPixels(currentTile, point.x, point.y, 1);
      }
    });
  });

  grid.addEventListener('pointerout', (event) => {
    const tile = event.target.closest('.social-tile');
    if (!tile || tile.contains(event.relatedTarget)) return;

    if (tile === activeTile) {
      resetTile(tile);
      activeTile = null;
    }
  });

  grid.addEventListener('click', (event) => {
    if (motionQuery.matches) return;

    const tile = event.target.closest('.social-tile');
    if (!tile || tile.classList.contains('is-pending')) return;

    const frame = tile.querySelector('.icon-frame');
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    spawnPixels(tile, rect.width / 2, rect.height / 2, 3);
  });

  const handleMotionChange = (event) => {
    if (event.matches) resetMagnetic();
  };

  const handlePointerChange = (event) => {
    if (!event.matches) resetMagnetic();
  };

  motionQuery.addEventListener?.('change', handleMotionChange);
  canHover.addEventListener?.('change', handlePointerChange);
  window.addEventListener('blur', releaseMagnetic);

  /* Default: show ALL links on first render */
  renderCategory('all');

  /* ------------------------------------------------------------------
   * Optional external data — main/data/links.json
   * Add or edit links there (JSON only, no JavaScript). When the fetch is
   * unavailable (file://, offline, blocked) the fallback arrays above stay
   * in charge, so the tile grid never breaks.
   * ------------------------------------------------------------------ */
  fetch('./data/links.json')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.links) || !data.links.length) return;
      /* Identical to the fallback (the normal case): nothing to redraw. */
      if (JSON.stringify(data.links) === JSON.stringify(FALLBACK_LINKS)) return;
      LINKS = data.links;
      LABELS = data.labels || FALLBACK_LABELS;
      renderCategory(activeCategory);
    })
    .catch(() => {
      /* file:// or offline — the fallbacks are already rendered. */
    });
})();
