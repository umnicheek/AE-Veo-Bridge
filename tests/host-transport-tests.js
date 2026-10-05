"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var root = path.resolve(__dirname, "..");
var dollar = { global: {}, os: "Windows", locale: "en_US" };
var app = {
    name: "After \"Effects\"\\Host\n\u042e\u043d\u0438\u043a\u043e\u0434\u0001",
    version: "26.3\rCEP12"
};
var context = {
    $: dollar,
    app: app,
    File: function File() {},
    Folder: function Folder() {},
    ImportOptions: function ImportOptions() {},
    FootageItem: function FootageItem() {},
    CompItem: function CompItem() {},
    isFinite: isFinite,
    Math: Math,
    Date: Date,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Array: Array,
    Object: Object
};

vm.runInNewContext(fs.readFileSync(path.join(root, "jsx", "host.jsx"), "utf8"), context, { filename: "jsx/host.jsx" });

var firstRaw = dollar.global.VeoBridge_ping();
var secondRaw = dollar.global.VeoBridge_ping();
assert.strictEqual(typeof firstRaw, "string");
assert.strictEqual(firstRaw, secondRaw, "host JSON serialization must be deterministic");
assert.strictEqual(firstRaw.indexOf("\u042e"), -1, "non-ASCII characters must be escaped on the host transport");
assert.ok(/\\u042e/i.test(firstRaw));
assert.ok(/\\u0001/i.test(firstRaw));
var parsed = JSON.parse(firstRaw);
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.appName, app.name);
assert.strictEqual(parsed.appVersion, app.version);

Object.defineProperty(app, "name", {
    configurable: true,
    get: function () { throw new Error("boom \"quoted\"\\line\n\u042e"); }
});
var errorRaw = dollar.global.VeoBridge_ping();
assert.strictEqual(typeof errorRaw, "string", "host exceptions must never cross CEP as objects");
var errorPayload = JSON.parse(errorRaw);
assert.strictEqual(errorPayload.ok, false);
assert.strictEqual(errorPayload.code, "HOST_EXCEPTION");
assert.strictEqual(errorPayload.stage, "VeoBridge_ping");
assert.ok(/boom/.test(errorPayload.details));

console.log("Host JSON transport tests passed.");
