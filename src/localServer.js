import express from 'express';
import { all, get, run } from './db.js';
import { runAgent } from './agent.js';
import { approveDraft, startScheduler, tick } from './scheduler.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

app.post('/api/runs', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const result = await runAgent(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard', (_req, res) => {
  res.json({
    runs: all('SELECT * FROM runs ORDER BY created_at DESC LIMIT 12'),
    companies: all('SELECT * FROM companies ORDER BY fit_score DESC, created_at DESC LIMIT 50'),
    leads: all(`
      SELECT leads.*, companies.name AS company_name, companies.segment
      FROM leads
      LEFT JOIN companies ON companies.id = leads.company_id
      ORDER BY leads.created_at DESC
      LIMIT 80
    `),
    campaigns: all('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 20'),
    drafts: all(`
      SELECT outreach_queue.*, leads.email, companies.name AS company_name
      FROM outreach_queue
      JOIN leads ON leads.id = outreach_queue.lead_id
      JOIN companies ON companies.id = leads.company_id
      ORDER BY outreach_queue.created_at DESC
      LIMIT 80
    `)
  });
});

app.post('/api/drafts/:id/approve', (req, res) => {
  const draft = approveDraft(Number(req.params.id));
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  res.json(draft);
});

app.post('/api/leads/:id/opt-out', (req, res) => {
  const lead = get('SELECT * FROM leads WHERE id = ?', [Number(req.params.id)]);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  run('UPDATE leads SET status = ? WHERE id = ?', ['opted_out', lead.id]);
  res.json({ ok: true });
});

app.post('/api/scheduler/tick', (_req, res) => {
  tick();
  res.json({ ok: true });
});

startScheduler();

app.listen(port, () => {
  console.log(`Scout running at http://localhost:${port}`);
});

