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

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="mx-auto max-w-3xl px-5 py-14">
        <a href="/" className="text-sm text-indigo-300 hover:text-indigo-200">
          ← Back to Recall
        </a>
        <p className="mt-8 text-sm uppercase tracking-[0.3em] text-indigo-300/70">Legal</p>
        <h1 className="mt-2 text-3xl font-semibold">Privacy Policy</h1>
        <p className="mt-2 text-white/45">Last updated: {LAST_UPDATED}</p>

        <Section title="Overview">
          <p>
            Recall (“Recall”, “we”, “us”) is a personal knowledge and productivity assistant
            available at <span className="text-white/90">recall-app.net</span>. This Privacy Policy
            explains what information we collect, how we use it, and the choices you have. Recall is
            operated as a private, individual-use application.
          </p>
        </Section>

        <Section title="Information we collect">
          <p>We collect only what is needed to provide the service:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <span className="text-white/90">Account information</span> — your email address and
              authentication credentials used to sign in.
            </li>
            <li>
              <span className="text-white/90">Content you create</span> — notes, tasks, documents,
              people, and other records you add to Recall.
            </li>
            <li>
              <span className="text-white/90">Connected service data</span> — when you choose to
              connect a third-party account (such as Google), the data that connector retrieves on
              your behalf. See “Google user data” below.
            </li>
          </ul>
        </Section>

        <Section title="Google user data">
          <p>
            If you connect a Google account, Recall requests <span className="text-white/90">read-only</span>{" "}
            access to the following, and only after you explicitly grant consent on Google’s
            authorization screen:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Gmail messages (read-only) — to surface and answer questions about your mail.</li>
            <li>Google Calendar events (read-only) — to provide schedule context.</li>
            <li>Google Contacts / People (read-only) — to enrich the people in your workspace.</li>
            <li>Google Drive files (read-only) — to reference recent documents.</li>
          </ul>
          <p>
            <span className="text-white/90">How we use it:</span> retrieved Google data is used
            solely to provide Recall’s features to you — displaying your information and answering
            your questions within your own account. We do not use it for advertising, and we do not
            sell it.
          </p>
          <p>
            <span className="text-white/90">How we store it:</span> access and refresh tokens are
            encrypted at rest. Retrieved content is stored in your private Recall workspace and is
            accessible only to your authenticated account.
          </p>
          <p>
            <span className="text-white/90">Limited Use:</span> Recall’s use and transfer of
            information received from Google APIs adheres to the{" "}
            <a
              className="text-indigo-300 hover:text-indigo-200"
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We do not transfer Google user data to third
            parties except as necessary to provide or improve the features you use, to comply with
            applicable law, or as part of a merger or acquisition; and we do not use it for serving
            advertisements.
          </p>
          <p>
            <span className="text-white/90">AI processing:</span> to answer your questions, relevant
            snippets of your content may be sent to our AI provider (OpenAI) for processing. This
            data is used only to generate your answer and is not used to train third-party models.
          </p>
        </Section>

        <Section title="How we use information">
          <ul className="list-disc space-y-2 pl-6">
            <li>To operate, maintain, and provide the features of Recall.</li>
            <li>To authenticate you and secure your account.</li>
            <li>To respond to your requests and answer questions you ask within the app.</li>
          </ul>
        </Section>

        <Section title="Sharing and disclosure">
          <p>
            We do not sell your personal information. We share data only with service providers that
            help us run Recall (such as hosting and AI inference), under obligations of
            confidentiality, or when required by law.
          </p>
        </Section>

        <Section title="Data retention and deletion">
          <p>
            You may disconnect a connected account at any time from the Connectors page, which stops
            further syncing. To request deletion of your account and associated stored data,
            including any data retrieved from Google, contact us at{" "}
            <a className="text-indigo-300 hover:text-indigo-200" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            . You can also revoke Recall’s access to your Google account at any time via{" "}
            <a
              className="text-indigo-300 hover:text-indigo-200"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
            >
              Google Account permissions
            </a>
            .
          </p>
        </Section>

        <Section title="Security">
          <p>
            We use industry-standard measures to protect your data, including encryption of secrets
            at rest and encrypted transport (HTTPS). No method of transmission or storage is
            completely secure, but we work to protect your information.
          </p>
        </Section>

        <Section title="Children’s privacy">
          <p>Recall is not directed to children under 13 and we do not knowingly collect their data.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be reflected by
            updating the “Last updated” date above.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy? Email{" "}
            <a className="text-indigo-300 hover:text-indigo-200" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <p className="mt-12 border-t border-white/10 pt-6 text-sm text-white/40">
          <a href="/terms" className="text-indigo-300 hover:text-indigo-200">
            Terms of Service
          </a>
        </p>
      </div>
    </div>
  );
}
