import { ObjectId } from 'mongodb';
import { isInternalTag } from './internal-orders.js';
import { stickerSerialFor, tagLifecycleDefaults } from './tag-issuance.js';
import { getOrderTracking } from './order-tracking.js';
import { toE164 } from './phone.js';

export const COMMAND_HELP = `*ParkTag commands*
/parktag tag PT-Batch-002-000007 — owner, vehicle, batch and status
/parktag track PT-260917-00027 — Delhivery status (or enter its waybill)
/parktag order PT-260917-00027 — payment, shipment and linked stickers
/parktag customer +91XXXXXXXXXX — customer's tags and orders
/parktag batch Batch-002 — stock and activation counts
/parktag activate <sticker> — resume an already linked sticker
/parktag deactivate <sticker> — pause contact without unlinking
/parktag reset <sticker> confirm — unlink the owner; keep the printed QR usable
/parktag sales — today's and this month's real orders
/parktag help — this list
Replies are private to you. Reset keeps the account and order history; tags with vault documents or membership orders require admin review.`;

export class CommandError extends Error {}
const fail = (message) => { throw new CommandError(message); };
const safe = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').slice(0,160);
const money = (n) => `₹${(Number(n || 0) / 100).toFixed(2)}`;
export const labelForTag = (t) => t.serialNumber == null ? `PT-${String(t._id).slice(-8).toUpperCase()}` : `PT-${t.batchNumber || '01'}-${String(t.serialNumber).padStart(6, '0')}`;

export function parseCommand(text = '') {
  const parts = text.trim().split(/\s+/);
  const action = (parts[0] || 'help').toLowerCase();
  const allowed = ['help','tag','track','order','customer','batch','activate','deactivate','reset','sales'];
  if (!allowed.includes(action)) fail('Unknown command. Use /parktag help.');
  if (['help','sales'].includes(action)) {
    if (parts.length > 1) fail(`Use /parktag ${action}.`);
  } else if (!parts[1] || parts.length > (action === 'reset' ? 3 : 2)) {
    fail(`Use /parktag ${action} <identifier>${action === 'reset' ? ' confirm' : ''}.`);
  }
  if (action === 'reset' && parts[2] !== 'confirm') fail('Reset unlinks the owner and clears this sticker’s vehicle details. Use /parktag reset <sticker> confirm.');
  return { action, argument: parts[1] };
}

export async function findTag(collections, serial) {
  // Accept the bot's full batch label and the canonical printed serial. Never
  // identify a tag by the last digits alone: different batches repeat serials.
  const match = /^PT-(.+)-(\d{6})$/i.exec(serial || '');
  if (!match || match[1].length > 100) fail('Use the complete sticker ID, for example PT-Batch-002-000007.');
  const unit = Number(match[2]);
  const candidates = await collections.tags.find({ serialNumber: unit, deletedAt: null }).limit(101).toArray();
  if (candidates.length > 100) fail('Too many matching serials; use the admin tag lookup.');
  const input = serial.toLowerCase();
  const exact = candidates.filter(t => labelForTag(t).toLowerCase() === input);
  const matches = exact.length ? exact : candidates.filter(t => stickerSerialFor(t).toLowerCase() === input);
  if (matches.length !== 1) fail(matches.length ? 'This serial is ambiguous. Use the full batch label from the activation alert.' : 'Sticker not found. Check its complete batch and serial.');
  return matches[0];
}

export async function setTagStatus(collections, tag, action, actor) {
  if (!tag.ownerId) fail('This tag has no linked owner. The customer must scan and verify their number to activate it.');
  const status = action === 'activate' ? 'active' : 'inactive';
  const result = await collections.tags.updateOne(
    { _id: tag._id, ownerId: tag.ownerId, status: tag.status, deletedAt: null },
    { $set: { status, updatedAt: new Date().toISOString(), lastSlackAction: { action, actor, at: new Date().toISOString() } } }
  );
  if (!result.matchedCount) fail('The tag changed while this command ran. Look it up and try again.');
  return `${safe(labelForTag(tag))}: *${status}*. Owner remains linked.`;
}

