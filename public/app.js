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
const resultsBoard = document.querySelector('#results');

const DEMO_DASHBOARD = {
  runs: [{ id: 1, source_url: 'https://www.shopify.com', status: 'demo', created_at: new Date().toISOString() }],
  companies: [
    { id: 1, name: 'Factori Commerce', website: 'https://factori.com', segment: 'ecommerce and retail brands', fit_score: 95 },
    { id: 2, name: 'Commerce.Asia', website: 'https://commerce.asia', segment: 'B2B SaaS and operations teams', fit_score: 92 },
    { id: 3, name: 'Commercedotcom', website: 'https://commercedc.com.my', segment: 'operations teams', fit_score: 89 }
  ],
  leads: [
    { id: 1, company_name: 'Factori Commerce', email: 'start@factori.com', phone: '', source_url: 'https://factori.com/contact-us', segment: 'ecommerce and retail brands', confidence: 95, status: 'new' },
    { id: 2, company_name: 'Factori Commerce', email: 'contact@factori.com', phone: '', source_url: 'https://factori.com/contact-us', segment: 'ecommerce and retail brands', confidence: 95, status: 'new' },
    { id: 3, company_name: 'B2B e-Supplier Portal', email: 'helpdesk@b2b.com.my', phone: '+603-76297388', source_url: 'https://eportal.b2b.com.my/esupplier/pages/main/contacts.do', segment: 'B2B SaaS and operations teams', confidence: 95, status: 'new' },
    { id: 4, company_name: 'Commerce.Asia', email: 'hello@commerce.asia', phone: '03-2022 5121', source_url: 'https://www.commerce.asia/about-us-commerce-asia', segment: 'ecommerce and retail brands', confidence: 92, status: 'new' },
    { id: 5, company_name: 'Commercedotcom', email: 'cpg@commercedc.com.my', phone: '+603-7985 7777', source_url: 'https://www.commercedc.com.my/contact-us/', segment: 'operations teams', confidence: 89, status: 'new' }
  ],
  campaigns: [
    {
      id: 1,
      name: 'Shopify audience scout',
      audience: 'ecommerce and retail brands, B2B SaaS and operations teams',
      offer: 'Scout identifies public buying signals and queues draft-first outreach.',
      next_run_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  ],
  drafts: [
    { id: 1, email: 'start@factori.com', company_name: 'Factori Commerce', subject: 'Factori Commerce + Scout workflow', body: 'Hi,\n\nI came across Factori Commerce while looking at ecommerce and retail brands.\n\nScout identifies public buying signals and queues draft-first outreach.\n\nWould it be useful to compare notes for 15 minutes next week?\n\nBest,\nScout', status: 'draft' },
    { id: 2, email: 'helpdesk@b2b.com.my', company_name: 'B2B e-Supplier Portal', subject: 'B2B e-Supplier Portal + weekly outbound', body: 'Hi,\n\nI came across B2B e-Supplier Portal while looking at B2B SaaS and operations teams.\n\nScout keeps outreach reviewable before anything sends.\n\nWould it be useful to compare notes for 15 minutes next week?\n\nBest,\nScout', status: 'draft' }
  ]
};

document.querySelectorAll('.choice-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.choice-card').forEach((item) => item.classList.remove('selected'));
    card.classList.add('selected');
  });
});

const resultsObserver = new IntersectionObserver(([entry]) => {
  document.body.classList.toggle('results-visible', entry.isIntersecting);
}, { threshold: 0.16 });

resultsObserver.observe(resultsBoard);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  statusEl.textContent = 'Scouting...';

  try {
    const response = await fetch('api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.value })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Run failed');
    statusEl.textContent = `Complete`;
    await refresh();
  } catch {
    statusEl.textContent = 'Demo mode';
    renderDashboard(DEMO_DASHBOARD);
  } finally {
    button.disabled = false;
    document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

tickButton.addEventListener('click', async () => {
  tickButton.disabled = true;
  try {
    await fetch('api/scheduler/tick', { method: 'POST' });
  } catch {
    statusEl.textContent = 'Demo mode';
  }
  await refresh();
  tickButton.disabled = false;
});

draftsList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-approve]');
  if (!button) return;
  button.disabled = true;
  try {
    await fetch(`api/drafts/${button.dataset.approve}/approve`, { method: 'POST' });
    await refresh();
  } catch {
    button.textContent = 'Approved';
    button.disabled = true;
  }
});

async function refresh() {
  try {
    const response = await fetch('api/dashboard');
    if (!response.ok) throw new Error('API unavailable');
    const data = await response.json();
    renderDashboard(data);
  } catch {
    statusEl.textContent = 'Demo mode';
    renderDashboard(DEMO_DASHBOARD);
  }
}

function renderDashboard(data) {
  metricLeads.textContent = data.leads.length;
  metricCompanies.textContent = data.companies.length;
  metricDrafts.textContent = data.drafts.length;

  leadsBody.innerHTML = data.leads.map((lead) => `
    <article class="lead-card">
      <div>
        <strong>${escapeHtml(lead.company_name || 'Unknown')}</strong>
        <a class="company-link" href="${escapeAttribute(lead.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(lead.source_url)}</a>
        <p class="lead-contact">${escapeHtml(lead.email || lead.phone || 'Contact page only')}</p>
        <p class="meta">${escapeHtml(lead.segment || 'Qualified prospect')}</p>
      </div>
      <span class="score">${lead.confidence}</span>
    </article>
  `).join('') || '<div class="empty-state">No leads yet.</div>';

  campaignsList.innerHTML = data.campaigns.map((campaign) => `
    <article class="campaign-card">
      <strong>${escapeHtml(campaign.name)}</strong>
      <p class="meta">${escapeHtml(campaign.audience)}</p>
      <p class="meta">Next run: ${formatDate(campaign.next_run_at)}</p>
    </article>
  `).join('') || '<div class="empty-state">No campaigns yet.</div>';

  draftsList.innerHTML = data.drafts.map((draft) => `
    <article class="draft-card">
      <strong>${escapeHtml(draft.subject)}</strong>
      <p class="meta">${escapeHtml(draft.email)} · ${escapeHtml(draft.company_name)} · <span class="pill ${escapeHtml(draft.status)}">${escapeHtml(draft.status)}</span></p>
      <pre>${escapeHtml(draft.body)}</pre>
      ${draft.status === 'draft' ? `<button data-approve="${draft.id}" type="button">Approve</button>` : ''}
    </article>
  `).join('') || '<div class="empty-state">No outreach drafts yet.</div>';
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
