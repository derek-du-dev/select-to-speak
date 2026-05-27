// content.js - Injected content script for Select-to-Speak Extension

let shadowRoot = null;
let shadowContainer = null;
let componentsRoot = null;

// Global references for audio control
let activeAudio = null;
let currentSentenceIndex = -1;
let sentencesList = [];
let audioCache = {};
// Get the hardcoded API URL based on runtime environment (development or production)
function getApiUrl() {
  const isDev = !chrome.runtime.getManifest().update_url;
  const DEV_API_URL = "http://localhost:18002";
  const PROD_API_URL = "https://tts-api.dayansoft.cn"; // Enforce production address
  return isDev ? DEV_API_URL : PROD_API_URL;
}

const TRANSLATIONS = {
  zh: {
    // Floating player
    player_title: "朗读模式",
    player_back_5: "后退5秒",
    player_fwd_5: "前进5秒",
    player_generating: "生成音频中...",
    player_buffering: "缓冲中...",
    player_ready: "已就绪",
    player_playing: "播放中",
    player_fetching: "获取音频...",
    player_paused: "已暂停",
    player_finished: "播毕",
    player_failed: "获取失败",
    player_waiting: "等待播放",
    // Intensive Drawer
    drawer_title: "英语精听模式",
    drawer_subtitle: "spaCy 自动分句器 · 逐句精读训练",
    drawer_splitting: "spaCy 正在智能切分句子，请稍候...",
    drawer_loop_on: "单句循环 (开启)",
    drawer_loop_off: "单句循环 (关闭)",
    drawer_prev: "上一句",
    drawer_next: "下一句",
    drawer_replay: "重播当前句",
    drawer_curr_sentence: "第 {curr} / {total} 句",
    drawer_cache_title: "正在极速缓存语音...",
    drawer_cache_progress: "已缓存: {loaded} / {total} 句",
    drawer_cache_desc: "为了保证您极速、零延迟的精听体验，我们正在为您提前加载前 {count} 句高品质语音。",
    drawer_api_failed: "API 服务连接失败",
    drawer_api_failed_desc: "无法载入句子，请确认 apps/api FastAPI 本地后端已启动运行。",
    drawer_retry: "⚡ 立即重试"
  },
  en: {
    // Floating player
    player_title: "Reading Mode",
    player_back_5: "Back 5 seconds",
    player_fwd_5: "Forward 5 seconds",
    player_generating: "Generating...",
    player_buffering: "Buffering...",
    player_ready: "Ready",
    player_playing: "Playing",
    player_fetching: "Fetching audio...",
    player_paused: "Paused",
    player_finished: "Finished",
    player_failed: "Failed",
    player_waiting: "Waiting to play",
    // Intensive Drawer
    drawer_title: "Intensive Listening",
    drawer_subtitle: "spaCy Splitter · Sentence-by-Sentence",
    drawer_splitting: "spaCy is segmenting sentences, please wait...",
    drawer_loop_on: "Loop Sentence (On)",
    drawer_loop_off: "Loop Sentence (Off)",
    drawer_prev: "Previous Sentence",
    drawer_next: "Next Sentence",
    drawer_replay: "Replay Sentence",
    drawer_curr_sentence: "Sentence {curr} / {total}",
    drawer_cache_title: "Preloading speech audio...",
    drawer_cache_progress: "Preloaded: {loaded} / {total} sentences",
    drawer_cache_desc: "To guarantee a latency-free intensive listening experience, we are preloading the first {count} high-quality sentences.",
    drawer_api_failed: "API Connection Failed",
    drawer_api_failed_desc: "Failed to load sentences. Please confirm the apps/api FastAPI backend is running.",
    drawer_retry: "⚡ Retry Now"
  }
};

// Helper to resolve current language preference
function getLanguage(storedLang) {
  const lang = storedLang || "auto";
  if (lang === "auto") {
    const uiLang = chrome.i18n.getUILanguage().toLowerCase();
    return uiLang.startsWith("zh") ? "zh" : "en";
  }
  return lang;
}

let ttsSettings = {
  apiUrl: getApiUrl(),
  voice: "en-US-AvaNeural",
  rate: "+0%",
  language: "auto"
};

// Clear preloaded audio cache to prevent memory leaks
function clearAudioCache() {
  if (audioCache) {
    Object.values(audioCache).forEach((item) => {
      if (item && item.objectUrl) {
        try {
          URL.revokeObjectURL(item.objectUrl);
        } catch (e) {
          console.warn("Failed to revoke object URL:", e);
        }
      }
    });
  }
  audioCache = {};
}


