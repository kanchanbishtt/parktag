import type { MetadataRoute } from "next";

// Fixed per page, not `new Date()`: a lastModified that changes on every
// request tells crawlers everything changed every time, which they learn to
// ignore. Bump a date when that page's content actually changes.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://parktag.me";

  return [
    { url: base, lastModified: new Date("2026-09-22"), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/about`, lastModified: new Date("2026-06-27"), changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/contact`, lastModified: new Date("2026-08-04"), changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/terms`, lastModified: new Date("2026-06-27"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, lastModified: new Date("2026-09-23"), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/refund`, lastModified: new Date("2026-06-27"), changeFrequency: "yearly", priority: 0.3 },
  ];
}
