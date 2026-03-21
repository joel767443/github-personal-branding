function respondError(res, status, error, details, code) {
  const payload = { error, status, details };
  if (code) payload.code = code;
  res.status(status).json(payload);
}

module.exports = {
  respondError,
};
