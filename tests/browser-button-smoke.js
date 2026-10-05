"use strict";

var assert = require("assert");

var port = Number(process.argv[2] || 9225);
var rootUrl = process.argv[3];
if (!rootUrl) { throw new Error("Root file URL is required."); }

function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function getTarget() {
    var deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            var targets = await fetch("http://127.0.0.1:" + port + "/json/list").then(function (response) { return response.json(); });
            var page = targets.filter(function (target) { return target.type === "page"; })[0];
            if (page) { return page; }
        } catch (error) {}
        await delay(200);
    }
    throw new Error("Edge DevTools endpoint did not become ready.");
}

async function run() {
    var target = await getTarget();
    var socket = new WebSocket(target.webSocketDebuggerUrl);
    var nextId = 1;
    var pending = {};
    var exceptions = [];

    socket.onmessage = function (event) {
        var message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown") {
            exceptions.push(message.params.exceptionDetails.text + ": " + ((message.params.exceptionDetails.exception || {}).description || ""));
        }
        if (message.id && pending[message.id]) {
            if (message.error) { pending[message.id].reject(new Error(message.error.message)); }
            else { pending[message.id].resolve(message.result); }
            delete pending[message.id];
        }
    };
    await new Promise(function (resolve, reject) { socket.onopen = resolve; socket.onerror = reject; });

    function command(method, params) {
        return new Promise(function (resolve, reject) {
            var id = nextId++;
            pending[id] = { resolve: resolve, reject: reject };
            socket.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        });
    }
    async function evaluate(expression) {
        var response = await command("Runtime.evaluate", { expression: expression, returnByValue: true, awaitPromise: true });
        if (response.exceptionDetails) {
            throw new Error(response.exceptionDetails.text + ": " + ((response.exceptionDetails.exception || {}).description || ""));
        }
        return response.result.value;
    }
    async function navigate(url) {
        await command("Page.navigate", { url: url });
        var deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
            if (await evaluate("document.readyState === 'complete'")) { await delay(500); return; }
            await delay(100);
        }
        throw new Error("Page load timed out: " + url);
    }

    await command("Runtime.enable");
    await command("Page.enable");
    await command("Page.addScriptToEvaluateOnNewDocument", { source:
        "window.__buttonSmoke={calls:[],bound:[]};var __vbAdd=EventTarget.prototype.addEventListener;EventTarget.prototype.addEventListener=function(t,f,o){if(this&&this.id){window.__buttonSmoke.bound.push(this.id+':'+t);}return __vbAdd.call(this,t,f,o);};" +
        "window.process={env:{APPDATA:'C:/VeoBridgeTest'},platform:'win32',pid:1};window.__vbFiles={};window.__vbMtimes={};window.__vbClock=1;window.__vbDirs={'C:':true,'C:/VeoBridgeTest':true};" +
        "window.require=function(n){var p={join:function(){return Array.prototype.slice.call(arguments).filter(Boolean).join('/').replace(/\\\\/g,'/').replace(/\\/{2,}/g,'/');},resolve:function(){return Array.prototype.slice.call(arguments).filter(Boolean).join('/').replace(/\\\\/g,'/').replace(/\\/{2,}/g,'/');},dirname:function(v){v=String(v).replace(/\\\\/g,'/');var i=v.lastIndexOf('/');return i>0?v.slice(0,i):v;},basename:function(v){v=String(v).replace(/\\\\/g,'/');return v.slice(v.lastIndexOf('/')+1);},extname:function(v){v=String(v);var b=v.slice(Math.max(v.lastIndexOf('/'),v.lastIndexOf('\\\\'))+1),i=b.lastIndexOf('.');return i>0?b.slice(i):'';}};" +
        "var f={existsSync:function(v){return Object.prototype.hasOwnProperty.call(window.__vbFiles,v)||!!window.__vbDirs[v];},mkdirSync:function(v){window.__vbDirs[v]=true;},writeFileSync:function(v,d){window.__vbFiles[v]=String(d);window.__vbMtimes[v]=++window.__vbClock;},readFileSync:function(v){if(!Object.prototype.hasOwnProperty.call(window.__vbFiles,v)){throw new Error('ENOENT');}return window.__vbFiles[v];},renameSync:function(a,b){window.__vbFiles[b]=window.__vbFiles[a];window.__vbMtimes[b]=++window.__vbClock;delete window.__vbFiles[a];delete window.__vbMtimes[a];},unlinkSync:function(v){delete window.__vbFiles[v];delete window.__vbMtimes[v];},copyFileSync:function(a,b){window.__vbFiles[b]=window.__vbFiles[a];window.__vbMtimes[b]=++window.__vbClock;},statSync:function(v){return {mtimeMs:window.__vbMtimes[v]||1,size:(window.__vbFiles[v]||'').length,isDirectory:function(){return !!window.__vbDirs[v];}}}};" +
        "if(n==='path'){return p;}if(n==='fs'){return f;}if(n==='os'){return {homedir:function(){return 'C:/Users/Test';}};}return null;};" +
        "window.__vbCepListeners={};window.__adobe_cep__={" +
        "evalScript:function(s,cb){window.__buttonSmoke.calls.push(s);var r='{\"ok\":true}';" +
        "if(s.indexOf('VeoBridge_getPaths')===0){r='{\"ok\":true,\"paths\":{\"baseDir\":\"C:/Temp\",\"bridgeDir\":\"C:/Temp/VeoBridge\",\"generatedDir\":\"C:/Temp/VeoBridge/Generated\",\"framesDir\":\"C:/Temp/VeoBridge/frames\"}}';}" +
        "if(s.indexOf('VeoBridge_ping')===0){r='{\"ok\":true,\"command\":\"ping\"}';}" +
        "if(s.indexOf('VeoBridge_captureProbe')===0){r='{\"ok\":true,\"command\":\"captureProbe\",\"path\":\"C:/Temp\"}';}" +
        "if(s.indexOf('VeoBridge_captureCurrentFrame')===0){r='{\"ok\":false,\"code\":\"NO_ACTIVE_COMP\",\"error\":\"Active composition is required.\"}';}" +
        "if(cb){cb(r);}},requestOpenExtension:function(id){window.__buttonSmoke.openExtensionCalls=(window.__buttonSmoke.openExtensionCalls||0)+1;var f='C:/VeoBridgeTest/VeoBridge/runtime.json',raw=window.__vbFiles[f],state=raw?JSON.parse(raw):{};window.__buttonSmoke.openSawPendingNonce=!!state.pendingOpenNonce;state.galleryReadyNonce=state.pendingOpenNonce||'';state.galleryLastSeenAt=Date.now();window.__vbFiles[f]=JSON.stringify(state);if(!window.__buttonSmoke.suppressGalleryReadyEvent){setTimeout(function(){var e={type:'com.veobridge.gallery.ready',data:JSON.stringify({nonce:state.galleryReadyNonce})};(window.__vbCepListeners[e.type]||[]).forEach(function(fn){fn(e);});},10);}},closeExtension:function(){},resizeContent:function(){},addEventListener:function(t,f){window.__vbCepListeners[t]=window.__vbCepListeners[t]||[];window.__vbCepListeners[t].push(f);},removeEventListener:function(){},dispatchEvent:function(e){(window.__vbCepListeners[e.type]||[]).forEach(function(fn){fn(e);});}};"
    });

    await navigate(rootUrl + "/index.html");
    var mainResult = await evaluate("(function(){" +
        "var r={};function c(id){document.getElementById(id).click();}" +
        "c('btnSettings');r.settingsOpen=!document.getElementById('settingsModal').hidden;" +
        "c('btnHostPing');r.hostPing=/passed/.test(document.getElementById('statusLine').textContent);" +
        "c('btnCaptureProbe');r.captureProbe=/passed/.test(document.getElementById('statusLine').textContent);" +
        "c('btnCloseSettings');r.settingsClosed=document.getElementById('settingsModal').hidden;" +
        "c('btnCreateComp');r.createOpen=!document.getElementById('createCompModal').hidden;" +
        "document.getElementById('bgColorSelect').value='Custom';document.getElementById('bgColorSelect').dispatchEvent(new Event('change'));c('btnColorSwatch');r.colorPopover=!document.getElementById('createCompColorPopover').hidden;" +
        "document.getElementById('createCompModal').click();r.createClosed=document.getElementById('createCompModal').hidden;" +
        "c('btnCapture');r.captureError=/Active composition/.test(document.getElementById('statusLine').textContent);" +
        "c('btnOpenGallery');r.galleryCall=true;r.cepStub=!!window.__adobe_cep__;r.requireStub=typeof window.require==='function';return r;}())");
    Object.keys(mainResult).forEach(function (key) { assert.strictEqual(mainResult[key], true, "main button failed: " + key + "; result=" + JSON.stringify(mainResult)); });
    await delay(180);
    var galleryHandshake = await evaluate("({status:document.getElementById('statusLine').textContent,openCalls:window.__buttonSmoke.openExtensionCalls||0,sawPending:!!window.__buttonSmoke.openSawPendingNonce})");
    assert.ok(/Gallery opened/.test(galleryHandshake.status), "Gallery ready acknowledgement must finish the launch without a false timeout: " + JSON.stringify(galleryHandshake));
    assert.strictEqual(galleryHandshake.openCalls, 1, "a successful Gallery handshake must not call requestOpenExtension twice");
    assert.strictEqual(galleryHandshake.sawPending, true, "the open nonce must be durable before CEP launches Gallery");
    await evaluate("window.__buttonSmoke.suppressGalleryReadyEvent=true;document.getElementById('btnOpenGallery').click();true");
    await delay(180);
    var galleryStorageFallback = await evaluate("({status:document.getElementById('statusLine').textContent,openCalls:window.__buttonSmoke.openExtensionCalls||0})");
    assert.ok(/Gallery opened/.test(galleryStorageFallback.status), "the durable storage acknowledgement must work when the CEP event is missed: " + JSON.stringify(galleryStorageFallback));
    assert.strictEqual(galleryStorageFallback.openCalls, 2, "each user launch attempt must call requestOpenExtension exactly once");
    var mainSweep = await evaluate("(function(){var failures=[],clicked=0;Array.prototype.forEach.call(document.querySelectorAll('button'),function(b){if(b.disabled){return;}try{b.click();clicked++;}catch(e){failures.push(b.id+': '+e);}});return {clicked:clicked,failures:failures};}())");
    assert.ok(mainSweep.clicked >= 10, "main sweep covered too few buttons");
    assert.deepStrictEqual(mainSweep.failures, [], "main click sweep failures");
    var malformedHost = await evaluate("(function(){window.__adobe_cep__.evalScript=function(s,cb){if(cb){cb('EvalScript error.');}};document.getElementById('btnCapture').click();return {status:document.getElementById('statusLine').textContent,copyVisible:!document.getElementById('btnCopyDiagnostic').hidden,title:document.getElementById('statusLine').title};}())");
    assert.ok(/EVALSCRIPT_ERROR/.test(malformedHost.status), "EvalScript failures need a short actionable code: " + JSON.stringify(malformedHost));
    assert.strictEqual(malformedHost.copyVisible, true, "invalid CEP responses must expose Copy error details");
    assert.ok(/EvalScript error/.test(malformedHost.title), "the raw CEP response must remain available in diagnostics");

    await navigate(rootUrl + "/gallery.html");
    var galleryResult = await evaluate("(function(){" +
        "var r={};function c(id){var e=document.getElementById(id);if(!e){throw new Error('missing '+id);}e.click();}" +
        "c('btnGenTypeImage');r.imageMode=document.getElementById('btnGenTypeImage').classList.contains('is-active');" +
        "c('btnGenTypeVideo');r.videoMode=document.getElementById('btnGenTypeVideo').classList.contains('is-active');" +
        "c('btnModeReference');r.referenceMode=localStorage.getItem('veobridge.videoMode')==='reference';" +
        "c('btnModeFrames');r.framesMode=document.getElementById('btnModeFrames').classList.contains('is-active');" +
        "c('btnVideoFlowOptions');r.optionsOpen=!document.getElementById('videoFlowOptions').hidden;" +
        "c('btnVideoFlowOptions');r.optionsClosed=document.getElementById('videoFlowOptions').hidden;" +
        "c('btnCleanup');r.cleanupOpen=!document.getElementById('cleanupConfirmModal').hidden;" +
        "c('btnCleanupCancel');r.cleanupClosed=document.getElementById('cleanupConfirmModal').hidden;" +
        "c('btnCleanup');c('btnCleanupConfirm');r.cleanupResult=!document.getElementById('cleanupConfirmModal').hidden&&/Cleanup complete/.test(document.getElementById('cleanupConfirmTitle').textContent)&&document.getElementById('btnCleanupConfirm').hidden;c('btnCleanupCancel');" +
        "c('btnDiagnostics');r.diagnosticsOpen=!document.getElementById('diagnosticsConfirmModal').hidden;" +
        "c('btnDiagnosticsCancel');r.diagnosticsClosed=document.getElementById('diagnosticsConfirmModal').hidden;" +
        "c('btnOpenVideoStartPicker');r.pickerOpen=!document.getElementById('videoPickerOverlay').hidden;" +
        "c('btnCloseVideoPicker');r.pickerClosed=document.getElementById('videoPickerOverlay').hidden;" +
        "return r;}())");
    Object.keys(galleryResult).forEach(function (key) { assert.strictEqual(galleryResult[key], true, "gallery button failed: " + key + "; result=" + JSON.stringify(galleryResult)); });
    await evaluate("(function(){" +
        "localStorage.setItem('veobridge.apiKey','ui-test-key');" +
        "window.VeoBridgeSecureStore.loadApiKey=function(){return 'ui-test-key';};" +
        "window.VeoApi.generateVideo=function(p){window.__buttonSmoke.videoCalls=(window.__buttonSmoke.videoCalls||0)+1;window.__buttonSmoke.activeVideoCalls=(window.__buttonSmoke.activeVideoCalls||0)+1;window.__buttonSmoke.maxActiveVideoCalls=Math.max(window.__buttonSmoke.maxActiveVideoCalls||0,window.__buttonSmoke.activeVideoCalls);if(!window.__buttonSmoke.pendingAtFirst){window.__buttonSmoke.pendingAtFirst=window.VeoBridgeState.getState().pendingJobs.map(function(j){return {id:j.id,status:j.status};});}window.__buttonSmoke.videoPayload={prompt:p.prompt,mode:p.mode,modelId:p.modelId,sampleIndex:p.sampleIndex,sampleCount:p.sampleCount};window.__buttonSmoke.videoPayloads.push(window.__buttonSmoke.videoPayload);if(p.onStatus){p.onStatus('Polling',{progressPercent:50});}return new Promise(function(resolve){setTimeout(function(){var out='C:/Temp/generated-'+p.sampleIndex+'.mp4';window.__vbFiles[out]='video';window.__vbMtimes[out]=++window.__vbClock;window.__buttonSmoke.activeVideoCalls-=1;resolve({downloadedPath:out,operationName:'operations/ui-test-'+p.sampleIndex,requestMode:p.mode});},40);});};" +
        "window.VeoApi.generateImage=function(p){window.__buttonSmoke.imagePayload={prompt:p.prompt,modelId:p.modelId};if(p.onStatus){p.onStatus('Downloading',{progressPercent:80});}window.__vbFiles['C:/Temp/generated.png']='image';window.__vbMtimes['C:/Temp/generated.png']=++window.__vbClock;return Promise.resolve({path:'C:/Temp/generated.png',downloadedPath:'C:/Temp/generated.png',modelId:p.modelId});};" +
        "document.getElementById('promptInput').value='UI video smoke';document.getElementById('btnGenTypeVideo').click();document.getElementById('sampleCountSelect').value='2';window.__buttonSmoke.videoCalls=0;window.__buttonSmoke.activeVideoCalls=0;window.__buttonSmoke.maxActiveVideoCalls=0;window.__buttonSmoke.videoPayloads=[];window.__buttonSmoke.generateClickObserved=false;document.getElementById('btnGenerate').addEventListener('click',function(e){window.__buttonSmoke.generateClickObserved=true;window.__buttonSmoke.markerAtTarget=!!e._veoBridgeGenerateHandled;},{once:true});document.addEventListener('click',function(e){if(e.target&&e.target.closest&&e.target.closest('#btnGenerate')){window.__buttonSmoke.markerAtDocument=!!e._veoBridgeGenerateHandled;}},{once:true});document.getElementById('btnGenerate').click();return true;}())");
    await delay(1200);
    var videoGenerate = await evaluate("({payload:window.__buttonSmoke.videoPayload||null,imagePayload:window.__buttonSmoke.imagePayload||null,status:(document.getElementById('galleryStatus')||{}).textContent||'',generationStatus:(document.getElementById('generationStatus')||{}).textContent||'',imageGenerationStatus:(document.getElementById('imageGenerationStatus')||{}).textContent||'',key:localStorage.getItem('veobridge.apiKey'),genType:localStorage.getItem('veobridge.genType'),videoActive:document.getElementById('btnGenTypeVideo').classList.contains('is-active'),generateDisabled:document.getElementById('btnGenerate').disabled,prompt:document.getElementById('promptInput').value,mode:localStorage.getItem('veobridge.videoMode'),clickObserved:window.__buttonSmoke.generateClickObserved,markerAtTarget:window.__buttonSmoke.markerAtTarget,markerAtDocument:window.__buttonSmoke.markerAtDocument,bound:window.__buttonSmoke.bound.filter(function(x){return x.indexOf('btnGenerate:')===0;})})");
    assert.ok(videoGenerate.payload && videoGenerate.payload.prompt === "UI video smoke", "Generate Video button did not reach the API adapter: " + JSON.stringify(videoGenerate) + "; exceptions=" + JSON.stringify(exceptions));
    var videoCalls = await evaluate("({count:window.__buttonSmoke.videoCalls,maxActive:window.__buttonSmoke.maxActiveVideoCalls,payloads:window.__buttonSmoke.videoPayloads,pendingAtFirst:window.__buttonSmoke.pendingAtFirst,selected:document.getElementById('sampleCountSelect').value})");
    assert.strictEqual(videoCalls.count, 2, "x2 must submit exactly two API operations: " + JSON.stringify(videoCalls));
    assert.strictEqual(videoCalls.maxActive, 1, "video requests must run strictly one at a time: " + JSON.stringify(videoCalls));
    await evaluate("(function(){document.getElementById('imageSampleCountSelect').value='1';document.getElementById('btnGenTypeImage').click();document.getElementById('promptInput').value='UI image smoke';document.getElementById('btnGenerate').click();return true;}())");
    await delay(1200);
    var imageGenerate = await evaluate("window.__buttonSmoke.imagePayload||null");
    assert.ok(imageGenerate && imageGenerate.prompt === "UI image smoke", "Generate Image button did not reach the API adapter");
    await evaluate("(function(){window.__buttonSmoke.callsBeforeStaleRecovery=window.__buttonSmoke.videoCalls;window.VeoBridgeState.updateState({pendingJobs:[{id:'stale-upload',kind:'video',batchId:'stale-batch',status:'uploading',createdAt:'2000-01-01T00:00:00.000Z',updatedAt:'2000-01-01T00:00:00.000Z',prompt:'Interrupted extend',modelId:'veo-3.1-fast-generate-preview',apiMode:'extend',uiMode:'extend',seed:91,sourceVideoId:'source-1',sourceVideoPath:'C:/Temp/source.mp4',durationSeconds:8,resolution:'720p'}]});return true;}())");
    await delay(300);
    var staleRecovery = await evaluate("(function(){var j=window.VeoBridgeState.getState().pendingJobs[0]||{},row=document.querySelector('[data-group-key=\"video:stale-batch\"]'),texts=row?Array.prototype.map.call(row.querySelectorAll('button'),function(b){return b.textContent;}):[];return {calls:window.__buttonSmoke.videoCalls,before:window.__buttonSmoke.callsBeforeStaleRecovery,status:j.status,seed:j.seed,sourceVideoId:j.sourceVideoId,sourceVideoPath:j.sourceVideoPath,actions:texts};}())");
    assert.strictEqual(staleRecovery.calls, staleRecovery.before, "an interrupted POST without operationName must not be resent automatically");
    assert.strictEqual(staleRecovery.status, "needs_review");
    assert.strictEqual(staleRecovery.seed, 91, "stale recovery must preserve seed");
    assert.strictEqual(staleRecovery.sourceVideoId, "source-1", "stale recovery must preserve Extend source linkage");
    assert.strictEqual(staleRecovery.sourceVideoPath, "C:/Temp/source.mp4");
    assert.ok(staleRecovery.actions.indexOf("Retry with warning") >= 0, "Needs Review must require an explicit warned retry");
    assert.ok(staleRecovery.actions.indexOf("Stop tracking") >= 0, "Needs Review must be dismissible only through Stop tracking");
    assert.strictEqual(staleRecovery.actions.indexOf("Clear"), -1, "Needs Review must not expose an unsafe Clear action");
    await evaluate("window.VeoBridgeState.updateState({pendingJobs:[]})");
    await evaluate("(function(){var now=new Date().toISOString();window.__buttonSmoke.callsBeforeManualResume=window.__buttonSmoke.videoCalls;window.VeoBridgeState.updateState({pendingJobs:[{id:'manual-resume',kind:'video',batchId:'manual-batch',status:'waiting_resume',resumeRequired:true,createdAt:now,updatedAt:now,prompt:'Manual resume smoke',modelId:'veo-3.1-generate-preview',aspectRatio:'16:9',uiMode:'frames',apiMode:'text',durationSeconds:8,resolution:'720p',sampleIndex:1,sampleCount:1}]});return true;}())");
    await delay(400);
    var waitingResume = await evaluate("({calls:window.__buttonSmoke.videoCalls,before:window.__buttonSmoke.callsBeforeManualResume,label:Array.prototype.map.call(document.querySelectorAll('.state-chip'),function(e){return e.textContent;}).join('|'),resume:Array.prototype.filter.call(document.querySelectorAll('button'),function(e){return e.textContent==='Resume';}).length,cancel:Array.prototype.filter.call(document.querySelectorAll('button'),function(e){return e.textContent==='Cancel queued job(s)';}).length})");
    assert.strictEqual(waitingResume.calls, waitingResume.before, "waiting_resume must not submit automatically");
    assert.ok(/Waiting for Resume/.test(waitingResume.label), "manual recovery state must be visible: " + JSON.stringify(waitingResume));
    assert.ok(waitingResume.resume >= 1, "manual recovery must provide a Resume action");
    assert.ok(waitingResume.cancel >= 1, "an unsent job must provide an explicit Cancel queued job action");
    await evaluate("Array.prototype.filter.call(document.querySelectorAll('button'),function(e){return e.textContent==='Resume';})[0].click()");
    await delay(700);
    var resumedState = await evaluate("({calls:window.__buttonSmoke.videoCalls,pending:window.VeoBridgeState.getState().pendingJobs.length})");
    assert.strictEqual(resumedState.calls, waitingResume.before + 1, "Resume must submit exactly one waiting job");
    assert.strictEqual(resumedState.pending, 0, "resumed job must finalize normally");

    await evaluate("(function(){var now=new Date().toISOString();window.VeoBridgeState.updateState({pendingJobs:[{id:'accepted-protected',kind:'video',batchId:'protected-batch',status:'failed',createdAt:now,updatedAt:now,prompt:'Protected operation',modelId:'veo-3.1-generate-preview',aspectRatio:'16:9',uiMode:'frames',apiMode:'text',durationSeconds:8,resolution:'720p',sampleIndex:1,sampleCount:1,operationName:'operations/protected'}]});return true;}())");
    await delay(300);
    var protectedActions = await evaluate("(function(){var row=document.querySelector('[data-group-key=\"video:protected-batch\"]');return {clear:row?Array.prototype.filter.call(row.querySelectorAll('button'),function(e){return e.textContent==='Clear';}).length:-1,stop:row?Array.prototype.filter.call(row.querySelectorAll('button'),function(e){return e.textContent==='Stop tracking';}).length:-1};}())");
    assert.strictEqual(protectedActions.clear, 0, "Clear must not be offered for an accepted Google operation");
    assert.strictEqual(protectedActions.stop, 1, "accepted terminal operations need an explicit Stop tracking action");
    await evaluate("window.VeoBridgeState.updateState({pendingJobs:[]})");
    await evaluate("(function(){document.getElementById('btnGenTypeVideo').click();document.getElementById('sampleCountSelect').value='1';window.__vbFiles['C:/Temp/start.png']='x';window.__vbFiles['C:/Temp/end.png']='x';var now=new Date().toISOString();window.VeoBridgeState.updateState({shots:[{id:'start',path:'C:/Temp/start.png',createdAt:now},{id:'end',path:'C:/Temp/end.png',createdAt:now}],startShotId:'start',endShotId:'end',videoGenSettings:{mode:'frames',model:'veo-3.1-generate-preview',aspectRatio:'16:9',durationSeconds:8,resolution:'720p',seed:null}});document.getElementById('promptInput').value='Transport regression smoke';window.VeoApi.probeVideoCapabilities=function(){return Promise.resolve({ok:true,textToVideo:true,inlineData:true});};window.VeoApi.generateVideo=function(){var e=new Error('Uploading failed: Gemini rejected both supported media payload formats. Google response: inlineData is not supported');e.code='MEDIA_TRANSPORT_UNSUPPORTED';e.statusCode=400;e.details='inlineData is not supported';e.originalMessage='HTTP 400: inlineData is not supported';e.requestTransport='inline';return Promise.reject(e);};document.getElementById('btnGenerate').click();return true;}())");
    await delay(1200);
    var fallbackState = await evaluate("(function(){var s=window.VeoBridgeState.getState(),row=document.querySelector('[data-group-key^=\"video:\"]');return {start:s.startShotId,end:s.endShotId,videoRefs:(s.videoRefs||[]).length,pending:(s.pendingJobs||[]).length,status:document.getElementById('generationStatus').textContent,meta:row&&row.querySelector('.flow-row-sub')?row.querySelector('.flow-row-sub').textContent:'',details:row&&row.querySelector('.flow-row-error')?row.querySelector('.flow-row-error').title:''};}())");
    assert.strictEqual(fallbackState.start, "start", "transport errors must preserve Start: " + JSON.stringify(fallbackState));
    assert.strictEqual(fallbackState.end, "end", "transport errors must preserve End");
    assert.strictEqual(fallbackState.videoRefs, 0, "transport errors must not invent Ingredients");
    assert.ok(!/key\/project|cleared|Text-to-Video/i.test(fallbackState.status), "transport errors must not be masked as key access failures: " + fallbackState.status);
    assert.ok(/HTTP 400/.test(fallbackState.meta) && /transport: inline/.test(fallbackState.meta), "pending cards must show HTTP and transport metadata: " + JSON.stringify(fallbackState));
    assert.ok(/inlineData is not supported/.test(fallbackState.details), "the original Google detail must remain available on the error card");
    await evaluate("document.getElementById('btnCleanup').click();document.getElementById('btnCleanupConfirm').click();");
    var cleanedPending = await evaluate("window.VeoBridgeState.getState().pendingJobs.length");
    assert.strictEqual(cleanedPending, 0, "Cleanup must remove terminal failed jobs");
    await evaluate("document.getElementById('btnCleanupCancel').click();");
    var gallerySweep = await evaluate("(function(){var failures=[],clicked=0;Array.prototype.forEach.call(document.querySelectorAll('button'),function(b){if(b.disabled){return;}try{b.click();clicked++;}catch(e){failures.push(b.id+': '+e);}});return {clicked:clicked,failures:failures};}())");
    assert.ok(gallerySweep.clicked >= 35, "gallery sweep covered too few buttons: " + gallerySweep.clicked);
    assert.deepStrictEqual(gallerySweep.failures, [], "gallery click sweep failures");
    await delay(500);
    assert.deepStrictEqual(exceptions, [], "uncaught browser errors: " + exceptions.join("\n"));
    socket.close();
    console.log("Browser button smoke passed: " + Object.keys(mainResult).length + " main assertions, " + Object.keys(galleryResult).length + " gallery assertions, Video/Image generation routes; swept " + mainSweep.clicked + "+" + gallerySweep.clicked + " enabled buttons.");
}

run().catch(function (error) { console.error(error && error.stack ? error.stack : error); process.exit(1); });
