import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy | ParkTag",
  description: "ParkTag's refund and cancellation policy for physical tags and digital services.",
};

export default function RefundPage() {
  return (
    <PageLoader>
      <SiteHeader defaultDark={false} />
      <div className="min-h-screen bg-white pt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-xs text-[#495B7B] mb-3">Last updated: 23 June 2026</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-2 tracking-tight">Refund &amp; Cancellation Policy</h1>
        <p className="text-[#495B7B] mb-10">We want you to be fully satisfied with ParkTag. This policy explains when and how you can request a refund or cancellation.</p>

        <div className="space-y-10">

          <Section title="1. Physical ParkTag Products">
            <ul>
              <li>
                <strong>Damaged or defective on arrival:</strong> You may request a free replacement or full refund within 7 days of delivery. Share an unboxing photo/video and the order ID at{" "}
                <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline">support@parktag.me</a>.
              </li>
              <li><strong>Wrong item delivered:</strong> Free replacement within 7 days of delivery.</li>
              <li>
                <strong>Change of mind:</strong> Returns accepted within 7 days of delivery if the tag is unused, unscanned and in original packaging. A return shipping fee may apply. Refund is processed within 7–10 business days after we receive and inspect the return.
              </li>
              <li><strong>Activated/used tags:</strong> Non-refundable, as the unique ID is bound to your account.</li>
            </ul>
          </Section>

          <Section title="2. Digital Subscriptions / Premium Plans">
            <ul>
              <li>Subscriptions are billed in advance and are non-refundable for the current billing cycle.</li>
              <li>You may cancel at any time from your account settings. Cancellation stops future renewals; you retain access until the end of the current period.</li>
              <li>If you were charged due to a technical error or duplicate payment, we will issue a full refund within 7–10 business days.</li>
            </ul>
          </Section>

          <Section title="3. Recovery / Service Fees">
            <p>One-time recovery or notification service fees are non-refundable once the service has been initiated.</p>
          </Section>

          <Section title="4. How to Request a Refund">
            <p>
              Email <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline">support@parktag.me</a> with:
            </p>
            <ul>
              <li>Order ID / transaction reference</li>
              <li>Reason for refund</li>
              <li>Photos/videos (for damaged or wrong items)</li>
            </ul>
            <p>
              We respond within 2 business days and process approved refunds to the original payment method via Razorpay within 7–10 business days.
            </p>
          </Section>

          <Section title="5. Non-Refundable Items">
            <ul>
              <li>Activated ParkTags</li>
              <li>Customised or personalised tags</li>
              <li>Services already rendered</li>
            </ul>
          </Section>

        </div>
      </div>
      </div>
    </PageLoader>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-bold text-[#03162D] mb-3">{title}</h2>
      <div className="text-[#495B7B] leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-[#03162D] [&_strong]:font-semibold [&_p]:text-[#495B7B]">
        {children}
      </div>
    </div>
  );
}
