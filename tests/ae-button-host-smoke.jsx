(function () {
    var extensionRoot = Folder(Folder.userData.fsName + "/Adobe/CEP/extensions/Veo-Bridge");
    var hostFile = File(extensionRoot.fsName + "/jsx/host.jsx");
    var outFile = File(Folder.temp.fsName + "/veobridge-ae-button-host-smoke.json");
    var initialItems = 0;
    var testComp = null;
    var captureResult = "null";
    var captureData = null;
    var pathsResult = "null";
    var createResult = "null";
    var importResult = "null";
    var importCompResult = "null";
    var invalidVideoResult = "null";
    var cleanupOk = true;
    var errorText = "";

    function quote(value) {
        return "\"" + String(value || "").replace(/\\/g, "\\\\").replace(/\"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"";
    }

    try {
        if (!hostFile.exists) { throw new Error("Installed host.jsx not found: " + hostFile.fsName); }
        $.evalFile(hostFile);
        if (!app.project) { app.newProject(); }
        initialItems = app.project.numItems;

        pathsResult = VeoBridge_getPaths();
        createResult = VeoBridge_createCompWithBackground("1x1", "Smoke", 64, 64, 12, 34, 56);

        testComp = app.project.items.addComp("VeoBridge_Button_Smoke_\u0422\u0435\u0441\u0442", 64, 64, 1, 1, 24);
        testComp.layers.addSolid([0.1, 0.7, 0.2], "Smoke", 64, 64, 1, 1);
        testComp.openInViewer();
        captureResult = VeoBridge_captureCurrentFrame();
        captureData = eval("(" + captureResult + ")");
        if (!captureData.ok || !captureData.path) { throw new Error("Capture prerequisite failed: " + captureResult); }

        importResult = VeoBridge_importImage(captureData.path);
        testComp.openInViewer();
        importCompResult = VeoBridge_importImageToActiveComp(captureData.path);
        invalidVideoResult = VeoBridge_importVideo(File(Folder.temp.fsName + "/veobridge-missing.mp4").fsName);
    } catch (error) {
        errorText = String(error);
    }

    try {
        if (captureData && captureData.path) {
            var capturedFile = File(captureData.path);
            if (capturedFile.exists) { cleanupOk = capturedFile.remove() && cleanupOk; }
        }
        while (app.project && app.project.numItems > initialItems) {
            app.project.item(app.project.numItems).remove();
        }
    } catch (cleanupError) {
        cleanupOk = false;
        if (!errorText) { errorText = String(cleanupError); }
    }

    if (outFile.open("w")) {
        outFile.encoding = "UTF-8";
        outFile.write("{\"paths\":" + pathsResult +
            ",\"create\":" + createResult +
            ",\"capture\":" + captureResult +
            ",\"importImage\":" + importResult +
            ",\"importImageToComp\":" + importCompResult +
            ",\"invalidVideo\":" + invalidVideoResult +
            ",\"cleanupOk\":" + (cleanupOk ? "true" : "false") +
            ",\"error\":" + quote(errorText) + "}");
        outFile.close();
    }
}());
