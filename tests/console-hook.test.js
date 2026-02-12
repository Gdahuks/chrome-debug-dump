const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Extract CONSOLE_HOOK_CODE from devtools.js (pure JS string, no Chrome APIs)
const devtoolsSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'devtools', 'devtools.js'),
  'utf8'
);
const match = devtoolsSrc.match(/(?:const|let|var)\s+CONSOLE_HOOK_CODE\s*=\s*`([\s\S]*?)`;?/);
if (!match) throw new Error('Could not extract CONSOLE_HOOK_CODE from devtools.js');
// The regex extracts raw source text from a template literal. Template literals
// process escape sequences (e.g. \\n → \n) but fs.readFileSync preserves the raw
// bytes. Replicate that single level of escape processing so vm.runInContext
// compiles the same code that eval() would receive at runtime.
const HOOK_CODE = match[1].replace(/\\\\/g, '\\');

/**
 * Creates an isolated VM context with mocked window/console,
 * runs the console hook, and returns the context + event listeners.
 */
function createHookedContext() {
  const eventListeners = {};

  const context = {
    window: {
      addEventListener: function(event, handler) {
        eventListeners[event] = handler;
      }
    },
    console: {
      log: function() {},
      warn: function() {},
      error: function() {},
      info: function() {},
      debug: function() {}
    }
  };

  vm.createContext(context);
  vm.runInContext(HOOK_CODE, context);

  return { context, eventListeners };
}

// ---- Initialization ----

describe('Console Hook - Initialization', function() {
  test('creates __debugConsoleLogs array', function() {
    var ctx = createHookedContext().context;
    expect(Array.isArray(ctx.window.__debugConsoleLogs)).toBe(true);
    expect(ctx.window.__debugConsoleLogs.length).toBe(0);
  });

  test('sets __debugConsoleHooked flag', function() {
    var ctx = createHookedContext().context;
    expect(ctx.window.__debugConsoleHooked).toBe(true);
  });

  test('does not re-hook if already hooked', function() {
    var context = {
      window: {
        __debugConsoleHooked: true,
        __debugConsoleLogs: ['should-not-be-reset'],
        addEventListener: function() {}
      },
      console: {
        log: function() {}, warn: function() {}, error: function() {},
        info: function() {}, debug: function() {}
      }
    };
    vm.createContext(context);
    vm.runInContext(HOOK_CODE, context);

    expect(context.window.__debugConsoleLogs).toEqual(['should-not-be-reset']);
  });

  test('registers error and unhandledrejection event listeners', function() {
    var listeners = createHookedContext().eventListeners;
    expect(typeof listeners.error).toBe('function');
    expect(typeof listeners.unhandledrejection).toBe('function');
  });
});

// ---- Console method capture ----

describe('Console Hook - Method Capture', function() {
  test.each(['log', 'warn', 'error', 'info', 'debug'])(
    'captures console.%s with correct level',
    function(method) {
      var ctx = createHookedContext().context;
      vm.runInContext('console.' + method + '("test message")', ctx);

      expect(ctx.window.__debugConsoleLogs.length).toBe(1);
      expect(ctx.window.__debugConsoleLogs[0].level).toBe(method);
      expect(ctx.window.__debugConsoleLogs[0].args).toEqual(['test message']);
    }
  );

  test('includes ISO timestamp', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log("ts")', ctx);

    var ts = ctx.window.__debugConsoleLogs[0].timestamp;
    expect(typeof ts).toBe('string');
    // Verify it's a valid ISO date
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  test('captures multiple arguments', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log("msg", 42, true)', ctx);

    expect(ctx.window.__debugConsoleLogs[0].args).toEqual(['msg', '42', 'true']);
  });

  test('calls original console method without throwing', function() {
    var ctx = createHookedContext().context;
    expect(function() {
      vm.runInContext('console.log("test")', ctx);
    }).not.toThrow();
  });
});

// ---- Serialization ----

