import QRCode from "qrcode";

/**
 * Server-rendered QR code for the member card. Encodes "FITCRM:<checkInCode>" — an opaque random
 * code, not the member's id or any personal data — which the check-in scanner understands.
 */
export async function MemberQr({ code, label }: { code: string; label: string }) {
  const svg = await QRCode.toString(`FITCRM:${code}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return (
    <figure className="grid w-fit gap-1">
      {/* The SVG is generated locally from a validated code, never from user HTML. */}
      <div className="size-36 rounded-md border bg-white p-1 [&_svg]:size-full" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="text-center font-mono text-xs tracking-widest">{code}</figcaption>
    </figure>
  );
}
