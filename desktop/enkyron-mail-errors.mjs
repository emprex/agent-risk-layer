// Safe, bounded mail diagnostics for local UI. Never relay raw provider
// responses, stack traces, keys, SQL text or secret-bearing paths.
export function explainMailOperationError(error){
  const message=String(error?.message||'');
  const match=/^Resend inbox read failed \(HTTP (\d{3})\)$/.exec(message);
  if(match){
    const status=Number(match[1]);
    if(status===401)return 'Resend Inbox: HTTP 401. The configured API key may lack full-access read permission.';
    if(status===403)return 'Resend Inbox: HTTP 403. Check API key permissions and domain restrictions.';
    if(status===404)return 'Resend Inbox: HTTP 404. Check the configured Resend Inbox identifier.';
    if(status===422)return 'Resend Inbox: HTTP 422. The provider rejected the folder query.';
    if(status===429)return 'Resend Inbox: HTTP 429. Rate limit; retry later.';
    if(status>=500)return 'Resend Inbox: HTTP '+status+'. Provider temporarily unavailable.';
    return 'Resend Inbox: HTTP '+status+'. Folder read failed.';
  }
  if(/^Resend connection unavailable$/.test(message))
    return 'Resend Inbox: network, timeout or access-key connection failure.';
  if(/^Resend returned (an invalid list|invalid JSON)$/.test(message))
    return 'Resend Inbox: unexpected response format. No messages changed.';
  if(/^Mailbox access denied$|^CRM mailbox permission unavailable$/.test(message))
    return 'Mail account: the current local operator lacks read access.';
  if(/^Unknown mailbox$|^Invalid inbox folder$/.test(message))
    return 'Mail folder: invalid account or folder selection.';
  if(error?.code==='25006')
    return 'Mail database: attempted a write on a read-only PostgreSQL connection.';
  if(error?.code==='42P01'||error?.code==='42703')
    return 'Mail database: required table or column is missing; check migrations.';
  if(error?.code==='42501')
    return 'Mail database: insufficient PostgreSQL permissions.';
  return 'Mail operation failed. Check the local Mail configuration and database.';
}
