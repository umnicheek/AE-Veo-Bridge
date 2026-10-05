(function (global) {
    "use strict";

    var POLL_INTERVAL_MS = 750;
    var STATE_VERSION_NONE = 0;
    var LATEST_STATE_VERSION = 8;
    var STATE_WRITE_LOCK_STALE_MS = 5000;
    var STATE_WRITE_LOCK_ATTEMPTS = 30;
    var DEFAULT_IMAGE_MODEL_ID = "gemini-3.1-flash-image";
    var DEFAULT_STATE = {
        stateVersion: LATEST_STATE_VERSION,
        stateRevision: 0,
        shots: [],
        selectedShotId: null,
        startShotId: null,
        endShotId: null,
        pendingJobs: [],
        pendingJobsLease: null,
        videoGenSettings: {
            mode: "frames",
            model: "veo-3.1-generate-preview",
            aspectRatio: "16:9",
            durationSeconds: 8,
            resolution: "720p",
            seed: null
        },
        videoRefs: [],
        videos: [],
        selectedVideoId: null,
        images: [],
        selectedImageId: null,
        imageGenSettings: {
            model: DEFAULT_IMAGE_MODEL_ID,
            aspectRatio: "1:1",
            imageSize: "1K"
        },
        refs: []
    };

    var fs = null;
    var path = null;
    var os = null;
    var cs = null;

    var cachedState = null;
    var cachedPaths = null;
    var isEnsuringPaths = false;
    var ensurePathsWaiters = [];
    var lastKnownMtimeMs = 0;
    var pollTimer = null;
    var stateWriterId = "writer_" + String(typeof process !== "undefined" && process && process.pid ? process.pid : "cep") + "_" + String(new Date().getTime()) + "_" + String(Math.floor(Math.random() * 1000000));

    function _logError(message) {
        if (global.console && typeof global.console.error === "function") {
            global.console.error("[VeoBridgeState] " + message);
        }
    }

    function _safeRequire(name) {
        try {
            if (typeof require === "function") {
                return require(name);
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    function _cloneJson(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function _toNumberOrNull(value) {
        var parsed = parseInt(value, 10);
        if (!isFinite(parsed)) {
            return null;
        }
        return parsed;
    }

    function _normalizeShot(shot) {
        var input = shot || {};
        return {
            id: input.id || null,
            path: input.path || null,
            compName: input.compName || null,
            frame: typeof input.frame === "number" ? input.frame : null,
            createdAt: input.createdAt || null,
            width: typeof input.width === "number" ? input.width : null,
            height: typeof input.height === "number" ? input.height : null
        };
    }

    function _normalizePendingJob(job) {
        var input = job || {};
        var refs = [];
        var i;

        if (input.references && input.references instanceof Array) {
            for (i = 0; i < input.references.length; i += 1) {
                refs.push(_normalizeRef(input.references[i]));
            }
        }

        return {
            id: input.id || null,
            kind: input.kind || "video",
            batchId: input.batchId || null,
            status: input.status || "queued",
            sampleIndex: _toNumberOrNull(input.sampleIndex),
            sampleCount: _toNumberOrNull(input.sampleCount),
            createdAt: input.createdAt || null,
            updatedAt: input.updatedAt || null,
            prompt: input.prompt || null,
            modelId: input.modelId || null,
            aspectRatio: input.aspectRatio || null,
            imageSize: input.imageSize || null,
            uiMode: input.uiMode || null,
            apiMode: input.apiMode || null,
            durationSeconds: typeof input.durationSeconds === "number" ? input.durationSeconds : null,
            resolution: input.resolution || null,
            seed: _toNumberOrNull(input.seed),
            sourceVideoId: input.sourceVideoId || null,
            sourceVideoPath: input.sourceVideoPath || null,
            videosDir: input.videosDir || null,
            startShotId: input.startShotId || null,
            endShotId: input.endShotId || null,
            startShotPath: input.startShotPath || null,
            endShotPath: input.endShotPath || null,
            startShotCompName: input.startShotCompName || null,
            endShotCompName: input.endShotCompName || null,
            startShotFrame: typeof input.startShotFrame === "number" ? input.startShotFrame : null,
            endShotFrame: typeof input.endShotFrame === "number" ? input.endShotFrame : null,
            references: refs,
            referenceIds: input.referenceIds && input.referenceIds instanceof Array ? input.referenceIds.slice(0) : [],
            operationName: input.operationName || null,
            operationUrl: input.operationUrl || null,
            requestMode: input.requestMode || null,
            requestTransport: input.requestTransport || null,
            referencePlacement: input.referencePlacement || null,
            fallbackReason: input.fallbackReason || null,
            downloadedPath: input.downloadedPath || null,
            progressPercent: typeof input.progressPercent === "number" ? input.progressPercent : null,
            lastStage: input.lastStage || null,
            error: input.error || null,
            errorCode: input.errorCode || null,
            errorStatusCode: _toNumberOrNull(input.errorStatusCode),
            errorDetails: input.errorDetails || null,
            originalErrorMessage: input.originalErrorMessage || null,
            attemptCount: _toNumberOrNull(input.attemptCount) || 0,
            lastErrorAt: input.lastErrorAt || null,
            cancelRequested: !!input.cancelRequested,
            claimedBy: input.claimedBy || null,
            claimExpiresAt: _toNumberOrNull(input.claimExpiresAt),
            createdByRunner: input.createdByRunner || null,
            buildId: input.buildId || null,
            lastProgressAt: input.lastProgressAt || null,
            resumeRequired: !!input.resumeRequired,
            recoveryReason: input.recoveryReason || null,
            retryAfterMs: _toNumberOrNull(input.retryAfterMs),
            quotaReason: input.quotaReason || null,
            errorPayload: input.errorPayload || null
        };
    }

    function _normalizePendingJobsLease(lease) {
        var input = lease || {};
        var ownerId = input.ownerId ? String(input.ownerId) : "";
        var expiresAt = parseInt(input.expiresAt, 10);
        var updatedAt = input.updatedAt ? String(input.updatedAt) : null;

        if (!ownerId) {
            return null;
        }
        if (!isFinite(expiresAt) || expiresAt <= 0) {
            return null;
        }

        return {
            ownerId: ownerId,
            expiresAt: expiresAt,
            updatedAt: updatedAt,
            buildId: input.buildId || null,
            activeJobId: input.activeJobId || null,
            lastProgressAt: input.lastProgressAt || null,
            runId: input.runId || null
        };
    }

    function _normalizeVideo(video) {
        var input = video || {};
        var mode = input.mode || "frames";

        if (mode === "image" || mode === "interpolation") {
            mode = "frames";
        }
        if (mode !== "text" && mode !== "frames" && mode !== "reference" && mode !== "extend") {
            mode = "frames";
        }

        return {
            id: input.id || null,
            path: input.path || null,
            createdAt: input.createdAt || null,
            prompt: input.prompt || null,
            batchId: input.batchId || null,
            sampleIndex: _toNumberOrNull(input.sampleIndex),
            sampleCount: _toNumberOrNull(input.sampleCount),
            aspectRatio: input.aspectRatio || "16:9",
            startShotId: input.startShotId || null,
            endShotId: input.endShotId || null,
            model: input.model || null,
            mode: mode,
            durationSeconds: typeof input.durationSeconds === "number" ? input.durationSeconds : null,
            resolution: input.resolution || null,
            seed: _toNumberOrNull(input.seed),
            sourceVideoId: input.sourceVideoId || null,
            sourceVideoPath: input.sourceVideoPath || null,
            refIds: input.refIds && input.refIds instanceof Array ? input.refIds : [],
            operationName: input.operationName || null,
            operationUrl: input.operationUrl || null,
            attemptCount: _toNumberOrNull(input.attemptCount) || 0,
            requestMode: input.requestMode || null,
            requestTransport: input.requestTransport || null,
            referencePlacement: input.referencePlacement || null,
            fallbackReason: input.fallbackReason || null,
            status: input.status || "ready",
            importedToProject: !!input.importedToProject,
            projectImportPath: input.projectImportPath || null,
            importedAt: input.importedAt || null
        };
    }

    function _normalizeImage(image) {
        var input = image || {};
        return {
            id: input.id || null,
            path: input.path || null,
            createdAt: input.createdAt || null,
            prompt: input.prompt || null,
            batchId: input.batchId || null,
            sampleIndex: _toNumberOrNull(input.sampleIndex),
            sampleCount: _toNumberOrNull(input.sampleCount),
            aspectRatio: input.aspectRatio || "1:1",
            imageSize: input.imageSize || "1K",
            model: input.model || DEFAULT_IMAGE_MODEL_ID,
            refIds: input.refIds && input.refIds instanceof Array ? input.refIds.slice(0) : [],
            refPaths: input.refPaths && input.refPaths instanceof Array ? input.refPaths.slice(0) : [],
            width: typeof input.width === "number" ? input.width : null,
            height: typeof input.height === "number" ? input.height : null,
            status: input.status || "ready",
            importedToProject: !!input.importedToProject,
            projectImportPath: input.projectImportPath || null,
            importedAt: input.importedAt || null
        };
    }

    function _normalizeRef(refItem) {
        var input = refItem || {};
        return {
            id: input.id || null,
            path: input.path || null,
            name: input.name || null,
            mimeType: input.mimeType || null,
            createdAt: input.createdAt || null
        };
    }

    function _normalizeImageGenSettings(settings) {
        var input = settings || {};
        return {
            model: input.model === "gemini-3.1-flash-image-preview" || input.model === "gemini-2.5-flash-image" ? DEFAULT_IMAGE_MODEL_ID : (input.model || DEFAULT_IMAGE_MODEL_ID),
            aspectRatio: input.aspectRatio || "1:1",
            imageSize: input.imageSize || "1K"
        };
    }

    function _normalizeVideoGenSettings(settings) {
        var input = settings || {};
        var mode = input.mode || "frames";
        var aspectRatio = input.aspectRatio === "9:16" ? "9:16" : "16:9";
        var durationSeconds = parseInt(input.durationSeconds, 10);
        var resolution = String(input.resolution || "").toLowerCase();

        if (mode === "image" || mode === "interpolation") {
            mode = "frames";
        }

        if (mode !== "text" && mode !== "frames" && mode !== "reference") {
            mode = "frames";
        }

        if (durationSeconds !== 4 && durationSeconds !== 6 && durationSeconds !== 8) {
            durationSeconds = 8;
        }

        if (resolution !== "1080p" && resolution !== "4k") {
            resolution = "720p";
        }

        return {
            mode: mode,
            model: input.model || "veo-3.1-generate-preview",
            aspectRatio: aspectRatio,
            durationSeconds: durationSeconds,
            resolution: resolution,
            seed: _toNumberOrNull(input.seed)
        };
    }

    function _toStateVersion(value) {
        var parsed = parseInt(value, 10);
        if (!isFinite(parsed) || parsed < STATE_VERSION_NONE) {
            return STATE_VERSION_NONE;
        }
        return parsed;
    }

    function _migrateStateToV1(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        if (!next || typeof next !== "object") {
            next = {};
        }

        if (!(next.videoRefs && next.videoRefs instanceof Array)) {
            next.videoRefs = [];
        }
        if (!(next.pendingJobs && next.pendingJobs instanceof Array)) {
            next.pendingJobs = [];
        }
        if (!next.pendingJobsLease || typeof next.pendingJobsLease !== "object") {
            next.pendingJobsLease = null;
        }
        if (!(next.videos && next.videos instanceof Array)) {
            next.videos = [];
        }
        if (typeof next.selectedVideoId === "undefined") {
            next.selectedVideoId = null;
        }
        if (!(next.images && next.images instanceof Array)) {
            next.images = [];
        }
        if (typeof next.selectedImageId === "undefined") {
            next.selectedImageId = null;
        }
        if (!(next.refs && next.refs instanceof Array)) {
            next.refs = [];
        }
        if (!next.videoGenSettings || typeof next.videoGenSettings !== "object") {
            next.videoGenSettings = _cloneJson(DEFAULT_STATE.videoGenSettings);
        }
        if (!next.imageGenSettings || typeof next.imageGenSettings !== "object") {
            next.imageGenSettings = _cloneJson(DEFAULT_STATE.imageGenSettings);
        }

        next.stateVersion = 1;
        return next;
    }

    function _migrateStateToV2(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        if (!next || typeof next !== "object") {
            next = {};
        }

        if (next.videoGenSettings && next.videoGenSettings.mode) {
            if (next.videoGenSettings.mode === "image" || next.videoGenSettings.mode === "interpolation") {
                next.videoGenSettings.mode = "frames";
            }
        }
        if (next.videos && next.videos instanceof Array) {
            var i;
            var mode;
            for (i = 0; i < next.videos.length; i += 1) {
                if (!next.videos[i] || typeof next.videos[i] !== "object") {
                    continue;
                }
                mode = next.videos[i].mode;
                if (mode === "image" || mode === "interpolation") {
                    next.videos[i].mode = "frames";
                }
            }
        }

        next.stateVersion = 2;
        return next;
    }

    function _migrateStateToV3(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        var i;

        if (!next || typeof next !== "object") {
            next = {};
        }

        if (next.videos && next.videos instanceof Array) {
            for (i = 0; i < next.videos.length; i += 1) {
                if (!next.videos[i] || typeof next.videos[i] !== "object") {
                    continue;
                }
                if (typeof next.videos[i].importedToProject === "undefined") {
                    next.videos[i].importedToProject = false;
                }
                if (typeof next.videos[i].projectImportPath === "undefined") {
                    next.videos[i].projectImportPath = null;
                }
                if (typeof next.videos[i].importedAt === "undefined") {
                    next.videos[i].importedAt = null;
                }
            }
        }

        if (next.images && next.images instanceof Array) {
            for (i = 0; i < next.images.length; i += 1) {
                if (!next.images[i] || typeof next.images[i] !== "object") {
                    continue;
                }
                if (typeof next.images[i].importedToProject === "undefined") {
                    next.images[i].importedToProject = false;
                }
                if (typeof next.images[i].projectImportPath === "undefined") {
                    next.images[i].projectImportPath = null;
                }
                if (typeof next.images[i].importedAt === "undefined") {
                    next.images[i].importedAt = null;
                }
            }
        }

        next.stateVersion = 3;
        return next;
    }

    function _migrateStateToV4(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        if (next.imageGenSettings && next.imageGenSettings.model === "gemini-3.1-flash-image-preview") {
            next.imageGenSettings.model = DEFAULT_IMAGE_MODEL_ID;
        }
        next.stateVersion = 4;
        return next;
    }

    function _migrateStateToV5(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        if (next.imageGenSettings && next.imageGenSettings.model === "gemini-2.5-flash-image") {
            next.imageGenSettings.model = DEFAULT_IMAGE_MODEL_ID;
        }
        next.stateVersion = 5;
        return next;
    }

    function _migrateStateToV6(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        if (next.videoGenSettings && typeof next.videoGenSettings.seed === "undefined") {
            next.videoGenSettings.seed = null;
        }
        next.stateVersion = 6;
        return next;
    }

    function _migrateStateToV7(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        var i;
        if (next.pendingJobs && next.pendingJobs instanceof Array) {
            for (i = 0; i < next.pendingJobs.length; i += 1) {
                if (!next.pendingJobs[i]) { continue; }
                if (typeof next.pendingJobs[i].attemptCount === "undefined") { next.pendingJobs[i].attemptCount = 0; }
                if (typeof next.pendingJobs[i].cancelRequested === "undefined") { next.pendingJobs[i].cancelRequested = false; }
            }
        }
        next.stateVersion = 7;
        return next;
    }

    function _migrateStateToV8(candidate) {
        var next = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        var jobs = next.pendingJobs && next.pendingJobs instanceof Array ? next.pendingJobs : [];
        var i;
        var item;
        var status;
        var hasOperation;

        for (i = 0; i < jobs.length; i += 1) {
            item = jobs[i];
            if (!item || item.kind !== "video") {
                continue;
            }
            status = String(item.status || "queued").toLowerCase();
            hasOperation = !!(item.operationName || item.operationUrl);
            if (status === "queued" && !hasOperation) {
                item.status = "waiting_resume";
                item.resumeRequired = true;
                item.recoveryReason = "Migrated unsent job; explicit Resume is required.";
            } else if ((status === "uploading" || status === "polling") && !hasOperation) {
                item.status = "needs_review";
                item.resumeRequired = true;
                item.recoveryReason = "Submission was interrupted before an operation name was saved.";
            } else if (status === "importing" && hasOperation) {
                item.status = "downloading";
                item.resumeRequired = false;
            } else if ((status === "polling" || status === "downloading") && hasOperation) {
                item.resumeRequired = false;
            }
            item.claimedBy = null;
            item.claimExpiresAt = null;
            item.lastProgressAt = item.lastProgressAt || item.updatedAt || null;
        }
        next.pendingJobsLease = null;
        next.stateRevision = _toNumberOrNull(next.stateRevision) || 0;
        next.stateVersion = 8;
        return next;
    }

    function _migrateState(candidate) {
        var migrated = candidate && typeof candidate === "object" ? _cloneJson(candidate) : {};
        var version = _toStateVersion(migrated && migrated.stateVersion);

        if (version < 1) {
            migrated = _migrateStateToV1(migrated);
            version = 1;
        }
        if (version < 2) {
            migrated = _migrateStateToV2(migrated);
            version = 2;
        }
        if (version < 3) {
            migrated = _migrateStateToV3(migrated);
            version = 3;
        }
        if (version < 4) {
            migrated = _migrateStateToV4(migrated);
            version = 4;
        }
        if (version < 5) {
            migrated = _migrateStateToV5(migrated);
            version = 5;
        }
        if (version < 6) {
            migrated = _migrateStateToV6(migrated);
            version = 6;
        }
        if (version < 7) {
            migrated = _migrateStateToV7(migrated);
            version = 7;
        }
        if (version < 8) {
            migrated = _migrateStateToV8(migrated);
            version = 8;
        }

        if (!migrated || typeof migrated !== "object") {
            migrated = {};
        }
        migrated.stateVersion = LATEST_STATE_VERSION;
        return migrated;
    }

    function _normalizeState(candidate) {
        var input = _migrateState(candidate || {});
        var shots = [];
        var pendingJobs = [];
        var videos = [];
        var images = [];
        var refs = [];
        var videoRefs = [];
        var normalizedRef;
        var i;

        if (input.shots && input.shots instanceof Array) {
            for (i = 0; i < input.shots.length; i += 1) {
                shots.push(_normalizeShot(input.shots[i]));
            }
        }

        if (input.videos && input.videos instanceof Array) {
            for (i = 0; i < input.videos.length; i += 1) {
                videos.push(_normalizeVideo(input.videos[i]));
            }
        }

        if (input.pendingJobs && input.pendingJobs instanceof Array) {
            for (i = 0; i < input.pendingJobs.length; i += 1) {
                pendingJobs.push(_normalizePendingJob(input.pendingJobs[i]));
            }
        }

        if (input.images && input.images instanceof Array) {
            for (i = 0; i < input.images.length; i += 1) {
                images.push(_normalizeImage(input.images[i]));
            }
        }

        if (input.refs && input.refs instanceof Array) {
            for (i = 0; i < input.refs.length; i += 1) {
                normalizedRef = _normalizeRef(input.refs[i]);
                if (normalizedRef && normalizedRef.path) {
                    refs.push(normalizedRef);
                }
            }
        }

        if (input.videoRefs && input.videoRefs instanceof Array) {
            for (i = 0; i < input.videoRefs.length; i += 1) {
                normalizedRef = _normalizeRef(input.videoRefs[i]);
                if (normalizedRef && normalizedRef.path) {
                    videoRefs.push(normalizedRef);
                }
            }
        }

        return {
            stateVersion: LATEST_STATE_VERSION,
            stateRevision: _toNumberOrNull(input.stateRevision) || 0,
            shots: shots,
            selectedShotId: input.selectedShotId || null,
            startShotId: input.startShotId || null,
            endShotId: input.endShotId || null,
            pendingJobs: pendingJobs,
            pendingJobsLease: _normalizePendingJobsLease(input.pendingJobsLease),
            videoGenSettings: _normalizeVideoGenSettings(input.videoGenSettings),
            videoRefs: videoRefs,
            videos: videos,
            selectedVideoId: input.selectedVideoId || null,
            images: images,
            selectedImageId: input.selectedImageId || null,
            imageGenSettings: _normalizeImageGenSettings(input.imageGenSettings),
            refs: refs
        };
    }

    function _resolveUserDataDir() {
        var home;
        var platform;
        var env;

        if (!path || !os || typeof process === "undefined") {
            return null;
        }

        env = process.env || {};
        platform = process.platform;
        home = os.homedir ? os.homedir() : env.HOME;

        if (!home) {
            return null;
        }

        if (platform === "win32") {
            return env.APPDATA || path.join(home, "AppData", "Roaming");
        }

        if (platform === "darwin") {
            return path.join(home, "Library", "Application Support");
        }

        return env.XDG_CONFIG_HOME || path.join(home, ".config");
    }

    function _getStoragePaths() {
        var userDataDir = _resolveUserDataDir();
        var veoBridgeDir;
        var stateFile;

        if (!userDataDir || !path) {
            return null;
        }

        veoBridgeDir = path.join(userDataDir, "VeoBridge");
        stateFile = path.join(veoBridgeDir, "state.json");

        return {
            userDataDir: userDataDir,
            veoBridgeDir: veoBridgeDir,
            stateFile: stateFile,
            previousStateFile: stateFile + ".previous",
            writeLockFile: stateFile + ".lock"
        };
    }

    function _busyWait(ms) {
        var until = new Date().getTime() + Math.max(0, ms || 0);
        while (new Date().getTime() < until) {
            // The write lock is held only for a few milliseconds.
        }
    }

    function _acquireStateWriteLock(storagePaths) {
        var attempt;
        var fd;
        var stats;
        var age;
        if (!fs || !storagePaths || typeof fs.openSync !== "function") {
            return { fallback: true };
        }
        for (attempt = 0; attempt < STATE_WRITE_LOCK_ATTEMPTS; attempt += 1) {
            try {
                fd = fs.openSync(storagePaths.writeLockFile, "wx");
                try {
                    fs.writeFileSync(fd, JSON.stringify({ ownerId: stateWriterId, createdAt: (new Date()).toISOString() }), "utf8");
                } catch (writeLockError) { /* ownership is represented by the file itself */ }
                return { fd: fd, path: storagePaths.writeLockFile };
            } catch (lockError) {
                try {
                    stats = fs.statSync(storagePaths.writeLockFile);
                    age = new Date().getTime() - (stats && typeof stats.mtimeMs === "number" ? stats.mtimeMs : 0);
                    if (age > STATE_WRITE_LOCK_STALE_MS) {
                        fs.unlinkSync(storagePaths.writeLockFile);
                        continue;
                    }
                } catch (staleCheckError) { /* another writer may have just released it */ }
                _busyWait(4 + attempt);
            }
        }
        return null;
    }

    function _releaseStateWriteLock(lock) {
        if (!fs || !lock || lock.fallback) {
            return;
        }
        try { if (typeof lock.fd === "number") { fs.closeSync(lock.fd); } } catch (closeError) { /* ignore */ }
        try { if (lock.path && fs.existsSync(lock.path)) { fs.unlinkSync(lock.path); } } catch (unlinkError) { /* stale-lock recovery handles it */ }
    }

    function _ensureStorageDir(storagePaths) {
        var dir;
        var parentDir;

        if (!fs || !storagePaths) {
            return false;
        }

        dir = storagePaths.veoBridgeDir;

        try {
            if (fs.existsSync(dir)) {
                return true;
            }
        } catch (errorExists) {
            return false;
        }

        try {
            parentDir = path.dirname(dir);
            if (parentDir && parentDir !== dir && !fs.existsSync(parentDir)) {
                if (!_ensureStorageDir({ veoBridgeDir: parentDir })) {
                    return false;
                }
            }
            fs.mkdirSync(dir);
            return true;
        } catch (error) {
            _logError("Failed to create storage directory: " + String(error));
            return false;
        }
    }

    function _readMtimeMs(filePath) {
        var stats;
        if (!fs || !filePath) {
            return 0;
        }

        try {
            stats = fs.statSync(filePath);
            return stats && typeof stats.mtimeMs === "number" ? stats.mtimeMs : 0;
        } catch (error) {
            return 0;
        }
    }

    function _writeStateToDiskUnlocked(nextState, storagePaths) {
        var temporaryFile;
        var previousFile;
        var existingIsValid = false;

        if (!fs || !storagePaths) {
            return false;
        }

        if (!_ensureStorageDir(storagePaths)) {
            return false;
        }

        try {
            temporaryFile = storagePaths.stateFile + ".tmp-" + stateWriterId + "-" + String(new Date().getTime()) + "-" + String(Math.floor(Math.random() * 1000000));
            previousFile = storagePaths.previousStateFile;
            fs.writeFileSync(temporaryFile, JSON.stringify(nextState), "utf8");
            if (fs.existsSync(storagePaths.stateFile)) {
                try {
                    JSON.parse(fs.readFileSync(storagePaths.stateFile, "utf8"));
                    existingIsValid = true;
                } catch (existingParseError) {
                    existingIsValid = false;
                }
            }
            if (existingIsValid && previousFile) {
                fs.copyFileSync(storagePaths.stateFile, previousFile);
            }
            try {
                fs.renameSync(temporaryFile, storagePaths.stateFile);
            } catch (renameError) {
                if (fs.existsSync(storagePaths.stateFile)) {
                    fs.unlinkSync(storagePaths.stateFile);
                }
                try {
                    fs.renameSync(temporaryFile, storagePaths.stateFile);
                } catch (replaceError) {
                    if (previousFile && fs.existsSync(previousFile) && !fs.existsSync(storagePaths.stateFile)) {
                        fs.copyFileSync(previousFile, storagePaths.stateFile);
                    }
                    throw replaceError;
                }
            }
            lastKnownMtimeMs = _readMtimeMs(storagePaths.stateFile);
            return true;
        } catch (error) {
            try { if (temporaryFile && fs.existsSync(temporaryFile)) { fs.unlinkSync(temporaryFile); } } catch (cleanupError) { /* ignore */ }
            _logError("Failed to write state file: " + String(error));
            return false;
        }
    }

    function _writeStateToDisk(nextState) {
        var storagePaths = _getStoragePaths();
        var lock;
        var result;
        if (!storagePaths || !_ensureStorageDir(storagePaths)) {
            return false;
        }
        lock = _acquireStateWriteLock(storagePaths);
        if (!lock) {
            _logError("Timed out waiting for state write lock.");
            return false;
        }
        try {
            result = _writeStateToDiskUnlocked(nextState, storagePaths);
        } finally {
            _releaseStateWriteLock(lock);
        }
        return result;
    }

    function _readStateFromDisk() {
        var storagePaths = _getStoragePaths();
        var raw;
        var parsed;
        var normalized;

        if (!fs || !storagePaths) {
            return _cloneJson(DEFAULT_STATE);
        }

        if (!_ensureStorageDir(storagePaths)) {
            return _cloneJson(DEFAULT_STATE);
        }

        if (!fs.existsSync(storagePaths.stateFile) && storagePaths.previousStateFile && fs.existsSync(storagePaths.previousStateFile)) {
            try { fs.copyFileSync(storagePaths.previousStateFile, storagePaths.stateFile); } catch (restoreError) { /* read fallback below */ }
        }

        if (!fs.existsSync(storagePaths.stateFile)) {
            return _cloneJson(DEFAULT_STATE);
        }

        try {
            raw = fs.readFileSync(storagePaths.stateFile, "utf8");
            parsed = raw ? JSON.parse(raw) : {};
            normalized = _normalizeState(parsed);
            lastKnownMtimeMs = _readMtimeMs(storagePaths.stateFile);
            return normalized;
        } catch (error) {
            try {
                fs.copyFileSync(storagePaths.stateFile, storagePaths.stateFile + ".corrupt-" + String(new Date().getTime()) + ".bak");
            } catch (backupError) { /* keep recovery best-effort */ }
            if (storagePaths.previousStateFile && fs.existsSync(storagePaths.previousStateFile)) {
                try {
                    raw = fs.readFileSync(storagePaths.previousStateFile, "utf8");
                    parsed = raw ? JSON.parse(raw) : {};
                    normalized = _normalizeState(parsed);
                    _logError("Failed to read state file; recovered the last valid revision: " + String(error));
                    return normalized;
                } catch (previousReadError) { /* defaults remain the final fallback */ }
            }
            _logError("Failed to read state file; a backup was kept and defaults restored: " + String(error));
            return _cloneJson(DEFAULT_STATE);
        }
    }

    function _emitStateChanged() {
        if (typeof api.onStateChanged === "function") {
            try {
                api.onStateChanged(_cloneJson(cachedState));
            } catch (callbackError) {
                _logError("onStateChanged callback failed: " + String(callbackError));
            }
        }
    }

    function _pollStateFileChanges() {
        var storagePaths = _getStoragePaths();
        var currentMtime;

        if (!fs || !storagePaths || !fs.existsSync(storagePaths.stateFile)) {
            return;
        }

        currentMtime = _readMtimeMs(storagePaths.stateFile);
        if (!currentMtime || currentMtime === lastKnownMtimeMs) {
            return;
        }

        lastKnownMtimeMs = currentMtime;
        cachedState = _readStateFromDisk();
        _emitStateChanged();
    }

    function _startPolling() {
        if (pollTimer || typeof global.setInterval !== "function") {
            return;
        }
        pollTimer = global.setInterval(_pollStateFileChanges, POLL_INTERVAL_MS);
    }

    function _parseHostJson(raw) {
        if (typeof raw !== "string") {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (error) {
            return null;
        }
    }

    function _flushEnsurePathsWaiters(error, pathsResult) {
        var i;
        var waiter;
        var queue = ensurePathsWaiters.slice(0);

        ensurePathsWaiters = [];
        for (i = 0; i < queue.length; i += 1) {
            waiter = queue[i];
            if (typeof waiter === "function") {
                try {
                    waiter(error, pathsResult);
                } catch (waiterError) {
                    _logError("ensurePaths callback failed: " + String(waiterError));
                }
            }
        }
    }

    var api = {
        onStateChanged: null,

        loadState: function () {
            cachedState = _readStateFromDisk();
            return _cloneJson(cachedState);
        },

        saveState: function (newState) {
            var storagePaths = _getStoragePaths();
            var lock = storagePaths ? _acquireStateWriteLock(storagePaths) : null;
            var base;
            var normalized;
            if (!lock) {
                _logError("Timed out waiting for state write lock.");
                return _cloneJson(cachedState || DEFAULT_STATE);
            }
            try {
                base = _readStateFromDisk();
                normalized = _normalizeState(newState);
                normalized.stateRevision = Math.max(_toNumberOrNull(base && base.stateRevision) || 0, _toNumberOrNull(normalized.stateRevision) || 0) + 1;
                if (!_writeStateToDiskUnlocked(normalized, storagePaths)) {
                    return _cloneJson(cachedState || DEFAULT_STATE);
                }
            } finally {
                _releaseStateWriteLock(lock);
            }
            cachedState = normalized;
            _emitStateChanged();
            return _cloneJson(cachedState);
        },

        updateState: function (patch) {
            return api.updateStateWith(function () {
                return patch || {};
            });
        },

        updateStateWith: function (mutator) {
            var storagePaths = _getStoragePaths();
            var lock = storagePaths ? _acquireStateWriteLock(storagePaths) : null;
            var base;
            var patch;
            var normalized;
            if (!lock) {
                _logError("Timed out waiting for state write lock.");
                return _cloneJson(cachedState || DEFAULT_STATE);
            }
            base = _readStateFromDisk();
            var next = {
                stateVersion: base.stateVersion || LATEST_STATE_VERSION,
                stateRevision: base.stateRevision || 0,
                shots: base.shots,
                selectedShotId: base.selectedShotId,
                startShotId: base.startShotId,
                endShotId: base.endShotId,
                pendingJobs: base.pendingJobs,
                pendingJobsLease: base.pendingJobsLease,
                videoGenSettings: base.videoGenSettings,
                videoRefs: base.videoRefs,
                videos: base.videos,
                selectedVideoId: base.selectedVideoId,
                images: base.images,
                selectedImageId: base.selectedImageId,
                imageGenSettings: base.imageGenSettings,
                refs: base.refs
            };
            var key;

            cachedState = _cloneJson(base);

            try {
                patch = typeof mutator === "function" ? mutator(_cloneJson(base)) : {};
            } catch (mutatorError) {
                _releaseStateWriteLock(lock);
                throw mutatorError;
            }

            if (!patch || typeof patch !== "object" || Object.keys(patch).length === 0) {
                _releaseStateWriteLock(lock);
                return _cloneJson(cachedState);
            }

            for (key in patch) {
                if (patch.hasOwnProperty(key)) {
                    next[key] = patch[key];
                }
            }

            normalized = _normalizeState(next);
            normalized.stateRevision = (_toNumberOrNull(base.stateRevision) || 0) + 1;
            try {
                if (!_writeStateToDiskUnlocked(normalized, storagePaths)) {
                    return _cloneJson(cachedState || DEFAULT_STATE);
                }
            } finally {
                _releaseStateWriteLock(lock);
            }
            cachedState = normalized;
            _emitStateChanged();
            return _cloneJson(cachedState);
        },

        getState: function () {
            if (!cachedState) {
                cachedState = _readStateFromDisk();
            }
            return _cloneJson(cachedState);
        },

        ensurePaths: function (callback) {
            var localCallback = typeof callback === "function" ? callback : function () {};
            var payload;
            var rawMessage;

            if (cachedPaths) {
                localCallback(null, _cloneJson(cachedPaths));
                return _cloneJson(cachedPaths);
            }

            ensurePathsWaiters.push(localCallback);
            if (isEnsuringPaths) {
                return null;
            }

            isEnsuringPaths = true;

            if (!cs) {
                isEnsuringPaths = false;
                _flushEnsurePathsWaiters(new Error("CSInterface is unavailable"), null);
                return null;
            }

            cs.evalScript("VeoBridge_getPaths()", function (rawResponse) {
                var parsed = _parseHostJson(rawResponse);
                var error = null;

                isEnsuringPaths = false;

                if (!parsed || !parsed.ok || !parsed.paths) {
                    payload = parsed || {};
                    rawMessage = typeof rawResponse === "string" ? rawResponse : "";
                    error = new Error(payload.error || rawMessage || "VeoBridge_getPaths failed");
                    _flushEnsurePathsWaiters(error, null);
                    return;
                }

                cachedPaths = parsed.paths;
                _flushEnsurePathsWaiters(null, _cloneJson(cachedPaths));
            });

            return null;
        },
        _testNormalizeState: _normalizeState,
        _testGetStoragePaths: _getStoragePaths
    };

    fs = _safeRequire("fs");
    path = _safeRequire("path");
    os = _safeRequire("os");
    cs = global.CSInterfaceLite ? new global.CSInterfaceLite() : null;

    cachedState = _readStateFromDisk();
    _startPolling();
    api.ensurePaths();

    global.VeoBridgeState = api;
}(window));