// Initialize Shadow DOM to insulate tailwind styles
function initShadowDOM() {
  if (shadowContainer) {
    // Robustly re-bind references if container already exists
    shadowRoot = shadowContainer.shadowRoot;
    componentsRoot = shadowRoot.querySelector("#components-root");
    return shadowRoot;
  }

  // Create host element
  shadowContainer = document.createElement("div");
  shadowContainer.id = "select-to-speak-shadow-root";
  shadowContainer.style.position = "fixed";
  shadowContainer.style.top = "0";
  shadowContainer.style.left = "0";
  shadowContainer.style.width = "100vw";
  shadowContainer.style.height = "100vh";
  shadowContainer.style.pointerEvents = "none"; // Let clicks pass through default layout
  shadowContainer.style.zIndex = "2147483647"; // Max z-index
  document.body.appendChild(shadowContainer);

  // Attach shadow root
  shadowRoot = shadowContainer.attachShadow({ mode: "open" });

  // Load Tailwind Stylesheet
  const linkEl = document.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = chrome.runtime.getURL("dist/tailwind.css");
  shadowRoot.appendChild(linkEl);

  // Load Inter Font style if possible inside shadow (supports China mirror dynamically)
  const fontLink = document.createElement("style");
  const isCN = (function() {
    try {
      const locale = navigator.language || '';
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      return locale.toLowerCase().includes('zh') || tz.includes('Asia/Shanghai') || tz.includes('Asia/Chongqing') || tz.includes('Asia/Harbin') || tz.includes('Asia/Urumqi');
    } catch (e) {
      return false;
    }
  })();
  const fontHost = isCN ? 'fonts.loli.net' : 'fonts.googleapis.com';
  fontLink.textContent = `@import url('https://${fontHost}/css2?family=Inter:wght@400;500;600;700&display=swap');`;
  shadowRoot.appendChild(fontLink);

  // Create component rendering wrapper
  componentsRoot = document.createElement("div");
  componentsRoot.id = "components-root";
  componentsRoot.className = "w-full h-full relative font-sans text-slate-800";
  shadowRoot.appendChild(componentsRoot);

  return shadowRoot;
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      voice: "en-US-AvaNeural",
      rate: "+0%",
      language: "auto"
    }, (items) => {
      // Force the API URL to be the hardcoded dev/prod address
      const safeItems = {
        apiUrl: getApiUrl(),
        voice: items.voice || "en-US-AvaNeural",
        rate: items.rate || "+0%",
        language: items.language || "auto"
      };

      // Strip trailing slash if present
      if (safeItems.apiUrl.endsWith("/")) {
        safeItems.apiUrl = safeItems.apiUrl.slice(0, -1);
      }
      ttsSettings = safeItems;
      resolve(safeItems);
    });
  });
}

// Helper to destroy any active playing audio
function stopActiveAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
}

// Close and remove the side drawer nicely with transitions
function removeDrawer(immediate = false) {
  stopActiveAudio();
  clearAudioCache();
  
  if (!componentsRoot) return;

  const drawer = componentsRoot.querySelector("#intensive-drawer");
  const backdrop = componentsRoot.querySelector("#drawer-backdrop");

  if (drawer && backdrop) {
    if (immediate) {
      drawer.remove();
      backdrop.remove();
    } else {
      drawer.style.transform = "translateX(100%)";
      backdrop.style.opacity = "0";

      // Delete nodes after transition completes
      setTimeout(() => {
        // Double-check element still exists and belongs to componentsRoot before deletion
        if (drawer.parentNode) drawer.remove();
        if (backdrop.parentNode) backdrop.remove();
      }, 300);
    }
  }
}

