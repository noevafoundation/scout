import { URL } from 'node:url';
import { all, get, run } from './db.js';

const USER_AGENT = 'ScoutAgent/0.1 (+local hackathon prototype; respectful crawling)';
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ROLE_RE = /\b(founder|ceo|owner|president|director|head of|vp|marketing|sales|operations|partnerships|growth)\b/i;
const STOPWORDS = new Set('the and for with from your you our that this are can into more about have will not get use all their business company services solutions platform team'.split(' '));
const IGNORED_PROSPECT_DOMAINS = /(?:wikipedia|coursera|techtarget|nerdwallet|forbes|play\.google|linkedin|facebook|instagram|youtube)\./i;

export async function runAgent(sourceUrl) {
  const normalizedUrl = normalizeUrl(sourceUrl);
  const runId = run('INSERT INTO runs (source_url, status) VALUES (?, ?)', [normalizedUrl, 'running']).lastInsertRowid;

  try {
    const site = await fetchPage(normalizedUrl);
    const profile = analyzeSite(normalizedUrl, site.html);
    const prospects = await discoverProspects(profile);
    const stored = storeProspects(runId, profile, prospects);
    const campaign = createCampaign(runId, profile);
    queueWeeklyDrafts(campaign.id);

    const summary = JSON.stringify({
      product: profile.name,
      segments: profile.segments,
      queries: profile.queries,
      prospectsFound: prospects.length,
      leadsStored: stored.leads,
      campaignId: campaign.id
    });

    run('UPDATE runs SET status = ?, summary = ? WHERE id = ?', ['complete', summary, runId]);
    return { runId, profile, prospects: prospects.slice(0, 20), stored, campaign };
  } catch (error) {
    run('UPDATE runs SET status = ?, summary = ? WHERE id = ?', ['failed', String(error.stack || error), runId]);
    throw error;
  }
}

export async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error(`${url} did not return HTML`);
  }

  return { url: response.url, html: await response.text() };
}

export function analyzeSite(sourceUrl, html) {
  const title = pick(html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1], hostname(sourceUrl));
  const description = pick(meta(html, 'description'), textFromHtml(html).slice(0, 220));
  const keywords = topKeywords(`${title} ${description}`);
  const name = cleanTitle(title) || hostname(sourceUrl);
  const segments = inferSegments(keywords, description);
  const queries = segments.slice(0, 4).map((segment) => `"${segment}" "contact" email`);

  return {
    sourceUrl,
    name,
    description,
    keywords,
    segments,
    queries,
    offer: `${name} helps teams with ${keywords.slice(0, 4).join(', ') || 'growth and operations'}.`
  };
}

async function discoverProspects(profile) {
  const seen = new Set();
  const results = [];

  for (const query of profile.queries) {
    const links = await searchWeb(query);
    for (const link of links.slice(0, 6)) {
      if (seen.has(link) || sameDomain(link, profile.sourceUrl)) continue;
      seen.add(link);
      const prospect = await inspectProspect(link, profile);
      if (prospect) results.push(prospect);
      await sleep(350);
    }
  }

  return results.sort((a, b) => b.fitScore - a.fitScore);
}

async function duckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const { html } = await fetchPage(url);
    const links = [...html.matchAll(/class="result__a"[^>]+href="([^"]+)"/g)]
      .map((match) => decodeHtml(match[1]))
      .map((href) => {
        try {
          const parsed = new URL(href);
          return parsed.searchParams.get('uddg') || href;
        } catch {
          return href;
        }
      })
      .filter((href) => href.startsWith('http'));

    return [...new Set(links)];
  } catch {
    return [];
  }
}

async function searchWeb(query) {
  const ddgLinks = await duckDuckGo(query);
  if (ddgLinks.length) return ddgLinks;

  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  try {
    const { html } = await fetchPage(url);
    return unique([...html.matchAll(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi)]
      .map((match) => decodeHtml(match[1]))
      .map(resolveBingUrl)
      .filter((href) => href.startsWith('http'))
      .filter((href) => !/bing\.com|microsoft\.com/.test(href)));
  } catch {
    return [];
  }
}

