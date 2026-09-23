(function() {
  if (!window.matchMedia) return;
  const mq = window.matchMedia('(max-width:760px)');
  if (!mq.matches) return;

  const webpagesList = document.getElementById('webpages-list');
  if (!webpagesList) return;

  const contentTitle = document.querySelector('.content-area > .section-title');
  if (contentTitle && !document.getElementById('mobile-link-exchange-title')) {
    contentTitle.id = 'mobile-link-exchange-title';
    const sidebar = document.querySelector('.sidebar');
    const sidebarBrand = sidebar ? sidebar.querySelector('.sidebar-brand') : null;

    contentTitle.innerHTML = '<span class="dropdown-triangle dropdown-triangle-left">▸</span><span class="dropdown-label">LINK EXCHANGE</span><span class="dropdown-triangle dropdown-triangle-right">▸</span>';

    if (sidebarBrand && sidebarBrand.parentNode) sidebarBrand.parentNode.insertBefore(contentTitle, sidebarBrand.nextSibling);
  }

  const title = document.getElementById('mobile-link-exchange-title');
  const originalNav = document.querySelector('.sidebar > .stats-box > .sidebar-nav:first-of-type');

  function setLinkExchangeTitleLabel(label) {
    if (!title) return;
    const labelNode = title.querySelector('.dropdown-label');
    if (labelNode) {
      labelNode.textContent = label;
    }
  }

  function setMobileHeaderCollapsed(collapsed) {
    document.body.classList.toggle('mobile-header-collapsed', collapsed);
  }

  if (title && originalNav && !document.getElementById('mobile-nav-dropdown')) {
    originalNav.style.display = 'none';
    setMobileHeaderCollapsed(false);

    const dropdown = document.createElement('div');
    dropdown.id = 'mobile-nav-dropdown';
    let autoCollapseTimer = null;

    const navClone = originalNav.cloneNode(true);
    navClone.style.display = 'flex';

    const navButtons = navClone.querySelectorAll('button');
    navButtons.forEach((button) => {
      if (button.id) {
        button.dataset.paneTarget = button.id;
        button.id = `mobile-${button.id}`;
      }
    });

    function setMobileNavActive(paneTarget) {
      const mobileBtns = document.querySelectorAll('#mobile-nav-dropdown .sidebar-nav button');
      mobileBtns.forEach((b) => {
        if (b.dataset.paneTarget === paneTarget) b.classList.add('active');
        else b.classList.remove('active');
      });
    }

    function closeMobileDropdown() {
      title.classList.remove('open');
      dropdown.classList.remove('open');
      if (autoCollapseTimer) {
        clearTimeout(autoCollapseTimer);
        autoCollapseTimer = null;
      }
    }

    navButtons.forEach((button) => {
      if (button.dataset.paneTarget === 'nav-pc-specs') {
        button.innerHTML = '<span class="nav-prompt" aria-hidden="true">&gt;</span>PC CONFIG';
      }
    });

    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (typeof window.showPane === 'function') {
          if (button.dataset.paneTarget === 'nav-link-exchange') {
            window.showPane('link');
            setLinkExchangeTitleLabel('LINK EXCHANGE');
            setMobileHeaderCollapsed(false);
            setMobileNavActive(button.dataset.paneTarget);
          } else if (button.dataset.paneTarget === 'nav-pc-specs') {
            window.showPane('pc');
            setMobileHeaderCollapsed(true);
            if (typeof window.runNeofetchIfNeeded === 'function') {
              window.runNeofetchIfNeeded();
            }
            setTimeout(() => setLinkExchangeTitleLabel('PC CONFIG'), 160);
            setMobileNavActive(button.dataset.paneTarget);
          } else if (button.dataset.paneTarget === 'nav-game-stats') {
            window.showPane('game-stats');
            setMobileHeaderCollapsed(true);
            setTimeout(() => setLinkExchangeTitleLabel('VIDEO GAME STATS'), 160);
            setMobileNavActive(button.dataset.paneTarget);
          }
        }

        closeMobileDropdown();
      });
    });

    requestAnimationFrame(() => {
      title.classList.add('open');
      dropdown.classList.add('open');
      autoCollapseTimer = window.setTimeout(() => {
        closeMobileDropdown();
      }, 1100);
    });

    dropdown.appendChild(navClone);

    title.parentNode.insertBefore(dropdown, title.nextSibling);

    title.addEventListener('click', () => {
      const isOpen = title.classList.toggle('open');
      dropdown.classList.toggle('open', isOpen);
    });
  }

})();

