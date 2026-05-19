export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    message: 'Scheduler is demo-only on Vercel until a persistent database is connected.'
  });
}
