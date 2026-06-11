import QRCode from "qrcode";

export async function createQrDataUrl(url) {
  return QRCode.toDataURL(url, {
    width: 280,
    margin: 1
  });
}
