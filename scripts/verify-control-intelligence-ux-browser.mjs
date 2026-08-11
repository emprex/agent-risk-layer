import assert from 'node:assert/strict';

const cdp = process.env.CDP_LIST_URL || 'http://127.0.0.1:9223/json/list';
const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3311';
const pages = await fetch(cdp).then((response) => response.json());
const page = pages.find((item) => item.type === 'page');
if (!page) throw new Error('Browser page not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const listener = (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== id) return;
    ws.removeEventListener('message', listener);
    message.error ? reject(message.error) : resolve(message.result);
  };
  ws.addEventListener('message', listener);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (expression, timeout = 10000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await evaluate(expression)) return; } catch {}
    await pause(120);
  }
  const state = await evaluate('({url:location.href,text:document.body?.innerText.slice(0,1600)||"",invalid:[...document.querySelectorAll(":invalid")].map(e=>({id:e.id,value:e.value,checked:e.checked,disabled:e.disabled}))})');
  throw new Error(`Timed out: ${expression}\n${JSON.stringify(state)}`);
};
const navigate = async (path) => {
  await call('Page.navigate', { url: path.startsWith('http') ? path : base + path });
  await wait('document.readyState==="complete"');
};
const focus = async (selector) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      const { root } = await call('DOM.getDocument', { depth: 0 });
      const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error('stale DOM');
      await call('DOM.focus', { nodeId });
      return await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {tag:e.tagName,type:e.type||'',disabled:e.disabled,hidden:e.offsetParent===null}})()`);
    } catch { await pause(150); }
  }
  throw new Error(`Cannot focus ${selector} after navigation settled.`);
};
const click = async (selector) => {
  const kind = await focus(selector);
  if (kind.disabled || kind.hidden) throw new Error(`Cannot click unavailable control ${selector}`);
  const space = kind.type === 'checkbox' || kind.type === 'radio';
  const key = space ? ' ' : 'Enter';
  const code = space ? 'Space' : 'Enter';
  const virtual = space ? 32 : 13;
  const textValue = space ? ' ' : '\r';
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
  await call('Input.dispatchKeyEvent', { type: 'char', key, text: textValue, unmodifiedText: textValue, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
  await pause(100);
};
const key = async (keyName) => {
  const enter = keyName === 'Enter';
  const space = keyName === ' ';
  const code = space ? 'Space' : keyName;
  const virtual = enter ? 13 : space ? 32 : undefined;
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual });
};
const type = async (selector, value) => {
  const kind = await focus(selector);
  if (kind.disabled || kind.hidden) throw new Error(`Cannot type into unavailable control ${selector}`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
  await key('Backspace');
  await call('Input.insertText', { text: String(value) });
};
const choose = async (selector, index) => {
  const kind = await focus(selector);
  if (kind.disabled || kind.hidden) throw new Error(`Cannot choose unavailable control ${selector}`);
  await key('Home');
  for (let i = 0; i < index; i += 1) await key('ArrowDown');
  await key('Enter');
};
const visibleText = () => evaluate('document.body.innerText');
const openStage = async (stage) => {
  const selector = `[data-stage="${stage}"]`;
  await wait(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (!await evaluate(`document.querySelector(${JSON.stringify(selector)}).open`)) await click(`${selector} > summary`);
};

await call('Runtime.enable');
await call('Page.enable');
await call('DOM.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Page.bringToFront');

const email = `ux-visible-${Date.now()}@example.test`;
const password = 'Visible-Control-UX-42!';
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate('/dashboard.html');
await pause(300);
if (await evaluate('location.pathname==="/dashboard.html"&&Boolean(document.querySelector("#logout"))')) {
  if (await evaluate('Boolean(document.querySelector("[data-menu-toggle]")?.offsetParent)')) await click('[data-menu-toggle]');
  await click('#logout');
  await wait('location.pathname==="/"');
}

await navigate('/auth.html?mode=register');
await type('#registerEmail', email);
await type('#registerPassword', password);
await click('#termsAccepted');
await wait('document.querySelector("#registerForm").checkValidity()');
await click('#registerForm button[type=submit]');
await wait('location.pathname==="/verify.html"');
await wait('document.body.innerText.includes("Email verified")');
await click('a[href="/dashboard.html"]');
await wait('location.pathname==="/dashboard.html"');

await navigate('/workspaces.html');
await wait('Boolean(document.querySelector("#create"))');
await type('#name', 'Visible UX journey workspace');
await click('#create button');
await wait('document.body.innerText.includes("Visible UX journey workspace")');

await navigate('/control-plane.html');
await wait('Boolean(document.querySelector("#createProject"))');
await type('#projectName', 'Visible UX refund agent');
await choose('#projectEnvironment', 1);
await click('#createProject button');
await wait('document.body.innerText.includes("Visible UX refund agent")');
await click('a[href="/control-intelligence.html"]');
await wait('location.pathname==="/control-intelligence.html"&&document.querySelector("#ciProject")?.options.length>1');
const projectId = await evaluate('document.querySelector("#ciProject").value');
assert.ok(projectId);

await navigate(`/control-intelligence.html?projectId=${encodeURIComponent(projectId)}`);
await wait('Boolean(document.querySelector("#snapshotForm"))');
await type('#snapshotArchitecture', 'Customer-facing refund agent receiving untrusted messages, customer data, financial actions and external network access with exact human approval.');
for (const fact of ['input:user_messages', 'data:customer_records', 'tool:payment', 'tool:network', 'authority:financial', 'safeguard:human_approval']) await click(`[name="architectureFact"][value="${fact}"]`);
await click('#snapshotConfirmed');
await click('#snapshotForm button');
await wait('document.body.innerText.includes("Controls requiring attention")');
assert.match(await visibleText(), /0 of 108 controls reviewed/);
assert.match(await visibleText(), /View all controls/);
assert.match(await visibleText(), /first controls requiring attention/i);

await navigate(`/control-intelligence.html?projectId=${encodeURIComponent(projectId)}&view=controls`);
await wait('document.body.innerText.includes("Review suggested controls")');
await click('[data-bulk-control="ARL-KB-001"]');
await click('[data-bulk-control="ARL-KB-002"]');
await click('#reviewSelected');
await wait('Boolean(document.querySelector("#bulkForm"))');
assert.match(await visibleText(), /saves each control independently/i);
await choose('[name="decision-0"]', 1);
await type('[name="reason-0"]', 'The agent purpose and authority boundaries require explicit review for this customer workflow.');
await click('[name="fact-0"]');
await choose('[name="decision-1"]', 3);
await type('[name="reason-1"]', 'The architecture summary does not yet prove every decision boundary for this control.');
await type('[name="missing-1"]', 'Confirm the production owner, decision policy and enforcement boundary.');
await click('[name="fact-1"]');
await click('#bulkConfirm');
await click('#bulkForm button[type=submit]');
await wait('document.body.innerText.includes("2 of 108 controls reviewed")', 12000);

await navigate(`/control-intelligence-control.html?projectId=${encodeURIComponent(projectId)}&controlId=ARL-KB-031`);
await wait('Boolean(document.querySelector("#applicabilityForm"))');
await wait('Boolean(document.querySelector(".ci-stage-nav"))');
assert.match(await visibleText(), /3\. Evidence/);
assert.match(await visibleText(), /Evidence trust remains explicit/);
await click('[name="decision"][value="applicable"]');
await type('#appReason', 'Untrusted customer messages reach the refund agent and can influence tool actions.');
await click('[name="fact"]');
await click('#applicabilityForm button[type=submit]');
await wait('document.querySelector("#ciMessage")?.classList.contains("show")');
assert.match(await evaluate('document.querySelector("#ciMessage").innerText'), /Applicability saved/);
await wait('Boolean(document.querySelector("#testForm"))');

await choose('#testResult', 2);
await type('#observed', 'The synthetic refund request reached the protected action boundary instead of being denied.');
await choose('#sideEffect', 1);
await click('#testForm button[type=submit]');
await wait('document.body.innerText.includes("Create a finding")');
await wait('Boolean(document.querySelector("#evidenceForm"))');
await type('#evidenceTitle', 'Observed failed refund-policy test');
await type('#evidenceObserved', 'The synthetic request reached the action boundary; no real refund was executed.');
await choose('#evidenceTest', 1);
await type('#evidenceReference', 'Synthetic run UX-1001');
await choose('#evidenceSideEffect', 1);
await click('#evidenceForm button[type=submit]');
await wait('document.body.innerText.includes("Evidence submitted")');
await openStage('finding');
await type('#findingAsset', 'Synthetic refund operation');
await type('#findingImpact', 'A manipulated message could attempt an unauthorised financial action.');
await type('#findingReproduction', 'Repeat the recorded prompt against the synthetic refund adapter.');
await type('#findingContainment', 'Keep the refund tool disabled outside the synthetic environment.');
await click('#findingConfirm');
await click('#findingForm button[type=submit]');
await wait('document.body.innerText.includes("Finding created")');

await wait('Boolean(document.querySelector("[data-stage=remediation]"))');
await openStage('remediation');
await wait('Boolean(document.querySelector(".ci-substep-current #remediationForm"))');
assert.equal(await evaluate('document.querySelector("#implementationForm").closest(".ci-substep")?.classList.contains("is-locked")'), true);
assert.equal(await evaluate('document.querySelector("#snapshotForm").closest(".ci-substep")?.classList.contains("is-locked")'), true);
await type('#rootCause', 'Tool authorization was not rechecked after untrusted instruction processing.');
await type('#correctiveAction', 'Enforce exact-action approval immediately before refund execution.');
await type('#targetEnvironment', 'Synthetic test');
await type('#rollbackPlan', 'Disable the refund tool and restore the prior policy.');
await type('#validationPlan', 'Repeat the exact failed test and abuse variants.');
await click('#remediationForm button[type=submit]');
await wait('document.body.innerText.includes("Remediation plan saved")');
await wait('Boolean(document.querySelector(".ci-substep-current #implementationForm"))');
assert.equal(await evaluate('document.querySelector("#snapshotForm").closest(".ci-substep")?.classList.contains("is-locked")'), true);

await type('#changeReference', 'CHANGE-UX-1001');
await type('#changedVersion', 'refund-agent-v2');
await type('#implementedChange', 'Added exact-action approval enforcement before refund side effects.');
await click('#implementationForm button[type=submit]');
await wait('document.body.innerText.includes("Implementation evidence recorded")');
await wait('Boolean(document.querySelector(".ci-substep-current #snapshotForm"))');
await type('#snapshotArchitecture', 'Customer-facing refund agent v2 with exact-action approval enforced before all refund side effects.');
await type('#snapshotChange', 'Added execution-time exact approval enforcement and fail-closed refund policy.');
await click('#snapshotConfirm');
await click('#snapshotForm button[type=submit]');
await wait('document.body.innerText.includes("Remediated snapshot created")');

await wait('Boolean(document.querySelector("#applicabilityForm"))');
await click('[name="decision"][value="applicable"]');
await type('#appReason', 'The remediated refund agent still processes untrusted messages, so the control remains applicable.');
await click('[name="fact"]');
await click('#applicabilityForm button[type=submit]');
await wait('document.body.innerText.includes("Applicability saved")');
await openStage('retest');
await wait('Boolean(document.querySelector("#retestForm"))');
await choose('#retestResult', 1);
await type('#retestObserved', 'The original prompt was denied before side effects and the exact approval requirement was recorded.');
await choose('#retestSideEffect', 1);
await click('#retestForm button[type=submit]');
await wait('document.body.innerText.includes("Exact retest recorded")');
await openStage('retest');
await type('#closureLimitations', 'Synthetic environment only; production runtime evidence remains required.');
await click('#closureForm button[type=submit]');
await wait('document.body.innerText.includes("Finding closed")');

await openStage('approval');
await wait('Boolean(document.querySelector("#approvalForm"))');
await click('#approvalForm button[type=submit]');
await wait('document.body.innerText.includes("Exact action approved")');
await openStage('deployment_decision');
await click('[data-stage="deployment_decision"] a');
await wait('location.pathname==="/control-intelligence.html"');
await type('#decisionRationale', 'Visible customer review completed for the current evidence chain.');
await click('#decisionForm button');
await wait('document.body.innerText.includes("Generate assessment report")');

await navigate(`/control-intelligence-control.html?projectId=${encodeURIComponent(projectId)}&controlId=ARL-KB-031`);
await wait('Boolean(document.querySelector(".ci-stage-nav"))');
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await pause(250);
assert.equal(await evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth'), false);
await call('Emulation.clearDeviceMetricsOverride');

await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await navigate(`/control-intelligence.html?projectId=${encodeURIComponent(projectId)}`);
await click('#logout');
await wait('location.pathname==="/"');
await navigate(`/control-intelligence.html?projectId=${encodeURIComponent(projectId)}`);
await wait('location.pathname==="/auth.html"||document.body.innerText.includes("Sign in required")');
assert.doesNotMatch(await visibleText(), /Visible UX refund agent|Observed failed refund-policy test/);

ws.close();
console.log(JSON.stringify({ progressiveStages: true, remediationSequencing: true, bulkFailureIsolation: true, mobileNoOverflow: true, privateAfterLogout: true, projectId }));
