// content.js - Injected content script for Select-to-Speak Extension

let shadowRoot = null;
let shadowContainer = null;
let componentsRoot = null;

// Global references for audio control
let activeAudio = null;
let activeAudioObjectUrl = null;
let currentSentenceIndex = -1;
let sentencesList = [];
let audioCache = {};
let selectionToolbar = null;
let selectionAudioCache = {};
let teacherChatMessages = [];
let pageScrollLockState = null;
const MAX_SELECTION_AUDIO_CACHE_SIZE = 30;
// Get the hardcoded API URL based on runtime environment (development or production)
function getApiUrl() {
  const isDev = !chrome.runtime.getManifest().update_url;
  const DEV_API_URL = "http://localhost:18002";
  const PROD_API_URL = "https://tts-api.dayansoft.cn"; // Enforce production address
  return isDev ? DEV_API_URL : PROD_API_URL;
}

// Supported UI Language mapping and default fallback
const SUPPORTED_LANGUAGES = {
  zh: "zh",
  en: "en"
};
const DEFAULT_LANGUAGE = "en";

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
    drawer_retry: "⚡ 立即重试",
    // Drawer buttons and tooltips
    btn_replay_text: "重播",
    indicator_loading: "正在缓冲语音...",
    indicator_loaded: "已预加载（零延迟播放）",
    indicator_error: "缓冲失败，点击可重试",
    indicator_pending: "等待加载中"
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
    drawer_retry: "⚡ Retry Now",
    // Drawer buttons and tooltips
    btn_replay_text: "Replay",
    indicator_loading: "Buffering audio...",
    indicator_loaded: "Preloaded (zero latency)",
    indicator_error: "Preload failed, click to retry",
    indicator_pending: "Pending preload"
  }
};

// Resolve stored language setting into a supported translation key.
function getLanguage(storedLang) {
  if (storedLang && storedLang !== "auto") {
    return SUPPORTED_LANGUAGES[storedLang] || DEFAULT_LANGUAGE;
  }

  try {
    const browserLang = (navigator.language || "").toLowerCase();
    if (browserLang.startsWith("zh")) return "zh";
    if (browserLang.startsWith("en")) return "en";
  } catch (e) {
    console.warn("Failed to resolve browser language:", e);
  }

  return DEFAULT_LANGUAGE;
}

