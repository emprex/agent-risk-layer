function cloneDetails(details) {
  return JSON.parse(JSON.stringify(details));
}

export class SeparateLabObserver {
  #recorder;

  constructor({ recorder }) {
    this.#recorder = recorder;
  }

  observe(type, details = {}) {
    return this.#recorder.record(type, {
      evidence_source: 'phase3_lab_observer',
      independence_boundary: 'separate_from_agent_activity_recorder',
      same_process: true,
      operator_independence: false,
      ...cloneDetails(details),
    });
  }
}
