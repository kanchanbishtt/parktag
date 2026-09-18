// Capture at order creation, not at webhook time: webhook IP/UA belong to Razorpay.
import { isIP } from "node:net";

export function captureMetaCheckoutContext(request) {
  const cookies = request.cookies || {};
  const context = {};
  if (/^fb\.\d+\.\d{10,16}\.[A-Za-z0-9_-]{1,1024}$/.test(cookies._fbc || "")) {
    context.fbc = cookies._fbc;
  }
  if (/^fb\.\d+\.\d{10,16}\.\d{1,20}$/.test(cookies._fbp || "")) {
    context.fbp = cookies._fbp;
  }
  if (isIP(request.ip || "")) context.clientIp = request.ip;
  const ua = request.headers?.["user-agent"];
  if (typeof ua === "string" && ua.length <= 1024) context.userAgent = ua;
  // A fixed public checkout URL avoids sending address, token or query data.
  context.eventSourceUrl = "https://app.parktag.me/shop";
  return context;
}
