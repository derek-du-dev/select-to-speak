// Background script for Select-to-Speak Extension

// Supported UI Language mapping and default fallback
const SUPPORTED_LANGUAGES = {
  zh: "zh",
  en: "en"
};
const DEFAULT_LANGUAGE = "en";

// Translations Dictionary
const TRANSLATIONS = {
  zh: {
    context_menu_play: "播放选中内容 (Ctrl+Shift+Y)",
    context_menu_intensive: "精听选中内容 (Ctrl+Shift+H)"
  },
  en: {
    context_menu_play: "Play Selection (Ctrl+Shift+Y)",
    context_menu_intensive: "Intensive Listening (Ctrl+Shift+H)"
  }
};

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

// Function to update context menu titles based on language
function updateContextMenus(storedLang) {
  const playTitle = getMessage("context_menu_play", storedLang);
  const intensiveTitle = getMessage("context_menu_intensive", storedLang);

  // Remove existing context menus first to avoid duplicate IDs during re-registration
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "play-selection",
      title: playTitle,
      contexts: ["selection"]
    });

    chrome.contextMenus.create({
      id: "intensive-listening",
      title: intensiveTitle,
      contexts: ["selection"]
    });
  });
}

// Initialize on install or startup
chrome.runtime.onInstalled.addListener(() => {
  console.log("Select-to-Speak Extension installed successfully.");
  chrome.storage.sync.get({ language: "auto" }, (items) => {
    updateContextMenus(items.language);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.sync.get({ language: "auto" }, (items) => {
    updateContextMenus(items.language);
  });
});

// Listen for storage changes to update context menus dynamically
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync" && changes.language) {
    updateContextMenus(changes.language.newValue);
  }
});

// Common handler for selection action delivery
function handleSelectionAction(tabId, action, text = null) {
  const message = { action };
  if (text) message.text = text;

  chrome.tabs.sendMessage(tabId, message)
    .catch((error) => {
      console.warn("Content script not ready. Injecting script dynamically...", error);
      
      // Dynamic fallback injection if the content script hasn't loaded automatically
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      }).then(() => {
        // Re-send the message after short delay to allow content script setup
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, message).catch(e => {
            console.error("Failed to send action after dynamic injection: ", e);
          });
        }, 300);
      }).catch(err => {
        console.error("Failed to inject content script dynamically: ", err);
      });
    });
}

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "play-selection" || info.menuItemId === "intensive-listening") {
    const action = info.menuItemId;
    const text = info.selectionText;

    console.log(`Context menu clicked. Action: ${action}, Text: '${text.substring(0, 30)}...'`);
    handleSelectionAction(tab.id, action, text);
  }
});

// Listen for global shortcut keys
chrome.commands.onCommand.addListener((command) => {
  console.log(`Shortcut key command triggered: ${command}`);
  if (command === "play-selection" || command === "intensive-listening") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) return;
      
      // For shortcuts, let content script fetch selection directly using window.getSelection()
      handleSelectionAction(tabs[0].id, command, null);
    });
  }
});
