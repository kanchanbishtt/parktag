// The campaign registry. One entry per scheduled message.
//
// Each campaign is a module exporting `id` and `run(env, collections, ctx)`.
// They share nothing, hold no state between ticks, and are ordered by how much
// the customer would mind missing them: the scheduler spends its per-tick send
// budget top-down, so if a cap is ever hit it is the least important campaign
// that goes short.
//
// Adding one here is the whole wiring. Do not forget the two rules that make a
// campaign safe, both enforced by convention rather than by code:
//
//   1. due()/run() must query a BOUNDED window (see scheduler.js).
//   2. every send goes through sendOnce() with a natural dedupeKey.

import * as trialEnding from "./trial-ending.js";
import * as cartReminder from "./cart-reminder.js";

// Ordered by how much the customer would mind missing it, because the
// per-tick send budget is spent top-down: if the cap is ever hit, it is the
// least important campaign that goes short.
//
// trial-ending outranks cart-reminder because a missed renewal notice costs
// somebody a feature they are still paying attention to, while a missed cart
// nudge costs a sale that was already half-lost.
export const CAMPAIGNS = [trialEnding, cartReminder];
