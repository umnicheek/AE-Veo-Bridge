(function () {
    var extensionRoot = new Folder($.getenv("APPDATA") + "/Adobe/CEP/extensions/Veo-Bridge");
    var hostFile = new File(extensionRoot.fsName + "/jsx/host.jsx");
    var resultFile = new File(Folder.temp.fsName + "/veobridge-ae-capture-smoke.json");
    var comp = null;
    var captureRaw = "null";
    var cleanup = { comp: false, file: false };
    var errorText = null;
    try {
        $.evalFile(hostFile);
        if (!app.project) { app.newProject(); }
        comp = app.project.items.addComp("VeoBridge_Smoke_Тест", 64, 64, 1, 1, 24);
        comp.layers.addSolid([1, 0, 1], "Smoke", 64, 64, 1, 1);
        comp.openInViewer();
        captureRaw = $.global.VeoBridge_captureCurrentFrame();
        try {
            var parsed = eval("(" + captureRaw + ")");
            if (parsed && parsed.path) {
                var captured = new File(parsed.path);
                cleanup.file = !captured.exists || captured.remove();
            }
        } catch (parseError) {}
    } catch (error) {
        errorText = String(error);
    }
    try { if (comp) { comp.remove(); cleanup.comp = true; } } catch (cleanupError) {}
    if (resultFile.open("w")) {
        resultFile.write("{\"capture\":" + captureRaw + ",\"cleanup\":{\"comp\":" + cleanup.comp + ",\"file\":" + cleanup.file + "},\"error\":" + (errorText ? "\"" + errorText.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"" : "null") + "}");
        resultFile.close();
    }
}());
