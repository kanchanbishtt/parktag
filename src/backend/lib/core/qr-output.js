import QRCode from "qrcode";

export async function createQrDataUrl(url) {
  return QRCode.toDataURL(url, {
    width: 280,
    margin: 1
  });
}

// Same 280px QR as createQrDataUrl, but as SVG markup: about a third of the
// bytes, crisp at any size, and cacheable by the browser as its own resource.
export async function createQrSvg(url) {
  return QRCode.toString(url, {
    type: "svg",
    width: 280,
    margin: 1
  });
}

// High-resolution QR for printing as a physical sticker. Larger module size +
// higher error-correction ("H") so it stays scannable even if the print is
// scuffed, partially covered, or printed small.
export async function createPrintQrDataUrl(url) {
  return QRCode.toDataURL(url, {
    width: 1024,
    margin: 2,
    errorCorrectionLevel: "H"
  });
}
