# Site-wide social previews

`src/social-metadata.js` adds social metadata to static and generated HTML responses in `server.js`. Crawlers receive it without executing JavaScript. Page authors only need a `<title>` and `<meta name="description">`; all pages inherit the shared PNG. Research URLs under `/research/` use `article`; other pages use `website`. Query strings are excluded from sharing URLs.

The default asset is `public/agentrisklayer-social-v2-1200x630.png` (1200×630). Its editable source is `design/social-card.html`. Render it with Chrome at 1200×630, device scale factor 1, using `--headless=new --hide-scrollbars --screenshot=... --window-size=1200,630 --force-device-scale-factor=1`. There is no image build or manual image task for future articles. If the global design changes, publish a new versioned filename and update the helper constant.

Optional page-specific overrides use `og:title`, `og:description`, or `og:image` in the source head. An image override should include `og:image:width`, `og:image:height` and `og:image:alt`; use a publicly accessible PNG or JPEG (JPEG paths end in `.jpg` or `.jpeg`). Relative image paths resolve to the production HTTPS origin; insecure or invalid URLs fall back to the shared image. The generator replaces existing OG/Twitter tags with a single consistent set and retains article publication metadata.

Run `node --test tests/social-metadata.test.js` for all static pages, future article/override cases and real HTTP crawler/PNG checks. Run `node scripts/verify-social-preview.mjs` after deployment to verify the production HTML and asset.
