// Apple Health bridge. Web apps can't reach HealthKit, but they can open an Apple Shortcut and hand it text.
// The user builds a shortcut once ("Ironbook to Health", see README → Apple Health) that reads this JSON and
// runs the "Log Workout" action. It only writes to Health, it never reads from it.
import { store } from './store.js';
import { sessionStats, dayKey, pad, activity } from './calc.js';

export const healthEnabled = () => !!store.settings.healthOn;

function latestBodyweight() {
  const list = store.all('body').sort((a, b) => a.date.localeCompare(b.date));
  return list.length ? list[list.length - 1].kg : null;
}

const localStamp = (t) => { const d = new Date(t); return `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function healthPayload(s) {
  const act = activity(s.activity);
  const st = sessionStats(s);
  // Live workouts can be left open; cap at 4 h and fall back to 2.5 min per logged set
  let minutes = Math.round(st.duration / 60000);
  if (!minutes || minutes > 240) minutes = Math.min(240, Math.max(10, Math.round(st.sets * 2.5)));
  const kg = latestBodyweight() || 75;
  const calories = s.calories || Math.round(act[3] * kg * (minutes / 60)); // MET × kg × hours
  return {
    name: s.name, type: act[2], start: localStamp(s.startedAt), end: localStamp(s.startedAt + minutes * 60000),
    minutes, calories, caloriesEstimated: !s.calories, distanceKm: s.distanceKm || 0,
  };
}

export function sendToHealth(s) {
  const name = store.settings.healthShortcut || 'Ironbook to Health';
  const text = JSON.stringify(healthPayload(s));
  store.put('sessions', { ...s, healthAt: Date.now() });
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}`;
}
