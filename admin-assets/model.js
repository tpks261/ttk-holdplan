(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.TTKAdmin = model;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const days = { Mandag: 'man', Tirsdag: 'tir', Onsdag: 'ons', Torsdag: 'tor', Fredag: 'fre' };
  const nameKey = value => String(value || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
  const holds = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[;,]/)).map(x => String(x).trim()).filter(Boolean))];
  const base = id => String(Math.floor(Number(id)));
  const hours = p => Math.max(1, Number(p.t) || 1);
  function playerAge(player, today = new Date()) {
    const saved = Number(player.age);
    if (player.age !== '' && player.age !== null && player.age !== undefined && Number.isInteger(saved) && saved >= 0 && saved <= 120) return saved;
    const raw = player.birthdate;
    if (!raw) return null;
    let birth;
    if (raw instanceof Date) birth = raw;
    else {
      const value = String(raw).trim();
      const danish = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
      const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
      if (danish || iso) {
        let year = Number(danish ? danish[3] : iso[1]);
        if (year < 100) year += year > 30 ? 1900 : 2000;
        const month = Number(danish ? danish[2] : iso[2]) - 1;
        const day = Number(danish ? danish[1] : iso[3]);
        birth = new Date(year, month, day);
        if (birth.getFullYear() !== year || birth.getMonth() !== month || birth.getDate() !== day) return null;
      } else birth = new Date(value);
    }
    if (Number.isNaN(birth.getTime())) return null;
    const age = today.getFullYear() - birth.getFullYear() - (today.getMonth() < birth.getMonth() || today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate() ? 1 : 0);
    return age >= 0 && age <= 120 ? age : null;
  }
  const timeKey = value => String(value).replace(/[–—]/g, '-').replace(/\s/g, '');
  function groupedSchedule(schedule) {
    return schedule.filter(h => h.id === base(h.id)).map(h => {
      const members = schedule.filter(other => base(other.id) === h.id);
      return { ...h, capacity: members.reduce((sum, other) => sum + other.capacity, 0), court: [...new Set(members.map(other => other.court))].join(' / ') };
    });
  }
  const groupCount = (assignments, id) => Object.values(assignments).filter(value => holds(value).some(h => base(h) === base(id))).length;
  function noteWishIds(note, schedule) {
    const text = String(note || '').toLowerCase().replace(/[–—]/g, '-');
    const dayNames = {
      Mandag: ['mandag', 'monday'],
      Tirsdag: ['tirsdag', 'tuesday'],
      Onsdag: ['onsdag', 'wednesday'],
      Torsdag: ['torsdag', 'thursday'],
      Fredag: ['fredag', 'friday']
    };
    const wishedDays = Object.entries(dayNames).filter(([, names]) => names.some(name => new RegExp('\\b' + name + '\\b').test(text))).map(([day]) => day);
    const ranges = [...text.matchAll(/(?:fra\s*)?(\d{1,2})(?::(\d{2}))?\s*(?:-|til)\s*(\d{1,2})(?::(\d{2}))?/g)].map(match => ({
      start: Number(match[1]) * 60 + Number(match[2] || 0),
      end: Number(match[3]) * 60 + Number(match[4] || 0)
    })).filter(range => range.end > range.start);
    if (!wishedDays.length || !ranges.length) return [];
    return schedule.filter(h => {
      if (!wishedDays.includes(h.day)) return false;
      const times = String(h.time).replace(/[–—]/g, '-').match(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/);
      if (!times) return false;
      const start = Number(times[1]) * 60 + Number(times[2] || 0);
      const end = Number(times[3]) * 60 + Number(times[4] || 0);
      return ranges.some(range => start >= range.start && end <= range.end);
    }).map(h => h.id);
  }
  function wishIds(p, schedule) {
    const direct = holds(p.h);
    if (direct.length) return schedule.filter(h => direct.some(id => base(id) === base(h.id))).map(h => h.id);
    const structured = schedule.filter(h => (p.dw || []).some(w => timeKey(w) === timeKey(days[h.day] + '-' + h.time))).map(h => h.id);
    return structured.length ? structured : noteWishIds(p.note, schedule);
  }
  function outsideWishes(p, schedule) {
    if (!holds(p.h).length && !(p.dw || []).length) return false;
    // Summer checks availability even when a dedicated hold column also exists.
    if ((p.dw || []).length) return holds(p.a).some(id => {
      const h = schedule.find(h => base(h.id) === base(id));
      return h && !p.dw.some(w => timeKey(w) === timeKey(days[h.day] + '-' + h.time));
    });
    const wished = wishIds(p, schedule).map(base);
    return holds(p.a).some(id => !wished.includes(base(id)));
  }
  function formatWish(value) {
    const [day, slot] = String(value).split(/-(?=\d)/);
    return (Object.keys(days).find(name => days[name] === day) || day) + (slot ? ' · ' + slot : '');
  }
  function exportList(players, season, date) {
    const assigned = players.filter(p => holds(p.a).length).slice().sort((a, b) => Number(holds(a.a)[0]) - Number(holds(b.a)[0]));
    const unassigned = players.filter(p => !holds(p.a).length);
    const lines = ['TTK Holdtildeling – ' + season, 'Eksporteret: ' + date, '', `=== TILDELTE SPILLERE (${assigned.length} stk) ===`, ''];
    assigned.forEach(p => lines.push(p.n + ' → ' + holds(p.a).map(id => 'Hold ' + id).join(', ')));
    if (unassigned.length) lines.push('', `=== IKKE TILDELT ENDNU (${unassigned.length} stk) ===`, ...unassigned.map(p => '  - ' + p.n));
    return lines.join('\n');
  }
  function assignmentFor(name, assignments) {
    // Prefer exact keys. Preserve the original backend key when names differ only in whitespace/case.
    if (Object.prototype.hasOwnProperty.call(assignments, name)) return { key: name, holds: holds(assignments[name]) };
    const keys = Object.keys(assignments).filter(n => nameKey(n) === nameKey(name));
    if (keys.length > 1) throw new Error('Flere tildelinger matcher navnet ' + name + '. Afklar navnet før redigering.');
    return { key: keys[0] || name, holds: holds(assignments[keys[0]]) };
  }
  function parseRows(text, delimiter) {
    const rows = []; let row = [], cell = '', quoted = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || !cell.trim()) quoted = !quoted;
        else cell += c;
      } else if (!quoted && c === delimiter) { row.push(cell); cell = ''; }
      else if (!quoted && (c === '\n' || c === '\r')) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (quoted) throw new Error('CSV indeholder et uafsluttet anførselstegn.');
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function parseCsv(text) {
    if (String(text).includes('\uFFFD')) throw new Error('CSV-filen indeholder allerede beskadigede tegn (�). Brug den originale fil, så navn og ønsker bevares korrekt.');
    let best = null;
    for (const delimiter of [';', ',', '\t']) {
      let rows; try { rows = parseRows(text, delimiter); } catch (_) { continue; }
      const index = rows.findIndex(row => row.some(c => ['navn', 'name'].includes(nameKey(c))));
      if (index < 0) continue;
      if (!best || rows[index].length > best.header.length) best = { rows, index, header: rows[index], delimiter };
    }
    if (!best) throw new Error('Navn/Name blev ikke fundet. Første linje: ' + String(text).split(/\r?\n/)[0].slice(0, 160));
    while (best.header.length && !best.header[best.header.length - 1].trim()) best.header.pop();
    const nameIndex = best.header.findIndex(c => ['navn', 'name'].includes(nameKey(c)));
    const data = best.rows.slice(best.index + 1).filter(row => row.some(c => c.trim()));
    if (!data.length) throw new Error('CSV-filen indeholder ingen spillere.');
    const seen = new Set();
    for (const row of data) {
      while (row.length > best.header.length && !row[row.length - 1].trim()) row.pop();
      if (row.length !== best.header.length) throw new Error('En CSV-række har et andet antal kolonner end overskriften.');
      const name = nameKey(row[nameIndex]);
      if (!name) throw new Error('En CSV-række mangler navn.');
      if (seen.has(name)) throw new Error('Navnet forekommer flere gange i CSV: ' + row[nameIndex]);
      seen.add(name);
    }
    return { ...best, nameIndex, data };
  }
  function newPlayersCsv(text, existingNames, updateExisting = false) {
    const parsed = parseCsv(text), existing = new Set(existingNames.map(nameKey));
    const added = parsed.data.filter(row => !existing.has(nameKey(row[parsed.nameIndex])));
    for (const row of added) {
      const name = nameKey(row[parsed.nameIndex]);
      if (existingNames.some(old => {
        old = nameKey(old);
        return old.includes('\uFFFD') && old.length === name.length && [...old].every((c, i) => c === '\uFFFD' || c === name[i]);
      })) throw new Error('Navnet ' + row[parsed.nameIndex] + ' kan allerede findes med beskadigede tegn. Ret den eksisterende post fra originalfilen før import, så der ikke oprettes en dublet.');
    }
    const rows = [...parsed.rows.slice(0, parsed.index + 1), ...(updateExisting ? parsed.data : added)];
    const csv = rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    return { csv, added: added.length, updated: updateExisting ? parsed.data.length - added.length : 0, skipped: updateExisting ? 0 : parsed.data.length - added.length, names: added.map(row => row[parsed.nameIndex]) };
  }
  function birthdateValue(value) {
    const raw = String(value || '').trim();
    const danish = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!danish && !iso) return null;
    let year = Number(danish ? danish[3] : iso[1]);
    if (year < 100) year += year > 30 ? 1900 : 2000;
    const day = Number(danish ? danish[1] : iso[3]);
    const month = Number(danish ? danish[2] : iso[2]);
    const result = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
    return playerAge({ birthdate: result }) === null ? null : result;
  }
  function birthdateUpdates(csvTexts, players) {
    const known = new Map(), ambiguous = new Set();
    players.forEach(player => {
      const key = nameKey(player.n);
      if (known.has(key)) { ambiguous.add(key); known.delete(key); }
      else if (!ambiguous.has(key)) known.set(key, player);
    });
    const updates = new Map(), unmatched = new Set(), skippedAmbiguous = new Set();
    let existingDates = 0, missingDates = 0;
    for (const text of csvTexts) {
      const parsed = parseCsv(text);
      const dateIndex = parsed.header.findIndex(h => ['født', 'fødselsdato', 'fodselsdato', 'birthdate', 'birthday', 'date of birth'].includes(nameKey(h)));
      if (dateIndex < 0) throw new Error('CSV-filen mangler kolonnen Født/Fødselsdato.');
      for (const row of parsed.data) {
        const key = nameKey(row[parsed.nameIndex]);
        if (ambiguous.has(key)) { skippedAmbiguous.add(row[parsed.nameIndex]); continue; }
        const player = known.get(key);
        if (!player) { unmatched.add(row[parsed.nameIndex]); continue; }
        if (String(player.birthdate || '').trim()) { existingDates++; continue; }
        if (!String(row[dateIndex] || '').trim()) { missingDates++; continue; }
        const birthdate = birthdateValue(row[dateIndex]);
        if (!birthdate) throw new Error('Ugyldig fødselsdato for ' + player.n + ': ' + row[dateIndex]);
        const previous = updates.get(player.n);
        if (previous && previous.birthdate !== birthdate) throw new Error('CSV-filerne har forskellige fødselsdatoer for ' + player.n);
        updates.set(player.n, { name: player.n, birthdate });
      }
    }
    return { updates: [...updates.values()], unmatched: [...unmatched], skippedAmbiguous: [...skippedAmbiguous], existingDates, missingDates };
  }
  function decodeCsv(buffer) {
    const bytes = new Uint8Array(buffer);
    let text;
    if (bytes[0] === 255 && bytes[1] === 254) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    else if (bytes[0] === 254 && bytes[1] === 255) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch (_) { text = new TextDecoder('windows-1252', { fatal: true }).decode(bytes); }
    }
    if (text.includes('\uFFFD') || text.includes('\0')) throw new Error('Filen indeholder beskadigede tegn. Brug original-CSV’en.');
    return text;
  }
  return { nameKey, holds, base, hours, playerAge, birthdateValue, birthdateUpdates, groupedSchedule, groupCount, wishIds, outsideWishes, formatWish, exportList, assignmentFor, parseRows, parseCsv, newPlayersCsv, decodeCsv };
});
