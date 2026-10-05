"use strict";

var assert = require("assert");
var fs = require("fs");
var path = require("path");

var root = path.resolve(__dirname, "..");
var packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
var manifest = fs.readFileSync(path.join(root, "CSXS", "manifest.xml"), "utf8");
var gallery = fs.readFileSync(path.join(root, "js", "gallery.js"), "utf8");
var sharedState = fs.readFileSync(path.join(root, "js", "sharedState.js"), "utf8");
var readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
var installGuide = fs.readFileSync(path.join(root, "INSTALL_GUIDE.md"), "utf8");
var version = packageJson.version;

assert.strictEqual(version, "0.4.1");
assert.ok(manifest.indexOf('ExtensionBundleVersion="' + version + '"') >= 0);
assert.strictEqual((manifest.match(new RegExp('<Extension\\s+Id="[^"]+"\\s+Version="' + version.replace(/\./g, "\\.") + '"', "g")) || []).length, 2);
assert.ok(gallery.indexOf('RUNTIME_BUILD_ID = "' + version + '+schema8"') >= 0);
assert.ok(/LATEST_STATE_VERSION\s*=\s*8/.test(sharedState));
assert.ok(readme.indexOf("`" + version + "`") >= 0);
assert.ok(installGuide.indexOf("Veo-Bridge-" + version + ".msi") >= 0);

var packageRoots = ["CSXS", "css", "js", "jsx"];
var packageFiles = [path.join(root, "index.html"), path.join(root, "gallery.html")];

function collectFiles(dir) {
    fs.readdirSync(dir).forEach(function (name) {
        var fullPath = path.join(dir, name);
        var stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            collectFiles(fullPath);
        } else {
            packageFiles.push(fullPath);
        }
    });
}

packageRoots.forEach(function (name) { collectFiles(path.join(root, name)); });

packageFiles.forEach(function (filePath) {
    var text = fs.readFileSync(filePath, "utf8");
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(text), "Possible Google API key in " + path.relative(root, filePath));
    assert.ok(!/localStorage\s*\.\s*setItem\s*\(\s*["'][^"']*(?:api.?key|secret|token)/i.test(text), "Secret persisted in localStorage in " + path.relative(root, filePath));
});

console.log("Release consistency and package secret tests passed.");
