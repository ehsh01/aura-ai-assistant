import React from "react";

const LAST_UPDATED = "July 10, 2026";
const CONTACT_EMAIL = "ehernandez2@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-white/70 leading-relaxed">{children}</div>
    </section>
  );
}

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <a href="/" className="text-sm text-indigo-300 hover:text-indigo-200">
          ← Back to Recall
        </a>
        <p className="mt-8 text-sm uppercase tracking-[0.3em] text-indigo-300/70">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold">Terms of Service</h1>
        <p className="mt-2 text-white/45">Last updated: {LAST_UPDATED}</p>

        <Section title="Acceptance of terms">
          <p>
            By accessing or using Recall (the “Service”) at{" "}
            <span className="text-white/90">recall-app.net</span>, you agree to these Terms of
            Service. If you do not agree, do not use the Service.
          </p>
        </Section>

        <Section title="Description of the service">
          <p>
            Recall is a personal knowledge and productivity assistant that helps you capture,
            organize, and ask questions about your information, including data from third-party
            accounts you choose to connect.
          </p>
        </Section>

        <Section title="Accounts">
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activity under your account. Notify us promptly of any unauthorized use.
          </p>
        </Section>

        <Section title="Connected accounts">
          <p>
            When you connect a third-party account such as Google, you authorize Recall to access the
            data described at the time of connection, on a read-only basis, solely to provide the
            Service to you. You can disconnect at any time from the Connectors page or revoke access
            through your provider’s security settings. Your use of connected services also remains
            subject to those providers’ own terms.
          </p>
        </Section>

        <Section title="Acceptable use">
          <ul className="list-disc space-y-2 pl-6">
            <li>Do not use the Service for unlawful purposes or to violate others’ rights.</li>
            <li>Do not attempt to disrupt, reverse engineer, or gain unauthorized access to the Service.</li>
            <li>Do not upload content you do not have the right to use.</li>
          </ul>
        </Section>

        <Section title="Intellectual property">
          <p>
            You retain ownership of the content you provide. You grant Recall the limited rights
            needed to store and process that content in order to operate the Service for you.
          </p>
        </Section>

        <Section title="Disclaimer of warranties">
          <p>
            The Service is provided “as is” and “as available,” without warranties of any kind,
            express or implied. AI-generated answers may be inaccurate or incomplete; verify
            important information independently.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, Recall and its operators shall not be liable for
            any indirect, incidental, special, consequential, or punitive damages, or any loss of
            data, arising from your use of the Service.
          </p>
        </Section>

        <Section title="Termination">
          <p>
            You may stop using the Service at any time. We may suspend or terminate access if these
            Terms are violated or to protect the Service.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these Terms from time to time. Continued use after changes take effect
            constitutes acceptance of the revised Terms. Material changes will be reflected by
            updating the “Last updated” date above.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these Terms? Email{" "}
            <a className="text-indigo-300 hover:text-indigo-200" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <p className="mt-12 border-t border-white/10 pt-6 text-sm text-white/40">
          <a href="/privacy" className="text-indigo-300 hover:text-indigo-200">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
