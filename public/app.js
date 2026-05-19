const form = document.querySelector('#run-form');
const input = document.querySelector('#url-input');
const statusEl = document.querySelector('#run-status');
const leadsBody = document.querySelector('#leads-body');
const campaignsList = document.querySelector('#campaigns-list');
const draftsList = document.querySelector('#drafts-list');
const tickButton = document.querySelector('#tick-button');
const metricLeads = document.querySelector('#metric-leads');
const metricCompanies = document.querySelector('#metric-companies');
const metricDrafts = document.querySelector('#metric-drafts');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  statusEl.textContent = 'Analyzing site and discovering prospects...';

  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Run failed');
    statusEl.textContent = `Complete: ${payload.profile.name}`;
    await refresh();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

tickButton.addEventListener('click', async () => {
  tickButton.disabled = true;
  await fetch('/api/scheduler/tick', { method: 'POST' });
  await refresh();
  tickButton.disabled = false;
});

draftsList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-approve]');
  if (!button) return;
  button.disabled = true;
  await fetch(`/api/drafts/${button.dataset.approve}/approve`, { method: 'POST' });
  await refresh();
});

async function refresh() {
  const response = await fetch('/api/dashboard');
  const data = await response.json();

  metricLeads.textContent = data.leads.length;
  metricCompanies.textContent = data.companies.length;
  metricDrafts.textContent = data.drafts.length;

  leadsBody.innerHTML = data.leads.map((lead) => `
    <tr>
      <td><strong>${escapeHtml(lead.company_name || 'Unknown')}</strong><a class="company-link" href="${escapeAttribute(lead.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(lead.source_url)}</a></td>
      <td>${escapeHtml(lead.email || lead.phone || 'Contact page only')}</td>
      <td>${escapeHtml(lead.segment || 'Qualified prospect')}</td>
      <td><span class="score">${lead.confidence}</span></td>
      <td><span class="pill">${escapeHtml(lead.status)}</span></td>
    </tr>
  `).join('') || emptyRow('No leads yet');

  campaignsList.innerHTML = data.campaigns.map((campaign) => `
    <article class="item">
      <strong>${escapeHtml(campaign.name)}</strong>
      <div class="meta">${escapeHtml(campaign.audience)}</div>
      <div class="meta">Offer: ${escapeHtml(campaign.offer)}</div>
      <div class="meta">Next run: ${formatDate(campaign.next_run_at)}</div>
    </article>
  `).join('') || '<div class="meta">No campaigns yet.</div>';

  draftsList.innerHTML = data.drafts.map((draft) => `
    <article class="draft">
      <strong>${escapeHtml(draft.subject)}</strong>
      <div class="meta">${escapeHtml(draft.email)} · ${escapeHtml(draft.company_name)} · <span class="pill ${escapeHtml(draft.status)}">${escapeHtml(draft.status)}</span></div>
      <pre>${escapeHtml(draft.body)}</pre>
      ${draft.status === 'draft' ? `<button data-approve="${draft.id}" type="button">Approve</button>` : ''}
    </article>
  `).join('') || '<div class="meta">No outreach drafts yet.</div>';
}

function emptyRow(message) {
  return `<tr><td colspan="5" class="meta">${message}</td></tr>`;
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  const url = String(value ?? '');
  return url.startsWith('http') ? escapeHtml(url) : '#';
}

refresh();
