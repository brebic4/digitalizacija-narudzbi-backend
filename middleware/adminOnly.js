const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Korisnik nije prijavljen.",
    });
  }

  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "Samo administrator može izvršiti ovu radnju.",
    });
  }

  next();
};

export default adminOnly;