describe('Console Hook - Serialization', function() {
  test('serializes strings as-is', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log("hello world")', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('hello world');
  });

  test('serializes numbers via String()', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log(42)', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('42');
  });

  test('serializes booleans via String()', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log(true, false)', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args).toEqual(['true', 'false']);
  });

  test('serializes undefined via String()', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log(undefined)', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('undefined');
  });

  test('serializes null via JSON.stringify', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log(null)', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('null');
  });

  test('serializes plain objects via JSON.stringify', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log({ key: "value", num: 42 })', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('{"key":"value","num":42}');
  });

  test('serializes arrays via JSON.stringify', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log([1, "two", 3])', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('[1,"two",3]');
  });

  test('serializes Error objects with name, message, and stack', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.error(new Error("test error"))', ctx);

    var captured = JSON.parse(ctx.window.__debugConsoleLogs[0].args[0]);
    expect(captured.name).toBe('Error');
    expect(captured.message).toBe('test error');
    expect(typeof captured.stack).toBe('string');
    expect(captured.stack).toContain('test error');
  });

  test('serializes TypeError with correct name', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.error(new TypeError("cannot read prop"))', ctx);

    var captured = JSON.parse(ctx.window.__debugConsoleLogs[0].args[0]);
    expect(captured.name).toBe('TypeError');
    expect(captured.message).toBe('cannot read prop');
  });

  test('serializes RangeError with correct name', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.error(new RangeError("out of range"))', ctx);

    var captured = JSON.parse(ctx.window.__debugConsoleLogs[0].args[0]);
    expect(captured.name).toBe('RangeError');
    expect(captured.message).toBe('out of range');
  });

  test('serializes cross-realm error-like objects (duck-typing)', function() {
    var ctx = createHookedContext().context;
    // Simulate an error from an iframe — not instanceof Error but has stack+message
    vm.runInContext(
      'var fake = { name: "SecurityError", message: "cross-origin", stack: "SecurityError: cross-origin\\n    at iframe.js:1:1" }; console.error(fake);',
      ctx
    );

    var captured = JSON.parse(ctx.window.__debugConsoleLogs[0].args[0]);
    expect(captured.name).toBe('SecurityError');
    expect(captured.message).toBe('cross-origin');
    expect(captured.stack).toContain('SecurityError');
  });

  test('handles circular references as [unserializable]', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('var obj = {}; obj.self = obj; console.log(obj);', ctx);
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('[unserializable]');
  });

  test('handles mixed args: string + Error + object', function() {
    var ctx = createHookedContext().context;
    vm.runInContext(
      'console.error("prefix", new Error("fail"), { detail: 1 })',
      ctx
    );

    var args = ctx.window.__debugConsoleLogs[0].args;
    expect(args[0]).toBe('prefix');

    var err = JSON.parse(args[1]);
    expect(err.name).toBe('Error');
    expect(err.message).toBe('fail');

    expect(args[2]).toBe('{"detail":1}');
  });
});

// ---- MAX_ENTRIES limit ----

describe('Console Hook - MAX_ENTRIES', function() {
  test('keeps at most 1000 entries (FIFO)', function() {
    var ctx = createHookedContext().context;

    // Generate 1050 entries
    vm.runInContext(
      'for (var i = 0; i < 1050; i++) { console.log("msg" + i); }',
      ctx
    );

    expect(ctx.window.__debugConsoleLogs.length).toBe(1000);
    // First 50 should have been shifted out
    expect(ctx.window.__debugConsoleLogs[0].args[0]).toBe('msg50');
    expect(ctx.window.__debugConsoleLogs[999].args[0]).toBe('msg1049');
  });
});

// ---- Uncaught exceptions (window.error) ----

