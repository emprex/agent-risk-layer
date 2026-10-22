#!/usr/bin/env node

// Informational commands deliberately avoid importing the assessment runner:
// that runner can initialise persisted assessment state for a new target.
const command = process.argv[2];
if (['--help', '-h', '--version', 'doctor'].includes(command)) {
  if (process.argv.length !== 3) {
    console.error('Usage: arl-operator --help | --version | doctor');
    process.exitCode = 2;
  } else {
    const guide = await import('../src/agent/local-operator-guide.mjs');
    if (command === '--help' || command === '-h') {
      console.log(guide.operatorHelp);
    } else if (command === '--version') {
      console.log(guide.operatorVersion());
    } else {
      console.log(guide.formatOperatorDiagnostics(
        guide.collectOperatorDiagnostics()
      ));
    }
  }
} else {
  // Preserve every existing positional assessment command unchanged.
  await import('../src/agent/arl-local-assessment-runner.mjs');
}
