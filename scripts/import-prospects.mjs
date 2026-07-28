import fs from 'node:fs';
import path from 'node:path';

function usage(message = '') {
  if (message) console.error(`ERROR: ${message}`);
  console.error(`Usage:
  npm run prospects:import -- --file /absolute/file.csv --dry-run
  npm run prospects:import -- --file /absolute/file.csv --apply --owner-email owner@example.com

Options:
  --file PATH          Cleaned 38-column CSV (required)
  --dry-run            Validate and report without opening the database
  --apply              Write research candidates to the configured database
  --owner-email EMAIL  Resolve created_by from the users table
  --user-id ID         Use an explicit existing user ID instead
  --limit N            Process at most N eligible rows
  --include-duplicates Include rows flagged as probable duplicates
  --report PATH        Write JSON report (default: import-report-<timestamp>.json)
`);
  process.exitCode = 1;
}

function argsOf(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value === '--dry-run' || value === '--apply' || value === '--include-duplicates') {
      result[value.slice(2)] = true;
    } else if (value.startsWith('--')) {
      result[value.slice(2)] = values[++i];
    }
  }
  return result;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function compact(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function bounded(value, max) {
  return String(value || '').trim().slice(0, max);
}

const args = argsOf(process.argv.slice(2));
if (!args.file) {
  usage('--file is required.');
} else if (Boolean(args['dry-run']) === Boolean(args.apply)) {
  usage('Choose exactly one of --dry-run or --apply.');
} else if (args.apply && !args['owner-email'] && !args['user-id']) {
  usage('--apply requires --owner-email or --user-id.');
} else {
  const file = path.resolve(args.file);
  if (!fs.existsSync(file)) {
    usage(`File not found: ${file}`);
  } else {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const matrix = parseCsv(raw);
    const headers = matrix.shift() || [];
    const required = [
      'record_id', 'publisher_namespace', 'entity_label', 'website', 'repository',
      'published_contact', 'mcp_product_names', 'product_descriptions',
      'last_updated', 'sensitive_evidence', 'evidence_url',
      'qualification_status', 'priority_tier', 'review_status', 'import_status',
      'data_status', 'validation_status', 'duplicate_status', 'needs_review',
      'verification_source', 'verification_date', 'cleaning_notes',
    ];
    const missing = required.filter((header) => !headers.includes(header));
    if (missing.length) throw new Error(`Missing required headers: ${missing.join(', ')}`);

    const records = matrix
      .filter((values) => values.some((value) => value.trim()))
      .map((values, index) => {
        if (values.length !== headers.length) {
          throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
        }
        return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
      });

    const recordIds = new Set();
    const repeatedRecordIds = [];
    for (const record of records) {
      if (!record.record_id || recordIds.has(record.record_id)) repeatedRecordIds.push(record.record_id || '(blank)');
      recordIds.add(record.record_id);
    }
    if (repeatedRecordIds.length) throw new Error(`Duplicate/blank record_id values: ${repeatedRecordIds.slice(0, 10).join(', ')}`);

    const probableDuplicate = (record) => /probable duplicate/i.test(record.duplicate_status);
    let eligible = records.filter((record) => args['include-duplicates'] || !probableDuplicate(record));
    const requestedLimit = Number(args.limit || 0);
    if (requestedLimit > 0) eligible = eligible.slice(0, Math.floor(requestedLimit));

    const report = {
      sourceFile: file,
      generatedAt: new Date().toISOString(),
      mode: args.apply ? 'apply' : 'dry-run',
      sourceRows: records.length,
      eligibleRows: eligible.length,
      probableDuplicatesExcluded: args['include-duplicates'] ? 0 : records.filter(probableDuplicate).length,
      needsReviewRows: eligible.filter((record) => /^true$/i.test(record.needs_review)).length,
      organizationIdentified: eligible.filter((record) => record.qualification_status === 'Organization-identified candidate').length,
      publisherCandidates: eligible.filter((record) => record.qualification_status === 'Publisher candidate').length,
      created: 0,
      alreadyImported: 0,
      failed: 0,
      errors: [],
    };

    if (args['dry-run']) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const [{ db }, { createProspect }] = await Promise.all([
        import('../src/db.js'),
        import('../src/sales-agent.js'),
      ]);

      let userId = bounded(args['user-id'], 200);
      if (!userId) {
        const owner = await db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) LIMIT 1').get(args['owner-email']);
        if (!owner?.id) throw new Error(`No user found for owner email: ${args['owner-email']}`);
        userId = owner.id;
      } else {
        const owner = await db.prepare('SELECT id FROM users WHERE id=? LIMIT 1').get(userId);
        if (!owner?.id) throw new Error(`No user found for ID: ${userId}`);
      }

      for (let index = 0; index < eligible.length; index += 1) {
        const record = eligible[index];
        const marker = `[ARL-IMPORT:${record.record_id}]`;
        try {
          const existing = await db.prepare('SELECT id FROM sales_prospects WHERE notes LIKE ? LIMIT 1').get(`%${marker}%`);
          if (existing?.id) {
            report.alreadyImported += 1;
            continue;
          }

          const evidence = compact([
            record.evidence_url,
            record.verification_source,
            record.repository,
            record.contact_evidence,
          ]).slice(0, 20);

          const notes = bounded([
            marker,
            `Research candidate; review required: ${record.needs_review}.`,
            `Qualification: ${record.qualification_status}. Priority: ${record.priority_tier}.`,
            `Review status: ${record.review_status}. Validation: ${record.validation_status}.`,
            `Data status: ${record.data_status}.`,
            `Published contact (unverified): ${record.published_contact || 'none'}.`,
            `Verification date: ${record.verification_date}.`,
            record.cleaning_notes,
          ].filter(Boolean).join('\n'), 4000);

          const prospect = await createProspect(userId, {
            companyName: bounded(record.entity_label || record.publisher_namespace, 200),
            website: bounded(record.website, 500) || null,
            source: 'MCP Registry import',
            triggerSignal: bounded(
              `Active MCP publication${record.last_updated ? `; last registry update ${record.last_updated}` : ''}.`,
              1000,
            ),
            agentUseCase: bounded(record.product_descriptions || record.mcp_product_names, 2000),
            toolAccess: record.sensitive_evidence === 'Yes'
              ? bounded(`Registry description contains sensitive-action evidence: ${record.sensitive_action_keyword_evidence || 'yes'}.`, 2000)
              : null,
            evidence,
            estimatedValuePence: 1,
            nextAction: 'Verify commercial identity and decision-maker before outreach.',
            notes,
          });

          // Research candidates are not pipeline opportunities until reviewed.
          await db.prepare('UPDATE sales_prospects SET estimated_value_pence=0 WHERE id=?').run(prospect.id);
          report.created += 1;
        } catch (error) {
          report.failed += 1;
          if (report.errors.length < 100) report.errors.push({ recordId: record.record_id, message: error.message });
        }
        if ((index + 1) % 250 === 0) {
          console.log(`Processed ${index + 1}/${eligible.length}; created ${report.created}; existing ${report.alreadyImported}; failed ${report.failed}`);
        }
      }

      const output = path.resolve(args.report || `import-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify(report, null, 2));
      console.log(`Report: ${output}`);
      if (report.failed) process.exitCode = 2;
    }
  }
}
