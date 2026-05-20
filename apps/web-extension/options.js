// options.js - Select-to-Speak settings script

// DOM elements
const voiceSelect = document.getElementById("voice");
const rateInput = document.getElementById("rate");
const saveBtn = document.getElementById("save");
const testBtn = document.getElementById("testConnection");
const statusText = document.getElementById("status");

// Default configurations
const DEFAULTS = {
  voice: "en-US-AvaNeural",
  rate: "+0%"
};

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
    // Keep standard static HTML options in place
    // Ensure selected is set correctly
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
  
  let rate = rateInput.value.trim() || DEFAULTS.rate;
  // Auto-format rate: if it's a number, prepend + and append %
  if (/^\d+$/.test(rate)) {
    rate = `+${rate}%`;
  } else if (/^[+-]\d+$/.test(rate)) {
    rate = `${rate}%`;
  }
  rateInput.value = rate;

  chrome.storage.sync.set({ voice, rate }, () => {
    // Show success transition
    statusText.textContent = "保存成功！";
    statusText.className = "text-xs font-medium text-emerald-600 opacity-100 transition-all duration-300 transform translate-x-0";
    
    setTimeout(() => {
      statusText.className = "text-xs font-medium text-emerald-600 opacity-0 transition-all duration-300 transform translate-x-2";
    }, 2000);
  });
});

// Test Connection
testBtn.addEventListener("click", async () => {
  const apiUrl = getApiUrl();

  testBtn.disabled = true;
  testBtn.textContent = "⚡ 连接中...";

  try {
    const start = Date.now();
    const res = await fetch(`${apiUrl}/api/voices`, { method: 'GET' });
    const duration = Date.now() - start;

    if (res.ok) {
      statusText.textContent = `连接成功! (${duration}ms)`;
      statusText.className = "text-xs font-medium text-emerald-600 opacity-100 transition-all duration-300 transform translate-x-0";
      
      // Reload voices list based on successful connection
      loadVoices(apiUrl, voiceSelect.value);
    } else {
      throw new Error(`Status: ${res.status}`);
    }
  } catch (err) {
    console.error("Connection failed: ", err);
    statusText.textContent = "连接失败，请检查服务是否开启！";
    statusText.className = "text-xs font-medium text-rose-600 opacity-100 transition-all duration-300 transform translate-x-0";
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "⚡ 测试后端连接";
    
    setTimeout(() => {
      statusText.className = "text-xs font-medium text-slate-600 opacity-0 transition-all duration-300 transform translate-x-2";
    }, 3000);
  }
});
