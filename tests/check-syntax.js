"use strict";
var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");
var root = path.resolve(__dirname, "..");
function walk(dir, out) {
    fs.readdirSync(dir).forEach(function (name) {
        var full = path.join(dir, name);
        var stat = fs.statSync(full);
        if (stat.isDirectory()) { walk(full, out); }
        else if (/\.js$/i.test(name)) { out.push(full); }
    });
}
var files = [];
walk(path.join(root, "js"), files);
walk(path.join(root, "tests"), files);
files.forEach(function (file) { childProcess.execFileSync(process.execPath, ["--check", file], { stdio: "inherit" }); });
console.log("Syntax checked: " + files.length + " files.");