// ==========================================
// 1. DRAGGABLE FLOATING PLAYER COMPONENT
// ==========================================
function renderFloatingPlayer(text, x, y) {
  initShadowDOM();
  stopActiveAudio();
  
  // Close drawer immediately
  removeDrawer(true);

  // Remove existing floating player
  const existingPlayer = componentsRoot.querySelector("#floating-player");
  if (existingPlayer) {
    existingPlayer.remove();
  }

  // Load settings and construct TTS URL
  loadSettings().then((settings) => {
    // Generate standard audio URL
    const ttsUrl = `${settings.apiUrl}/api/tts?text=${encodeURIComponent(text)}&rate=${encodeURIComponent(settings.rate)}&voice=${encodeURIComponent(settings.voice)}`;
    
    const lang = getLanguage(settings.language);
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    // Create Player Element
    const player = document.createElement("div");
    player.id = "floating-player";
    player.className = "fixed bg-white/95 backdrop-blur-md shadow-premium border border-slate-200/60 rounded-2xl p-4 w-80 flex flex-col space-y-3 pointer-events-auto transition-opacity duration-300 opacity-0";
    
    // Position near selection
    let topPos = y + 15;
    let leftPos = x - 150;
    
    // Viewport bounds checking
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (leftPos < 10) leftPos = 10;
    if (leftPos + 320 > viewportWidth) leftPos = viewportWidth - 330;
    if (topPos + 180 > viewportHeight) topPos = y - 180; // Render above if overflows bottom
    if (topPos < 10) topPos = 10;

    player.style.top = `${topPos}px`;
    player.style.left = `${leftPos}px`;

    player.innerHTML = `
      <!-- Header / Drag Handle -->
      <div id="player-drag-handle" class="flex items-center justify-between cursor-move pb-1.5 border-b border-slate-100">
        <div class="flex items-center space-x-2">
          <div class="bg-white p-0.5 rounded-lg shadow-sm border border-slate-100 overflow-hidden w-8 h-8 flex items-center justify-center">
            <img src="${chrome.runtime.getURL('assets/logo.png')}" alt="Logo" class="w-7 h-7 object-contain rounded">
          </div>
          <span class="text-sm font-semibold text-slate-700 tracking-wide select-none">${dict.player_title}</span>
          <span class="text-xs bg-indigo-50 text-indigo-600 font-mono font-medium px-2 py-0.5 rounded border border-indigo-100 select-none">${settings.rate}</span>
        </div>
        <button id="player-close" class="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-1 rounded-lg transition-all focus:outline-none">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Content Snippet -->
      <div class="text-sm text-slate-600 leading-relaxed max-h-16 overflow-y-auto italic pr-1 select-none">
        "${text.length > 120 ? text.substring(0, 120) + '...' : text}"
      </div>

      <!-- Progress Tracking -->
      <div class="space-y-1">
        <div class="flex justify-between text-xs text-slate-500 font-mono">
          <span id="player-curr-time">0:00</span>
          <span id="player-status">${dict.player_generating}</span>
          <span id="player-total-time">0:00</span>
        </div>
        <div id="player-progress-container" class="h-1.5 w-full bg-slate-100 rounded-full cursor-pointer relative group overflow-hidden">
          <div id="player-progress-bar" class="h-full bg-brand-600 w-0 rounded-full transition-all duration-75"></div>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex items-center justify-center space-x-4 pt-1">
        <button id="player-back-5" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-all focus:outline-none" title="${dict.player_back_5}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"></path>
          </svg>
        </button>
        
        <button id="player-play-btn" class="bg-brand-600 hover:bg-brand-700 text-white rounded-full p-3 shadow-md hover:shadow-lg transition-all transform active:scale-95 focus:outline-none flex items-center justify-center w-11 h-11">
          <!-- Spinner -->
          <svg id="play-btn-spinner" class="animate-spin w-5 h-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <!-- Play icon (hidden initially) -->
          <svg id="play-btn-icon" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
          </svg>
          <!-- Pause icon (hidden initially) -->
          <svg id="pause-btn-icon" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>
          </svg>
        </button>

        <button id="player-fwd-5" class="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-50 transition-all focus:outline-none" title="${dict.player_fwd_5}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.934 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.334-4zM19.934 12.8a1 1 0 000-1.6l-5.334-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.334-4z"></path>
          </svg>
        </button>
      </div>
    `;

    componentsRoot.appendChild(player);
    setTimeout(() => player.style.opacity = "1", 50);

    // Audio Setup
    const audio = new Audio(ttsUrl);
    activeAudio = audio;

    // Controls DOM mapping
    const playBtn = player.querySelector("#player-play-btn");
    const spinner = player.querySelector("#play-btn-spinner");
    const playIcon = player.querySelector("#play-btn-icon");
    const pauseIcon = player.querySelector("#pause-btn-icon");
    const closeBtn = player.querySelector("#player-close");
    const statusText = player.querySelector("#player-status");
    const currTimeText = player.querySelector("#player-curr-time");
    const totalTimeText = player.querySelector("#player-total-time");
    const progressBar = player.querySelector("#player-progress-bar");
    const progressContainer = player.querySelector("#player-progress-container");
    const backBtn = player.querySelector("#player-back-5");
    const fwdBtn = player.querySelector("#player-fwd-5");

    // Audio lifecycle handlers (Explicit loading, buffering and play states)
    audio.addEventListener("loadstart", () => {
      spinner.classList.remove("hidden");
      playIcon.classList.add("hidden");
      pauseIcon.classList.add("hidden");
      statusText.textContent = dict.player_generating;
    });

    audio.addEventListener("waiting", () => {
      spinner.classList.remove("hidden");
      playIcon.classList.add("hidden");
      pauseIcon.classList.add("hidden");
      statusText.textContent = dict.player_buffering;
    });

    audio.addEventListener("canplaythrough", () => {
      spinner.classList.add("hidden");
      if (audio.paused) {
        playIcon.classList.remove("hidden");
        statusText.textContent = dict.player_ready;
      }
    });

    audio.addEventListener("playing", () => {
      spinner.classList.add("hidden");
      playIcon.classList.add("hidden");
      pauseIcon.classList.remove("hidden");
      statusText.textContent = dict.player_playing;
    });

    audio.addEventListener("play", () => {
      // Triggered when play request begins (even during network fetch)
      spinner.classList.remove("hidden");
      playIcon.classList.add("hidden");
      pauseIcon.classList.add("hidden");
      statusText.textContent = dict.player_fetching;
    });

    audio.addEventListener("pause", () => {
      spinner.classList.add("hidden");
      pauseIcon.classList.add("hidden");
      playIcon.classList.remove("hidden");
      statusText.textContent = dict.player_paused;
    });

    audio.addEventListener("timeupdate", () => {
      const current = audio.currentTime;
      const duration = audio.duration || 0;
      
      // Update track width
      const percent = duration > 0 ? (current / duration) * 100 : 0;
      progressBar.style.width = `${percent}%`;

      // Update text
      currTimeText.textContent = formatTime(current);
      if (duration > 0) {
        totalTimeText.textContent = formatTime(duration);
      }
    });

    audio.addEventListener("ended", () => {
      pauseIcon.classList.add("hidden");
      playIcon.classList.remove("hidden");
      statusText.textContent = dict.player_finished;
      progressBar.style.width = "0%";
      audio.currentTime = 0;
    });

    audio.addEventListener("error", (e) => {
      console.error("Audio error: ", e);
      spinner.classList.add("hidden");
      playIcon.classList.remove("hidden");
      statusText.textContent = dict.player_failed;
      statusText.className = "text-xs font-semibold text-rose-500";
    });

    // Start playing
    audio.play().catch(e => {
      // Graceful fallback for autoplay block: hide spinner and let user trigger manually
      console.warn("Autoplay blocked, waiting for user click.", e);
      spinner.classList.add("hidden");
      playIcon.classList.remove("hidden");
      pauseIcon.classList.add("hidden");
      statusText.textContent = dict.player_waiting;
    });

    // Control clicks
    playBtn.addEventListener("click", () => {
      if (audio.paused) {
        audio.play().catch(console.error);
      } else {
        audio.pause();
      }
    });

    backBtn.addEventListener("click", () => {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    });

    fwdBtn.addEventListener("click", () => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    });

    progressContainer.addEventListener("click", (e) => {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const duration = audio.duration;
      if (duration > 0) {
        audio.currentTime = (clickX / width) * duration;
      }
    });

    closeBtn.addEventListener("click", () => {
      stopActiveAudio();
      player.remove();
    });

    // Draggable Functionality
    const dragHandle = player.querySelector("#player-drag-handle");
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let playerStartX = 0;
    let playerStartY = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      playerStartX = player.offsetLeft;
      playerStartY = player.offsetTop;
      e.preventDefault();
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;
      
      let left = playerStartX + deltaX;
      let top = playerStartY + deltaY;

      // Lock boundaries to screen viewport
      const maxLeft = window.innerWidth - player.offsetWidth - 10;
      const maxTop = window.innerHeight - player.offsetHeight - 10;

      if (left < 10) left = 10;
      if (left > maxLeft) left = maxLeft;
      if (top < 10) top = 10;
      if (top > maxTop) top = maxTop;

      player.style.left = `${left}px`;
      player.style.top = `${top}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Clean up drag events when player is removed from DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.removedNodes.forEach((node) => {
          if (node === player) {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            observer.disconnect();
          }
        });
      });
    });
    observer.observe(componentsRoot, { childList: true });
  });
}

// ==========================================
// 2. INTENSIVE LISTENING DRAWER COMPONENT
// ==========================================
function renderIntensiveDrawer(text) {
  initShadowDOM();
  stopActiveAudio();
  
  // Close any existing floating player
  const existingPlayer = componentsRoot.querySelector("#floating-player");
  if (existingPlayer) {
    existingPlayer.remove();
  }

  // IMMEDIATELY remove existing drawer elements to prevent race conditions
  removeDrawer(true);

  console.log("Select-to-Speak: Starting to render intensive listening drawer.");
  
  loadSettings().then(async (settings) => {
    const lang = getLanguage(settings.language);
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

    // Create backdrop element
    const backdrop = document.createElement("div");
    backdrop.id = "drawer-backdrop";
    
    // Apply fallback inline layout styles to ensure backdrop is 100% visible and positioned correctly
    backdrop.style.position = "fixed";
    backdrop.style.top = "0";
    backdrop.style.left = "0";
    backdrop.style.right = "0";
    backdrop.style.bottom = "0";
    backdrop.style.backgroundColor = "rgba(15, 23, 42, 0.3)";
    backdrop.style.backdropFilter = "blur(1px)";
    backdrop.style.pointerEvents = "auto";
    backdrop.style.zIndex = "9999";
    backdrop.style.transition = "opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)";
    backdrop.style.opacity = "0";
    
    // Create drawer panel (styled at w-[80%] of page width)
    const drawer = document.createElement("div");
    drawer.id = "intensive-drawer";
    drawer.className = "max-w-full bg-white shadow-drawer border-l border-slate-100 flex flex-col pointer-events-auto";
    
    // Apply absolute layout inline styles to guarantee width, height, position, and background color
    drawer.style.position = "fixed";
    drawer.style.top = "0";
    drawer.style.right = "0";
    drawer.style.height = "100vh";
    drawer.style.width = "80%";
    drawer.style.maxWidth = "100%";
    drawer.style.backgroundColor = "#ffffff";
    drawer.style.boxShadow = "-10px 0 30px -5px rgba(0, 0, 0, 0.15)";
    drawer.style.borderLeft = "1px solid #f1f5f9";
    drawer.style.display = "flex";
    drawer.style.flexDirection = "column";
    drawer.style.pointerEvents = "auto";
    drawer.style.zIndex = "10000";
    drawer.style.transition = "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)";
    drawer.style.transform = "translateX(100%)";
    
    componentsRoot.appendChild(backdrop);
    componentsRoot.appendChild(drawer);
    console.log("Select-to-Speak: Drawer and backdrop appended to Shadow DOM.");

    // Trigger smooth slide-in animations
    setTimeout(() => {
      console.log("Select-to-Speak: Animating drawer slide-in.");
      backdrop.style.opacity = "1";
      drawer.style.transform = "translateX(0)";
    }, 50);

    // Render Skeleton UI inside drawer while splitting
    drawer.innerHTML = `
      <!-- Header -->
      <div class="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-brand-50/50 to-indigo-50/30">
        <div class="flex items-center space-x-3">
          <div class="bg-white p-0.5 rounded-xl shadow-sm border border-slate-100 overflow-hidden w-9 h-9 flex items-center justify-center">
            <img src="${chrome.runtime.getURL('assets/logo.png')}" alt="Logo" class="w-8 h-8 object-contain rounded-lg">
          </div>
          <div>
            <h2 class="font-bold text-slate-900 leading-tight">${dict.drawer_title}</h2>
            <p class="text-[10px] text-slate-400 font-medium mt-0.5">${dict.drawer_subtitle}</p>
          </div>
        </div>
        <button id="drawer-close" class="text-slate-400 hover:text-slate-600 hover:bg-slate-50 p-1.5 rounded-xl transition-all focus:outline-none">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>

      <!-- Content / Sentence Container (Scrollable) -->
      <div id="drawer-scroll-container" class="flex-1 overflow-y-auto p-6 pb-36 space-y-4">
        <div id="sentences-loading" class="flex flex-col items-center justify-center py-24 space-y-4">
          <svg class="animate-spin w-8 h-8 text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="text-xs font-semibold text-slate-400">${dict.drawer_splitting}</span>
        </div>
        
        <div id="sentences-list" class="space-y-4 hidden"></div>
      </div>

      <!-- Floating Footer Player Controls (Fixed) -->
      <div id="drawer-footer-player" class="absolute bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-100 shadow-premium p-5 z-20 flex flex-col space-y-3.5 hidden">
        <!-- Sentence Progress Track -->
        <div class="space-y-1">
          <div class="flex justify-between text-xs text-slate-500 font-mono">
            <span id="footer-curr-time">0:00</span>
            <span id="footer-sentence-indicator">第 0 / 0 句</span>
            <span id="footer-total-time">0:00</span>
          </div>
          <div id="footer-progress-container" class="h-1.5 w-full bg-slate-100 rounded-full cursor-pointer relative overflow-hidden group">
            <div id="footer-progress-bar" class="h-full bg-brand-600 w-0 rounded-full transition-all duration-75"></div>
          </div>
        </div>

        <!-- Controls row -->
        <div class="flex items-center justify-between">
          <!-- Info display / rate -->
          <div class="flex flex-col space-y-0.5 max-w-[120px] select-none">
            <span id="footer-voice-name" class="text-xs text-slate-600 font-semibold truncate">AvaNeural</span>
            <div class="flex items-center space-x-1.5">
              <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
              <span class="text-[11px] text-slate-600 font-mono tracking-wider font-bold uppercase">ONLINE</span>
            </div>
          </div>

          <!-- Central Buttons -->
          <div class="flex items-center space-x-4">
            <!-- Loop Toggle button -->
            <button id="footer-loop-btn" class="text-slate-400 hover:text-brand-600 p-2 rounded-xl transition-all focus:outline-none" title="${dict.drawer_loop_off}">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.2M7 17v-5H6.582m15.356-2a8.001 8.001 0 11-15.356 2H3.8"></path>
              </svg>
            </button>

            <!-- Prev sentence -->
            <button id="footer-prev-btn" class="text-slate-500 hover:text-slate-800 p-2 rounded-xl hover:bg-slate-50 active:scale-95 transition-all focus:outline-none" title="${dict.drawer_prev}">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.798V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z"></path>
              </svg>
            </button>

            <!-- Play/Pause -->
            <button id="footer-play-btn" class="bg-brand-600 hover:bg-brand-700 text-white rounded-2xl p-3 shadow-md shadow-brand-500/10 active:scale-95 hover:shadow-lg transition-all focus:outline-none flex items-center justify-center w-11 h-11">
              <!-- Spinner -->
              <svg id="f-spinner" class="animate-spin w-5 h-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <!-- Play icon -->
              <svg id="f-play" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
              </svg>
              <!-- Pause icon -->
              <svg id="f-pause" class="w-5 h-5 hidden" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>
              </svg>
            </button>

            <!-- Next sentence -->
            <button id="footer-next-btn" class="text-slate-500 hover:text-slate-800 p-2 rounded-xl hover:bg-slate-50 active:scale-95 transition-all focus:outline-none" title="${dict.drawer_next}">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0010 6v2.798L4.555 5.168z"></path>
              </svg>
            </button>

            <!-- Speed Display -->
            <span id="footer-speed-badge" class="text-xs bg-slate-100 text-slate-700 font-mono font-bold px-2 py-1 rounded border border-slate-200 select-none">${settings.rate}</span>
          </div>

          <!-- Replay Sentence Button -->
          <button id="footer-replay-btn" class="text-slate-500 hover:text-brand-600 flex items-center space-x-1 hover:bg-brand-50 border border-slate-200/50 hover:border-brand-200 px-3 py-1.5 rounded-xl transition-all active:scale-95 focus:outline-none" title="${dict.drawer_replay}">
            <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.2"></path>
            </svg>
            <span class="text-xs font-semibold text-slate-600 group-hover:text-brand-600">${lang === 'zh' ? '重播' : 'Replay'}</span>
          </button>
        </div>
      </div>
    `;

    // Bind close buttons right away
    const closeBtn = drawer.querySelector("#drawer-close");
    closeBtn.addEventListener("click", () => removeDrawer(false));
    backdrop.addEventListener("click", () => removeDrawer(false));

    // Fill initial settings info defensively
    const voiceField = drawer.querySelector("#footer-voice-name");
    if (voiceField && settings.voice) {
      voiceField.textContent = settings.voice.replace("Neural", "");
    }

    const speedBadge = drawer.querySelector("#footer-speed-badge");
    if (speedBadge && settings.rate) {
      speedBadge.textContent = settings.rate;
    }

    try {
      // API call to split sentences
      const res = await fetch(`${settings.apiUrl}/api/split-sentences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);

      const data = await res.json();
      sentencesList = data.sentences || [];

      if (sentencesList.length === 0) {
        throw new Error("No sentences found in selection");
      }

      // Hide loading spinner and populate sentence list
      const loadingEl = drawer.querySelector("#sentences-loading");
      const listEl = drawer.querySelector("#sentences-list");
      
      if (loadingEl) loadingEl.classList.add("hidden");
      if (listEl) {
        listEl.classList.remove("hidden");
        listEl.innerHTML = ""; // Clear loader if any leftovers
      }

      // Hide footer controls initially
      const footerEl = drawer.querySelector("#drawer-footer-player");
      if (footerEl) footerEl.classList.add("hidden");

      // Populate sentence items
      sentencesList.forEach((sentence, idx) => {
        const item = document.createElement("div");
        item.id = `sentence-item-${idx}`;
        item.dataset.index = idx;
        item.className = "sentence-item p-3.5 bg-slate-50/50 border border-slate-100 hover:border-slate-200 rounded-2xl hover:bg-slate-100/50 cursor-pointer transition-all duration-200 flex items-start space-x-3.5 group select-none";
        
        // Sequence index formatting (01, 02...)
        const displayIndex = String(idx + 1).padStart(2, '0');

        item.innerHTML = `
          <div class="sentence-index bg-slate-100 group-hover:bg-brand-100 group-hover:text-brand-600 text-slate-400 font-mono text-[10px] font-bold h-6 w-6 flex items-center justify-center rounded-lg transition-colors flex-shrink-0">
            ${displayIndex}
          </div>
          <!-- Real-time Cache Indicator Dot -->
          <div class="preload-status-indicator w-4 h-6 flex items-center justify-center flex-shrink-0">
            <span class="inline-flex rounded-full h-1.5 w-1.5 bg-slate-300"></span>
          </div>
          <div class="flex-1 space-y-1">
            <p class="sentence-text text-[16px] text-slate-600 font-medium leading-relaxed group-hover:text-slate-800 transition-colors">${sentence}</p>
          </div>
          <div class="play-icon opacity-0 group-hover:opacity-100 text-brand-600 transition-opacity self-center flex-shrink-0">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
            </svg>
          </div>
        `;

        // Clicking a sentence triggers playing it
        item.addEventListener("click", () => {
          playSentence(idx);
        });

        if (listEl) listEl.appendChild(item);
      });

      // Initialize controls logic
      initDrawerPlayerControls(drawer);

      // Create initial preload overlay element
      const preloadOverlay = document.createElement("div");
      preloadOverlay.id = "initial-preload-overlay";
      preloadOverlay.style.position = "absolute";
      preloadOverlay.style.top = "73px"; // Below header
      preloadOverlay.style.left = "0";
      preloadOverlay.style.right = "0";
      preloadOverlay.style.bottom = "0";
      preloadOverlay.style.backgroundColor = "rgba(255, 255, 255, 0.96)";
      preloadOverlay.style.backdropFilter = "blur(6px)";
      preloadOverlay.style.zIndex = "30";
      preloadOverlay.style.display = "flex";
      preloadOverlay.style.flexDirection = "column";
      preloadOverlay.style.alignItems = "center";
      preloadOverlay.style.justifyContent = "center";
      preloadOverlay.style.padding = "2rem";
      preloadOverlay.style.transition = "opacity 300ms ease";
      preloadOverlay.style.opacity = "1";
      preloadOverlay.style.pointerEvents = "auto";

      preloadOverlay.innerHTML = `
        <div class="relative w-20 h-20 flex items-center justify-center mb-5">
          <!-- Circular Progress Ring -->
          <svg class="w-full h-full transform -rotate-90">
            <circle cx="40" cy="40" r="34" stroke="#f1f5f9" stroke-width="6" fill="transparent" />
            <circle id="preload-progress-ring" cx="40" cy="40" r="34" stroke="#7c3aed" stroke-width="6" fill="transparent" 
              stroke-dasharray="213.6" stroke-dashoffset="213.6" class="transition-all duration-300 ease-out" />
          </svg>
          <div class="absolute inset-0 flex items-center justify-center text-brand-600">
            <svg class="w-7 h-7 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
          </div>
        </div>
        <div class="text-center space-y-2">
          <h3 class="font-bold text-slate-900 text-base">${dict.drawer_cache_title}</h3>
          <p id="initial-preload-progress" class="text-sm text-slate-600 font-medium">${dict.drawer_cache_progress.replace("{loaded}", "0").replace("{total}", Math.min(5, sentencesList.length))}</p>
          <div class="text-xs text-slate-500 max-w-[280px] leading-relaxed mx-auto">${dict.drawer_cache_desc.replace("{count}", Math.min(5, sentencesList.length))}</div>
        </div>
      `;
      drawer.appendChild(preloadOverlay);

      // Perform initial preload
      const initialCount = Math.min(5, sentencesList.length);
      const ring = preloadOverlay.querySelector("#preload-progress-ring");
      const progressText = preloadOverlay.querySelector("#initial-preload-progress");

      let loadedCount = 0;
      const preloadPromises = [];

      for (let i = 0; i < initialCount; i++) {
        preloadPromises.push(
          preloadSentence(i, settings)
            .then(() => {
              loadedCount++;
              progressText.textContent = dict.drawer_cache_progress.replace("{loaded}", loadedCount).replace("{total}", initialCount);
              const offset = 213.6 - ((loadedCount / initialCount) * 213.6);
              if (ring) ring.style.strokeDashoffset = offset.toString();
            })
            .catch((err) => {
              console.warn(`Initial preload failed for sentence ${i}:`, err);
              loadedCount++;
              progressText.textContent = dict.drawer_cache_progress.replace("{loaded}", loadedCount).replace("{total}", initialCount);
              const offset = 213.6 - ((loadedCount / initialCount) * 213.6);
              if (ring) ring.style.strokeDashoffset = offset.toString();
            })
        );
      }

      Promise.all(preloadPromises).then(() => {
        // Fade out overlay
        setTimeout(() => {
          preloadOverlay.style.opacity = "0";
          setTimeout(() => {
            preloadOverlay.remove();
          }, 300);

          // Show footer player
          if (footerEl) footerEl.classList.remove("hidden");

          // Start playing sentence 0
          playSentence(0);

          // Background preload remaining sentences sequentially
          if (sentencesList.length > initialCount) {
            backgroundPreloadRemaining(initialCount, settings);
          }
        }, 300);
      });

    } catch (err) {
      console.error("Failed to parse or load sentences: ", err);
      const loadingEl = drawer.querySelector("#sentences-loading");
      if (loadingEl) {
        loadingEl.innerHTML = `
          <div class="bg-rose-50 border border-rose-100 rounded-2xl p-6 max-w-md mx-auto text-center space-y-3 pointer-events-auto">
            <svg class="w-10 h-10 text-rose-500 mx-auto animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div class="text-xs font-semibold text-rose-800">${dict.drawer_api_failed}</div>
            <div class="text-[11px] text-rose-600 leading-normal">
              ${dict.drawer_api_failed_desc}<br>
              接口地址: <span class="font-mono text-rose-700 bg-rose-100/50 px-1 rounded">${settings.apiUrl}</span>
            </div>
            <button id="drawer-retry-btn" class="bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold px-4 py-2 rounded-xl transition-all shadow active:scale-95 focus:outline-none">
              ${dict.drawer_retry}
            </button>
          </div>
        `;
        const retryBtn = loadingEl.querySelector("#drawer-retry-btn");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => {
            renderIntensiveDrawer(text);
          });
        }
      }
    }
  });
}


