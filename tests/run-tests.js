"use strict";
require("./ui-button-audit.js");
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var root = path.resolve(__dirname, "..");
var policy = require(path.join(root, "js", "modelPolicy.js"));

if (process.platform === "win32") {
    var os = require("os");
    var secureTemp = fs.mkdtempSync(path.join(os.tmpdir(), "veobridge-secure-test-"));
    var originalAppData = process.env.APPDATA;
    try {
        process.env.APPDATA = secureTemp;
        var secureWindow = loadBrowserScript("js/secureStore.js", {
            require: require,
            process: process,
            Buffer: Buffer
        });
        secureWindow.VeoBridgeSecureStore.saveApiKey("test-key-\u042e-123");
        assert.strictEqual(secureWindow.VeoBridgeSecureStore.loadApiKey(), "test-key-\u042e-123");
        assert.ok(fs.existsSync(secureWindow.VeoBridgeSecureStore.getPath()));
        assert.strictEqual(fs.readFileSync(secureWindow.VeoBridgeSecureStore.getPath(), "utf8").indexOf("test-key"), -1);
        secureWindow.VeoBridgeSecureStore.saveApiKey("replacement-key-456");
        assert.strictEqual(secureWindow.VeoBridgeSecureStore.loadApiKey(), "replacement-key-456");
        assert.strictEqual(fs.existsSync(secureWindow.VeoBridgeSecureStore.getPath() + ".previous"), false);
        assert.strictEqual(fs.readdirSync(path.dirname(secureWindow.VeoBridgeSecureStore.getPath())).filter(function (name) { return /\.tmp-/.test(name); }).length, 0);
    } finally {
        if (typeof originalAppData === "undefined") { delete process.env.APPDATA; } else { process.env.APPDATA = originalAppData; }
        fs.rmSync(secureTemp, { recursive: true, force: true });
    }
}

var secureCacheTemp = fs.mkdtempSync(path.join(require("os").tmpdir(), "veobridge-secure-cache-test-"));
try {
    var dpapiSpawnCount = 0;
    var fakeSecureProcess = { platform: "win32", pid: 303, env: { APPDATA: secureCacheTemp } };
    var fakeChildProcess = {
        spawnSync: function (_exe, _args, options) {
            var input = String(options && options.input || "");
            var output;
            dpapiSpawnCount += 1;
            if (input.indexOf("cipher:") === 0) {
                output = Buffer.from(input.slice(7), "base64").toString("utf8");
            } else {
                output = "cipher:" + Buffer.from(input, "utf8").toString("base64");
            }
            return { status: 0, stdout: output };
        }
    };
    var fakeSecureRequire = function (name) {
        return name === "child_process" ? fakeChildProcess : require(name);
    };
    var cachedSecureWindow = loadBrowserScript("js/secureStore.js", {
        require: fakeSecureRequire,
        process: fakeSecureProcess,
        Buffer: Buffer
    });
    assert.strictEqual(cachedSecureWindow.VeoBridgeSecureStore.isAvailable(), true);
    cachedSecureWindow.VeoBridgeSecureStore.saveApiKey("cached-key");
    assert.strictEqual(dpapiSpawnCount, 2, "saving and verifying should invoke DPAPI exactly twice");
    assert.strictEqual(cachedSecureWindow.VeoBridgeSecureStore.loadApiKey(), "cached-key");
    assert.strictEqual(cachedSecureWindow.VeoBridgeSecureStore.loadApiKey(), "cached-key");
    assert.strictEqual(dpapiSpawnCount, 2, "repeated reads of an unchanged key must use the in-process cache");
} finally {
    fs.rmSync(secureCacheTemp, { recursive: true, force: true });
}

