"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var nodeUrl = require("url");
var root = path.resolve(__dirname, "..");
var policy = require(path.join(root, "js", "modelPolicy.js"));

function FakeImage() {
    this.naturalWidth = 64;
    this.naturalHeight = 64;
}
Object.defineProperty(FakeImage.prototype, "src", {
    set: function () {
        var self = this;
        setTimeout(function () { self.onload(); }, 0);
    }
});

function makeHttpClient(responses, calls) {
    return {
        request: function (options, callback) {
            var body = null;
            var errorHandler = null;
            return {
                on: function (name, handler) {
                    if (name === "error") { errorHandler = handler; }
                },
                write: function (value) { body = Buffer.from(value).toString("utf8"); },
                end: function () {
                    var next = responses.shift();
                    var handlers = {};
                    calls.push({ method: options.method, hostname: options.hostname, path: options.path, headers: options.headers || {}, body: body ? JSON.parse(body) : null });
                    if (!next) {
                        if (errorHandler) { errorHandler(new Error("Unexpected request")); }
                        return;
                    }
                    if (next.error) {
                        if (errorHandler) { errorHandler(next.error); }
                        return;
                    }
                    callback({
                        statusCode: next.statusCode,
                        headers: next.headers || {},
                        on: function (name, handler) {
                            handlers[name] = handler;
                            if (name === "end") {
                                setTimeout(function () {
                                    if (handlers.data) { handlers.data(Buffer.from(JSON.stringify(next.payload || {}))); }
                                    handlers.end();
                                }, 0);
                            }
                        }
                    });
                }
            };
        }
    };
}

function loadApi(responses, calls) {
    var client = makeHttpClient(responses, calls);
    var fakeDocument = {
        createElement: function () {
            return {
                getContext: function () { return { drawImage: function () {} }; },
                toDataURL: function () { return "data:image/png;base64,AA=="; }
            };
        }
    };
    var window = { VeoBridgeModelPolicy: policy, setTimeout: setTimeout, clearTimeout: clearTimeout };
    var context = {
        window: window,
        Image: FakeImage,
        document: fakeDocument,
        Promise: Promise,
        Buffer: Buffer,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        console: console,
        require: function (name) {
            if (name === "http" || name === "https") { return client; }
            if (name === "url") { return nodeUrl; }
            if (name === "fs") { return fs; }
            if (name === "path") { return path; }
            return require(name);
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "js", "veoApi.js"), "utf8"), context, { filename: "js/veoApi.js" });
    return window.VeoApi;
}

function generateUntilPolling(api, onOperation) {
    return api.generateVideo({
        apiKey: "test-key",
        prompt: "transport test",
        mode: "image",
        startShotPath: "C:/Temp/frame.png",
        modelId: "veo-3.1-generate-preview",
        aspectRatio: "16:9",
        durationSeconds: 8,
        resolution: "720p",
        onOperation: onOperation,
        shouldCancel: function () { return true; }
    });
}

