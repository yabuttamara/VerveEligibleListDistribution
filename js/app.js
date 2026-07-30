/* ===================================================================
   Verve Distribution Portal — app.js
   Upload → Parse → Normalise → Split → Style → Download / Email
   =================================================================== */
(() => {
  'use strict';

  // ── Fixed output templates ─────────────────────────────────────────
  // These define exactly which columns appear in every output file,
  // regardless of what the source file looks like.
  const OUTPUT_TEMPLATES = {
    photoEligible: ['Ranking','Session Date','Session No','Client','Location','Session Type','Marketing Channel','Weekend','Rate','Brand','Canceled','No Show','Lead Source','Session Status'],
    photoNoShow:   ['Ranking','Session Date','Session No','Client','Location','Weekend','Marketing Channel','Session Type','Rate','Brand','Confirmed','No Show','Lead Source'],
    designEligible:['Ranking','Invoice Date','Invoice No','Client','Location','Session Type','Marketing Channel','Weekend','Rate','Brand','Appointment Date','Session No','Lead Source'],
    designNoShow:  ['Ranking','Appointment Date','Session No','Client','Location','Weekend','Marketing Channel','Session Type','Rate','Brand','No Show','Lead Source'],
  };

  // Column aliases: standardName → [possible source header names] (matched case-insensitively, trimmed)
  const COLUMN_ALIASES = {
    'Ranking':           ['ranking','ranKING'],
    'Session Date':      ['session date'],
    'Session No':        ['session no','session number'],
    'Client':            ['client'],  // also handled via First Name + Last Name
    'Location':          ['location','invoice location number'],
    'Session Type':      ['session type'],
    'Marketing Channel': ['marketing channel'],
    'Weekend':           ['weekend','weekend?','weekend? '],
    'Rate':              ['rate'],
    'Brand':             ['brand'],
    'Canceled':          ['canceled','cancelled'],
    'No Show':           ['no show'],
    'Lead Source':       ['lead source'],
    'Session Status':    ['session status'],
    'Confirmed':         ['confirmed'],
    'Invoice Date':      ['invoice date'],
    'Invoice No':        ['invoice no','invoice number'],
    'Appointment Date':  ['appointment date','apptmt date'],
  };

  // Possible names for the contractor name column
  const NAME_COL_ALIASES = ['photographer','designer','sales representative','contractor','name'];
  // Possible names for an email column in source data
  const EMAIL_COL_ALIASES = ['email address','email','e-mail','email addr'];
  // First/last name columns for combining into "Client"
  const FIRST_NAME_ALIASES = ['first name','firstname','given name'];
  const LAST_NAME_ALIASES  = ['last name','lastname','surname','family name'];

  // ── State ──────────────────────────────────────────────────────────
  const state = {
    files: { photoEligible: null, photoNoShow: null, designEligible: null, designNoShow: null, contacts: null },
    parsedData: { photoEligible: [], photoNoShow: [], designEligible: [], designNoShow: [] },
    contactMap: {},
    manifest: [],
  };

  const SKIP_NAMES = new Set(['assign photographer', 'assign designer', 'total']);
  const NUMERIC_COLUMNS = new Set(['rate', 'session no', 'invoice no']);
  const DATE_COLUMNS = new Set(['session date', 'invoice date', 'appointment date']);
  const LS_KEY = 'verve-portal-contacts';

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const norm = s => (s || '').toString().trim().toLowerCase();

  // ── Column mapper ──────────────────────────────────────────────────
  // Builds a mapping from standard output column → actual source header
  function buildColumnMap(sourceHeaders) {
    const map = {};
    const srcLower = sourceHeaders.map(h => (h || '').toString().trim().toLowerCase());

    for (const [stdName, aliases] of Object.entries(COLUMN_ALIASES)) {
      // Try exact match (case-insensitive, trimmed) with aliases
      for (const alias of aliases) {
        const idx = srcLower.indexOf(alias.toLowerCase());
        if (idx >= 0) { map[stdName] = sourceHeaders[idx]; break; }
      }
      // If no alias matched, try the standard name itself
      if (!map[stdName]) {
        const idx = srcLower.indexOf(stdName.toLowerCase());
        if (idx >= 0) map[stdName] = sourceHeaders[idx];
      }
    }
    return map;
  }

  function findColumn(sourceHeaders, aliases) {
    const srcLower = sourceHeaders.map(h => (h || '').toString().trim().toLowerCase());
    for (const alias of aliases) {
      const idx = srcLower.indexOf(alias.toLowerCase());
      if (idx >= 0) return sourceHeaders[idx];
    }
    return null;
  }

  // Map a source row to the standard output format
  function mapRow(srcRow, colMap, firstNameCol, lastNameCol) {
    const out = {};
    for (const [stdName, srcHeader] of Object.entries(colMap)) {
      out[stdName] = srcRow[srcHeader] != null ? srcRow[srcHeader] : '';
    }
    // Special: combine First Name + Last Name → Client if Client wasn't directly mapped
    if (!colMap['Client'] && firstNameCol && lastNameCol) {
      const first = (srcRow[firstNameCol] || '').toString().trim();
      const last  = (srcRow[lastNameCol]  || '').toString().trim();
      out['Client'] = [first, last].filter(Boolean).join(' ');
    }
    return out;
  }

  // ── localStorage contacts ──────────────────────────────────────────
  function loadSavedContacts() {
    try { const r = localStorage.getItem(LS_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; }
  }
  function saveContactsToLS(map) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
  }
  function mergeContacts(...sources) {
    const merged = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) { if (v && v.email) merged[k] = v; }
    }
    return merged;
  }
  function showSavedContactCount() {
    const count = Object.keys(loadSavedContacts()).length;
    const note = $('#contactsMemoryNote');
    note.textContent = count > 0 ? `${count} saved email${count !== 1 ? 's' : ''} remembered from last time` : '';
  }

  // ── Date helpers ───────────────────────────────────────────────────
  function excelDateToJS(serial) {
    if (serial instanceof Date) return serial;
    if (typeof serial === 'number') return new Date((serial - 25569) * 86400000);
    const parsed = new Date(serial);
    return isNaN(parsed) ? serial : parsed;
  }
  function fmtDate(val) {
    const d = excelDateToJS(val);
    if (!(d instanceof Date) || isNaN(d)) return val || '';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    return `${dd}-${mmm}-${d.getUTCFullYear()}`;
  }

  // ── File upload handling ───────────────────────────────────────────
  function initUploads() {
    $$('.upload-zone').forEach(zone => {
      const input = zone.querySelector('input[type="file"]');
      const key = zone.dataset.key;
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', e => {
        e.preventDefault(); zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(key, e.dataTransfer.files[0], zone);
      });
      input.addEventListener('change', () => { if (input.files.length) handleFile(key, input.files[0], zone); });
    });
  }
  function handleFile(key, file, zone) {
    state.files[key] = file;
    zone.classList.add('loaded');
    zone.querySelector('.zone-status').textContent = file.name;
    updateProcessButton();
  }
  function updateProcessButton() {
    const hasData = state.files.photoEligible || state.files.photoNoShow || state.files.designEligible || state.files.designNoShow;
    $('#btnProcess').disabled = !hasData;
    const parts = [];
    if (state.files.photoEligible) parts.push('Photo Eligible');
    if (state.files.photoNoShow) parts.push('Photo No Show');
    if (state.files.designEligible) parts.push('Design Eligible');
    if (state.files.designNoShow) parts.push('Design No Show');
    if (state.files.contacts) parts.push('Contacts');
    $('#uploadSummary').textContent = parts.length ? `${parts.length} file(s) loaded` : '';
  }

  // ── Parse Excel ────────────────────────────────────────────────────
  function readExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false, raw: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
          // Sanitise: convert stray Date objects in non-date columns back to numbers
          for (const row of rows) {
            for (const key of Object.keys(row)) {
              const kl = key.toLowerCase().trim();
              if (row[key] instanceof Date && !DATE_COLUMNS.has(kl)) {
                // Check extended date columns too
                const isDate = ['appointment date','apptmt date','invoice date','session date','payment due date','create date'].some(d => kl.includes(d) || d.includes(kl));
                if (!isDate) {
                  row[key] = Math.round(((row[key].getTime() / 86400000) + 25569) * 100) / 100;
                }
              }
            }
          }
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function parseContacts(rows) {
    const map = {};
    if (!rows.length) return map;
    const headers = Object.keys(rows[0]);
    let nameCol = null, emailCol = null;
    for (const h of headers) {
      const lc = h.toLowerCase().trim();
      if (!nameCol && (lc.includes('name') || lc === 'photographer' || lc === 'designer' || lc === 'contractor')) nameCol = h;
      if (!emailCol && (lc.includes('email') || lc.includes('e-mail'))) emailCol = h;
    }
    if (!nameCol) nameCol = headers[0];
    if (!emailCol) emailCol = headers.length > 1 ? headers[1] : null;
    if (!emailCol) return map;
    for (const r of rows) {
      const name = (r[nameCol] || '').toString().trim();
      const email = (r[emailCol] || '').toString().trim();
      if (name && email) map[norm(name)] = { name, email, source: 'uploaded' };
    }
    return map;
  }

  // Parse a data file: normalise rows to standard columns, extract names + emails
  function parseDataFile(rows, templateKey) {
    if (!rows.length) return { standardRows: [], emailsFound: {} };

    const srcHeaders = Object.keys(rows[0]);
    const colMap = buildColumnMap(srcHeaders);
    const nameCol = findColumn(srcHeaders, NAME_COL_ALIASES);
    const emailCol = findColumn(srcHeaders, EMAIL_COL_ALIASES);
    const firstNameCol = findColumn(srcHeaders, FIRST_NAME_ALIASES);
    const lastNameCol  = findColumn(srcHeaders, LAST_NAME_ALIASES);

    const emailsFound = {};
    const standardRows = [];

    for (const row of rows) {
      // Get contractor name
      const rawName = nameCol ? (row[nameCol] || '').toString().trim() : '';
      const nName = norm(rawName);
      if (!rawName || SKIP_NAMES.has(nName) || nName.startsWith('applied filter')) continue;

      // Map row to standard output columns
      const mapped = mapRow(row, colMap, firstNameCol, lastNameCol);
      mapped._name = rawName; // internal: keep the contractor name for grouping

      standardRows.push(mapped);

      // Extract email if present
      if (emailCol) {
        const email = (row[emailCol] || '').toString().trim();
        if (email && email.includes('@') && !emailsFound[nName]) {
          emailsFound[nName] = { name: rawName, email, source: 'source-data' };
        }
      }
    }

    return { standardRows, emailsFound };
  }

  function groupByName(rows) {
    const groups = {};
    for (const row of rows) {
      const name = row._name;
      if (!groups[name]) groups[name] = [];
      groups[name].push(row);
    }
    return groups;
  }

  // ── Excel generation ───────────────────────────────────────────────
  const COLORS = {
    eligible: { title: { bg: '3D5A47', fg: 'FFFFFF' }, header: { bg: '5A7D66', fg: 'FFFFFF' }, altRow: 'EFF5F1' },
    noShow:   { title: { bg: '8B3A3A', fg: 'FFFFFF' }, header: { bg: 'A85555', fg: 'FFFFFF' }, altRow: 'F5EAEA' },
  };

  async function generateContractorFile(name, role, eligibleRows, noShowRows, eligTemplate, nsTemplate, periodLabel) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(name);
    const maxCols = Math.max(eligTemplate.length, nsTemplate.length, 4);
    ws.columns = Array.from({ length: maxCols }, () => ({ width: 22 }));

    let rowIdx = 1;
    const titleRow = ws.getRow(rowIdx);
    titleRow.getCell(1).value = periodLabel ? `${name} — ${periodLabel}` : name;
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: '1A1A1A' } };
    titleRow.height = 28;
    ws.mergeCells(rowIdx, 1, rowIdx, maxCols);
    rowIdx++;
    ws.getRow(rowIdx).getCell(1).value = role === 'photographer' ? 'Photographer' : 'Designer';
    ws.getRow(rowIdx).getCell(1).font = { size: 10, color: { argb: '6B6B6B' }, italic: true };
    rowIdx += 2;

    // Eligible section
    const eligTitle = role === 'photographer' ? 'ELIGIBLE PHOTOGRAPHY SESSIONS' : 'ELIGIBLE DESIGN APPOINTMENTS';
    rowIdx = writeSectionTitle(ws, rowIdx, eligTitle, COLORS.eligible.title, maxCols);
    rowIdx = writeHeaders(ws, rowIdx, eligTemplate, COLORS.eligible.header);
    if (!eligibleRows.length) {
      const r = ws.getRow(rowIdx);
      r.getCell(1).value = 'No eligible sessions this period';
      r.getCell(1).font = { italic: true, color: { argb: '6B6B6B' } };
      ws.mergeCells(rowIdx, 1, rowIdx, maxCols); rowIdx++;
    } else {
      for (let i = 0; i < eligibleRows.length; i++)
        rowIdx = writeDataRow(ws, rowIdx, eligibleRows[i], eligTemplate, i % 2 === 1 ? COLORS.eligible.altRow : null);
      rowIdx = writeTotalRow(ws, rowIdx, eligibleRows, eligTemplate);
    }
    rowIdx += 2;

    // No show section
    const nsTitle = role === 'photographer' ? 'NO SHOW PHOTOGRAPHY SESSIONS' : 'NO SHOW DESIGN APPOINTMENTS';
    rowIdx = writeSectionTitle(ws, rowIdx, nsTitle, COLORS.noShow.title, maxCols);
    rowIdx = writeHeaders(ws, rowIdx, nsTemplate, COLORS.noShow.header);
    if (!noShowRows.length) {
      const r = ws.getRow(rowIdx);
      r.getCell(1).value = 'No no-show sessions this period';
      r.getCell(1).font = { italic: true, color: { argb: '6B6B6B' } };
      ws.mergeCells(rowIdx, 1, rowIdx, maxCols); rowIdx++;
    } else {
      for (let i = 0; i < noShowRows.length; i++)
        rowIdx = writeDataRow(ws, rowIdx, noShowRows[i], nsTemplate, i % 2 === 1 ? COLORS.noShow.altRow : null);
      rowIdx = writeTotalRow(ws, rowIdx, noShowRows, nsTemplate);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function writeSectionTitle(ws, rowIdx, title, colors, colspan) {
    const row = ws.getRow(rowIdx);
    row.getCell(1).value = title;
    row.getCell(1).font = { bold: true, size: 11, color: { argb: colors.fg } };
    for (let c = 1; c <= colspan; c++)
      row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.bg } };
    row.height = 24;
    ws.mergeCells(rowIdx, 1, rowIdx, colspan);
    return rowIdx + 1;
  }

  function writeHeaders(ws, rowIdx, cols, colors) {
    const row = ws.getRow(rowIdx);
    for (let i = 0; i < cols.length; i++) {
      const cell = row.getCell(i + 1);
      cell.value = cols[i];
      cell.font = { bold: true, size: 9, color: { argb: colors.fg } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.bg } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'CCCCCC' } } };
    }
    row.height = 22;
    return rowIdx + 1;
  }

  function writeDataRow(ws, rowIdx, dataRow, cols, altBg) {
    const row = ws.getRow(rowIdx);
    for (let i = 0; i < cols.length; i++) {
      const cell = row.getCell(i + 1);
      let val = dataRow[cols[i]];
      const colLower = cols[i].toLowerCase();
      if (NUMERIC_COLUMNS.has(colLower) && val != null && val !== '') {
        if (val instanceof Date) val = Math.round(((val.getTime() / 86400000) + 25569) * 100) / 100;
        else { const num = parseFloat(val); if (!isNaN(num)) val = num; }
      } else if (DATE_COLUMNS.has(colLower) && val) {
        val = fmtDate(val);
      } else if (val instanceof Date) {
        val = fmtDate(val);
      }
      if (val === true) val = 'Yes';
      if (val === false) val = 'No';
      cell.value = (val != null && val !== '') ? val : '';
      cell.font = { size: 9, color: { argb: '333333' } };
      cell.alignment = { vertical: 'middle' };
      if (colLower === 'rate' && typeof val === 'number') cell.numFmt = '$#,##0.00';
      if (altBg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altBg } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'DDDDDD' } } };
    }
    return rowIdx + 1;
  }

  function writeTotalRow(ws, rowIdx, dataRows, cols) {
    const row = ws.getRow(rowIdx);
    const rateIdx = cols.findIndex(c => c.toLowerCase() === 'rate');
    row.getCell(1).value = `Total: ${dataRows.length} session${dataRows.length !== 1 ? 's' : ''}`;
    row.getCell(1).font = { bold: true, size: 9, color: { argb: '333333' } };
    if (rateIdx >= 0) {
      const total = dataRows.reduce((sum, r) => {
        const v = parseFloat(r[cols[rateIdx]]);
        return sum + (isNaN(v) ? 0 : v);
      }, 0);
      const rateCell = row.getCell(rateIdx + 1);
      rateCell.value = total;
      rateCell.numFmt = '$#,##0.00';
      rateCell.font = { bold: true, size: 9, color: { argb: '333333' } };
    }
    for (let c = 1; c <= cols.length; c++)
      row.getCell(c).border = { top: { style: 'thin', color: { argb: '999999' } } };
    return rowIdx + 1;
  }

  // ── Main processing ────────────────────────────────────────────────
  async function processFiles() {
    const btn = $('#btnProcess');
    btn.disabled = true; btn.textContent = 'Processing…';
    try {
      const allSourceEmails = {};

      // Parse each uploaded data file → normalise to standard columns
      for (const key of ['photoEligible','photoNoShow','designEligible','designNoShow']) {
        if (state.files[key]) {
          const rows = await readExcel(state.files[key]);
          const { standardRows, emailsFound } = parseDataFile(rows, key);
          state.parsedData[key] = standardRows;
          Object.assign(allSourceEmails, emailsFound);
        } else {
          state.parsedData[key] = [];
        }
      }

      // Build contact map: localStorage → source-data emails → uploaded file
      const savedContacts = loadSavedContacts();
      let uploadedContacts = {};
      if (state.files.contacts) {
        const rows = await readExcel(state.files.contacts);
        uploadedContacts = parseContacts(rows);
      }
      // Priority: saved < source-data < uploaded < (manual edits happen later in UI)
      state.contactMap = mergeContacts(savedContacts, allSourceEmails, uploadedContacts);
      saveContactsToLS(state.contactMap);

      // Build contractor list (unique per name+role)
      const contractors = new Map();
      function addContractors(rows, role) {
        for (const row of rows) {
          const name = row._name;
          const nName = norm(name);
          const key = nName + '|' + role;
          if (!contractors.has(key)) contractors.set(key, { name, role });
        }
      }
      if (state.parsedData.photoEligible.length) addContractors(state.parsedData.photoEligible, 'photographer');
      if (state.parsedData.photoNoShow.length) addContractors(state.parsedData.photoNoShow, 'photographer');
      if (state.parsedData.designEligible.length) addContractors(state.parsedData.designEligible, 'designer');
      if (state.parsedData.designNoShow.length) addContractors(state.parsedData.designNoShow, 'designer');

      const photoEligGroups = groupByName(state.parsedData.photoEligible);
      const photoNSGroups   = groupByName(state.parsedData.photoNoShow);
      const designEligGroups= groupByName(state.parsedData.designEligible);
      const designNSGroups  = groupByName(state.parsedData.designNoShow);

      const total = contractors.size;
      showProgress('Generating files…', 0, total);
      const periodLabel = $('#periodLabel').value.trim();
      const manifest = [];
      let count = 0;

      for (const [compositeKey, info] of contractors) {
        const { name, role } = info;
        const nName = norm(name);
        let eligRows, nsRows, eligTemplate, nsTemplate;

        if (role === 'photographer') {
          eligRows = photoEligGroups[name] || [];
          nsRows = photoNSGroups[name] || [];
          eligTemplate = OUTPUT_TEMPLATES.photoEligible;
          nsTemplate = OUTPUT_TEMPLATES.photoNoShow;
        } else {
          eligRows = designEligGroups[name] || [];
          nsRows = designNSGroups[name] || [];
          eligTemplate = OUTPUT_TEMPLATES.designEligible;
          nsTemplate = OUTPUT_TEMPLATES.designNoShow;
        }

        const blob = await generateContractorFile(name, role, eligRows, nsRows, eligTemplate, nsTemplate, periodLabel);
        const contact = state.contactMap[nName];
        manifest.push({
          name, role,
          email: contact ? contact.email : '',
          emailSource: contact ? (contact.source || 'saved') : '',
          eligibleCount: eligRows.length,
          noShowCount: nsRows.length,
          blob, sendStatus: '',
        });
        count++;
        showProgress('Generating files…', count, total);
      }

      manifest.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'photographer' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      state.manifest = manifest;
      hideProgress();
      showPreview();
    } catch (err) {
      console.error('Processing error:', err);
      alert('Error processing files: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Process Files';
    }
  }

  // ── Progress ───────────────────────────────────────────────────────
  function showProgress(title, current, total) {
    $('#progressOverlay').classList.remove('hidden');
    $('#progressTitle').textContent = title;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressText').textContent = `${current} / ${total}`;
  }
  function hideProgress() { $('#progressOverlay').classList.add('hidden'); }

  // ── Preview UI ─────────────────────────────────────────────────────
  function showPreview() {
    $('#step-upload').classList.remove('active');
    $('#step-preview').classList.add('active');
    const m = state.manifest;
    const photoCount = m.filter(x => x.role === 'photographer').length;
    const designCount = m.filter(x => x.role === 'designer').length;
    const missingEmail = m.filter(x => !x.email).length;
    const fromSource = m.filter(x => x.emailSource === 'source-data').length;

    $('#previewSubtitle').textContent =
      `${m.length} files generated — ${photoCount} photographer${photoCount !== 1 ? 's' : ''}, ${designCount} designer${designCount !== 1 ? 's' : ''}`;

    const warnings = [];
    if (fromSource > 0) warnings.push(`<div class="success-item"><strong>${fromSource} email${fromSource !== 1 ? 's' : ''} found in source data</strong> — auto-populated from your uploaded files.</div>`);
    if (missingEmail > 0) warnings.push(`<div class="warning-item"><strong>${missingEmail} contractor${missingEmail !== 1 ? 's' : ''} missing email.</strong> Type them in the Email column below — they'll be remembered for next time.</div>`);
    $('#warnings').innerHTML = warnings.join('');

    const table = document.createElement('table');
    table.className = 'preview-table';
    table.innerHTML = `
      <thead><tr>
        <th>Contractor</th><th>Role</th><th>Email</th>
        <th>Eligible</th><th>No Show</th><th>Download</th><th>Status</th>
      </tr></thead>
      <tbody>${m.map((item, idx) => {
        const srcLabel = item.emailSource === 'uploaded' ? 'from contact list'
          : item.emailSource === 'source-data' ? 'from source file'
          : item.emailSource === 'saved' || item.emailSource === 'manual' ? 'remembered' : '';
        return `<tr data-role="${item.role}" data-has-email="${item.email ? 'yes' : 'no'}" data-idx="${idx}">
          <td><strong>${item.name}</strong></td>
          <td><span class="role-badge ${item.role}">${item.role === 'photographer' ? 'Photographer' : 'Designer'}</span></td>
          <td>
            <input type="email" class="email-input" data-idx="${idx}" value="${item.email || ''}" placeholder="name@example.com">
            ${srcLabel ? `<span class="email-source">${srcLabel}</span>` : ''}
          </td>
          <td class="count-cell">${item.eligibleCount}</td>
          <td class="count-cell">${item.noShowCount}</td>
          <td><a class="download-link" data-idx="${idx}">Download</a></td>
          <td class="send-status" id="status-${idx}"></td>
        </tr>`;
      }).join('')}</tbody>`;
    $('#previewTable').innerHTML = '';
    $('#previewTable').appendChild(table);

    // Email input change → save
    table.querySelectorAll('.email-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const item = state.manifest[idx];
        const newEmail = input.value.trim();
        item.email = newEmail;
        if (newEmail) {
          state.contactMap[norm(item.name)] = { name: item.name, email: newEmail, source: 'manual' };
          input.classList.add('saved');
          let span = input.parentElement.querySelector('.email-source');
          if (!span) { span = document.createElement('span'); span.className = 'email-source'; input.parentElement.appendChild(span); }
          span.textContent = 'saved';
        } else {
          delete state.contactMap[norm(item.name)];
        }
        saveContactsToLS(state.contactMap);
        updateEmailWarning();
        input.closest('tr').dataset.hasEmail = newEmail ? 'yes' : 'no';
      });
    });

    // Download clicks
    table.querySelectorAll('.download-link').forEach(link => {
      link.addEventListener('click', () => {
        const item = state.manifest[parseInt(link.dataset.idx)];
        saveAs(item.blob, buildFilename(item));
      });
    });

    const savedTestEmail = localStorage.getItem('verve-portal-test-email') || '';
    $('#testEmail').value = savedTestEmail;
    $('#sendResults').innerHTML = '';
  }

  function updateEmailWarning() {
    const m = state.manifest;
    const missing = m.filter(x => !x.email).length;
    const w = [];
    if (missing > 0) w.push(`<div class="warning-item"><strong>${missing} contractor${missing !== 1 ? 's' : ''} missing email.</strong> Type them in the Email column below.</div>`);
    $('#warnings').innerHTML = w.join('');
  }

  function buildFilename(item) {
    const period = $('#periodLabel').value.trim();
    const parts = [item.name];
    if (period) parts.push(period);
    parts.push(item.role === 'photographer' ? 'Sessions' : 'Appointments');
    return parts.join(' - ') + '.xlsx';
  }

  // ── Filters ────────────────────────────────────────────────────────
  function initFilters() {
    document.addEventListener('click', e => {
      if (!e.target.matches('.filter-btn')) return;
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.dataset.filter;
      $$('.preview-table tbody tr').forEach(row => {
        let show = true;
        if (filter === 'photographer') show = row.dataset.role === 'photographer';
        else if (filter === 'designer') show = row.dataset.role === 'designer';
        else if (filter === 'no-email') show = row.dataset.hasEmail === 'no';
        row.classList.toggle('hidden-row', !show);
      });
    });
  }

  // ── Download All ───────────────────────────────────────────────────
  async function downloadAll() {
    const btn = $('#btnDownloadAll');
    btn.disabled = true; btn.textContent = 'Zipping…';
    try {
      const zip = new JSZip();
      for (const item of state.manifest) zip.file(buildFilename(item), await item.blob.arrayBuffer());
      const period = $('#periodLabel').value.trim() || 'Verve';
      saveAs(await zip.generateAsync({ type: 'blob' }), `${period} - All Contractor Files.zip`);
    } catch (err) { alert('Error creating ZIP: ' + err.message); }
    finally { btn.disabled = false; btn.textContent = 'Download All as ZIP'; }
  }

  // ── Export contacts ────────────────────────────────────────────────
  function exportContacts() {
    const contacts = loadSavedContacts();
    const entries = Object.values(contacts);
    if (!entries.length) { alert('No saved contacts to export.'); return; }
    const csv = 'Name,Email\n' + entries.map(c => `"${c.name}","${c.email}"`).join('\n');
    saveAs(new Blob([csv], { type: 'text/csv' }), 'verve-contractor-contacts.csv');
  }

  // ── Email sending ──────────────────────────────────────────────────
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  function buildEmailSubject(tpl, name, period) {
    return tpl.replace(/{name}/g, name).replace(/{period}/g, period);
  }
  function buildEmailBody(tpl, name, period) {
    return tpl.replace(/{name}/g, name).replace(/{period}/g, period).split('\n').map(l => l || '<br>').join('<br>');
  }
  async function sendEmail(to, subject, htmlBody, fileBase64, filename) {
    const resp = await fetch('/.netlify/functions/send-contractor-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html: htmlBody, attachment: fileBase64, filename }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Send failed');
    return data;
  }

  async function sendTestEmail() {
    const testEmail = $('#testEmail').value.trim();
    if (!testEmail) { alert('Enter your email address in the "Your Email" field first.'); return; }
    localStorage.setItem('verve-portal-test-email', testEmail);
    const testItem = state.manifest.find(m => m.email) || state.manifest[0];
    if (!testItem) { alert('No files to send.'); return; }
    const btn = $('#btnSendTest');
    btn.disabled = true; btn.textContent = 'Sending test…';
    try {
      const period = $('#periodLabel').value.trim();
      const subject = buildEmailSubject($('#emailSubject').value, testItem.name, period);
      const body = buildEmailBody($('#emailBody').value, testItem.name, period);
      const base64 = await blobToBase64(testItem.blob);
      await sendEmail(testEmail, `[TEST] ${subject}`, body, base64, buildFilename(testItem));
      $('#sendResults').innerHTML = `<div class="result-line success">Test email sent to ${testEmail} (using ${testItem.name}'s file)</div>`;
    } catch (err) {
      $('#sendResults').innerHTML = `<div class="result-line error">Test failed: ${err.message}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'Send Test to Me'; }
  }

  async function sendAllEmails() {
    const sendable = state.manifest.filter(m => m.email);
    if (!sendable.length) { alert('No contractors have email addresses. Add emails in the table first.'); return; }
    const msg = `Ready to send ${sendable.length} email${sendable.length !== 1 ? 's' : ''}?\n\n` +
      sendable.map(m => `  ${m.name} → ${m.email}`).join('\n') + '\n\nClick OK to send.';
    if (!confirm(msg)) return;
    const btn = $('#btnSendAll');
    btn.disabled = true;
    const results = $('#sendResults');
    results.innerHTML = '';
    const period = $('#periodLabel').value.trim();
    const subTpl = $('#emailSubject').value;
    const bodyTpl = $('#emailBody').value;
    let sent = 0, failed = 0;
    showProgress('Sending emails…', 0, sendable.length);

    for (const item of state.manifest) {
      const statusEl = $(`#status-${state.manifest.indexOf(item)}`);
      if (!item.email) { statusEl.textContent = 'No email'; statusEl.className = 'send-status skipped'; continue; }
      try {
        const base64 = await blobToBase64(item.blob);
        await sendEmail(item.email, buildEmailSubject(subTpl, item.name, period), buildEmailBody(bodyTpl, item.name, period), base64, buildFilename(item));
        statusEl.textContent = 'Sent'; statusEl.className = 'send-status sent'; sent++;
      } catch (err) {
        statusEl.textContent = 'Failed'; statusEl.className = 'send-status failed'; failed++;
        results.innerHTML += `<div class="result-line error">${item.name}: ${err.message}</div>`;
      }
      showProgress('Sending emails…', sent + failed, sendable.length);
      await new Promise(r => setTimeout(r, 200));
    }
    hideProgress();
    results.innerHTML = `<div class="result-line success"><strong>Done:</strong> ${sent} sent${failed ? `, ${failed} failed` : ''}</div>` + results.innerHTML;
    btn.disabled = false;
  }

  // ── Init ───────────────────────────────────────────────────────────
  function init() {
    initUploads();
    initFilters();
    showSavedContactCount();
    $('#btnProcess').addEventListener('click', processFiles);
    $('#btnDownloadAll').addEventListener('click', downloadAll);
    $('#btnBack').addEventListener('click', () => { $('#step-preview').classList.remove('active'); $('#step-upload').classList.add('active'); });
    $('#btnExportContacts').addEventListener('click', exportContacts);
    $('#btnSendTest').addEventListener('click', sendTestEmail);
    $('#btnSendAll').addEventListener('click', sendAllEmails);
  }
  init();
})();
