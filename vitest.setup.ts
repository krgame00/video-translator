// Legacy tests use `console.assert` which never throws. Make failures throw
// so vitest reports them as failed tests instead of silently passing.
const originalAssert = console.assert as (condition: unknown, ...data: unknown[]) => void;
console.assert = (condition: unknown, ...data: unknown[]) => {
  if (!condition) {
    const message = data.length > 0 ? data.map(String).join(' ') : 'Assertion failed';
    throw new Error(message);
  }
  originalAssert(condition, ...data);
};
