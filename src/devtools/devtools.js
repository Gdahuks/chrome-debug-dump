// Console hook code injected into the inspected page's MAIN world
const CONSOLE_HOOK_CODE = `
(function() {
  if (window.__debugConsoleHooked) return;
  window.__debugConsoleHooked = true;
  window.__debugConsoleLogs = [];
  var MAX_ENTRIES = 1000;
  var ORIG_STACK_LIMIT = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;

  function pushEntry(level, args, stackTrace) {
    var entry = {
      level: level,
      timestamp: new Date().toISOString(),
      args: args
    };
    if (stackTrace) entry.stackTrace = stackTrace;
    window.__debugConsoleLogs.push(entry);
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
          if (arguments[i] instanceof Error || (arguments[i] && arguments[i].stack && arguments[i].message)) {
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
      // Capture call site stack (who called console.error/log/etc.)
      var callStack = null;
      try {
        var e = new Error();
        if (e.stack) {
          // Remove first 2 lines: "Error" and the hook's own frame
          var lines = e.stack.split('\\n');
          callStack = lines.slice(2).join('\\n');
        }
      } catch (ignore) {}
      pushEntry(method, args, callStack);
      original.apply(console, arguments);
    };
  });

  // Capture uncaught exceptions
  window.addEventListener('error', function(event) {
    var args = [event.message || 'Unknown error'];
    if (event.filename) args.push('at ' + event.filename + ':' + event.lineno + ':' + event.colno);
    var stack = (event.error && event.error.stack) ? event.error.stack : null;
    if (stack) args.push(stack);
    pushEntry('error', args, stack);
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event.reason;
    var msg;
    var stack = null;
    try {
      stack = reason && reason.stack ? reason.stack : null;
      msg = stack || String(reason);
    } catch (e) {
      msg = '[unserializable reason]';
    }
    pushEntry('error', ['Unhandled promise rejection: ' + msg], stack);
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
