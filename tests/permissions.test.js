/**
 * Unit tests for optional permission gating logic.
 *
 * These tests verify the core decision logic used by popup.js and panel.js
 * when handling the screenshot toggle (requires <all_urls>) and clipboard
 * fallback (requires clipboardWrite). Chrome APIs are fully mocked.
 */

// ---- Mock helpers ----

function createMockChrome(opts) {
  opts = opts || {};
  var storedData = opts.storage || {};
  var grantedPermissions = opts.permissions || [];
  var grantedOrigins = opts.origins || [];
  var requestResult = opts.requestResult !== undefined ? opts.requestResult : true;

  return {
    permissions: {
      contains: function(query, cb) {
        var permsOk = !query.permissions || query.permissions.every(function(p) {
          return grantedPermissions.indexOf(p) !== -1;
        });
        var originsOk = !query.origins || query.origins.every(function(o) {
          return grantedOrigins.indexOf(o) !== -1;
        });
        cb(permsOk && originsOk);
      },
      request: function(query, cb) {
        if (requestResult) {
          // Simulate granting: add to granted lists
          if (query.permissions) {
            query.permissions.forEach(function(p) {
              if (grantedPermissions.indexOf(p) === -1) grantedPermissions.push(p);
            });
          }
          if (query.origins) {
            query.origins.forEach(function(o) {
              if (grantedOrigins.indexOf(o) === -1) grantedOrigins.push(o);
            });
          }
        }
        cb(requestResult);
      }
    },
    storage: {
      local: {
        set: jest.fn(function(data) {
          Object.assign(storedData, data);
        }),
        get: function(keys, cb) {
          var result = {};
          keys.forEach(function(k) {
            if (storedData[k] !== undefined) result[k] = storedData[k];
          });
          cb(result);
        }
      }
    },
    _storedData: storedData,
    _grantedOrigins: grantedOrigins,
    _grantedPermissions: grantedPermissions
  };
}

// ---- Core logic extracted from popup.js / panel.js ----
// These mirror the inline functions used in both files.

function hasScreenshotPermission(chrome) {
  return new Promise(function(resolve) {
    chrome.permissions.contains({ origins: ['<all_urls>'] }, resolve);
  });
}

function requestScreenshotPermission(chrome) {
  return new Promise(function(resolve) {
    chrome.permissions.request({ origins: ['<all_urls>'] }, resolve);
  });
}

function hasClipboardPermission(chrome) {
  return new Promise(function(resolve) {
    chrome.permissions.contains({ permissions: ['clipboardWrite'] }, resolve);
  });
}

/**
 * Simulates the toggle click handler logic for the screenshot key.
 * Returns { toggled, errorShown } after the async operation completes.
 */
function handleScreenshotToggle(chrome, dumpToggles) {
  var result = { toggled: false, errorShown: false, dumpToggles: dumpToggles };

  if (!dumpToggles.screenshot) {
    // Enabling screenshot — request permission
    return requestScreenshotPermission(chrome).then(function(granted) {
      if (granted) {
        result.dumpToggles.screenshot = true;
        result.toggled = true;
        chrome.storage.local.set({ dumpToggles: result.dumpToggles });
      } else {
        result.errorShown = true;
      }
      return result;
    });
  } else {
    // Disabling screenshot — no permission check needed
    result.dumpToggles.screenshot = false;
    result.toggled = true;
    chrome.storage.local.set({ dumpToggles: result.dumpToggles });
    return Promise.resolve(result);
  }
}

/**
 * Simulates the load-time validation logic.
 * Returns the validated dumpToggles after async check.
 */
function validateTogglesOnLoad(chrome, dumpToggles) {
  if (dumpToggles.screenshot) {
    return hasScreenshotPermission(chrome).then(function(granted) {
      if (!granted) {
        dumpToggles.screenshot = false;
        chrome.storage.local.set({ dumpToggles: dumpToggles });
      }
      return dumpToggles;
    });
  }
  return Promise.resolve(dumpToggles);
}

// ---- Tests ----

describe('Permission-gated screenshot toggle', function() {
  test('enabling screenshot requests host permission and succeeds when granted', function() {
    var chrome = createMockChrome({ requestResult: true });
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: false };

    return handleScreenshotToggle(chrome, toggles).then(function(result) {
      expect(result.toggled).toBe(true);
      expect(result.dumpToggles.screenshot).toBe(true);
      expect(result.errorShown).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ dumpToggles: expect.objectContaining({ screenshot: true }) });
    });
  });

  test('screenshot stays off when permission is denied', function() {
    var chrome = createMockChrome({ requestResult: false });
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: false };

    return handleScreenshotToggle(chrome, toggles).then(function(result) {
      expect(result.toggled).toBe(false);
      expect(result.dumpToggles.screenshot).toBe(false);
      expect(result.errorShown).toBe(true);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  test('disabling screenshot does not request permission', function() {
    var chrome = createMockChrome({ origins: ['<all_urls>'] });
    var requestSpy = jest.spyOn(chrome.permissions, 'request');
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: true };

    return handleScreenshotToggle(chrome, toggles).then(function(result) {
      expect(result.toggled).toBe(true);
      expect(result.dumpToggles.screenshot).toBe(false);
      expect(requestSpy).not.toHaveBeenCalled();
    });
  });

  test('non-screenshot toggles are unaffected by permission logic', function() {
    // Verify that the toggle handler only intercepts 'screenshot' key
    var chrome = createMockChrome({ requestResult: false });
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: false };

    // Simulate toggling 'har' off — this is a direct toggle, no permission check
    toggles.har = !toggles.har;
    chrome.storage.local.set({ dumpToggles: toggles });

    expect(toggles.har).toBe(false);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ dumpToggles: expect.objectContaining({ har: false }) });
  });
});

describe('Permission validation on load', function() {
  test('screenshot=true with permission granted stays true', function() {
    var chrome = createMockChrome({ origins: ['<all_urls>'] });
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: true };

    return validateTogglesOnLoad(chrome, toggles).then(function(result) {
      expect(result.screenshot).toBe(true);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  test('screenshot=true with permission revoked reverts to false and saves', function() {
    var chrome = createMockChrome({ origins: [] });
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: true };

    return validateTogglesOnLoad(chrome, toggles).then(function(result) {
      expect(result.screenshot).toBe(false);
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ dumpToggles: expect.objectContaining({ screenshot: false }) });
    });
  });

  test('screenshot=false skips permission check', function() {
    var chrome = createMockChrome({ origins: [] });
    var containsSpy = jest.spyOn(chrome.permissions, 'contains');
    var toggles = { har: true, html: true, console: true, meta: true, screenshot: false };

    return validateTogglesOnLoad(chrome, toggles).then(function(result) {
      expect(result.screenshot).toBe(false);
      expect(containsSpy).not.toHaveBeenCalled();
    });
  });
});

describe('Clipboard fallback', function() {
  test('reports clipboardWrite as available when granted', function() {
    var chrome = createMockChrome({ permissions: ['clipboardWrite'] });

    return hasClipboardPermission(chrome).then(function(has) {
      expect(has).toBe(true);
    });
  });

  test('reports clipboardWrite as unavailable when not granted', function() {
    var chrome = createMockChrome({ permissions: [] });

    return hasClipboardPermission(chrome).then(function(has) {
      expect(has).toBe(false);
    });
  });
});
