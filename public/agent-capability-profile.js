export const CAPABILITY_PROFILE_VERSION = 'ARL-CAP-1.1.0';

export const CAPABILITY_DIMENSIONS = Object.freeze([
  Object.freeze({ key: 'autonomy', label: 'Autonomy', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['assistive','Assistive — proposes, human decides'],['bounded','Bounded — executes within defined limits'],['autonomous','Autonomous — can act without immediate approval'],['adaptive','Adaptive / long-running — behaviour or plans can evolve during operation'],
  ]) }),
  Object.freeze({ key: 'memory', label: 'Memory', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No retained agent memory'],['session','Session-only memory'],['persistent','Persistent cross-session memory'],['shared','Shared memory used by more than one agent or tenant context'],
  ]) }),
  Object.freeze({ key: 'toolDiscovery', label: 'Tool discovery', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['static','Static, predeclared tools'],['dynamic','Dynamic tool discovery'],['mcp','MCP-discovered or MCP-provided tools'],['generated','Agent can generate or install executable tooling'],
  ]) }),
  Object.freeze({ key: 'delegation', label: 'Delegation', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No agent delegation'],['sub_agent','Delegates to bounded sub-agents'],['external_agent','Delegates to an external agent or service agent'],['multi_agent','Multi-agent coordination or collaboration'],
  ]) }),
  Object.freeze({ key: 'goals', label: 'Goal behaviour', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['single_task','Single bounded task'],['decomposed','Decomposes a task into sub-goals'],['persistent','Maintains goals across time or sessions'],['chained','Chains goals or creates follow-on work'],
  ]) }),
  Object.freeze({ key: 'learning', label: 'Learning / adaptation', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No runtime learning or self-modification'],['offline','Offline updates only'],['online','Online adaptation from runtime feedback'],['self_modifying','Can change prompts, policies, code, memory rules or equivalent behaviour itself'],
  ]) }),
  Object.freeze({ key: 'evaluatorAuthority', label: 'Evaluator / feedback authority', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No evaluator or feedback component'],['advisory','Advisory only'],['gates_actions','Can gate or block actions'],['changes_state','Can change agent state or memory'],['changes_policy','Can change policy, routing or permissions'],
  ]) }),
  Object.freeze({ key: 'triggerMode', label: 'Trigger mode', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['user','User-triggered only'],['scheduled','Scheduled execution'],['event','Event-triggered execution'],['self','Self-triggered continuation or replanning'],
  ]) }),
  Object.freeze({ key: 'aggregateResourceControl', label: 'Aggregate resource control', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No cumulative limit'],['per_action_only','Per-action limits only'],['authoritative_downstream','Cumulative limit enforced atomically by the authoritative downstream system'],['separate_budget_service','Cumulative limit enforced by a separately reviewed budget or quota service'],
  ]) }),
  Object.freeze({ key: 'instructionAuthority', label: 'Instruction authority', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['fixed_local','Only fixed project-controlled prompts or procedures influence behaviour'],['retrieved','Procedural instructions can be retrieved at run time'],['remote_followed','Remote/provider-maintained instructions can influence behaviour'],['agent_selected','The agent can select procedural instructions or skills itself'],['mixed','More than one instruction-authority mode applies'],
  ]) }),
  Object.freeze({ key: 'instructionActivation', label: 'Instruction activation', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['none','No additional procedural instruction packages'],['explicit','Loaded only after an explicit user or workflow reference'],['project_saved','Project-saved instructions loaded deliberately'],['auto_triggered','Instructions can activate without an explicit per-use request'],['agent_selected','The agent can choose instructions during execution'],['mixed','More than one activation mode applies'],
  ]) }),
  Object.freeze({ key: 'instructionProvenance', label: 'Instruction provenance', options: Object.freeze([
    ['unknown','Unknown / not yet confirmed'],['project_controlled','Project-controlled and reviewable with the system version'],['versioned_source','External source and revision/version are recorded'],['digest_bound','Exact instruction content is bound to a recorded digest'],['mutable_remote','Remote instructions can change without a local reviewed copy'],['mixed','More than one provenance state applies'],
  ]) }),
]);