// Helper to get localized messages (supporting both native chrome.i18n and manual override)
function getMessage(key, storedLang) {
  const lang = storedLang || "auto";
  
  const nativeMsg = chrome.i18n.getMessage(key);
  
  const langOverride = {
    auto: nativeMsg
  };
  
  if (langOverride[lang] !== undefined) {
    return langOverride[lang];
  }
  
  // Custom language override lookup
  const resolvedLang = SUPPORTED_LANGUAGES[lang] || DEFAULT_LANGUAGE;
  const dict = TRANSLATIONS[resolvedLang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  return dict[key] || nativeMsg;
}

// Helper to resolve translation dictionary dynamically
function getTranslationsDict(storedLang) {
  const dict = {};
  const keys = [
    "player_title", "player_back_5", "player_fwd_5", "player_generating", "player_buffering",
    "player_ready", "player_playing", "player_fetching", "player_paused", "player_finished",
    "player_failed", "player_waiting", "drawer_title", "drawer_subtitle", "drawer_splitting",
    "drawer_loop_on", "drawer_loop_off", "drawer_prev", "drawer_next", "drawer_replay",
    "drawer_curr_sentence", "drawer_cache_title", "drawer_cache_progress", "drawer_cache_desc",
    "drawer_api_failed", "drawer_api_failed_desc", "drawer_retry", "btn_replay_text",
    "indicator_loading", "indicator_loaded", "indicator_error", "indicator_pending"
  ];
  keys.forEach(key => {
    dict[key] = getMessage(key, storedLang);
  });
  return dict;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

  const readabilityStyle = document.createElement("style");
  readabilityStyle.textContent = `
    #components-root,
    #components-root .text-xs,
    #components-root .text-\\[10px\\],
    #components-root .text-\\[11px\\] {
      font-size: 14px !important;
    }

    #components-root .markdown-body {
      font-size: 16px;
      line-height: 1.75;
      max-width: 100%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    #components-root .markdown-body h1,
    #components-root .markdown-body h2,
    #components-root .markdown-body h3 {
      margin: 0.35rem 0 0.55rem;
      color: #0f172a;
      font-weight: 700;
      line-height: 1.35;
    }

    #components-root .markdown-body h1 { font-size: 22px; }
    #components-root .markdown-body h2 { font-size: 20px; }
    #components-root .markdown-body h3 { font-size: 18px; }

    #components-root .markdown-body p,
    #components-root .markdown-body ul,
    #components-root .markdown-body ol,
    #components-root .markdown-body pre {
      margin: 0.5rem 0;
    }

    #components-root .markdown-body ul,
    #components-root .markdown-body ol {
      padding-left: 1.35rem;
    }

    #components-root .markdown-body ul { list-style: disc; }
    #components-root .markdown-body ol { list-style: decimal; }

    #components-root .markdown-body code {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 0.35rem;
      color: #334155;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
      padding: 0.05rem 0.28rem;
    }

    #components-root .markdown-body pre {
      background: #0f172a;
      border-radius: 0.75rem;
      color: #e2e8f0;
      overflow-x: auto;
      padding: 0.85rem 1rem;
      white-space: pre-wrap;
    }

    #components-root .markdown-body pre code {
      background: transparent;
      border: 0;
      color: inherit;
      padding: 0;
    }

    #components-root .markdown-body blockquote {
      background: #f8fafc;
      border-left: 4px solid #c4b5fd;
      border-radius: 0.5rem;
      color: #475569;
      margin: 0.65rem 0;
      padding: 0.65rem 0.85rem;
    }
  `;
  shadowRoot.appendChild(readabilityStyle);

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

function buildTtsUrl(text, settings) {
  return `${settings.apiUrl}/api/tts?text=${encodeURIComponent(text)}&rate=${encodeURIComponent(settings.rate)}&voice=${encodeURIComponent(settings.voice)}`;
}

async function fetchTtsObjectUrl(text, settings) {
  const res = await fetch(buildTtsUrl(text, settings));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

function lockPageScroll() {
  if (pageScrollLockState) return;

  const docEl = document.documentElement;
  const body = document.body;
  const scrollbarWidth = window.innerWidth - docEl.clientWidth;

  pageScrollLockState = {
    docOverflow: docEl.style.overflow,
    bodyOverflow: body.style.overflow,
    bodyPaddingRight: body.style.paddingRight
  };

  docEl.style.overflow = "hidden";
  body.style.overflow = "hidden";

  if (scrollbarWidth > 0) {
    const currentPadding = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
  }
}

function unlockPageScroll() {
  if (!pageScrollLockState) return;

  document.documentElement.style.overflow = pageScrollLockState.docOverflow;
  document.body.style.overflow = pageScrollLockState.bodyOverflow;
  document.body.style.paddingRight = pageScrollLockState.bodyPaddingRight;
  pageScrollLockState = null;
}

function pruneSelectionAudioCache() {
  const entries = Object.entries(selectionAudioCache);
  if (entries.length <= MAX_SELECTION_AUDIO_CACHE_SIZE) return;

  entries
    .sort(([, a], [, b]) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))
    .slice(0, entries.length - MAX_SELECTION_AUDIO_CACHE_SIZE)
    .forEach(([key, entry]) => {
      if (entry && entry.objectUrl) {
        try {
          URL.revokeObjectURL(entry.objectUrl);
        } catch (e) {
          console.warn("Failed to revoke cached selection audio:", e);
        }
      }
      delete selectionAudioCache[key];
    });
}

async function playSelectedSnippet(text) {
  if (!text || !text.trim()) return;

  stopActiveAudio();
  let cacheKey = null;

  try {
    const trimmedText = text.trim();
    cacheKey = JSON.stringify({
      text: trimmedText,
      apiUrl: ttsSettings.apiUrl,
      voice: ttsSettings.voice,
      rate: ttsSettings.rate
    });

    if (!selectionAudioCache[cacheKey]) {
      selectionAudioCache[cacheKey] = {
        status: "loading",
        promise: fetchTtsObjectUrl(trimmedText, ttsSettings)
      };
    }

    const cacheEntry = selectionAudioCache[cacheKey];
    if (cacheEntry.status === "loading") {
      cacheEntry.objectUrl = await cacheEntry.promise;
      cacheEntry.status = "loaded";
      cacheEntry.lastUsedAt = Date.now();
      delete cacheEntry.promise;
    }
    cacheEntry.lastUsedAt = Date.now();
    pruneSelectionAudioCache();

    const objectUrl = cacheEntry.objectUrl;
    const audio = new Audio(objectUrl);
    activeAudio = audio;
    audio.play().catch((e) => {
      console.warn("Selected snippet autoplay blocked:", e);
    });
  } catch (e) {
    if (cacheKey && selectionAudioCache[cacheKey] && selectionAudioCache[cacheKey].status !== "loaded") {
      delete selectionAudioCache[cacheKey];
    }
    console.error("Failed to play selected snippet:", e);
  }
}

// Helper to destroy any active playing audio
function stopActiveAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
  if (activeAudioObjectUrl) {
    try {
      URL.revokeObjectURL(activeAudioObjectUrl);
    } catch (e) {
      console.warn("Failed to revoke active object URL:", e);
    }
    activeAudioObjectUrl = null;
  }
}

// Close and remove the side drawer nicely with transitions
function removeDrawer(immediate = false) {
  stopActiveAudio();
  clearAudioCache();
  
  if (!componentsRoot) return;

  const drawer = componentsRoot.querySelector("#intensive-drawer");
  const backdrop = componentsRoot.querySelector("#drawer-backdrop");
  clearSelectionToolbar();
  closeTeacherDrawer(true);

  if (drawer && backdrop) {
    if (immediate) {
      drawer.remove();
      backdrop.remove();
      unlockPageScroll();
    } else {
      drawer.style.transform = "translateX(100%)";
      backdrop.style.opacity = "0";

      // Delete nodes after transition completes
      setTimeout(() => {
        // Double-check element still exists and belongs to componentsRoot before deletion
        if (drawer.parentNode) drawer.remove();
        if (backdrop.parentNode) backdrop.remove();
        unlockPageScroll();
      }, 300);
    }
  } else {
    unlockPageScroll();
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

  // Load settings and construct player UI
  loadSettings().then((settings) => {
    const dict = getTranslationsDict(settings.language);

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

    // Audio Setup. Use a blob URL so page-level media-src CSP cannot block the TTS endpoint.
    let audio = null;
    fetchTtsObjectUrl(text, settings).then((objectUrl) => {
      if (!componentsRoot || !componentsRoot.contains(player)) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      activeAudioObjectUrl = objectUrl;
      audio = new Audio(objectUrl);
      activeAudio = audio;

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
    }).catch((e) => {
      console.error("Failed to fetch TTS audio: ", e);
      spinner.classList.add("hidden");
      playIcon.classList.remove("hidden");
      pauseIcon.classList.add("hidden");
      statusText.textContent = dict.player_failed;
      statusText.className = "text-xs font-semibold text-rose-500";
    });

    // Control clicks
    playBtn.addEventListener("click", () => {
      if (!audio) {
        spinner.classList.remove("hidden");
        playIcon.classList.add("hidden");
        pauseIcon.classList.add("hidden");
        statusText.textContent = dict.player_fetching;
        return;
      }
      if (audio.paused) {
        audio.play().catch(console.error);
      } else {
        audio.pause();
      }
    });

    backBtn.addEventListener("click", () => {
      if (!audio) return;
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    });

    fwdBtn.addEventListener("click", () => {
      if (!audio) return;
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
    });

    progressContainer.addEventListener("click", (e) => {
      if (!audio) return;
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

function getCurrentShadowSelection() {
  if (shadowRoot && typeof shadowRoot.getSelection === "function") {
    return shadowRoot.getSelection();
  }
  return window.getSelection();
}

function clearSelectionToolbar() {
  if (selectionToolbar && selectionToolbar.parentNode) {
    selectionToolbar.remove();
  }
  selectionToolbar = null;
}

function showSelectionActionToolbar({ text, rect, actions }) {
  clearSelectionToolbar();

  if (!text || !text.trim() || !rect) return;

  const toolbar = document.createElement("div");
  toolbar.id = "selection-action-toolbar";
  toolbar.className = "bg-slate-950 text-white shadow-xl border border-slate-800 rounded-xl px-2 py-2 flex items-center gap-2 pointer-events-auto";
  toolbar.style.position = "fixed";
  toolbar.style.zIndex = "2147483647";
  toolbar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - 62, window.innerWidth - 132))}px`;
  toolbar.style.top = `${Math.max(8, rect.top - 58)}px`;

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.className = "h-12 w-12 flex items-center justify-center rounded-lg hover:bg-white/10 active:scale-95 transition-all focus:outline-none";
    button.title = action.title;
    button.innerHTML = action.icon;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.onClick(text);
    });
    toolbar.appendChild(button);
  });

  componentsRoot.appendChild(toolbar);
  selectionToolbar = toolbar;
}

function showSelectionToolbar(text, rect) {
  showSelectionActionToolbar({
    text,
    rect,
    actions: [
      {
        title: "播放选中内容",
        icon: `
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
          </svg>
        `,
        onClick: playSelectedSnippet
      },
      {
        title: "查看详情",
        icon: `
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path>
          </svg>
        `,
        onClick: openTeacherDrawer
      }
    ]
  });
}

function bindSelectableSentenceLine(line) {
  line.addEventListener("mousedown", () => {
    clearSelectionToolbar();
  });

  line.addEventListener("mouseup", () => {
    setTimeout(() => {
      const selection = getCurrentShadowSelection();
      if (!selection || selection.rangeCount === 0) return;

      const selectedText = selection.toString().trim();
      if (!selectedText) {
        clearSelectionToolbar();
        return;
      }

      const range = selection.getRangeAt(0);
      const startNode = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
      const endNode = range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement
        : range.endContainer;

      if (!line.contains(startNode) || !line.contains(endNode)) {
        clearSelectionToolbar();
        return;
      }

      showSelectionToolbar(selectedText, range.getBoundingClientRect());
    }, 0);
  });
}

function formatInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function formatMarkdownBlocks(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${formatInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      return;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${formatInlineMarkdown(heading[2])}</h${level}>`);
      return;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(unordered[1]);
      return;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(ordered[1]);
      return;
    }

    const quote = trimmed.match(/^>\s*(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${formatInlineMarkdown(quote[1])}</blockquote>`);
      return;
    }

    flushList();
    paragraph.push(trimmed);
  });

  flushParagraph();
  flushList();
  if (inCode) flushCode();

  return html.join("");
}

function closeTeacherDrawer(immediate = false) {
  if (!componentsRoot) return;

  const panel = componentsRoot.querySelector("#teacher-chat-drawer");
  const shade = componentsRoot.querySelector("#teacher-chat-shade");
  if (!panel && !shade) return;

  if (immediate) {
    if (panel) panel.remove();
    if (shade) shade.remove();
    return;
  }

  if (panel) panel.style.transform = "translateX(100%)";
  if (shade) shade.style.opacity = "0";
  setTimeout(() => {
    if (panel && panel.parentNode) panel.remove();
    if (shade && shade.parentNode) shade.remove();
  }, 250);
}

function createTeacherPrompt(selectedText) {
  return [
    "你是一名耐心、专业的英语老师。请用中文解释下面这段学习者从英文句子里选中的内容。",
    "",
    "要求：",
    "1. 先说明它在原文中的核心意思。",
    "2. 解释重要单词、短语、语法结构和语气。",
    "3. 给出自然中文翻译。",
    "4. 如果适合，请给出 1-2 个相似英文例句并配中文解释。",
    "5. 回答要清晰、适合英语学习者继续追问。",
    "",
    `选中内容：${selectedText}`
  ].join("\n");
}

function renderChatMessages(container) {
  container.innerHTML = "";
  teacherChatMessages.forEach((message, index) => {
    const bubble = document.createElement("div");
    const isUser = message.role === "user";
    bubble.className = isUser
      ? "max-w-[82%] ml-auto bg-brand-600 text-white rounded-2xl rounded-br-md px-4 py-3 text-base leading-relaxed shadow-sm whitespace-pre-wrap"
      : "markdown-body max-w-[88%] mr-auto bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-bl-md px-5 py-4 text-base leading-relaxed shadow-sm";

    if (message.pending) {
      bubble.innerHTML = `
        <div class="flex items-center gap-2 text-slate-500">
          <svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>正在思考...</span>
        </div>
      `;
    } else {
      bubble.innerHTML = isUser ? escapeHtml(message.displayText || message.text) : formatMarkdownBlocks(message.text);
    }

    bubble.dataset.index = index;
    container.appendChild(bubble);
  });

  container.scrollTop = container.scrollHeight;
}

async function requestTeacherReply(chatBody, messagesForApi) {
  teacherChatMessages.push({ role: "model", text: "", pending: true });
  renderChatMessages(chatBody);

  try {
    const res = await fetch(`${ttsSettings.apiUrl}/api/gemini-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: messagesForApi })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `Gemini API returned ${res.status}`);
    }

    teacherChatMessages.pop();
    const truncatedNote = data.finishReason === "MAX_TOKENS"
      ? "\n\n> 内容较长，本次回复已达到输出上限。你可以继续发送“接着讲”让 AI 继续解释。"
      : "";
    teacherChatMessages.push({ role: "model", text: `${data.reply || "Gemini 没有返回内容。"}${truncatedNote}` });
  } catch (e) {
    teacherChatMessages.pop();
    teacherChatMessages.push({
      role: "model",
      text: `请求 Gemini 失败：${e.message}\n\n请确认后端已配置 GEMINI_API_KEY，并且 FastAPI 服务已重启。`
    });
  }

  renderChatMessages(chatBody);
}

