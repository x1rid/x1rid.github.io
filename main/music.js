(() => {
  const MUSIC_PLAYLIST_ID = 'PLXbhJXW-l2ww';
  const MUSIC_START_VIDEO = 'mGgMZpGYiy8';
  const preferenceKey = 'r3d1bruh:music-enabled';
  const panel = document.querySelector('.music-panel');
  if (!panel) return;

  const toggle = panel.querySelector('.music-toggle');
  const title = panel.querySelector('.music-now-playing');
  const link = panel.querySelector('.music-link');
  const playerHost = panel.querySelector('#music-player');
  let player = null;
  let playlist = [];
  let lastTrackIndex = -1;
  let enabled = false;
  let fadeTimer = null;

  function setStatus(text) { title.textContent = text; }
  function setToggle(value) {
    enabled = value;
    toggle.textContent = enabled ? 'ON' : 'OFF';
    toggle.classList.toggle('is-on', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    try { localStorage.setItem(preferenceKey, String(enabled)); } catch (error) {}
  }
  function updateTrackDetails() {
    if (!player || typeof player.getVideoData !== 'function') return;
    const data = player.getVideoData();
    if (!data || !data.video_id) return;
    setStatus(`NOW PLAYING: ${data.title || 'YouTube Music playlist'}`);
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(data.video_id)}&list=${MUSIC_PLAYLIST_ID}`;
  }
  function fadeIn() {
    if (!player) return;
    if (fadeTimer) clearInterval(fadeTimer);
    let volume = 0;
    player.setVolume(volume);
    fadeTimer = setInterval(() => {
      volume = Math.min(15, volume + 1);
      player.setVolume(volume);
      if (volume >= 15) { clearInterval(fadeTimer); fadeTimer = null; }
    }, 220);
  }
  function chooseTrack() {
    if (!player || !playlist.length) return;
    let next = Math.floor(Math.random() * playlist.length);
    if (playlist.length > 1 && next === lastTrackIndex) next = (next + 1) % playlist.length;
    lastTrackIndex = next;
    player.loadVideoById(playlist[next]);
  }
  function playMusic() {
    if (!player) return;
    player.unMute();
    player.playVideo();
    fadeIn();
  }
  function createPlayer() {
    if (player || !window.YT || !window.YT.Player) return;
    player = new window.YT.Player(playerHost, {
      width: '1', height: '1', videoId: MUSIC_START_VIDEO,
      playerVars: { autoplay: 0, controls: 0, listType: 'playlist', list: MUSIC_PLAYLIST_ID, playsinline: 1, rel: 0 },
      events: {
        onReady: () => {
          playlist = player.getPlaylist() || [MUSIC_START_VIDEO];
          if (enabled) { chooseTrack(); playMusic(); } else setStatus('NOW PLAYING: Music ready');
        },
        onStateChange: (event) => {
          if (event.data === window.YT.PlayerState.ENDED && enabled) chooseTrack();
          if (event.data === window.YT.PlayerState.PLAYING) updateTrackDetails();
        },
        onError: () => setStatus('MUSIC: UNAVAILABLE')
      }
    });
  }
  window.onYouTubeIframeAPIReady = createPlayer;
  const apiScript = document.createElement('script');
  apiScript.src = 'https://www.youtube.com/iframe_api';
  apiScript.async = true;
  apiScript.onerror = () => setStatus('MUSIC: OFFLINE');
  document.head.appendChild(apiScript);
  try { enabled = localStorage.getItem(preferenceKey) === 'true'; } catch (error) {}
  setToggle(enabled);
  if (!enabled) setStatus('NOW PLAYING: Music ready');
  toggle.addEventListener('click', () => {
    setToggle(!enabled);
    if (enabled) {
      if (player) playMusic();
      else setStatus('MUSIC READY - CLICK TO START');
    } else if (player) {
      player.pauseVideo();
      if (fadeTimer) clearInterval(fadeTimer);
      setStatus('NOW PLAYING: Music paused');
    }
  });
})();
