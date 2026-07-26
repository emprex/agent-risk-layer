export function toCef(event = {}) {
    const severity = Math.max(0, Math.min(10, eventSeverity(event)));
    return `CEF:0|AgentRiskLayer|Runtime|6.0.0|${safe(event.ruleId || event.decision || 'event')}|${safe(event.title || 'AI security decision')}|${severity}|requestId=${safe(event.requestId || '-')} decision=${safe(event.decision || '-')} schema=${safe(event.schema || '-')}`;
}
export function toOcsf(event = {}) {
    return {
        class_uid: 2004,
        class_name: 'Detection Finding',
        category_uid: 2,
        severity_id: eventSeverity(event),
        time: Date.parse(event.timestamp || new Date().toISOString()),
        metadata: { product: { name: 'AgentRiskLayer', version: '6.0.0' }, version: '1.1.0' },
        finding_info: { title: event.title || 'AI security decision', uid: event.requestId || 'unknown' },
        status: event.decision === 'deny' || event.decision === 'quarantine' ? 'New' : 'Resolved',
        unmapped: { schema: event.schema, decision: event.decision },
    };
}
function safe(value) { return String(value).replace(/[|=\\\r\n]/g, '_').slice(0, 240); }
function eventSeverity(event) {
    const values = [...(event.findings || []), ...(event.reasons || [])].map((f) => f.severity);
    if (values.includes('critical'))
        return 10;
    if (values.includes('high'))
        return 8;
    if (values.includes('medium'))
        return 5;
    return event.decision === 'deny' || event.decision === 'quarantine' ? 7 : 1;
}
