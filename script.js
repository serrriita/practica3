

const PlayerState = Object.freeze({
  IDLE:    'IDLE',
  LOADING: 'LOADING',
  READY:   'READY',
  PLAYING: 'PLAYING',
  PAUSED:  'PAUSED',
  SEEKING: 'SEEKING',
  ENDED:   'ENDED',
  ERROR:   'ERROR'
});

const PlayerCore = (() => {
  let _state = PlayerState.IDLE;
  const _listeners = {};

  function getState() { return _state; }

  function setState(newState) {
    if (_state === newState) return;
    console.log(`[PlayerCore] ${_state} → ${newState}`);
    _state = newState;
    emit('statechange', newState);
  }

  function on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  function emit(event, data) {
    (_listeners[event] || []).forEach(fn => fn(data));
  }

  // Acciones públicas del core
  function play(video) {
    if (_state === PlayerState.ERROR) return;
    video.play().catch(err => {
      console.error('[PlayerCore] play() error:', err);
    });
  }

  function pause(video) {
    video.pause();
  }

  function seek(video, seconds) {
    if (!video.duration || !isFinite(seconds)) return;
    video.currentTime = Math.max(0, Math.min(seconds, video.duration));
  }

  function setVolume(video, val) {
    video.volume = Math.max(0, Math.min(1, parseFloat(val)));
  }

  function setSpeed(video, val) {
    video.playbackRate = parseFloat(val);
  }

  function getMetrics(video) {
    return {
      currentTime:  video.currentTime,
      duration:     video.duration,
      buffered:     video.buffered,
      readyState:   video.readyState,
      networkState: video.networkState,
      videoWidth:   video.videoWidth,
      videoHeight:  video.videoHeight
    };
  }

  return { getState, setState, on, emit, play, pause, seek, setVolume, setSpeed, getMetrics };
})();