async function run() {
    var calls = [];
    var api = loadApi([{ statusCode: 200, payload: { name: "operations/accepted" } }], calls);
    var acceptedInfo = null;
    api._testSetPreferredPredictMediaTransport("bytes");
    await generateUntilPolling(api, function (info) { acceptedInfo = info; }).catch(function () { return null; });
    assert.strictEqual(calls.length, 1, "an accepted operation must never trigger a second POST");
    assert.strictEqual(calls[0].body.instances[0].image.bytesBase64Encoded, "AA==");
    assert.strictEqual(acceptedInfo.attemptCount, 1, "the initial POST counts as one submission attempt");

    calls = [];
    api = loadApi([
        { statusCode: 400, payload: { error: { message: "Unknown name bytesBase64Encoded: Cannot find field." } } },
        { statusCode: 200, payload: { name: "operations/inline-accepted" } },
        { statusCode: 200, payload: { name: "operations/inline-remembered" } }
    ], calls);
    api._testSetPreferredPredictMediaTransport("bytes");
    await generateUntilPolling(api).catch(function () { return null; });
    assert.strictEqual(calls.length, 2, "an explicit bytes field error must trigger exactly one inline fallback");
    assert.strictEqual(calls[0].body.instances[0].image.bytesBase64Encoded, "AA==");
    assert.strictEqual(calls[1].body.instances[0].image.inlineData.data, "AA==");
    await generateUntilPolling(api).catch(function () { return null; });
    assert.strictEqual(calls.length, 3, "the successful fallback transport must be remembered for the session");
    assert.strictEqual(calls[2].body.instances[0].image.inlineData.data, "AA==");

    calls = [];
    api = loadApi([
        { statusCode: 400, payload: { error: { message: "bytesBase64Encoded isn't supported" } } },
        { statusCode: 400, payload: { error: { message: "inlineData isn't supported" } } }
    ], calls);
    api._testSetPreferredPredictMediaTransport("bytes");
    var transportError = null;
    try { await generateUntilPolling(api); } catch (error) { transportError = error; }
    assert.strictEqual(calls.length, 2, "both rejected formats must stop after one compatibility fallback");
    assert.ok(transportError && transportError.code === "MEDIA_TRANSPORT_UNSUPPORTED");
    assert.ok(!/key\/project/i.test(transportError.message), "transport errors must not be masked as API-key errors");
    assert.strictEqual(transportError.details, "inlineData isn't supported");

    calls = [];
    api = loadApi([
        { statusCode: 400, payload: { error: { message: "Invalid JSON payload: Unknown name referenceImages at instances[0]" } } },
        { statusCode: 200, payload: { name: "operations/reference-accepted" } }
    ], calls);
    api._testSetPreferredPredictMediaTransport("bytes");
    var referenceInputs = api._testBuildPredictRequestBody({ mode: "text", prompt: "array factory" }).instances;
    referenceInputs.length = 0;
    referenceInputs.push({ path: "C:/Temp/reference.png", mimeType: "image/png" });
    await api.generateVideo({
        apiKey: "test-key",
        prompt: "reference placement test",
        mode: "reference",
        referenceImages: referenceInputs,
        modelId: "veo-3.1-generate-preview",
        aspectRatio: "16:9",
        durationSeconds: 8,
        resolution: "720p",
        shouldCancel: function () { return true; }
    }).catch(function () { return null; });
    assert.strictEqual(calls.length, 2, "an explicit referenceImages placement error must trigger one placement fallback");
    assert.ok(calls[0].body.instances[0].referenceImages);
    assert.ok(calls[1].body.parameters.referenceImages);

    calls = [];
    api = loadApi([{ statusCode: 403, payload: { error: { message: "Image input access denied for this project" } } }], calls);
    api._testSetPreferredPredictMediaTransport("bytes");
    var accessError = null;
    try { await generateUntilPolling(api); } catch (error) { accessError = error; }
    assert.strictEqual(calls.length, 1, "access errors must not retry another transport");
    assert.ok(accessError, "the original access failure must be returned");
    assert.strictEqual(accessError.code, "IMAGE_INPUT_ACCESS_DENIED");
    assert.strictEqual(accessError.statusCode, 403);
    assert.strictEqual(accessError.details, "Image input access denied for this project");
    assert.ok(/Image input access denied/.test(accessError.originalMessage));

    calls = [];
    api = loadApi([{ statusCode: 429, payload: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details." } } }], calls);
    var quotaError = null;
    try { await generateUntilPolling(api); } catch (error) { quotaError = error; }
    assert.strictEqual(calls.length, 1, "exhausted quota must not repeat a billable POST");
    assert.strictEqual(quotaError.code, "QUOTA_EXHAUSTED");
    assert.strictEqual(quotaError.statusCode, 429);
    assert.ok(/exceeded your current quota/i.test(quotaError.details));
    assert.ok(quotaError.errorPayload && quotaError.errorPayload.status === "RESOURCE_EXHAUSTED");

    calls = [];
    api = loadApi([
        { statusCode: 429, headers: { "retry-after": "0" }, payload: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Temporary high load, try again." } } },
        { statusCode: 200, payload: { name: "operations/retried-once" } }
    ], calls);
    var retryEvents = [];
    var transientError = null;
    await api.generateVideo({
        apiKey: "test-key", prompt: "retry test", mode: "text", modelId: "veo-3.1-generate-preview",
        aspectRatio: "16:9", durationSeconds: 8, resolution: "720p",
        onStatus: function (stage, details) { if (stage === "Retrying") { retryEvents.push(details); } },
        shouldCancel: function () { return true; }
    }).catch(function (error) { transientError = error; return null; });
    assert.strictEqual(calls.length, 2, "an explicitly rejected transient 429 may retry once; error=" + (transientError ? transientError.code + ":" + transientError.message : "none"));
    assert.strictEqual(retryEvents.length, 1);
    assert.strictEqual(retryEvents[0].attemptCount, 2);

    calls = [];
    api = loadApi([
        { statusCode: 429, payload: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Temporary high load, try again." } } },
        { statusCode: 200, payload: { name: "operations/must-not-be-used" } }
    ], calls);
    var noDelayRateError = null;
    try { await generateUntilPolling(api); } catch (error) { noDelayRateError = error; }
    assert.strictEqual(calls.length, 1, "a transient 429 without Retry-After/RetryInfo must wait for manual Resume");
    assert.strictEqual(noDelayRateError.code, "RATE_LIMIT_TRANSIENT");

    calls = [];
    api = loadApi([{ statusCode: 200, payload: {} }], calls);
    var missingOperationError = null;
    try { await generateUntilPolling(api); } catch (error) { missingOperationError = error; }
    assert.strictEqual(calls.length, 1, "a successful response without operationName must never be submitted again");
    assert.strictEqual(missingOperationError.code, "POST_ACCEPTANCE_UNKNOWN");

    calls = [];
    var timeoutFailure = new Error("Request timed out before the server response was received.");
    timeoutFailure.code = "REQUEST_TIMEOUT";
    api = loadApi([{ error: timeoutFailure }], calls);
    var timeoutError = null;
    try { await api.generateVideo({ apiKey: "test-key", prompt: "timeout", mode: "text", modelId: "veo-3.1-generate-preview", aspectRatio: "16:9", durationSeconds: 8, resolution: "720p" }); } catch (error) { timeoutError = error; }
    assert.strictEqual(calls.length, 1, "a timed-out POST must never be submitted again automatically");
    assert.strictEqual(timeoutError.code, "POST_ACCEPTANCE_UNKNOWN");

    calls = [];
    api = loadApi([
        { statusCode: 503, headers: { "retry-after": "0" }, payload: { error: { code: 503, message: "poll unavailable" } } },
        { statusCode: 200, payload: { done: false } }
    ], calls);
    await api._testRequestJson("https://api.example.test/operations/safe", { method: "GET" });
    assert.strictEqual(calls.length, 2, "safe polling GET requests may retry a transient 5xx");

    calls = [];
    api = loadApi([
        { statusCode: 302, headers: { location: "https://download.example.test/video" } },
        { statusCode: 200, payload: { ok: true } }
    ], calls);
    await api._testRequestJson("https://api.example.test/start", {
        method: "GET",
        maxRetries: 0,
        headers: { "x-goog-api-key": "must-not-cross-origin", "Authorization": "Bearer must-not-cross-origin", "X-Trace": "keep" }
    });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].hostname, "download.example.test");
    assert.strictEqual(calls[1].headers["x-goog-api-key"], undefined, "API key must be stripped on a cross-origin redirect");
    assert.strictEqual(calls[1].headers.Authorization, undefined, "Authorization must be stripped on a cross-origin redirect");
    assert.strictEqual(calls[1].headers["X-Trace"], "keep");

    calls = [];
    api = loadApi([{ statusCode: 503, payload: { error: { code: 503, message: "backend unavailable" } } }], calls);
    var uncertainError = null;
    try { await api.generateVideo({ apiKey: "test-key", prompt: "uncertain", mode: "text", modelId: "veo-3.1-generate-preview", aspectRatio: "16:9", durationSeconds: 8, resolution: "720p" }); } catch (error) { uncertainError = error; }
    assert.strictEqual(calls.length, 1, "an ambiguous POST 5xx must never be sent again automatically");
    assert.strictEqual(uncertainError.code, "POST_ACCEPTANCE_UNKNOWN");
    assert.ok(/not sent again automatically/i.test(uncertainError.message));

    console.log("Veo transport compatibility tests passed.");
}

run().catch(function (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