var settingsTemp = fs.mkdtempSync(path.join(require("os").tmpdir(), "veobridge-settings-test-"));
try {
    var secureLoadCount = 0;
    var secureSaveCount = 0;
    var fakeSettingsProcess = { platform: "win32", pid: 404, env: { APPDATA: settingsTemp } };
    var settingsWindow = loadBrowserScript("js/settingsStore.js", {
        require: require,
        process: fakeSettingsProcess,
        VeoBridgeSecureStore: {
            isAvailable: function () { return true; },
            loadApiKey: function () { secureLoadCount += 1; return "stored-key"; },
            saveApiKey: function () { secureSaveCount += 1; return true; }
        }
    });
    settingsWindow.VeoBridgeSettings.saveSettings({ modelId: "veo-3.1-fast-generate-preview" });
    settingsWindow.VeoBridgeSettings.saveSettings({ window: { gallery: { width: 1200 } } });
    assert.strictEqual(secureLoadCount, 0, "non-key settings writes must not synchronously decrypt the API key");
    assert.strictEqual(secureSaveCount, 0, "non-key settings writes must not rewrite the API key");
    assert.strictEqual(settingsWindow.VeoBridgeSettings.loadSettings().apiKey, "stored-key");
    assert.strictEqual(secureLoadCount, 1);
} finally {
    fs.rmSync(settingsTemp, { recursive: true, force: true });
}

var portableSettingsTemp = fs.mkdtempSync(path.join(require("os").tmpdir(), "veobridge-portable-settings-test-"));
try {
    var fakePortableProcess = { platform: "darwin", pid: 505, env: {} };
    var fakePortableRequire = function (name) {
        if (name === "os") { return { homedir: function () { return portableSettingsTemp; } }; }
        return require(name);
    };
    var portableSettingsWindow = loadBrowserScript("js/settingsStore.js", {
        require: fakePortableRequire,
        process: fakePortableProcess,
        VeoBridgeSecureStore: {
            isAvailable: function () { return false; },
            loadApiKey: function () { throw new Error("must not load"); },
            saveApiKey: function () { throw new Error("must not save"); }
        }
    });
    portableSettingsWindow.VeoBridgeSettings.saveSettings({ apiKey: "portable-key" });
    assert.strictEqual(portableSettingsWindow.VeoBridgeSettings.loadSettings().apiKey, "portable-key", "platforms without DPAPI must retain a usable key");
} finally {
    fs.rmSync(portableSettingsTemp, { recursive: true, force: true });
}

function loadBrowserScript(relativePath, additions) {
    var window = Object.assign({
        console: console,
        setInterval: function () { return 1; },
        clearInterval: function () {},
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        Buffer: Buffer
    }, additions || {});
    var context = Object.assign({ window: window, console: console, Promise: Promise, Buffer: Buffer, setTimeout: setTimeout }, additions || {});
    vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), "utf8"), context, { filename: relativePath });
    return window;
}

assert.strictEqual(policy.normalizeImageModel("gemini-3.1-flash-image-preview"), "gemini-3.1-flash-image");
assert.strictEqual(policy.normalizeImageModel("gemini-2.5-flash-image"), "gemini-3.1-flash-image");
assert.strictEqual(policy.normalizeVideoModel("veo-3.0-generate-001"), "veo-3.1-generate-preview");
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-lite-generate-preview", mode: "reference", durationSeconds: 4 }).allowedDurations, [8]);
assert.strictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-lite-generate-preview", mode: "reference", durationSeconds: 8 }).allowReferenceMode, false);
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-generate-preview", mode: "frames", hasStart: true, hasEnd: true, durationSeconds: 4 }).allowedDurations, [4, 6, 8]);
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-generate-preview", mode: "text", durationSeconds: 8 }).allowedResolutions, ["720p", "1080p", "4k"]);

["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"].forEach(function (modelId) {
    [4, 6].forEach(function (duration) {
        assert.deepStrictEqual(policy.getVideoConstraints({ modelId: modelId, mode: "frames", durationSeconds: duration }).allowedResolutions, ["720p"]);
    });
    assert.deepStrictEqual(policy.getVideoConstraints({ modelId: modelId, mode: "frames", durationSeconds: 8 }).allowedAspectRatios, ["16:9", "9:16"]);
});
assert.strictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-fast-generate-preview", mode: "reference", durationSeconds: 8 }).allowReferenceMode, true);
assert.strictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-lite-generate-preview", mode: "extend", durationSeconds: 8 }).allowExtendMode, false);
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-lite-generate-preview", mode: "frames", durationSeconds: 8 }).allowedResolutions, ["720p", "1080p"]);

