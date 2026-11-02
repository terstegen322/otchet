// Парсер отчёта FatSecret (CSV) и сборка текста поста
(function (root) {
  // Символ перед пунктами списка. Поменяйте на "----", "•" и т.п. при желании
  const BULLET = '▫️';

  const NUTRIENTS = [
    { key: 'protein',   label: 'Белки',          unit: 'г',  re: /^Белк/,    pos: 7,  def: true },
    { key: 'fat',       label: 'Жиры',           unit: 'г',  re: /^Жир/,     pos: 2,  def: true },
    { key: 'carbs',     label: 'Углеводы',       unit: 'г',  re: /^Углев/,   pos: 4,  def: true },
    { key: 'fiber',     label: 'Клетчатка',      unit: 'г',  re: /^Клетч/,   pos: 5,  def: true },
    { key: 'sugar',     label: 'Сахар',          unit: 'г',  re: /^Сахар/,   pos: 6,  def: true },
    { key: 'chol',      label: 'Холестерин',     unit: 'мг', re: /^Холес/,   pos: 9,  def: true },
    { key: 'satfat',    label: 'Насыщ. жиры',    unit: 'г',  re: /^Н\/жир/,  pos: 3,  def: false },
    { key: 'sodium',    label: 'Натрий',         unit: 'мг', re: /^Натри/,   pos: 8,  def: false },
    { key: 'potassium', label: 'Калий',          unit: 'мг', re: /^Калий/,   pos: 10, def: false },
  ];

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
        } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c === '\r') { /* skip */ }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }

  function num(s) {
    if (s == null) return 0;
    const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    return isNaN(v) ? 0 : v;
  }

  function parseDiary(text) {
    const rows = parseCSV(text);

    // дата: «понедельник, ноября 2, 2026»
    let date = null;
    const dre = /([A-Za-zА-Яа-яЁё]+),\s*([A-Za-zА-Яа-яЁё]+)\s+(\d{1,2}),\s*(\d{4})/;
    for (const r of rows) {
      for (const cell of r) {
        const m = dre.exec(cell);
        if (m) { date = { weekday: m[1], month: m[2], day: +m[3], year: +m[4] }; break; }
      }
      if (date) break;
    }

    const hIdx = rows.findIndex(r => r[0] && r[0].trim() === 'Дата');
    if (hIdx < 0) throw new Error('Не нашёл строку с заголовками («Дата,Кал…»). Это точно отчёт FatSecret?');
    const header = rows[hIdx];

    const col = {};
    const calIdx = header.findIndex(h => /^Кал/.test(h.trim()));
    col.cal = calIdx >= 0 ? calIdx : 1;
    for (const n of NUTRIENTS) {
      const i = header.findIndex(h => n.re.test(h.trim()));
      col[n.key] = i >= 0 ? i : n.pos;
    }

    const totalRow = rows.find(r => r[0] && r[0].trim() === 'Всего');
    if (!totalRow) throw new Error('Не нашёл строку «Всего». Пустой день?');

    const totals = { cal: num(totalRow[col.cal]) };
    for (const n of NUTRIENTS) totals[n.key] = num(totalRow[col[n.key]]);

    // приёмы пищи: строки с ОДНИМ пробелом в начале и калориями
    const meals = [];
    for (const r of rows.slice(hIdx + 1)) {
      const name = r[0] || '';
      if (/^ \S/.test(name) && r.length >= 10) {
        const cal = num(r[col.cal]);
        if (cal > 0) meals.push({ name: name.trim(), cal });
      }
    }

    return { date, totals, meals };
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // "отжимания 150, приседания 10" -> [{name, rest}]
  function parseExercises(text) {
    return (text || '')
      .split(/\n|;|,(?=\s*[^\d\s])/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        const m = /^(\D+?)\s*[:—–-]?\s*(\d.*)$/.exec(s);
        return m ? { name: cap(m[1].trim()), rest: m[2].trim() } : { name: cap(s), rest: '' };
      });
  }

  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  const OK = '✅', NO = '❌';

  function buildPost(o) {
    const d = o.diary.date, t = o.diary.totals;
    const L = [];

    let head = '📅 ' + (d ? `${d.day} ${d.month}, ${d.weekday}` : 'Отчёт');
    if (o.dayNumber) head += ` · день ${o.dayNumber}`;
    L.push(head, '');

    L.push(`Английский ${o.english ? OK : NO}`);
    if (o.steps) L.push(`Шаги ${fmt(o.steps)} ${o.steps >= o.stepsGoal ? OK : NO}`);

    L.push(`Тренировка ${o.workout ? OK : NO}`);
    if (o.workout) {
      for (const e of parseExercises(o.exercises)) {
        L.push(`${BULLET} ${e.name}${e.rest ? ' — ' + e.rest : ''}`);
      }
    }

    const over = Math.round(t.cal) - o.calGoal;
    let cl = `Калории ${Math.round(t.cal)}/${Math.round(o.calGoal)} ${over <= 0 ? OK : NO}`;
    if (over > 0) cl += ` (+${over})`;
    L.push(cl);

    if (o.showMeals && o.diary.meals.length) {
      L.push(`${BULLET} ` + o.diary.meals.map(m => `${m.name} ${fmt(m.cal)}`).join(' · '));
    }
    for (const n of NUTRIENTS) {
      if (o.nutrients.includes(n.key)) L.push(`${BULLET} ${n.label} ${fmt(t[n.key])} ${n.unit}`);
    }
    return L.join('\n');
  }

  const api = { parseCSV, parseDiary, parseExercises, buildPost, NUTRIENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diary = api;
})(typeof self !== 'undefined' ? self : this);
