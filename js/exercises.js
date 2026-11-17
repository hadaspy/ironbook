// Exercise library: 876 exercises from free-exercise-db (Unlicense, github.com/yuhonas/free-exercise-db)
// plus any custom exercises you add (stored with your data and synced).
import { store } from './store.js';

const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
let builtIn = [];
let byId = new Map();

export const MUSCLES = ['chest', 'shoulders', 'triceps', 'biceps', 'forearms', 'lats', 'middle back', 'lower back',
  'traps', 'neck', 'abdominals', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];
export const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'machine', 'body only', 'kettlebells', 'bands',
  'e-z curl bar', 'medicine ball', 'exercise ball', 'foam roll', 'other'];
export const CATEGORIES = ['strength', 'powerlifting', 'olympic weightlifting', 'strongman', 'plyometrics', 'cardio', 'stretching'];

// Muscle → broad group, used for the weekly "sets per muscle" view
export const GROUP = {
  chest: 'Chest', shoulders: 'Shoulders', triceps: 'Arms', biceps: 'Arms', forearms: 'Arms',
  lats: 'Back', 'middle back': 'Back', 'lower back': 'Back', traps: 'Back', neck: 'Back',
  abdominals: 'Core', quadriceps: 'Legs', hamstrings: 'Legs', glutes: 'Legs', calves: 'Legs', adductors: 'Legs', abductors: 'Legs',
};

function normalize(x, custom = false) {
  return {
    id: x.i ?? x.id, name: x.n ?? x.name, category: x.c ?? x.category ?? 'strength',
    equipment: x.e ?? x.equipment ?? 'other', level: x.l ?? x.level ?? '', mechanic: x.m ?? x.mechanic ?? '',
    force: x.f ?? x.force ?? '', primary: x.p ?? x.primary ?? [], secondary: x.s ?? x.secondary ?? [],
    steps: x.t ?? x.steps ?? [], images: (x.g ?? []).map((g) => IMG_BASE + g), custom,
    tracks: x.tracks || (['cardio', 'stretching'].includes(x.c ?? x.category) ? 'time' : 'weight'),
    notes: x.notes || '',
  };
}

export async function loadLibrary() {
  const res = await fetch('data/exercises.json');
  builtIn = (await res.json()).map((x) => normalize(x));
  reindex();
}

export function reindex() {
  byId = new Map(builtIn.map((e) => [e.id, e]));
  for (const c of store.all('customEx')) byId.set(c.id, normalize(c, true));
}

export const allExercises = () => [...byId.values()];
export const getEx = (id) => byId.get(id) || { id, name: id.replace(/_/g, ' '), primary: [], secondary: [], steps: [], images: [], equipment: 'other', category: 'strength', tracks: 'weight' };

// Exercises you've actually done float to the top of search results
export function searchExercises(q, { muscle, equipment, category, usedCounts } = {}) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let list = allExercises().filter((e) => {
    if (muscle && !e.primary.includes(muscle)) return false;
    if (equipment && e.equipment !== equipment) return false;
    if (category && e.category !== category) return false;
    const hay = (e.name + ' ' + e.equipment + ' ' + e.primary.join(' ')).toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const first = terms[0] || '';
  const score = (e) => {
    let s = 0;
    if (usedCounts?.[e.id]) s -= 1000 + usedCounts[e.id];
    if (e.custom) s -= 500;
    if (first && e.name.toLowerCase().startsWith(first)) s -= 100;
    if (e.category === 'strength') s -= 10;
    return s;
  };
  list.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  return list;
}