var stateWindow = loadBrowserScript("js/sharedState.js");
var migrated = stateWindow.VeoBridgeState._testNormalizeState({
    stateVersion: 3,
    shots: [{ id: "shot-1", path: "frame.png" }],
    videos: [{ id: "video-1", path: "clip.mp4", model: "veo-3.0-generate-001" }],
    images: [{ id: "image-old", path: "old.png", model: "gemini-2.5-flash-image" }], pendingJobs: [], refs: [], videoRefs: [],
    imageGenSettings: { model: "gemini-3.1-flash-image-preview" }
});
assert.strictEqual(migrated.stateVersion, 8);
assert.strictEqual(migrated.stateRevision, 0);
assert.strictEqual(migrated.videoGenSettings.seed, null);
assert.strictEqual(migrated.imageGenSettings.model, "gemini-3.1-flash-image");
assert.strictEqual(migrated.videos[0].model, "veo-3.0-generate-001", "history remains readable");
assert.strictEqual(migrated.images[0].model, "gemini-2.5-flash-image", "image history remains readable");
var cleanedRefsState = stateWindow.VeoBridgeState._testNormalizeState({
    stateVersion: 7,
    pendingJobs: [{ id: "job-transport", requestTransport: "bytes", referencePlacement: "instances", errorCode: "HTTP_ERROR", errorStatusCode: 400, errorDetails: "raw Google detail" }],
    videos: [{ id: "video-transport", path: "clip.mp4", requestTransport: "inline", referencePlacement: "parameters", fallbackReason: "legacy rejected" }],
    refs: [null, {}, { id: "ref-1", path: "frame.png" }],
    videoRefs: [null, {}, { id: "video-ref-1", path: "ingredient.jpg" }]
});
assert.strictEqual(cleanedRefsState.refs.length, 1, "empty image references must not survive normalization");
assert.strictEqual(cleanedRefsState.videoRefs.length, 1, "empty video references must not survive normalization");
assert.strictEqual(cleanedRefsState.pendingJobs[0].requestTransport, "bytes");
assert.strictEqual(cleanedRefsState.pendingJobs[0].errorDetails, "raw Google detail");
assert.strictEqual(cleanedRefsState.videos[0].requestTransport, "inline");

var recoveredState = stateWindow.VeoBridgeState._testNormalizeState({
    stateVersion: 7,
    pendingJobs: [
        { id: "queued", kind: "video", status: "queued" },
        { id: "uploading", kind: "video", status: "uploading" },
        { id: "accepted", kind: "video", status: "polling", operationName: "operations/accepted" },
        { id: "paused", kind: "video", status: "paused" }
    ]
});
assert.strictEqual(recoveredState.pendingJobs[0].status, "waiting_resume");
assert.strictEqual(recoveredState.pendingJobs[0].resumeRequired, true);
assert.strictEqual(recoveredState.pendingJobs[1].status, "needs_review");
assert.strictEqual(recoveredState.pendingJobs[2].status, "polling");
assert.strictEqual(recoveredState.pendingJobs[3].status, "paused");
assert.strictEqual(recoveredState.pendingJobsLease, null);

var largeState = { stateVersion: 7, shots: [], videos: [], images: [], pendingJobs: [], refs: [], videoRefs: [] };
var largeIndex;
for (largeIndex = 0; largeIndex < 1000; largeIndex += 1) {
    largeState.videos.push({ id: "v-" + largeIndex, path: "clip-" + largeIndex + ".mp4", prompt: "test" });
}
var benchmarkStart = Date.now();
assert.strictEqual(stateWindow.VeoBridgeState._testNormalizeState(largeState).videos.length, 1000);
assert.ok(Date.now() - benchmarkStart < 1000, "normalizing 1000 records should stay below one second");

