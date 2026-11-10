// Only present fixed SQLSTATE descriptions; never expose SQL, values, UTRs, addresses or DB names.
const SQLSTATE_MESSAGES=Object.freeze({
  '42501':'Local database role lacks permission to write the issuing-company profile.',
  '42P01':'Required profile table is missing; check migration 076.',
  '42703':'Profile database columns are out of date; check migration 077.',
  '23505':'The profile revision already exists; reopen the latest record.',
  '23514':'Profile data violates a database constraint; review the fields.',
  '55P03':'The database was busy; retry after the other operation finishes.',
  '57014':'The database operation timed out.',
  '25006':'The current database connection is read-only.',
  '08006':'The local PostgreSQL connection was interrupted.'
});
export function explainLocalError(error){
  const message=String(error?.message??'');
  if(/^ENKYRON [A-Za-z0-9 ,;:.()/'-]+$/.test(message))
    return message.slice(0,250);
  const code=typeof error?.code==='string'?error.code:'';
  if(/^[0-9A-Z]{5}$/.test(code)){
    return (SQLSTATE_MESSAGES[code]??'PostgreSQL refused the operation.')+
      ' (SQLSTATE '+code+'). No data was saved.';
  }
  return 'Local PostgreSQL operation failed. Check database, permissions and migrations.';
}
