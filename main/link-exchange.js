(() => {
  const categories = {
    social: [
      ['GitHub', 'https://github.com/r3d1bruh', './socials/github.webp'],
      ['Reddit', 'https://reddit.com/user/r3d1bruh', './socials/reddit.webp'],
      ['Discord', '#', './socials/discord.webp'],
      ['Instagram', 'https://instagram.com/r3d1bruh', './socials/insta.webp'],
      ['Snapchat', 'https://snapchat.com/add/r3d1bruh', './socials/snapchat.webp'],
      ['TikTok', 'https://tiktok.com/@r3d1bruh', './socials/tiktok.webp'],
      ['X', 'https://twitter.com/r3d1bruh', './socials/x.webp'],
      ['LinkedIn', 'https://linkedin.com/in/r3d1bruh', './socials/linkedin.webp'],
      ['Telegram', 'https://telegram.org', 'https://cdn.simpleicons.org/telegram/26A5E4'],
      ['WhatsApp', 'https://www.whatsapp.com', 'https://cdn.simpleicons.org/whatsapp/25D366'],
      ['Facebook', 'https://www.facebook.com', 'https://cdn.simpleicons.org/facebook/1877F2']
    ],
    gaming: [
      ['Steam', 'https://steamcommunity.com/id/r3d1bruh', './socials/steam.webp'],
      ['Xbox', 'https://www.xbox.com', 'https://cdn.simpleicons.org/xbox/107C10'],
      ['Riot Games', 'https://www.riotgames.com', 'https://cdn.simpleicons.org/riotgames/D32936'],
      ['Epic Games', 'https://store.epicgames.com', 'https://cdn.simpleicons.org/epicgames/FFFFFF'],
      ['itch.io', 'https://itch.io', 'https://cdn.simpleicons.org/itchdotio/FA5C5C'],
      ['Ubisoft Connect', 'https://ubisoftconnect.com', 'https://cdn.simpleicons.org/ubisoft/FFFFFF'],
      ['EA', 'https://www.ea.com', 'https://cdn.simpleicons.org/ea/FFFFFF'],
      ['GOG', 'https://www.gog.com', 'https://cdn.simpleicons.org/gogdotcom/86328A']
    ],
    'ai-tech': [
      ['Hugging Face', 'https://huggingface.co', 'https://cdn.simpleicons.org/huggingface/FFD21E']
    ]
  };

  categories.all = [
    ...categories.social.slice(0, 2),
    ...categories.gaming.slice(0, 1),
    ...categories.social.slice(2),
    ...categories['ai-tech'],
    ...categories.gaming.slice(1)
  ];

  const labels = { all: 'All links', social: 'Social links', gaming: 'Gaming links', 'ai-tech': 'AI and tech links' };
  const iconScale = { Steam: 'icon--wide', 'Riot Games': 'icon--small', 'Epic Games': 'icon--small', EA: 'icon--small', GOG: 'icon--small' };
  const grid = document.querySelector('.link-exchange-grid');
  const buttons = Array.from(document.querySelectorAll('[data-link-category]'));
  if (!grid || !buttons.length) return;

  function renderCategory(category) {
    const links = categories[category] || categories.social;
    const fragment = document.createDocumentFragment();

    links.forEach(([name, href, image]) => {
      const tile = document.createElement('a');
      tile.className = 'social-tile';
      tile.href = href;
      tile.title = name;
      tile.setAttribute('aria-label', `Open ${name}`);
      if (href.startsWith('http')) {
        tile.target = '_blank';
        tile.rel = 'noopener noreferrer';
      }

      const frame = document.createElement('span');
      frame.className = 'icon-frame';
      const icon = document.createElement('img');
      icon.src = image;
      icon.alt = name;
      icon.width = 94;
      icon.height = 88;
      icon.loading = 'lazy';
      icon.decoding = 'async';
      icon.className = iconScale[name] || 'icon--large';
      icon.addEventListener('error', () => {
        frame.replaceChildren();
        const fallback = document.createElement('span');
        fallback.className = 'icon-fallback';
        fallback.textContent = name.slice(0, 2).toUpperCase();
        fallback.setAttribute('aria-hidden', 'true');
        frame.appendChild(fallback);
      }, { once: true });

      const label = document.createElement('span');
      label.className = 'badge-label';
      label.textContent = name;

      frame.appendChild(icon);
      tile.appendChild(frame);
      tile.appendChild(label);
      fragment.appendChild(tile);
    });

    grid.replaceChildren(fragment);
    grid.setAttribute('aria-label', labels[category] || labels.social);
    buttons.forEach((button) => {
      const active = button.dataset.linkCategory === category;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => renderCategory(button.dataset.linkCategory));
  });

  renderCategory('social');
})();
