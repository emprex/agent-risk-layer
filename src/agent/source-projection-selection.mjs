// Pure selection of immutable source projection generations. Only artifacts
// already verified as same project, control, current snapshot and Git SHA may
// be passed here by the authenticated mapping workflow.
export const CURRENT_SOURCE_PROJECTION='arl.source-collection-projection.v2';

export function selectCurrentSourceProjectionArtifacts(artifacts){
 if(!Array.isArray(artifacts))
  throw new Error('Source projections must be an array.');
 const current=artifacts.filter(a=>a?.sourceProjectionRevision===CURRENT_SOURCE_PROJECTION);
 return current.length?current:artifacts;
}
