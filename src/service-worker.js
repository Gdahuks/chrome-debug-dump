chrome.commands.onCommand.addListener(function(command) {
  if (command === 'dump') {
    chrome.storage.local.set({ triggerDump: Date.now() });
  }
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'captureViewport') {
    captureTab(message.tabId)
      .then(function(dataUrl) { sendResponse({ dataUrl: dataUrl }); })
      .catch(function(err) { sendResponse({ dataUrl: null, error: err.message }); });
    return true;
  }
});

// Capture the visible area of a specific tab's window
function captureTab(tabId) {
  return new Promise(function(resolve, reject) {
    if (!tabId) {
      // Fallback: capture current window
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 85 }, function(dataUrl) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(dataUrl);
      });
      return;
    }
    chrome.tabs.get(tabId, function(tab) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }, function(dataUrl) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(dataUrl);
      });
    });
  });
}
