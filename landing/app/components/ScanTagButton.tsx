"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// `BarcodeDetector` is not in TypeScript's DOM lib yet. Declare only the shape
// this component uses rather than pulling in a polyfill's types.
type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

// Does a scanned QR's host belong to us?
//
// The redirect target is always APP_URL, so this gate is not about where the
// visitor lands — it decides whether a token is worth adopting at all. Without
// it, a sticker anyone prints can steer visitors onto arbitrary tags.
function isOwnHost(scanned: URL, app: URL): boolean {
  const host = scanned.hostname.toLowerCase();
  const appHost = app.hostname.toLowerCase();
  if (host === appHost) return true;

  // Same registrable domain, so stickers minted against parktag.me,
  // www.parktag.me or a staging subdomain still resolve.
  const registrable = appHost.split(".").slice(-2).join(".");
  if (registrable.includes(".") && (host === registrable || host.endsWith(`.${registrable}`))) {
    return true;
  }

  // Dev builds only: QRs minted by a local backend. Not compiled into a
  // production bundle. (A LAN-IP host is deliberately absent — the camera needs
  // a secure context, so an http:// LAN origin can never reach this code.)
  if (process.env.NODE_ENV !== "production" && (host === "localhost" || host === "127.0.0.1")) {
    return true;
  }

  return false;
}

// Turn a scanned QR value into the tag's URL on the app, or null if it isn't
// ours.
//
// Every ParkTag QR encodes an absolute URL — buildTagScanUrl() and
// buildClaimUrl() in the backend are the only producers, and both emit
// `${scanBase}/tag/{token}` or `${scanBase}/vehicle/{token}`. So this requires
// a parseable http(s) URL on one of our hosts whose whole path is a tag route.
//
// It deliberately does NOT accept a bare token: on a public landing page aimed
// at whatever QR a stranger points it at, `[A-Za-z0-9]{12,64}` also matches
// bitcoin addresses, tracking numbers and coupon codes, which would send those
// strangers' payloads into our URLs and access logs.
export function resolveTagUrl(raw: string, appUrl: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  let app: URL;
  try {
    app = new URL(appUrl);
  } catch {
    return null;
  }
  // Guards against a misconfigured APP_URL turning this into an open redirect
  // or a `javascript:` sink.
  if (app.protocol !== "http:" && app.protocol !== "https:") return null;

  let scanned: URL;
  try {
    scanned = new URL(value);
  } catch {
    return null; // not an absolute URL — no host to vouch for it
  }
  if (scanned.protocol !== "http:" && scanned.protocol !== "https:") return null;
  if (!isOwnHost(scanned, app)) return null;

  // Whole path must be the tag route; the token charset matches the backend's
  // :token([A-Za-z0-9]{12,64}).
  const route = scanned.pathname.match(/^\/(tag|vehicle)\/([A-Za-z0-9]{12,64})\/?$/);
  if (!route) return null;

  return `${appUrl.replace(/\/+$/, "")}/${route[1]}/${route[2]}`;
}

const POLL_MS = 350;

// QR glyph: three finder squares plus a few data cells. Uses currentColor so it
// always matches the button label, and `shrink-0` so it can't squash when the
// hero column narrows.
function QrGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3z" />
      <path d="M20.5 14v.01M14 20.5v.01M20.5 20.5v.01" />
    </svg>
  );
}

export function ScanTagButton({
  appUrl,
  className,
  label = "Scan a Tag",
}: { appUrl: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against a second redirect firing from an in-flight detect() call.
  const doneRef = useRef(false);

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const close = useCallback(() => {
    stopStream();
    setOpen(false);
  }, [stopStream]);

  // Release the camera if the component unmounts while the overlay is open.
  useEffect(() => stopStream, [stopStream]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  // Camera start is driven by `open` so React owns the lifecycle: no stream can
  // outlive the overlay, even if the user closes it mid-request.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    doneRef.current = false;

    const start = async () => {
      setStatus("Starting camera…");

      // getUserMedia only exists in a secure context (HTTPS, or localhost).
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(
          "This browser can't open the camera here. Open your phone's camera app and point it at the tag's QR instead."
        );
        return;
      }

      const Detector = getBarcodeDetectorCtor();
      if (!Detector) {
        setStatus(
          "Live scanning isn't supported on this browser. Open your phone's camera app and point it at the tag's QR. It opens the same page."
        );
        return;
      }

      let detector: BarcodeDetectorLike;
      try {
        detector = new Detector({ formats: ["qr_code"] });
      } catch {
        setStatus(
          "Live scanning isn't supported on this browser. Open your phone's camera app and point it at the tag's QR. It opens the same page."
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } }
        });
      } catch {
        setStatus(
          "Couldn't access the camera. Allow camera access for this site, or scan the tag's QR with your phone's camera app."
        );
        return;
      }

      // The overlay closed while permission was pending — drop the stream.
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopStream();
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject; detection still works once frames arrive.
      }

      if (cancelled) return;
      setStatus("Point the camera at the tag's QR code");

      timerRef.current = setInterval(async () => {
        if (doneRef.current || !videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (!codes?.length) return;

          const url = resolveTagUrl(codes[0]?.rawValue ?? "", appUrl);
          if (url) {
            doneRef.current = true;
            setStatus("Tag found, opening…");
            stopStream();
            window.location.href = url;
          } else {
            setStatus("That QR isn't a ParkTag. Try another.");
          }
        } catch {
          // Frame not ready yet; the next tick retries.
        }
      }, POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
    };
  }, [open, appUrl, stopStream]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "group inline-flex items-center gap-2.5 border border-[#FF2700] hover:bg-[#FF2700]/10 text-white font-semibold px-7 py-3.5 rounded-xl text-base transition-colors"}
      >
        <QrGlyph />
        {label}
      </button>

      {/* Portalled to <body> on purpose. This button sits inside <AnimateIn>,
          which keeps a `transform` on its wrapper even at rest. A transformed
          ancestor becomes the containing block for `position: fixed` children
          and traps their z-index, so rendering the overlay in place sized it to
          the hero column instead of the viewport and let the site header paint
          over it — leaving the camera running behind a backdrop that no longer
          covered the screen. `open` is false until a client click, so this
          never runs during SSR. */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Scan a ParkTag QR code"
          onClick={close}
        >
          <div
            className="bg-[#03162D] border border-white/15 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <h2 className="text-white font-bold text-lg">Scan a Tag</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close scanner"
                className="text-white/60 hover:text-white text-2xl leading-none px-2 transition-colors"
              >
                &times;
              </button>
            </div>

            <div className="relative bg-black aspect-[4/3]">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-white/70 rounded-2xl" />
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-white/70 text-sm leading-relaxed min-h-[2.5rem]">{status}</p>
              <p className="text-white/40 text-xs mt-2">
                Your phone number is never shared. Scanning opens the tag&apos;s contact page.
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
