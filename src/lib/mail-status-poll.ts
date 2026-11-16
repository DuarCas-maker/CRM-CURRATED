// Fast feedback for short sends without polling a held/quota-limited send at
// one request per second indefinitely.
export function mailStatusPollDelay(elapsedMs: number) {
  if (elapsedMs < 15_000) return 1000;
  if (elapsedMs < 60_000) return 2000;
  return 5000;
}

export function shouldPollMailStatus(hidden: boolean, requestPending: boolean) {
  return !hidden && !requestPending;
}