// Retain physical identity only. A deny-list silently inherits newly added
// owner fields; an allow-list leaves the reset sticker fresh by default.
const STOCK_FIELDS = ['_id','token','batchNumber','batchLabel','serialNumber','issuanceRunId','issuedAt','runSerialStart','runSerialEnd','mountType','printStatus','printedAt','createdAt','internal','premium','marketingStock','copiesPrinted','stickerRequested'];
export function resetDocument(tag, actor, now) {
  const clean = { ...tagLifecycleDefaults() };
  for (const key of STOCK_FIELDS) if (tag[key] !== undefined) clean[key] = tag[key];
  return { ...clean, ownerId: null, vehicleLabel: null, vehicleType: null, plateNumber: null, status: 'unclaimed', updatedAt: now,
    resetAt: now, resetBy: actor, resetCount: (Number(tag.resetCount) || 0) + 1 };
}

export async function resetTag(collections, client, tag, actor, commandId) {
  if (!tag.ownerId && tag.status === 'unclaimed') return `${safe(labelForTag(tag))} is already unlinked and ready to claim.`;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await collections.tags.findOne({ _id: tag._id, ownerId: tag.ownerId, status: tag.status, deletedAt: null }, { session });
      if (!current) fail('The tag changed while this command ran. Look it up and try again.');
      const tagIds = [tag._id, String(tag._id)];
      const documents = await collections.vaultDocuments.countDocuments({ tagId: { $in: tagIds } }, { session });
      const memberships = await collections.membershipOrders.countDocuments({ tagId: { $in: tagIds } }, { session });
      if (documents || memberships) fail('Reset stopped: this tag has vault documents or membership orders. Review those in admin first; nothing was unlinked.');
      const now = new Date().toISOString();
      const { token, ...before } = current;
      await collections.tagResetHistory.insertOne({ _id: new ObjectId(), commandId, actor, tagId: tag._id, at: now, before }, { session });
      // A historical order keeps its record of the old assignment. The current
      // tag no longer claims that order; do not erase or re-open paid slots.
      const replaced = await collections.tags.replaceOne({ _id: tag._id, ownerId: tag.ownerId }, resetDocument(current, actor, now), { session });
      if (!replaced.matchedCount) fail('The tag changed while this command ran. Nothing was reset.');
      await collections.verificationSessions.deleteMany({ token: current.token }, { session });
      await collections.pendingCalls.deleteMany({ token: current.token }, { session });
    });
  } finally { await session.endSession(); }
  return `${safe(labelForTag(tag))}: *reset and unlinked*. The printed QR is unchanged and ready for a fresh activation. The previous customer’s account and order history were kept.`;
}

