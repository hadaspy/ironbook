// Export the training schedule as an .ics file, so the iPhone Calendar app reminds you of workouts.
// (Home-screen web apps can't schedule local notifications without a push server — this gets you
// reliable reminders for free.)
import { store } from './store.js';
import { activeProgram, parseDay, weekStart, addDays, dayKey, pad } from './calc.js';
import { getEx } from './exercises.js';

const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const escText = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');

export function buildIcs({ durationMin = 60, alarmMin = 30 } = {}) {
  const p = activeProgram();
  if (!p) throw new Error('No active training plan to export.');
  const weeks = p.schedule.length / 7;
  const start = weekStart(parseDay(p.startDate || dayKey(weekStart())));
  const [hh, mm] = (store.settings.reminderTime || '07:00').split(':').map(Number);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ironbook//Workout//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escText('Workouts · ' + p.name)}`];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  p.schedule.forEach((planId, idx) => {
    if (!planId) return;
    const plan = store.get('plans', planId);
    if (!plan) return;
    // first occurrence on/after today
    let d = addDays(start, idx);
    while (d < today) d = addDays(d, 7 * weeks);
    d.setHours(hh, mm, 0, 0);
    const end = new Date(+d + durationMin * 60000);
    const list = plan.items.map((i) => `• ${getEx(i.exId).name} ${i.sets}×${i.repsMin}${i.repsMax !== i.repsMin ? '–' + i.repsMax : ''}`).join('\n');
    lines.push('BEGIN:VEVENT',
      `UID:ironbook-${p.id}-${idx}@workout`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(d)}`,
      `DTEND:${stamp(end)}`,
      `RRULE:FREQ=WEEKLY;INTERVAL=${weeks}`,
      `SUMMARY:${escText('🏋️ ' + plan.name)}`,
      `DESCRIPTION:${escText(`${list}\n\nOpen Ironbook to start.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(plan.name)}`, `TRIGGER:-PT${alarmMin}M`, 'END:VALARM',
      'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export async function shareIcs(opts) {
  const text = buildIcs(opts);
  const file = new File([text], 'workouts.ics', { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Workout schedule' });
    return 'shared';
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'workouts.ics' });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

export async function shareJson(data, name) {
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
