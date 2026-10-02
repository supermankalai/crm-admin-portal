"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new (options: { formats: string[] }) => Detector;

/**
 * Camera QR scanning via the browser's BarcodeDetector (Chrome, Edge, Android). Where it is not
 * available the button is hidden and staff use a USB scanner or type the code.
 */
export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Feature detection must run in the browser after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });

    const tick = async () => {
      if (stopped || !video.current) return;
      try {
        const codes = await detector.detect(video.current);
        if (codes[0]?.rawValue) {
          onCode(codes[0].rawValue);
          setOpen(false);
          return;
        }
      } catch {
        // frame not ready yet
      }
      timer = setTimeout(tick, 250);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
          void tick();
        }
      })
      .catch(() => setError("Camera access was blocked. Allow the camera, or use a scanner or type the code."));

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onCode]);

  if (!supported) return null;
  return (
    <div className="grid gap-2">
      {!open ? (
        <Button type="button" variant="outline" onClick={() => { setError(null); setOpen(true); }}>
          <Camera aria-hidden /> Scan QR with camera
        </Button>
      ) : (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline aria-label="Camera preview for QR scanning" />
          <Button type="button" size="icon" variant="secondary" className="absolute top-2 right-2" onClick={() => setOpen(false)} aria-label="Close camera">
            <X />
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
