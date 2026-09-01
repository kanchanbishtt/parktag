import { requireSession } from "../../lib/auth/auth.js";
import {
  MEMBERSHIP_SCOPES,
  membershipFeatures,
  membershipPlans,
  membershipTrial
} from "../../lib/core/membership-plans.js";

// What the membership screen renders.
//
// Behind a session because the screen is part of the signed-in area, not
// because the catalogue is a secret — it is the same list for everybody, and
// the page it feeds is reached from the profile tab.
//
// The page computes nothing: no prices, no savings, no trial length. Every one
// of those is derived in lib/core/membership-plans.js from constants the rest
// of the app already enforces, so the screen cannot advertise a 45-day trial
// after the window was widened to 90, or a saving that stopped being true when
// a price moved.
export function registerMembershipRoutes(app, env) {
  app.get(
    "/api/owner/membership",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      return {
        ok: true,
        trial: membershipTrial(),
        plans: membershipPlans(),
        scopes: MEMBERSHIP_SCOPES,
        features: membershipFeatures(),
        // There is no membership SKU and no recurring-billing path yet, so the
        // page must not open a checkout it cannot finish. Sent as a flag rather
        // than assumed by the client, so the day it becomes true the screen
        // starts working without a second deploy of the frontend.
        checkoutEnabled: false
      };
    }
  );
}
