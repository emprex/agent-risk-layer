// Only the static site's explicitly configured Formspree endpoint may receive
// public enquiries. This client is not an ARL assessment or security authority.
const form = document.querySelector('#requestForm');
const status = document.querySelector('#formStatus');
let sending = false;

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending || !form.reportValidity()) return;

  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const company = String(data.get('company') || '').trim();
  const systemName = String(data.get('systemName') || '').trim();
  data.set('_subject', `Assessment request — ${company || systemName || 'AgentRiskLayer'}`);

  sending = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Sending…';
  }
  status.textContent = 'Sending assessment request…';

  try {
    const endpoint = new URL(form.action);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'formspree.io' ||
        !/^\/f\/[A-Za-z0-9]+$/.test(endpoint.pathname) ||
        endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
      throw new Error('Unexpected request endpoint');
    }
    const response = await fetch(endpoint.href, {
      method: 'POST',
      body: data,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Request not accepted by form service');

    form.reset();
    status.textContent =
      'Request accepted by the form service. AgentRiskLayer will review the scope and reply by email.';
  } catch {
    status.textContent =
      'The request could not be confirmed. Please try again or email support@agentrisklayer.com.';
  } finally {
    sending = false;
    if (button) {
      button.disabled = false;
      button.textContent = 'Send assessment request';
    }
  }
});
