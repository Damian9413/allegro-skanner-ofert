/**
 * Funkcje pomocnicze
 */

/**
 * Escape HTML
 */
export function escapeHtml(input) {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize URL
 */
export function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Sleep/delay function
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Formatowanie liczby z separatorem tysięcy
 */
export function formatNumber(num) {
  if (num == null) return '0';
  return num.toLocaleString('pl-PL');
}

/**
 * Obliczenie różnicy w dniach między datami
 */
export function daysBetween(date1, date2 = new Date()) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs((date1 - date2) / oneDay));
}

/**
 * Normalizacja tekstu do porównań (lowercase, bez znaków diakrytycznych)
 */
export function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Wyciągnięcie liczby z tekstu
 */
export function extractNumber(text) {
  if (!text) return null;
  const match = String(text).match(/[\d,\.]+/);
  if (!match) return null;
  return parseFloat(match[0].replace(',', '.'));
}

/**
 * Porównanie wartości numerycznych z tolerancją
 */
export function compareNumericValues(val1, val2, tolerance = 0.1) {
  const num1 = typeof val1 === 'number' ? val1 : extractNumber(val1);
  const num2 = typeof val2 === 'number' ? val2 : extractNumber(val2);
  
  if (num1 === null || num2 === null) return false;
  
  const diff = Math.abs(num1 - num2);
  const avg = (num1 + num2) / 2;
  return diff / avg <= tolerance;
}

/**
 * Sprawdzenie czy tekst zawiera słowo/frazę (z synonimami)
 */
export function textContains(text, searchTerms, caseSensitive = false) {
  if (!text) return false;
  const haystack = caseSensitive ? text : normalizeText(text);
  const needles = Array.isArray(searchTerms) ? searchTerms : [searchTerms];
  
  return needles.some(needle => {
    const normalizedNeedle = caseSensitive ? needle : normalizeText(needle);
    return haystack.includes(normalizedNeedle);
  });
}

/**
 * Wyciągnięcie wartości z jednostką (np. "1100g" -> {value: 1100, unit: "g"})
 */
export function parseValueWithUnit(text) {
  if (!text) return null;
  const match = String(text).match(/([\d,\.]+)\s*([a-zA-Z]+)?/);
  if (!match) return null;
  
  return {
    value: parseFloat(match[1].replace(',', '.')),
    unit: match[2] || ''
  };
}

/**
 * Konwersja jednostek (uproszczona)
 */
export function convertUnit(value, fromUnit, toUnit) {
  const units = {
    // Waga
    'g': 1,
    'kg': 1000,
    'mg': 0.001,
    // Długość
    'mm': 0.1,
    'cm': 1,
    'm': 100,
    // Pojemność
    'ml': 1,
    'l': 1000,
  };
  
  const from = units[fromUnit.toLowerCase()] || 1;
  const to = units[toUnit.toLowerCase()] || 1;
  
  return value * from / to;
}

/**
 * Debugowanie - log tylko w dev mode
 */
export function debugLog(...args) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[Allegro Scan]', ...args);
  }
}

/**
 * Throttle function
 */
export function throttle(func, wait) {
  let timeout = null;
  let previous = 0;

  return function(...args) {
    const now = Date.now();
    const remaining = wait - (now - previous);

    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      func.apply(this, args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        previous = Date.now();
        timeout = null;
        func.apply(this, args);
      }, remaining);
    }
  };
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
