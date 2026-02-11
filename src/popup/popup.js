(function() {
  'use strict';

  var statusEl = document.getElementById('status');
  var shortcutKeyEl = document.getElementById('shortcutKey');
  var basePathInput = document.getElementById('basePath');
  var idleTimeInput = document.getElementById('idleTime');
  var saveSettingsBtn = document.getElementById('saveSettings');

  chrome.storage.local.get(['basePath', 'idleTime'], function(r) {
    if (r.basePath) basePathInput.value = r.basePath;
    if (r.idleTime !== undefined) idleTimeInput.value = r.idleTime;
  });

  chrome.commands.getAll(function(commands) {
    var dumpCmd = commands.find(function(c) { return c.name === 'dump'; });
    shortcutKeyEl.textContent = (dumpCmd && dumpCmd.shortcut) ? dumpCmd.shortcut : 'not set';
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
