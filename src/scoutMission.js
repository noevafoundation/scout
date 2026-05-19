const USER_AGENT = 'ScoutAgent/0.2 (+https://github.com/noevafoundation/scout; public B2B discovery)';
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const ROLE_RE = /\b(founder|ceo|owner|president|director|head of|vp|marketing|sales|operations|partnerships|growth)\b/i;
const STOPWORDS = new Set('the and for with from your you our that this are can into more about have will not get use all their business company services solutions platform team free home page privacy terms cookie login sign'.split(' '));
const IGNORED_DOMAINS = /(?:wikipedia|coursera|techtarget|nerdwallet|forbes|play\.google|linkedin|facebook|instagram|youtube|reddit|quora|medium|wix)\./i;

export async function runScoutMission(sourceUrl) {
  const normalizedUrl = normalizeUrl(sourceUrl);
  const site = await fetchPage(normalizedUrl);
  const profile = analyzeSite(site.url, site.html);
  const prospects = await discoverProspects(profile);
  const dashboard = buildDashboard(profile, prospects);

  return {
    runId: Date.now(),
    profile,
    prospects,
    stored: {
      companies: dashboard.companies.length,
      leads: dashboard.leads.length
    },
    campaign: dashboard.campaigns[0],
    dashboard
  };
}

export function demoDashboard() {
  return {
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
        next_run_at: nextWeek()
      }
    ],
    drafts: [
      { id: 1, email: 'start@factori.com', company_name: 'Factori Commerce', subject: 'Factori Commerce + Scout workflow', body: draftBody('Factori Commerce', 'ecommerce and retail brands', 'Scout identifies public buying signals and queues draft-first outreach.'), status: 'draft' },
      { id: 2, email: 'helpdesk@b2b.com.my', company_name: 'B2B e-Supplier Portal', subject: 'B2B e-Supplier Portal + weekly outbound', body: draftBody('B2B e-Supplier Portal', 'B2B SaaS and operations teams', 'Scout keeps outreach reviewable before anything sends.'), status: 'draft' }
    ]
  };
}

async function discoverProspects(profile) {
  const seen = new Set();
  const prospects = [];
  const queries = [
    ...profile.segments.slice(0, 2).map((segment) => `"${segment}" "contact" email`),
    `${profile.keywords.slice(0, 2).join(' ')} "contact us" email`
  ].filter((query) => query.trim().length > 18);

  for (const query of queries.slice(0, 3)) {
    const links = await searchWeb(query);
    for (const link of links.slice(0, 4)) {
      if (seen.has(link) || sameDomain(link, profile.sourceUrl)) continue;
      seen.add(link);

      const prospect = await inspectProspect(link, profile);
      if (prospect) prospects.push(prospect);
      if (prospects.length >= 8) return dedupeProspects(prospects);
    }
  }

  return dedupeProspects(prospects);
}

