/**
 * Circuit breaker for Claude API calls.
 *
 * When Claude is slow or experiencing errors, the retry loop in claude.ts can
 * push P99 to 14.5s+. The deterministic blurb path (buildQueueBlurb) already
 * scores B-/80+ on grading, so falling back to it during outages restores
 * P99 to ~1.5s with no quality regression.
 *
 * States: CLOSED (normal) -> OPEN (failing, skip Claude) -> HALF_OPEN (testing recovery)
 *
 * Transitions:
 * - CLOSED -> OPEN: after consecutiveFailures >= FAILURE_THRESHOLD
 * - OPEN -> HALF_OPEN: after COOLDOWN_MS has elapsed
 * - HALF_OPEN -> CLOSED: on successful Claude call
 * - HALF_OPEN -> OPEN: on failed Claude call (reset cooldown)
 *
 * State is in-memory (per Edge Function isolate). Each Deno isolate maintains
 * its own circuit state. This is intentional -- isolates that hit errors trip
 * independently, and isolates that recover close independently.
 */

import { logInfo, logWarn } from "./logger.ts";

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000; // 60 seconds

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitState {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureTime: number;
  totalTrips: number; // lifetime count of CLOSED -> OPEN transitions
}

// In-memory state (per Edge Function isolate)
const circuitState: CircuitState = {
  state: "CLOSED",
  consecutiveFailures: 0,
  lastFailureTime: 0,
  totalTrips: 0,
};

/**
 * Check if Claude calls should be skipped.
 *
 * Returns true when the circuit is OPEN and cooldown has not elapsed.
 * Returns false for CLOSED (normal) and HALF_OPEN (allow one test request).
 *
 * Side effect: transitions OPEN -> HALF_OPEN when cooldown elapses.
 */
export function isCircuitOpen(): boolean {
  if (circuitState.state === "CLOSED") return false;

  if (circuitState.state === "OPEN") {
    // Check if cooldown has elapsed
    if (Date.now() - circuitState.lastFailureTime >= COOLDOWN_MS) {
      const prev = circuitState.state;
      circuitState.state = "HALF_OPEN";
      logInfo("Circuit breaker state change", {
        from: prev,
        to: "HALF_OPEN",
        consecutiveFailures: circuitState.consecutiveFailures,
        cooldownMs: COOLDOWN_MS,
      });
      return false; // Allow one test request
    }
    return true; // Still in cooldown
  }

  // HALF_OPEN: allow the request through
  return false;
}

/**
 * Record a successful Claude call.
 * Transitions HALF_OPEN -> CLOSED, or resets failure count in CLOSED state.
 */
export function recordSuccess(): void {
  const prev = circuitState.state;
  circuitState.consecutiveFailures = 0;

  if (prev !== "CLOSED") {
    circuitState.state = "CLOSED";
    logInfo("Circuit breaker state change", {
      from: prev,
      to: "CLOSED",
      consecutiveFailures: 0,
      message: "Claude API recovered",
    });
  }
}

/**
 * Record a failed Claude call.
 * Increments consecutive failure count. Transitions CLOSED -> OPEN when
 * threshold is reached, or HALF_OPEN -> OPEN on any failure.
 */
export function recordFailure(): void {
  const prev = circuitState.state;
  circuitState.consecutiveFailures++;
  circuitState.lastFailureTime = Date.now();

  if (circuitState.state === "HALF_OPEN") {
    // Test request failed -- reopen the circuit
    circuitState.state = "OPEN";
    circuitState.totalTrips++;
    logWarn("Circuit breaker state change", {
      from: prev,
      to: "OPEN",
      consecutiveFailures: circuitState.consecutiveFailures,
      totalTrips: circuitState.totalTrips,
      message: "HALF_OPEN test request failed, reopening circuit",
    });
  } else if (circuitState.consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitState.state = "OPEN";
    circuitState.totalTrips++;
    logWarn("Circuit breaker state change", {
      from: prev,
      to: "OPEN",
      consecutiveFailures: circuitState.consecutiveFailures,
      totalTrips: circuitState.totalTrips,
      message: `${FAILURE_THRESHOLD} consecutive failures, opening circuit`,
    });
  }
}

/**
 * Get a snapshot of the current circuit state for response metadata.
 */
export function getCircuitState(): Readonly<CircuitState> {
  return { ...circuitState };
}
