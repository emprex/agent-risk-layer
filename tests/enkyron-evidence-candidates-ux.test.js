import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const text=fs.readFileSync(new URL('../desktop/enkyron.py',import.meta.url),'utf8');
const between=(start,end)=>{
  const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,'Expected ENKYRON code segment');
  return text.slice(a,b);
};
test('Evidence Requests provides a labelled direct action without replay or the tiny plus',()=>{
  const ui=between('self.evidence_button = QPushButton','self.batch_review_table = QTableWidget');
  assert.match(ui,/Collect and register source evidence candidates/);
  assert.match(ui,/batchEvidenceCandidatesGuidedAction/);
  assert.match(ui,/batch_record_button\.clicked\.connect\(self\.review_static_metadata_batch\)/);
  assert.doesNotMatch(ui,/batchMetadataRecordTinyAction|setText\("＋"\)/);
  assert.match(ui,/batchEvidenceOpenRegister/);
  assert.match(ui,/setVisible\(False\)/);
});
test('the existing ticket gates the action without requiring the matrix or replay',()=>{
  const loaded=between('self.static_collect_button.setEnabled(\n                self.control_review_button','self.pilot_lab.set_ticket');
  assert.match(loaded,/self\.batch_record_button\.setEnabled\(\s*self\.control_review_button\.isEnabled\(\)/);
  assert.doesNotMatch(loaded,/batch_review_panel\.isVisible\(\)/);
  const guided=between('    def review_static_metadata_batch(self):','    def _commit_static_batch_chunk(self):');
  assert.match(guided,/self\.bridge\.call\("static-batch-preview", ticket_id, callback=previewed\)/);
  assert.match(guided,/self\.batch_replay_results\.setVisible\(True\)/);
  assert.doesNotMatch(guided,/self\.replay_source_fingerprints\(/);
});
test('one human approval follows scoped read-only preview and no-op is discoverable',()=>{
  const guided=between('    def review_static_metadata_batch(self):','    def _commit_static_batch_chunk(self):');
  assert.equal((guided.match(/QMessageBox\.question\(/g)||[]).length,1);
  assert.match(guided,/already \+ remaining != 103/);
  assert.match(guided,/if remaining == 0:[\s\S]*?self\.batch_open_register_button\.setVisible\(True\)/);
  assert.match(guided,/self\.bridge\.call\("static-batch-preview"/);
  assert.match(guided,/self\._commit_static_batch_chunk\(\)/);
});
test('completed registration makes canonical Evidence Register reachable',()=>{
  const completed=between('    def _commit_static_batch_chunk(self):','    def select_batch_review_control(self):');
  assert.match(completed,/data\.get\("verification_state"\) != "unverified"/);
  assert.match(completed,/self\.batch_open_register_button\.setVisible\(True\)/);
  assert.match(text,/lambda: self\.tabs\.setCurrentIndex\(6\)/);
});
