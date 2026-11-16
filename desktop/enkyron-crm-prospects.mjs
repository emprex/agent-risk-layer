// ENKYRON: read-only paginated view of historical sales candidates.
// A visible 100-row page is not a restriction on the 344 stored prospects.
// Search / total / rows derive from ONE PostgreSQL statement snapshot.
import { boundedSearch } from './enkyron-contract.mjs';

const PAGE_SIZE = 100;
export function validateProspectPage(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('CRM invalid prospect page request');
  }
  const search = boundedSearch(request.search);
  const page = request.page;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw new Error('CRM page must be an integer between 1 and 10000');
  }
  return { search, page, offset: (page - 1) * PAGE_SIZE };
}

export async function listSalesProspectsPage(pool, request, actor) {
  const { search, page, offset } = validateProspectPage(request);
  if (typeof actor !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid operator');
  const workspace = 'local:' + actor;
  try {
    const result = await pool.query(
      `WITH filtered AS (
         SELECT id, company_name, website, buyer_name, buyer_role, buyer_email,
                stage, source, updated_at
         FROM sales_prospects
         WHERE ($1 = ''
           OR POSITION(LOWER($1) IN LOWER(company_name)) > 0
           OR POSITION(LOWER($1) IN LOWER(COALESCE(buyer_name,''))) > 0
           OR POSITION(LOWER($1) IN LOWER(COALESCE(website,''))) > 0)
           AND NOT EXISTS (
             SELECT 1 FROM enkyron_crm_prospect_links linked
             WHERE linked.workspace_key=$3
               AND linked.prospect_id=sales_prospects.id
           )
       ),
       selected AS (
         SELECT * FROM filtered ORDER BY updated_at DESC, id LIMIT 100 OFFSET $2
       )
       SELECT
         (SELECT COUNT(*)::integer FROM filtered) AS total,
         COALESCE(
           (SELECT json_agg(selected ORDER BY updated_at DESC, id) FROM selected),
           '[]'::json
         ) AS items`,
      [search, offset, workspace]
    );
    const record = result.rows[0];
    const total = Number(record?.total ?? 0);
    const items = record?.items ?? [];
    if (!Number.isSafeInteger(total) || total < 0 || !Array.isArray(items) || items.length > PAGE_SIZE) {
      throw new Error('CRM invalid paginated prospect response');
    }
    return {
      available: true,
      kind: 'unverified_sales_prospects',
      items, total, page, page_size: PAGE_SIZE,
      more: page * PAGE_SIZE < total,
      notice: 'Unlinked research candidates only; linked sources are retained for audit.'
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return {
        available: false, kind: 'unverified_sales_prospects',
        items: [], total: 0, page, page_size: PAGE_SIZE, more: false,
        notice: 'Legacy sales_prospects table not installed in this local database.'
      };
    }
    throw error;
  }
}

// Compatibility for callers of the original first-page discovery interface.
export function listSalesProspects(pool, search, actor) {
  return listSalesProspectsPage(pool, { search, page: 1 }, actor);
}
