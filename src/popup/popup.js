(function() {
  'use strict';

  var DEFAULT_TOGGLES = { har: true, html: true, console: true, meta: true, screenshot: true };

  var statusEl = document.getElementById('status');
  var shortcutKeyEl = document.getElementById('shortcutKey');
  var basePathInput = document.getElementById('basePath');
  var idleTimeInput = document.getElementById('idleTime');
  var saveSettingsBtn = document.getElementById('saveSettings');
  var togglesContainer = document.getElementById('toggles');

  var dumpToggles = Object.assign({}, DEFAULT_TOGGLES);

  chrome.storage.local.get(['basePath', 'idleTime', 'dumpToggles'], function(r) {
    if (r.basePath) basePathInput.value = r.basePath;
    if (r.idleTime !== undefined) idleTimeInput.value = r.idleTime;
    if (r.dumpToggles) dumpToggles = Object.assign({}, DEFAULT_TOGGLES, r.dumpToggles);
    applyToggleUI();
  });

  chrome.commands.getAll(function(commands) {
    var dumpCmd = commands.find(function(c) { return c.name === 'dump'; });
    shortcutKeyEl.textContent = (dumpCmd && dumpCmd.shortcut) ? dumpCmd.shortcut : 'not set';
  });

  // Toggle chips
  togglesContainer.addEventListener('click', function(e) {
    var btn = e.target.closest('.toggle-chip');
    if (!btn) return;
    var key = btn.getAttribute('data-key');
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

  // Sync toggles changed via panel
  chrome.storage.onChanged.addListener(function(changes) {
    if (changes.dumpToggles) {
      dumpToggles = Object.assign({}, DEFAULT_TOGGLES, changes.dumpToggles.newValue);
      applyToggleUI();
    }
  });

  saveSettingsBtn.addEventListener('click', function() {
    chrome.storage.local.set({
      basePath: basePathInput.value.trim() || 'debug-dumps',
      idleTime: parseFloat(idleTimeInput.value) || 2
    });
    statusEl.textContent = 'Settings saved.';
    statusEl.className = 'status success';
  });

})();