const realOrders = { internal: { $ne: true }, channel: { $nin: ['internal','giveaway'] }, deletedAt: null };
export async function runCommand(collections, env, command, actor, commandId, client) {
  const { action, argument } = command;
  if (action === 'help') return COMMAND_HELP;
  if (['tag','activate','deactivate','reset'].includes(action)) {
    const tag = await findTag(collections, argument);
    if (action === 'reset') return resetTag(collections, client, tag, actor, commandId);
    if (action !== 'tag') return setTagStatus(collections, tag, action, actor);
    const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }, { projection: { displayName: 1, mobile: 1, phone: 1 } }) : null;
    return `*${safe(labelForTag(tag))}*\nBatch: ${safe(tag.batchNumber)} · Status: ${safe(tag.status)}${isInternalTag(tag) ? ' · INTERNAL TEST' : ''}\nOwner: ${safe(owner?.displayName || 'Unlinked')}\nPhone: ${safe(owner?.mobile || owner?.phone || '—')}\nVehicle: ${safe(tag.vehicleLabel || '—')} ${safe(tag.plateNumber || '')}\nActivated: ${safe(tag.activatedAt || 'Not activated')}\nLinked order: ${safe(tag.assignedOrderNumber || 'None')}`;
  }
  if (action === 'order' || action === 'track') {
    if (!/^(PT-\d{6}-\d{5}|\d{8,20})$/i.test(argument)) fail('Enter a complete order number or numeric waybill.');
    const order = await collections.shopOrders.findOne(argument.toUpperCase().startsWith('PT-') ? { orderNumber: argument.toUpperCase(), deletedAt: null } : { waybill: argument, deletedAt: null });
    if (!order) fail('No ParkTag order matches that order number or waybill.');
    if (action === 'track') {
      if (!order.waybill) return `${safe(order.orderNumber)}: no waybill yet${order.deliveredInPerson ? ' (handed over in person)' : ''}.`;
      const tracking = await getOrderTracking(collections, env, order);
      const scan = tracking?.scans?.[0];
      return `*${safe(order.orderNumber)}* · Waybill ${safe(order.waybill)}\nStatus: ${safe(tracking?.status || 'Unavailable from Delhivery')}\nLast scan: ${safe(scan?.location || '—')} · ${safe(scan?.dateTime || tracking?.statusDateTime || '—')}\n${safe(tracking?.instructions || '')}\nSnapshot: ${safe(tracking?.fetchedAt || 'live request')}. Tracking is cached for up to 15 minutes.`;
    }
    const tags = await collections.tags.find({ assignedOrderNumber: order.orderNumber, deletedAt: null }).limit(30).toArray();
    return `*${safe(order.orderNumber)}*${order.internal ? ' · INTERNAL TEST' : ''}\n${safe(order.productName)} · ${money(order.amount)} · ${safe(order.status)}\nCustomer: ${safe(order.shippingAddress?.fullName || '—')}\nWaybill: ${safe(order.waybill || 'Not booked')}\nCurrently linked stickers: ${tags.map(t=>safe(labelForTag(t))).join(', ') || 'None yet'}`;
  }
  if (action === 'batch') {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(argument)) fail('Enter the batch label, for example Batch-002.');
    const rows = await collections.tags.aggregate([{ $match: { batchNumber: argument, deletedAt: null } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    return rows.length ? `*Batch ${safe(argument)}*\n${rows.map(r=>`${safe(r._id)}: ${r.n}`).join('\n')}\nTotal: ${rows.reduce((n,r)=>n+r.n,0)}${argument === 'Batch-002' ? '\nInternal testing only.' : ''}` : 'No stickers found for that exact batch label.';
  }
  if (action === 'customer') {
    if (!/^\+?[0-9]{10,15}$/.test(argument)) fail('Use a phone number with country code, for example +919876543210.');
    const phone = toE164(argument);
    const forms = [...new Set([phone, phone.replace(/^\+/,''), phone.startsWith('+91') ? phone.slice(3) : phone])];
    const owners = await collections.owners.find({ $or: [{ phone: { $in: forms } }, { mobile: { $in: forms } }] }, { projection: { _id: 1, displayName: 1 } }).limit(5).toArray();
    const tags = await collections.tags.find({ ownerId: { $in: owners.map(o=>o._id) }, deletedAt: null }).limit(21).toArray();
    const orders = await collections.shopOrders.find({ 'shippingAddress.phone': { $in: forms }, deletedAt: null }, { projection: { orderNumber: 1, status: 1, internal: 1 } }).sort({ createdAt:-1 }).limit(11).toArray();
    return `*Customer ${safe(phone)}*\n${owners.map(o=>safe(o.displayName)).join(', ') || 'No linked account'}\nStickers:\n${tags.slice(0,20).map(t=>`${safe(labelForTag(t))} · ${safe(t.status)}`).join('\n') || 'None'}${tags.length>20?'\nMore tags in admin.':''}\nRecent orders:\n${orders.slice(0,10).map(o=>`${safe(o.orderNumber)} · ${safe(o.status)}${o.internal?' · TEST':''}`).join('\n') || 'None'}`;
  }
  if (action === 'sales') {
    const ist = new Date(Date.now()+330*60000).toISOString();
    const today = new Date(`${ist.slice(0,10)}T00:00:00+05:30`).toISOString();
    const month = new Date(`${ist.slice(0,7)}-01T00:00:00+05:30`).toISOString();
    const rows = await collections.shopOrders.aggregate([{ $match: { ...realOrders, status: { $in: ['paid','cod'] }, createdAt: { $gte: month } } }, { $facet: { today: [{ $match: { createdAt: { $gte: today } } }, { $group: { _id: '$status', count: {$sum:1}, amount: {$sum:'$amount'} } }], month: [{ $group: { _id: '$status', count: {$sum:1}, amount: {$sum:'$amount'} } }] } }]).toArray();
    const format = entries => ['paid','cod'].map(status=>{const r=(entries||[]).find(x=>x._id===status);return `${status==='paid'?'Paid':'COD orders'}: ${r?.count||0} · ${money(r?.amount)}`;}).join('\n');
    return `*Today (IST)*\n${format(rows[0]?.today)}\n*This month*\n${format(rows[0]?.month)}\nInternal tests and giveaways excluded. Amazon orders are not in this ledger.`;
  }
}
