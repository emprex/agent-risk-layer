const form = document.querySelector('#assessmentRequestForm');
const status = document.querySelector('#requestStatus');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const value = (key) => String(data.get(key) || '').trim();
  const subject = `AI Agent Security Assessment request — ${value('company') || value('systemName')}`;
  const body = [`Name: ${value('name')}`,`Company: ${value('company')}`,`Work email: ${value('email')}`,`Agent/system: ${value('systemName')}`,`Stage: ${value('stage')}`,`Repository: ${value('repository') || 'Not provided'}`,'','What the agent does:',value('useCase'),'','Systems, tools or data it can access:',value('access'),'','Assessment goal / why now:',value('concern'),'','I have not included passwords, API keys, access tokens, private keys or customer data.'].join('\n');
  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent('support@agentrisklayer.com')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  status.textContent = 'Opening Gmail with your assessment request. Review the message before sending.';
  window.location.href = gmailUrl;
});
