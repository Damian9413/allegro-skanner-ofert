/**
 * Stałe konfiguracyjne dla Allegro Skan Ofert
 */

// API URLs
export const API_URL = 'https://script.google.com/macros/s/AKfycbxFNv3LjfXFCtV4Wdc9xLZO1a4KX8zSdoWP4NxJkFZQR4zdePaw3103gLSnAag39QW5Bg/exec';
export const AI_API_URL = 'https://dajstrone.pl/skaner-ofert/api.php';

// OpenAI Cost Calculator Settings
export const OPENAI_SETTINGS = {
  USD_TO_PLN: 4.0,
  INPUT_COST_PER_TOKEN: 0.00015 / 1000,  // $0.150 za 1M tokenów
  OUTPUT_COST_PER_TOKEN: 0.0006 / 1000,  // $0.600 za 1M tokenów
  MODEL: 'gpt-4o-mini'
};

// Progi oceny rozdzielczości obrazu
export const IMAGE_RESOLUTION_THRESHOLDS = {
  OPTIMAL: 2560,      // ✅ Optymalna
  GOOD: 1200,         // ✅ Dobra
  ACCEPTABLE: 800,    // ⚠️ Akceptowalna
  // <800 = ❌ Za niska
};

// Progi oceny DPI
export const DPI_THRESHOLDS = {
  EXCELLENT: 300,     // ✅ Doskonałe
  GOOD: 150,          // ✅ Dobre
  ACCEPTABLE: 72,     // ⚠️ Akceptowalne
  // <72 = ❌ Słabe
};

// Progi wykrywania białych ramek (procent białych pikseli na brzegu)
export const WHITE_BORDER_THRESHOLDS = {
  DETECTION_THRESHOLD: 2.3,  // >2.3% = wykryto ramkę
  EDGE_SAMPLE_PERCENT: 10,   // Analizuj 10% brzegu obrazu
};

// Progi analizy białego tła (tylko brzegi!)
export const WHITE_BACKGROUND_THRESHOLDS = {
  EXCELLENT: 95,      // ✅ Doskonałe białe tło
  GOOD: 80,           // ✅ Dobre białe tło
  ACCEPTABLE: 60,     // ⚠️ Akceptowalne
  // <60 = ❌ Niewystarczające
};

// Progi oceny procenta pogrubionego tekstu
export const BOLD_TEXT_THRESHOLDS = {
  OPTIMAL_MIN: 5,     // Minimalna wartość optymalna
  OPTIMAL_MAX: 15,    // Maksymalna wartość optymalna
  TOO_MUCH: 20,       // >20% = za dużo
  TOO_LITTLE: 3,      // <3% = za mało
};

// Progi oceny liczby parametrów
export const PARAMETERS_THRESHOLDS = {
  EXCELLENT: 15,      // ✅ Doskonale
  GOOD: 10,           // ✅ Dobrze
  ACCEPTABLE: 5,      // ⚠️ Akceptowalne
  // <5 = ❌ Za mało
};

// Progi oceny pokrycia parametrów w opisie
export const PARAMETERS_IN_DESCRIPTION_THRESHOLDS = {
  EXCELLENT: 80,      // ✅ Doskonale (80%+ parametrów w opisie)
  GOOD: 60,           // ✅ Dobrze
  ACCEPTABLE: 40,     // ⚠️ Akceptowalne
  // <40 = ❌ Słabe
};

// Progi oceny "Propozycji dla Ciebie"
export const SUGGESTIONS_THRESHOLDS = {
  EXCELLENT: 15,      // ✅ Bardzo dobrze (15+ produktów)
  GOOD: 10,           // ✅ Dobrze
  ACCEPTABLE: 5,      // ⚠️ Średnio
  // <5 = ❌ Słabo
};

// Progi oceny liczby ocen produktu
export const RATING_COUNT_THRESHOLDS = {
  EXCELLENT: 100,     // ✅ Doskonale
  GOOD: 10,           // ✅ Dobrze
  ACCEPTABLE: 1,      // ⚠️ Akceptowalne
  // 0 = ❌ Brak ocen
};

// Progi oceny liczby recenzji
export const REVIEW_COUNT_THRESHOLDS = {
  EXCELLENT: 10,      // ✅ Doskonale
  GOOD: 1,            // ✅ Dobrze
  // 0 = ⚠️ Brak recenzji (sprawdź datę oferty)
};

// Progi oceny wartości oceny produktu (rating)
export const RATING_VALUE_THRESHOLDS = {
  EXCELLENT: 4.6,     // ✅ Bardzo dobrze
  GOOD: 4.0,          // ✅ Dobrze
  ACCEPTABLE: 3.5,    // ⚠️ Średnio
  // <3.5 = ❌ Słabo
};

// Zakładany czas na pojawienie się recenzji (dni)
export const NEW_OFFER_THRESHOLD_DAYS = 30;

// Standardowe wymiary dla obliczeń DPI (cale)
export const STANDARD_DISPLAY_SIZE_INCHES = 8;

// Tolerancja dla porównywania wartości numerycznych w parametrach
export const NUMERIC_TOLERANCE = 0.1; // 10%

// Synonimy parametrów do wyszukiwania w opisie
export const PARAMETER_SYNONYMS = {
  'waga': ['waga', 'masa', 'ciężar', 'weight'],
  'wymiary': ['wymiary', 'rozmiar', 'dimensions', 'size'],
  'długość': ['długość', 'długosc', 'dlugosc', 'length'],
  'szerokość': ['szerokość', 'szerokosc', 'szerokosc', 'width'],
  'wysokość': ['wysokość', 'wysokosc', 'wysokosc', 'height'],
  'pojemność': ['pojemność', 'pojemnosc', 'capacity'],
  'materiał': ['materiał', 'material', 'tworzywo'],
  'kolor': ['kolor', 'color', 'colour', 'barwa'],
  'marka': ['marka', 'brand', 'producent', 'manufacturer'],
};

// UI
export const UI_CONFIG = {
  PANEL_ID: 'wt-skan-ui',
  PANEL_Z_INDEX: 2147483647,
  ANIMATION_DURATION: 300,
};

// Wersja aplikacji (pobierana z manifest.json dynamicznie)
export const getAppVersion = () => {
  return chrome?.runtime?.getManifest?.()?.version || '3.6.0';
};
