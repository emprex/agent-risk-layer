import fs from 'node:fs';
import path from 'node:path';

const KNOWLEDGE_PATH = path.resolve(
  process.cwd(),
  'risk-knowledge/risk-knowledge-v1.json'
);

const data = JSON.parse(
  fs.readFileSync(KNOWLEDGE_PATH, 'utf8')
);

const entries = Array.isArray(data.entries)
  ? data.entries
  : [];

function requireUniqueControl({
  questionId,
  category,
  titleIncludes
}) {
  const matches = entries.filter((entry) => {
    if (entry.status !== 'active') return false;

    if (
      category &&
      entry.category !== category
    ) {
      return false;
    }

    const title =
      String(entry.title || '')
        .toLowerCase();

    return titleIncludes.every((term) =>
      title.includes(term.toLowerCase())
    );
  });

  if (matches.length !== 1) {
    throw new Error(
      `Assessment control binding for ${questionId} expected exactly one ARL control; found ${matches.length}.`
    );
  }

  return Object.freeze({
    questionId,
    controlId: matches[0].id,
    knowledgeVersion:
      matches[0].knowledge_version || null,
    title: matches[0].title,
    category: matches[0].category
  });
}

export const ASSESSMENT_CONTROL_BINDINGS =
  Object.freeze({

    tool_authorization:
      requireUniqueControl({
        questionId: 'tool_authorization',
        category:
          'Tools, MCP and agent authority',
        titleIncludes: [
          'tool',
          'independently',
          'validated'
        ]
      }),

    human_approval:
      requireUniqueControl({
        questionId: 'human_approval',
        category:
          'Human approval and transaction integrity',
        titleIncludes: [
          'approval',
          'exact action'
        ]
      }),

    memory_security:
      requireUniqueControl({
        questionId: 'memory_security',
        category:
          'Data, privacy, retrieval and memory',
        titleIncludes: [
          'memory',
          'poisoned'
        ]
      }),

    egress_control:
      requireUniqueControl({
        questionId: 'egress_control',
        category:
          'Tools, MCP and agent authority',
        titleIncludes: [
          'network tools',
          'unsafe egress'
        ]
      }),

    logging:
      requireUniqueControl({
        questionId: 'logging',
        category:
          'Runtime policy, monitoring and evidence',
        titleIncludes: [
          'audit coverage',
          'reconstruct'
        ]
      }),

    kill_switch:
      requireUniqueControl({
        questionId: 'kill_switch',
        category:
          'Availability, cost and resilience',
        titleIncludes: [
          'kill switch',
          'containment'
        ]
      })
  });

export function getAssessmentControlBinding(
  questionId
) {
  const binding =
    ASSESSMENT_CONTROL_BINDINGS[
      String(questionId || '').trim()
    ];

  if (!binding) {
    return {
      type: 'assessment_control_binding',
      available: false,
      reason: 'assessment_question_not_mapped',
      questionId:
        questionId || null
    };
  }

  return {
    type: 'assessment_control_binding',
    available: true,
    ...binding
  };
}
