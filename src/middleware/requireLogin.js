function requireLogin(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Unauthorized", status: 401, details: "Login required" });
  }
  next();
}

module.exports = requireLogin;
