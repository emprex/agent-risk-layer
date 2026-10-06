import { buildAdvisoryContext } from './advisory-context.mjs';
import { askLocalOllama } from './ollama-client.mjs';

const SYSTEM_PROMPT = [
  'You are the advisory explanation layer inside AgentRiskLayer.',
  'The deterministic ARL workflow and the human assessor are authoritative.',
  'Use only the supplied numbered facts.',
  'Do not infer causes, hidden state, ambiguity, lineage, intent, effectiveness, severity, readiness, or any other fact that is not explicitly present.',
  'Do not explain why something is true unless the supplied fact itself states why.',
  'If information is absent, say it is not provided.',
  'Every factual sentence must cite one or more supplied fact IDs in square brackets, for example [F2].',
  'Do not decide applicability, evidence validity, severity, finding closure, remediation completion, retest pass/fail, test authorisation, readiness, deployment, or final approval.',
  'Keep the explanation concise and operational.'
].join(' ');

function booleanFact(label, value) {
  if (typeof value !== 'boolean') {
    return null;
  }
  return `${label}: ${value ? 'yes' : 'no'}.`;
}

export function buildGroundedFacts(context) {
  const facts = [];

  if (context.stage) {
    facts.push(`Current stage: ${context.stage}.`);
  }

  if (context.control?.controlId) {
    facts.push(
      `Current scoped control ID: ${context.control.controlId}` +
      (context.control.title
        ? ` (${context.control.title}).`
        : '.')
    );
  }

  const knownLabels = {
    frozenTargetVerified: 'Frozen target verified',
    assessmentContextAvailable: 'Assessment context available',
    authoritativeAssessmentAvailable: 'Authoritative assessment available',
    targetContextBound: 'Target context bound',
    assessmentContextBound: 'Assessment context bound',
    evidencePlanAvailable: 'Evidence plan available',
    controlIntelligenceAvailable: 'Control Intelligence available'
  };

  for (const [key, label] of Object.entries(knownLabels)) {
    const fact = booleanFact(label, context.known?.[key]);
    if (fact) facts.push(fact);
  }

  for (const item of context.remainsUnproven || []) {
    facts.push(`Remains unproven: ${item}`);
  }

  if (context.requiredAction?.actor) {
    facts.push(
      [
        `Required action actor: ${context.requiredAction.actor}.`,
        context.requiredAction.label
          ? `Action: ${context.requiredAction.label}.`
          : null,
        typeof context.requiredAction.requiresUserInput === 'boolean'
          ? `Requires user input: ${context.requiredAction.requiresUserInput ? 'yes' : 'no'}.`
          : null
      ].filter(Boolean).join(' ')
    );
  }

  if (typeof context.readiness?.available === 'boolean') {
    facts.push(
      `Readiness available: ${context.readiness.available ? 'yes' : 'no'}.`
    );
  }

  if (context.readiness?.decision) {
    facts.push(
      `Projected readiness decision: ${context.readiness.decision}.`
    );
  }

  facts.push('Human review required: yes.');

  return facts.map((text, index) => ({
    id: `F${index + 1}`,
    text
  }));
}

export function renderGroundedFacts(facts) {
  return facts
    .map((fact) => `[${fact.id}] ${fact.text}`)
    .join('\n');
}

export async function explainAssessmentState(
  canonicalData,
  {
    ask = askLocalOllama
  } = {}
) {
  const context = buildAdvisoryContext(canonicalData);
  const facts = buildGroundedFacts(context);

  const result = await ask({
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: [
          'Explain the current assessment state using only these facts:',
          '',
          renderGroundedFacts(facts)
        ].join('\n')
      }
    ]
  });

  if (result?.available !== true) {
    return {
      available: false,
      advisoryOnly: true,
      reason: result?.reason || 'ai_unavailable',
      context,
      facts
    };
  }

  return {
    available: true,
    advisoryOnly: true,
    model: result.model || null,
    explanation: String(result.content || '').trim(),
    context,
    facts
  };
}
