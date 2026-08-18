# AgentRiskLayer Instruction Authority

## Purpose

AgentRiskLayer treats procedural instructions as part of the agent system when they can influence behaviour or tool execution.

This includes system/developer prompts, project-controlled skills, saved or vendored skills, remotely followed skills, retrieved runbooks or procedures, instructions recovered from memory, and instructions supplied through tool or MCP output.

The security question is not whether these instruction sources exist. Their existence is system context, not a vulnerability. The question is whether they can influence consequential actions and whether the resulting authority chain is independently controlled and evidenced.

## Three layers of authority

AgentRiskLayer separates:

1. **Capability authority** — what tools, identities, systems and data the agent can technically reach.
2. **Instruction authority** — what prompts, skills, memory, retrieval and tool-provided instructions can influence what the agent attempts to do.
3. **Execution authority** — what downstream policy, scoped permissions and accountable humans will actually permit to execute.

A trusted instruction is not the same as a trusted action. High-impact execution still needs the relevant downstream controls.

## Capability profile v1.1

`ARL-CAP-1.1.0` adds bounded declared fields for:

- `instructionAuthority`
  - fixed project-controlled instructions;
  - run-time retrieval;
  - remote/provider-followed instructions;
  - agent-selected instructions;
  - mixed mode;
  - unknown.
- `instructionActivation`
  - none;
  - explicit reference;
  - project-saved deliberate loading;
  - auto-triggered loading;
  - agent-selected loading;
  - mixed mode;
  - unknown.
- `instructionProvenance`
  - project-controlled;
  - external source and revision/version recorded;
  - exact content digest-bound;
  - mutable remote content;
  - mixed state;
  - unknown.
- `instructionSources`
  - system/developer prompt;
  - project-controlled skill/procedure;
  - saved/vendored external skill;
  - remote/provider-followed skill;
  - retrieved runbook/procedure;
  - memory instruction;
  - tool/MCP-provided instruction.
- `externalTrust` now includes a remote skill/procedural-instruction provider.

These fields are captured by the existing guided Control Intelligence snapshot forms because those forms render the versioned capability schema dynamically.

## Evidence semantics

All capability-profile instruction fields remain `evidenceState: declared`.

They do not establish:

- that a skill or prompt was actually loaded;
- that its source is trustworthy;
- that a control exists;
- that a vulnerability exists;
- that an attack path is exploitable;
- that an action is safe;
- that deployment should proceed.

Unknown or unconfirmed instruction details remain unknown. They are not converted into findings.

A finding still requires the normal AgentRiskLayer evidence path: an observed or reproducible failure with project-contextual impact, followed by remediation and bounded retest before closure.

## Change and staleness

The capability profile lives inside the existing immutable Control Intelligence system snapshot. Therefore a material change in instruction authority, activation, provenance posture or source categories changes the snapshot digest and creates a new system version through the existing compare-and-swap path.

The existing snapshot lifecycle then:

- supersedes the previous system snapshot;
- marks prior control evaluations stale;
- marks the current deployment decision stale;
- preserves prior evidence as historical evidence rather than rewriting it.

This is deliberately conservative. The current graph stales the prior snapshot's control evaluations as a set after a material snapshot change. Selective dependency-level staleness is a future optimisation and must not be simulated before the graph can prove which evidence depends on which changed instruction source.

A changed instruction is not itself a finding.

## Provenance boundary

The capability profile records the **provenance posture** — for example whether instructions are project-controlled, versioned, digest-bound or mutable remote content. It does not yet store arbitrary remote URLs, repository paths or digests as free-form capability fields.

Exact source identifiers, revisions and digests should be recorded as observed evidence when Inspector or another authorised evidence collector can obtain them reliably. Until then, customers may describe the exact source in the version-bound architecture summary, but that description remains a declaration.

This avoids accepting an arbitrary customer-entered hash or repository reference and presenting it as technical provenance.

## Customer journey

The customer-facing effect should remain small:

- **Assess / Describe:** the system asks only the relevant instruction-authority questions as part of the existing Agent Capability Profile.
- **Fix:** a finding may point to an unsafe authority chain only when evidence supports the failure; the presence of a remote skill alone is not a finding.
- **Prove:** observed source/revision/digest evidence can later be attached without changing declaration semantics.
- **Deploy:** a material instruction-authority change invalidates reliance on the previous deployment decision until the affected system is reviewed again.
- **Improve / Return:** changed instruction authority becomes a reason to reassess, without deleting the old evidence history.

## Relationship to external skills protocols

AgentRiskLayer does not implement or depend on any particular skills-delivery protocol. The security model is protocol-neutral.

The relevant distinction is behavioural: whether procedural instructions are local or remote, explicit or implicit, controlled or mutable, and whether they can influence consequential actions.

AgentRiskLayer should inspect protocols such as SKILL.md-based systems as evidence sources, not become a skills marketplace or skills runtime.
