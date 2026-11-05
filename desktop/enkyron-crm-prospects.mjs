// ENKYRON CRM discovery — legacy sales candidates are NOT verified customer accounts.
// Read-only reuse of migration 004. No automatic promotion, merge, outreach or assessment.
import { boundedSearch } from './enkyron-contract.mjs';

export async function listSalesProspects(pool, search) {
  const query = boundedSearch(search);
  try {
    const result = await pool.query(
      `SELECT id,company_name,website,buyer_name,buyer_role,buyer_email,
              stage,source,updated_at
       FROM sales_prospects
       WHERE ($1 = ''
          OR POSITION(LOWER($1) IN LOWER(company_name)) > 0
          OR POSITION(LOWER($1) IN LOWER(COALESCE(buyer_name,''))) > 0
          OR POSITION(LOWER($1) IN LOWER(COALESCE(website,''))) > 0)
       ORDER BY updated_at DESC,id LIMIT 101`,
      [query]
    );
    return {
      available: true,
      kind: 'unverified_sales_prospects',
      items: result.rows.slice(0, 100),
      more: result.rows.length > 100,
      notice: 'Legacy commercial candidates, not verified client or contact records.'
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return {
        available: false, kind: 'unverified_sales_prospects',
        items: [], more: false,
        notice: 'Legacy sales_prospects table not installed in this local database.'
      };
    }
    throw error;
  }
}
