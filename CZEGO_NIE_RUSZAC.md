# Czego NIE ruszać — zasady działania wtyczki

## KRYTYCZNE — zmiana tych rzeczy psuje całą wtyczkę

---

### 1. `manifest.json` — wpis `background`

```json
"background": {
  "service_worker": "background.js"
}
```

**Dlaczego?**  
Bez tego `background.js` nie jest ładowany przez Chrome. Cały ruch sieciowy do Apps Script (`login`, `useReport`, `checkLimit`, analiza AI) przechodzi przez background service worker, który omija restrykcje CORS na stronach Allegro. Bez tego wpisu każde zapytanie do API kończy się błędem `Failed to fetch` i alertem "Błąd połączenia z serwerem".

---

### 2. `background.js` — nie modyfikować, nie usuwać

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'apiFetch') return;
    const { url, options = {} } = msg;
    fetch(url, options)
        .then(async (res) => { ... sendResponse(...) })
        .catch((err) => { sendResponse(...) });
    return true; // WAŻNE: trzyma kanał otwarty dla async sendResponse
});
```

**Dlaczego?**  
To jest proxy do Apps Script API. Content script (działający na allegro.pl) nie może bezpośrednio wywołać `fetch()` do zewnętrznych domen — Chrome blokuje to przez CORS. Background service worker nie ma tych ograniczeń i wykonuje requesty w imieniu content scriptu.

---

### 3. `content.js` — funkcja `extensionFetch` (linia ~78)

```js
async function extensionFetch(url, options = {}) {
    const fallback = { success: false, message: 'Błąd połączenia z serwerem' };
    try {
        const res = await chrome.runtime.sendMessage({ type: 'apiFetch', url, options });
        ...
    } catch (e) { ... }
}
```

**Dlaczego?**  
Ta funkcja jest odpowiednikiem `fetch()` ale dla content scriptu — zamiast bezpośrednio wywołać sieć, wysyła wiadomość do `background.js`. **Nigdy nie zamieniać `extensionFetch(...)` na zwykłe `fetch(...)` w kodzie wtyczki** — to psuje wszystkie zapytania do API.

---

### 4. `content.js` — stała `API_URL` (linia ~70)

```js
const API_URL = 'https://script.google.com/macros/s/AKfycbx.../exec';
```

**Dlaczego?**  
Musi być **pełny URL** do wdrożenia Google Apps Script (zaczynający się od `https://script.google.com/macros/s/`). Samo ID skryptu (bez `https://` i ścieżki) nie zadziała — `fetch()` w background.js dostanie nieprawidłowy adres i zwróci błąd.

---

### 5. `manifest.json` — `host_permissions`

```json
"host_permissions": [
    "https://allegro.pl/*",
    "https://*.allegro.pl/*",
    "https://script.google.com/*",
    ...
]
```

**Dlaczego?**  
Bez `https://script.google.com/*` background.js nie może robić requestów do Apps Script. Bez `https://allegro.pl/*` content script nie może wstrzyknąć UI na stronie.

---

### 6. `manifest.json` — kolejność skryptów w `content_scripts`

```json
"js": [
    "tesseract.min.js",
    "content.js"
]
```

**Dlaczego?**  
`tesseract.min.js` musi być załadowany **przed** `content.js`, bo `content.js` używa biblioteki Tesseract do OCR (analiza tekstu na zdjęciach). Odwrócenie kolejności spowoduje błąd `Tesseract is not defined`.

---

## Gdzie są klucze i konfiguracja backendu

- **Klucz OpenAI** — w projekcie Google Apps Script → Project Settings → Script properties → `OPENAI_API_KEY`
- **URL wdrożenia Apps Script** — w stałej `API_URL` w `content.js` (linia ~70). Po każdym nowym wdrożeniu Apps Script URL się zmienia i trzeba go zaktualizować tutaj.

---

## Schemat przepływu danych

```
allegro.pl (content.js)
    → extensionFetch()
        → chrome.runtime.sendMessage({ type: 'apiFetch', url, options })
            → background.js
                → fetch(url, options) do script.google.com
                    → Google Apps Script
                        → OpenAI API / Google Sheets
```

Każde ogniwo w tym łańcuchu jest konieczne. Usunięcie któregokolwiek psuje działanie API.
