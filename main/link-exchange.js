(() => {
  /* ---------------------------------------------------------------
   * Link Exchange — data + render
   * All links are defined once. Categories are derived from the
   * category field so there is no duplication.
   * --------------------------------------------------------------- */

  const LINKS = [
    // SOCIAL
    { name: 'GitHub',    category: 'social',   url: 'https://github.com/r3d1bruh',           icon: './socials/github.webp'  },
    { name: 'Reddit',    category: 'social',   url: 'https://reddit.com/user/r3d1bruh',      icon: './socials/reddit.webp'  },
    { name: 'Discord',   category: 'social',   url: '#',                                     icon: './socials/discord.webp' },
    { name: 'Instagram', category: 'social',   url: 'https://instagram.com/r3d1bruh',        icon: './socials/insta.webp'   },
    { name: 'Snapchat',  category: 'social',   url: 'https://snapchat.com/add/r3d1bruh',     icon: './socials/snapchat.webp'},
    { name: 'TikTok',   category: 'social',   url: 'https://tiktok.com/@r3d1bruh',          icon: './socials/tiktok.webp'  },
    { name: 'X',         category: 'social',   url: 'https://twitter.com/r3d1bruh',          icon: './socials/x.webp'       },
    { name: 'LinkedIn',  category: 'social',   url: 'https://linkedin.com/in/r3d1bruh',      icon: './socials/linkedin.webp'},
    { name: 'Telegram',  category: 'social',   url: 'https://telegram.org',                  icon: 'https://cdn.simpleicons.org/telegram/26A5E4'   },
    { name: 'WhatsApp',  category: 'social',   url: 'https://www.whatsapp.com',              icon: 'https://cdn.simpleicons.org/whatsapp/25D366'   },
    { name: 'Facebook',  category: 'social',   url: 'https://www.facebook.com',              icon: 'https://cdn.simpleicons.org/facebook/1877F2'   },
    // GAMING
    { name: 'Steam',         category: 'gaming',  url: 'https://steamcommunity.com/id/r3d1bruh', icon: './socials/steam.webp'   },
    { name: 'Xbox',          category: 'gaming',  url: 'https://www.xbox.com',                   icon: 'https://cdn.simpleicons.org/xbox/107C10'       },
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
  const ICON_SCALE = {
    'Steam':      'icon--wide',
    'Riot Games': 'icon--small',
    'Epic Games': 'icon--small',
    'EA':         'icon--small',
    'GOG':        'icon--small',
  };

  const LABELS = {
    all:      'All links',
    social:   'Social links',
    gaming:   'Gaming links',
    'ai-tech':'AI and tech links',
  };

  const grid    = document.querySelector('.link-exchange-grid');
  const buttons = Array.from(document.querySelectorAll('[data-link-category]'));
  if (!grid || !buttons.length) return;

  /* ------------------------------------------------------------------
   * renderCategory — replaces grid children with matching links
   * ------------------------------------------------------------------ */
  function renderCategory(category) {
    const links = category === 'all'
      ? LINKS
      : LINKS.filter((l) => l.category === category);

    const fragment = document.createDocumentFragment();

    links.forEach(({ name, url, icon }) => {
      const tile = document.createElement('a');
      tile.className = 'social-tile';
      tile.href = url;
      tile.title = name;
      tile.setAttribute('aria-label', `Open ${name}`);
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
      img.loading  = 'lazy';
      img.decoding = 'async';
      img.className = ICON_SCALE[name] || 'icon--large';

      /* Graceful fallback — keeps tile intact on broken image */
      img.addEventListener('error', () => {
        frame.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = 'icon-fallback';
        fallback.textContent = name.slice(0, 2).toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        frame.appendChild(fallback);
      }, { once: true });

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

  /* Mark ALL button as active by default */
  buttons.forEach((btn) => {
    if (btn.dataset.linkCategory === 'all') {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    }
  });
})();
