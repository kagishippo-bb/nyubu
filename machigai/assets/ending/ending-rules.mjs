// Presentation conditions only. No network, publishing, or system-date changes.
function offsetTime(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}
export function visibleEndingGuests(ending, playedAt) {
  const at = typeof playedAt === 'number' ? playedAt : offsetTime(playedAt);
  if (!Number.isFinite(at)) return [];
  return (ending.guests || []).filter(guest => {
    if (guest.confirmed !== true) return false;
    if (guest.alwaysVisible === true) return true;
    const starts = offsetTime(guest.date);
    return Number.isFinite(starts) && starts <= at;
  });
}
export function endingLayers(ending, playedAt) {
  return [
    {role:'background', src:ending.background},
    ...visibleEndingGuests(ending, playedAt).map(g => ({role:'guest', id:g.id, src:g.src})),
    {role:'foreground', src:ending.foreground},
  ];
}
export function displayPlayedAtJst(playedAt) {
  const at = typeof playedAt === 'number' ? playedAt : offsetTime(playedAt);
  if (!Number.isFinite(at)) return '';
  return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(at);
}
