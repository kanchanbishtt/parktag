import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "Contact | ParkTag",
  description: "Get in touch with the ParkTag team for support, sales, or general queries.",
};

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

            {/* Email */}
            <div className="flex items-start gap-4 p-5 rounded-2xl border border-gray-100 hover:border-[#FF2700]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M2 7l10 7 10-7"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">Email</p>
                <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline text-sm font-medium">
                  support@parktag.me
                </a>
                <p className="text-xs text-[#495B7B] mt-1">For support, orders, and general queries</p>
              </div>
            </div>

            {/* Phone */}
            <div className="flex items-start gap-4 p-5 rounded-2xl border border-gray-100 hover:border-[#FF2700]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.36 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.27 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16l.92.92z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">Phone</p>
                <a href="tel:+918791638854" className="text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">
                  +91 87916 38854
                </a>
                <p className="text-xs text-[#495B7B] mt-1">Mon – Sat, 10 am – 6 pm IST</p>
              </div>
            </div>

            {/* Address */}
            <div className="flex items-start gap-4 p-5 rounded-2xl border border-gray-100 hover:border-[#FF2700]/30 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-[#FF2700]/10 flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#03162D] mb-0.5">Office</p>
                <p className="text-sm text-[#495B7B]">32/11, Wave One, Sector 18</p>
                <p className="text-sm text-[#495B7B]">Noida, UP 201301</p>
              </div>
            </div>

            {/* Fleet enquiry */}
            <div className="mt-4 p-5 rounded-2xl bg-[#03162D] text-white">
              <p className="text-sm font-semibold mb-1">Fleet &amp; Business Enquiries</p>
              <p className="text-xs text-white/60 mb-3">
                Managing 5+ vehicles? We offer custom pricing, bulk tags, and a dedicated account manager.
              </p>
              <a
                href="mailto:support@parktag.me?subject=Fleet Enquiry"
                className="inline-block text-xs font-bold bg-[#FF2700] hover:bg-[#D92200] text-white px-4 py-2 rounded-lg transition-colors"
              >
                Get Fleet Pricing
              </a>
            </div>

          </div>
        </div>
      </div>
    </PageLoader>
  );
}