var queueWindow = loadBrowserScript("js/gallery/queue.js");
var queue = queueWindow.VeoBridgeGalleryModules.queue.create();
assert.strictEqual(queue.normalizeStatus("paused"), "paused", "paused jobs must not normalize back to queued");
assert.strictEqual(queue.recoveryStatus({ kind: "video", status: "queued" }), "waiting_resume");
assert.strictEqual(queue.recoveryStatus({ kind: "video", status: "uploading" }), "needs_review");
assert.strictEqual(queue.recoveryStatus({ kind: "video", status: "polling", operationName: "operations/1" }), "polling");
assert.strictEqual(queue.isAutomaticCandidate({ kind: "video", status: "waiting_resume" }), false);
assert.strictEqual(queue.isAutomaticCandidate({ kind: "video", status: "polling", operationName: "operations/1" }), true);
assert.strictEqual(queue.classifyFailure({ code: "QUOTA_EXHAUSTED", statusCode: 429 }), "quota_paused");
assert.strictEqual(queue.classifyFailure({ code: "POST_ACCEPTANCE_UNKNOWN" }), "needs_review");
assert.strictEqual(queue.classifyFailure({ code: "RATE_LIMIT_TRANSIENT", statusCode: 429 }), "waiting_resume");
assert.strictEqual(queue.leaseRetryDelay({ expiresAt: 1100 }, 1000), 140);

var actionsWindow = loadBrowserScript("js/gallery/actions.js");
var redactedSettings = actionsWindow.VeoBridgeGalleryModules.actions._testRedactSecrets({ apiKey: "AIza123456789012345678901234567890", nested: { authorization: "Bearer private" } });
assert.strictEqual(redactedSettings.apiKey, "[REDACTED]");
assert.strictEqual(redactedSettings.nested.authorization, "[REDACTED]");
assert.strictEqual(actionsWindow.VeoBridgeGalleryModules.actions._testRedactSecretText('{"apiKey":"AIza123456789012345678901234567890"}').indexOf("AIza"), -1);

