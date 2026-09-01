// Rendering for the front-end analytics bundle served at GET /pt-analytics.js.
//
// This is a separate function purely so it can be tested without a database.
// The route that used to hold this logic inline could only be exercised through
// buildApp(), which needs Mongo, so the one thing most worth pinning down — that
// no placeholder ever survives into the served file — was the one thing no test
// could reach.

// Every placeholder assets/analytics.js expects, paired with the env key that
// fills it. Keeping the list here (rather than as loose replaceAll calls at the
// call site) is what lets the test assert the two files agree.
export const ANALYTICS_PLACEHOLDERS = {
  __GA4_MEASUREMENT_ID__: "ga4MeasurementId",
  __META_PIXEL_ID__: "metaPixelId"
};

// A missing ID becomes "" rather than being left as the literal placeholder.
// That difference matters: analytics.js treats "" as "not configured in this
// environment" and installs a no-op, whereas the literal "__GA4_MEASUREMENT_ID__"
// is a truthy string that would sail through the guard, initialise GA4 against a
// nonsense property and report every event into a void — silently, for as long
// as it took someone to notice the dashboard was empty.
export function renderAnalyticsBundle(source, env) {
  return Object.entries(ANALYTICS_PLACEHOLDERS).reduce(
    (out, [placeholder, envKey]) => out.replaceAll(placeholder, env?.[envKey] || ""),
    source
  );
}