function resolveBingUrl(href) {
  try {
    const parsed = new URL(href);
    const encoded = parsed.searchParams.get('u');
    if (!encoded) return href;
    const base64 = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    return Buffer.from(base64, 'base64url').toString('utf8');
  } catch {
    return href;
  }
}

async function inspectProspect(url, profile) {
  try {
    const page = await fetchPage(url);
    if (IGNORED_PROSPECT_DOMAINS.test(new URL(page.url).hostname)) return null;
    const text = textFromHtml(page.html);
    const links = extractLinks(page.url, page.html);
    const contactUrl = links.find((href) => /contact|about|team|leadership/i.test(href));
    const contactPage = contactUrl ? await safeFetch(contactUrl) : null;
    const combinedHtml = `${page.html}\n${contactPage?.html || ''}`;
    const combinedText = `${text}\n${contactPage ? textFromHtml(contactPage.html) : ''}`;
    const emails = publicEmails(combinedHtml);
    const phones = cleanPhones(combinedText.match(PHONE_RE) || []);
    const name = cleanTitle(page.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]) || hostname(page.url);
    const segment = bestSegment(profile.segments, combinedText);
    const fitScore = scoreFit(profile.keywords, combinedText, emails.length, phones.length);

    if (!emails.length && !phones.length) return null;

    return {
      name,
      website: origin(page.url),
      pageUrl: page.url,
      contactUrl,
      segment,
      fitScore,
      emails,
      phones,
      role: combinedText.match(ROLE_RE)?.[1] || '',
      evidence: combinedText.slice(0, 360)
    };
  } catch {
    return null;
  }
}

async function safeFetch(url) {
  try {
    await sleep(250);
    return await fetchPage(url);
  } catch {
    return null;
  }
}

function storeProspects(runId, profile, prospects) {
  let companies = 0;
  let leads = 0;

  for (const prospect of prospects) {
    const company = get('SELECT id FROM companies WHERE website = ?', [prospect.website]);
    const companyId = company?.id || run(`
      INSERT INTO companies (run_id, name, website, segment, fit_score, evidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [runId, prospect.name, prospect.website, prospect.segment, prospect.fitScore, prospect.evidence]).lastInsertRowid;

    if (!company) companies += 1;

    const contacts = prospect.emails.length ? prospect.emails : [null];
    for (const email of contacts) {
      const result = run(`
        INSERT OR IGNORE INTO leads (company_id, email, phone, role, source_url, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [companyId, email, prospect.phones[0] || null, prospect.role, prospect.contactUrl || prospect.pageUrl, prospect.fitScore]);
      if (result.changes) leads += 1;
    }
  }

  return { companies, leads };
}

