// IPC reception is timed by the evaluator's monotonic clock. No cross-process
// clock subtraction or summing of internal test durations is required.
module.exports = class PilotReporter {
  onTestEnd(test, result) {
    process.send?.({ type: 'pilot-test', title: test.title,
      status: result.status, durationMs: result.duration });
  }
  onError(error) {
    // Playwright reports its intentional fail-fast stop through onError too.
    // It is expected when a controlled fault is detected, not an infrastructure failure.
    const text = String(error.message).replace(/\u001b\[[0-9;]*m/g, '').trim();
    if (text === 'Testing stopped early after 1 maximum allowed failures.') return;
    process.send?.({ type: 'pilot-error', message: String(error.message).slice(0, 2000) });
  }
};
