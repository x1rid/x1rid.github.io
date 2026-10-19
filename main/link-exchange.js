(() => {
  /* ---------------------------------------------------------------
   * Link Exchange — data + render
   * All links are defined once. Categories are derived from the
   * category field so there is no duplication.
   * --------------------------------------------------------------- */

  const FALLBACK_LINKS = [
    // SOCIAL
    { name: 'GitHub',    category: 'social',   url: 'https://github.com/r3d1bruh',           icon: './socials/github.webp',   gif: './socials/github.gif'   },
    { name: 'Reddit',    category: 'social',   url: 'https://reddit.com/user/r3d1bruh',      icon: './socials/reddit.webp',   gif: './socials/reddit.gif'   },
    { name: 'Discord',   category: 'social',   url: '#',                                     icon: './socials/discord.webp',  gif: './socials/discord.gif'  },
    { name: 'Instagram', category: 'social',   url: 'https://instagram.com/r3d1bruh',        icon: './socials/insta.webp',    gif: './socials/insta.gif'    },
    { name: 'Snapchat',  category: 'social',   url: 'https://snapchat.com/add/r3d1bruh',     icon: './socials/snapchat.webp', gif: './socials/snapchat.gif' },
    { name: 'TikTok',   category: 'social',   url: 'https://tiktok.com/@r3d1bruh',          icon: './socials/tiktok.webp',   gif: './socials/tiktok.gif'   },
    { name: 'X',         category: 'social',   url: 'https://twitter.com/r3d1bruh',          icon: './socials/x.webp',        gif: './socials/x.gif'        },
    { name: 'LinkedIn',  category: 'social',   url: 'https://linkedin.com/in/r3d1bruh',      icon: './socials/linkedin.webp', gif: './socials/linkedin.gif' },
    { name: 'Telegram',  category: 'social',   url: 'https://telegram.org',                  icon: 'https://cdn.simpleicons.org/telegram/26A5E4'   },
    { name: 'WhatsApp',  category: 'social',   url: 'https://www.whatsapp.com',              icon: 'https://cdn.simpleicons.org/whatsapp/25D366'   },
    { name: 'Facebook',  category: 'social',   url: 'https://www.facebook.com',              icon: 'https://cdn.simpleicons.org/facebook/1877F2'   },
    // GAMING
    { name: 'Steam',         category: 'gaming',  url: 'https://steamcommunity.com/id/r3d1bruh', icon: './socials/steam.webp',   gif: './socials/steam.gif'   },
    { name: 'Xbox',          category: 'gaming',  url: 'https://www.xbox.com',                   icon: './socials/xbox.svg'    },
    { name: 'Riot Games',    category: 'gaming',  url: 'https://www.riotgames.com',               icon: 'https://cdn.simpleicons.org/riotgames/D32936'  },
    { name: 'Epic Games',    category: 'gaming',  url: 'https://store.epicgames.com',             icon: 'https://cdn.simpleicons.org/epicgames/FFFFFF'  },
    { name: 'itch.io',       category: 'gaming',  url: 'https://itch.io',                         icon: 'https://cdn.simpleicons.org/itchdotio/FA5C5C'  },
    { name: 'Ubisoft Connect', category: 'gaming', url: 'https://ubisoftconnect.com',             icon: 'https://cdn.simpleicons.org/ubisoft/FFFFFF'    },
    { name: 'EA',            category: 'gaming',  url: 'https://www.ea.com',                      icon: 'https://cdn.simpleicons.org/ea/FFFFFF'         },
    { name: 'GOG',           category: 'gaming',  url: 'https://www.gog.com',                     icon: 'https://cdn.simpleicons.org/gogdotcom/86328A'  },
    // AI / TECH
    { name: 'Hugging Face', category: 'ai-tech', url: 'https://huggingface.co',                  icon: 'https://cdn.simpleicons.org/huggingface/FFD21E' },
  ];

  /* Per-icon sizing class. Adjust visual scale without changing the grid. */
  const FALLBACK_ICON_SCALE = {
    'Steam':      'icon--wide',
    'Riot Games': 'icon--small',
    'Epic Games': 'icon--small',
    'EA':         'icon--small',
    'GOG':        'icon--small',
  };

  const FALLBACK_LABELS = {
    all:      'All links',
    social:   'Social links',
    gaming:   'Gaming links',
    'ai-tech':'AI and tech links',
  };

  /* Live data. The arrays above are the offline/file:// fallback and are
     replaced by ./data/links.json when it can be fetched (see the loader at
     the bottom of this file). */
  let LINKS = FALLBACK_LINKS;
  let ICON_SCALE = FALLBACK_ICON_SCALE;
  let LABELS = FALLBACK_LABELS;
  let activeCategory = 'all';

  const grid    = document.querySelector('.link-exchange-grid');
  const buttons = Array.from(document.querySelectorAll('[data-link-category]'));
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

  function renderCategory(category) {
    activeCategory = category;
    const links = category === 'all'
      ? LINKS
      : LINKS.filter((l) => l.category === category);

    const fragment = document.createDocumentFragment();

    links.forEach(({ name, url, icon, gif }, index) => {
      const tile = document.createElement('a');
      tile.className = 'social-tile';
      tile.href = url;
      const domain = hostOf(url);
      tile.title = domain ? `${name} — ${domain}` : name;
      tile.setAttribute('aria-label', `Open ${name}${domain ? ` (${domain})` : ''}`);
      tile.style.setProperty('--tile-index', String(index));
      if (url.startsWith('http')) {
        tile.target = '_blank';
        tile.rel    = 'noopener noreferrer';
      }

      const frame = document.createElement('span');
      frame.className = 'icon-frame';

      const img = document.createElement('img');
      img.src      = icon;
      img.alt      = name;
      img.width    = 94;
      img.height   = 88;
      img.loading  = index < 10 ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.className = ICON_SCALE[name] || 'icon--large';
      img.dataset.state = 'static';

      /* Graceful fallback — keeps tile intact on broken image. If the
         animated GIF fails when hovered, drop back to the static webp. */
      img.addEventListener('error', () => {
        if (img.dataset.state === 'gif') {
          img.dataset.state = 'static';
          img.src = icon;
          return;
        }
        frame.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = 'icon-fallback';
        fallback.textContent = name.slice(0, 2).toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        frame.appendChild(fallback);
      });

      /* Animated GIFs only play while the tile is hovered/focused. The GIF
         is fetched on first hover, so idle tiles cost nothing.
         Touch devices keep the static tile: a tap navigates away, and
         fetching an animation for a navigation that is about to happen is
         wasted work. Keyboard focus still swaps it, so the affordance is
         never mouse-only. */
      if (gif) {
        const canHover = window.matchMedia
          ? window.matchMedia('(hover: hover) and (pointer: fine)')
          : { matches: true };

        const showGif = () => {
          if (img.dataset.state === 'gif') return;
          img.dataset.state = 'gif';
          img.src = gif;
        };
        const showStatic = () => {
          if (img.dataset.state !== 'gif') return;
          img.dataset.state = 'static';
          img.src = icon;
        };
        if (canHover.matches) {
          tile.addEventListener('pointerenter', showGif);
          tile.addEventListener('pointerleave', showStatic);
        }
        tile.addEventListener('focusin', showGif);
        tile.addEventListener('focusout', showStatic);
      }

      const label = document.createElement('span');
      label.className   = 'badge-label';
      label.textContent = name;

      frame.appendChild(img);
      tile.appendChild(frame);
      tile.appendChild(label);
      fragment.appendChild(tile);
    });

    grid.replaceChildren(fragment);
    grid.setAttribute('aria-label', LABELS[category] || LABELS.social);
    grid.dataset.state = links.length ? 'ready' : 'empty';

    /* Header metadata mirrors the active filter — real state only. */
    const sectionTitle = document.getElementById('main-section-title');
    if (sectionTitle) {
      const activeButton = buttons.find((btn) => btn.dataset.linkCategory === category);
      const filterLabel = activeButton ? activeButton.textContent.trim() : category.toUpperCase();
      sectionTitle.dataset.meta = `${links.length} ${links.length === 1 ? 'entry' : 'entries'} · filter: ${filterLabel}`;
    }

    buttons.forEach((btn) => {
      const active = btn.dataset.linkCategory === category;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  /* Attach category-filter click handlers */
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => renderCategory(btn.dataset.linkCategory));
  });

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
      ICON_SCALE = data.iconScale || FALLBACK_ICON_SCALE;
      LABELS = data.labels || FALLBACK_LABELS;
      renderCategory(activeCategory);
    })
    .catch(() => {
      /* file:// or offline — the fallbacks are already rendered. */
    });
})();
