// Builds a readable complaint number such as EFC-2026-000042
function generateComplaintId(sequence, date = new Date()) {
  return `EFC-${date.getFullYear()}-${String(sequence).padStart(6, '0')}`;
}

module.exports = generateComplaintId;
