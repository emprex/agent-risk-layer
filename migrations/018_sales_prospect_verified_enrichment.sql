-- Verified public-source enrichment for selected imported MCP sales prospects.
-- Evidence reviewed 2026-08-10. This migration deliberately keeps prospects in
-- research and preserves zero pipeline value until the owner qualifies outreach.
-- Public product/security-control descriptions remain declarations unless ARL tests them.

WITH enrichments (
  record_id, company_name, website, company_size, buyer_name, buyer_role, buyer_linkedin,
  trigger_signal, agent_use_case, tool_access, evidence_json, score, score_reasons_json, note
) AS (
  VALUES
  (
    'ARL-P-000001',
    'inference.sh',
    'https://inference.sh/',
    '1-10',
    'Ömer Karışman',
    'Founder',
    NULL,
    'Active agent runtime with MCP and tool execution; public documentation reviewed 2026-08-10 describes human approval for selected consequential tool calls.',
    'AI agent runtime where agents use apps, sub-agents, HTTP calls, workflows and MCP connector tools across hosted or customer-controlled execution.',
    'Public documentation describes agents calling external MCP tools and APIs with runtime credentials, plus optional human approval before destructive or expensive operations.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ac.inference.sh","https://inference.sh/about","https://inference.sh/agents","https://inference.sh/docs/agents/adding-tools","https://inference.sh/docs/connectors/mcp-server","https://www.linkedin.com/company/inference-sh"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 public evidence recorded","+10 target company size"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified inference.sh and founder Ömer Karışman. Current official docs describe real MCP/tool execution and optional human approval. No buyer-specific contact route was added. Product and control descriptions are public-source observations, not ARL-tested controls.'
  ),
  (
    'ARL-P-000366',
    'RadiusOS',
    'https://www.radiusos.ai/mcp',
    NULL,
    'Chad Newell',
    'Founder',
    'https://www.linkedin.com/in/chadrnewell',
    'RadiusOS is publicly described by its founder as live with paying users, AI deal scoring, Stripe billing, quotes and invoices, and an MCP server.',
    'MCP-first CRM and pipeline operating system for contacts, deals, quotes, invoices, scheduling, email and AI scoring.',
    'Registry and founder evidence describe 34 MCP tools spanning CRM records, quotes and invoices, scheduling, email workflows, AI scoring and Stripe-backed billing.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.radiusos.www","https://www.radiusos.ai/mcp","https://github.com/chadrnewell-hash/outreachos","https://www.linkedin.com/in/chadrnewell","https://www.linkedin.com/posts/chadrnewell_what-i-built-with-claude-code-in-28-days-activity-7454942465272479744-N-O-"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified founder Chad Newell and a live commercial RadiusOS product. Founder material describes paying users and consequential CRM/billing workflows. Company-size bucket remains unknown. Public claims are not independent verification of control effectiveness.'
  ),
  (
    'ARL-P-000009',
    'AdAdvisor',
    'https://adadvisor.ai/',
    '1-10',
    'Tarek Kekhia',
    'CTO & Co-Founder',
    'https://ca.linkedin.com/in/tarek-kekhia',
    'AdAdvisor has a live Meta Ads MCP product and in 2026 publicly documents write actions plus approval-first account changes.',
    'MCP and multi-agent advertising platform for Meta Ads analysis, recommendations and account or campaign actions.',
    'Official product material describes live Meta Ads access and write operations that can change campaigns, budgets or status, with explicit approval described before execution.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.adadvisor","https://adadvisor.ai/","https://adadvisor.ai/blog/mcp-prompts-meta-ads","https://adadvisor.ai/blog/the-dangers-of-mcp-for-meta-ads","https://www.linkedin.com/company/adadvisor-ai","https://ca.linkedin.com/in/tarek-kekhia"]',
    100,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded","+10 target company size"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified AdAdvisor, CTO and co-founder Tarek Kekhia, and a 2-10 employee public company profile. Official product material describes Meta Ads write actions and approval-first execution. These are public product claims and have not been tested by ARL.'
  ),
  (
    'ARL-P-000158',
    'Eevy AI',
    'https://eevy.ai/',
    '1-10',
    'Marius Møller-Hansen',
    'CTO & Co-Founder',
    'https://no.linkedin.com/in/marius-m%C3%B8ller-hansen-0bb44a205',
    'Eevy currently exposes 104 MCP tools for Shopify optimization and publicly describes approval-gated store changes and kill switches.',
    'Shopify conversion-optimization engine exposed through MCP for analytics, experiments, content, layouts, offers and optimization proposals.',
    'Current public product material describes 104 MCP tools and store-changing actions that wait for human approval, with kill switches plus preview, publish and revert controls.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.eevy","https://eevy.ai/","https://www.linkedin.com/company/eevyai","https://no.linkedin.com/in/marius-m%C3%B8ller-hansen-0bb44a205"]',
    100,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded","+10 target company size"]',
    '[ARL-ENRICHMENT:2026-08-10] Dated enrichment supersedes only the commercial interpretation of the July registry snapshot, which recorded no sensitive-action evidence. Current official material now describes 104 MCP tools and store-changing actions. Public approval and kill-switch claims are not ARL-tested controls.'
  ),
  (
    'ARL-P-000320',
    'OpenHelm',
    'https://openhelm.ai/',
    NULL,
    'Max Beech',
    'Founder',
    'https://uk.linkedin.com/in/maxbeech',
    'OpenHelm publishes current 2026 material on autonomous and unattended AI workflows, MCP tool access, human approval and audit trails.',
    'Autonomous agent workflows for research, code changes, email outreach, monitoring, browser or tool tasks and recurring operational goals.',
    'Registry and official OpenHelm material describe workflows touching code, email, external tools and APIs, recurring unattended jobs, credential handling and human-in-the-loop checkpoints.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.openhelm","https://openhelm.ai/","https://www.openhelm.ai/blog/what-is-human-in-the-loop-ai","https://www.openhelm.ai/blog/claude-mcp-integration-setup-guide","https://uk.linkedin.com/in/maxbeech"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified founder Max Beech and current OpenHelm agent/MCP material. Company-size bucket remains unknown. Human-in-the-loop and audit-trail descriptions are public product claims and not ARL-tested controls.'
  ),
  (
    'ARL-P-000005',
    'Mindsight Ventures — Lona',
    'https://lona.agency/',
    NULL,
    'Albert Solana',
    'CTO, Mindsight Ventures',
    'https://es.linkedin.com/in/albertsolana',
    'Lona is publicly available through OpenAI and MCP; Mindsight Ventures reported rapid sign-ups and AI-agent usage in 2026.',
    'AI-powered trading strategy generation and backtesting with market data, strategy portfolios and MCP access.',
    'Public product and CTO material describe strategy generation, portfolio management and backtest execution. Albert Solana additionally claims autonomous agents can self-register and start trading; ARL has not independently tested that claim.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=agency.lona","https://lona.agency/","https://github.com/mindsightventures/lona","https://es.linkedin.com/in/albertsolana","https://www.linkedin.com/posts/albertsolana_lona-trader-ai-powered-trading-co-pilot-activity-7405920491472908288-yzWA","https://www.linkedin.com/posts/albertsolana_ai-fintech-startup-activity-7433794107858243584-JVSC"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification connected Lona to Mindsight Ventures and CTO Albert Solana. The statement that autonomous agents can self-register and start trading is retained explicitly as an owner claim, not an ARL finding. Company-size bucket remains unverified.'
  ),
  (
    'ARL-P-000375',
    'RedditGrow',
    'https://redditgrow.ai/integrations/mcp',
    NULL,
    'Victor Grandchamp',
    'Founder',
    'https://fr.linkedin.com/in/victor-grandchamp/en',
    'RedditGrow is an active paid SaaS with an MCP integration exposing 50 tools across growth, cold-DM, monitoring, SEO and autopilot workflows.',
    'Reddit growth and lead-generation toolkit exposed through MCP for opportunities, response drafting, cold DMs, monitoring, SEO and next-action automation.',
    'Official MCP documentation exposes Reddit opportunity and reply workflows, cold-DM tooling, brand monitoring, SEO and autopilot actions; cold DMs can be queued for API delivery under scheduler caps and cooldowns.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.redditgrow","https://redditgrow.ai/integrations/mcp","https://github.com/Vico86/redditreach","https://fr.linkedin.com/in/victor-grandchamp/en"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified RedditGrow founder Victor Grandchamp and current paid MCP functionality. Company-size bucket remains unknown. Public scheduler, quota and delivery claims have not been independently tested by ARL.'
  ),
  (
    'ARL-P-000159',
    'Enginy',
    'https://www.enginy.ai/',
    '51-200',
    'Jaume Puig',
    'CTO & Co-Founder',
    NULL,
    'Enginy is actively operating an AI-native GTM platform; public company material describes a 51-200 employee organisation and continued AI sales automation development.',
    'AI-native GTM platform for finding buyers, enriching contacts and companies, and personalized multichannel outreach, with MCP access from Enginy workspaces.',
    'Public product and company material describes contact and company enrichment, CRM-oriented sales data, AI sales guidance and personalized outreach across multiple channels; the registry exposes find, enrich and reach capabilities through MCP.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.enginy","https://www.enginy.ai/","https://www.enginy.ai/resources/about-us","https://www.linkedin.com/company/enginyai"]',
    90,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 public evidence recorded","+10 target company size"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification identified Enginy, CTO and co-founder Jaume Puig, and a 51-200 employee public company profile. No buyer-specific contact route was added because an exact public profile was not sufficiently verified. Product descriptions remain public-source observations.'
  ),
  (
    'ARL-P-000020',
    'Observer Protocol / Agentic Terminal',
    'https://observerprotocol.org/',
    '1-10',
    'Boyd Cohen',
    'Founder, Observer Protocol & Agentic Terminal',
    'https://mx.linkedin.com/in/boyd-cohen-ph-d',
    'Observer Protocol and Agentic Terminal are in public beta in 2026 and publicly documenting agent identity, delegation and payment-policy infrastructure.',
    'Identity, delegation, transaction verification and trust infrastructure for autonomous agents, including agentic payments and fleet or spending governance.',
    'Public architecture and founder material describe agent identities, delegation credentials, payment-policy enforcement, transaction records and multi-rail agent payment workflows. ARL has not independently tested those controls.',
    '["https://registry.modelcontextprotocol.io/v0/servers?search=ai.agenticterminal","https://observerprotocol.org/","https://www.linkedin.com/company/observer-protocol","https://mx.linkedin.com/in/boyd-cohen-ph-d","https://www.linkedin.com/posts/boyd-cohen-ph-d_the-full-stack-trust-infrastructure-for-the-activity-7468332885511438337-T3A1"]',
    100,
    '["+20 specific AI-agent use case identified","+20 agent has real tool, data or system access","+15 current buying trigger identified","+15 named decision-maker identified","+10 verified contact route recorded","+10 public evidence recorded","+10 target company size"]',
    '[ARL-ENRICHMENT:2026-08-10] Public-source verification connected the original Agentic Terminal registry candidate to Observer Protocol and founder Boyd Cohen. Public descriptions cover identity, delegation and payment-policy controls. These are vendor/founder claims unless separately observed or tested by ARL.'
  )
)
UPDATE sales_prospects AS p
SET
  company_name = e.company_name,
  website = e.website,
  company_size = COALESCE(e.company_size, p.company_size),
  buyer_name = e.buyer_name,
  buyer_role = e.buyer_role,
  buyer_linkedin = COALESCE(e.buyer_linkedin, p.buyer_linkedin),
  source = 'MCP Registry import + public-source verification',
  trigger_signal = e.trigger_signal,
  agent_use_case = e.agent_use_case,
  tool_access = e.tool_access,
  evidence_json = (COALESCE(NULLIF(p.evidence_json, ''), '[]')::jsonb || e.evidence_json::jsonb)::text,
  score = e.score,
  score_reasons_json = e.score_reasons_json,
  stage = 'research',
  estimated_value_pence = 0,
  next_action = 'Owner review: confirm commercial fit and approve personalised outreach.',
  notes = concat_ws(E'\n\n', NULLIF(p.notes, ''), e.note),
  updated_at = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM enrichments AS e
WHERE p.notes LIKE '%[ARL-IMPORT:' || e.record_id || ']%'
  AND p.source = 'MCP Registry import'
  AND p.stage = 'research'
  AND p.notes NOT LIKE '%[ARL-ENRICHMENT:2026-08-10]%';

-- Repair one malformed display value from the import without inferring a legal company.
UPDATE sales_prospects
SET
  company_name = 'Dinglebear MCP Suite (publisher ai.dinglebear)',
  notes = concat_ws(
    E'\n\n',
    NULLIF(notes, ''),
    '[ARL-DATA-CORRECTION:2026-08-10] Replaced malformed display value [object Object] using imported publisher namespace ai.dinglebear. No legal company identity or buyer identity is inferred.'
  ),
  updated_at = to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE notes LIKE '%[ARL-IMPORT:ARL-P-000143]%'
  AND company_name = '[object Object]'
  AND source = 'MCP Registry import';
