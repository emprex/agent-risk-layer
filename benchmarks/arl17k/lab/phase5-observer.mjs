function cloneDetails(details) {
  return JSON.parse(JSON.stringify(details));
}

export class Phase5LabObserver {
  #recorder;

  constructor({ recorder }) {
    this.#recorder = recorder;
  }

  observe(type, details = {}) {
    return this.#recorder.record(type, {
      evidence_source: 'phase5_lab_observer',
      observation_boundary: 'separate_lab_side_recorder',
      same_process: true,
      operator_independence: false,
      ...cloneDetails(details),
    });
  }
}