const SemanticEngine = (() => {
  let _goalsData = [];
  let _currentIndex = -1;
  let _overlayVisible = false;

  // Dispatcher de acciones semánticas

  const actionHandlers = {
    'show_goal_data': (data) => {
      UILayer.renderGoal(data);
      showOverlay(data);
    },
    'show_overlay': (data) => {
      showOverlay(data);
    },
    'hide_overlay': (_data) => {
      hideOverlay();
    },
    'pause': (_data, video) => {
      PlayerCore.pause(video);
      console.log('[SemanticEngine] Acción: pause disparada por cue metadata');
    },
    'seek': (data, video) => {
      if (data.payload && data.payload.seekTo !== undefined) {
        PlayerCore.seek(video, data.payload.seekTo);
        console.log(`[SemanticEngine] Acción: seek a ${data.payload.seekTo}s`);
      }
    },
    'highlight': (data) => {
      console.log('[SemanticEngine] Acción: highlight →', data.payload);
    }
  };

  function showOverlay(data) {
    const overlay = document.getElementById('semantic-overlay');
    if (!overlay || !data.payload) return;
    const p = data.payload;
    overlay.innerHTML = `
      <div class="sem-overlay-inner">
        <span class="sem-flag">${p.playerFlag || '⚽'}</span>
        <span class="sem-player">${p.player || ''}</span>
        <span class="sem-event">⚽ GOL — Min. ${p.videoMinute || ''}</span>
        <span class="sem-result">${p.homeTeam || ''} ${p.result || ''} ${p.awayTeam || ''}</span>
      </div>`;
    overlay.classList.add('visible');
    _overlayVisible = true;

    // Auto-hide tras 3 segundos
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => hideOverlay(), 3000);
  }

  function hideOverlay() {
    const overlay = document.getElementById('semantic-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    _overlayVisible = false;
  }

  // Limpieza semántica: se llama en pause, ended y seeked
  function cleanup() {
    hideOverlay();
    console.log('[SemanticEngine] cleanup: estado semántico limpiado');
  }

  function dispatch(cueData, video) {
    const action = cueData.action;
    if (!action) return;

    const handler = actionHandlers[action];
    if (handler) {
      console.log(`[SemanticEngine] dispatch → action="${action}" id="${cueData.id}"`);
      handler(cueData, video);
    } else {
      console.warn(`[SemanticEngine] Acción desconocida: "${action}"`);
    }
  }

  function init(metadataTrackEl, video, onReady) {
    const track = metadataTrackEl.track;
    track.mode = 'hidden';

    function loadCues() {
      if (!track.cues || track.cues.length === 0) {
        console.error('[SemanticEngine] metadata.vtt sin cues. ¿Servidor HTTP activo con MIME text/vtt?');
        return;
      }

      _goalsData = Array.from(track.cues).map(cue => {
        try { return JSON.parse(cue.text); }
        catch (e) { console.error('[SemanticEngine] Cue JSON inválido:', cue.text, e); return null; }
      }).filter(Boolean);

      console.log(`[SemanticEngine] ${_goalsData.length} cues cargados desde metadata.vtt`);

      if (_goalsData.length > 0) {
        _currentIndex = 0;
        if (typeof onReady === 'function') onReady(_goalsData[0]);
      }
    }

    // Polling: espera hasta que el track tenga cues cargados
    
    let _pollAttempts = 0;
    function pollCues() {
      _pollAttempts++;
      if (track.cues && track.cues.length > 0) {
        loadCues();
      } else if (_pollAttempts < 30) {
        // Reintentar cada 200ms hasta 6 segundos en total
        setTimeout(pollCues, 200);
      } else {
        console.error('[SemanticEngine] No se encontraron cues tras 6s. Revisa que metadata.vtt se sirve como text/vtt y que la ruta vtt/metadata.vtt es correcta.');
      }
    }
    pollCues();

    
    track.addEventListener('cuechange', () => {
      const cue = track.activeCues[0];
      if (!cue) return;

      try {
        const data = JSON.parse(cue.text);
        const idx = _goalsData.findIndex(g => g.id === data.id);
        if (idx !== -1) _currentIndex = idx;

        dispatch(data, video);
      } catch (e) {
        console.error('[SemanticEngine] Error en cuechange:', e);
      }
    });
  }

  function getGoals()        { return _goalsData; }
  function getCurrentIndex() { return _currentIndex; }
  function setCurrentIndex(i){ _currentIndex = i; }

  return { init, dispatch, cleanup, getGoals, getCurrentIndex, setCurrentIndex };
})();




