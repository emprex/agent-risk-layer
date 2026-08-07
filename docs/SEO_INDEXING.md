# AgentRiskLayer SEO and indexing controls

## Objective

Make the public AgentRiskLayer product discoverable by search engines without exposing authenticated, transactional or customer-specific application surfaces to search results.

SEO is separated into four concerns:

1. **Crawlability** — search engines can fetch the public pages and discovery files.
2. **Indexing** — public pages are eligible for an index while private/app pages carry `noindex` signals.
3. **Canonicalisation** — tracking parameters and duplicate extensionless URLs point to one preferred public URL.
4. **Search appearance** — titles, descriptions, Open Graph/Twitter metadata and bounded structured data describe the product accurately.

None of these controls guarantees ranking or rich-result display. Search engines make their own crawl, indexing, canonical and ranking decisions.

## Existing server-side discovery

`server.js` already serves:

- `/robots.txt`
- `/sitemap.xml`
- five focused `/checks/<slug>` landing pages
- proper HTTP 404 responses for unknown static paths

The sitemap uses the configured production base URL and therefore emits absolute URLs when `BASE_URL=https://agentrisklayer.com` is configured.

## Shared document SEO layer

`public/seo.js` is loaded by `public/site-shell.js` and applies consistent metadata to pages that use the shared shell.

### Canonical URLs

- `https://agentrisklayer.com/` is canonical for `/` and `/index.html`.
- Extensionless static routes canonicalise to their `.html` route because that is the URL form used by the current internal links and sitemap.
- `/checks/<slug>` remains extensionless.
- Query strings and fragments are never copied into canonical URLs, so UTM campaign parameters do not create competing canonical pages.

### Index controls

Authenticated, account, customer-result and transaction pages are marked:

`noindex,nofollow,noarchive,nosnippet`

The free assessment and the controlled red-team explainer remain eligible for indexing because they are current public acquisition/discovery surfaces.

### Social previews

Public pages receive:

- `og:site_name`
- `og:type`
- `og:url`
- `og:title`
- `og:description` when the page has a description
- a 1200×630 Open Graph image
- matching Twitter/X summary-card metadata

### Structured data

The homepage adds a bounded JSON-LD graph for:

- `WebSite`
- `Organization`
- `SoftwareApplication` with `SecurityApplication` category

Only facts visibly supported by the product are represented. No ratings, customers, certifications or guarantees are invented. The Community offer is represented at £0 because that offer is publicly shown in pricing.

## Search assets

- `/agentrisklayer-logo-512.png` — 512×512 crawlable organization/logo asset.
- `/agentrisklayer-social-1200x630.png` — 1200×630 search/social preview asset.

## Validation

`tests/seo.test.js` protects the discovery routes, sitemap coverage, canonicalisation rules, private-page indexing policy, structured-data claim boundaries and image assets.

## Owner action after production verification

After a deployment is verified live:

1. Add or verify the `agentrisklayer.com` domain property in Google Search Console.
2. Submit `https://agentrisklayer.com/sitemap.xml` in the Sitemaps report.
3. Inspect `https://agentrisklayer.com/` with URL Inspection, run the live test and request indexing if fetch is successful.
4. Repeat URL Inspection for the highest-value landing pages (`/assessment.html`, `/runtime.html`, `/trust.html`, `/checks/mcp-server-risk-assessment`).
5. Monitor Page Indexing and Search Performance rather than assuming submission equals indexing.
6. Optionally import the verified Search Console property into Bing Webmaster Tools and submit the same sitemap there.

Do not use robots.txt as a substitute for canonicalisation, and do not put customer-specific or authenticated URLs into the public sitemap.
