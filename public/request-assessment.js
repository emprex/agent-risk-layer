const form = document.querySelector('#assessmentRequestForm');
const status = document.querySelector('#requestStatus');
const submitButton = form?.querySelector('button[type="submit"]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());

  submitButton.disabled = true;
  submitButton.textContent = 'Sending…';
  status.textContent = 'Sending your assessment request securely…';

  try {
    const response = await fetch('/api/assessment-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'We could not send your request.');

    form.reset();
    status.textContent = 'Request received. We will review your scope and reply by email.';
    submitButton.textContent = 'Request sent';
  } catch (error) {
    status.textContent = error.message || 'We could not send your request. Please try again shortly.';
    submitButton.disabled = false;
    submitButton.textContent = 'Submit request';
  }
});
