import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "Terms & Conditions | ParkTag",
  description: "Terms and conditions governing your use of ParkTag services.",
};

export default function TermsPage() {
  return (
    <PageLoader>
      <SiteHeader defaultDark={false} />
      <div className="min-h-screen bg-white pt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-xs text-[#495B7B] mb-3">Last updated: 23 June 2026</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#001935] mb-2 tracking-tight">Terms &amp; Conditions</h1>
        <p className="text-[#495B7B] mb-10">
          These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your use of parktag.me, the ParkTag web and mobile applications, and any physical ParkTag products (collectively, the &ldquo;Services&rdquo;) operated by <span className="text-[#001935] font-medium">[Legal Entity Name]</span> (&ldquo;ParkTag&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By using the Services you agree to these Terms.
        </p>

        <div className="space-y-10">

          <Section title="1. Eligibility">
            <p>You must be at least 18 years old and legally capable of entering into a binding contract under Indian law to use the Services.</p>
          </Section>

          <Section title="2. Account">
            <p>You are responsible for maintaining the confidentiality of your login credentials and for all activity under your account. Notify us immediately of any unauthorised use.</p>
          </Section>

          <Section title="3. Use of Services">
            <p>You agree not to:</p>
            <ul>
              <li>Use the Services for any unlawful, fraudulent or harmful purpose</li>
              <li>Misrepresent ownership of a vehicle</li>
              <li>Attempt to reverse engineer, scrape, or disrupt the Services</li>
              <li>Use ParkTag to harass, stalk or harm any individual</li>
            </ul>
            <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>
          </Section>

          <Section title="4. ParkTag Hardware">
            <ul>
              <li>Each physical ParkTag carries a unique ID that, once activated, is permanently linked to your verified account.</li>
              <li>You are responsible for proper placement and care of the tag.</li>
              <li>Tampering with the tag may void its warranty.</li>
            </ul>
          </Section>

          <Section title="5. Pricing & Payments">
            <ul>
              <li>All prices are listed in Indian Rupees (INR) and are inclusive of applicable taxes unless stated otherwise.</li>
              <li>Payments are processed by Razorpay. By making a payment you also agree to Razorpay&rsquo;s terms.</li>
              <li>We reserve the right to change pricing with prior notice.</li>
            </ul>
          </Section>

          <Section title="6. Shipping">
            <p>Applicable to physical tag orders. Estimated delivery is 5–10 business days within India. Delays due to courier partners, weather, or force majeure are not within our control.</p>
          </Section>

          <Section title="7. Refunds">
            <p>Governed by our <Link href="/refund" className="text-[#1A9D20] hover:underline">Refund &amp; Cancellation Policy</Link>.</p>
          </Section>

          <Section title="8. Intellectual Property">
            <p>All content, logos, designs, code and trademarks on the Services are the property of ParkTag or its licensors. You may not copy, modify or redistribute any part of the Services without written permission.</p>
          </Section>

          <Section title="9. User Content">
            <p>If you upload photos, vehicle data or other content, you grant us a non-exclusive, royalty-free licence to host, store and display that content solely for the purpose of operating the Services.</p>
          </Section>

          <Section title="10. Privacy">
            <p>Your use of the Services is also governed by our <Link href="/privacy" className="text-[#1A9D20] hover:underline">Privacy Policy</Link>.</p>
          </Section>

          <Section title="11. Disclaimers">
            <p>The Services are provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not guarantee uninterrupted operation, recovery of any lost vehicle, or the conduct of finders/third parties. ParkTag is a notification and identification tool, not a tracking, GPS or insurance product.</p>
          </Section>

          <Section title="12. Limitation of Liability">
            <p>To the maximum extent permitted by law, ParkTag&rsquo;s total liability for any claim arising out of or relating to the Services shall not exceed the amount you paid to us in the 12 months preceding the claim. We are not liable for any indirect, incidental, special or consequential damages, including loss of the vehicle itself.</p>
          </Section>

          <Section title="13. Indemnity">
            <p>You agree to indemnify and hold ParkTag harmless from any claims, damages, losses or expenses arising from your misuse of the Services or violation of these Terms.</p>
          </Section>

          <Section title="14. Termination">
            <p>We may suspend or terminate your access at any time for breach of these Terms. You may stop using the Services at any time by closing your account.</p>
          </Section>

          <Section title="15. Governing Law & Jurisdiction">
            <p>These Terms are governed by the laws of India. Any dispute shall be subject to the exclusive jurisdiction of the courts at <span className="text-[#001935] font-medium">[City, State]</span>.</p>
          </Section>

          <Section title="16. Changes to Terms">
            <p>We may revise these Terms from time to time. Continued use of the Services after changes constitutes acceptance.</p>
          </Section>

          <Section title="17. Contact">
            <p>For any questions about these Terms:</p>
            <p>Email: <a href="mailto:legal@parktag.me" className="text-[#1A9D20] hover:underline">legal@parktag.me</a></p>
            <p>Address: 32/11, Wave One, Sector 18, Noida, UP 201301</p>
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
      <h2 className="text-xl font-bold text-[#001935] mb-3">{title}</h2>
      <div className="text-[#495B7B] leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-[#001935] [&_strong]:font-semibold [&_p]:text-[#495B7B]">
        {children}
      </div>
    </div>
  );
}
