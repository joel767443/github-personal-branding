/** @param {import('@prisma/client').SyncFrequency} freq */
function addFrequencyToDate(from, freq) {
  const d = new Date(from.getTime());
  switch (freq) {
    case 'TWO_DAYS':
      d.setDate(d.getDate() + 2);
      break;
    case 'ONE_WEEK':
      d.setDate(d.getDate() + 7);
      break;
    case 'TWO_WEEKS':
      d.setDate(d.getDate() + 14);
      break;
    case 'ONE_MONTH':
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      d.setDate(d.getDate() + 2);
  }
  return d;
}

/** @param {import('@prisma/client').SyncFrequency} freq */
function subtractFrequencyFromDate(from, freq) {
  const d = new Date(from.getTime());
  switch (freq) {
    case 'TWO_DAYS':
      d.setDate(d.getDate() - 2);
      break;
    case 'ONE_WEEK':
      d.setDate(d.getDate() - 7);
      break;
    case 'TWO_WEEKS':
      d.setDate(d.getDate() - 14);
      break;
    case 'ONE_MONTH':
      d.setMonth(d.getMonth() - 1);
      break;
    default:
      d.setDate(d.getDate() - 2);
  }
  return d;
}

/** @param {string} raw */
function parseSyncFrequency(raw) {
  const u = String(raw || '').toUpperCase().replace(/-/g, '_');
  if (['TWO_DAYS', 'ONE_WEEK', 'TWO_WEEKS', 'ONE_MONTH'].includes(u)) return u;
  return 'TWO_DAYS';
}

module.exports = {
  addFrequencyToDate,
  subtractFrequencyFromDate,
  parseSyncFrequency,
};
