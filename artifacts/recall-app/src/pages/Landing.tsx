import React from "react";
import { useLocation } from "wouter";
import { RecallLogo } from "@/components/RecallLogo";

/**
 * Public home page (no login required).
 * Required for Google OAuth branding verification — crawlers must see
 * the app name and description without signing in.
 */
export function Landing() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] text-white recall-safe-top recall-safe-bottom">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6">
        <div className="flex items-center gap-3">
          <RecallLogo size={40} />
          <span className="text-lg font-semibold tracking-tight">Recall</span>
        </div>
        <button
          type="button"
          onClick={() => setLocation("/login")}
          className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Sign in
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 pt-10">
        <p className="text-sm uppercase tracking-[0.3em] text-indigo-300/70">AI Personal Assistant</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Recall</h1>
        <p className="mt-4 max-w-xl text-lg text-white/60 leading-relaxed">
          Recall is your AI personal assistant for notes, tasks, people, documents, and connected
          accounts. Ask questions about your world and get answers grounded in your own data.
        </p>

        <div className="mt-10 space-y-6 text-white/65 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white">What Recall does</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Capture and organize notes, tasks, and knowledge in one place</li>
              <li>Ask natural-language questions about your notes, people, and schedule</li>
              <li>
                Optionally connect Google (Gmail, Calendar, Contacts, and Drive — read-only) so
                Recall can answer with context from those sources
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white">Privacy</h2>
            <p className="mt-2">
              Your data stays in your private workspace. Connected Google data is used only to
              provide features you request. See our{" "}
              <a href="/privacy" className="text-indigo-300 hover:text-indigo-200">
                Privacy Policy
              </a>{" "}
              and{" "}
              <a href="/terms" className="text-indigo-300 hover:text-indigo-200">
                Terms of Service
              </a>
              .
            </p>
          </section>
        </div>

        <button
          type="button"
          onClick={() => setLocation("/login")}
          className="mt-12 rounded-xl bg-indigo-500 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-400"
        >
          Sign in to Recall
        </button>
      </main>

      <footer className="mx-auto max-w-3xl border-t border-white/10 px-5 py-6 text-sm text-white/40">
        <div className="flex flex-wrap gap-4">
          <a href="/privacy" className="hover:text-white/70">
            Privacy Policy
          </a>
          <a href="/terms" className="hover:text-white/70">
            Terms of Service
          </a>
          <a href="mailto:ehernandez2@gmail.com" className="hover:text-white/70">
            Contact
          </a>
        </div>
        <p className="mt-3">© {new Date().getFullYear()} Recall · recall-app.net</p>
      </footer>
    </div>
  );
}
