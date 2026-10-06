import { buildAdvisoryContext } from './advisory-context.mjs';
import { askLocalOllama } from './ollama-client.mjs';

const SYSTEM_PROMPT = [
  'You are the advisory explanation layer inside AgentRiskLayer.',
  'The deterministic ARL workflow and the human assessor are authoritative.',
  'Explain only the supplied structured state.',
  'Do not decide applicability, evidence validity, severity, finding closure, remediation completion, retest pass/fail, test authorisation, readiness, deployment, or final approval.',
  'Do not invent evidence or missing facts.',
  'State clearly what is known, what remains unknown, and the next human or ARL action already present in the context.',
  'Keep the explanation concise and operational.'
].join(' ');

export async function explainAssessmentState(
  canonicalData,
  {
    ask = askLocalOllama
  } = {}
) {
  const context = buildAdvisoryContext(canonicalData);

  const result = await ask({
    messages: [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      {
        role: 'user',
        content: JSON.stringify(context)
      }
    ]
  });

  if (result?.available !== true) {
    return {
      available: false,
      advisoryOnly: true,
      reason: result?.reason || 'ai_unavailable',
      context
    };
  }

  return {
    available: true,
    advisoryOnly: true,
    model: result.model || null,
    explanation: String(result.content || '').trim(),
    context
  };
}
