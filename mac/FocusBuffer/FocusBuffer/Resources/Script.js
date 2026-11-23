// ViewController.swift calls show() with whether the extension is on.
function show(enabled) {
    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

document.querySelector("button.open-preferences").addEventListener("click", () => {
    webkit.messageHandlers.controller.postMessage("open-preferences");
});