function openTeacherDrawer(selectedText) {
  closeTeacherDrawer(true);
  clearSelectionToolbar();

  const drawer = componentsRoot.querySelector("#intensive-drawer");
  if (!drawer) return;

  const shade = document.createElement("div");
  shade.id = "teacher-chat-shade";
  shade.className = "absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] pointer-events-auto";
  shade.style.zIndex = "60";
  shade.style.opacity = "0";
  shade.style.transition = "opacity 250ms ease";

  const panel = document.createElement("div");
  panel.id = "teacher-chat-drawer";
  panel.className = "absolute top-0 right-0 h-full bg-slate-50 border-l border-slate-200 shadow-2xl pointer-events-auto flex flex-col";
  panel.style.width = "90%";
  panel.style.zIndex = "70";
  panel.style.transform = "translateX(100%)";
  panel.style.transition = "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)";

  panel.innerHTML = `
    <div class="h-16 bg-white border-b border-slate-200 px-5 flex items-center justify-between">
      <div class="min-w-0">
        <div class="text-base font-bold text-slate-900">AI 英语老师</div>
        <div class="text-sm text-slate-500 truncate max-w-[420px]">正在解释：${escapeHtml(selectedText)}</div>
      </div>
      <button id="teacher-chat-close" class="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-all focus:outline-none">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      </button>
    </div>
    <div id="teacher-chat-body" class="flex-1 overflow-y-auto px-5 py-5 space-y-4 bg-slate-50"></div>
    <form id="teacher-chat-form" class="bg-white border-t border-slate-200 p-4 flex items-end gap-3">
      <textarea id="teacher-chat-input" rows="1" class="flex-1 resize-none max-h-28 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400" placeholder="继续追问这个表达、语法或例句..."></textarea>
      <button id="teacher-chat-send" class="h-11 w-11 bg-brand-600 hover:bg-brand-700 text-white rounded-xl flex items-center justify-center shadow-sm active:scale-95 transition-all focus:outline-none">
        <svg class="w-5 h-5 -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7"></path>
        </svg>
      </button>
    </form>
  `;

  drawer.appendChild(shade);
  drawer.appendChild(panel);

  const closeBtn = panel.querySelector("#teacher-chat-close");
  const chatBody = panel.querySelector("#teacher-chat-body");
  const form = panel.querySelector("#teacher-chat-form");
  const input = panel.querySelector("#teacher-chat-input");

  closeBtn.addEventListener("click", () => closeTeacherDrawer(false));
  shade.addEventListener("click", () => closeTeacherDrawer(false));

  setTimeout(() => {
    shade.style.opacity = "1";
    panel.style.transform = "translateX(0)";
    input.focus();
  }, 30);

  const initialPrompt = createTeacherPrompt(selectedText);
  teacherChatMessages = [{
    role: "user",
    text: initialPrompt,
    displayText: `请解释这段选中内容：\n${selectedText}`
  }];
  renderChatMessages(chatBody);
  requestTeacherReply(chatBody, teacherChatMessages.map(({ role, text }) => ({ role, text })));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    input.value = "";
    teacherChatMessages.push({ role: "user", text: question });
    renderChatMessages(chatBody);
    requestTeacherReply(chatBody, teacherChatMessages
      .filter((message) => !message.pending)
      .map(({ role, text }) => ({ role, text })));
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
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
  lockPageScroll();

  console.log("Select-to-Speak: Starting to render intensive listening drawer.");
  
  loadSettings().then(async (settings) => {
     const dict = getTranslationsDict(settings.language);

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
            <span class="text-xs font-semibold text-slate-600 group-hover:text-brand-600">${dict.btn_replay_text}</span>
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
            <p class="sentence-text text-[16px] text-slate-600 font-medium leading-relaxed group-hover:text-slate-800 transition-colors">${escapeHtml(sentence)}</p>
          </div>
          <div class="play-icon opacity-0 group-hover:opacity-100 text-brand-600 transition-opacity self-center flex-shrink-0">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
            </svg>
          </div>
        `;

        // Clicking a sentence triggers playing it
        item.addEventListener("click", (event) => {
          if (event.target.closest(".active-selectable-text")) return;
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

  try {
    const objectUrl = await fetchTtsObjectUrl(sentencesList[index], settings);

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

  const dict = getTranslationsDict(ttsSettings.language);

  if (status === 'loading') {
    indicatorContainer.innerHTML = `
      <span class="flex h-1.5 w-1.5 relative">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
        <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-brand-500"></span>
      </span>
    `;
    indicatorContainer.title = dict.indicator_loading;
  } else if (status === 'loaded') {
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
    `;
    indicatorContainer.title = dict.indicator_loaded;
  } else if (status === 'error') {
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-rose-500 animate-pulse"></span>
    `;
    indicatorContainer.title = dict.indicator_error;
  } else {
    // Default / pending
    indicatorContainer.innerHTML = `
      <span class="inline-flex rounded-full h-1.5 w-1.5 bg-slate-300"></span>
    `;
    indicatorContainer.title = dict.indicator_pending;
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
  clearSelectionToolbar();
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

      let selectableLine = item.querySelector(".active-selectable-text");
      if (!selectableLine) {
        selectableLine = document.createElement("div");
        selectableLine.className = "active-selectable-text mt-3 rounded-xl border border-brand-200 bg-white px-3 py-2 text-[15px] leading-relaxed text-slate-800 shadow-sm cursor-text select-text";
        selectableLine.title = "选择其中一段文字后，可播放或查看 AI 讲解";
        selectableLine.addEventListener("click", (event) => {
          event.stopPropagation();
        });
        bindSelectableSentenceLine(selectableLine);
        const textWrapper = item.querySelector(".flex-1");
        if (textWrapper) textWrapper.appendChild(selectableLine);
      }
      selectableLine.textContent = sentencesList[index];

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

      const selectableLine = item.querySelector(".active-selectable-text");
      if (selectableLine) selectableLine.remove();
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
      const objectUrl = await fetchTtsObjectUrl(sentenceText, ttsSettings);
      activeAudioObjectUrl = objectUrl;
      return objectUrl;
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

function getSelectedTextFromPage() {
  const activeElement = document.activeElement;
  if (
    activeElement &&
    (activeElement.tagName === "TEXTAREA" ||
      (activeElement.tagName === "INPUT" &&
        /^(text|search|url|tel|email|password)$/i.test(activeElement.type || "text"))) &&
    typeof activeElement.selectionStart === "number" &&
    typeof activeElement.selectionEnd === "number"
  ) {
    return activeElement.value
      .slice(activeElement.selectionStart, activeElement.selectionEnd)
      .trim();
  }

  return window.getSelection().toString().trim();
}

function getSelectionAnchorPosition() {
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

  return { selectionX, selectionY };
}

function runSelectionAction(action, providedText) {
  let text = providedText;

  if (!text) {
    try {
      text = getSelectedTextFromPage();
    } catch (e) {
      console.warn("Failed to retrieve selection text dynamically: ", e);
    }
  }

  if (!text) {
    console.log("No text provided and no page selection active.");
    return { status: "no_selection" };
  }

  if (action === "play-selection") {
    const { selectionX, selectionY } = getSelectionAnchorPosition();
    renderFloatingPlayer(text, selectionX, selectionY);
    return { status: "success" };
  }

  if (action === "intensive-listening") {
    renderIntensiveDrawer(text);
    return { status: "success" };
  }

  return { status: "unknown_action" };
}

// Content-side shortcut fallback. Browser command registration can be missing
// or conflict with an existing shortcut; this still works on normal web pages.
document.addEventListener("keydown", (event) => {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;

  const key = event.key.toLowerCase();
  const action =
    key === "y"
      ? "play-selection"
      : key === "h"
        ? "intensive-listening"
        : null;

  if (!action) return;

  event.preventDefault();
  event.stopPropagation();
  runSelectionAction(action);
}, true);

// ==========================================
// 3. LISTEN FOR MESSAGES FROM SERVICE WORKER
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Injected script received command: ", message);

  const { action } = message;
  const result = runSelectionAction(action, message.text);
  
  // Respond to keep channel active
  sendResponse(result);
  return true;
});