describe('Console Hook - Uncaught Exceptions', function() {
  test('captures error event with message, location, and stack', function() {
    var env = createHookedContext();
    env.eventListeners.error({
      message: 'Uncaught TypeError: foo is not a function',
      filename: 'app.js',
      lineno: 42,
      colno: 10,
      error: { stack: 'TypeError: foo is not a function\n    at app.js:42:10' }
    });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.level).toBe('error');
    expect(entry.args[0]).toBe('Uncaught TypeError: foo is not a function');
    expect(entry.args[1]).toBe('at app.js:42:10');
    expect(entry.args[2]).toContain('TypeError: foo is not a function');
  });

  test('handles error event without filename', function() {
    var env = createHookedContext();
    env.eventListeners.error({
      message: 'Script error.',
      error: null
    });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args).toEqual(['Script error.']);
  });

  test('handles error event without error.stack', function() {
    var env = createHookedContext();
    env.eventListeners.error({
      message: 'Unknown error',
      filename: 'script.js',
      lineno: 1,
      colno: 1,
      error: {}
    });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args.length).toBe(2);
    expect(entry.args[0]).toBe('Unknown error');
    expect(entry.args[1]).toBe('at script.js:1:1');
  });

  test('falls back to "Unknown error" if no message', function() {
    var env = createHookedContext();
    env.eventListeners.error({});

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args[0]).toBe('Unknown error');
  });
});

// ---- Unhandled promise rejections ----

describe('Console Hook - Unhandled Promise Rejections', function() {
  test('captures rejection with Error (uses stack)', function() {
    var env = createHookedContext();
    env.eventListeners.unhandledrejection({
      reason: { stack: 'Error: async failed\n    at promise.js:5:3' }
    });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.level).toBe('error');
    expect(entry.args[0]).toBe('Unhandled promise rejection: Error: async failed\n    at promise.js:5:3');
  });

  test('captures rejection with string reason', function() {
    var env = createHookedContext();
    env.eventListeners.unhandledrejection({
      reason: 'simple string error'
    });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args[0]).toBe('Unhandled promise rejection: simple string error');
  });

  test('captures rejection with null reason', function() {
    var env = createHookedContext();
    env.eventListeners.unhandledrejection({ reason: null });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args[0]).toBe('Unhandled promise rejection: null');
  });

  test('includes stackTrace field for rejection with stack', function() {
    var env = createHookedContext();
    env.eventListeners.unhandledrejection({
      reason: { stack: 'Error: fail\n    at x.js:1:1' }
    });
    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.stackTrace).toBe('Error: fail\n    at x.js:1:1');
  });

  test('no stackTrace field for rejection without stack', function() {
    var env = createHookedContext();
    env.eventListeners.unhandledrejection({ reason: 'string error' });
    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.stackTrace).toBeUndefined();
  });

  test('handles unserializable rejection reason', function() {
    var env = createHookedContext();
    var reason = {};
    Object.defineProperty(reason, 'stack', {
      get: function() { throw new Error('boom'); }
    });

    env.eventListeners.unhandledrejection({ reason: reason });

    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.args[0]).toBe('Unhandled promise rejection: [unserializable reason]');
  });
});

// ---- Stack traces & Error.stackTraceLimit ----

describe('Console Hook - Stack Traces', function() {
  test('sets Error.stackTraceLimit to 50', function() {
    var ctx = createHookedContext().context;
    var limit = vm.runInContext('Error.stackTraceLimit', ctx);
    expect(limit).toBe(50);
  });

  test('console calls include stackTrace field', function() {
    var ctx = createHookedContext().context;
    vm.runInContext('console.log("test")', ctx);
    var entry = ctx.window.__debugConsoleLogs[0];
    // stackTrace should be a string (call site stack)
    expect(typeof entry.stackTrace).toBe('string');
  });

  test('uncaught exception includes stackTrace field', function() {
    var env = createHookedContext();
    env.eventListeners.error({
      message: 'Uncaught Error',
      filename: 'app.js',
      lineno: 1,
      colno: 1,
      error: { stack: 'Error: test\n    at app.js:1:1\n    at run (lib.js:5:3)' }
    });
    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.stackTrace).toBe('Error: test\n    at app.js:1:1\n    at run (lib.js:5:3)');
  });

  test('uncaught exception without stack has no stackTrace field', function() {
    var env = createHookedContext();
    env.eventListeners.error({
      message: 'Script error.',
      error: null
    });
    var entry = env.context.window.__debugConsoleLogs[0];
    expect(entry.stackTrace).toBeUndefined();
  });
});
