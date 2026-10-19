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
    }

    navButtons.forEach((button) => {
      button.addEventListener('click', () => {
        if (typeof window.showPane !== 'function') return;

        if (button.dataset.paneTarget === 'nav-link-exchange') {
          window.showPane('link');
          setLinkExchangeTitleLabel('LINK EXCHANGE');
          setMobileHeaderCollapsed(false);
        } else if (button.dataset.paneTarget === 'nav-pc-specs') {
          window.showPane('pc');
          setMobileHeaderCollapsed(true);
          if (typeof window.runNeofetchIfNeeded === 'function') {
            window.runNeofetchIfNeeded();
          }
          setLinkExchangeTitleLabel('NEOFETCH');
        }

        setMobileNavActive(button.dataset.paneTarget);
        closeMobileDropdown();
      });
    });

    dropdown.appendChild(navClone);
    title.parentNode.insertBefore(dropdown, title.nextSibling);

    title.addEventListener('click', () => {
      const isOpen = title.classList.toggle('open');
      dropdown.classList.toggle('open', isOpen);
    });
  }

})();
