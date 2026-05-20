// Background script for Select-to-Speak Extension

chrome.runtime.onInstalled.addListener(() => {
  console.log("Select-to-Speak Extension installed successfully.");
  
  // Register context menu items
  chrome.contextMenus.create({
    id: "play-selection",
    title: "播放 Selection",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "intensive-listening",
    title: "精听 Selection",
    contexts: ["selection"]
  });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "play-selection" || info.menuItemId === "intensive-listening") {
    const action = info.menuItemId;
    const text = info.selectionText;

    console.log(`Context menu clicked. Action: ${action}, Text: '${text.substring(0, 30)}...'`);

    // Send selection text and action directly to the content script in the active tab
    chrome.tabs.sendMessage(tab.id, { action, text })
      .catch((error) => {
        console.warn("Content script not ready or cannot be reached. Injecting script...", error);
        
        // Dynamic fallback injection if the content script hasn't loaded automatically
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        }).then(() => {
          // Re-send the message after short delay to allow content script setup
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action, text }).catch(e => {
              console.error("Failed to send action after dynamic injection: ", e);
            });
          }, 300);
        }).catch(err => {
          console.error("Failed to inject content script dynamically: ", err);
        });
      });
  }
});
