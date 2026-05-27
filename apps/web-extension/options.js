// options.js - Select-to-Speak settings script

// DOM elements
const voiceSelect = document.getElementById("voice");
const rateInput = document.getElementById("rate");
const languageSelect = document.getElementById("language");
const saveBtn = document.getElementById("save");
const testBtn = document.getElementById("testConnection");
const statusText = document.getElementById("status");

// Default configurations
const DEFAULTS = {
  voice: "en-US-AvaNeural",
  rate: "+0%",
  language: "auto"
};

// Translations Dictionary
const TRANSLATIONS = {
  zh: {
    doc_title: "Select-to-Speak 设置中心",
    header_subtitle: "英语精听与朗读助手设置中心",
    tts_settings_title: "TTS 语音设置",
    voice_label: "微软 Edge 默认发音人",
    rate_label: "语速调节 (Rate)",
    lang_settings_title: "界面语言设置",
    lang_label: "选择显示语言",
    lang_auto: "跟随浏览器系统 (Auto)",
    lang_zh: "简体中文",
    lang_en: "English",
    instructions_title: "💡 如何设置语速 (Rate) 说明：",
    instructions_desc: "`edge-tts` 支持通过相对百分比来微调发音的速度。您可以在语速输入框中填写符合规范的字符串：",
    instruction_fast: "语速加速 10% 或 20%，适合进阶听力训练",
    instruction_default: "标准原生语速，微软小娜默认音速",
    instruction_slow: "语速减速 10% 或 20%，适合初学者精听单词",
    btn_test: "⚡ 测试后端连接",
    btn_save: "保存配置",
    status_saved: "保存成功！",
    status_connecting: "⚡ 连接中...",
    status_connect_ok: "连接成功!",
    status_connect_failed: "连接失败，请检查服务是否开启！"
  },
  en: {
    doc_title: "Select-to-Speak Settings Center",
    header_subtitle: "English Intensive Listening & Reading Assistant Settings Center",
    tts_settings_title: "TTS Voice Settings",
    voice_label: "Microsoft Edge Default Voice",
    rate_label: "Speech Rate (Rate)",
    lang_settings_title: "Language Settings",
    lang_label: "Choose Interface Language",
    lang_auto: "Browser Language (Auto)",
    lang_zh: "简体中文 (Simplified Chinese)",
    lang_en: "English",
    instructions_title: "💡 Speech Rate (Rate) Instructions:",
    instructions_desc: "`edge-tts` supports relative percentages to fine-tune speech speed. Enter strings matching standard formats:",
    instruction_fast: "Accelerate 10% or 20%, suitable for advanced listening training",
    instruction_default: "Standard default speech rate",
    instruction_slow: "Decelerate 10% or 20%, suitable for beginner intensive learning",
    btn_test: "⚡ Test Connection",
    btn_save: "Save Settings",
    status_saved: "Saved successfully!",
    status_connecting: "⚡ Connecting...",
    status_connect_ok: "Connected successfully!",
    status_connect_failed: "Connection failed, check if the backend service is running!"
  }
};

// Supported UI Language mapping and default fallback
const SUPPORTED_LANGUAGES = {
  zh: "zh",
  en: "en"
};
const DEFAULT_LANGUAGE = "en";

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
    "doc_title", "header_subtitle", "tts_settings_title", "voice_label", "rate_label",
    "lang_settings_title", "lang_label", "lang_auto", "lang_zh", "lang_en",
    "instructions_title", "instructions_desc", "instruction_fast", "instruction_default",
    "instruction_slow", "btn_test", "btn_save", "status_saved", "status_connecting",
    "status_connect_ok", "status_connect_failed"
  ];
  keys.forEach(key => {
    dict[key] = getMessage(key, storedLang);
  });
  return dict;
}

// Function to translate the options page dynamically
function translateUI(lang) {
  const dict = getTranslationsDict(lang);
  
  // Set document title
  document.title = dict.doc_title;
  
  // Translate other elements
  document.querySelectorAll("[data-i18n]").forEach(element => {
    const key = element.getAttribute("data-i18n");
    if (dict[key]) {
      if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        element.placeholder = dict[key];
      } else {
        element.textContent = dict[key];
      }
    }
  });
}

