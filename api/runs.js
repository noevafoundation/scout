import { runScoutMission } from '../src/scoutMission.js';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const result = await runScoutMission(url);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Scout mission failed'
    });
  }
}