export const CAPABILITY_MULTI_DIMENSIONS = Object.freeze([
  Object.freeze({ key: 'rollbackScope', label: 'Rollback / recovery scope', options: Object.freeze([
    ['policy','Policy'],['model','Model'],['memory','Memory'],['tooling','Tooling'],['workflow','Workflow / orchestration'],['data','Changed data or records'],
  ]) }),
  Object.freeze({ key: 'externalTrust', label: 'External trust dependencies', options: Object.freeze([
    ['mcp_provider','MCP provider or server'],['external_agent','External agent'],['marketplace','Agent / tool marketplace'],['external_api','External API or hosted service'],['instruction_provider','Remote skill / procedural-instruction provider'],
  ]) }),
  Object.freeze({ key: 'inputChannels', label: 'Untrusted or user-controlled input channels', options: Object.freeze([
    ['text','Text / chat'],['email','Email / messages'],['file','Files / documents'],['web','Web / browser content'],['voice','Voice / audio'],['image','Images / visual input'],['sensor','Sensor / physical-world input'],['tool_output','Tool responses'],['memory','Stored memory / context'],
  ]) }),
  Object.freeze({ key: 'instructionSources', label: 'Procedural instruction sources', options: Object.freeze([
    ['system_prompt','System / developer prompt'],['project_skill','Project-controlled skill or procedure'],['saved_skill','Saved / vendored external skill'],['remote_skill','Remote or provider-followed skill'],['retrieved_procedure','Retrieved runbook / procedure'],['memory_instruction','Instruction recovered from memory or persistent context'],['tool_instruction','Instruction supplied through tool or MCP output'],
  ]) }),
]);

const dimensionOptions = new Map(CAPABILITY_DIMENSIONS.map((dimension) => [dimension.key, new Set(dimension.options.map(([value]) => value))]));
const multiOptions = new Map(CAPABILITY_MULTI_DIMENSIONS.map((dimension) => [dimension.key, new Set(dimension.options.map(([value]) => value))]));

function enumValue(key, value) {
  const allowed = dimensionOptions.get(key);
  return allowed?.has(String(value || '')) ? String(value) : 'unknown';
}

function listValue(key, value) {
  const allowed = multiOptions.get(key) || new Set();
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item)).filter((item) => allowed.has(item)))].sort();
}

export function normaliseCapabilityProfile(input = {}) {
  const profile = {
    version: CAPABILITY_PROFILE_VERSION,
    evidenceState: 'declared',
  };
  for (const dimension of CAPABILITY_DIMENSIONS) profile[dimension.key] = enumValue(dimension.key, input?.[dimension.key]);
  for (const dimension of CAPABILITY_MULTI_DIMENSIONS) profile[dimension.key] = listValue(dimension.key, input?.[dimension.key]);
  return profile;
}

export function deriveCapabilityFacts(input = {}) {
  const profile = normaliseCapabilityProfile(input);
  const facts = new Set();

  if (['autonomous','adaptive'].includes(profile.autonomy)) facts.add('authority:autonomous');
  if (['persistent','shared'].includes(profile.memory)) facts.add('input:memory');
  if (profile.rollbackScope.length) facts.add('safeguard:recovery');

  const channelFacts = {
    text: 'input:user_messages',
    email: 'input:email',
    file: 'input:uploaded_files',
    web: 'input:web_content',
    tool_output: 'input:tool_output',
    memory: 'input:memory',
  };
  for (const channel of profile.inputChannels) if (channelFacts[channel]) facts.add(channelFacts[channel]);

  // Instruction-authority fields are intentionally not converted into findings or
  // new control-suggestion facts in ARL-SUGGEST-1.0.0. They are version-bound
  // declared context until a deliberately versioned server-owned mapping exists.
  return [...facts].sort();
}

export function capabilityProfileSummary(input = {}) {
  const profile = normaliseCapabilityProfile(input);
  const rows = CAPABILITY_DIMENSIONS.map((dimension) => {
    const label = dimension.options.find(([value]) => value === profile[dimension.key])?.[1] || 'Unknown / not yet confirmed';
    return { key: dimension.key, label: dimension.label, value: profile[dimension.key], display: label };
  });
  for (const dimension of CAPABILITY_MULTI_DIMENSIONS) {
    const selected = new Set(profile[dimension.key]);
    rows.push({
      key: dimension.key,
      label: dimension.label,
      value: profile[dimension.key],
      display: selected.size ? dimension.options.filter(([value]) => selected.has(value)).map(([,label]) => label).join(', ') : 'None declared',
    });
  }
  return rows;
}

export function sameCapabilityProfile(left, right) {
  return JSON.stringify(normaliseCapabilityProfile(left)) === JSON.stringify(normaliseCapabilityProfile(right));
}
