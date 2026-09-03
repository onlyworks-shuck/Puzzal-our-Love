const { fail } = require('./_lib/http');
const { sweepAbandonedUploads } = require('./_lib/store');

// Removes chunks left behind by uploads that were started but never
// finished — the sender closed the tab, lost signal, or picked a file and
// never sent it. Those pieces are referenced by no message, so nothing in
// the app can ever display or delete them; without this they accumulate in
// the store indefinitely.
//
// Run on a schedule (see vercel.json "crons"). Only touches uploads with no
// completed media record that haven't been written to for 24 hours, so an
// upload in progress is never disturbed. That makes it safe to re-run and
// safe to trigger early — it can only ever delete data that is already
// unreachable — but it is still gated when CRON_SECRET is configured.
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers?.authorization || '';
    if (header !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const swept = await sweepAbandonedUploads();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, sweptCount: swept.length });
  } catch (err) {
    return fail(res, 500, { error: 'Cleanup failed' }, err, 'cleanup-orphans');
  }
};
