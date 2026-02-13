(function() {
  'use strict';

  var MAX_SCREENSHOT_HEIGHT = 16384;
  var CAPTURE_DELAY = 200;
  var DEFAULT_TOGGLES = { har: true, html: true, console: true, meta: true, screenshot: false };

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
  var togglesContainer = document.getElementById('toggles');

  var dumpToggles = Object.assign({}, DEFAULT_TOGGLES);

  // Track network errors (browser-generated, not captured by JS console hook)
  var networkErrors = [];
  var MAX_NETWORK_ERRORS = 1000;

  chrome.devtools.network.onRequestFinished.addListener(function(entry) {
    var status = entry.response.status;
    if (status >= 400) {
      networkErrors.push({
        level: 'error',
        timestamp: entry.startedDateTime,
        args: [entry.request.method + ' ' + entry.request.url + ' ' + status + ' (' + entry.response.statusText + ')']
      });
      if (networkErrors.length > MAX_NETWORK_ERRORS) networkErrors.shift();
    }
  });

  chrome.devtools.network.onNavigated.addListener(function() {
    networkErrors = [];
  });

  // Load saved settings
  chrome.storage.local.get(['basePath', 'idleTime', 'dumpToggles'], function(result) {
    if (result.basePath) basePathInput.value = result.basePath;
    if (result.idleTime !== undefined) idleTimeInput.value = result.idleTime;
    if (result.dumpToggles) dumpToggles = Object.assign({}, DEFAULT_TOGGLES, result.dumpToggles);

    if (dumpToggles.screenshot) {
      hasScreenshotPermission().then(function(granted) {
        if (!granted) {
          dumpToggles.screenshot = false;
          chrome.storage.local.set({ dumpToggles: dumpToggles });
        }
        applyToggleUI();
      });
    } else {
      applyToggleUI();
    }
  });

  saveSettingsBtn.addEventListener('click', function() {
    chrome.storage.local.set({
      basePath: basePathInput.value.trim() || 'debug-dumps',
      idleTime: parseFloat(idleTimeInput.value) || 2
    });
    setStatus('Settings saved.', 'success');
  });

  // Toggle chips
  togglesContainer.addEventListener('click', function(e) {
    var btn = e.target.closest('.toggle-chip');
    if (!btn) return;
    var key = btn.getAttribute('data-key');

    if (key === 'screenshot' && !dumpToggles[key]) {
      requestScreenshotPermission().then(function(granted) {
        if (granted) {
          dumpToggles[key] = true;
          applyToggleUI();
          chrome.storage.local.set({ dumpToggles: dumpToggles });
        } else {
          setStatus('Screenshot requires page access permission.', 'error');
        }
      });
      return;
    }

    dumpToggles[key] = !dumpToggles[key];
    applyToggleUI();
    chrome.storage.local.set({ dumpToggles: dumpToggles });
  });

  function applyToggleUI() {
    var chips = togglesContainer.querySelectorAll('.toggle-chip');
    for (var i = 0; i < chips.length; i++) {
      var key = chips[i].getAttribute('data-key');
      chips[i].className = 'toggle-chip ' + (dumpToggles[key] ? 'on' : 'off');
    }
  }

  // Sync settings changed via popup
  chrome.storage.onChanged.addListener(function(changes) {
    if (changes.basePath) basePathInput.value = changes.basePath.newValue;
    if (changes.idleTime) idleTimeInput.value = changes.idleTime.newValue;
    if (changes.dumpToggles) {
      var newToggles = Object.assign({}, DEFAULT_TOGGLES, changes.dumpToggles.newValue);
      if (newToggles.screenshot && !dumpToggles.screenshot) {
        hasScreenshotPermission().then(function(granted) {
          if (!granted) newToggles.screenshot = false;
          dumpToggles = newToggles;
          applyToggleUI();
        });
      } else {
        dumpToggles = newToggles;
        applyToggleUI();
      }
    }
  });

  dumpBtn.addEventListener('click', startDump);
  dumpNoReloadBtn.addEventListener('click', startDumpNoReload);

  // Expose for devtools.js to call on keyboard shortcut (works from any DevTools tab)
  window.triggerDumpFromShortcut = function() {
    if (!dumpBtn.disabled) startDumpNoReload();
  };

  // Display current shortcut
  var shortcutKeyEl = document.getElementById('shortcutKey');
  chrome.commands.getAll(function(commands) {
    var dumpCmd = commands.find(function(c) { return c.name === 'dump'; });
    shortcutKeyEl.textContent = (dumpCmd && dumpCmd.shortcut) ? dumpCmd.shortcut : 'not set';
  });

  copyBtn.addEventListener('click', function() {
    copyToClipboard(resultPath.textContent).then(function() {
      setStatus('Path copied to clipboard!', 'success');
    }).catch(function() {
      setStatus('Clipboard copy failed - select and copy manually.', 'error');
    });
  });

  // ---- Helpers ----

  function copyToClipboard(text) {
    return new Promise(function(resolve) {
      chrome.permissions.contains({ permissions: ['clipboardWrite'] }, resolve);
    }).then(function(hasClipPerm) {
      if (hasClipPerm) {
        // Primary: execCommand in panel (works with clipboardWrite permission, panel is focused)
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          var ok;
          try {
            ta.select();
            ok = document.execCommand('copy');
          } finally {
            document.body.removeChild(ta);
          }
          if (ok) return Promise.resolve();
        } catch (e) {
          // execCommand path failed, fall through to evalInPage
        }
      }

      // Fallback: clipboard API via inspected page (catch in page context to avoid uncaught rejection)
      var safe = JSON.stringify(text);
      return evalInPage("navigator.clipboard.writeText(" + safe + ").then(function(){return true}).catch(function(){return false})").then(function(result) {
        if (!result) throw new Error('copy failed');
      });
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

  function hasScreenshotPermission() {
    return new Promise(function(resolve) {
      chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve);
    });
  }

  function requestScreenshotPermission() {
    return new Promise(function(resolve) {
      chrome.permissions.request({ origins: ['<all_urls>'] }, resolve);
    });
  }

  function delay(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  }

  // ---- Direct file download (bypasses 64MB sendMessage limit) ----

  function downloadOneFile(url, filename) {
    return new Promise(function(resolve, reject) {
      var id = null;
      var settled = false;
      var buffered = [];
      var timeout = null;

      function cleanup() {
        settled = true;
        chrome.downloads.onChanged.removeListener(onChanged);
        if (timeout) { clearTimeout(timeout); timeout = null; }
      }

      function settle(delta) {
        if (settled || !delta.state) return;
        if (delta.state.current === 'complete') {
          cleanup();
          chrome.downloads.search({ id: id }, function(items) {
            resolve(items && items[0] ? items[0].filename : '');
          });
        } else if (delta.state.current === 'interrupted') {
          cleanup();
          reject(new Error('Download interrupted'));
        }
      }

      function onChanged(delta) {
        if (id === null) { buffered.push(delta); return; }
        if (delta.id !== id) return;
        settle(delta);
      }

      // Register listener BEFORE starting download to avoid missing
      // completion events on near-instant data: URL downloads
      chrome.downloads.onChanged.addListener(onChanged);

      // Safety timeout to prevent listener leak if download never reaches
      // a terminal state (should not happen in practice)
      timeout = setTimeout(function() {
        if (settled) return;
        cleanup();
        reject(new Error('Download timed out: ' + filename));
      }, 60000);

      chrome.downloads.download({
        url: url, filename: filename, conflictAction: 'uniquify', saveAs: false
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          cleanup();
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        id = downloadId;
        // Replay any events that arrived before we had the id
        for (var i = 0; i < buffered.length; i++) {
          if (buffered[i].id === id) settle(buffered[i]);
          if (settled) break;
        }
        buffered = null;
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
    // Guard: at least one toggle must be on
    var anyOn = Object.keys(dumpToggles).some(function(k) { return dumpToggles[k]; });
    if (!anyOn) {
      setStatus('Enable at least one capture type', 'error');
      return Promise.resolve();
    }

    setStatus('Collecting page state...', 'info');

    // Mark disabled types as done immediately
    var allSteps = ['har', 'html', 'console', 'meta', 'screenshot'];
    for (var i = 0; i < allSteps.length; i++) {
      if (!dumpToggles[allSteps[i]]) updateProgress(allSteps[i], 'skipped');
    }

    return Promise.all([
      dumpToggles.har ? collectHAR() : Promise.resolve(null),
      dumpToggles.html ? collectHTML() : Promise.resolve(null),
      dumpToggles.console ? collectConsoleLogs() : Promise.resolve(null),
      dumpToggles.meta ? collectMeta() : Promise.resolve(null)
    ]).then(function(results) {
      var har = results[0];
      var html = results[1];
      var consoleLogs = results[2];
      var meta = results[3];

      var screenshotPromise;
      if (dumpToggles.screenshot) {
        screenshotPromise = hasScreenshotPermission().then(function(granted) {
          if (!granted) {
            updateProgress('screenshot', 'error');
            setStatus('Screenshot permission revoked - skipping.', 'error');
            dumpToggles.screenshot = false;
            applyToggleUI();
            chrome.storage.local.set({ dumpToggles: dumpToggles });
            return null;
          }
          setStatus('Capturing screenshot...', 'info');
          return captureFullPageScreenshot();
        });
      } else {
        screenshotPromise = Promise.resolve(null);
      }

      return screenshotPromise.then(function(screenshotDataUrl) {
        return {
          har: har, html: html, consoleLogs: consoleLogs, meta: meta,
          screenshotDataUrl: screenshotDataUrl
        };
      });
    }).then(function(data) {
      // Need URL for folder name — get from meta or fall back to eval
      var urlPromise = data.meta
        ? Promise.resolve(data.meta.url)
        : evalInPage('location.href');

      return urlPromise.then(function(url) {
        var sanitizedUrl = sanitizeForFilename(url);
        var timestamp = formatTimestamp(new Date());
        var basePath = basePathInput.value.trim() || 'debug-dumps';
        var folderName = basePath + '/' + sanitizedUrl + '-' + timestamp;

        updateProgress('download', 'active');
        setStatus('Saving files...', 'info');

        var files = {};
        if (data.har) files['network.har'] = JSON.stringify(data.har, null, 2);
        if (data.html) files['page.html'] = data.html;
        if (data.consoleLogs) files['console.json'] = JSON.stringify(data.consoleLogs, null, 2);
        if (data.meta) files['meta.json'] = JSON.stringify(data.meta, null, 2);

        return saveAllFiles(folderName, files, data.screenshotDataUrl);
      });
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

  // Resolves to null on error instead of rejecting
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
          var jsLogs = [];
          if (!ex) {
            try { jsLogs = JSON.parse(result); } catch (e) {}
          }
          var allLogs = jsLogs.concat(networkErrors);
          allLogs.sort(function(a, b) {
            return new Date(a.timestamp) - new Date(b.timestamp);
          });
          updateProgress('console', ex ? 'error' : 'done');
          resolve(allLogs);
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
