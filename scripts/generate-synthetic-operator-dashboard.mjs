import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';
import { buildAssessmentEvidenceBatchIndex } from '../src/agent/assessment-evidence-batch-index.mjs';
import { buildAssessmentReviewDossiers } from '../src/agent/assessment-review-dossiers.mjs';
import {
  buildOfflineOperatorReviewDashboard,
  writeOfflineOperatorReviewDashboard
} from '../src/agent/offline-operator-review-dashboard.mjs';

// Completely synthetic. This source must not import a DB, real assessment,
// target checkout, API client, credential, or source-inspection runner.
export const DEMO_SNAPSHOT = 'SYNTHETIC_DEMO_NOT_AN_ASSESSMENT';
export const DEMO_REVISION = '0000000000000000000000000000000000000000';
const id = n => 'ARL-KB-' + String(n).padStart(3, '0');
const HUMAN_DECISION_FIXTURE = new Set([1,2,3,4,5,46,57,90,100]);

function item(n) {
  if (n === 6) return {
    controlId:id(n), currentStage:'remediation',
    chainStatus:'finding_open', deploymentImpact:'blocker'
  };
  if (HUMAN_DECISION_FIXTURE.has(n)) return {
    controlId:id(n), currentStage:'deployment_decision',
    chainStatus:'controlled_with_evidence', deploymentImpact:'satisfied'
  };
  return {
    controlId:id(n), currentStage:'test',
    chainStatus:'test_inconclusive', deploymentImpact:'hold'
  };
}

function detail(controlId) {
  const num = Number(controlId.slice(-3));
  const machine = controlId + ' assessed system, exact version, environment and approved scope';
  const human = controlId + ' reviewer identity, role, timestamp and evidence digest';
  const runtime = controlId + ' positive and abuse inputs with expected and observed outputs';
  const checkId = 'DEMO-CHECK-' + controlId;
  const checkDigest = 'SYNTHETIC-ONLY-CHECK-' + controlId;

  const source = 'arl_frozen_source_evidence_collection_v2';
  const reference = source + ':' + DEMO_REVISION + ':' + controlId + ':' + '1'.repeat(64);
  const test = {
    id:'synthetic-test-' + controlId,
    controlId,
    systemSnapshotId:DEMO_SNAPSHOT,
    checkId,
    checkDigest,
    result:'inconclusive',
    executionKind:'initial',
    executionMethod:source,
    inputReference:reference,
    observedResult:[
      'DEMO ONLY — synthetic metadata.',
      'Requirement-specific deterministic observations:',
      JSON.stringify({
        schema:'arl.deterministic-evidence-collection.v1',
        targetRevision:DEMO_REVISION,
        requirementObservations:[{
          requirement:machine,
          collectors:['target_identity'],
          observations:{target_identity:{
            revision:DEMO_REVISION,
            environment:'synthetic-demo',
            projectName:'No real customer'
          }}
        }]
      }),
      'This collection does not assert that any canonical requirement is satisfied and does not infer PASS/FAIL.'
    ].join('\n')
  };

  const evidence = {
    id:'synthetic-evidence-' + controlId,
    controlId,
    systemSnapshotId:DEMO_SNAPSHOT,
    testExecutionId:test.id,
    sourceType:source,
    sourceReference:reference,
    evidenceClass:'observed',
    retentionStatus:'active',
    verificationState:'unverified',
    limitations:'DEMO ONLY: this is fake evidence and does not concern a real target.'
  };

  // A mixture of source candidate records, missing records, and retired
  // records exercises normal operator navigation. Nothing was actually tested.
  const withCandidate = num % 3 === 0;
  const isRetired = num % 11 === 0;
  return {
    control:{id:controlId,title:'Synthetic example control ' + controlId},
    systemSnapshot:{
      id:DEMO_SNAPSHOT,
      versionIdentifier:DEMO_REVISION,
      assessmentConfiguration:{
        targetBinding:{
          schema:'arl.target-binding.v1',
          source:'git',
          revision:DEMO_REVISION
        },
        assessmentBinding:{
          schema:'arl.assessment-binding.v1',
          assessmentId:'SYNTHETIC_NO_CUSTOMER'
        }
      }
    },
    testDefinition:{
      id:checkId,
      digest:checkDigest,
      objective:'DEMO ONLY: illustrate which evidence an operator must review.',
      method:'Inspect version-specific source metadata, accountable records and separately authorised runtime tests.',
      requiredEvidence:[machine,human,runtime],
      passCondition:'Accountable human decision supported by all actual required evidence.',
      failCondition:'A mandatory criterion remains unsupported.',
      limitations:'Synthetic fixture is not an assessment, finding, certification or customer evidence.'
    },
    tests:withCandidate?[test]:[],
    testHistory:[],
    evidence:withCandidate?[{...evidence,retentionStatus:isRetired?'retired':'active'}]:[],
    evidenceHistory:[]
  };
}

export function buildSyntheticOperatorDemo() {
  const all = Array.from({length:108},(_,i)=>item(i+1));
  const pages = [all.slice(0,50),all.slice(50,100),all.slice(100)]
    .map((items,index)=>({
      systemSnapshot:{id:DEMO_SNAPSHOT},
      total:108,
      items,
      hasMore:index!==2
    }));
  const queue=buildControlWorkQueue(pages);
  const index=buildAssessmentEvidenceBatchIndex(queue);
  if (!queue.complete || index.eligibleControls!==98 || index.excludedControls!==10 ||
      index.batchCount!==5 ||
      queue.lanes.follow_up_blocked.map(x=>x.controlId).join(',')!=='ARL-KB-006') {
    throw new Error('Synthetic demonstration no longer covers the required 108-control boundary.');
  }
  const batches = index.batches.map(batch=>buildAssessmentReviewDossiers({
    queue,
    controlIds:batch.controlIds,
    details:batch.controlIds.map(detail)
  }));
  const dashboard=buildOfflineOperatorReviewDashboard(index,batches,DEMO_REVISION);
  return {...dashboard, syntheticDemo:true};
}

export function writeSyntheticOperatorDemo(outputDirectory) {
  if (!outputDirectory) throw new Error('Explicit synthetic demo output directory required.');
  const dashboard=buildSyntheticOperatorDemo();
  const output=writeOfflineOperatorReviewDashboard({dashboard,outputDirectory});
  return {
    ...output,
    synthetic:true,
    controls:dashboard.assessedControls,
    excludedControls:dashboard.excludedControls,
    revision:DEMO_REVISION
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = writeSyntheticOperatorDemo(
    process.argv[2] || path.resolve('data','operator-demo')
  );
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
