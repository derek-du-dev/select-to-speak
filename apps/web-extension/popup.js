// popup.js - Select-to-Speak Manual Popup

const TRANSLATIONS = {
  zh: {
    doc_title: "Select-to-Speak 使用手册",
    header_subtitle: "英语精听与朗读助手使用手册",
    quick_start_title: "🚀 极速上手",
    step_1: "在任意网页上，鼠标划词选择一段英文文本。",
    step_2: "右键菜单提供两种智能学习模式：",
    mode_read: "<b>朗读模式</b>: 轻量悬浮面板播放选中文本",
    mode_listen: "<b>精听模式</b>: spaCy 智能切分，逐句精读训练",
    step_3: "或者直接使用以下全局快捷键（极速推荐）：",
    shortcut_read: "朗读选中",
    shortcut_listen: "精听选中",
    features_title: "✨ 黄金功能",
    feat_cache_title: "⚡ 极速离线预加载",
    feat_cache_desc: "精听抽屉提前缓存后续音频，实现零延迟、零卡顿听力体验。",
    feat_loop_title: "🔁 单句循环攻克",
    feat_loop_desc: "开启单句循环模式，逐个击破英语单词和发音弱项盲区。",
    running_status: "FastAPI 后端已就绪",
    btn_settings: "设置中心"
  },
  en: {
    doc_title: "Select-to-Speak Manual",
    header_subtitle: "English Listening & Reading Assistant Manual",
    quick_start_title: "🚀 Quick Start",
    step_1: "Select any English text on a webpage using your mouse.",
    step_2: "Right-click selection for two smart learning modes:",
    mode_read: "<b>Reading Mode</b>: Play selection via a floating player panel",
    mode_listen: "<b>Intensive Listening</b>: spaCy smart segmenting & sentence drawer",
    step_3: "Or directly use these global keyboard shortcuts (Highly Recommended):",
    shortcut_read: "Read Selection",
    shortcut_listen: "Intensive Listening",
    features_title: "✨ Premium Features",
    feat_cache_title: "⚡ Ultra-fast Preload Cache",
    feat_cache_desc: "Preloads upcoming sentences to guarantee a completely lag-free listening experience.",
    feat_loop_title: "🔁 Sentence Loop Training",
    feat_loop_desc: "Toggle loops on a single sentence to master difficult words and pronunciation weak spots.",
    running_status: "FastAPI Backend Active",
    btn_settings: "Settings Center"
  }
};

function getLanguage(storedLang) {
  const lang = storedLang || "auto";
  if (lang === "auto") {
    const uiLang = chrome.i18n.getUILanguage().toLowerCase();
    return uiLang.startsWith("zh") ? "zh" : "en";
  }
  return lang;
}

function translateUI(lang) {
  const resolvedLang = getLanguage(lang);
  const dict = TRANSLATIONS[resolvedLang] || TRANSLATIONS.en;
  
  // Update document title
  document.title = dict.doc_title;
  
  // Translate nodes with data-i18n
  document.querySelectorAll("[data-i18n]").forEach(element => {
    const key = element.getAttribute("data-i18n");
    if (dict[key]) {
      // Use innerHTML for elements that might contain HTML tags
      if (element.querySelector("b") || dict[key].includes("<b") || dict[key].includes("<span")) {
        element.innerHTML = dict[key];
      } else {
        element.textContent = dict[key];
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get({ language: "auto" }, (settings) => {
    translateUI(settings.language);
  });

  // Bind settings button click
  document.getElementById("openSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
});