const MSEEngine = (() => {
  let _mediaSource = null;
  let _sourceBuffer = null;
  let _segmentQueue = [];
  let _isAppending  = false;
  let _objectURL    = null;

  // Comprueba soporte de MediaSource en el navegador
  function isSupported() {
    return 'MediaSource' in window;
  }

  // Limpia una instancia anterior
  function destroy(video) {
    if (_objectURL) {
      URL.revokeObjectURL(_objectURL);
      _objectURL = null;
    }
    if (_mediaSource && _mediaSource.readyState !== 'closed') {
      try { _mediaSource.endOfStream(); } catch(_) {}
    }
    _mediaSource  = null;
    _sourceBuffer = null;
    _segmentQueue = [];
    _isAppending  = false;
    video.removeAttribute('src');
    video.load();
    console.log('[MSEEngine] instancia destruida');
  }

  // Descarga un segmento como ArrayBuffer
  async function fetchSegment(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`[MSEEngine] Error HTTP ${response.status} al cargar: ${url}`);
    return response.arrayBuffer();
  }

  // Añade un ArrayBuffer a la cola de append
  function enqueue(buffer) {
    _segmentQueue.push(buffer);
    processQueue();
  }

  // Procesa la cola respetando sourceBuffer.updating
  function processQueue() {
    if (_isAppending || !_sourceBuffer || _sourceBuffer.updating || _segmentQueue.length === 0) return;
    _isAppending = true;
    const buf = _segmentQueue.shift();
    try {
      _sourceBuffer.appendBuffer(buf);
    } catch (e) {
      console.error('[MSEEngine] appendBuffer error:', e);
      _isAppending = false;
    }
  }

  /**
   * Inicializa la pipeline MSE y empieza a reproducir contenido fMP4.
   * @param {HTMLVideoElement} video
   * @param {string} mimeCodec  p.ej. 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
   * @param {string} initUrl    URL del segmento de inicialización (fMP4 init)
   * @param {string[]} segUrls  Array de URLs de media segments
   */
  function load(video, mimeCodec, initUrl, segUrls) {
    if (!isSupported()) {
      console.error('[MSEEngine] MediaSource no soportado en este navegador');
      PlayerCore.setState(PlayerState.ERROR);
      UILayer.showError('Tu navegador no soporta MediaSource Extensions (MSE).');
      return;
    }

    if (!MediaSource.isTypeSupported(mimeCodec)) {
      console.error(`[MSEEngine] mimeCodec no soportado: ${mimeCodec}`);
      PlayerCore.setState(PlayerState.ERROR);
      UILayer.showError(`Códec no soportado: ${mimeCodec}`);
      return;
    }

    destroy(video);
    PlayerCore.setState(PlayerState.LOADING);

    _mediaSource = new MediaSource();
    _objectURL   = URL.createObjectURL(_mediaSource);
    video.src    = _objectURL;

    _mediaSource.addEventListener('sourceopen', async () => {
      console.log('[MSEEngine] sourceopen — MediaSource listo');

      try {
        _sourceBuffer = _mediaSource.addSourceBuffer(mimeCodec);

        _sourceBuffer.addEventListener('updateend', () => {
          _isAppending = false;
          logBuffered(video);
          processQueue();

          // Cuando la cola está vacía y hemos terminado, llamar endOfStream
          if (_segmentQueue.length === 0 && _sourceBuffer && !_sourceBuffer.updating) {
            if (_mediaSource.readyState === 'open') {
              try {
                _mediaSource.endOfStream();
                console.log('[MSEEngine] endOfStream() llamado');
              } catch(e) {
                console.warn('[MSEEngine] endOfStream error:', e);
              }
            }
          }
        });

        _sourceBuffer.addEventListener('error', (e) => {
          console.error('[MSEEngine] SourceBuffer error:', e);
          PlayerCore.setState(PlayerState.ERROR);
          UILayer.showError('Error en el buffer MSE. Revisa los segmentos fMP4.');
        });

        // 1. Descargar y append el init segment
        console.log('[MSEEngine] Cargando init segment:', initUrl);
        const initBuf = await fetchSegment(initUrl);
        enqueue(initBuf);

        // 2. Descargar y encolar segmentos secuencialmente
        for (const segUrl of segUrls) {
          console.log('[MSEEngine] Cargando segmento:', segUrl);
          const segBuf = await fetchSegment(segUrl);
          enqueue(segBuf);
        }

      } catch (err) {
        console.error('[MSEEngine] Pipeline error:', err);
        PlayerCore.setState(PlayerState.ERROR);
        UILayer.showError('Error en la pipeline MSE: ' + err.message);
      }
    });

    _mediaSource.addEventListener('sourceended', () => {
      console.log('[MSEEngine] sourceended');
    });

    _mediaSource.addEventListener('sourceclose', () => {
      console.log('[MSEEngine] sourceclose');
    });
  }

  // Log informativo del rango buffered (para depuración)
  function logBuffered(video) {
    if (!video.buffered || video.buffered.length === 0) return;
    let ranges = '';
    for (let i = 0; i < video.buffered.length; i++) {
      ranges += `[${video.buffered.start(i).toFixed(2)}s – ${video.buffered.end(i).toFixed(2)}s] `;
    }
    console.log('[MSEEngine] buffered:', ranges.trim());
  }

  return { isSupported, load, destroy, logBuffered };
})();



   //4. UI LAYER — Referencias DOM, controles y rendering


