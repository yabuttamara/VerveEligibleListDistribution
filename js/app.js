/* ===================================================================
   Verve Distribution Portal — app.js
   Upload → Normalise → Split → Style → Download / Email
   =================================================================== */
(() => {
  'use strict';

  // ── Column normalisation ───────────────────────────────────────────
  const COLUMN_RENAME_MAP = {
    'sales representative': '_NAME_',
    'photographer':         '_NAME_',
    'designer':             '_NAME_',
    'user name':            '_NAME_',

    'ranking':                    'Ranking',
    'ranKING':                    'Ranking',
    'session date':               'Session Date',
    'apptmt date':                'Appointment Date',
    'appointment date':           'Appointment Date',
    'inv date':                   'Invoice Date',
    'invoice date':               'Invoice Date',
    'session no':                 'Session No',
    'session number':             'Session No',
    'session no.':                'Session No',
    'invoice no':                 'Invoice No',
    'invoice number':             'Invoice No',
    'inv number':                 'Invoice No',
    'client':                     'Client',
    'client name':                'Client',
    'location':                   'Location',
    'invoice location number':    'Location',
    'session location number':    'Location',
    'session type':               'Session Type',
    'marketing channel':          'Marketing Channel',
    'lead source':                'Lead Source',
    'weekend':                    'Weekend',
    'weekend?':                   'Weekend',
    'weekend/ph':                 'Weekend',
    'weekend / ph':               'Weekend',
    'rate':                       'Rate',
    'brand':                      'Brand',
    'canceled':                   'Canceled',
    'cancelled':                  'Canceled',
    'no show':                    'No Show',
    'session status':             'Session Status',
    'confirmed':                  'Confirmed',
    'email':                      '_EMAIL_',
    'email address':              '_EMAIL_',
    'e-mail':                     '_EMAIL_',
    'first name':                 '_FIRST_',
    'last name':                  '_LAST_',
  };

  const KNOWN_HEADERS = new Set([
    'photographer','designer','sales representative','user name',
    'ranking','session date','session no','session number','client',
    'client name','location','invoice location number','session location number',
    'session type','marketing channel','lead source','weekend','weekend?',
    'weekend/ph','rate','brand','email','email address','apptmt date',
    'appointment date','inv date','invoice date','invoice no','invoice number',
    'inv number','first name','last name','canceled','cancelled','no show',
    'session status','confirmed',
  ]);

  // ── Location code mapping ─────────────────────────────────────────
  const LOCATION_CODES = {
    '100': 'Verve Portraits - Alexandria',
    '102': 'Verve Portraits - Richmond',
    '107': 'Verve Portraits - Fortitude Valley',
    '120': 'Verve Intimate - South Melbourne',
    '121': 'Verve Intimate - Surry Hills',
    '122': 'Verve Intimate - Fortitude Valley',
  };

  function resolveLocation(rawLocation, sessionNo) {
    const loc = String(rawLocation || '').trim();
    // If it's a 3-digit numeric code, resolve it
    if (/^\d{2,3}$/.test(loc) && LOCATION_CODES[loc]) return LOCATION_CODES[loc];
    // If it already contains a studio name, leave as-is
    if (loc && !/^\d+$/.test(loc)) return loc;
    // Derive from session number's first 3 digits
    const sn = String(sessionNo || '').trim();
    if (sn.length >= 3) {
      const prefix = sn.substring(0, 3);
      if (LOCATION_CODES[prefix]) return LOCATION_CODES[prefix];
    }
    return loc;
  }

  function detectBrandFromLocation(location) {
    const loc = String(location || '').toLowerCase();
    if (loc.includes('intimate')) return 'Intimate';
    if (loc.includes('portrait')) return 'Family';
    return '';
  }

  // ── Ranking normalisation ─────────────────────────────────────────
  const RANKING_ALIASES = { 'elevate': 'Elite' };

  const PRICE_TABLE = {
    'Platinum': { wd: 250, we: 300 },
    'Crystal':  { wd: 225, we: 275 },
    'Elite':    { wd: 200, we: 250 },
    'Gold':     { wd: 175, we: 225 },
    'Silver':   { wd: 150, we: 200 },
    'Bronze':   { wd: 125, we: 175 },
  };
  const NOSHOW_FLAT = { wd: 62.50, we: 87.50 };

  // Multiplier types — only for Family brand
  const UPLIFT_TYPES = new Set(['10+', 'newborn']);
  const UPLIFT_FACTOR = 1.5;

  function normalizeRanking(raw) {
    const s = (raw || '').toString().trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (RANKING_ALIASES[lower]) return RANKING_ALIASES[lower];
    // Title-case the first letter
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  // ── Output column templates ───────────────────────────────────────
  // Restored from the original portal's OUTPUT_TEMPLATES — the full
  // column set per section, in the original order. Only Lead Source
  // has been removed per Tamara's request. Invoice Date/Invoice No and
  // Appointment Date/Session No are DISTINCT fields, not aliases of
  // each other — Designer Eligible rows carry both an Invoice Date/No
  // (billing) and an Appointment Date/Session No (the actual booking).

  const PHOTO_ELIGIBLE_COLS = ['Ranking', 'Session Date', 'Session No', 'Client', 'Location', 'Session Type', 'Marketing Channel', 'Weekend', 'Rate', 'Brand', 'Canceled', 'No Show', 'Session Status'];
  const PHOTO_NOSHOW_COLS  = ['Ranking', 'Session Date', 'Session No', 'Client', 'Location', 'Weekend', 'Marketing Channel', 'Session Type', 'Rate', 'Brand', 'Confirmed', 'No Show'];

  const DESIGN_ELIGIBLE_COLS = ['Ranking', 'Invoice Date', 'Invoice No', 'Client', 'Location', 'Session Type', 'Marketing Channel', 'Weekend', 'Rate', 'Brand', 'Appointment Date', 'Session No'];
  const DESIGN_NOSHOW_COLS  = ['Ranking', 'Appointment Date', 'Session No', 'Client', 'Location', 'Weekend', 'Marketing Channel', 'Session Type', 'Rate', 'Brand', 'No Show'];


  // ── State ─────────────────────────────────────────────────────────
  const state = {
    files: { photoEligible: null, photoNoShow: null, designEligible: null, designNoShow: null, contacts: null },
    parsedData: { photoEligible: [], photoNoShow: [], designEligible: [], designNoShow: [] },
    headers: { photoEligible: [], photoNoShow: [], designEligible: [], designNoShow: [] },
    contactMap: {},
    manifest: [],
    corrections: [],  // rate corrections log
    rankingOverrides: [],  // Elevate ranking override log
  };

  const SKIP_NAMES = new Set(['assign photographer', 'assign designer', 'total']);
  const SECTION_MARKERS = {
    ELIGIBLE_PHOTO: /eligible\s+(photography\s+)?sessions?/i,
    NOSHOW_PHOTO:   /no\s*show\s+(photography\s+)?sessions?/i,
    ELIGIBLE_DESIGN: /eligible\s+(design\s+)?appointments?/i,
    NOSHOW_DESIGN:  /no\s*show\s+(design\s+)?appointments?/i,
  };
  const TOTAL_ROW = /^total:\s*\d+/i;
  const PLACEHOLDER_ROW = /^no (eligible|no[- ]?show) (sessions?|designs?|appointments?) this period$/i;

  const DATE_COLUMNS = new Set(['session date', 'appointment date', 'inv date', 'invoice date', 'apptmt date']);
  const LS_KEY = 'verve-portal-contacts';
  const ELEVATE_URL_KEY = 'verve-portal-elevate-url';

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const norm = s => (s || '').toString().trim().toLowerCase();

  // ── Elevate rankings integration ──────────────────────────────────
  let elevateRankings = null;  // { rankings: { name: { family, intimate } }, periodLabel }
  let elevateConnected = false;
  let elevatePeriodsList = [];  // [{ periodNumber, label }, ...] newest first

  function loadElevateUrl() {
    return localStorage.getItem(ELEVATE_URL_KEY) || '';
  }
  function saveElevateUrl(url) {
    localStorage.setItem(ELEVATE_URL_KEY, url.replace(/\/+$/, ''));
  }

  async function fetchElevateRankings(baseUrl, periodNumber) {
    let url = baseUrl.replace(/\/+$/, '') + '/api/rankings';
    if (periodNumber) url += `?period=${encodeURIComponent(periodNumber)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  async function fetchElevatePeriodsList(baseUrl) {
    const url = baseUrl.replace(/\/+$/, '') + '/api/rankings?list=1';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return Array.isArray(data.periods) ? data.periods : [];
  }

  function populatePeriodDropdown(periods, selectedPeriodNumber) {
    const select = $('#elevatePeriod');
    select.innerHTML = '';
    if (!periods.length) {
      select.innerHTML = '<option value="">No periods available</option>';
      select.disabled = true;
      return;
    }
    for (const p of periods) {
      const opt = document.createElement('option');
      opt.value = p.periodNumber;
      opt.textContent = p.label;
      select.appendChild(opt);
    }
    select.disabled = false;
    if (selectedPeriodNumber) select.value = String(selectedPeriodNumber);
  }

  async function testElevateConnection() {
    const urlInput = $('#elevateUrl');
    const result = $('#elevateTestResult');
    const btn = $('#btnTestElevate');
    const url = urlInput.value.trim();
    if (!url) { result.textContent = 'Enter a URL first'; result.className = 'elevate-test-result error'; return; }

    btn.disabled = true; btn.textContent = 'Testing…';
    result.textContent = ''; result.className = 'elevate-test-result';

    try {
      // Fetch the period list first so the dropdown shows options
      elevatePeriodsList = await fetchElevatePeriodsList(url);
      const data = await fetchElevateRankings(url);  // latest, to confirm + get default period
      const count = Object.keys(data.rankings || {}).length;
      saveElevateUrl(url);
      elevateRankings = data;
      elevateConnected = true;
      populatePeriodDropdown(elevatePeriodsList, data.periodNumber);
      result.textContent = `Connected — ${count} contractor${count !== 1 ? 's' : ''} from ${data.periodLabel || 'latest period'}`;
      result.className = 'elevate-test-result success';
      updateElevateStatus();
    } catch (err) {
      elevateConnected = false;
      result.textContent = `Failed: ${err.message}`;
      result.className = 'elevate-test-result error';
      updateElevateStatus();
    } finally {
      btn.disabled = false; btn.textContent = 'Test Connection';
    }
  }

  async function onPeriodChange() {
    const select = $('#elevatePeriod');
    const periodNumber = select.value;
    const url = loadElevateUrl();
    if (!url || !periodNumber) return;

    const result = $('#elevateTestResult');
    result.textContent = 'Loading period…';
    result.className = 'elevate-test-result';

    try {
      const data = await fetchElevateRankings(url, periodNumber);
      const count = Object.keys(data.rankings || {}).length;
      elevateRankings = data;
      elevateConnected = true;
      result.textContent = `Using ${count} contractor${count !== 1 ? 's' : ''} from ${data.periodLabel}`;
      result.className = 'elevate-test-result success';
      updateElevateStatus();
    } catch (err) {
      result.textContent = `Failed to load period: ${err.message}`;
      result.className = 'elevate-test-result error';
    }
  }

  function updateElevateStatus() {
    const statusEl = $('#elevateStatus');
    if (elevateConnected && elevateRankings) {
      const count = Object.keys(elevateRankings.rankings || {}).length;
      statusEl.textContent = `Connected (${count})`;
      statusEl.classList.add('connected');
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.classList.remove('connected');
    }
  }

  function lookupElevateRanking(contractorName, brand) {
    if (!elevateRankings || !elevateRankings.rankings) return null;
    const key = norm(contractorName);
    const entry = elevateRankings.rankings[key];
    if (!entry) return null;
    const b = (brand || '').toLowerCase();
    if (b === 'family') return entry.family || null;
    if (b === 'intimate') return entry.intimate || null;
    // If no brand detected, try family first then intimate
    return entry.family || entry.intimate || null;
  }

  function initElevateUI() {
    // Load saved URL
    const savedUrl = loadElevateUrl();
    if (savedUrl) $('#elevateUrl').value = savedUrl;

    // Toggle panel
    $('#elevateToggle').addEventListener('click', () => {
      const body = $('#elevateBody');
      const chevron = $('#elevateChevron');
      body.classList.toggle('hidden');
      chevron.classList.toggle('open');
    });

    // Test button
    $('#btnTestElevate').addEventListener('click', testElevateConnection);

    // Period dropdown change
    $('#elevatePeriod').addEventListener('change', onPeriodChange);

    // Auto-connect if we have a saved URL
    if (savedUrl) {
      Promise.all([
        fetchElevateRankings(savedUrl),
        fetchElevatePeriodsList(savedUrl),
      ]).then(([data, periods]) => {
        elevateRankings = data;
        elevateConnected = true;
        elevatePeriodsList = periods;
        populatePeriodDropdown(periods, data.periodNumber);
        updateElevateStatus();
      }).catch(() => {});
    }
  }

  // ── localStorage contacts ─────────────────────────────────────────
  function loadSavedContacts() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : {}; }
    catch { return {}; }
  }
  function saveContactsToLS(map) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
  }
  function mergeContacts(...sources) {
    const merged = {};
    for (const src of sources) {
      for (const [k, v] of Object.entries(src)) {
        if (v && v.email) merged[k] = v;
      }
    }
    return merged;
  }
  function showSavedContactCount() {
    const saved = loadSavedContacts();
    const count = Object.keys(saved).length;
    const note = $('#contactsMemoryNote');
    if (count > 0) note.textContent = `${count} saved email${count !== 1 ? 's' : ''} remembered from last time`;
    else note.textContent = '';
  }

  // ── Date helpers ──────────────────────────────────────────────────
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

  // ── File upload handling ──────────────────────────────────────────
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

  // ── Parse Excel ───────────────────────────────────────────────────
  function readExcelRaw(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false, raw: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // ── Find header row ───────────────────────────────────────────────
  // Scans first 15 rows for the one with the most recognised column names.
  function findHeaderRow(rawRows) {
    let bestIdx = 0, bestScore = 0;
    const limit = Math.min(rawRows.length, 15);
    for (let i = 0; i < limit; i++) {
      const row = rawRows[i];
      if (!Array.isArray(row)) continue;
      let score = 0;
      for (const cell of row) {
        const v = norm(cell);
        if (KNOWN_HEADERS.has(v)) score++;
      }
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    return { idx: bestIdx, score: bestScore };
  }

  // ── Normalise columns ────────────────────────────────────────────
  // Takes raw header row → builds { standardName: originalIdx } mapping.
  function buildColumnMap(headerRow) {
    const map = {};
    const nameIndices = [];
    let firstIdx = -1, lastIdx = -1;

    for (let i = 0; i < headerRow.length; i++) {
      const raw = (headerRow[i] || '').toString().trim();
      if (!raw) continue;
      const lower = raw.toLowerCase();
      const mapped = COLUMN_RENAME_MAP[lower];
      if (mapped === '_NAME_') {
        nameIndices.push(i);
      } else if (mapped === '_EMAIL_') {
        map['_EMAIL_'] = i;
      } else if (mapped === '_FIRST_') {
        firstIdx = i;
      } else if (mapped === '_LAST_') {
        lastIdx = i;
      } else if (mapped) {
        map[mapped] = i;
      } else {
        // Pass through unrecognised columns with original name
        map[raw] = i;
      }
    }
    // Name column: prefer explicit mapping
    if (nameIndices.length > 0) map['_NAME_'] = nameIndices[0];
    // First + Last → Client
    if (firstIdx >= 0 && lastIdx >= 0) {
      map['_FIRST_'] = firstIdx;
      map['_LAST_'] = lastIdx;
    }
    return map;
  }

  function extractRowValue(row, colMap, colName) {
    if (colName === 'Client' && '_FIRST_' in colMap && '_LAST_' in colMap) {
      const f = (row[colMap['_FIRST_']] || '').toString().trim();
      const l = (row[colMap['_LAST_']] || '').toString().trim();
      if (f || l) return `${f} ${l}`.trim();
    }
    const idx = colMap[colName];
    if (idx === undefined) return '';
    return row[idx];
  }

  // ── Detect new sectioned format ───────────────────────────────────
  // The new Finance format has contractor sections with embedded headers:
  //   Row: "ELIGIBLE PHOTOGRAPHY SESSIONS" (section marker)
  //   Row: column headers
  //   Rows: data
  //   Row: "Total: N sessions"
  //   blank rows
  //   Row: "NO SHOW PHOTOGRAPHY SESSIONS"
  //   Row: column headers
  //   Rows: data
  //   Row: "Total: N sessions"
  //
  // Multiple contractors may appear in one file, separated by these markers.

  function isSectionMarker(row) {
    const first = norm(row[0] || '');
    for (const rx of Object.values(SECTION_MARKERS)) {
      if (rx.test(first)) return true;
    }
    return false;
  }

  function getSectionType(text) {
    const s = (text || '').toString().trim();
    if (SECTION_MARKERS.ELIGIBLE_PHOTO.test(s)) return 'photoEligible';
    if (SECTION_MARKERS.NOSHOW_PHOTO.test(s)) return 'photoNoShow';
    if (SECTION_MARKERS.ELIGIBLE_DESIGN.test(s)) return 'designEligible';
    if (SECTION_MARKERS.NOSHOW_DESIGN.test(s)) return 'designNoShow';
    return null;
  }

  function detectSectionedFormat(rawRows) {
    let sectionCount = 0;
    for (const row of rawRows) {
      if (Array.isArray(row) && row.length > 0 && isSectionMarker(row)) sectionCount++;
      if (sectionCount >= 2) return true;
    }
    return false;
  }

  // ── Parse sectioned file ──────────────────────────────────────────
  function parseSectionedFile(rawRows) {
    const result = {
      photoEligible: [], photoNoShow: [],
      designEligible: [], designNoShow: [],
      headers: { photoEligible: [], photoNoShow: [], designEligible: [], designNoShow: [] },
      emails: {},
    };
    let currentSection = null;
    let currentColMap = null;
    let expectHeaders = false;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!Array.isArray(row) || row.length === 0) { continue; }

      const firstCell = (row[0] || '').toString().trim();

      // Check for section marker
      const sType = getSectionType(firstCell);
      if (sType) {
        currentSection = sType;
        expectHeaders = true;
        currentColMap = null;
        continue;
      }

      // Check for total row or placeholder
      if (TOTAL_ROW.test(firstCell) || PLACEHOLDER_ROW.test(firstCell)) {
        currentSection = null;
        currentColMap = null;
        continue;
      }

      // If we're expecting headers for this section, check this row
      if (expectHeaders && currentSection) {
        const testScore = row.reduce((sc, cell) => sc + (KNOWN_HEADERS.has(norm(cell)) ? 1 : 0), 0);
        if (testScore >= 3) {
          currentColMap = buildColumnMap(row);
          // Store headers for this section (using the standard output template)
          expectHeaders = false;
          continue;
        }
      }

      // If we have a section and column map, this is a data row
      if (currentSection && currentColMap) {
        const nameIdx = currentColMap['_NAME_'];
        const name = nameIdx !== undefined ? (row[nameIdx] || '').toString().trim() : '';
        const nName = norm(name);
        if (!name || SKIP_NAMES.has(nName) || nName.startsWith('applied filter')) continue;

        // Build normalised row object
        const obj = {};
        obj['_name'] = name;

        const isDesigner = currentSection.startsWith('design');
        const isNoShow = currentSection.includes('NoShow');

        // Get the right template columns
        let templateCols;
        if (isDesigner) templateCols = isNoShow ? DESIGN_NOSHOW_COLS : DESIGN_ELIGIBLE_COLS;
        else templateCols = isNoShow ? PHOTO_NOSHOW_COLS : PHOTO_ELIGIBLE_COLS;

        for (const col of templateCols) {
          let val = extractRowValue(row, currentColMap, col);
          obj[col] = val;
        }

        // Normalise ranking (Elevate → Elite)
        if (obj['Ranking']) obj['Ranking'] = normalizeRanking(obj['Ranking']);

        // Resolve location codes
        const sessionNoVal = obj['Session No'] || '';
        obj['Location'] = resolveLocation(obj['Location'], sessionNoVal);

        // Detect brand from location if not already present
        if (!obj['Brand']) obj['Brand'] = detectBrandFromLocation(obj['Location']);

        // Rate corrections
        applyRateCorrections(obj, name, isNoShow, isDesigner);

        // Extract email if present
        const emailIdx = currentColMap['_EMAIL_'];
        if (emailIdx !== undefined) {
          const email = (row[emailIdx] || '').toString().trim();
          if (email && email.includes('@')) {
            result.emails[norm(name)] = { name, email, source: 'data' };
          }
        }

        result[currentSection].push(obj);
      }
    }

    // Build headers from template columns
    result.headers.photoEligible = PHOTO_ELIGIBLE_COLS;
    result.headers.photoNoShow = PHOTO_NOSHOW_COLS;
    result.headers.designEligible = DESIGN_ELIGIBLE_COLS;
    result.headers.designNoShow = DESIGN_NOSHOW_COLS;

    return result;
  }

  // ── Parse flat (old) format ───────────────────────────────────────
  function parseFlatFile(rawRows, role, type) {
    const { idx: headerIdx } = findHeaderRow(rawRows);
    const headerRow = rawRows[headerIdx];
    const colMap = buildColumnMap(headerRow);

    const isDesigner = role === 'designer';
    const isNoShow = type === 'noShow';
    let templateCols;
    if (isDesigner) templateCols = isNoShow ? DESIGN_NOSHOW_COLS : DESIGN_ELIGIBLE_COLS;
    else templateCols = isNoShow ? PHOTO_NOSHOW_COLS : PHOTO_ELIGIBLE_COLS;

    const rows = [];
    const emails = {};

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!Array.isArray(row) || row.length === 0) continue;

      // Skip mid-file re-headers
      const firstCell = norm(row[0] || '');
      if (isSectionMarker([row[0]])) continue;
      if (TOTAL_ROW.test(firstCell) || PLACEHOLDER_ROW.test(firstCell)) continue;

      const nameIdx = colMap['_NAME_'];
      const name = nameIdx !== undefined ? (row[nameIdx] || '').toString().trim() : '';
      const nName = norm(name);
      if (!name || SKIP_NAMES.has(nName) || nName.startsWith('applied filter')) continue;

      const obj = {};
      obj['_name'] = name;

      for (const col of templateCols) {
        let val = extractRowValue(row, colMap, col);
        obj[col] = val;
      }

      if (obj['Ranking']) obj['Ranking'] = normalizeRanking(obj['Ranking']);
      const sessionNoVal = obj['Session No'] || '';
      obj['Location'] = resolveLocation(obj['Location'], sessionNoVal);
      if (!obj['Brand']) obj['Brand'] = detectBrandFromLocation(obj['Location']);

      applyRateCorrections(obj, name, isNoShow, isDesigner);

      // Extract email
      const emailIdx = colMap['_EMAIL_'];
      if (emailIdx !== undefined) {
        const email = (row[emailIdx] || '').toString().trim();
        if (email && email.includes('@')) emails[norm(name)] = { name, email, source: 'data' };
      }

      rows.push(obj);
    }

    return { rows, headers: templateCols, emails };
  }

  // ── Rate corrections ──────────────────────────────────────────────
  // Change #4: ×1.5 uplift for 10+/Newborn when Finance misses it
  // Change #6: No-show flat rate $62.50/$87.50 independent of ranking
  function applyRateCorrections(obj, contractorName, isNoShow, isDesigner) {
    const rateRaw = obj['Rate'];
    const rate = parseFloat(rateRaw);
    const ranking = obj['Ranking'] || '';
    const isWeekend = isTruthyYes(obj['Weekend']);
    const sessionType = (obj['Session Type'] || '').toString().trim().toLowerCase();
    const brand = (obj['Brand'] || '').toString().trim().toLowerCase();

    if (isNoShow) {
      // Change #6: No-show is always flat rate, independent of ranking
      const expectedRate = isWeekend ? NOSHOW_FLAT.we : NOSHOW_FLAT.wd;
      if (!isNaN(rate) && rate !== expectedRate) {
        state.corrections.push({
          name: contractorName, type: 'no-show-rate',
          msg: `No-show rate corrected from $${rate.toFixed(2)} to $${expectedRate.toFixed(2)} (flat rate)`,
        });
      }
      obj['Rate'] = expectedRate;
      return;
    }

    // Change #4: ×1.5 uplift for Family 10+/Newborn
    if (!isDesigner && ranking && PRICE_TABLE[ranking] && UPLIFT_TYPES.has(sessionType) && brand === 'family') {
      const baseRate = isWeekend ? PRICE_TABLE[ranking].we : PRICE_TABLE[ranking].wd;
      const expectedRate = baseRate * UPLIFT_FACTOR;
      if (!isNaN(rate) && rate > 0 && Math.abs(rate - expectedRate) > 0.01 && rate < expectedRate) {
        state.corrections.push({
          name: contractorName, type: 'uplift-correction',
          msg: `${sessionType} rate corrected from $${rate.toFixed(2)} to $${expectedRate.toFixed(2)} (×1.5 uplift)`,
        });
        obj['Rate'] = expectedRate;
      } else if (isNaN(rate) || rate === 0 || rate === '') {
        obj['Rate'] = expectedRate;
      }
    }
  }

  function isTruthyYes(val) {
    if (!val) return false;
    const s = val.toString().trim().toLowerCase();
    return s === 'yes' || s === 'y' || s === 'true' || s === '1';
  }

  // ── Contact parsing ───────────────────────────────────────────────
  function parseContacts(rawRows) {
    const { idx: headerIdx } = findHeaderRow(rawRows);
    const headerRow = rawRows[headerIdx];
    const colMap = buildColumnMap(headerRow);
    const map = {};
    const nameIdx = colMap['_NAME_'];
    const emailIdx = colMap['_EMAIL_'];
    if (nameIdx === undefined || emailIdx === undefined) {
      // Fallback: first two columns
      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!Array.isArray(row)) continue;
        const name = (row[0] || '').toString().trim();
        const email = (row[1] || '').toString().trim();
        if (name && email && email.includes('@')) map[norm(name)] = { name, email, source: 'uploaded' };
      }
      return map;
    }
    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!Array.isArray(row)) continue;
      const name = (row[nameIdx] || '').toString().trim();
      const email = (row[emailIdx] || '').toString().trim();
      if (name && email && email.includes('@')) map[norm(name)] = { name, email, source: 'uploaded' };
    }
    return map;
  }

  function getNameFromRow(obj) { return obj['_name'] || ''; }

  function groupByName(rows) {
    const groups = {};
    for (const row of rows) {
      const name = getNameFromRow(row);
      if (!groups[name]) groups[name] = [];
      groups[name].push(row);
    }
    return groups;
  }

  // ── Excel generation ──────────────────────────────────────────────
  const COLORS = {
    eligible: { title: { bg: '3D5A47', fg: 'FFFFFF' }, header: { bg: '5A7D66', fg: 'FFFFFF' }, altRow: 'EFF5F1' },
    noShow:   { title: { bg: '8B3A3A', fg: 'FFFFFF' }, header: { bg: 'A85555', fg: 'FFFFFF' }, altRow: 'F5EAEA' },
  };

  async function generateContractorFile(name, role, eligibleRows, noShowRows, eligibleCols, noShowCols, periodLabel) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(name);
    const maxCols = Math.max(eligibleCols.length, noShowCols.length, 4);
    ws.columns = Array.from({ length: maxCols }, () => ({ width: 22 }));

    let rowIdx = 1;
    // Title row
    const titleRow = ws.getRow(rowIdx);
    titleRow.getCell(1).value = periodLabel ? `${name} — ${periodLabel}` : name;
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: '1A1A1A' } };
    titleRow.height = 28;
    ws.mergeCells(rowIdx, 1, rowIdx, maxCols);
    rowIdx++;
    // Role row
    const roleRow = ws.getRow(rowIdx);
    roleRow.getCell(1).value = role === 'photographer' ? 'Photographer' : 'Designer';
    roleRow.getCell(1).font = { size: 10, color: { argb: '6B6B6B' }, italic: true };
    rowIdx += 2;

    // Change #8: Designer uses "design" instead of "session"
    const eligTitle = role === 'photographer' ? 'ELIGIBLE PHOTOGRAPHY SESSIONS' : 'ELIGIBLE DESIGN APPOINTMENTS';
    rowIdx = writeSectionTitle(ws, rowIdx, eligTitle, COLORS.eligible.title, maxCols);
    rowIdx = writeHeaders(ws, rowIdx, eligibleCols, COLORS.eligible.header);
    if (!eligibleRows.length) {
      const r = ws.getRow(rowIdx);
      r.getCell(1).value = role === 'photographer' ? 'No eligible sessions this period' : 'No eligible designs this period';
      r.getCell(1).font = { italic: true, color: { argb: '6B6B6B' } };
      ws.mergeCells(rowIdx, 1, rowIdx, eligibleCols.length || maxCols); rowIdx++;
    } else {
      for (let i = 0; i < eligibleRows.length; i++)
        rowIdx = writeDataRow(ws, rowIdx, eligibleRows[i], eligibleCols, i % 2 === 1 ? COLORS.eligible.altRow : null);
      rowIdx = writeTotalRow(ws, rowIdx, eligibleRows, eligibleCols, role);
    }
    rowIdx += 2;

    // Change #8: Designer no-show section title
    const nsTitle = role === 'photographer' ? 'NO SHOW PHOTOGRAPHY SESSIONS' : 'NO SHOW DESIGN APPOINTMENTS';
    rowIdx = writeSectionTitle(ws, rowIdx, nsTitle, COLORS.noShow.title, maxCols);

    // Change #6: Flat rate hint for no-show section
    const hintRow = ws.getRow(rowIdx);
    hintRow.getCell(1).value = 'Flat rate: $62.50 weekday / $87.50 weekend or public holiday (ranking does not apply)';
    hintRow.getCell(1).font = { italic: true, size: 8, color: { argb: '8B3A3A' } };
    ws.mergeCells(rowIdx, 1, rowIdx, maxCols);
    rowIdx++;

    rowIdx = writeHeaders(ws, rowIdx, noShowCols, COLORS.noShow.header);
    if (!noShowRows.length) {
      const r = ws.getRow(rowIdx);
      r.getCell(1).value = role === 'photographer' ? 'No no-show sessions this period' : 'No no-show designs this period';
      r.getCell(1).font = { italic: true, color: { argb: '6B6B6B' } };
      ws.mergeCells(rowIdx, 1, rowIdx, noShowCols.length || maxCols); rowIdx++;
    } else {
      for (let i = 0; i < noShowRows.length; i++)
        rowIdx = writeDataRow(ws, rowIdx, noShowRows[i], noShowCols, i % 2 === 1 ? COLORS.noShow.altRow : null);
      rowIdx = writeTotalRow(ws, rowIdx, noShowRows, noShowCols, role);
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

      // Format rate as number
      if (colLower === 'rate' && val != null && val !== '') {
        if (val instanceof Date) val = Math.round(((val.getTime() / 86400000) + 25569) * 100) / 100;
        else { const num = parseFloat(val); if (!isNaN(num)) val = num; }
      }
      // Format numeric columns
      else if ((colLower === 'session no' || colLower === 'session number' || colLower === 'invoice no') && val != null && val !== '') {
        if (val instanceof Date) val = Math.round(((val.getTime() / 86400000) + 25569) * 100) / 100;
        else { const num = parseFloat(val); if (!isNaN(num)) val = num; }
      }
      // Format dates
      else if (DATE_COLUMNS.has(colLower) && val) {
        val = fmtDate(val);
      }
      else if (val instanceof Date) {
        val = fmtDate(val);
      }

      if (val === true) val = 'Yes';
      if (val === false) val = 'No';

      cell.value = val;
      cell.font = { size: 9, color: { argb: '333333' } };
      cell.alignment = { vertical: 'middle' };
      if (colLower === 'rate' && typeof val === 'number') cell.numFmt = '$#,##0.00';
      if (altBg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: altBg } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'DDDDDD' } } };
    }
    return rowIdx + 1;
  }

  function writeTotalRow(ws, rowIdx, dataRows, cols, role) {
    const row = ws.getRow(rowIdx);
    const rateIdx = cols.findIndex(c => c.toLowerCase() === 'rate');
    // Change #8: designer uses "design" not "session"
    const unit = role === 'designer' ? 'design' : 'session';
    row.getCell(1).value = `Total: ${dataRows.length} ${unit}${dataRows.length !== 1 ? 's' : ''}`;
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

  // ── Main processing ───────────────────────────────────────────────
  async function processFiles() {
    const btn = $('#btnProcess');
    btn.disabled = true; btn.textContent = 'Processing…';
    state.corrections = [];

    try {
      // Reset parsed data
      for (const k of ['photoEligible','photoNoShow','designEligible','designNoShow']) {
        state.parsedData[k] = [];
        state.headers[k] = [];
      }
      let dataEmails = {};

      // Process each uploaded file
      for (const [key, file] of Object.entries(state.files)) {
        if (!file || key === 'contacts') continue;
        const rawRows = await readExcelRaw(file);

        if (detectSectionedFormat(rawRows)) {
          // New sectioned format — parse all sections from one file
          const parsed = parseSectionedFile(rawRows);
          for (const section of ['photoEligible','photoNoShow','designEligible','designNoShow']) {
            if (parsed[section].length > 0) {
              state.parsedData[section] = state.parsedData[section].concat(parsed[section]);
              state.headers[section] = parsed.headers[section];
            }
          }
          dataEmails = { ...dataEmails, ...parsed.emails };
        } else {
          // Old flat format — determine role and type from upload zone key
          let role, type;
          if (key === 'photoEligible') { role = 'photographer'; type = 'eligible'; }
          else if (key === 'photoNoShow') { role = 'photographer'; type = 'noShow'; }
          else if (key === 'designEligible') { role = 'designer'; type = 'eligible'; }
          else if (key === 'designNoShow') { role = 'designer'; type = 'noShow'; }
          else continue;
          const parsed = parseFlatFile(rawRows, role, type);
          state.parsedData[key] = parsed.rows;
          state.headers[key] = parsed.headers;
          dataEmails = { ...dataEmails, ...parsed.emails };
        }
      }

      // Ensure all headers are set to templates even if no data
      if (!state.headers.photoEligible.length) state.headers.photoEligible = PHOTO_ELIGIBLE_COLS;
      if (!state.headers.photoNoShow.length) state.headers.photoNoShow = PHOTO_NOSHOW_COLS;
      if (!state.headers.designEligible.length) state.headers.designEligible = DESIGN_ELIGIBLE_COLS;
      if (!state.headers.designNoShow.length) state.headers.designNoShow = DESIGN_NOSHOW_COLS;

      // ── Elevate ranking override ──────────────────────────────────
      // If connected to Elevate, fetch fresh rankings and override
      // whatever Finance put in the Ranking column.
      state.rankingOverrides = [];
      if (elevateConnected && elevateRankings) {
        const allSections = ['photoEligible', 'photoNoShow', 'designEligible', 'designNoShow'];
        for (const section of allSections) {
          const isNoShow = section.includes('NoShow');
          const isDesigner = section.startsWith('design');
          for (const row of state.parsedData[section]) {
            const name = getNameFromRow(row);
            const brand = (row['Brand'] || '').toString().trim();
            const oldRank = row['Ranking'] || '';
            const elevateRank = lookupElevateRanking(name, brand);

            if (elevateRank) {
              // Elevate has this contractor — use its ranking
              if (oldRank && oldRank !== elevateRank) {
                state.rankingOverrides.push({ name, brand, old: oldRank, new: elevateRank, type: 'override' });
              }
              row['Ranking'] = elevateRank;
            } else {
              // Not found in Elevate — default to Bronze
              if (oldRank !== 'Bronze') {
                state.rankingOverrides.push({ name, brand, old: oldRank || '(blank)', new: 'Bronze', type: 'default' });
              }
              row['Ranking'] = 'Bronze';
            }

            // Re-run rate corrections with the updated ranking
            // (since ranking may have changed, the rate needs recalculating)
            if (!isNoShow) {
              const ranking = row['Ranking'];
              const isWeekend = isTruthyYes(row['Weekend']);
              const sessionType = (row['Session Type'] || '').toString().trim().toLowerCase();
              const brandLower = (brand || '').toLowerCase();
              if (ranking && PRICE_TABLE[ranking]) {
                let expectedRate = isWeekend ? PRICE_TABLE[ranking].we : PRICE_TABLE[ranking].wd;
                if (!isDesigner && UPLIFT_TYPES.has(sessionType) && brandLower === 'family') {
                  expectedRate = expectedRate * UPLIFT_FACTOR;
                }
                row['Rate'] = expectedRate;
              }
            }
          }
        }
      }

      // Build contact map: localStorage → data file emails → uploaded contacts
      const savedContacts = loadSavedContacts();
      let uploadedContacts = {};
      if (state.files.contacts) {
        const rows = await readExcelRaw(state.files.contacts);
        uploadedContacts = parseContacts(rows);
      }
      state.contactMap = mergeContacts(savedContacts, dataEmails, uploadedContacts);
      saveContactsToLS(state.contactMap);

      // Build contractor list
      const contractors = new Map();
      function addContractors(rows, role) {
        for (const row of rows) {
          const name = getNameFromRow(row);
          const nName = norm(name);
          if (nName && !SKIP_NAMES.has(nName) && !nName.startsWith('applied filter')) {
            const key = nName + '|' + role;
            if (!contractors.has(key)) contractors.set(key, { name, role });
          }
        }
      }
      if (state.parsedData.photoEligible.length) addContractors(state.parsedData.photoEligible, 'photographer');
      if (state.parsedData.photoNoShow.length) addContractors(state.parsedData.photoNoShow, 'photographer');
      if (state.parsedData.designEligible.length) addContractors(state.parsedData.designEligible, 'designer');
      if (state.parsedData.designNoShow.length) addContractors(state.parsedData.designNoShow, 'designer');

      const photoEligGroups = groupByName(state.parsedData.photoEligible);
      const photoNSGroups = groupByName(state.parsedData.photoNoShow);
      const designEligGroups = groupByName(state.parsedData.designEligible);
      const designNSGroups = groupByName(state.parsedData.designNoShow);

      const total = contractors.size;
      showProgress('Generating files…', 0, total);
      const periodLabel = $('#periodLabel').value.trim();
      const manifest = [];
      let count = 0;

      for (const [compositeKey, info] of contractors) {
        const { name, role } = info;
        const nName = norm(name);
        let eligRows, nsRows, eligCols, nsCols;

        if (role === 'photographer') {
          eligRows = photoEligGroups[name] || [];
          nsRows = photoNSGroups[name] || [];
          eligCols = PHOTO_ELIGIBLE_COLS;
          nsCols = PHOTO_NOSHOW_COLS;
        } else {
          eligRows = designEligGroups[name] || [];
          nsRows = designNSGroups[name] || [];
          eligCols = DESIGN_ELIGIBLE_COLS;
          nsCols = DESIGN_NOSHOW_COLS;
        }

        const blob = await generateContractorFile(name, role, eligRows, nsRows, eligCols, nsCols, periodLabel);
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

  // ── Progress ──────────────────────────────────────────────────────
  function showProgress(title, current, total) {
    $('#progressOverlay').classList.remove('hidden');
    $('#progressTitle').textContent = title;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressText').textContent = `${current} / ${total}`;
  }
  function hideProgress() { $('#progressOverlay').classList.add('hidden'); }

  // ── Preview UI ────────────────────────────────────────────────────
  function showPreview() {
    $('#step-upload').classList.remove('active');
    $('#step-preview').classList.add('active');
    const m = state.manifest;
    const photoCount = m.filter(x => x.role === 'photographer').length;
    const designCount = m.filter(x => x.role === 'designer').length;
    const missingEmail = m.filter(x => !x.email).length;

    $('#previewSubtitle').textContent =
      `${m.length} files generated — ${photoCount} photographer${photoCount !== 1 ? 's' : ''}, ${designCount} designer${designCount !== 1 ? 's' : ''}`;

    const warnings = [];
    if (missingEmail > 0) warnings.push(`<strong>${missingEmail} contractor${missingEmail !== 1 ? 's' : ''} missing email.</strong> Type them in the Email column below — they'll be remembered for next time.`);

    // Show Elevate ranking info
    if (elevateConnected && elevateRankings) {
      const overrides = state.rankingOverrides.filter(r => r.type === 'override');
      const defaults = state.rankingOverrides.filter(r => r.type === 'default');
      const parts = [`<strong>🏆 Elevate rankings applied</strong> (${elevateRankings.periodLabel || 'latest period'})`];
      if (overrides.length > 0) {
        // Deduplicate by name+brand
        const unique = [...new Map(overrides.map(o => [`${o.name}|${o.brand}`, o])).values()];
        const overrideList = unique.length <= 5
          ? unique.map(o => `${o.name} (${o.brand}): ${o.old} → ${o.new}`).join('<br>')
          : `${unique.length} contractor-brand rankings overridden vs Finance file`;
        parts.push(`<br><span class="ranking-badge override">Overridden</span> ${overrideList}`);
      }
      if (defaults.length > 0) {
        const unique = [...new Map(defaults.map(o => [`${o.name}`, o])).values()];
        parts.push(`<br><span class="ranking-badge default">Defaulted to Bronze</span> ${unique.map(o => o.name).join(', ')}`);
      }
      if (overrides.length === 0 && defaults.length === 0) parts.push(' — all rankings matched');
      warnings.push(parts.join(''));
    }

    // Show rate corrections if any
    if (state.corrections.length > 0) {
      const correctionsSummary = state.corrections.length <= 5
        ? state.corrections.map(c => `${c.name}: ${c.msg}`).join('<br>')
        : `${state.corrections.length} rate corrections applied.`;
      warnings.push(`<strong>Rate corrections applied:</strong><br>${correctionsSummary}`);
    }

    $('#warnings').innerHTML = warnings.map(w => `<div class="warning-item">${w}</div>`).join('');

    const table = document.createElement('table');
    table.className = 'preview-table';
    table.innerHTML = `
      <thead><tr>
        <th>Contractor</th><th>Role</th><th>Email</th>
        <th>Eligible</th><th>No Show</th><th>Download</th><th>Status</th>
      </tr></thead>
      <tbody>${m.map((item, idx) => {
        const sourceLabel = item.emailSource === 'uploaded' ? 'from file' : item.emailSource === 'data' ? 'from data' : item.emailSource === 'saved' ? 'remembered' : '';
        return `<tr data-role="${item.role}" data-has-email="${item.email ? 'yes' : 'no'}" data-idx="${idx}">
          <td><strong>${item.name}</strong></td>
          <td><span class="role-badge ${item.role}">${item.role === 'photographer' ? 'Photographer' : 'Designer'}</span></td>
          <td>
            <input type="email" class="email-input" data-idx="${idx}" value="${item.email || ''}" placeholder="name@example.com">
            ${sourceLabel ? `<span class="email-source">${sourceLabel}</span>` : ''}
          </td>
          <td class="count-cell">${item.eligibleCount}</td>
          <td class="count-cell">${item.noShowCount}</td>
          <td><a class="download-link" data-idx="${idx}">Download</a></td>
          <td class="send-status" id="status-${idx}"></td>
        </tr>`;
      }).join('')}</tbody>`;
    $('#previewTable').innerHTML = '';
    $('#previewTable').appendChild(table);

    // Email input change → save to localStorage
    table.querySelectorAll('.email-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const item = state.manifest[idx];
        const newEmail = input.value.trim();
        item.email = newEmail;
        if (newEmail) {
          state.contactMap[norm(item.name)] = { name: item.name, email: newEmail, source: 'manual' };
          input.classList.add('saved');
          const sourceSpan = input.parentElement.querySelector('.email-source');
          if (sourceSpan) sourceSpan.textContent = 'saved';
          else {
            const span = document.createElement('span');
            span.className = 'email-source';
            span.textContent = 'saved';
            input.parentElement.appendChild(span);
          }
        } else {
          delete state.contactMap[norm(item.name)];
        }
        saveContactsToLS(state.contactMap);
        updateEmailWarning();
        input.closest('tr').dataset.hasEmail = newEmail ? 'yes' : 'no';
      });
    });

    // Download click
    table.querySelectorAll('.download-link').forEach(link => {
      link.addEventListener('click', () => {
        const item = state.manifest[parseInt(link.dataset.idx)];
        saveAs(item.blob, buildFilename(item));
      });
    });

    // Load test email from localStorage
    const savedTestEmail = localStorage.getItem('verve-portal-test-email') || '';
    $('#testEmail').value = savedTestEmail;
    $('#sendResults').innerHTML = '';
  }

  function updateEmailWarning() {
    const m = state.manifest;
    const missingEmail = m.filter(x => !x.email).length;
    const warnings = [];
    if (missingEmail > 0) warnings.push(`<strong>${missingEmail} contractor${missingEmail !== 1 ? 's' : ''} missing email.</strong> Type them in the Email column below — they'll be remembered for next time.`);
    if (state.corrections.length > 0) {
      warnings.push(`<strong>${state.corrections.length} rate correction${state.corrections.length !== 1 ? 's' : ''} applied.</strong>`);
    }
    $('#warnings').innerHTML = warnings.map(w => `<div class="warning-item">${w}</div>`).join('');
  }

  function buildFilename(item) {
    const period = $('#periodLabel').value.trim();
    const parts = [item.name];
    if (period) parts.push(period);
    parts.push(item.role === 'photographer' ? 'Sessions' : 'Appointments');
    return parts.join(' - ') + '.xlsx';
  }

  // ── Filters ───────────────────────────────────────────────────────
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

  // ── Download All ──────────────────────────────────────────────────
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

  // ── Export contacts ───────────────────────────────────────────────
  function exportContacts() {
    const contacts = loadSavedContacts();
    const entries = Object.values(contacts);
    if (!entries.length) { alert('No saved contacts to export.'); return; }
    const csv = 'Name,Email\n' + entries.map(c => `"${c.name}","${c.email}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'verve-contractor-contacts.csv');
  }

  // ── Email sending ─────────────────────────────────────────────────
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  function buildEmailSubject(template, name, period) {
    return template.replace(/{name}/g, name).replace(/{period}/g, period);
  }
  function buildEmailBody(template, name, period) {
    const text = template.replace(/{name}/g, name).replace(/{period}/g, period);
    return text.split('\n').map(line => line || '<br>').join('<br>');
  }

  async function sendEmail(to, subject, htmlBody, fileBase64, filename) {
    const response = await fetch('/.netlify/functions/send-contractor-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html: htmlBody, attachment: fileBase64, filename }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Send failed');
    return data;
  }

  async function sendTestEmail() {
    const testEmail = $('#testEmail').value.trim();
    if (!testEmail) { alert('Enter your email address in the "Your Email" field first.'); return; }
    localStorage.setItem('verve-portal-test-email', testEmail);

    const firstWithEmail = state.manifest.find(m => m.email);
    const testItem = firstWithEmail || state.manifest[0];
    if (!testItem) { alert('No files to send.'); return; }

    const btn = $('#btnSendTest');
    btn.disabled = true; btn.textContent = 'Sending test…';
    const results = $('#sendResults');

    try {
      const period = $('#periodLabel').value.trim();
      const subject = buildEmailSubject($('#emailSubject').value, testItem.name, period);
      const body = buildEmailBody($('#emailBody').value, testItem.name, period);
      const base64 = await blobToBase64(testItem.blob);
      await sendEmail(testEmail, `[TEST] ${subject}`, body, base64, buildFilename(testItem));
      results.innerHTML = `<div class="result-line success">Test email sent to ${testEmail} (using ${testItem.name}'s file)</div>`;
    } catch (err) {
      results.innerHTML = `<div class="result-line error">Test failed: ${err.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Send Test to Me';
    }
  }

  async function sendAllEmails() {
    const sendable = state.manifest.filter(m => m.email);
    if (!sendable.length) { alert('No contractors have email addresses. Add emails in the table first.'); return; }

    const msg = `Ready to send ${sendable.length} email${sendable.length !== 1 ? 's' : ''}?\n\n` +
      sendable.map(m => `  ${m.name} → ${m.email}`).join('\n') +
      '\n\nClick OK to send.';
    if (!confirm(msg)) return;

    const btn = $('#btnSendAll');
    btn.disabled = true;
    const results = $('#sendResults');
    results.innerHTML = '';
    const period = $('#periodLabel').value.trim();
    const subjectTemplate = $('#emailSubject').value;
    const bodyTemplate = $('#emailBody').value;
    let sent = 0, failed = 0;

    showProgress('Sending emails…', 0, sendable.length);

    for (const item of state.manifest) {
      const statusEl = $(`#status-${state.manifest.indexOf(item)}`);
      if (!item.email) {
        statusEl.textContent = 'No email';
        statusEl.className = 'send-status skipped';
        continue;
      }
      try {
        const subject = buildEmailSubject(subjectTemplate, item.name, period);
        const body = buildEmailBody(bodyTemplate, item.name, period);
        const base64 = await blobToBase64(item.blob);
        await sendEmail(item.email, subject, body, base64, buildFilename(item));
        item.sendStatus = 'sent';
        statusEl.textContent = 'Sent';
        statusEl.className = 'send-status sent';
        sent++;
      } catch (err) {
        item.sendStatus = 'failed';
        statusEl.textContent = 'Failed';
        statusEl.className = 'send-status failed';
        failed++;
        results.innerHTML += `<div class="result-line error">${item.name}: ${err.message}</div>`;
      }
      showProgress('Sending emails…', sent + failed, sendable.length);
      await new Promise(r => setTimeout(r, 200));
    }

    hideProgress();
    const summary = `<div class="result-line success"><strong>Done:</strong> ${sent} sent${failed ? `, ${failed} failed` : ''}</div>`;
    results.innerHTML = summary + results.innerHTML;
    btn.disabled = false;
  }

  // ── Init ──────────────────────────────────────────────────────────
  function init() {
    initUploads();
    initFilters();
    initElevateUI();
    showSavedContactCount();
    $('#btnProcess').addEventListener('click', processFiles);
    $('#btnDownloadAll').addEventListener('click', downloadAll);
    $('#btnBack').addEventListener('click', () => {
      $('#step-preview').classList.remove('active');
      $('#step-upload').classList.add('active');
    });
    $('#btnExportContacts').addEventListener('click', exportContacts);
    $('#btnSendTest').addEventListener('click', sendTestEmail);
    $('#btnSendAll').addEventListener('click', sendAllEmails);
  }

  init();
})();
