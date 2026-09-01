function cloneDetails(details) {
  return JSON.parse(JSON.stringify(details));
}

export class Phase4LabObserver {
  #recorder;

  constructor({ recorder }) {
    this.#recorder = recorder;
  }

  observe(type, details = {}) {
    return this.#recorder.record(type, {
      evidence_source: 'phase4_lab_observer',
      observation_boundary: 'separate_lab_side_recorder',
      same_process: true,
      operator_independence: false,
      ...cloneDetails(details),
    });
  }
}
