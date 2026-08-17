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

  // ── Marketing Channel identification (ported from the Invoice Portal,
  //    so both tools normalise "messy" channel text into the same
  //    official label, and the collated file's Pivot tab groups by
  //    channel consistently rather than splintering into near-duplicate
  //    rows like "Website" vs "Website Purchase" vs "WEB-FAMILY") ───────
  const CHANNEL_CONCEPTS_BY_BRAND = {
    Family: {
      list: ['CAMPAIGN-FAMILY', 'CORPORATE PARTNER', 'ENQUIRY-FAMILY', 'FUNDRAISER-FAMILY',
        'INFLUENCER-FAMILY', 'REFERRAL-FAMILY', 'REPEAT-FAMILY', 'STAFF', 'TRAINING',
        'WALK-IN', 'WEB-FAMILY'],
      concepts: {
        CAMPAIGN: 'CAMPAIGN-FAMILY', PARTNER: 'CORPORATE PARTNER', ENQUIRY: 'ENQUIRY-FAMILY',
        FUNDRAISER: 'FUNDRAISER-FAMILY', INFLUENCER: 'INFLUENCER-FAMILY', REFERRAL: 'REFERRAL-FAMILY',
        REPEAT: 'REPEAT-FAMILY', STAFF: 'STAFF', TRAINING: 'TRAINING', WALKIN: 'WALK-IN', WEB: 'WEB-FAMILY',
      },
    },
    Intimate: {
      list: ['BRANDPARTNER-INTIMATE', 'CAMPAIGN-INTIMATE', 'ENQUIRY-INTIMATE', 'FUNDRAISER-INTIMATE',
        'INFLUENCER-INTIMATE', 'REFERRAL-INTIMATE', 'REPEAT-INTIMATE', 'STAFF', 'TRAINING',
        'WALK-IN', 'WEB-INTIMATE'],
      concepts: {
        CAMPAIGN: 'CAMPAIGN-INTIMATE', PARTNER: 'BRANDPARTNER-INTIMATE', ENQUIRY: 'ENQUIRY-INTIMATE',
        FUNDRAISER: 'FUNDRAISER-INTIMATE', INFLUENCER: 'INFLUENCER-INTIMATE', REFERRAL: 'REFERRAL-INTIMATE',
        REPEAT: 'REPEAT-INTIMATE', STAFF: 'STAFF', TRAINING: 'TRAINING', WALKIN: 'WALK-IN', WEB: 'WEB-INTIMATE',
      },
    },
  };
  const CHANNEL_SYNONYMS = {
    CAMPAIGN: ['campaign'],
    PARTNER: ['corporatepartner', 'corporate', 'brandpartner', 'brandpartnership', 'partner'],
    ENQUIRY: ['enquiry', 'inquiry', 'enquiries', 'inquiries'],
    FUNDRAISER: ['fundraiser', 'fundraising', 'fundraise'],
    INFLUENCER: ['influencer', 'influencermarketing'],
    REFERRAL: ['referral', 'referrals', 'referred'],
    REPEAT: ['repeat', 'repeatclient', 'repeatcustomer', 'returning', 'returningclient', 'returningcustomer'],
    STAFF: ['staff', 'employee', 'internal'],
    TRAINING: ['training', 'trainingsession'],
    WALKIN: ['walkin'],
    WEB: ['web', 'website', 'websitepurchase', 'online', 'onlinepurchase', 'weblead'],
  };
  function normalizeChannelText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function findExactChannel(value, list) {
    if (!value) return null;
    const norm = String(value).trim().toLowerCase();
    return list.find(item => item.toLowerCase() === norm) || null;
  }
  // Manual rules Finance actually applies by hand, checked BEFORE the raw
  // Marketing Channel column, in this priority order: Repeat > Enquiry >
  // Campaign. First match wins.
  function applyChannelExceptionRules(sessionType, leadSource) {
    const st = String(sessionType || '').toLowerCase();
    if (/anniversary|repeat/.test(st)) return 'REPEAT';
    const ls = String(leadSource || '').toLowerCase();
    if (/enquiry/.test(ls)) return 'ENQUIRY';
    if (/campaign|giveaway|marketing/.test(ls)) return 'CAMPAIGN';
    return null;
  }
  // Resolves a row's Marketing Channel to the exact official label for its
  // brand. Exception rules first, then exact match against the official
  // list, then a substring synonym match (longest/most-specific wins —
  // real files often prefix the channel with the brand name, e.g.
  // "Intimate Website Purchase", which won't equal a bare "website").
  // Returns { resolved, wasInferred }; resolved is null if nothing matched.
  function resolveMarketingChannel(rawChannel, sessionType, leadSource, brand) {
    const brandChannels = CHANNEL_CONCEPTS_BY_BRAND[brand];
    if (!brandChannels) return { resolved: null, wasInferred: false };

    const exceptionConcept = applyChannelExceptionRules(sessionType, leadSource);
    if (exceptionConcept && brandChannels.concepts[exceptionConcept]) {
      return { resolved: brandChannels.concepts[exceptionConcept], wasInferred: true };
    }

    const raw = String(rawChannel || '').trim();
    if (!raw) return { resolved: null, wasInferred: false };

    const exact = findExactChannel(raw, brandChannels.list);
    if (exact) return { resolved: exact, wasInferred: false };

    const norm = normalizeChannelText(raw);
    let best = null;
    for (const concept in CHANNEL_SYNONYMS) {
      if (!(concept in brandChannels.concepts)) continue;
      for (const syn of CHANNEL_SYNONYMS[concept]) {
        if (norm.includes(syn) && (!best || syn.length > best.syn.length)) best = { concept, syn };
      }
    }
    if (best) return { resolved: brandChannels.concepts[best.concept], wasInferred: true };
    return { resolved: null, wasInferred: false };
  }

  // ── Location → state (for public holiday checks) ───────────────────
  const LOCATION_STATE = {
    'verve portraits - alexandria': 'NSW',
    'verve portraits - richmond': 'VIC',
    'verve portraits - fortitude valley': 'QLD',
    'verve intimate - south melbourne': 'VIC',
    'verve intimate - surry hills': 'NSW',
    'verve intimate - fortitude valley': 'QLD',
  };
  function stateForLocation(location) {
    const key = String(location || '').trim().toLowerCase();
    return LOCATION_STATE[key] || 'VIC'; // default: matches Head Office / unrecognised
  }

  // ── Robust date parsing for weekend/public-holiday verification ────
  // Everything here works in UTC-space consistently (construct with
  // Date.UTC, read with getUTC*) so the calculated day-of-week can never
  // drift depending on the browser's local timezone — a date read as
  // "27 Jul 2026" always evaluates as 27 Jul 2026, never the day before
  // or after. This mirrors the UTC approach fmtDate() already uses.
  const MONTH_ABBR_MAP = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  function parseDateForWeekendCheck(raw) {
    if (raw instanceof Date && !isNaN(raw)) {
      return new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
    }
    if (typeof raw === 'number' && isFinite(raw)) {
      // Excel serial date -> the UTC calendar date it represents.
      const d = new Date((raw - 25569) * 86400000);
      if (isNaN(d)) return null;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // D/M/Y, D-M-Y, D.M.Y (all-numeric)
    const m1 = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m1) {
      let [, d, mo, y] = m1;
      if (y.length === 2) y = '20' + y;
      const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
      if (!isNaN(dt)) return dt;
    }
    // "27-Jul-2026" / "27 Jul 2026" — the format actually used throughout
    // Finance's sectioned exports and this portal's own output files.
    const m2 = s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-](\d{4})$/);
    if (m2) {
      const [, d, monRaw, y] = m2;
      const monKey = monRaw.slice(0, 3).toLowerCase();
      if (monKey in MONTH_ABBR_MAP) {
        const dt = new Date(Date.UTC(Number(y), MONTH_ABBR_MAP[monKey], Number(d)));
        if (!isNaN(dt)) return dt;
      }
    }
    // ISO fallback
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const dt = new Date(s);
      if (!isNaN(dt)) return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
    return null;
  }

  /* ---- Australian public holiday calculator (National + NSW/VIC/QLD) ----
     Calculated algorithmically each year (Easter via the Anonymous
     Gregorian algorithm, "Nth weekday of month" rules, standard
     weekend-shift rules) rather than hard-coded, so it stays correct into
     future years automatically. Best-effort, not government-verified —
     state governments occasionally gazette one-off local holidays a pure
     rule engine can't predict. */
  function easterSundayUTC(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }
  function addDaysUTC(date, n) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + n);
    return d;
  }
  function nthWeekdayOfMonthUTC(year, month1to12, weekday, n) {
    const first = new Date(Date.UTC(year, month1to12 - 1, 1));
    const firstWeekday = first.getUTCDay();
    const day = 1 + ((7 + weekday - firstWeekday) % 7) + (n - 1) * 7;
    return new Date(Date.UTC(year, month1to12 - 1, day));
  }
  function observedFixedUTC(year, month1to12, day) {
    const d = new Date(Date.UTC(year, month1to12 - 1, day));
    const dow = d.getUTCDay();
    if (dow === 6) return addDaysUTC(d, 2); // Saturday -> Monday
    if (dow === 0) return addDaysUTC(d, 1); // Sunday -> Monday
    return d;
  }
  function christmasBoxingUTC(year) {
    const dec25 = new Date(Date.UTC(year, 11, 25));
    const dow = dec25.getUTCDay();
    let christmas, boxing;
    if (dow === 6) { christmas = new Date(Date.UTC(year, 11, 27)); boxing = new Date(Date.UTC(year, 11, 28)); }
    else if (dow === 0) { christmas = new Date(Date.UTC(year, 11, 27)); boxing = new Date(Date.UTC(year, 11, 26)); }
    else if (dow === 5) { christmas = new Date(Date.UTC(year, 11, 25)); boxing = new Date(Date.UTC(year, 11, 28)); }
    else { christmas = dec25; boxing = new Date(Date.UTC(year, 11, 26)); }
    return [
      { date: christmas, name: 'Christmas Day' },
      { date: boxing, name: 'Boxing Day' },
    ];
  }
  function dateKeyUTC(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const _holidayCache = {};
  function getPublicHolidays(year, state) {
    const cacheKey = `${year}_${state}`;
    if (_holidayCache[cacheKey]) return _holidayCache[cacheKey];
    const easter = easterSundayUTC(year);
    const list = [
      { date: observedFixedUTC(year, 1, 1), name: "New Year's Day" },
      { date: observedFixedUTC(year, 1, 26), name: 'Australia Day' },
      { date: addDaysUTC(easter, -2), name: 'Good Friday' },
      { date: addDaysUTC(easter, -1), name: 'Easter Saturday' },
      { date: easter, name: 'Easter Sunday' },
      { date: addDaysUTC(easter, 1), name: 'Easter Monday' },
      { date: new Date(Date.UTC(year, 3, 25)), name: 'Anzac Day' },
      ...christmasBoxingUTC(year),
    ];
    if (state === 'VIC') {
      list.push({ date: nthWeekdayOfMonthUTC(year, 3, 1, 2), name: 'Labour Day (VIC)' });
      list.push({ date: nthWeekdayOfMonthUTC(year, 6, 1, 2), name: "King's Birthday (VIC)" });
      list.push({ date: nthWeekdayOfMonthUTC(year, 11, 2, 1), name: 'Melbourne Cup Day' });
    } else if (state === 'NSW') {
      list.push({ date: nthWeekdayOfMonthUTC(year, 6, 1, 2), name: "King's Birthday (NSW)" });
      list.push({ date: nthWeekdayOfMonthUTC(year, 10, 1, 1), name: 'Labour Day (NSW)' });
    } else if (state === 'QLD') {
      list.push({ date: nthWeekdayOfMonthUTC(year, 5, 1, 1), name: 'Labour Day (QLD)' });
      list.push({ date: nthWeekdayOfMonthUTC(year, 10, 1, 1), name: "King's Birthday (QLD)" });
    }
    _holidayCache[cacheKey] = list;
    return list;
  }
  function getPublicHolidayName(date, state) {
    if (!date || isNaN(date)) return null;
    const holidays = getPublicHolidays(date.getUTCFullYear(), state);
    const key = dateKeyUTC(date);
    const match = holidays.find(h => dateKeyUTC(h.date) === key);
    return match ? match.name : null;
  }

  // ── Verified weekend/PH status ──────────────────────────────────────
  // The Appointment/Session Date is the source of truth for whether a
  // row was a weekday or weekend one — not Finance's "Weekend" column,
  // which is manually set and can be (and has been, in real files) wrong
  // for individual rows. A public holiday overrides either way. The
  // file's flag is used only as a fallback when no date can be parsed at
  // all, so a row is never left completely unpriced.
  function effectiveWeekendInfo(obj) {
    const dateRaw = obj['Session Date'] || obj['Appointment Date'] || obj['Invoice Date'] || '';
    const parsedDate = parseDateForWeekendCheck(dateRaw);
    const flagSaysWeekend = isTruthyYes(obj['Weekend']);

    if (parsedDate) {
      const day = parsedDate.getUTCDay(); // 0 = Sunday, 6 = Saturday
      const isCalendarWeekend = day === 0 || day === 6;
      const state = stateForLocation(obj['Location']);
      const holidayName = getPublicHolidayName(parsedDate, state);
      const effectiveWeekend = isCalendarWeekend || !!holidayName;
      return { effectiveWeekend, holidayName, flagSaysWeekend, flagMismatch: flagSaysWeekend !== effectiveWeekend, hasDate: true };
    }
    // No usable date — fall back to whatever the file's own flag says.
    return { effectiveWeekend: flagSaysWeekend, holidayName: null, flagSaysWeekend, flagMismatch: false, hasDate: false };
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
  // Session Type is a full descriptive string (e.g. "Multi-Generation
  // Family (10+ People)" or "Family with Newborn (Under 8 Weeks)"), not
  // one of the literal words in UPLIFT_TYPES — this checks whether it
  // CONTAINS one of those markers, rather than being exactly equal to
  // one (an exact Set.has() check here would never match anything).
  function isUpliftSessionType(sessionType) {
    const s = (sessionType || '').toLowerCase();
    for (const marker of UPLIFT_TYPES) {
      if (s.includes(marker)) return true;
    }
    return false;
  }

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
    channelInferredCount: 0,  // rows where Marketing Channel was normalised/inferred rather than an exact match
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

  // Pulls just "29 Jul" out of the full "Fortnight Ending 29 JUL 2026
  // (16 Jul 2026 - 29 Jul 2026)" label, so the connected pill stays
  // compact enough to read at a glance even when the panel is collapsed.
  function shortPeriodLabel(fullLabel) {
    if (!fullLabel) return '';
    const m = fullLabel.match(/Ending\s+(\d{1,2})\s+([A-Za-z]{3})/i);
    if (!m) return '';
    const month = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    return `FNE ${m[1]} ${month}`;
  }

  function updateElevateStatus() {
    const statusEl = $('#elevateStatus');
    if (elevateConnected && elevateRankings) {
      const count = Object.keys(elevateRankings.rankings || {}).length;
      const periodPart = shortPeriodLabel(elevateRankings.periodLabel);
      statusEl.textContent = periodPart ? `Connected (${count}) · ${periodPart}` : `Connected (${count})`;
      statusEl.title = elevateRankings.periodLabel || '';
      statusEl.classList.add('connected');
    } else {
      statusEl.textContent = 'Not connected';
      statusEl.title = '';
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

        // Also capture every OTHER recognised column from the source file
        // (e.g. Lead Source), beyond the trimmed per-contractor template.
        // The individual per-contractor files still only ever read the
        // templateCols above when they write out — these extra keys just
        // ride along on the row object, unused there, but available for
        // the collated file's detail tabs, which are meant to mirror the
        // source file's full column set rather than the trimmed template.
        for (const key of Object.keys(currentColMap)) {
          if (key === '_NAME_' || key === '_EMAIL_' || key === '_FIRST_' || key === '_LAST_') continue;
          if (obj[key] === undefined) obj[key] = extractRowValue(row, currentColMap, key);
        }

        // Normalise ranking (Elevate → Elite)
        if (obj['Ranking']) obj['Ranking'] = normalizeRanking(obj['Ranking']);

        // Resolve location codes
        const sessionNoVal = obj['Session No'] || '';
        obj['Location'] = resolveLocation(obj['Location'], sessionNoVal);

        // Detect brand from location if not already present
        if (!obj['Brand']) obj['Brand'] = detectBrandFromLocation(obj['Location']);

        // Normalise Marketing Channel to the official label for this
        // brand — same identification logic as the Invoice Portal, so a
        // channel like "Website Purchase" or "Intimate Web Lead" both
        // resolve to "WEB-FAMILY"/"WEB-INTIMATE" consistently, and the
        // collated file's Pivot tab groups by channel meaningfully
        // instead of splintering into near-duplicate raw text variants.
        {
          const channelMatch = resolveMarketingChannel(obj['Marketing Channel'], obj['Session Type'], obj['Lead Source'], obj['Brand']);
          if (channelMatch.resolved) {
            obj['Marketing Channel'] = channelMatch.resolved;
            if (channelMatch.wasInferred) state.channelInferredCount++;
          }
        }

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
      for (const key of Object.keys(colMap)) {
        if (key === '_NAME_' || key === '_EMAIL_' || key === '_FIRST_' || key === '_LAST_') continue;
        if (obj[key] === undefined) obj[key] = extractRowValue(row, colMap, key);
      }

      if (obj['Ranking']) obj['Ranking'] = normalizeRanking(obj['Ranking']);
      const sessionNoVal = obj['Session No'] || '';
      obj['Location'] = resolveLocation(obj['Location'], sessionNoVal);
      if (!obj['Brand']) obj['Brand'] = detectBrandFromLocation(obj['Location']);

      {
        const channelMatch = resolveMarketingChannel(obj['Marketing Channel'], obj['Session Type'], obj['Lead Source'], obj['Brand']);
        if (channelMatch.resolved) {
          obj['Marketing Channel'] = channelMatch.resolved;
          if (channelMatch.wasInferred) state.channelInferredCount++;
        }
      }

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
    const weekendInfo = effectiveWeekendInfo(obj);
    const isWeekend = weekendInfo.effectiveWeekend;
    const sessionType = (obj['Session Type'] || '').toString().trim().toLowerCase();
    const brand = (obj['Brand'] || '').toString().trim().toLowerCase();

    // Correct the exported Weekend column to what the calendar (and
    // public holiday check) actually says — the file's flag is manually
    // set and can be (and has been, in real files) wrong for individual
    // rows, e.g. a Monday marked "Yes" or a Saturday marked "No". This
    // also keeps the column consistent with the Rate actually charged.
    obj['Weekend'] = isWeekend ? 'Yes' : 'No';

    if (isNoShow) {
      // Change #6: No-show is always flat rate, independent of ranking.
      // The flat rate itself depends on weekend status, so a corrected
      // no-show rate already reflects a corrected weekend flag — one
      // combined message rather than two separate ones for the same row.
      const expectedRate = isWeekend ? NOSHOW_FLAT.we : NOSHOW_FLAT.wd;
      if (!isNaN(rate) && rate !== expectedRate) {
        const flagNote = weekendInfo.hasDate && weekendInfo.flagMismatch
          ? ` (file's Weekend flag said "${weekendInfo.flagSaysWeekend ? 'Yes' : 'No'}", but the date is actually a ${isWeekend ? 'weekend' : 'weekday'}${weekendInfo.holidayName ? ` — public holiday: ${weekendInfo.holidayName}` : ''})`
          : '';
        state.corrections.push({
          name: contractorName, type: 'no-show-rate',
          msg: `No-show rate corrected from $${rate.toFixed(2)} to $${expectedRate.toFixed(2)} (flat rate)${flagNote}`,
        });
      }
      obj['Rate'] = expectedRate;
      return;
    }

    // Eligible rows: whenever the verified weekend status disagrees with
    // what Finance's file had, recompute the ranking-based rate (plus
    // ×1.5 uplift, where it applies) against the *correct* day — a wrong
    // flag almost always means the rate itself was priced off the wrong
    // weekday/weekend tier.
    if (weekendInfo.hasDate && weekendInfo.flagMismatch && ranking && PRICE_TABLE[ranking]) {
      const isSpecial = !isDesigner && isUpliftSessionType(sessionType) && brand === 'family';
      let expectedRate = isWeekend ? PRICE_TABLE[ranking].we : PRICE_TABLE[ranking].wd;
      if (isSpecial) expectedRate = expectedRate * UPLIFT_FACTOR;
      if (!isNaN(rate) && rate > 0 && Math.abs(rate - expectedRate) > 0.01) {
        const reason = weekendInfo.holidayName
          ? `it's a public holiday (${weekendInfo.holidayName})`
          : `it's actually a ${isWeekend ? 'weekend' : 'weekday'}`;
        state.corrections.push({
          name: contractorName, type: 'weekend-rate-correction',
          msg: `Session ${obj['Session No'] || obj['Invoice No'] || '(no number)'}: rate corrected from $${rate.toFixed(2)} to $${expectedRate.toFixed(2)} — file's Weekend flag said "${weekendInfo.flagSaysWeekend ? 'Yes' : 'No'}", but ${reason}`,
        });
        obj['Rate'] = expectedRate;
      }
    } else if (weekendInfo.hasDate && weekendInfo.flagMismatch) {
      // No ranking/price data to recompute against (rare) — at least
      // flag that the Weekend column itself needed correcting.
      const reason = weekendInfo.holidayName
        ? `it's a public holiday (${weekendInfo.holidayName})`
        : `it's actually a ${isWeekend ? 'weekend' : 'weekday'}`;
      state.corrections.push({
        name: contractorName, type: 'weekend-flag-mismatch',
        msg: `Weekend flag corrected for Session ${obj['Session No'] || obj['Invoice No'] || '(no number)'}: file said "${weekendInfo.flagSaysWeekend ? 'Yes' : 'No'}", but ${reason}`,
      });
    }

    // Change #4: ×1.5 uplift for Family 10+/Newborn — covers the case
    // where the weekend flag was already correct, but Finance still
    // forgot the uplift multiplier (independent of the check above).
    if (!isDesigner && ranking && PRICE_TABLE[ranking] && isUpliftSessionType(sessionType) && brand === 'family') {
      const baseRate = isWeekend ? PRICE_TABLE[ranking].we : PRICE_TABLE[ranking].wd;
      const expectedRate = baseRate * UPLIFT_FACTOR;
      const currentRate = parseFloat(obj['Rate']); // may already reflect the correction above
      if (!isNaN(currentRate) && currentRate > 0 && Math.abs(currentRate - expectedRate) > 0.01 && currentRate < expectedRate) {
        state.corrections.push({
          name: contractorName, type: 'uplift-correction',
          msg: `${sessionType} rate corrected from $${currentRate.toFixed(2)} to $${expectedRate.toFixed(2)} (×1.5 uplift)`,
        });
        obj['Rate'] = expectedRate;
      } else if (isNaN(currentRate) || currentRate === 0 || currentRate === '') {
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
    state.channelInferredCount = 0;

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
              const isWeekend = effectiveWeekendInfo(row).effectiveWeekend;
              const sessionType = (row['Session Type'] || '').toString().trim().toLowerCase();
              const brandLower = (brand || '').toLowerCase();
              if (ranking && PRICE_TABLE[ranking]) {
                let expectedRate = isWeekend ? PRICE_TABLE[ranking].we : PRICE_TABLE[ranking].wd;
                if (!isDesigner && isUpliftSessionType(sessionType) && brandLower === 'family') {
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

    if (state.channelInferredCount > 0) {
      warnings.push(`We automatically matched the marketing channel on ${state.channelInferredCount} row(s) for reporting.`);
    }

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
        <th class="select-cell"><input type="checkbox" id="selectAllCheckbox" checked title="Select/deselect all"></th>
        <th>Contractor</th><th>Role</th><th>Email</th>
        <th>Eligible</th><th>No Show</th><th>Download</th><th>Status</th>
      </tr></thead>
      <tbody>${m.map((item, idx) => {
        const sourceLabel = item.emailSource === 'uploaded' ? 'from file' : item.emailSource === 'data' ? 'from data' : item.emailSource === 'saved' ? 'remembered' : '';
        return `<tr data-role="${item.role}" data-has-email="${item.email ? 'yes' : 'no'}" data-idx="${idx}">
          <td class="select-cell"><input type="checkbox" class="send-checkbox" data-idx="${idx}" checked></td>
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

    // Master "select all" checkbox — checked/indeterminate reflects the
    // current state of the individual row checkboxes, and clicking it
    // sets every (currently visible-or-not — filters only hide rows,
    // they don't remove them) row checkbox to match.
    const selectAllBox = $('#selectAllCheckbox');
    function syncSelectAllState() {
      const boxes = [...table.querySelectorAll('.send-checkbox')];
      const checkedCount = boxes.filter(b => b.checked).length;
      selectAllBox.checked = checkedCount === boxes.length;
      selectAllBox.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
    }
    selectAllBox.addEventListener('change', () => {
      table.querySelectorAll('.send-checkbox').forEach(b => { b.checked = selectAllBox.checked; });
      selectAllBox.indeterminate = false;
    });
    table.querySelectorAll('.send-checkbox').forEach(box => {
      box.addEventListener('change', syncSelectAllState);
    });

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
    if (state.channelInferredCount > 0) {
      warnings.push(`We automatically matched the marketing channel on ${state.channelInferredCount} row(s) for reporting.`);
    }
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

  // ── Collated file (everyone, one workbook, 5 tabs) ──────────────────
  // Summary, Eligible Sessions, No Show Sessions, Eligible Appointments,
  // No Show Appointments — same underlying data as the per-contractor
  // files, just laid out for someone who wants to see everyone at once
  // (e.g. a finance reconciliation pass) rather than file-by-file.
  function sumRate(rows) {
    return rows.reduce((sum, r) => {
      const v = parseFloat(r['Rate']);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }

  async function generateCollatedFile() {
    const wb = new ExcelJS.Workbook();
    const periodLabel = $('#periodLabel').value.trim();

    // ---- Tab 1: Summary — two tables, Family then Intimate ----
    // Each contractor's per-role file mixes both brands together (Brand
    // is just a column on each row), so building brand-specific totals
    // means filtering the same underlying rows by Brand rather than
    // reading anything pre-split.
    const summaryWs = wb.addWorksheet('Summary');
    const summaryCols = ['Contractor', 'Role', 'Email', 'Eligible', 'Eligible $', 'No-Show', 'No-Show $', 'Total'];
    summaryWs.columns = summaryCols.map(c => ({ width: c === 'Contractor' ? 26 : (c === 'Email' ? 26 : (c === 'Role' ? 14 : 13)) }));

    let r = 1;
    const titleRow = summaryWs.getRow(r);
    titleRow.getCell(1).value = periodLabel ? `Collated Summary — ${periodLabel}` : 'Collated Summary';
    titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: '1A1A1A' } };
    summaryWs.mergeCells(r, 1, r, summaryCols.length);
    r += 2;

    const photoEligByName = groupByName(state.parsedData.photoEligible);
    const photoNSByName = groupByName(state.parsedData.photoNoShow);
    const designEligByName = groupByName(state.parsedData.designEligible);
    const designNSByName = groupByName(state.parsedData.designNoShow);
    const byBrand = (rows, brand) => rows.filter(row => (row['Brand'] || '').toString().trim().toLowerCase() === brand.toLowerCase());

    function writeBrandSummaryTable(brand, sectionColors) {
      r = writeSectionTitle(summaryWs, r, `${brand.toUpperCase()} SUMMARY`, sectionColors.title, summaryCols.length);
      r = writeHeaders(summaryWs, r, summaryCols, sectionColors.header);

      let grandEligible = 0, grandEligibleTotal = 0, grandNoShow = 0, grandNoShowTotal = 0;
      let rowsWritten = 0, contractorsIncluded = 0;

      state.manifest.forEach((item) => {
        const allEligRows = item.role === 'photographer' ? (photoEligByName[item.name] || []) : (designEligByName[item.name] || []);
        const allNsRows = item.role === 'photographer' ? (photoNSByName[item.name] || []) : (designNSByName[item.name] || []);
        const eligRows = byBrand(allEligRows, brand);
        const nsRows = byBrand(allNsRows, brand);
        if (!eligRows.length && !nsRows.length) return; // this contractor has no rows for this brand — skip

        const eligibleTotal = sumRate(eligRows);
        const noShowTotal = sumRate(nsRows);
        grandEligible += eligRows.length; grandEligibleTotal += eligibleTotal;
        grandNoShow += nsRows.length; grandNoShowTotal += noShowTotal;
        contractorsIncluded++;

        const rowObj = {
          'Contractor': item.name,
          'Role': item.role === 'photographer' ? 'Photographer' : 'Designer',
          'Email': item.email || '(missing)',
          'Eligible': eligRows.length,
          'Eligible $': eligibleTotal,
          'No-Show': nsRows.length,
          'No-Show $': noShowTotal,
          'Total': eligibleTotal + noShowTotal,
        };
        const row = summaryWs.getRow(r);
        summaryCols.forEach((col, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = rowObj[col];
          cell.font = { size: 9, color: { argb: '333333' } };
          if (col === 'Eligible $' || col === 'No-Show $' || col === 'Total') cell.numFmt = '$#,##0.00';
          if (rowsWritten % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sectionColors.altRow } };
          cell.border = { bottom: { style: 'hair', color: { argb: 'DDDDDD' } } };
        });
        r++; rowsWritten++;
      });

      if (!contractorsIncluded) {
        const cell = summaryWs.getRow(r).getCell(1);
        cell.value = `No ${brand} rows this period.`;
        cell.font = { italic: true, color: { argb: '6B6B6B' } };
        summaryWs.mergeCells(r, 1, r, summaryCols.length);
        r++;
      } else {
        const totalRow = summaryWs.getRow(r);
        totalRow.getCell(1).value = `Total: ${contractorsIncluded} contractor${contractorsIncluded !== 1 ? 's' : ''}`;
        totalRow.getCell(4).value = grandEligible;
        totalRow.getCell(5).value = grandEligibleTotal;
        totalRow.getCell(6).value = grandNoShow;
        totalRow.getCell(7).value = grandNoShowTotal;
        totalRow.getCell(8).value = grandEligibleTotal + grandNoShowTotal;
        [5, 7, 8].forEach(c => { totalRow.getCell(c).numFmt = '$#,##0.00'; });
        [1, 4, 5, 6, 7, 8].forEach(c => {
          totalRow.getCell(c).font = { bold: true, size: 9 };
          totalRow.getCell(c).border = { top: { style: 'thin', color: { argb: '999999' } } };
        });
        r++;
      }
      r += 2; // gap before the next brand's table
    }

    writeBrandSummaryTable('Family', COLORS.eligible);
    writeBrandSummaryTable('Intimate', COLORS.noShow);

    // ---- Tabs 2–5: every row, every contractor, with a Contractor column ----
    // Collated detail tabs mirror the FULL set of columns Finance actually
    // sent — not just the trimmed per-contractor template — so nothing
    // from the source file goes missing here even if it was intentionally
    // dropped from the individual files (e.g. Lead Source).
    function unionColumns(templateCols, rows) {
      const seen = new Set(templateCols);
      const extra = [];
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (key === '_name' || seen.has(key)) continue;
          seen.add(key); extra.push(key);
        }
      }
      return [...templateCols, ...extra];
    }

    const sections = [
      { sheetName: 'Eligible Sessions', data: state.parsedData.photoEligible, cols: PHOTO_ELIGIBLE_COLS, colors: COLORS.eligible },
      { sheetName: 'No Show Sessions', data: state.parsedData.photoNoShow, cols: PHOTO_NOSHOW_COLS, colors: COLORS.noShow },
      { sheetName: 'Eligible Appointments', data: state.parsedData.designEligible, cols: DESIGN_ELIGIBLE_COLS, colors: COLORS.eligible },
      { sheetName: 'No Show Appointments', data: state.parsedData.designNoShow, cols: DESIGN_NOSHOW_COLS, colors: COLORS.noShow },
    ];
    for (const section of sections) {
      const ws = wb.addWorksheet(section.sheetName);
      const sectionCols = unionColumns(section.cols, section.data);
      const cols = ['Contractor', ...sectionCols];
      ws.columns = cols.map(c => ({ width: c === 'Contractor' ? 24 : 18 }));
      let rr = 1;
      rr = writeHeaders(ws, rr, cols, section.colors.header);
      const rows = section.data.map(row => ({ Contractor: row['_name'] || '', ...row }));
      if (!rows.length) {
        const cell = ws.getRow(rr).getCell(1);
        cell.value = 'No rows for this section.';
        cell.font = { italic: true, color: { argb: '6B6B6B' } };
        ws.mergeCells(rr, 1, rr, cols.length);
        rr++;
      } else {
        rows.forEach((row, i) => { rr = writeDataRow(ws, rr, row, cols, i % 2 === 1 ? section.colors.altRow : null); });
        rr = writeTotalRow(ws, rr, rows, cols, section.sheetName.includes('Appointment') ? 'designer' : 'photographer');
      }
    }

    // ---- Tab 6: Pivot — Name / Location / Channel / Qty / Amount ------
    // Four tables (Family Eligible, Family No-Show, Intimate Eligible,
    // Intimate No-Show), each grouping the same underlying rows by
    // contractor + location + marketing channel — a cross-cutting view
    // for spotting patterns (e.g. one channel driving most of a
    // contractor's volume) that the per-role detail tabs don't surface.
    function buildPivotRows(rows) {
      const groups = {};
      for (const row of rows) {
        const name = row['_name'] || '';
        const location = row['Location'] || '(no location)';
        const channel = row['Marketing Channel'] || '(no channel)';
        const key = `${name}|||${location}|||${channel}`;
        if (!groups[key]) groups[key] = { Name: name, Location: location, Channel: channel, Qty: 0, Amount: 0 };
        groups[key].Qty += 1;
        const rate = parseFloat(row['Rate']);
        groups[key].Amount += isNaN(rate) ? 0 : rate;
      }
      return Object.values(groups).sort((a, b) =>
        a.Name.localeCompare(b.Name) || a.Location.localeCompare(b.Location) || a.Channel.localeCompare(b.Channel));
    }

    const pivotWs = wb.addWorksheet('Pivot');
    const pivotCols = ['Name', 'Location', 'Channel', 'Qty', 'Amount'];
    pivotWs.columns = pivotCols.map(c => ({ width: c === 'Name' || c === 'Location' ? 26 : (c === 'Channel' ? 20 : 12) }));
    let pr = 1;
    const pivotTitleRow = pivotWs.getRow(pr);
    pivotTitleRow.getCell(1).value = periodLabel ? `Pivot — ${periodLabel}` : 'Pivot';
    pivotTitleRow.getCell(1).font = { bold: true, size: 14, color: { argb: '1A1A1A' } };
    pivotWs.mergeCells(pr, 1, pr, pivotCols.length);
    pr += 2;

    function writePivotTable(title, rows, sectionColors) {
      pr = writeSectionTitle(pivotWs, pr, title, sectionColors.title, pivotCols.length);
      pr = writeHeaders(pivotWs, pr, pivotCols, sectionColors.header);
      const pivotRows = buildPivotRows(rows);
      if (!pivotRows.length) {
        const cell = pivotWs.getRow(pr).getCell(1);
        cell.value = 'No rows this period.';
        cell.font = { italic: true, color: { argb: '6B6B6B' } };
        pivotWs.mergeCells(pr, 1, pr, pivotCols.length);
        pr++;
      } else {
        let totalQty = 0, totalAmount = 0;
        pivotRows.forEach((row, i) => {
          totalQty += row.Qty; totalAmount += row.Amount;
          const wsRow = pivotWs.getRow(pr);
          pivotCols.forEach((col, ci) => {
            const cell = wsRow.getCell(ci + 1);
            cell.value = row[col];
            cell.font = { size: 9, color: { argb: '333333' } };
            if (col === 'Amount') cell.numFmt = '$#,##0.00';
            if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sectionColors.altRow } };
            cell.border = { bottom: { style: 'hair', color: { argb: 'DDDDDD' } } };
          });
          pr++;
        });
        const totalRow = pivotWs.getRow(pr);
        totalRow.getCell(1).value = `Total: ${pivotRows.length} group${pivotRows.length !== 1 ? 's' : ''}`;
        totalRow.getCell(4).value = totalQty;
        totalRow.getCell(5).value = totalAmount;
        totalRow.getCell(5).numFmt = '$#,##0.00';
        [1, 4, 5].forEach(c => { totalRow.getCell(c).font = { bold: true, size: 9 }; totalRow.getCell(c).border = { top: { style: 'thin', color: { argb: '999999' } } }; });
        pr++;
      }
      pr += 2;
    }

    const allEligible = [...state.parsedData.photoEligible, ...state.parsedData.designEligible];
    const allNoShow = [...state.parsedData.photoNoShow, ...state.parsedData.designNoShow];
    const byBrandFlat = (rows, brand) => rows.filter(row => (row['Brand'] || '').toString().trim().toLowerCase() === brand.toLowerCase());

    writePivotTable('FAMILY — ELIGIBLE', byBrandFlat(allEligible, 'Family'), COLORS.eligible);
    writePivotTable('FAMILY — NO SHOW', byBrandFlat(allNoShow, 'Family'), COLORS.noShow);
    writePivotTable('INTIMATE — ELIGIBLE', byBrandFlat(allEligible, 'Intimate'), COLORS.eligible);
    writePivotTable('INTIMATE — NO SHOW', byBrandFlat(allNoShow, 'Intimate'), COLORS.noShow);

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function downloadCollated() {
    const btn = $('#btnDownloadCollated');
    btn.disabled = true; btn.textContent = 'Building…';
    try {
      const blob = await generateCollatedFile();
      const period = $('#periodLabel').value.trim() || 'Verve';
      saveAs(blob, `${period} - Collated (All Contractors).xlsx`);
    } catch (err) { alert('Error creating collated file: ' + err.message); }
    finally { btn.disabled = false; btn.textContent = 'Download Collated File'; }
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
    // "Sendable" = has an email AND its row checkbox is still checked.
    // The checkbox is what lets a partial re-send work safely — e.g.
    // reprocessing a file after adding one contractor shouldn't re-email
    // everyone who already got their file in an earlier run.
    const checkedIdxs = new Set(
      [...document.querySelectorAll('.send-checkbox')].filter(b => b.checked).map(b => parseInt(b.dataset.idx))
    );
    const sendable = state.manifest.filter((m, idx) => m.email && checkedIdxs.has(idx));
    if (!sendable.length) {
      const anyChecked = checkedIdxs.size > 0;
      alert(anyChecked
        ? 'None of the selected contractors have an email address yet. Add emails in the table first.'
        : 'No contractors are selected. Tick the checkbox next to whoever you want to email, or use the header checkbox to select everyone.');
      return;
    }

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
      const idx = state.manifest.indexOf(item);
      const statusEl = $(`#status-${idx}`);
      if (!checkedIdxs.has(idx)) {
        statusEl.textContent = 'Not selected';
        statusEl.className = 'send-status skipped';
        continue;
      }
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
  function initThemeToggle() {
    const btn = $('#themeToggle');
    if (!btn) return;
    const updateIcon = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    };
    updateIcon();
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('verveDistPortal_theme', next); } catch (e) { /* ignore */ }
      updateIcon();
    });
  }

  function init() {
    initUploads();
    initFilters();
    initElevateUI();
    initThemeToggle();
    showSavedContactCount();
    $('#btnProcess').addEventListener('click', processFiles);
    $('#btnDownloadAll').addEventListener('click', downloadAll);
    $('#btnDownloadCollated').addEventListener('click', downloadCollated);
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