async function searchWeb(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(`${query} -wikipedia -coursera -linkedin`)}`;
  try {
    const { html } = await fetchPage(url, 9000);
    return unique([...html.matchAll(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/gi)]
      .map((match) => decodeHtml(match[1]))
      .map(resolveBingUrl)
      .filter((href) => href.startsWith('http'))
      .filter((href) => !/bing\.com|microsoft\.com/.test(href))
      .filter((href) => !IGNORED_DOMAINS.test(new URL(href).hostname)))
      .slice(0, 10);
  } catch {
    return [];
  }
}

async function inspectProspect(url, profile) {
  try {
    const page = await fetchPage(url, 9000);
    const pageHost = new URL(page.url).hostname;
    if (IGNORED_DOMAINS.test(pageHost)) return null;

    const links = extractLinks(page.url, page.html);
    const contactUrl = links.find((href) => /contact|about|team|leadership|support/i.test(href));
    const contactPage = contactUrl ? await safeFetch(contactUrl) : null;
    const combinedHtml = `${page.html}\n${contactPage?.html || ''}`;
    const combinedText = textFromHtml(combinedHtml);
    const emails = publicEmails(combinedHtml);
    const phones = cleanPhones(combinedText.match(PHONE_RE) || []);

    if (!emails.length && !phones.length) return null;

    const name = companyName(page, contactPage);
    const segment = bestSegment(profile.segments, combinedText);
    const fitScore = scoreFit(profile.keywords, combinedText, emails.length, phones.length);

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
      evidence: combinedText.slice(0, 260)
    };
  } catch {
    return null;
  }
}

async function fetchPage(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) throw new Error(`${url} did not return HTML`);
    return { url: response.url, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetch(url) {
  try {
    return await fetchPage(url, 7000);
  } catch {
    return null;
  }
}

function analyzeSite(sourceUrl, html) {
  const title = pick(html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1], hostname(sourceUrl));
  const description = pick(meta(html, 'description'), textFromHtml(html).slice(0, 220));
  const keywords = topKeywords(`${title} ${description}`);
  const name = cleanTitle(title) || hostname(sourceUrl);
  const segments = inferSegments(keywords, description);

  return {
    sourceUrl,
    name,
    description,
    keywords,
    segments,
    offer: `${name} helps teams with ${keywords.slice(0, 4).join(', ') || 'growth and operations'}.`
  };
}

function buildDashboard(profile, prospects) {
  const companies = [];
  const leads = [];
  const drafts = [];
  let leadId = 1;

  prospects.forEach((prospect, index) => {
    const companyId = index + 1;
    companies.push({
      id: companyId,
      name: prospect.name,
      website: prospect.website,
      segment: prospect.segment,
      fit_score: prospect.fitScore
    });

    const contacts = prospect.emails.length ? prospect.emails : [null];
    contacts.slice(0, 4).forEach((email) => {
      const lead = {
        id: leadId,
        company_id: companyId,
        company_name: prospect.name,
        email,
        phone: prospect.phones[0] || '',
        role: prospect.role,
        source_url: prospect.contactUrl || prospect.pageUrl,
        segment: prospect.segment,
        confidence: prospect.fitScore,
        status: 'new'
      };
      leads.push(lead);

      if (email) {
        drafts.push({
          id: leadId,
          email,
          company_name: prospect.name,
          subject: `${prospect.name} + ${profile.name.split(':')[0]}`,
          body: draftBody(prospect.name, prospect.segment, profile.offer),
          status: 'draft'
        });
      }

      leadId += 1;
    });
  });

  return {
    runs: [{ id: Date.now(), source_url: profile.sourceUrl, status: 'complete', created_at: new Date().toISOString() }],
    companies,
    leads,
    campaigns: [{
      id: 1,
      name: `${profile.name.split(':')[0]} scout campaign`,
      audience: profile.segments.join(', '),
      offer: profile.offer,
      next_run_at: nextWeek()
    }],
    drafts
  };
}

function draftBody(companyName, segment, offer) {
  return [
    'Hi,',
    '',
    `I came across ${companyName} while looking at ${segment}.`,
    '',
    offer,
    '',
    'Would it be useful to compare notes for 15 minutes next week?',
    '',
    'Best,',
    'Scout'
  ].join('\n');
}

function dedupeProspects(prospects) {
  const seen = new Set();
  return prospects
    .filter((prospect) => {
      if (seen.has(prospect.website)) return false;
      seen.add(prospect.website);
      return true;
    })
    .sort((a, b) => b.fitScore - a.fitScore);
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

function inferSegments(keywords, description) {
  const text = `${keywords.join(' ')} ${description}`.toLowerCase();
  const segments = [];
  if (/restaurant|food|hospitality|menu|booking/.test(text)) segments.push('restaurants and hospitality operators');
  if (/real estate|property|broker|listing/.test(text)) segments.push('real estate agencies and property managers');
  if (/clinic|health|medical|patient|wellness/.test(text)) segments.push('clinics and wellness providers');
  if (/ecommerce|shop|retail|brand|store|commerce/.test(text)) segments.push('ecommerce and retail brands');
  if (/saas|software|automation|workflow|crm|platform/.test(text)) segments.push('B2B SaaS and operations teams');
  if (/finance|accounting|invoice|tax/.test(text)) segments.push('finance and accounting teams');
  if (/school|course|education|student/.test(text)) segments.push('education and training businesses');
  return unique([...segments, `${keywords[0] || 'growth'} focused small businesses`, `${keywords[1] || 'operations'} teams`]).slice(0, 5);
}

function scoreFit(keywords, text, emailCount, phoneCount) {
  const lower = text.toLowerCase();
  const keywordHits = keywords.filter((keyword) => lower.includes(keyword.toLowerCase())).length;
  return Math.min(95, 42 + keywordHits * 9 + emailCount * 12 + phoneCount * 4);
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
    .slice(0, 80));
}

function publicEmails(html) {
  return unique((decodeHtml(html).match(EMAIL_RE) || [])
    .map((email) => email.toLowerCase())
    .filter((email) => !/\.(png|jpg|jpeg|gif|webp|svg|js|mjs|css|json)$/i.test(email))
    .filter((email) => !/^[a-z]+@\d/.test(email))
    .filter((email) => !/example\.com|domain\.com|sentry|wixpress|wix\.com|schema\.org|yourname|mystunningwebsite/.test(email)))
    .slice(0, 8);
}

function companyName(page, contactPage) {
  const contactTitle = cleanTitle(contactPage?.html?.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]);
  const pageTitle = cleanTitle(page.html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]);
  const hostBrand = brandFromHostname(page.url);
  const title = contactTitle || pageTitle;

  if (!title) return hostBrand;
  if (/what is|definition|meaning|guide|benefits|examples|types|history|pricing/i.test(title)) return hostBrand;
  if (/contact|about|home/i.test(title) && hostBrand) return hostBrand;
  return title.replace(/^welcome to\s+/i, '');
}

function brandFromHostname(value) {
  const host = hostname(value).split('.');
  const label = host.length > 1 ? host.at(-2) : host[0];
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    const normalized = word.replace(/^-+|-+$/g, '');
    if (normalized.length < 4 || STOPWORDS.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word]) => word);
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

function nextWeek() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}
