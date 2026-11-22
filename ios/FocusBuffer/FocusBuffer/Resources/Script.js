// Asks the app to open Settings; ViewController.swift handles the message.
document.getElementById("open-settings").addEventListener("click", () => {
    webkit.messageHandlers.controller.postMessage("open-settings");
});
