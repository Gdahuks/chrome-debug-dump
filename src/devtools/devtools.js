// Console hook code injected into the inspected page's MAIN world
const CONSOLE_HOOK_CODE = `
(function() {
  if (window.__debugConsoleHooked) return;
  window.__debugConsoleHooked = true;
  window.__debugConsoleLogs = [];
  var MAX_ENTRIES = 1000;

  function pushEntry(level, args) {
    window.__debugConsoleLogs.push({
      level: level,
      timestamp: new Date().toISOString(),
      args: args
    });
    if (window.__debugConsoleLogs.length > MAX_ENTRIES) {
      window.__debugConsoleLogs.shift();
    }
  }

  // Hook console methods
  var methods = ['log', 'warn', 'error', 'info', 'debug'];
  methods.forEach(function(method) {
    var original = console[method].bind(console);
    console[method] = function() {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        try {
          if (arguments[i] instanceof Error) {
            args.push(JSON.stringify({
              name: arguments[i].name,
              message: arguments[i].message,
              stack: arguments[i].stack
            }));
          } else if (typeof arguments[i] === 'object') {
            args.push(JSON.stringify(arguments[i]));
          } else {
            args.push(String(arguments[i]));
          }
        } catch (e) {
          args.push('[unserializable]');
        }
      }
      pushEntry(method, args);
      original.apply(console, arguments);
    };
  });

  // Capture uncaught exceptions
  window.addEventListener('error', function(event) {
    var args = [event.message || 'Unknown error'];
    if (event.filename) args.push('at ' + event.filename + ':' + event.lineno + ':' + event.colno);
    if (event.error && event.error.stack) args.push(event.error.stack);
    pushEntry('error', args);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var msg;
    try {
      msg = reason && reason.stack ? reason.stack : String(reason);
    } catch (e) {
      msg = '[unserializable reason]';
    }
    pushEntry('error', ['Unhandled promise rejection: ' + msg]);
  });
})();
`;

function injectConsoleHook() {
  chrome.devtools.inspectedWindow.eval(CONSOLE_HOOK_CODE, function(result, exceptionInfo) {
    if (exceptionInfo) {
      console.error('Failed to inject console hook:', exceptionInfo);
    }
  });
}

// Create the DevTools panel
chrome.devtools.panels.create(
  'Debug Dump',
  '',
  'devtools/panel.html',
  function(panel) {
    var hookInjected = false;

    panel.onShown.addListener(function() {
      if (!hookInjected) {
        hookInjected = true;
        injectConsoleHook();
      }
    });

    // Re-inject hook after page navigation (page world is reset)
    chrome.devtools.network.onNavigated.addListener(function() {
      hookInjected = false;
      injectConsoleHook();
      hookInjected = true;
    });
  }
);
