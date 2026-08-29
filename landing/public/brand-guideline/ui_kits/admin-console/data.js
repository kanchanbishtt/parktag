export const NAV = [
  {
    label: "Management",
    items: [
      { id: "overview", label: "Overview", icon: "grid" },
      { id: "etags", label: "E-Tags", icon: "tag" },
      { id: "issuance", label: "Batch Issuance", icon: "qr" },
      { id: "print-queue", label: "Print Queue", icon: "printer" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { id: "owners", label: "Owners", icon: "users" },
      { id: "activity", label: "Activity Feed", icon: "activity" },
      { id: "admins", label: "Admin Management", icon: "shield" },
    ],
  },
];

export const COUNTS = [
  { label: "Owners", value: "842" },
  { label: "Active tags", value: "1,284" },
  { label: "Requests · 24h", value: "63" },
  { label: "Print queue", value: "128" },
];

export const REGISTRATIONS = [
  { name: "Rohit Sharma", contact: "rohit.sharma@gmail.com · +91 98104 22187", plate: "DL 8C AB 1234", tag: "PT-0042-9KQ", when: "6 min ago" },
  { name: "Ananya Iyer", contact: "ananya.iyer@outlook.com · +91 99872 40113", plate: "KA 03 MH 8891", tag: "PT-0041-3TB", when: "38 min ago" },
  { name: "Imran Qureshi", contact: "imran.q@gmail.com · +91 90045 77621", plate: "MH 12 QR 0456", tag: "PT-0039-8LC", when: "2 hours ago" },
  { name: "Sneha Patil", contact: "sneha.patil@yahoo.in · +91 88790 31204", plate: "MH 14 GT 7720", tag: "PT-0038-1VX", when: "5 hours ago" },
];

export const REQUESTS = [
  { plate: "DL 8C AB 1234", reason: "Blocking my car", channel: "WhatsApp", when: "2 min ago", state: "delivered" },
  { plate: "KA 05 JN 4412", reason: "Lights left on", channel: "Masked call", when: "24 min ago", state: "connected" },
  { plate: "MH 12 QR 0456", reason: "Accident or emergency", channel: "Masked call", when: "1 hour ago", state: "connected" },
  { plate: "TN 09 BZ 6690", reason: "Parked in my spot", channel: "WhatsApp", when: "3 hours ago", state: "delivered" },
  { plate: "UP 16 CE 2201", reason: "Blocking my car", channel: "WhatsApp", when: "yesterday", state: "no answer" },
];

export const ETAGS = [
  { id: "PT-0042-9KQ", plate: "DL 8C AB 1234", owner: "Rohit Sharma", status: "active", plan: "premium", contacts: 7, created: "30 Jul 2026" },
  { id: "PT-0041-3TB", plate: "KA 03 MH 8891", owner: "Ananya Iyer", status: "active", plan: "free", contacts: 2, created: "30 Jul 2026" },
  { id: "PT-0039-8LC", plate: "MH 12 QR 0456", owner: "Imran Qureshi", status: "active", plan: "free", contacts: 11, created: "29 Jul 2026" },
  { id: "PT-0038-1VX", plate: "MH 14 GT 7720", owner: "Sneha Patil", status: "inactive", plan: "free", contacts: 0, created: "28 Jul 2026" },
  { id: "PT-0036-5RD", plate: "TN 09 BZ 6690", owner: "Karthik Menon", status: "active", plan: "premium", contacts: 4, created: "27 Jul 2026" },
  { id: "PT-0031-7WQ", plate: "UP 16 CE 2201", owner: "Farah Ahmed", status: "deleted", plan: "free", contacts: 1, created: "21 Jul 2026" },
];

export const OWNERS = [
  { name: "Rohit Sharma", email: "rohit.sharma@gmail.com", mobile: "+91 98104 22187", tags: 2, active: 2, plan: "premium", joined: "30 Jul 2026" },
  { name: "Ananya Iyer", email: "ananya.iyer@outlook.com", mobile: "+91 99872 40113", tags: 1, active: 1, plan: "free", joined: "30 Jul 2026" },
  { name: "Imran Qureshi", email: "imran.q@gmail.com", mobile: "+91 90045 77621", tags: 3, active: 2, plan: "free", joined: "29 Jul 2026" },
  { name: "Sneha Patil", email: "sneha.patil@yahoo.in", mobile: "+91 88790 31204", tags: 1, active: 0, plan: "free", joined: "28 Jul 2026" },
  { name: "Karthik Menon", email: "k.menon@fleetco.in", mobile: "+91 96322 88410", tags: 14, active: 14, plan: "premium", joined: "22 Jul 2026" },
];

export const PRINT_QUEUE = [
  { id: "PT-0121-4KD", batch: "BATCH-014", label: "July 2026 print run", requested: "30 Jul 2026", sticker: true },
  { id: "PT-0122-8XN", batch: "BATCH-014", label: "July 2026 print run", requested: "30 Jul 2026", sticker: true },
  { id: "PT-0123-2QP", batch: "BATCH-014", label: "July 2026 print run", requested: "30 Jul 2026", sticker: false },
  { id: "PT-0124-6BM", batch: "BATCH-015", label: "Fleet · Menon", requested: "29 Jul 2026", sticker: true },
  { id: "PT-0125-9TL", batch: "BATCH-015", label: "Fleet · Menon", requested: "29 Jul 2026", sticker: true },
];

export const PRINTED_QUEUE = [
  { id: "PT-0098-3AS", batch: "BATCH-012", label: "June 2026 print run", requested: "12 Jul 2026", sticker: true },
  { id: "PT-0099-7GH", batch: "BATCH-012", label: "June 2026 print run", requested: "12 Jul 2026", sticker: true },
];
