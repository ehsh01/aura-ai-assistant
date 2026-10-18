import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Ear, Loader2, Mic, X } from "lucide-react";
import { useLocation } from "wouter";
import {
  getWakeWordConfig,
  transcribeWakeWordUtterance,
} from "@/lib/recall-api";
import { publishVoiceAsk } from "@/lib/voice-activation";
import { createWakeActivationHandler } from "@/lib/wake-word-activation";
import {
  canStartWakeWord,
  getWakeWordOptIn,
  isDesktopBrowser,
  setWakeWordOptIn,
  WAKE_WORD_PREF_KEY,
} from "@/lib/wake-word-settings";
import type { WakeWordRuntime } from "@/lib/wake-word-runtime";

type ListenerState =
  | "off"
  | "loading"
  | "listening"
  | "recording"
  | "transcribing"
  | "error";

type WakeWordContextValue = {
  serverEnabled: boolean;
  desktopBrowser: boolean;
  optedIn: boolean;
  state: ListenerState;
  setOptedIn: (enabled: boolean) => void;
};

const WakeWordContext = createContext<WakeWordContextValue | null>(null);

export function WakeWordProvider({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const [serverEnabled, setServerEnabled] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [optedIn, setOptedInState] = useState(getWakeWordOptIn);
  const [ownsListenerLease, setOwnsListenerLease] = useState(false);
  const [state, setState] = useState<ListenerState>("off");
  const runtimeRef = useRef<WakeWordRuntime | null>(null);
  const shouldListenRef = useRef(false);
  const desktopBrowser =
    typeof navigator !== "undefined" && isDesktopBrowser(navigator);

  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      getWakeWordConfig()
        .then((config) => {
          if (!cancelled) setServerEnabled(config.enabled);
        })
        .catch(() => {
          if (!cancelled) setServerEnabled(false);
        })
        .finally(() => {
          if (!cancelled) setConfigLoaded(true);
        });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const syncOptIn = (event: StorageEvent) => {
      if (event.key === WAKE_WORD_PREF_KEY || event.key === null) {
        setOptedInState(getWakeWordOptIn());
      }
    };
    window.addEventListener("storage", syncOptIn);
    return () => window.removeEventListener("storage", syncOptIn);
  }, []);

  const eligible =
    configLoaded &&
    canStartWakeWord({ serverEnabled, desktopBrowser, optedIn });
  useEffect(() => {
    if (!eligible) {
      setOwnsListenerLease(false);
      return;
    }
    if (!navigator.locks) {
      // Fail closed on old browsers rather than let multiple tabs upload the
      // same utterance. Current desktop browsers expose the Web Locks API.
      setOwnsListenerLease(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    void navigator.locks
      .request(
        "recall-wake-word-listener",
        { mode: "exclusive", signal: abortController.signal },
        async () => {
          if (cancelled) return;
          setOwnsListenerLease(true);
          await new Promise<void>((resolve) => {
            if (abortController.signal.aborted) resolve();
            else
              abortController.signal.addEventListener(
                "abort",
                () => resolve(),
                {
                  once: true,
                },
              );
          });
        },
      )
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setOwnsListenerLease(false);
      });
    return () => {
      cancelled = true;
      abortController.abort();
      setOwnsListenerLease(false);
    };
  }, [eligible]);

  const shouldListen = eligible && ownsListenerLease;
  shouldListenRef.current = shouldListen;

  useEffect(() => {
    if (!shouldListen) {
      setState("off");
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      void runtime?.dispose();
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setState("loading");
    void import("@/lib/wake-word-runtime")
      .then(async (wakeWord) => {
        if (cancelled) return;

        let activation: () => Promise<void> = async () => undefined;
        const runtime = await wakeWord.startWakeWordRuntime({
          onDetection: () => void activation(),
          signal: abortController.signal,
        });
        if (cancelled) {
          await runtime.dispose();
          return;
        }
        runtimeRef.current = runtime;
        activation = createWakeActivationHandler({
          pauseWakeWord: () => runtime.pause(),
          captureUtterance: runtime.capture,
          transcribe: async (blob, mimeType) => {
            const extension = mimeType.includes("wav")
              ? "wav"
              : mimeType.includes("mp4")
                ? "m4a"
                : "webm";
            const result = await transcribeWakeWordUtterance(blob, {
              locale: "en-US",
              filename: `wake-utterance.${extension}`,
            });
            return result.text;
          },
          publish: (transcript) => {
            navigate("/");
            window.setTimeout(
              () => publishVoiceAsk({ transcript, source: "wake-word" }),
              0,
            );
          },
          resumeWakeWord: async () => {
            if (shouldListenRef.current) {
              await runtime.resume();
              setState("listening");
            }
          },
          onState: setState,
          signal: abortController.signal,
        });
        setState("listening");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      abortController.abort();
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      void runtime?.dispose();
    };
  }, [navigate, shouldListen]);

  const setOptedIn = (enabled: boolean) => {
    setWakeWordOptIn(enabled);
    setOptedInState(enabled);
  };

  const value = useMemo(
    () => ({
      serverEnabled,
      desktopBrowser,
      optedIn,
      state,
      setOptedIn,
    }),
    [desktopBrowser, optedIn, serverEnabled, state],
  );

  return (
    <WakeWordContext.Provider value={value}>
      {children}
      {shouldListen && (
        <div
          className="fixed right-4 top-4 z-[90] flex items-center gap-2 rounded-full border border-cyan-200/20 bg-[#071410]/95 px-3 py-2 text-xs text-cyan-50 shadow-xl shadow-black/30 backdrop-blur"
          role="status"
          aria-live="polite"
          data-testid="wake-word-indicator"
        >
          {state === "loading" || state === "transcribing" ? (
            <Loader2 size={14} className="animate-spin text-[#7dffd9]" />
          ) : state === "recording" ? (
            <Mic size={14} className="animate-pulse text-red-300" />
          ) : (
            <Ear
              size={14}
              className={
                state === "listening" ? "text-[#7dffd9]" : "text-amber-300"
              }
            />
          )}
          <span>
            {state === "recording"
              ? "Listening to your question…"
              : state === "transcribing"
                ? "Transcribing on Recall…"
                : state === "error"
                  ? "Hey Recall needs attention"
                  : state === "loading"
                    ? "Starting Hey Recall…"
                    : 'Listening for "Hey Recall"'}
          </span>
          <button
            type="button"
            onClick={() => setOptedIn(false)}
            className="ml-1 rounded-full p-1 text-white/55 hover:bg-white/10 hover:text-white"
            aria-label="Turn off Hey Recall"
            title="Turn off Hey Recall"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </WakeWordContext.Provider>
  );
}

export function useWakeWord(): WakeWordContextValue {
  const value = useContext(WakeWordContext);
  if (!value)
    throw new Error("useWakeWord must be used within WakeWordProvider");
  return value;
}
