(function () {
    var extensionRoot = new Folder($.getenv("APPDATA") + "/Adobe/CEP/extensions/Veo-Bridge");
    var hostFile = new File(extensionRoot.fsName + "/jsx/host.jsx");
    var resultFile = new File(Folder.temp.fsName + "/veobridge-ae-smoke.json");
    var result = { ping: null, captureProbe: null, error: null };
    try {
        if (!hostFile.exists) { throw new Error("Installed host.jsx not found: " + hostFile.fsName); }
        $.evalFile(hostFile);
        result.ping = $.global.VeoBridge_ping();
        result.captureProbe = $.global.VeoBridge_captureProbe();
    } catch (error) {
        result.error = String(error);
    }
    if (resultFile.open("w")) {
        resultFile.write("{\"ping\":" + (result.ping || "null") + ",\"captureProbe\":" + (result.captureProbe || "null") + ",\"error\":" + (result.error ? "\"" + result.error.replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"" : "null") + "}");
        resultFile.close();
    }
}());
