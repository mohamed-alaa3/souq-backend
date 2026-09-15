// Structured, greppable security event logging. Intentionally minimal (no
// new logging dependency) - writes one JSON line per event to stdout/stderr
// so it can be picked up by any log aggregator without code changes here.
//
// NEVER pass: passwords, password hashes, JWTs, OTPs, reset tokens, API
// keys, or database credentials as part of `meta`.

const logSecurityEvent = (event, meta = {}) => {
  // Tests run with NODE_ENV=test and exercise these paths heavily
  // (failed logins, forbidden access, etc.) - keep test output clean.
  if (process.env.NODE_ENV === "test") {
    return;
  }

  console.log(
    JSON.stringify({
      type: "SECURITY_EVENT",
      event,
      timestamp: new Date().toISOString(),
      ...meta,
    }),
  );
};

module.exports = logSecurityEvent;