const UILayer = (() => {

  // — Elementos DOM —
  const video          = document.getElementById('main-video');
  const playBtn        = document.getElementById('play-btn');
  const progFill       = document.getElementById('progress-fill');
  const progWrap       = document.getElementById('progress-wrap');
  const timeCur        = document.getElementById('time-cur');
  const timeDur        = document.getElementById('time-dur');
  const dropOv         = document.getElementById('drop-overlay');
  const expandBtn      = document.getElementById('expand-btn');
  const fileInput      = document.getElementById('file-input');
  const videoWrap      = document.getElementById('video-wrap');
  const speedSelect    = document.getElementById('speed-select');
  const qualitySelect  = document.getElementById('quality-select');
  const volSlider      = document.getElementById('vol-slider');
  const chooseFileBtn  = document.getElementById('choose-file-btn');
  const loadUrlBtn     = document.getElementById('load-url-btn');
  const subtitleSelect = document.getElementById('subtitle-select');
  const metadataTrackEl= document.getElementById('metadata-track');
  const speedDisplay   = document.getElementById('speed-display');

  let hlsInst  = null;
  let dashInst = null;

  const sources = {
    '4k':       'videos/video_4k.mp4',
    '1080p':    'videos/video_1080p.mp4',
    '720p':     'videos/video_720p.mp4',
    '360p':     'videos/video_360p.mp4',
    'auto-hls': 'videos/hls/master.m3u8',
    'auto-dash':'videos/dash/manifest.mpd'
  };

  // Configuración MSE — ajusta mimeCodec, initUrl y segUrls a tus archivos reales
  const MSE_CONFIG = {
    mimeCodec: 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
    initUrl:   'videos/fmp4/init.mp4',
    segUrls: [
      'videos/fmp4/seg-001.m4s',
      'videos/fmp4/seg-002.m4s',
      'videos/fmp4/seg-003.m4s',
      'videos/fmp4/seg-004.m4s',
      'videos/fmp4/seg-005.m4s'
    ]
  };

  // Utilidades

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m   = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function showError(msg) {
    const wrap = document.getElementById('video-wrap');
    let errDiv = document.getElementById('player-error');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.id = 'player-error';
      errDiv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(7,11,16,.9);z-index:30;font-family:var(--font-mono);font-size:.72rem;color:var(--accent2);text-align:center;padding:20px;';
      wrap.appendChild(errDiv);
    }
    errDiv.textContent = '⚠ ' + msg;
    errDiv.style.display = 'flex';
    console.error('[UILayer] Error mostrado al usuario:', msg);
  }

  function clearError() {
    const errDiv = document.getElementById('player-error');
    if (errDiv) errDiv.style.display = 'none';
  }

  // Adaptive streaming helpers
  function destroyAdaptive() {
    if (hlsInst)  { hlsInst.destroy();  hlsInst  = null; }
    if (dashInst) { dashInst.reset();   dashInst = null; }

    // Limpiar textTracks para evitar cues duplicados
  
    try {
      const tracks = video.textTracks;
      for (let i = tracks.length - 1; i >= 0; i--) {
        const t = tracks[i];
        if (t.kind === 'metadata' || t.kind === 'chapters') continue;
        try {
          t.mode = 'disabled';
          if (t.cues && t.cues.length) {
            Array.from(t.cues).forEach(c => { try { t.removeCue(c); } catch(_) {} });
          }
        } catch(_) {}
      }
    } catch(e) { console.warn('[UILayer] No se pudieron limpiar textTracks:', e); }

    video.removeAttribute('src');
    video.load();
  }

  function loadMP4(src, isInitialLoad = false) {
    const savedTime = video.currentTime || 0;
    const wasPaused = video.paused;

    if (!isInitialLoad) destroyAdaptive();
    PlayerCore.setState(PlayerState.LOADING);
    clearError();

    video.src = src;
    video.load();

    video.addEventListener('loadedmetadata', () => {
      if (!isInitialLoad && savedTime > 0 && savedTime < video.duration) {
        video.currentTime = savedTime;
      }
      video.style.visibility  = 'visible';
      dropOv.style.display    = 'none';
      expandBtn.style.display = 'flex';
      setTimeout(() => updateSubtitles(subtitleSelect.value), 200);
      if (!isInitialLoad && !wasPaused) video.play();
    }, { once: true });
  }

  function loadHLS(src) {
    const savedTime = video.currentTime || 0;
    const wasPaused = video.paused;

    destroyAdaptive();
    PlayerCore.setState(PlayerState.LOADING);
    clearError();
    video.style.visibility = 'hidden';

    if (window.Hls && Hls.isSupported()) {
      hlsInst = new Hls();
      hlsInst.loadSource(src);
      hlsInst.attachMedia(video);

      hlsInst.on(Hls.Events.MANIFEST_PARSED, () => {
        dropOv.style.display    = 'none';
        expandBtn.style.display = 'flex';
      });

      video.addEventListener('loadedmetadata', () => {
        if (savedTime > 0 && savedTime < video.duration) {
          video.currentTime = savedTime;
        }
        setTimeout(() => updateSubtitles(subtitleSelect.value), 200);
      }, { once: true });

      video.addEventListener('seeked', () => {
        video.style.visibility = 'visible';
        if (!wasPaused) video.play();
      }, { once: true });

      hlsInst.on(Hls.Events.ERROR, (event, data) => {
        console.error('[UILayer] HLS Error:', data);
        if (data.fatal) {
          PlayerCore.setState(PlayerState.ERROR);
          showError('Error fatal HLS: ' + data.type);
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      video.addEventListener('loadedmetadata', () => {
        if (savedTime > 0 && savedTime < video.duration) video.currentTime = savedTime;
        dropOv.style.display    = 'none';
        expandBtn.style.display = 'flex';
        video.style.visibility  = 'visible';
        setTimeout(() => updateSubtitles(subtitleSelect.value), 200);
        if (!wasPaused) video.play();
      }, { once: true });
    } else {
      PlayerCore.setState(PlayerState.ERROR);
      showError('Este navegador no soporta HLS.');
    }
  }

  function loadDASH(src) {
    const savedTime = video.currentTime || 0;
    const wasPaused = video.paused;

    destroyAdaptive();
    PlayerCore.setState(PlayerState.LOADING);
    clearError();

    if (typeof dashjs !== 'undefined') {
      dashInst = dashjs.MediaPlayer().create();
      dashInst.initialize(video, src, false);

      video.addEventListener('loadedmetadata', () => {
        if (savedTime > 0 && savedTime < video.duration) video.currentTime = savedTime;
        video.style.visibility  = 'visible';
        dropOv.style.display    = 'none';
        expandBtn.style.display = 'flex';
        if (!wasPaused) video.play();
      }, { once: true });
    } else {
      PlayerCore.setState(PlayerState.ERROR);
      showError('No se ha cargado DASH.js.');
    }
  }

  function loadMSE() {
    destroyAdaptive();
    clearError();
    MSEEngine.load(video, MSE_CONFIG.mimeCodec, MSE_CONFIG.initUrl, MSE_CONFIG.segUrls);
    dropOv.style.display    = 'none';
    expandBtn.style.display = 'flex';
  }

  function changeQuality(val) {
    if      (val === 'auto-hls')  loadHLS(sources['auto-hls']);
    else if (val === 'auto-dash') loadDASH(sources['auto-dash']);
    else if (val === 'mse')       loadMSE();
    else                          loadMP4(sources[val]);
  }

  // Subtítulos

  function updateSubtitles(lang) {
    // Desactivar todos los tracks de subtítulos / captions existentes
    Array.from(video.textTracks).forEach(t => {
      if (t.kind === 'subtitles' || t.kind === 'captions') {
        t.mode = 'disabled';
      }
    });

    if (lang === 'off') return;

    let found = false;
    Array.from(video.textTracks).forEach(t => {
      if ((t.kind === 'subtitles' || t.kind === 'captions') && t.language === lang) {
        t.mode = 'showing';
        found = true;
      }
    });

    if (found) return;

    // Sólo eliminar tracks dinámicos previos, no los declarados en HTML
    Array.from(video.querySelectorAll("track[kind='subtitles'][data-dynamic]"))
      .forEach(t => t.remove());

    const track = document.createElement('track');
    track.kind      = 'subtitles';
    track.label     = lang === 'es' ? 'Español' : 'English';
    track.srclang   = lang;
    track.src       = lang === 'es' ? 'vtt/subtitles_es.vtt' : 'vtt/subtitles_en.vtt';
    track.dataset.dynamic = '1';
    video.appendChild(track);

    track.track.mode = 'showing';
    track.addEventListener('load', () => {
      track.track.mode = 'showing';
    }, { once: true });
  }

  // Rendering del gol activo

  function renderGoal(goal) {
    if (!goal || !goal.payload) return;
    const p = goal.payload;

    // — Panel partido —
    setText('match-home-team', p.homeTeam);
    setText('match-away-team', p.awayTeam);
    setText('match-home-label', p.homeLabel);
    setText('match-away-label', p.awayLabel);
    setText('score-display', p.result);
    setText('score-min', `Min. ${p.videoMinute}`);
    setText('match-stadium', p.stadium);
    setText('match-date', p.date);
    setText('match-referee', p.referee);
    setText('match-attendance', p.attendance);

    // — Panel competición —
    setText('competition-name', p.competition);
    setText('competition-country', p.competitionCountry);
    setText('competition-round', p.competitionRound);
    setText('competition-season', p.competitionSeason);

    // — Panel goleador —
    setText('player-avatar', p.playerFlag);
    setText('player-number', p.playerNumber);
    const nameEl = document.getElementById('player-name');
    if (nameEl) nameEl.innerHTML = p.player.replace(' ', '<br>');
    setText('player-role', `${p.playerPosition} · ${p.playerTeam}`);
    setText('player-badge', `Gol · ${p.videoMinute}`);

    const statsGrid = document.getElementById('player-stats-grid');
    if (statsGrid) {
      statsGrid.innerHTML = p.playerStats.map(s => `
        <div class="pstat">
          <span class="val">${s.value}</span>
          <span class="lbl">${s.label}</span>
        </div>`).join('');
    }

    const compStats = document.getElementById('competition-stats');
    if (compStats) {
      compStats.innerHTML = p.competitionStats.map(s => `
        <div class="stat-row">
          <span class="stat-label">${s.label}</span>
          <span class="stat-value acc">${s.value}</span>
        </div>`).join('');
    }

    // — Lista de goles del partido —
    const goalsList = document.getElementById('goals-list');
    if (goalsList) {
      goalsList.innerHTML = `
        <div class="goal-item active">
          <span class="gmin">${p.videoMinute}</span>
          <span>⚽</span>
          <span class="gname">${p.player}</span>
          <span class="gteam">${p.playerTeam}</span>
        </div>`;
    }

    // — Timeline —
    const timeline = document.getElementById('timeline');
    if (timeline) {
      timeline.innerHTML = (p.timeline || []).map(item => `
        <div class="tl-item">
          <span class="tl-min">${item.minute}</span>
          <div class="tl-dot ${item.type}"></div>
          <div class="tl-content">
            <div class="tl-event">${item.event}</div>
            <div class="tl-detail">${item.detail}</div>
          </div>
        </div>`).join('');
    }

    setText('tl-badge', p.videoMinute);

    // Flash visual en el panel del partido
    flashPanel('match-panel');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '---';
  }

  function flashPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    const flash = document.createElement('div');
    flash.className = 'goal-flash';
    panel.appendChild(flash);
    setTimeout(() => flash.remove(), 1300);
  }

  // Inicialización de paneles

  function initPanels() {
    const panels = ['match-panel', 'comp-panel', 'player-panel', 'tactical-panel', 'timeline-panel'];
    panels.forEach((id, i) => {
      setTimeout(() => {
        document.getElementById(id)?.classList.add('visible');
      }, 200 + i * 120);
    });
  }

  // Eventos del reproductor

  function bindVideoEvents() {
    video.addEventListener('loadedmetadata', () => {
      timeDur.textContent     = fmt(video.duration);
      dropOv.style.display    = 'none';
      expandBtn.style.display = 'flex';
      PlayerCore.setState(PlayerState.READY);
      clearError();
      // Activar subtítulos según el selector
      updateSubtitles(subtitleSelect.value);
      console.log(`[UILayer] loadedmetadata: ${video.videoWidth}×${video.videoHeight}, dur=${fmt(video.duration)}`);
    });

    video.addEventListener('canplay', () => {
      if (PlayerCore.getState() === PlayerState.LOADING || PlayerCore.getState() === PlayerState.READY) {
        PlayerCore.setState(PlayerState.PAUSED);
      }
    });

    video.addEventListener('play', () => {
      PlayerCore.setState(PlayerState.PLAYING);
      playBtn.textContent = '⏸';
    });

    video.addEventListener('pause', () => {
      if (PlayerCore.getState() !== PlayerState.SEEKING) {
        PlayerCore.setState(PlayerState.PAUSED);
      }
      playBtn.textContent = '▶';
      SemanticEngine.cleanup(); // limpieza semántica en pause
    });

    video.addEventListener('seeking', () => {
      PlayerCore.setState(PlayerState.SEEKING);
    });

    video.addEventListener('seeked', () => {
      PlayerCore.setState(video.paused ? PlayerState.PAUSED : PlayerState.PLAYING);
      SemanticEngine.cleanup();
      console.log(`[UILayer] seeked → ${fmt(video.currentTime)}`);
    });

    video.addEventListener('waiting', () => {
      console.log('[UILayer] waiting (buffering...)');
    });

    video.addEventListener('stalled', () => {
      console.warn('[UILayer] stalled — sin datos del servidor');
    });

    video.addEventListener('ended', () => {
      PlayerCore.setState(PlayerState.ENDED);
      playBtn.textContent = '▶';
      SemanticEngine.cleanup(); // limpieza semántica en ended
      console.log('[UILayer] vídeo finalizado');
    });

    video.addEventListener('error', () => {
      PlayerCore.setState(PlayerState.ERROR);
      const code = video.error ? video.error.code : '?';
      const msg  = video.error ? video.error.message : 'Error desconocido';
      showError(`Error de reproducción (código ${code}): ${msg}`);
      console.error('[UILayer] error del vídeo:', video.error);
    });

    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      progFill.style.width    = pct + '%';
      timeCur.textContent     = fmt(video.currentTime);

      // Sincronización por tiempo como respaldo al cuechange
      checkCurrentGoalByTime();
    });
  }

  // Navegación por goles

  function checkCurrentGoalByTime() {
    const goals = SemanticEngine.getGoals();
    if (!goals.length) return;
    const current = video.currentTime;
    const idx = goals.findIndex(g => current >= g.start && current < g.end);
    if (idx !== -1 && idx !== SemanticEngine.getCurrentIndex()) {
      SemanticEngine.setCurrentIndex(idx);
      renderGoal(goals[idx]);
    }
  }

  // Bind de controles 

  function bindControls() {
    playBtn.addEventListener('click', () => {
      if (video.paused) PlayerCore.play(video);
      else              PlayerCore.pause(video);
    });

    speedSelect.addEventListener('change', (e) => {
      PlayerCore.setSpeed(video, e.target.value);
      speedDisplay.textContent = `×${e.target.value}`;
    });

    volSlider.addEventListener('input', (e) => {
      PlayerCore.setVolume(video, e.target.value);
    });

    qualitySelect.addEventListener('change', (e) => {
      changeQuality(e.target.value);
    });

    subtitleSelect.addEventListener('change', (e) => {
      updateSubtitles(e.target.value);
    });

    // Seek en barra de progreso
    progWrap.addEventListener('click', (e) => {
      if (!video.duration) return;
      const rect  = progWrap.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      PlayerCore.seek(video, ratio * video.duration);
    });

    // Siguiente/anterior gol
    document.getElementById('next-goal-btn').addEventListener('click', () => {
      const goals = SemanticEngine.getGoals();
      const idx   = SemanticEngine.getCurrentIndex();
      if (idx < goals.length - 1) {
        SemanticEngine.setCurrentIndex(idx + 1);
        PlayerCore.seek(video, goals[idx + 1].start);
        renderGoal(goals[idx + 1]);
        PlayerCore.play(video);
      }
    });

    document.getElementById('prev-goal-btn').addEventListener('click', () => {
      const goals = SemanticEngine.getGoals();
      const idx   = SemanticEngine.getCurrentIndex();
      if (idx > 0) {
        SemanticEngine.setCurrentIndex(idx - 1);
        PlayerCore.seek(video, goals[idx - 1].start);
        renderGoal(goals[idx - 1]);
        PlayerCore.play(video);
      }
    });

    // Elegir archivo local
    chooseFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      destroyAdaptive();
      MSEEngine.destroy(video);
      video.src = URL.createObjectURL(f);
      video.load();
    });

    // Cargar URL externa
    loadUrlBtn.addEventListener('click', () => {
      const url = prompt('Introduce URL del vídeo / HLS (.m3u8) / DASH (.mpd):');
      if (!url) return;
      if      (url.includes('.m3u8')) loadHLS(url);
      else if (url.includes('.mpd'))  loadDASH(url);
      else                            loadMP4(url);
    });

    // Drag & Drop
    videoWrap.addEventListener('dragover',  (e) => {
      e.preventDefault();
      dropOv.style.background = 'rgba(0,229,255,.12)';
    });
    videoWrap.addEventListener('dragleave', () => {
      dropOv.style.background = 'rgba(7,11,16,.88)';
    });
    videoWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      dropOv.style.background = 'rgba(7,11,16,.88)';
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('video/')) {
        destroyAdaptive();
        video.src = URL.createObjectURL(f);
        video.load();
      }
    });

    // Fullscreen
    expandBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        (videoWrap.requestFullscreen || videoWrap.webkitRequestFullscreen).call(videoWrap);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }
    });
  }

  // Overlay semántico (CSS añadido dinámicamente)

  function injectOverlayCSS() {
    const style = document.createElement('style');
    style.textContent = `
      video::cue {
        background: rgba(0,0,0,0.75);
        color: white;
        font-family: 'Instrument Sans', sans-serif;
        font-size: 1rem;
        line-height: 1.4;
        text-shadow: none;
      }
      #main-video {
        /* Asegura que los cues se renderizan dentro del elemento video */
        object-fit: contain;
      }
      #semantic-overlay {
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(7,11,16,.92);
        border: 1px solid var(--accent);
        border-radius: 8px;
        padding: 10px 20px;
        font-family: var(--font-mono);
        font-size: .72rem;
        color: var(--text);
        z-index: 25;
        pointer-events: none;
        opacity: 0;
        transition: opacity .3s ease, transform .3s ease;
        white-space: nowrap;
        box-shadow: 0 0 20px rgba(0,229,255,.25);
      }
      #semantic-overlay.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .sem-overlay-inner {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sem-flag   { font-size: 1.1rem; }
      .sem-player { color: var(--accent); font-weight: 700; letter-spacing: .05em; }
      .sem-event  { color: var(--green); }
      .sem-result { color: var(--accent3); font-weight: 700; }
    `;
    document.head.appendChild(style);

    // Crear el elemento overlay
    const overlay = document.createElement('div');
    overlay.id = 'semantic-overlay';
    videoWrap.appendChild(overlay);
  }

  // Init

  function init() {
    injectOverlayCSS();
    initPanels();
    bindVideoEvents();
    bindControls();

    // Inicializar SemanticEngine ANTES de cargar el vídeo
    // para que el track de metadata no se destruya en destroyAdaptive
    SemanticEngine.init(metadataTrackEl, video, (firstGoal) => {
      renderGoal(firstGoal);
    });

    // Cargar vídeo por defecto DESPUÉS de registrar el semantic engine
    loadMP4(sources['4k'], true);

    console.log('[UILayer] inicializado. Estado MSE soportado:', MSEEngine.isSupported());
  }

  return { init, renderGoal, showError, clearError, updateSubtitles };
})();


// ARRANQUE
UILayer.init();