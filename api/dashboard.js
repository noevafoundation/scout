import { demoDashboard } from '../src/scoutMission.js';

export default function handler(_req, res) {
  res.status(200).json(demoDashboard());
}
