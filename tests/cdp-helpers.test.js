const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Extract formatCdpStack and serializeCdpArg from panel.js
// These are pure functions with no Chrome API dependencies
const panelSrc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'devtools', 'panel.js'),
  'utf8'
);

// Extract function bodies via regex and eval them in an isolated context
const formatMatch = panelSrc.match(/function formatCdpStack\(stackTrace\) \{[\s\S]*?\n  \}/);
const serializeMatch = panelSrc.match(/function serializeCdpArg\(arg\) \{[\s\S]*?\n  \}/);

if (!formatMatch) throw new Error('Could not extract formatCdpStack from panel.js');
if (!serializeMatch) throw new Error('Could not extract serializeCdpArg from panel.js');

// Create functions in test context
const formatCdpStack = new Function('stackTrace',
  formatMatch[0].replace(/^function formatCdpStack\(stackTrace\) \{/, '').replace(/\}$/, '')
);
const serializeCdpArg = new Function('arg',
  serializeMatch[0].replace(/^function serializeCdpArg\(arg\) \{/, '').replace(/\}$/, '')
);

// ---- formatCdpStack ----

describe('formatCdpStack', function() {
  test('returns null for null/undefined input', function() {
    expect(formatCdpStack(null)).toBeNull();
    expect(formatCdpStack(undefined)).toBeNull();
  });

  test('returns null for empty callFrames', function() {
    expect(formatCdpStack({ callFrames: [] })).toBeNull();
  });

  test('formats single call frame', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: 'doSomething', url: 'app.js', lineNumber: 41, columnNumber: 9 }
      ]
    });
    expect(result).toBe('    at doSomething (app.js:42:10)');
  });

  test('uses (anonymous) for empty function name', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: '', url: 'app.js', lineNumber: 0, columnNumber: 0 }
      ]
    });
    expect(result).toBe('    at (anonymous) (app.js:1:1)');
  });

  test('omits URL for frames without url', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: 'native', url: '', lineNumber: 0, columnNumber: 0 }
      ]
    });
    expect(result).toBe('    at native');
  });

  test('formats multiple call frames', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: 'a', url: 'a.js', lineNumber: 0, columnNumber: 0 },
        { functionName: 'b', url: 'b.js', lineNumber: 9, columnNumber: 4 }
      ]
    });
    expect(result).toBe(
      '    at a (a.js:1:1)\n' +
      '    at b (b.js:10:5)'
    );
  });

  test('includes async stack trace with description', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: 'onError', url: 'app.js', lineNumber: 99, columnNumber: 0 }
      ],
      parent: {
        description: 'IndexedDB',
        callFrames: [
          { functionName: 'F', url: 'app.js', lineNumber: 0, columnNumber: 122 },
          { functionName: 'import', url: 'app.js', lineNumber: 0, columnNumber: 455 }
        ]
      }
    });
    expect(result).toBe(
      '    at onError (app.js:100:1)\n' +
      '--- IndexedDB ---\n' +
      '    at F (app.js:1:123)\n' +
      '    at import (app.js:1:456)'
    );
  });

  test('follows nested async parents', function() {
    var result = formatCdpStack({
      callFrames: [
        { functionName: 'handler', url: 'a.js', lineNumber: 0, columnNumber: 0 }
      ],
      parent: {
        description: 'setTimeout',
        callFrames: [
          { functionName: 'delay', url: 'b.js', lineNumber: 4, columnNumber: 0 }
        ],
        parent: {
          description: 'requestAnimationFrame',
          callFrames: [
            { functionName: 'render', url: 'c.js', lineNumber: 9, columnNumber: 0 }
          ]
        }
      }
    });
    expect(result).toContain('--- setTimeout ---');
    expect(result).toContain('--- requestAnimationFrame ---');
    expect(result).toContain('at render (c.js:10:1)');
  });
});

// ---- serializeCdpArg ----

describe('serializeCdpArg', function() {
  test('returns string value directly', function() {
    expect(serializeCdpArg({ type: 'string', value: 'hello' })).toBe('hello');
  });

  test('returns "undefined" for undefined type', function() {
    expect(serializeCdpArg({ type: 'undefined' })).toBe('undefined');
  });

  test('returns "null" for null subtype', function() {
    expect(serializeCdpArg({ type: 'object', subtype: 'null', value: null })).toBe('null');
  });

  test('stringifies numbers', function() {
    expect(serializeCdpArg({ type: 'number', value: 42 })).toBe('42');
    expect(serializeCdpArg({ type: 'number', value: 3.14 })).toBe('3.14');
  });

  test('stringifies booleans', function() {
    expect(serializeCdpArg({ type: 'boolean', value: true })).toBe('true');
    expect(serializeCdpArg({ type: 'boolean', value: false })).toBe('false');
  });

  test('returns description for objects', function() {
    expect(serializeCdpArg({
      type: 'object',
      description: 'Array(3)',
      className: 'Array'
    })).toBe('Array(3)');
  });

  test('returns description for error objects', function() {
    expect(serializeCdpArg({
      type: 'object',
      subtype: 'error',
      description: 'TypeError: foo is not a function\n    at app.js:1:1'
    })).toBe('TypeError: foo is not a function\n    at app.js:1:1');
  });

  test('returns symbol description', function() {
    expect(serializeCdpArg({ type: 'symbol', description: 'Symbol(test)' })).toBe('Symbol(test)');
  });

  test('falls back to String(value) for unknown types', function() {
    expect(serializeCdpArg({ type: 'function', description: 'function foo() {}' })).toBe('function foo() {}');
  });
});
