chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "CLOSE_DISTRACTION_TAB") {
    return;
  }

  const tabId = sender.tab?.id;
  if (typeof tabId === "number") {
    chrome.tabs.remove(tabId);
  }
});
