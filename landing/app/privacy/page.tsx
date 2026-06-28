import type { Metadata } from "next";
import { SiteHeader } from "../components/SiteHeader";
import { PageLoader } from "../components/PageLoader";

export const metadata: Metadata = {
  title: "Privacy Policy | ParkTag",
  description: "How ParkTag collects, uses, and protects your personal data.",
};

export default function PrivacyPage() {
  return (
    <PageLoader>
      <SiteHeader defaultDark={false} />
      <div className="min-h-screen bg-white pt-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-xs text-[#495B7B] mb-3">Last updated: 23 June 2026</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-2 tracking-tight">Privacy Policy</h1>
        <p className="text-[#495B7B] mb-10">
          ParkTag (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) respects your privacy. This Privacy Policy explains how we collect, use, share and protect your information when you use our website parktag.me, our web app, and our QR-enabled physical tags (collectively, the &ldquo;Services&rdquo;).
        </p>

        <div className="space-y-10">

          <Section title="1. Information We Collect">
            <ul>
              <li><strong>Account information:</strong> name, email address, mobile number, password (hashed), profile photo.</li>
              <li><strong>Vehicle information:</strong> vehicle type, make, model, registration number, colour, photos and the unique ParkTag ID linked to it.</li>
              <li><strong>Device &amp; usage information:</strong> IP address, device type, browser, operating system, app version, log data, crash reports.</li>
              <li><strong>Location information:</strong> approximate location when a tag is scanned (city/region level), shared with the owner of the tag for recovery purposes.</li>
              <li><strong>Payment information:</strong> processed securely by our payment partner Razorpay. We do not store full card numbers, CVV or banking credentials on our servers.</li>
              <li><strong>Communications:</strong> messages you send to our support team.</li>
            </ul>
          </Section>

          <Section title="2. How We Use Your Information">
            <ul>
              <li>To create and manage your account</li>
              <li>To link physical ParkTags to your verified profile</li>
              <li>To notify you when one of your tags is scanned</li>
              <li>To process payments for tags, subscriptions and recovery services</li>
              <li>To improve, secure and personalise the Services</li>
              <li>To send transactional and, with consent, promotional communications</li>
              <li>To comply with legal obligations and respond to lawful requests from authorities</li>
            </ul>
          </Section>

          <Section title="3. Sharing of Information">
            <p>We do not sell your personal data. We share information only:</p>
            <ul>
              <li>With service providers (hosting, analytics, payments, communications) under confidentiality</li>
              <li>With law enforcement or government authorities when legally required</li>
              <li>With the tag owner, in a limited and anonymised form, when their tag is scanned</li>
              <li>With your explicit consent in any other case</li>
            </ul>
          </Section>

          <Section title="4. Data Retention">
            <p>
              We retain your data for as long as your account is active and for a reasonable period thereafter to comply with legal, tax and accounting obligations. You can request deletion at any time by writing to{" "}
              <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline">support@parktag.me</a>.
            </p>
          </Section>

          <Section title="5. Security">
            <p>
              We use industry-standard encryption (TLS in transit, AES at rest), access controls, and regular audits to protect your data. No method of transmission over the internet is 100% secure, but we continuously work to strengthen our safeguards.
            </p>
          </Section>

          <Section title="6. Your Rights">
            <p>Depending on your jurisdiction (India DPDP Act, GDPR, etc.) you have the right to:</p>
            <ul>
              <li>Access, correct or delete your personal data</li>
              <li>Withdraw consent at any time</li>
              <li>Object to or restrict certain processing</li>
              <li>Lodge a complaint with the relevant data protection authority</li>
            </ul>
            <p>
              To exercise these rights, email{" "}
              <a href="mailto:support@parktag.me" className="text-[#FF2700] hover:underline">support@parktag.me</a>{" "}
              from your registered email.
            </p>
          </Section>

          <Section title="7. Children's Privacy">
            <p>
              ParkTag is not directed at children under 18. We do not knowingly collect data from minors. If you believe a minor has provided us data, please contact us and we will delete it.
            </p>
          </Section>

          <Section title="8. Cookies">
            <p>
              We use essential cookies for authentication and optional cookies for analytics. You can manage cookies via your browser settings.
            </p>
          </Section>

          <Section title="9. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date at the top will reflect the latest revision. Material changes will be notified via email or in-app.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>Grievance Officer: <span className="text-[#03162D] font-medium">[Name]</span></p>
            <p>Email: <a href="mailto:privacy@parktag.me" className="text-[#FF2700] hover:underline">privacy@parktag.me</a></p>
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
      <h2 className="text-xl font-bold text-[#03162D] mb-3">{title}</h2>
      <div className="text-[#495B7B] leading-relaxed space-y-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_strong]:text-[#03162D] [&_strong]:font-semibold [&_p]:text-[#495B7B]">
        {children}
      </div>
    </div>
  );
}
