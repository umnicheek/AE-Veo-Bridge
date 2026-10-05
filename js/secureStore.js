(function (global) {
    "use strict";
    var fs = null;
    var path = null;
    var os = null;
    var childProcess = null;
    var cachedApiKey = "";
    var cachedSignature = "";
    var cachedLoadError = "";
    var cachedErrorAtMs = 0;
    var cacheReady = false;
    var ERROR_CACHE_MS = 10000;

    function safeRequire(name) {
        try { return typeof require === "function" ? require(name) : null; } catch (error) { return null; }
    }

    function storePath() {
        var base;
        if (!path || !os || typeof process === "undefined") { return null; }
        base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        return path.join(base, "VeoBridge", "secure-key.json");
    }

    function isAvailable() {
        return !!(fs && path && os && childProcess && typeof childProcess.spawnSync === "function" &&
            typeof Buffer !== "undefined" && typeof process !== "undefined" && process.platform === "win32");
    }

    function invalidateCache() {
        cachedApiKey = "";
        cachedSignature = "";
        cachedLoadError = "";
        cachedErrorAtMs = 0;
        cacheReady = false;
    }

    function fileSignature(filePath) {
        var stat;
        var modified;
        if (!fs || !filePath) { return "unavailable"; }
        try {
            if (!fs.existsSync(filePath)) { return "missing"; }
            stat = fs.statSync(filePath);
            modified = typeof stat.mtimeMs === "number" ? stat.mtimeMs : (stat.mtime && stat.mtime.getTime ? stat.mtime.getTime() : 0);
            return String(modified) + ":" + String(stat.size || 0);
        } catch (error) {
            return "error";
        }
    }

    function runDpapi(script, input) {
        var encoded;
        var result;
        if (!isAvailable()) { throw new Error("DPAPI runtime is unavailable."); }
        encoded = Buffer.from(script, "utf16le").toString("base64");
        result = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
            input: String(input || ""), encoding: "utf8", windowsHide: true, timeout: 15000
        });
        if (result.error || result.status !== 0) { throw new Error("Windows DPAPI operation failed."); }
        return String(result.stdout || "").replace(/^\s+|\s+$/g, "");
    }

    function ensureParent(filePath) {
        var parent = path.dirname(filePath);
        if (!fs.existsSync(parent)) { fs.mkdirSync(parent, { recursive: true }); }
    }

    function saveApiKey(value) {
        var filePath = storePath();
        var tempPath;
        var backupPath;
        var script = "Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))";
        var cipher;
        var hadExisting = false;
        var verified = false;
        if (!filePath || !isAvailable()) { throw new Error("Secure key storage is unavailable."); }
        cipher = runDpapi(script, value);
        ensureParent(filePath);
        tempPath = filePath + ".tmp-" + String(process.pid || 0) + "-" + String(new Date().getTime());
        backupPath = filePath + ".previous";
        fs.writeFileSync(tempPath, JSON.stringify({ version: 1, provider: "windows-dpapi-current-user", ciphertext: cipher }), "utf8");
        try {
            hadExisting = fs.existsSync(filePath);
            if (hadExisting) {
                if (typeof fs.copyFileSync === "function") {
                    fs.copyFileSync(filePath, backupPath);
                } else {
                    fs.writeFileSync(backupPath, fs.readFileSync(filePath));
                }
            }
            try {
                fs.renameSync(tempPath, filePath);
            } catch (renameError) {
                if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
                fs.renameSync(tempPath, filePath);
            }
            invalidateCache();
            if (loadApiKey() !== String(value || "")) { throw new Error("Secure key verification failed."); }
            verified = true;
        } catch (saveError) {
            try { if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); } } catch (removeBadFileError) {}
            if (hadExisting) {
                try { fs.renameSync(backupPath, filePath); } catch (restoreRenameError) {
                    try {
                        if (typeof fs.copyFileSync === "function") { fs.copyFileSync(backupPath, filePath); }
                        else { fs.writeFileSync(filePath, fs.readFileSync(backupPath)); }
                    } catch (restoreCopyError) {}
                }
            }
            invalidateCache();
            throw saveError;
        } finally {
            try { if (fs.existsSync(tempPath)) { fs.unlinkSync(tempPath); } } catch (removeTempError) {}
            if (verified) {
                try { if (fs.existsSync(backupPath)) { fs.unlinkSync(backupPath); } } catch (removeBackupError) {}
            }
        }
        return true;
    }

    function loadApiKey() {
        var filePath = storePath();
        var signature;
        var payload;
        var script = "Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($p)";
        if (!filePath || !isAvailable()) { return ""; }
        signature = fileSignature(filePath);
        if (signature === "missing") {
            cachedApiKey = "";
            cachedSignature = signature;
            cachedLoadError = "";
            cachedErrorAtMs = 0;
            cacheReady = true;
            return "";
        }
        if (cacheReady && signature === cachedSignature) {
            if (cachedLoadError && (new Date().getTime() - cachedErrorAtMs) < ERROR_CACHE_MS) { throw new Error(cachedLoadError); }
            if (cachedLoadError) { cacheReady = false; }
            else { return cachedApiKey; }
        }
        try {
            payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (!payload || payload.provider !== "windows-dpapi-current-user" || !payload.ciphertext) {
                cachedApiKey = "";
            } else {
                cachedApiKey = runDpapi(script, payload.ciphertext);
            }
            cachedSignature = signature;
            cachedLoadError = "";
            cachedErrorAtMs = 0;
            cacheReady = true;
            return cachedApiKey;
        } catch (error) {
            cachedApiKey = "";
            cachedSignature = signature;
            cachedLoadError = String(error && error.message ? error.message : error);
            cachedErrorAtMs = new Date().getTime();
            cacheReady = true;
            throw error;
        }
    }

    fs = safeRequire("fs");
    path = safeRequire("path");
    os = safeRequire("os");
    childProcess = safeRequire("child_process");
    global.VeoBridgeSecureStore = {
        loadApiKey: loadApiKey,
        saveApiKey: saveApiKey,
        getPath: storePath,
        isAvailable: isAvailable,
        invalidateCache: invalidateCache
    };
}(window));
