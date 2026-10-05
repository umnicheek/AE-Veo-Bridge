(function (global) {
    "use strict";

    if (!global.VeoBridgeGalleryModules) {
        global.VeoBridgeGalleryModules = {};
    }

    function create(options) {
        var opts = options || {};
        var getById = typeof opts.getById === "function" ? opts.getById : function () { return null; };
        var logger = typeof opts.logger === "function" ? opts.logger : null;
        var mediaObserver = null;
        var activeVideos = [];
        var MAX_ACTIVE_VIDEOS = 10;

        function releaseVideo(video) {
            var index;
            if (!video) { return; }
            try { video.pause(); } catch (ignorePause) { /* ignore */ }
            video.removeAttribute("src");
            try { video.load(); } catch (ignoreLoad) { /* ignore */ }
            index = activeVideos.indexOf(video);
            if (index >= 0) { activeVideos.splice(index, 1); }
        }

        function activateMedia(el) {
            var mediaSrc = el && el.getAttribute ? el.getAttribute("data-media-src") : "";
            if (!el || !mediaSrc || el.getAttribute("src")) { return; }
            if (String(el.tagName || "").toLowerCase() === "video") {
                while (activeVideos.length >= MAX_ACTIVE_VIDEOS) { releaseVideo(activeVideos.shift()); }
                activeVideos.push(el);
            }
            el.setAttribute("src", mediaSrc);
        }

        function observeLazyMedia(container) {
            var nodes;
            var i;
            var isVideo;
            var fallbackVideoCount = 0;
            if (!container || !container.querySelectorAll) { return; }
            nodes = container.querySelectorAll("[data-media-src]");
            if (typeof global.IntersectionObserver !== "function") {
                for (i = 0; i < nodes.length; i += 1) {
                    isVideo = String(nodes[i].tagName || "").toLowerCase() === "video";
                    if (!isVideo || fallbackVideoCount < MAX_ACTIVE_VIDEOS) {
                        activateMedia(nodes[i]);
                        if (isVideo) { fallbackVideoCount += 1; }
                    }
                }
                return;
            }
            if (!mediaObserver) {
                mediaObserver = new global.IntersectionObserver(function (entries) {
                    var j;
                    for (j = 0; j < entries.length; j += 1) {
                        if (entries[j].isIntersecting) { activateMedia(entries[j].target); }
                        else if (String(entries[j].target.tagName || "").toLowerCase() === "video") { releaseVideo(entries[j].target); }
                    }
                }, { root: null, rootMargin: "600px 0px", threshold: 0.01 });
            }
            mediaObserver.disconnect();
            for (i = activeVideos.length - 1; i >= 0; i -= 1) {
                if (!activeVideos[i] || !container.contains(activeVideos[i])) { releaseVideo(activeVideos[i]); }
            }
            for (i = 0; i < nodes.length; i += 1) { mediaObserver.observe(nodes[i]); }
        }

        function disconnectLazyMedia() {
            var i;
            if (mediaObserver) { mediaObserver.disconnect(); }
            for (i = activeVideos.length - 1; i >= 0; i -= 1) { releaseVideo(activeVideos[i]); }
            mediaObserver = null;
        }

        function _log(level, message, extra) {
            if (!logger) {
                return;
            }
            try {
                logger(level, message, extra || null);
            } catch (error) {
                // Ignore logger issues.
            }
        }

        function setLine(id, text, isError, className) {
            var el = getById(id);
            var nextText = String(typeof text === "undefined" ? "" : text);
            if (!el) {
                return;
            }
            el.textContent = nextText;
            if (className) {
                el.className = isError ? className + " is-error" : className;
            }
            _log(isError ? "error" : "info", "ui.status." + id, {
                text: nextText
            });
        }

        return {
            setLine: setLine,
            observeLazyMedia: observeLazyMedia,
            disconnectLazyMedia: disconnectLazyMedia
        };
    }

    global.VeoBridgeGalleryModules.render = {
        create: create
    };
}(window));
