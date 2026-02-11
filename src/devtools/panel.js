(function() {
  'use strict';

  var MAX_SCREENSHOT_HEIGHT = 16384;
  var CAPTURE_DELAY = 200;

  var dumpBtn = document.getElementById('dumpBtn');
  var dumpNoReloadBtn = document.getElementById('dumpNoReloadBtn');
  var statusEl = document.getElementById('status');
  var resultEl = document.getElementById('result');
  var resultPath = document.getElementById('resultPath');
  var copyBtn = document.getElementById('copyBtn');
  var basePathInput = document.getElementById('basePath');
  var idleTimeInput = document.getElementById('idleTime');
  var saveSettingsBtn = document.getElementById('saveSettings');
  var progressEl = document.getElementById('progress');
  var idleBox = document.getElementById('idleBox');
  var idleLabel = document.getElementById('idleLabel');
  var idleBarFill = document.getElementById('idleBarFill');
  var captureNowBtn = document.getElementById('captureNowBtn');

  // Load saved settings
  chrome.storage.local.get(['basePath', 'idleTime'], function(result) {
    if (result.basePath) basePathInput.value = result.basePath;
    if (result.idleTime !== undefined) idleTimeInput.value = result.idleTime;
  });

  saveSettingsBtn.addEventListener('click', function() {
    chrome.storage.local.set({
      basePath: basePathInput.value.trim() || 'debug-dumps',
      idleTime: parseFloat(idleTimeInput.value) || 2
    });
    setStatus('Settings saved.', 'success');
  });

  // Sync settings changed via popup
  chrome.storage.onChanged.addListener(function(changes) {
    if (changes.basePath) basePathInput.value = changes.basePath.newValue;
    if (changes.idleTime) idleTimeInput.value = changes.idleTime.newValue;
  });

  dumpBtn.addEventListener('click', startDump);
  dumpNoReloadBtn.addEventListener('click', startDumpNoReload);

  copyBtn.addEventListener('click', function() {
    copyToClipboard(resultPath.textContent).then(function() {
      setStatus('Path copied to clipboard!', 'success');
    }).catch(function() {
      setStatus('Clipboard copy failed - select and copy manually.', 'error');
    });
  });

  // ---- Helpers ----

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('copy failed');
    });
  }

  function setStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (type || '');
  }

  function updateProgress(step, state) {
    var item = progressEl.querySelector('[data-step="' + step + '"]');
    if (item) item.className = 'progress-item ' + state;
  }

  function resetProgress() {
    var items = progressEl.querySelectorAll('.progress-item');
    for (var i = 0; i < items.length; i++) items[i].className = 'progress-item';
  }

  function evalInPage(code) {
    return new Promise(function(resolve, reject) {
      chrome.devtools.inspectedWindow.eval(code, function(result, ex) {
        if (ex) reject(new Error('eval failed'));
        else resolve(result);
      });
    });
  }

  function delay(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  // ---- Direct file download (bypasses 64MB sendMessage limit) ----

  function downloadOneFile(url, filename) {
    return new Promise(function(resolve, reject) {
      chrome.downloads.download({
        url: url, filename: filename, conflictAction: 'uniquify', saveAs: false
      }, function(downloadId) {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        function onChanged(delta) {
          if (delta.id !== downloadId || !delta.state) return;
          if (delta.state.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChanged);
            chrome.downloads.search({ id: downloadId }, function(items) {
              resolve(items && items[0] ? items[0].filename : '');
            });
          } else if (delta.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error('Download interrupted'));
          }
        }
        chrome.downloads.onChanged.addListener(onChanged);
      });
    });
  }

  function textToDataUrl(text) {
    return 'data:application/octet-stream;base64,' + btoa(unescape(encodeURIComponent(text)));
  }

  function saveAllFiles(folderName, files, screenshotDataUrl) {
    var promises = [];
    var keys = Object.keys(files);
    for (var i = 0; i < keys.length; i++) {
      promises.push(downloadOneFile(textToDataUrl(files[keys[i]]), folderName + '/' + keys[i]));
    }
    if (screenshotDataUrl) {
      promises.push(downloadOneFile(screenshotDataUrl, folderName + '/screenshot.jpg'));
    }
    return Promise.allSettled(promises).then(function(results) {
      var ok = results.filter(function(r) { return r.status === 'fulfilled'; });
      var path = '';
      if (ok.length > 0 && ok[0].value) {
        var f = ok[0].value;
        var s = Math.max(f.lastIndexOf('/'), f.lastIndexOf('\\'));
        if (s > 0) path = f.substring(0, s);
      }
      return { downloadPath: path || folderName };
    });
  }

  // ---- Main flow ----

  function setButtonsDisabled(disabled) {
    dumpBtn.disabled = disabled;
    dumpNoReloadBtn.disabled = disabled;
  }

  function startDump() {
    setButtonsDisabled(true);
    resultEl.classList.add('hidden');
    idleBox.classList.add('hidden');
    progressEl.classList.remove('hidden');
    resetProgress();
    setStatus('Reloading page...', 'info');

    chrome.devtools.inspectedWindow.reload({});

    waitForPageLoad().then(function() {
      return performCapture();
    }).catch(function(err) {
      setStatus('Error: ' + err.message, 'error');
      console.error('Dump failed:', err);
    }).then(function() {
      setButtonsDisabled(false);
      idleBox.classList.add('hidden');
    });
  }

  function startDumpNoReload() {
    setButtonsDisabled(true);
    resultEl.classList.add('hidden');
    idleBox.classList.add('hidden');
    progressEl.classList.remove('hidden');
    resetProgress();

    performCapture().catch(function(err) {
      setStatus('Error: ' + err.message, 'error');
      console.error('Dump failed:', err);
    }).then(function() {
      setButtonsDisabled(false);
    });
  }

  function performCapture() {
    setStatus('Collecting page state...', 'info');
    return Promise.all([
      collectHAR(),
      collectHTML(),
      collectConsoleLogs(),
      collectMeta()
    ]).then(function(results) {
      var har = results[0];
      var html = results[1];
      var consoleLogs = results[2];
      var meta = results[3];

      setStatus('Capturing screenshot...', 'info');
      return captureFullPageScreenshot().then(function(screenshotDataUrl) {
        return {
          har: har, html: html, consoleLogs: consoleLogs, meta: meta,
          screenshotDataUrl: screenshotDataUrl
        };
      });
    }).then(function(data) {
      var sanitizedUrl = sanitizeForFilename(data.meta.url);
      var timestamp = formatTimestamp(new Date());
      var basePath = basePathInput.value.trim() || 'debug-dumps';
      var folderName = basePath + '/' + sanitizedUrl + '-' + timestamp;

      updateProgress('download', 'active');
      setStatus('Saving files...', 'info');

      return saveAllFiles(folderName, {
        'network.har': JSON.stringify(data.har, null, 2),
        'page.html': data.html,
        'console.json': JSON.stringify(data.consoleLogs, null, 2),
        'meta.json': JSON.stringify(data.meta, null, 2)
      }, data.screenshotDataUrl);
    }).then(function(response) {
      updateProgress('download', 'done');

      var downloadPath = response.downloadPath;
      resultPath.textContent = downloadPath;
      resultEl.classList.remove('hidden');

      return copyToClipboard(downloadPath).then(function() {
        setStatus('Dump complete! Path copied to clipboard.', 'success');
      }).catch(function() {
        setStatus('Dump complete! Copy the path manually below.', 'success');
      });
    });
  }

  // ---- Page load detection ----

  function waitForPageLoad() {
    return waitForReadyState().then(function() {
      return waitForNetworkIdle();
    });
  }

  function waitForReadyState() {
    return new Promise(function(resolve) {
      setTimeout(function() {
        var interval = setInterval(function() {
          chrome.devtools.inspectedWindow.eval('document.readyState', function(r, ex) {
            if (!ex && r === 'complete') {
              clearInterval(interval);
              resolve();
            }
          });
        }, 300);
      }, 1000);
    });
  }

  function waitForNetworkIdle() {
    var IDLE_TIME = (parseFloat(idleTimeInput.value) || 2) * 1000;
    var MAX_WAIT = 30000;

    if (IDLE_TIME <= 0) return Promise.resolve();

    return new Promise(function(resolve) {
      var timer = null;
      var safetyTimer = null;
      var progressInterval = null;
      var idleStart = Date.now();
      var resolved = false;

      // Show idle UI
      idleBox.classList.remove('hidden');
      idleBarFill.style.width = '0%';
      idleLabel.textContent = 'Waiting for network idle...';

      // Progress bar animation
      progressInterval = setInterval(function() {
        var elapsed = Date.now() - idleStart;
        var pct = Math.min(100, (elapsed / IDLE_TIME) * 100);
        idleBarFill.style.width = pct + '%';
        var remaining = Math.max(0, (IDLE_TIME - elapsed) / 1000);
        idleLabel.textContent = 'Network idle in ' + remaining.toFixed(1) + 's...';
      }, 100);

      function done() {
        if (resolved) return;
        resolved = true;
        chrome.devtools.network.onRequestFinished.removeListener(onRequest);
        captureNowBtn.removeEventListener('click', done);
        if (timer) clearTimeout(timer);
        if (safetyTimer) clearTimeout(safetyTimer);
        if (progressInterval) clearInterval(progressInterval);
        idleBox.classList.add('hidden');
        resolve();
      }

      function onRequest() {
        // Reset idle countdown
        idleStart = Date.now();
        idleBarFill.style.width = '0%';
        if (timer) clearTimeout(timer);
        timer = setTimeout(done, IDLE_TIME);
      }

      // "Capture Now" button
      captureNowBtn.addEventListener('click', done);

      chrome.devtools.network.onRequestFinished.addListener(onRequest);
      timer = setTimeout(done, IDLE_TIME);
      safetyTimer = setTimeout(done, MAX_WAIT);
    });
  }

  // ---- Full page screenshot (scroll & stitch) ----

  // Uses CSS class + <style> tag (survives framework re-renders)
  // Fixed elements: visibility:hidden (out-of-flow, content behind them shows through)
  // Sticky elements: position:relative (stays in flow, scrolls normally instead of sticking)
  function neutralizeFixedElements() {
    return evalInPage(
      '(function(){' +
      'var s=document.createElement("style");' +
      's.id="__dbg_ss";' +
      's.textContent=".__dbg_hf{visibility:hidden!important;}.__dbg_hs{position:relative!important;}";' +
      'document.head.appendChild(s);' +
      'var all=document.querySelectorAll("*");' +
      'for(var i=0;i<all.length;i++){' +
      'var cs=getComputedStyle(all[i]);' +
      'if(cs.position==="fixed")all[i].classList.add("__dbg_hf");' +
      'else if(cs.position==="sticky")all[i].classList.add("__dbg_hs");' +
      '}' +
      '})()'
    ).catch(function() {});
  }

  function restoreFixedElements() {
    return evalInPage(
      '(function(){' +
      'var s=document.getElementById("__dbg_ss");' +
      'if(s)s.remove();' +
      'document.querySelectorAll(".__dbg_hf,.__dbg_hs").forEach(function(e){' +
      'e.classList.remove("__dbg_hf","__dbg_hs");' +
      '});' +
      '})()'
    ).catch(function() {});
  }

  function captureFullPageScreenshot() {
    updateProgress('screenshot', 'active');

    return evalInPage(
      'JSON.stringify({sh:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),' +
      'vh:window.innerHeight,st:window.scrollY})'
    ).then(function(raw) {
      var dims = JSON.parse(raw);
      var totalHeight = Math.min(dims.sh, MAX_SCREENSHOT_HEIGHT);
      var viewportH = dims.vh;
      var originalScroll = dims.st;

      if (viewportH <= 0) throw new Error('viewport height is 0');

      var numChunks = Math.ceil(totalHeight / viewportH);
      var captures = [];

      // Chunk 0: capture with fixed/sticky elements visible (header/sidebar shown once)
      var chain = Promise.resolve().then(function() {
        return evalInPage('window.scrollTo(0,0);window.scrollY').then(function(actualY) {
          return delay(CAPTURE_DELAY).then(function() {
            return captureViewport().then(function(dataUrl) {
              if (dataUrl) captures.push({ y: parseFloat(actualY), dataUrl: dataUrl });
            });
          });
        });
      });

      // Chunks 1+: hide fixed elements, un-stick sticky elements
      if (numChunks > 1) {
        chain = chain.then(function() {
          return neutralizeFixedElements();
        });

        for (var i = 1; i < numChunks; i++) {
          (function(index) {
            chain = chain.then(function() {
              var scrollY = index * viewportH;
              return evalInPage('window.scrollTo(0,' + scrollY + ');window.scrollY')
                .then(function(actualY) {
                  return delay(CAPTURE_DELAY).then(function() {
                    return captureViewport().then(function(dataUrl) {
                      if (dataUrl) captures.push({ y: parseFloat(actualY), dataUrl: dataUrl });
                    });
                  });
                });
            });
          })(i);
        }

        chain = chain.then(function() {
          return restoreFixedElements();
        });
      }

      return chain.then(function() {
        return evalInPage('window.scrollTo(0,' + originalScroll + ')');
      }).then(function() {
        if (captures.length === 0) return null;
        return stitchCaptures(captures, totalHeight);
      });
    }).then(function(dataUrl) {
      updateProgress('screenshot', dataUrl ? 'done' : 'error');
      return dataUrl;
    }).catch(function(err) {
      return restoreFixedElements().then(function() {
        console.warn('Full page screenshot failed:', err);
        updateProgress('screenshot', 'error');
        return null;
      });
    });
  }

  // Separate from sendMsg - doesn't reject on captureVisibleTab errors
  function captureViewport() {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ action: 'captureViewport', tabId: chrome.devtools.inspectedWindow.tabId }, function(response) {
        if (chrome.runtime.lastError) {
          console.warn('captureViewport error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response && response.dataUrl ? response.dataUrl : null);
        }
      });
    });
  }

  function stitchCaptures(captures, totalHeight) {
    return loadImage(captures[0].dataUrl).then(function(firstImg) {
      var imgW = firstImg.width;
      var chunkH = firstImg.height;

      if (captures.length === 1) return captures[0].dataUrl;

      // DPR: ratio of image pixels to CSS pixels
      var cssChunkH = captures.length > 1
        ? (captures[1].y - captures[0].y)
        : totalHeight;
      var scale = cssChunkH > 0 ? chunkH / cssChunkH : 1;

      var canvasH = Math.round(totalHeight * scale);
      var canvas = document.createElement('canvas');
      canvas.width = imgW;
      canvas.height = canvasH;
      var ctx = canvas.getContext('2d');

      ctx.drawImage(firstImg, 0, 0);

      var chain = Promise.resolve();
      for (var i = 1; i < captures.length; i++) {
        (function(index) {
          chain = chain.then(function() {
            return loadImage(captures[index].dataUrl).then(function(img) {
              var drawY;
              if (index === captures.length - 1) {
                // Last chunk: align to bottom to avoid overlap seam
                drawY = canvasH - img.height;
              } else {
                drawY = Math.round(captures[index].y * scale);
              }
              ctx.drawImage(img, 0, drawY);
            });
          });
        })(i);
      }

      return chain.then(function() {
        return canvas.toDataURL('image/jpeg', 0.85);
      });
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { resolve(img); };
      img.onerror = function() { reject(new Error('Failed to load image')); };
      img.src = dataUrl;
    });
  }

  // ---- Data collectors ----

  function collectHAR() {
    updateProgress('har', 'active');
    return new Promise(function(resolve) {
      chrome.devtools.network.getHAR(function(harLog) {
        updateProgress('har', 'done');
        resolve(harLog);
      });
    });
  }

  function collectHTML() {
    updateProgress('html', 'active');
    return new Promise(function(resolve, reject) {
      chrome.devtools.inspectedWindow.eval(
        'document.documentElement.outerHTML',
        function(result, ex) {
          if (ex) { updateProgress('html', 'error'); reject(new Error('Failed to capture HTML')); }
          else { updateProgress('html', 'done'); resolve(result); }
        }
      );
    });
  }

  function collectConsoleLogs() {
    updateProgress('console', 'active');
    return new Promise(function(resolve) {
      chrome.devtools.inspectedWindow.eval(
        'JSON.stringify(window.__debugConsoleLogs||[])',
        function(result, ex) {
          if (ex) { updateProgress('console', 'error'); resolve([]); }
          else {
            updateProgress('console', 'done');
            try { resolve(JSON.parse(result)); } catch (e) { resolve([]); }
          }
        }
      );
    });
  }

  function collectMeta() {
    updateProgress('meta', 'active');
    return new Promise(function(resolve, reject) {
      var code = 'JSON.stringify({' +
        'url:location.href,' +
        'title:document.title,' +
        'timestamp:new Date().toISOString(),' +
        'viewport:{width:window.innerWidth,height:window.innerHeight},' +
        'scrollHeight:document.documentElement.scrollHeight,' +
        'userAgent:navigator.userAgent,' +
        'referrer:document.referrer,' +
        'readyState:document.readyState' +
      '})';
      chrome.devtools.inspectedWindow.eval(code, function(result, ex) {
        if (ex) { updateProgress('meta', 'error'); reject(new Error('Failed to capture meta')); }
        else { updateProgress('meta', 'done'); resolve(JSON.parse(result)); }
      });
    });
  }

  // ---- Utilities ----

  function sanitizeForFilename(url) {
    try {
      var p = new URL(url);
      var name = p.host + p.pathname;
      name = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      if (name.length > 80) name = name.substring(0, 80);
      return name;
    } catch (e) { return 'unknown-page'; }
  }

  function formatTimestamp(date) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      '_' + pad(date.getHours()) + '-' + pad(date.getMinutes()) + '-' + pad(date.getSeconds());
  }

})();
