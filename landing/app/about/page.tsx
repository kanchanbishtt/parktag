import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "About Us | ParkTag",
  description: "ParkTag is a smart vehicle identification and recovery platform built for Indian roads.",
};

export default function AboutPage() {
  return (
    <PageLoader>
      <SiteHeader defaultDark={false} />
      <div className="min-h-screen bg-white pt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-4 tracking-tight">About ParkTag</h1>
        <p className="text-xl text-[#495B7B] leading-relaxed mb-10 max-w-2xl">
          A smart vehicle identification and recovery platform that helps owners protect, locate and recover their vehicles using QR-enabled tags.
        </p>

        <div className="prose max-w-none space-y-8">

          <div>
            <p className="text-[#495B7B] leading-relaxed text-base">
              Whether it&rsquo;s a bicycle, scooter, motorcycle, auto rickshaw or car, every ParkTag is uniquely linked to its owner so that a finder, traffic authority or good samaritan can notify the owner in seconds, anonymously and securely.
            </p>
            <p className="text-[#495B7B] leading-relaxed text-base mt-4">
              Founded in 2025 and headquartered in India, ParkTag is built for the millions of two and three wheeler owners who deserve a simple, affordable layer of security for their vehicles. Our mission is to make every vehicle on Indian roads instantly traceable to its rightful owner, without compromising privacy.
            </p>
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#03162D] mb-5">What we do</h2>
            <ul className="space-y-4">
              {[
                "Issue tamper-resistant QR ParkTags linked to a verified owner profile",
                "Provide a mobile and web app to manage tags, vehicles and contact preferences",
                "Enable instant, anonymous owner notifications when a tag is scanned",
                "Maintain a verified record of vehicle ownership for legitimate recovery use cases",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF2700] flex-shrink-0 mt-2" />
                  <span className="text-[#495B7B] leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-gray-100 pt-8">
            <h2 className="text-xl font-bold text-[#03162D] mb-5">Contact</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-[#495B7B] w-16 flex-shrink-0">Email</span>
                <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline font-medium">support@parktag.me</a>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-[#495B7B] w-16 flex-shrink-0">Address</span>
                <span className="text-[#03162D]">32/11, Wave One, Sector 18, Noida, UP 201301</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[#495B7B] w-16 flex-shrink-0">Phone</span>
                <a href="tel:+918791638854" className="text-[#03162D] font-medium">+91 87916 38854</a>
              </div>
            </div>
          </div>

        </div>
      </div>
      </div>
    </PageLoader>
  );
}
