// A plate identifies a vehicle, not a sticker. Several real tags may belong
// to the same vehicle; only legacy local placeholders are reconciled by plate.
export function dashboardTags(apiTags = [], saved = []) {
  const ids = new Set();
  const tags = apiTags.filter(tag => {
    const id = tag.id || tag._id;
    const key = id ? `id:${String(id)}` : tag.token ? `token:${tag.token}` : null;
    if (!key) return true;
    if (ids.has(key)) return false;
    ids.add(key);
    return true;
  });
  const plateOf = tag => (tag.plateNumber || tag.number || "").trim().toUpperCase();
  const plates = new Set(tags.map(plateOf).filter(Boolean));
  const localOnly = saved.filter(tag => {
    const id = tag.id || tag._id;
    return !(id && ids.has(`id:${String(id)}`)) && !plates.has(plateOf(tag));
  });
  return [...localOnly, ...tags];
}
