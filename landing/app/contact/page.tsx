import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "Contact | ParkTag",
  description: "Get in touch with the ParkTag team for support, sales, or general queries.",
};

const SUPPORT_EMAIL = "support@parktag.me";
// E.164 for tel: — no spaces, so the dialer parses it on every handset.
const SUPPORT_PHONE_E164 = "+918791638854";

const OFFICE_ADDRESS = "32/11, Wave One, Sector 18, Noida, UP 201301";
// Google's documented Maps URL format. It resolves in a browser and hands off
// to the native Maps app on Android/iOS. Built with encodeURIComponent rather
// than a hand-escaped string so the comma and slash in the address can't break
// the query.
const OFFICE_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(OFFICE_ADDRESS)}`;

// Shared card styling. Matches the lift used on the pricing cards: `transition`
// (not `transition-colors`) so the shadow and transform animate, and the travel
// sits behind motion-safe so it is dropped for reduced-motion users, who still
// get the border and shadow. A lighter shadow than pricing — these tiles are
// smaller, and shadow-xl overwhelms them.
const CARD =
  "flex items-start gap-4 p-5 rounded-2xl border border-gray-100 " +
  "hover:border-[#FF2700]/30 hover:shadow-lg motion-safe:hover:-translate-y-1 " +
  "transition duration-300 ease-out";

export default function ContactPage() {
  return (
    <PageLoader>
      <SiteHeader defaultDark={false} />
      <div className="min-h-screen bg-white pt-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">

          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-3 tracking-tight">
            Contact Us
          </h1>
          <p className="text-[#495B7B] leading-relaxed mb-10">
            Have a question, a problem with your tag, or want to explore fleet pricing?
            Reach out, we typically respond within one business day.
          </p>

          <div className="space-y-6">

            {/* Each card is ONE link, so the whole tile is the hit target
                rather than just the address text — which is what makes these
                usable on a phone, where the old inline links were small taps.
                The inner <a>s therefore became <span>s: an <a> nested inside
                an <a> is invalid, and browsers silently unnest it, which would
                have split each card into two competing links. `group` keeps the
                address reacting to a hover anywhere on the card. */}

            {/* Email — hands off to the OS mail client */}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={`${CARD} group`}>
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M2 7l10 7 10-7"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">Email Us</p>
                <span className="text-[#FF2700] group-hover:underline text-sm font-medium">
                  {SUPPORT_EMAIL}
                </span>
                <p className="text-xs text-[#495B7B] mt-1">For support, orders, and general queries</p>
              </div>
            </a>

            {/* Phone — tel: opens the dialer prefilled on mobile */}
            <a href={`tel:${SUPPORT_PHONE_E164}`} className={`${CARD} group`}>
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.36 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.27 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16l.92.92z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">Connect via Call</p>
                <span className="text-[#03162D] group-hover:text-[#FF2700] font-medium text-sm transition-colors">
                  +91 87916 38854
                </span>
                <p className="text-xs text-[#495B7B] mt-1">Mon – Sat, 10 am – 6 pm IST</p>
              </div>
            </a>

            {/* Address — opens Google Maps. New tab, since unlike mailto:/tel:
                this navigates away rather than handing off to the OS. */}
            <a href={OFFICE_MAPS_URL} target="_blank" rel="noopener noreferrer" className={`${CARD} group`}>
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">In-Person Consultation</p>
                <p className="text-sm text-[#495B7B] group-hover:text-[#FF2700] transition-colors">32/11, Wave One, Sector 18</p>
                <p className="text-sm text-[#495B7B] group-hover:text-[#FF2700] transition-colors">Noida, UP 201301</p>
              </div>
            </a>

          </div>
        </div>
      </div>
    </PageLoader>
  );
}
