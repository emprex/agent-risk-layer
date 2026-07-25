# Upgrade the live service to AgentRiskLayer 3.0

This release retains the existing Stripe, Resend, account, assessment, purchase and subscription configuration. It adds inspection tables automatically on startup.

## 1. Back up before deployment

Create a provider disk snapshot or copy the SQLite database from the persistent disk before replacing the application. Do not delete `/var/data/agent-risk-layer.sqlite`.

## 2. Replace the application files

From the local Git repository that currently deploys to Render:

```bash
cd ~/agent-risk-layer-launch-ready-v1.1.0
rm -rf /tmp/agent-risk-layer-v300
mkdir -p /tmp/agent-risk-layer-v300
unzip -q ~/Downloads/agent-risk-layer-v3.0.0.zip -d /tmp/agent-risk-layer-v300
cp -a /tmp/agent-risk-layer-v300/agent-risk-layer/. ./agent-risk-layer/
```

The included `render.yaml` already contains:

```yaml
rootDir: agent-risk-layer
```

## 3. Validate locally

```bash
cd agent-risk-layer
npm run validate
```

Expected results:

- 16 unit/configuration tests pass
- JavaScript syntax checks pass
- Full commercial and Inspector smoke test passes
- Sample Professional PDF is generated

## 4. Commit and deploy

```bash
cd ..
git add agent-risk-layer
git commit -m "Launch AgentRiskLayer 3.0 local security inspector"
git push origin main
```

Render should deploy automatically.

## 5. Verify production

```bash
curl https://agentrisklayer.com/api/health
```

Expected:

```json
{"ok":true,"version":"3.0.0","demoMode":false}
```

Then verify:

1. Existing account login and dashboard.
2. Existing Stripe Checkout still opens with live prices.
3. `/trust.html`, `/methodology.html` and `/sample-report.html` load.
4. The sample PDF downloads.
5. Create a non-production assessment and open `/inspector.html`.
6. Run the published scanner on a repository you own using the generated one-time command.
7. Confirm the scan appears in history and the Professional PDF includes technical evidence.

## Rollback

If startup fails, redeploy the prior Git commit. The v3 tables are additive and do not remove prior data. Retain the database backup until the upgrade and a full report workflow have been verified.
