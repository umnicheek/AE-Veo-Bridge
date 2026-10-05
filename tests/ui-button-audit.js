"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var htmlFiles = ["index.html", "gallery.html"];
var scriptFiles = ["js/main.js", "js/gallery.js", "js/gallery/actions.js"];
var scripts = scriptFiles.map(function (name) {
    return fs.readFileSync(path.join(root, name), "utf8");
}).join("\n");

// These controls belong to the retained, hidden compatibility DOM. They are
// deliberately not part of the interactive UI and must never become visible.
var legacyHidden = {
    btnTabVideo: true,
    btnTabImage: true,
    btnToggleVideoMetaDetails: true,
    btnImportVideo: true,
    btnRevealVideo: true,
    btnDeleteVideo: true,
    btnImageFlowOptions: true
};

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findButtonVariables(id) {
    var result = [];
    var expression = new RegExp("(?:var\\s+)?([A-Za-z_$][\\w$]*)\\s*=\\s*getById\\(\\\"" + escapeRegex(id) + "\\\"\\)", "g");
    var match;
    while ((match = expression.exec(scripts))) {
        result.push(match[1]);
    }
    return result;
}

var audited = [];
htmlFiles.forEach(function (fileName) {
    var html = fs.readFileSync(path.join(root, fileName), "utf8");
    var buttonExpression = /<button\b([^>]*)>/g;
    var buttonMatch;
    while ((buttonMatch = buttonExpression.exec(html))) {
        var attrs = buttonMatch[1];
        var idMatch = /\bid="([^"]+)"/.exec(attrs);
        var classMatch = /\bclass="([^"]*)"/.exec(attrs);
        if (!idMatch) {
            continue;
        }
        var id = idMatch[1];
        var classes = classMatch ? classMatch[1].split(/\s+/) : [];
        if (legacyHidden[id] || classes.indexOf("ghost-hidden") !== -1) {
            continue;
        }
        var variables = findButtonVariables(id);
        assert.ok(variables.length, fileName + ": visible button #" + id + " is never resolved by JavaScript");
        assert.ok(variables.some(function (variable) {
            return new RegExp(escapeRegex(variable) + "\\.addEventListener\\(\\\"click\\\"").test(scripts);
        }), fileName + ": visible button #" + id + " has no click handler");
        audited.push(fileName + "#" + id);
    }
});

assert.ok(audited.length >= 40, "button audit unexpectedly covered too few controls");

var host = fs.readFileSync(path.join(root, "jsx", "host.jsx"), "utf8");
var hostCalls = {};
scriptFiles.slice(0, 2).forEach(function (fileName) {
    var source = fs.readFileSync(path.join(root, fileName), "utf8");
    var callExpression = /VeoBridge_[A-Za-z0-9_]+/g;
    var match;
    while ((match = callExpression.exec(source))) {
        hostCalls[match[0]] = true;
    }
});
Object.keys(hostCalls).forEach(function (name) {
    var declaration = new RegExp("function\\s+" + escapeRegex(name) + "\\s*\\(").test(host);
    var assignment = new RegExp("\\$\\.global\\." + escapeRegex(name) + "\\s*=\\s*function\\s*\\(").test(host);
    assert.ok(declaration || assignment, "missing host command: " + name);
    assert.ok(host.indexOf("\"" + name + "\"") !== -1 && host.indexOf("_installSafeHostWrappers();") !== -1,
        "host command is not protected by JSON wrapper: " + name);
});

console.log("UI button audit passed: " + audited.length + " visible controls, " + Object.keys(hostCalls).length + " host commands.");