var apiWindow = loadBrowserScript("js/veoApi.js", { VeoBridgeModelPolicy: policy });
var videoBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "reference", prompt: "x", durationSeconds: 4, resolution: "4k", references: [{ data: "AA==", mimeType: "image/png" }] });
assert.strictEqual(videoBody.parameters.durationSeconds, 8);
assert.strictEqual(videoBody.instances[0].referenceImages.length, 1);
assert.strictEqual(videoBody.instances[0].referenceImages[0].image.bytesBase64Encoded, "AA==", "legacy bytes transport is the predictLongRunning default");
assert.strictEqual(videoBody.instances[0].referenceImages[0].image.mimeType, "image/png");
var inlineVideoBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "interpolation", prompt: "x", startImageBase64: "AA==", endImageBase64: "BB==", mimeType: "image/png", mediaTransport: "inline" });
assert.strictEqual(inlineVideoBody.instances[0].image.inlineData.data, "AA==");
assert.strictEqual(inlineVideoBody.instances[0].lastFrame.inlineData.data, "BB==");
var referenceParametersBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "reference", prompt: "x", references: [{ data: "AA==", mimeType: "image/png" }], referenceInParameters: true });
assert.strictEqual(referenceParametersBody.instances[0].referenceImages, undefined);
assert.strictEqual(referenceParametersBody.parameters.referenceImages[0].image.bytesBase64Encoded, "AA==");
var seededBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "text", prompt: "x", durationSeconds: 6, resolution: "720p", seed: 42 });
assert.strictEqual(seededBody.parameters.seed, 42);
var unseededBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "text", prompt: "x" });
assert.strictEqual(Object.prototype.hasOwnProperty.call(unseededBody.parameters, "seed"), false);
var extendBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "extend", prompt: "continue", durationSeconds: 4, resolution: "4k", seed: 7, sourceVideoBase64: "AA==" });
assert.strictEqual(extendBody.instances[0].video.mimeType, "video/mp4");
assert.strictEqual(extendBody.instances[0].video.bytesBase64Encoded, "AA==");
var inlineExtendBody = apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "extend", prompt: "continue", sourceVideoBase64: "AA==", mediaTransport: "inline" });
assert.strictEqual(inlineExtendBody.instances[0].video.inlineData.mimeType, "video/mp4");
assert.strictEqual(inlineExtendBody.instances[0].video.inlineData.data, "AA==");
assert.strictEqual(extendBody.parameters.durationSeconds, 8);
assert.strictEqual(extendBody.parameters.resolution, "720p");
assert.strictEqual(extendBody.parameters.seed, 7);
assert.strictEqual(extendBody.parameters.personGeneration, "allow_all");
assert.strictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-generate-preview", mode: "extend" }).allowExtendMode, true);
assert.strictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-lite-generate-preview", mode: "extend" }).allowExtendMode, false);
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-generate-preview", mode: "extend", durationSeconds: 4 }).allowedDurations, [8]);
assert.deepStrictEqual(policy.getVideoConstraints({ modelId: "veo-3.1-generate-preview", mode: "extend", durationSeconds: 8 }).allowedResolutions, ["720p"]);
assert.throws(function () {
    apiWindow.VeoApi._testBuildPredictRequestBody({ mode: "text", prompt: "x", seed: 1.5 });
}, /integer/);
var bytesFieldError = new Error("HTTP 400: Unknown name \"bytesBase64Encoded\": Cannot find field.");
bytesFieldError.statusCode = 400;
assert.strictEqual(apiWindow.VeoApi._testIsMediaTransportError(bytesFieldError, "bytes"), true);
assert.strictEqual(apiWindow.VeoApi._testIsMediaTransportError(bytesFieldError, "inline"), false);
var authError = new Error("HTTP 403: image input access denied for this project");
authError.statusCode = 403;
assert.strictEqual(apiWindow.VeoApi._testIsImageFeatureAccessError(authError), true);
assert.strictEqual(apiWindow.VeoApi._testIsImageFeatureAccessError(bytesFieldError), false, "wire-format failures must not be reported as key access failures");
assert.strictEqual(apiWindow.VeoApi._testCreateHttpError(403, "https://example.test", "Billing account required", { status: "PERMISSION_DENIED" }, {}).code, "BILLING_RESTRICTED");
assert.strictEqual(apiWindow.VeoApi._testCreateHttpError(401, "https://example.test", "Invalid key", null, {}).code, "HTTP_ERROR");
assert.strictEqual(apiWindow.VeoApi._testCreateHttpError(429, "https://example.test", "Temporary rate limit", { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" }] }, {}).retryAfterMs, 0);
var imageBody = apiWindow.VeoApi._testBuildImageGenerateRequestBody({ prompt: "x", references: [], aspectRatio: "16:9", imageSize: "2K" }, true, true);
assert.strictEqual(imageBody.generationConfig.imageConfig.imageSize, "2K");
var interactionBody = apiWindow.VeoApi._testBuildImageInteractionRequestBody({ prompt: "x", references: [{ mimeType: "image/png", data: "AA==" }], aspectRatio: "16:9", imageSize: "2K" });
assert.strictEqual(interactionBody.model, "gemini-3.1-flash-image");
assert.strictEqual(interactionBody.input[1].type, "image");
assert.strictEqual(interactionBody.response_format.mime_type, "image/jpeg");
assert.strictEqual(interactionBody.response_format.image_size, "2K");
assert.strictEqual(apiWindow.VeoApi._testExtractImageInlineData({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AA==" } }] } }] }).data, "AA==");
assert.strictEqual(apiWindow.VeoApi._testExtractImageInlineData({ output_image: { mime_type: "image/png", data: "BB==" } }).data, "BB==");
assert.strictEqual(apiWindow.VeoApi._testExtractImageInlineData({ steps: [{ content: [{ type: "image", mime_type: "image/jpeg", data: "CC==" }] }] }).data, "CC==");

var observerCallback;
function FakeObserver(callback) { observerCallback = callback; this.observe = function () {}; this.disconnect = function () {}; }
var renderWindow = loadBrowserScript("js/gallery/render.js", { IntersectionObserver: FakeObserver });
var renderAdapter = renderWindow.VeoBridgeGalleryModules.render.create({});
var fakeVideos = [];
for (largeIndex = 0; largeIndex < 15; largeIndex += 1) {
    fakeVideos.push({
        tagName: "VIDEO", attrs: { "data-media-src": "file:///clip-" + largeIndex + ".mp4" },
        getAttribute: function (key) { return this.attrs[key] || ""; },
        setAttribute: function (key, value) { this.attrs[key] = value; },
        removeAttribute: function (key) { delete this.attrs[key]; },
        pause: function () {}, load: function () {}
    });
}
renderAdapter.observeLazyMedia({ querySelectorAll: function () { return fakeVideos; } });
observerCallback(fakeVideos.map(function (video) { return { target: video, isIntersecting: true }; }));
assert.strictEqual(fakeVideos.filter(function (video) { return !!video.attrs.src; }).length, 10, "only ten video sources stay active");

console.log("All Veo Bridge tests passed.");
