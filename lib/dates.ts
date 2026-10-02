/**
 * Zile lucratoare in Romania: luni-vineri, excluzand sarbatorile legale.
 * Folosit pentru salarii platite in "a N-a zi lucratoare" si pentru
 * bonuri de masa (acordate per zi lucrata).
 */

/** Data Pastelui ortodox in calendarul gregorian. Valabil 1900–2099. */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const julianMonth = Math.floor((d + e + 114) / 31); // 3 = martie, 4 = aprilie
  const julianDay = ((d + e + 114) % 31) + 1;
  // decalajul iulian → gregorian e de 13 zile in intervalul 1900–2099
  return new Date(year, julianMonth - 1, julianDay + 13);
}

const FIXED_HOLIDAYS: [number, number][] = [
  [1, 1], // Anul Nou
  [1, 2],
  [1, 6], // Boboteaza
  [1, 7], // Sf. Ioan
  [1, 24], // Unirea Principatelor
  [5, 1], // Ziua Muncii
  [6, 1], // Ziua Copilului
  [8, 15], // Adormirea Maicii Domnului
  [11, 30], // Sf. Andrei
  [12, 1], // Ziua Nationala
  [12, 25], // Craciun
  [12, 26],
];

const holidayCache = new Map<number, Set<string>>();

function key(month: number, day: number): string {
  return `${month}-${day}`;
}

/** Sarbatorile legale dintr-un an, ca set de chei "luna-zi". */
export function legalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const days = new Set<string>(FIXED_HOLIDAYS.map(([m, d]) => key(m, d)));

  const easter = orthodoxEaster(year);
  for (const offset of [-2, 0, 1, 49, 50]) {
    // Vinerea Mare, Pastele, a doua zi de Paste, Rusaliile, a doua zi de Rusalii
    const d = new Date(easter);
    d.setDate(d.getDate() + offset);
    days.add(key(d.getMonth() + 1, d.getDate()));
  }

  holidayCache.set(year, days);
  return days;
}

export function isWorkingDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  return !legalHolidays(date.getFullYear()).has(key(date.getMonth() + 1, date.getDate()));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Ziua din luna (1-31) pentru a n-a zi lucratoare, sau null daca luna
 * are mai putine zile lucratoare decat n.
 */
export function nthWorkingDayOfMonth(year: number, month: number, n: number): number | null {
  if (n < 1) return null;
  let count = 0;
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    if (isWorkingDay(new Date(year, month - 1, day))) {
      count++;
      if (count === n) return day;
    }
  }
  return null;
}

export function workingDaysInMonth(year: number, month: number): number {
  let count = 0;
  const total = daysInMonth(year, month);
  for (let day = 1; day <= total; day++) {
    if (isWorkingDay(new Date(year, month - 1, day))) count++;
  }
  return count;
}

/** Data ISO (YYYY-MM-DD) din componente locale — evita decalajul de fus orar al toISOString(). */
export function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
