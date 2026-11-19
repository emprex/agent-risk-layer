// Non-serialisable in-process authority for ENKYRON's complete local queue.
// JSON/HTTP callers cannot carry this Symbol into the ARL control API.
export const LOCAL_OPERATOR_FULL_QUEUE =
  Symbol('arl-local-operator-full-control-queue');
