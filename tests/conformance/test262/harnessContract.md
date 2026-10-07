# test262 harness contract

The vendored tests (`vendor/test262/test`) call a few harness functions without defining them. test262's own `assert.js`, `sta.js` and `doneprintHandle.js` are written in JavaScript that uses features outside the subset (`Object.prototype`, `Function`, `Symbol`, …), so the Phase 3 simulator provides the harness **as host builtins**, and a test may include only these three files (`PROVIDED_INCLUDES` in `classify.ts`). Everything else a test includes (`propertyHelper.js`, `compareArray.js`, `asyncHelpers.js`, …) puts it in `exclusions.json` with reason `include`.

`SIMULATOR.run(source, "js")` is called once per mode (see `runTest262`), with `"use strict";\n` prepended for the strict run.

## Globals the simulator defines

| Name | Behaviour |
|---|---|
| `assert(value, message?)` | Throws `Test262Error` unless `value === true`. |
| `assert.sameValue(actual, expected, message?)` | SameValue comparison (`NaN` equals `NaN`, `+0` differs from `-0`); throws `Test262Error` otherwise. |
| `assert.notSameValue(actual, unexpected, message?)` | The negation. |
| `assert.throws(ErrorConstructor, fn, message?)` | Calls `fn`; passes only if it throws an object whose constructor is exactly `ErrorConstructor`. Throws `Test262Error` otherwise (also when nothing is thrown). |
| `Test262Error` | A constructor taking `(message)`. Instances have `name`/`constructor.name` equal to `"Test262Error"` and a `message`. |
| `$DONOTEVALUATE()` | Throws a `Test262Error` with the message `"Test262: This statement should not be evaluated."`. |
| `$DONE(error?)` | Async tests only. Prints `Test262:AsyncTestComplete` when called without an argument, otherwise `Test262:AsyncTestFailure:<name>: <message>`. |
| `print(message)` | Writes `message` and a newline to stdout. |

## How a run is judged

| Test | Passes when |
|---|---|
| plain | exit code 0 |
| `flags: [async]` | exit code 0, a stdout line `Test262:AsyncTestComplete`, and no line starting `Test262:AsyncTestFailure:` |
| `negative: {phase: parse}` | exit code ≠ 0 and a stderr line starting with `E_SYNTAX` (the simulator prints each compile-time diagnostic as `<code>: <message>`) |
| `negative: {phase: runtime, type: T}` | exit code ≠ 0 and a stderr line starting with `T` (an uncaught `T`) |

A test runs in both sloppy and strict mode unless it carries `onlyStrict` or `noStrict`; it passes only if every mode passes.
