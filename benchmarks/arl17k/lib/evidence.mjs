import fs from 'node:fs';
import path from 'node:path';

export class EvidenceRecorder {
  constructor({ benchmarkVersion, scenarioId, runId }) {
    this.context = { benchmark_version: benchmarkVersion, scenario_id: scenarioId, run_id: runId };
    this.events = [];
  }

  record(type, details = {}) {
    const event = {
      sequence: this.events.length + 1,
      ...this.context,
      type,
      ...details,
    };
    this.events.push(event);
    return event;
  }

  writeJsonl(outputPath) {
    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });
    const body = `${this.events.map((event) => JSON.stringify(event)).join('\n')}\n`;
    fs.writeFileSync(outputPath, body, 'utf8');
    return outputPath;
  }
}
