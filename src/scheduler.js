import nodemailer from 'nodemailer';
import { all, get, run } from './db.js';
import { queueWeeklyDrafts } from './agent.js';

export function startScheduler() {
  setInterval(tick, 60 * 1000).unref();
  tick();
}

export function tick() {
  const dueCampaigns = all(`
    SELECT * FROM campaigns
    WHERE status = 'active' AND datetime(next_run_at) <= datetime('now')
  `);

  for (const campaign of dueCampaigns) {
    queueWeeklyDrafts(campaign.id);
  }

  sendApprovedDrafts().catch((error) => {
    console.error('Mailer tick failed:', error);
  });
}

async function sendApprovedDrafts() {
  if (!process.env.SMTP_HOST) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });

  const drafts = all(`
    SELECT outreach_queue.*, leads.email
    FROM outreach_queue
    JOIN leads ON leads.id = outreach_queue.lead_id
    WHERE outreach_queue.status = 'approved'
    ORDER BY outreach_queue.created_at ASC
    LIMIT 10
  `);

  for (const draft of drafts) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: draft.email,
        subject: draft.subject,
        text: `${draft.body}\n\nReply "unsubscribe" and we will not contact you again.`
      });
      run('UPDATE outreach_queue SET status = ?, sent_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ?', ['sent', draft.id]);
    } catch (error) {
      run('UPDATE outreach_queue SET status = ?, error = ? WHERE id = ?', ['failed', String(error.message || error), draft.id]);
    }
  }
}

export function approveDraft(id) {
  const draft = get('SELECT * FROM outreach_queue WHERE id = ?', [id]);
  if (!draft) return null;
  run('UPDATE outreach_queue SET status = ? WHERE id = ?', ['approved', id]);
  return get('SELECT * FROM outreach_queue WHERE id = ?', [id]);
}

