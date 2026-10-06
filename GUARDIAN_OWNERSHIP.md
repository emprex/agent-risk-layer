# ARL Guardian canonical ownership

## Role

ARL Guardian is the local, read-only capability-discovery component of AgentRiskLayer. It maps reviewable repository evidence for MCP, outbound network access, filesystem mutation, process execution, credential references and approval boundaries without running the assessed agent.

Guardian produces observations and evidence for human review. It does not decide control applicability, evidence validity, finding severity, finding closure, readiness or deployment.

## Canonical ownership

The canonical owner is the AgentRiskLayer repository:

`emprex/agent-risk-layer`

The current published preview is:

- product version: `0.3.0`
- active release candidate: `0.3.0-rc.5`
- artifact: `public/downloads/agentrisklayer-guardian-0.3.0-rc.5.tgz`
- digest sidecar: `public/downloads/agentrisklayer-guardian-0.3.0-rc.5.tgz.sha256`

Earlier RC artifacts are retained only as historical release evidence and are not active releases.

## Source status

The current repository contains the published Guardian release artifacts and public contract, but it does not contain a separately maintained Guardian source tree that can be identified as the build source for RC5.

That is a cleanup gap, not a second product architecture.

No new Guardian version or release candidate should be published until the Guardian source is restored into this canonical repository under a clearly owned source path and the release artifact can be rebuilt and integrity-checked from that source.

The existing RC5 artifact remains preserved and usable while this source-recovery work is completed.

## Release rules

1. One canonical repository owns Guardian.
2. The public website may reference only the active Guardian release.
3. Every active artifact must have an integrity digest.
4. Historical RC artifacts may remain archived but must not be advertised as active.
5. A future Guardian release requires checked-in canonical source and a reproducible packaging step.
6. Guardian remains observational. AgentRiskLayer assessment and accountable human review remain the authority boundary.