// Global handlers: staggered banner animation, copy-badge clicks, and theme toggle persistence
document.addEventListener('DOMContentLoaded', () => {
  // no per-badge copy handlers (removed per user request)

  // Randomize color theme on load using provided palettes
  const palettes = [
    { name: 'neon-grape', profileColor: '#ffffff', vars: { '--dr-bg':'#12072b','--dr-panel':'#240e54','--dr-text':'#ffffff','--dr-accent':'#ff007f','--dr-link':'#7bf1a8' } },
    { name: 'tokyo-arcade', profileColor: '#e0fbfc', vars: { '--dr-bg':'#090514','--dr-panel':'#180f30','--dr-text':'#e0fbfc','--dr-accent':'#bc00dd','--dr-link':'#bc00dd' } },
    { name: 'acid-plum', profileColor: '#f5e6ff', vars: { '--dr-bg':'#1a0022','--dr-panel':'#330044','--dr-text':'#f5e6ff','--dr-accent':'#ccff00','--dr-link':'#ccff00' } },
    { name: 'heather-haze', profileColor: '#f4f1f4', vars: { '--dr-bg':'#231f20','--dr-panel':'#3d353e','--dr-text':'#f4f1f4','--dr-accent':'#bda2bf','--dr-link':'#bda2bf' } },
    { name: 'thistle-down', profileColor: '#322a36', vars: { '--dr-bg':'#f4f0f6','--dr-panel':'#ffffff','--dr-text':'#322a36','--dr-accent':'#937b99','--dr-link':'#937b99' } },
    { name: 'mulberry-grove', profileColor: '#fff0fa', vars: { '--dr-bg':'#1f0b18','--dr-panel':'#3d1a33','--dr-text':'#fff0fa','--dr-accent':'#d65aaa','--dr-link':'#d65aaa' } },
    { name: 'abyssal-orchid', profileColor: '#cbd5e1', vars: { '--dr-bg':'#05020a','--dr-panel':'#110b1c','--dr-text':'#cbd5e1','--dr-accent':'#a855f7','--dr-link':'#a855f7' } },
    { name: 'phantom-fuchsia', profileColor: '#e2e8f0', vars: { '--dr-bg':'#0d0b18','--dr-panel':'#1b172e','--dr-text':'#e2e8f0','--dr-accent':'#f43f5e','--dr-link':'#f43f5e' } },
    { name: 'cosmic-dust', profileColor: '#f8fafc', vars: { '--dr-bg':'#0c0714','--dr-panel':'#1a1228','--dr-text':'#f8fafc','--dr-accent':'#c084fc','--dr-link':'#c084fc' } },
    { name: 'boysenberry-twist', profileColor: '#3b0764', vars: { '--dr-bg':'#faf5ff','--dr-panel':'#f3e8ff','--dr-text':'#3b0764','--dr-accent':'#d946ef','--dr-link':'#d946ef' } }
  ];
  try {
    const pick = palettes[Math.floor(Math.random() * palettes.length)];
    Object.entries(pick.vars).forEach(([k,v]) => document.documentElement.style.setProperty(k, v));
    // set profile color variable for distinct name color
    try {
      if (pick.profileColor) document.documentElement.style.setProperty('--profile-color', pick.profileColor);
    } catch (e) {}
  } catch (e) { /* ignore */ }
  // theme toggle UI removed; keep only random palette application above
});
