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
  const timeKey = value => String(value).replace(/[–—]/g, '-').replace(/\s/g, '');
  function groupedSchedule(schedule) {
    return schedule.filter(h => h.id === base(h.id)).map(h => {
      const members = schedule.filter(other => base(other.id) === h.id);
      return { ...h, capacity: members.reduce((sum, other) => sum + other.capacity, 0), court: [...new Set(members.map(other => other.court))].join(' / ') };
    });
  }
  const groupCount = (assignments, id) => Object.values(assignments).filter(value => holds(value).some(h => base(h) === base(id))).length;
  function wishIds(p, schedule) {
    const direct = holds(p.h);
    if (direct.length) return schedule.filter(h => direct.some(id => base(id) === base(h.id))).map(h => h.id);
    return schedule.filter(h => (p.dw || []).some(w => timeKey(w) === timeKey(days[h.day] + '-' + h.time))).map(h => h.id);
  }
  function outsideWishes(p, schedule) {
    if (!holds(p.h).length && !(p.dw || []).length) return false;
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
    const nameIndex = best.header.findIndex(c => ['navn', 'name'].includes(nameKey(c)));
    const data = best.rows.slice(best.index + 1).filter(row => row.some(c => c.trim()));
    if (!data.length) throw new Error('CSV-filen indeholder ingen spillere.');
    const seen = new Set();
    for (const row of data) {
      if (row.length !== best.header.length) throw new Error('En CSV-række har et andet antal kolonner end overskriften.');
      const name = nameKey(row[nameIndex]);
      if (!name) throw new Error('En CSV-række mangler navn.');
      if (seen.has(name)) throw new Error('Navnet forekommer flere gange i CSV: ' + row[nameIndex]);
      seen.add(name);
    }
    return { ...best, nameIndex, data };
  }
  function newPlayersCsv(text, existingNames) {
    const parsed = parseCsv(text), existing = new Set(existingNames.map(nameKey));
    const added = parsed.data.filter(row => !existing.has(nameKey(row[parsed.nameIndex])));
    for (const row of added) {
      const name = nameKey(row[parsed.nameIndex]);
      if (existingNames.some(old => {
        old = nameKey(old);
        return old.includes('\uFFFD') && old.length === name.length && [...old].every((c, i) => c === '\uFFFD' || c === name[i]);
      })) throw new Error('Navnet ' + row[parsed.nameIndex] + ' kan allerede findes med beskadigede tegn. Ret den eksisterende post fra originalfilen før import, så der ikke oprettes en dublet.');
    }
    const rows = [...parsed.rows.slice(0, parsed.index + 1), ...added];
    const csv = rows.map(row => row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    return { csv, added: added.length, skipped: parsed.data.length - added.length, names: added.map(row => row[parsed.nameIndex]) };
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
  return { nameKey, holds, base, hours, groupedSchedule, groupCount, wishIds, outsideWishes, formatWish, exportList, assignmentFor, parseRows, parseCsv, newPlayersCsv, decodeCsv };
});