// Get the hardcoded API URL based on runtime environment (development or production)
function getApiUrl() {
  const isDev = !chrome.runtime.getManifest().update_url;
  const DEV_API_URL = "http://localhost:18002";
  const PROD_API_URL = "https://tts-api.dayansoft.cn"; // Enforce production address
  return isDev ? DEV_API_URL : PROD_API_URL;
}

// Load saved options or defaults
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(DEFAULTS, (settings) => {
    rateInput.value = settings.rate;
    languageSelect.value = settings.language;
    
    // Apply initial translation
    translateUI(settings.language);
    
    // Select the saved voice
    loadVoices(getApiUrl(), settings.voice);
  });
});

// Dynamically load voices from backend, fallback if offline
async function loadVoices(apiUrl, selectedVoice) {
  try {
    const res = await fetch(`${apiUrl}/api/voices`);
    if (!res.ok) throw new Error("Failed to fetch voices");
    
    const data = await res.json();
    if (data && data.voices) {
      voiceSelect.innerHTML = ""; // Clear existing options
      data.voices.forEach(voice => {
        const option = document.createElement("option");
        option.value = voice.id;
        option.textContent = voice.name;
        if (voice.id === selectedVoice) {
          option.selected = true;
        }
        voiceSelect.appendChild(option);
      });
      console.log("Successfully loaded voices from backend.");
    }
  } catch (err) {
    console.warn("Could not fetch voices from backend, using static fallback options: ", err);
    // Keep standard static HTML options in place and ensure selected is correct
    Array.from(voiceSelect.options).forEach(option => {
      if (option.value === selectedVoice) {
        option.selected = true;
      }
    });
  }
}

// Save options
saveBtn.addEventListener("click", () => {
  const voice = voiceSelect.value;
  const language = languageSelect.value;
  
  let rate = rateInput.value.trim() || DEFAULTS.rate;
  // Auto-format rate: if it's a number, prepend + and append %
  if (/^\d+$/.test(rate)) {
    rate = `+${rate}%`;
  } else if (/^[+-]\d+$/.test(rate)) {
    rate = `${rate}%`;
  }
  rateInput.value = rate;

  chrome.storage.sync.set({ voice, rate, language }, () => {
    // Re-apply translations in case language changed
    translateUI(language);
    
    // Show success transition
    const dict = getTranslationsDict(language);
    
    statusText.textContent = dict.status_saved;
    statusText.className = "text-xs font-medium text-emerald-600 opacity-100 transition-all duration-300 transform translate-x-0";
    
    setTimeout(() => {
      statusText.className = "text-xs font-medium text-emerald-600 opacity-0 transition-all duration-300 transform translate-x-2";
    }, 2000);
  });
});

// Test Connection
testBtn.addEventListener("click", async () => {
  const apiUrl = getApiUrl();
  const language = languageSelect.value;
  const dict = getTranslationsDict(language);

  testBtn.disabled = true;
  testBtn.textContent = dict.status_connecting;

  try {
    const start = Date.now();
    const res = await fetch(`${apiUrl}/api/voices`, { method: 'GET' });
    const duration = Date.now() - start;

    if (res.ok) {
      statusText.textContent = `${dict.status_connect_ok} (${duration}ms)`;
      statusText.className = "text-xs font-medium text-emerald-600 opacity-100 transition-all duration-300 transform translate-x-0";
      
      // Reload voices list based on successful connection
      loadVoices(apiUrl, voiceSelect.value);
    } else {
      throw new Error(`Status: ${res.status}`);
    }
  } catch (err) {
    console.error("Connection failed: ", err);
    statusText.textContent = dict.status_connect_failed;
    statusText.className = "text-xs font-medium text-rose-600 opacity-100 transition-all duration-300 transform translate-x-0";
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = dict.btn_test;
    
    setTimeout(() => {
      statusText.className = "text-xs font-medium text-slate-600 opacity-0 transition-all duration-300 transform translate-x-2";
    }, 3000);
  }
});
