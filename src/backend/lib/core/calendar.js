// Calendar arithmetic shared by everything that grants a period of service.
//
// This lived in membership-fulfilment.js while paid periods were the only
// caller. The premium tag's complimentary year needs the identical arithmetic,
// and vault.js cannot import it from there — membership-fulfilment.js already
// imports premiumTrialEndsAt from vault.js, so that would be a cycle. Hence a
// module neither of them owns.
//
// Keeping one implementation matters beyond tidiness: membershipPeriodStart
// compares a trial end against a paid period end to decide where a new purchase
// begins. If those two dates were produced by different arithmetic, the
// comparison would be between subtly different notions of "a year", and the
// error would show up as a customer being sold days they already held.

// Add whole calendar months, not 30-day blocks.
//
// A "6 months" plan bought on the 15th should end on the 15th, and 30-day
// arithmetic drifts by five days a year — enough that an annual renewal lands
// on a visibly different date each time and looks like a bug in the billing.
//
// setMonth handles the overflow that makes this worth writing down: the 31st of
// January plus one month is the 3rd of March in JavaScript, because February
// has no 31st and Date rolls forward. Clamping to the last day of the target
// month is the behaviour a person expects from "one month later", and it is
// also the one that never grants a day nobody paid for.
export function addMonths(fromMs, months) {
  const date = new Date(fromMs);
  const targetDay = date.getUTCDate();

  date.setUTCMonth(date.getUTCMonth() + months);

  // If the day of the month moved, the target month was shorter and Date rolled
  // us into the next one. Step back to the last day of the month we meant.
  if (date.getUTCDate() !== targetDay) date.setUTCDate(0);

  return date.getTime();
}
