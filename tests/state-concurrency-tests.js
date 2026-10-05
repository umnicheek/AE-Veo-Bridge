"use strict";

var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var vm = require("vm");
var root = path.resolve(__dirname, "..");

function loadStateApi(appDataDir, pid) {
    var fakeProcess = {
        platform: "win32",
        pid: pid,
        env: { APPDATA: appDataDir }
    };
    var window = {
        console: console,
        process: fakeProcess,
        setInterval: function () { return 1; },
        clearInterval: function () {},
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    var context = {
        window: window,
        console: console,
        process: fakeProcess,
        require: require,
        setInterval: window.setInterval,
        clearInterval: window.clearInterval,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "js", "sharedState.js"), "utf8"), context, { filename: "js/sharedState.js" });
    return window.VeoBridgeState;
}

var tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "veobridge-state-race-"));
try {
    var first = loadStateApi(tempRoot, 101);
    var second = loadStateApi(tempRoot, 202);

    first.updateState({ shots: [{ id: "shot-a", path: "A.png" }] });
    second.updateState({ videos: [{ id: "video-b", path: "B.mp4" }] });
    var merged = first.loadState();
    assert.strictEqual(merged.stateVersion, 8);
    assert.strictEqual(merged.stateRevision, 2);
    assert.strictEqual(merged.shots.length, 1, "a second window must preserve shots written by the first window");
    assert.strictEqual(merged.videos.length, 1, "a stale cache must not overwrite another window's videos");

    first.updateStateWith(function (state) {
        return { pendingJobs: (state.pendingJobs || []).concat([{ id: "job-a", kind: "video", status: "waiting_resume" }]) };
    });
    second.updateStateWith(function (state) {
        return { pendingJobs: (state.pendingJobs || []).concat([{ id: "job-b", kind: "video", status: "waiting_resume" }]) };
    });
    merged = first.loadState();
    assert.strictEqual(merged.pendingJobs.length, 2, "atomic queue mutations must not lose another window's job");
    assert.strictEqual(merged.stateRevision, 4);
    second.updateState({});
    assert.strictEqual(first.loadState().stateRevision, 4, "an empty patch must not rewrite the state file");

    function claimLease(api, ownerId, nowMs) {
        var acquired = false;
        api.updateStateWith(function (state) {
            var lease = state.pendingJobsLease;
            if (lease && lease.ownerId && Number(lease.expiresAt) > nowMs && lease.ownerId !== ownerId) {
                return {};
            }
            acquired = true;
            return { pendingJobsLease: { ownerId: ownerId, expiresAt: nowMs + 15000 } };
        });
        return acquired;
    }

    function releaseLease(api, ownerId) {
        api.updateStateWith(function (state) {
            var lease = state.pendingJobsLease;
            return lease && lease.ownerId === ownerId ? { pendingJobsLease: null } : {};
        });
    }

    var leaseNow = Date.now();
    assert.strictEqual(claimLease(first, "gallery-a", leaseNow), true);
    var revisionAfterFirstClaim = first.loadState().stateRevision;
    assert.strictEqual(claimLease(second, "gallery-b", leaseNow + 1), false, "a live Gallery lease must not be stolen");
    assert.strictEqual(second.loadState().pendingJobsLease.ownerId, "gallery-a");
    assert.strictEqual(second.loadState().stateRevision, revisionAfterFirstClaim, "a rejected lease claim must not rewrite state");
    releaseLease(second, "gallery-b");
    assert.strictEqual(first.loadState().pendingJobsLease.ownerId, "gallery-a", "a non-owner must not release the lease");
    assert.strictEqual(first.loadState().stateRevision, revisionAfterFirstClaim, "a non-owner lease release must be a no-op");
    first.updateStateWith(function (state) {
        var lease = state.pendingJobsLease;
        lease.expiresAt = leaseNow - 1;
        return { pendingJobsLease: lease };
    });
    assert.strictEqual(claimLease(second, "gallery-b", leaseNow + 2), true, "an expired owner must not starve another Gallery");
    assert.strictEqual(claimLease(first, "gallery-a", leaseNow + 3), false, "the old owner must not overwrite a new live claim");
    releaseLease(second, "gallery-b");
    assert.strictEqual(first.loadState().pendingJobsLease, null);

    var paths = first._testGetStoragePaths();
    assert.strictEqual(fs.existsSync(paths.previousStateFile), true, "the last valid state revision must remain recoverable");
    fs.writeFileSync(paths.stateFile, "{broken-json", "utf8");
    var recovered = second.loadState();
    assert.strictEqual(recovered.shots.length, 1, "corrupt state recovery must preserve the library from the last valid revision");
    assert.strictEqual(recovered.videos.length, 1);
    assert.strictEqual(recovered.pendingJobs.length, 2);
    assert.ok(fs.readdirSync(path.dirname(paths.stateFile)).some(function (name) { return /state\.json\.corrupt-.*\.bak/.test(name); }), "the corrupt input must be retained for diagnostics");
    first.updateState({ selectedShotId: "shot-a" });
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.stateFile, "utf8")).selectedShotId, "shot-a", "the next atomic update must repair the active state file");
    assert.strictEqual(fs.existsSync(paths.writeLockFile), false, "state write lock must be released after successful writes");
    assert.strictEqual(fs.readdirSync(path.dirname(paths.stateFile)).filter(function (name) { return /\.tmp-/.test(name); }).length, 0, "state writes must not leave temporary files");

    console.log("State concurrency tests passed.");
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}
