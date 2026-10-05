(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) { module.exports = api; }
    if (root) { root.VeoBridgeModelPolicy = api; }
}(typeof window !== "undefined" ? window : this, function () {
    "use strict";
    var DEFAULT_VIDEO_MODEL = "veo-3.1-generate-preview";
    var DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
    var LEGACY_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
    var VIDEO_MODELS = {
        "veo-3.1-generate-preview": { reference: true, extend: true, resolutions: ["720p", "1080p", "4k"] },
        "veo-3.1-fast-generate-preview": { reference: true, extend: true, resolutions: ["720p", "1080p", "4k"] },
        "veo-3.1-lite-generate-preview": { reference: false, extend: false, resolutions: ["720p", "1080p"] }
    };
    function normalizeImageModel(modelId) {
        var value = String(modelId || "").replace(/^\s+|\s+$/g, "");
        return !value || value === LEGACY_IMAGE_MODEL || value === "gemini-2.5-flash-image" ? DEFAULT_IMAGE_MODEL : value;
    }
    function normalizeVideoModel(modelId) {
        var value = String(modelId || "").replace(/^\s+|\s+$/g, "");
        return VIDEO_MODELS[value] ? value : DEFAULT_VIDEO_MODEL;
    }
    function getVideoConstraints(input) {
        var source = input || {};
        var modelId = normalizeVideoModel(source.modelId);
        var model = VIDEO_MODELS[modelId];
        var duration = parseInt(source.durationSeconds, 10);
        var reference = source.mode === "reference";
        var extend = source.mode === "extend";
        return {
            modelId: modelId,
            allowReferenceMode: model.reference,
            allowExtendMode: model.extend,
            allowedDurations: reference || extend ? [8] : [4, 6, 8],
            allowedResolutions: extend ? ["720p"] : (duration === 8 ? model.resolutions.slice(0) : ["720p"]),
            allowedAspectRatios: ["16:9", "9:16"]
        };
    }
    return {
        DEFAULT_VIDEO_MODEL: DEFAULT_VIDEO_MODEL,
        DEFAULT_IMAGE_MODEL: DEFAULT_IMAGE_MODEL,
        LEGACY_IMAGE_MODEL: LEGACY_IMAGE_MODEL,
        VIDEO_MODELS: VIDEO_MODELS,
        normalizeImageModel: normalizeImageModel,
        normalizeVideoModel: normalizeVideoModel,
        getVideoConstraints: getVideoConstraints
    };
}));