function createCampaign(runId, profile) {
  const campaignName = `${profile.name} weekly outbound`;
  const existing = get('SELECT * FROM campaigns WHERE run_id = ? LIMIT 1', [runId]);
  if (existing) return existing;

  const nextRun = new Date(Date.now() + 60 * 1000).toISOString();
  const id = run(`
    INSERT INTO campaigns (run_id, name, audience, offer, cadence_days, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [runId, campaignName, profile.segments.join(', '), profile.offer, 7, nextRun]).lastInsertRowid;

  return get('SELECT * FROM campaigns WHERE id = ?', [id]);
}

export function queueWeeklyDrafts(campaignId) {
  const campaign = get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
  if (!campaign) return { queued: 0 };

  const leads = all(`
    SELECT leads.*, companies.name AS company_name, companies.segment
    FROM leads
    JOIN companies ON companies.id = leads.company_id
    WHERE leads.status IN ('new', 'queued') AND leads.email IS NOT NULL
    ORDER BY leads.confidence DESC
    LIMIT 25
  `);

  let queued = 0;
  const scheduledFor = new Date().toISOString().slice(0, 10);
  for (const lead of leads) {
    const subject = `${lead.company_name} + ${campaign.offer.split(' ').slice(0, 5).join(' ')}`;
    const body = draftEmail(campaign, lead);
    const result = run(`
      INSERT OR IGNORE INTO outreach_queue (campaign_id, lead_id, subject, body, scheduled_for)
      VALUES (?, ?, ?, ?, ?)
    `, [campaign.id, lead.id, subject, body, scheduledFor]);
    if (result.changes) queued += 1;
  }

  const next = new Date(Date.now() + campaign.cadence_days * 24 * 60 * 60 * 1000).toISOString();
  run('UPDATE campaigns SET next_run_at = ? WHERE id = ?', [next, campaign.id]);
  return { queued };
}

function draftEmail(campaign, lead) {
  return [
    `Hi${lead.name ? ` ${lead.name}` : ''},`,
    '',
    `I came across ${lead.company_name} while looking at ${lead.segment || campaign.audience}.`,
    '',
    `${campaign.offer}`,
    '',
    'Would it be useful to compare notes for 15 minutes next week?',
    '',
    'Best,',
    process.env.SMTP_FROM?.replace(/<.*?>/g, '').trim() || 'Scout'
  ].join('\n');
}

function inferSegments(keywords, description) {
  const text = `${keywords.join(' ')} ${description}`.toLowerCase();
  const segments = [];
  if (/restaurant|food|hospitality|menu|booking/.test(text)) segments.push('restaurants and hospitality operators');
  if (/real estate|property|broker|listing/.test(text)) segments.push('real estate agencies and property managers');
  if (/clinic|health|medical|patient|wellness/.test(text)) segments.push('clinics and wellness providers');
  if (/ecommerce|shop|retail|brand|store/.test(text)) segments.push('ecommerce and retail brands');
  if (/saas|software|automation|workflow|crm/.test(text)) segments.push('B2B SaaS and operations teams');
  if (/finance|accounting|invoice|tax/.test(text)) segments.push('finance and accounting teams');
  if (/school|course|education|student/.test(text)) segments.push('education and training businesses');

  return unique([...segments, `${keywords[0] || 'growth'} focused small businesses`, `${keywords[1] || 'operations'} teams`]).slice(0, 5);
}

function scoreFit(keywords, text, emailCount, phoneCount) {
  const lower = text.toLowerCase();
  const keywordHits = keywords.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
  return Math.min(95, 35 + keywordHits * 10 + emailCount * 12 + phoneCount * 4);
}

function bestSegment(segments, text) {
  const lower = text.toLowerCase();
  return segments.find((segment) => segment.split(/\W+/).some((word) => word.length > 4 && lower.includes(word))) || segments[0] || 'qualified prospect';
}

function extractLinks(baseUrl, html) {
  return unique([...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)]
    .map((match) => {
      try {
        return new URL(decodeHtml(match[1]), baseUrl).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((href) => href.startsWith('http'))
    .slice(0, 60));
}

function publicEmails(html) {
  return unique((decodeHtml(html).match(EMAIL_RE) || [])
    .map((email) => email.toLowerCase())
    .filter((email) => !/\.(png|jpg|jpeg|gif|webp|svg|js|mjs|css|json)$/i.test(email))
    .filter((email) => !/^[a-z]+@\d/.test(email))
    .filter((email) => !/example\.com|domain\.com|sentry|wixpress|schema\.org/.test(email)))
    .slice(0, 8);
}

function cleanPhones(matches) {
  return unique(matches
    .map((phone) => phone.replace(/\s+/g, ' ').trim())
    .filter((phone) => phone.includes('+') || phone.replace(/\D/g, '').length >= 10)
    .filter((phone) => !/^\d{4}[-\s]\d{2}[-\s]\d{2}$/.test(phone))
    .filter((phone) => !/^\d{4}[-\s]\d{4}$/.test(phone)))
    .slice(0, 3);
}

function topKeywords(text) {
  const counts = new Map();
  for (const word of text.toLowerCase().match(/[a-z]{4,}/g) || []) {
    if (STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

function textFromHtml(html) {
  return decodeHtml(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meta(html, name) {
  return html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'))?.[1]
    || '';
}

function normalizeUrl(value) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withProtocol).href;
}

function hostname(value) {
  return new URL(value).hostname.replace(/^www\./, '');
}

function origin(value) {
  return new URL(value).origin;
}

function sameDomain(a, b) {
  return hostname(a) === hostname(b);
}

function cleanTitle(value = '') {
  return pick(decodeHtml(value).split(/\s[-|–]\s/)[0], '');
}

function pick(value, fallback) {
  const cleaned = decodeHtml(String(value || '')).replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