// Preload a single sentence and return its Object URL (Blob-based)
async function preloadSentence(index, settings) {
  if (audioCache[index] && audioCache[index].status === 'loaded') {
    return audioCache[index].objectUrl;
  }

  // Set status as loading
  audioCache[index] = {
    objectUrl: null,
    status: 'loading'
  };
  updateSentencePreloadStatusUI(index, 'loading');

  const text = sentencesList[index];
  const ttsUrl = `${settings.apiUrl}/api/tts?text=${encodeURIComponent(text)}&rate=${encodeURIComponent(settings.rate)}&voice=${encodeURIComponent(settings.voice)}`;

  try {
    const res = await fetch(ttsUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    audioCache[index] = {
      objectUrl: objectUrl,
      status: 'loaded'
    };
    updateSentencePreloadStatusUI(index, 'loaded');
    return objectUrl;
  } catch (err) {
    console.error(`Failed to preload sentence ${index}:`, err);
    audioCache[index] = {
      objectUrl: null,
      status: 'error'
    };
    updateSentencePreloadStatusUI(index, 'error');
    throw err;
  }
}

// Update the visual dot indicating caching state for a sentence item
function updateSentencePreloadStatusUI(index, status) {
  const drawer = componentsRoot ? componentsRoot.querySelector("#intensive-drawer") : null;
  if (!drawer) return;

  const item = drawer.querySelector(`#sentence-item-${index}`);
  if (!item) return;

  const indicatorContainer = item.querySelector(".preload-status-indicator");
  if (!indicatorContainer) return;

  const lang = getLanguage(ttsSettings.language);
  const isZH = lang === 'zh';

  if (status === 'loading') {
    indicatorContainer.innerHTML = `
      <span class="flex h-1.5 w-1.5 relative">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500"></span>
      </span>
    `;
    indicatorContainer.title = isZH ? "正在缓冲语音..." : "Buffering audio...";
  } else if (status === 'loaded') {
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
    `;
    indicatorContainer.title = isZH ? "已预加载（零延迟播放）" : "Preloaded (zero latency)";
  } else if (status === 'error') {
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-rose-500 animate-pulse"></span>
    `;
    indicatorContainer.title = isZH ? "缓冲失败，点击可重试" : "Preload failed, click to retry";
  } else {
    // Default / pending
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-slate-300"></span>
    `;
    indicatorContainer.title = isZH ? "等待加载中" : "Pending preload";
  }
}

// Background sequential preloading for remaining sentences
async function backgroundPreloadRemaining(startIndex, settings) {
  for (let i = startIndex; i < sentencesList.length; i++) {
    // Stop background loading if drawer is closed/removed
    const drawer = componentsRoot ? componentsRoot.querySelector("#intensive-drawer") : null;
    if (!drawer) {
      console.log("Background preloading halted: drawer was closed.");
      break;
    }

    if (audioCache[i] && (audioCache[i].status === 'loaded' || audioCache[i].status === 'loading')) {
      continue;
    }

    try {
      await preloadSentence(i, settings);
    } catch (e) {
      console.warn(`Background preload failed for index ${i}:`, e);
    }

    // Sleep for 200ms to preserve API bandwidth and maintain gentle pacing
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// Set up event listeners for Intensive Drawer footer player
let loopEnabled = false;

function initDrawerPlayerControls(drawer) {
  const playBtn = drawer.querySelector("#footer-play-btn");
  const prevBtn = drawer.querySelector("#footer-prev-btn");
  const nextBtn = drawer.querySelector("#footer-next-btn");
  const replayBtn = drawer.querySelector("#footer-replay-btn");
  const loopBtn = drawer.querySelector("#footer-loop-btn");
  
  const progressContainer = drawer.querySelector("#footer-progress-container");
  const indicator = drawer.querySelector("#footer-sentence-indicator");

  // Re-bind click actions
  playBtn.addEventListener("click", () => {
    if (!activeAudio) return;
    if (activeAudio.paused) {
      activeAudio.play().catch(console.error);
    } else {
      activeAudio.pause();
    }
  });

  prevBtn.addEventListener("click", () => {
    if (currentSentenceIndex > 0) {
      playSentence(currentSentenceIndex - 1);
    }
  });

  nextBtn.addEventListener("click", () => {
    if (currentSentenceIndex < sentencesList.length - 1) {
      playSentence(currentSentenceIndex + 1);
    }
  });

  replayBtn.addEventListener("click", () => {
    if (!activeAudio) return;
    activeAudio.currentTime = 0;
    activeAudio.play().catch(console.error);
  });

  // Loop toggle
  loopBtn.addEventListener("click", () => {
    const lang = getLanguage(ttsSettings.language);
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    loopEnabled = !loopEnabled;
    if (loopEnabled) {
      loopBtn.className = "text-brand-600 hover:text-brand-700 bg-brand-50 p-2 rounded-xl border border-brand-200 shadow-sm transition-all focus:outline-none";
      loopBtn.title = dict.drawer_loop_on;
    } else {
      loopBtn.className = "text-slate-400 hover:text-brand-600 p-2 rounded-xl transition-all focus:outline-none";
      loopBtn.title = dict.drawer_loop_off;
    }
  });

  progressContainer.addEventListener("click", (e) => {
    if (!activeAudio) return;
    const rect = progressContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const duration = activeAudio.duration;
    if (duration > 0) {
      activeAudio.currentTime = (clickX / width) * duration;
    }
  });
}

// Function to play a specific sentence in the side drawer list
function playSentence(index) {
  if (index < 0 || index >= sentencesList.length) return;
  
  stopActiveAudio();
  currentSentenceIndex = index;

  // Visual highlights updating
  const drawer = componentsRoot.querySelector("#intensive-drawer");
  if (!drawer) return;

  const items = drawer.querySelectorAll(".sentence-item");
  items.forEach((item) => {
    const idx = parseInt(item.dataset.index);
    if (idx === index) {
      // Add active premium styles
      item.className = "sentence-item p-3.5 bg-brand-50 border-brand-200 ring-1 ring-brand-100/50 rounded-2xl cursor-pointer transition-all duration-200 flex items-start space-x-3.5 group select-none";
      
      const numLabel = item.querySelector(".sentence-index");
      if (numLabel) {
        numLabel.className = "sentence-index bg-brand-600 text-white font-mono text-[10px] font-bold h-6 w-6 flex items-center justify-center rounded-lg transition-colors flex-shrink-0";
      }

      const textPara = item.querySelector(".sentence-text");
      if (textPara) {
        textPara.className = "sentence-text text-[16px] text-slate-900 font-bold leading-relaxed transition-colors";
      }

      // Smooth auto-scroll active sentence to center of drawer scroll list
      item.scrollIntoView({ behavior: 'smooth', block: 'center' });

    } else {
      // Revert standard styles
      item.className = "sentence-item p-3.5 bg-slate-50/50 border border-slate-100 hover:border-slate-200 rounded-2xl hover:bg-slate-100/50 cursor-pointer transition-all duration-200 flex items-start space-x-3.5 group select-none";
      
      const numLabel = item.querySelector(".sentence-index");
      if (numLabel) {
        numLabel.className = "sentence-index bg-slate-100 group-hover:bg-brand-100 group-hover:text-brand-600 text-slate-400 font-mono text-[10px] font-bold h-6 w-6 flex items-center justify-center rounded-lg transition-colors flex-shrink-0";
      }

      const textPara = item.querySelector(".sentence-text");
      if (textPara) {
        textPara.className = "sentence-text text-[16px] text-slate-600 font-medium leading-relaxed group-hover:text-slate-800 transition-colors";
      }
    }
  });

  // Footer UI Elements mapping
  const playBtn = drawer.querySelector("#footer-play-btn");
  const fPlay = drawer.querySelector("#f-play");
  const fPause = drawer.querySelector("#f-pause");
  const fSpinner = drawer.querySelector("#f-spinner");
  const progressBar = drawer.querySelector("#footer-progress-bar");
  const currTimeText = drawer.querySelector("#footer-curr-time");
  const totalTimeText = drawer.querySelector("#footer-total-time");
  const indicator = drawer.querySelector("#footer-sentence-indicator");

  // Show spinner initially
  fPlay.classList.add("hidden");
  fPause.classList.add("hidden");
  fSpinner.classList.remove("hidden");

  // Update indices text
  const lang = getLanguage(ttsSettings.language);
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  indicator.textContent = dict.drawer_curr_sentence.replace("{curr}", index + 1).replace("{total}", sentencesList.length);

  // Retrieve cached url or download on-demand if missing
  const getAudioUrl = async () => {
    if (audioCache[index] && audioCache[index].status === 'loaded') {
      return audioCache[index].objectUrl;
    }
    try {
      return await preloadSentence(index, ttsSettings);
    } catch (err) {
      console.warn("Preload fallback activated for sentence:", index, err);
      const sentenceText = sentencesList[index];
      return `${ttsSettings.apiUrl}/api/tts?text=${encodeURIComponent(sentenceText)}&rate=${encodeURIComponent(ttsSettings.rate)}&voice=${encodeURIComponent(ttsSettings.voice)}`;
    }
  };

  getAudioUrl().then((audioUrl) => {
    // Prevent race condition: verify this index is still the active playing one
    if (currentSentenceIndex !== index) return;

    const audio = new Audio(audioUrl);
    activeAudio = audio;

    // Drawer Audio event handlers for robust loading spinners
    audio.addEventListener("loadstart", () => {
      fSpinner.classList.remove("hidden");
      fPlay.classList.add("hidden");
      fPause.classList.add("hidden");
    });

    audio.addEventListener("waiting", () => {
      fSpinner.classList.remove("hidden");
      fPlay.classList.add("hidden");
      fPause.classList.add("hidden");
    });

    audio.addEventListener("canplaythrough", () => {
      fSpinner.classList.add("hidden");
      if (audio.paused) {
        fPlay.classList.remove("hidden");
      }
    });

    audio.addEventListener("playing", () => {
      fSpinner.classList.add("hidden");
      fPlay.classList.add("hidden");
      fPause.classList.remove("hidden");
    });

    audio.addEventListener("play", () => {
      fSpinner.classList.remove("hidden");
      fPlay.classList.add("hidden");
      fPause.classList.add("hidden");
    });

    audio.addEventListener("pause", () => {
      fSpinner.classList.add("hidden");
      fPause.classList.add("hidden");
      fPlay.classList.remove("hidden");
    });

    audio.addEventListener("timeupdate", () => {
      const current = audio.currentTime;
      const duration = audio.duration || 0;
      
      // Update track width
      const percent = duration > 0 ? (current / duration) * 100 : 0;
      progressBar.style.width = `${percent}%`;

      // Update time displays
      currTimeText.textContent = formatTime(current);
      if (duration > 0) {
        totalTimeText.textContent = formatTime(duration);
      }
    });

    audio.addEventListener("ended", () => {
      fPause.classList.add("hidden");
      fPlay.classList.remove("hidden");
      progressBar.style.width = "0%";
      
      if (loopEnabled) {
        // Loop this sentence
        audio.currentTime = 0;
        audio.play().catch(console.error);
      } else {
        // Autoplay next sentence if available
        if (index + 1 < sentencesList.length) {
          setTimeout(() => {
            playSentence(index + 1);
          }, 100);
        }
      }
    });

    audio.addEventListener("error", (e) => {
      console.error("Audio sentence error: ", e);
      fSpinner.classList.add("hidden");
      fPlay.classList.remove("hidden");
    });

    audio.play().catch((e) => {
      console.warn("Autoplay blocked inside drawer, waiting for user click.", e);
      fSpinner.classList.add("hidden");
      fPlay.classList.remove("hidden");
    });
  });
}

// Format seconds into minutes and seconds (e.g. 0:05, 1:24)
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === Infinity) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ==========================================
// 3. LISTEN FOR MESSAGES FROM SERVICE WORKER
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Injected script received command: ", message);

  const { action } = message;
  let text = message.text;

  // Fallback to page text selection if text is not provided (triggered by global shortcuts)
  if (!text) {
    try {
      text = window.getSelection().toString().trim();
    } catch (e) {
      console.warn("Failed to retrieve selection text dynamically: ", e);
    }
  }

  if (!text) {
    console.log("No text provided and no page selection active.");
    sendResponse({ status: "no_selection" });
    return true;
  }

  if (action === "play-selection") {
    // Calculate selection coordinates to place player near cursor
    let selectionX = window.innerWidth / 2;
    let selectionY = window.innerHeight / 3;

    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          selectionX = rect.left + rect.width / 2;
          selectionY = rect.bottom;
        }
      }
    } catch (e) {
      console.warn("Failed to retrieve selection coordinates: ", e);
    }

    renderFloatingPlayer(text, selectionX, selectionY);
  } 
  
  else if (action === "intensive-listening") {
    renderIntensiveDrawer(text);
  }
  
  // Respond to keep channel active
  sendResponse({ status: "success" });
  return true;
});
