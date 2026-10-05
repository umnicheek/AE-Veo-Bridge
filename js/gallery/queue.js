(function (global) {
    "use strict";

    if (!global.VeoBridgeGalleryModules) {
        global.VeoBridgeGalleryModules = {};
    }

    function create() {
        var knownStatuses = {
            queued: true,
            waiting_resume: true,
            needs_review: true,
            quota_paused: true,
            paused: true,
            uploading: true,
            polling: true,
            downloading: true,
            importing: true,
            done: true,
            failed: true,
            cancelled: true,
            stopped_tracking: true
        };

        function _safeArray(value) {
            return value && value instanceof Array ? value : [];
        }

        function _normalizeStatus(value) {
            var text = String(value || "").toLowerCase();
            return knownStatuses[text] ? text : "queued";
        }

        function hasOperation(job) {
            return !!(job && (job.operationName || job.operationUrl));
        }

        function isExecutionActive(job) {
            var status = _normalizeStatus(job && job.status);
            return status === "queued" || status === "uploading" || status === "polling" || status === "downloading" || status === "importing";
        }

        function isAutomaticCandidate(job) {
            var status = _normalizeStatus(job && job.status);
            if (!job || job.kind !== "video") {
                return false;
            }
            if (status === "queued") {
                return true;
            }
            return hasOperation(job) && (status === "polling" || status === "downloading" || status === "importing");
        }

        function recoveryStatus(job) {
            var status = _normalizeStatus(job && job.status);
            if (!job || job.kind !== "video") {
                return status;
            }
            if (status === "queued" && !hasOperation(job)) {
                return "waiting_resume";
            }
            if ((status === "uploading" || status === "polling") && !hasOperation(job)) {
                return "needs_review";
            }
            if (status === "importing" && hasOperation(job)) {
                return "downloading";
            }
            return status;
        }

        function leaseRetryDelay(lease, nowMs) {
            var now = typeof nowMs === "number" ? nowMs : new Date().getTime();
            var expiresAt = parseInt(lease && lease.expiresAt, 10);
            if (!isFinite(expiresAt) || expiresAt <= now) {
                return 50;
            }
            return Math.max(50, expiresAt - now + 40);
        }

        function classifyFailure(error) {
            var code = String(error && error.code || "");
            var statusCode = parseInt(error && error.statusCode, 10) || 0;
            if (code === "QUOTA_EXHAUSTED" || code === "BILLING_RESTRICTED") {
                return "quota_paused";
            }
            if (code === "POST_ACCEPTANCE_UNKNOWN") {
                return "needs_review";
            }
            if (code === "RATE_LIMIT_TRANSIENT") {
                return "waiting_resume";
            }
            if (error && error.cancelled) {
                return "paused";
            }
            if (statusCode === 401 || statusCode === 403) {
                return "failed";
            }
            return "failed";
        }

        function summarizePendingJobs(state) {
            var jobs = _safeArray(state && state.pendingJobs);
            var byKind = {
                video: 0,
                image: 0,
                other: 0
            };
            var byStatus = {};
            var activeCount = 0;
            var i;
            var item;
            var kind;
            var status;

            for (i = 0; i < jobs.length; i += 1) {
                item = jobs[i] || {};
                kind = String(item.kind || "").toLowerCase();
                status = _normalizeStatus(item.status);

                if (kind === "video") {
                    byKind.video += 1;
                } else if (kind === "image") {
                    byKind.image += 1;
                } else {
                    byKind.other += 1;
                }

                if (!byStatus[status]) {
                    byStatus[status] = 0;
                }
                byStatus[status] += 1;

                if (isExecutionActive(item)) {
                    activeCount += 1;
                }
            }

            return {
                total: jobs.length,
                active: activeCount,
                byKind: byKind,
                byStatus: byStatus
            };
        }

        function summarizeMedia(state) {
            var shots = _safeArray(state && state.shots);
            var videos = _safeArray(state && state.videos);
            var images = _safeArray(state && state.images);
            return {
                shotsCount: shots.length,
                videosCount: videos.length,
                imagesCount: images.length
            };
        }

        function buildDiagnosticsSummary(state) {
            return {
                stateVersion: state && state.stateVersion ? state.stateVersion : null,
                stateRevision: state && state.stateRevision ? state.stateRevision : 0,
                lease: state && state.pendingJobsLease ? state.pendingJobsLease : null,
                pending: summarizePendingJobs(state),
                media: summarizeMedia(state)
            };
        }

        return {
            normalizeStatus: _normalizeStatus,
            hasOperation: hasOperation,
            isExecutionActive: isExecutionActive,
            isAutomaticCandidate: isAutomaticCandidate,
            recoveryStatus: recoveryStatus,
            leaseRetryDelay: leaseRetryDelay,
            classifyFailure: classifyFailure,
            summarizePendingJobs: summarizePendingJobs,
            summarizeMedia: summarizeMedia,
            buildDiagnosticsSummary: buildDiagnosticsSummary
        };
    }

    global.VeoBridgeGalleryModules.queue = {
        create: create
    };
}(window));
