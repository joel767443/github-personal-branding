function respondError(res, status, error, details, code) {
  const payload = { error, status, details };
  if (code) payload.code = code;
  res.status(status).json(payload);
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = {
  respondError,
  asyncHandler,
};
