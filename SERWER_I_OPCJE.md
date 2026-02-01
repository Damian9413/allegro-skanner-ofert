# Co jest na serwerze i jak działać bez dostępu

## Co dokładnie jest na serwerze (dajstrone.pl)

Serwer **dajstrone.pl/skaner-ofert/api.php** to aplikacja PHP z bazą MySQL. Działa tam:

| Funkcja | Opis |
|--------|------|
| **Logowanie / rejestracja** | ❌ NIE – to jest w **Google Apps Script** (masz dostęp). |
| **check_limit, use_report, submit_feedback** | ❌ NIE – też w Google Apps Script. |
| **analyze_image** | ✅ TAK – analiza miniatury przez OpenAI Vision (logo, tło, ostrość itd.). |
| **analyze_description_ai** | ✅ TAK – analiza opisu oferty przez OpenAI (GPT-4o-mini). |
| **log_ai_costs** | ✅ TAK – zapis zużycia tokenów do tabeli MySQL. |

Na serwerze PHP są więc tylko:
1. **Wywołania OpenAI** (obraz + opis) – z kluczem API trzymanym w bazie.
2. **Baza MySQL** – użytkownicy, klucze API, logi kosztów AI, feedback (te ostatnie mogą być tylko w PHP, albo częściowo w Script – zależy od Twojego obecnego setupu).

Bez dostępu do serwera **nie da się** zaktualizować `api.php` ani bazy – stąd np. „cudze logotypy” i ostrość/tło dalej według starej logiki.

---

## Opcja 1: Przenieść AI do Google Apps Script (bez nowego serwera) ✅

**Wtyczka jest już ustawiona:** `AI_API_URL` wskazuje na ten sam adres co `API_URL` (Google Apps Script). Wystarczy dodać obsługę AI w Apps Script i wdrożyć.

Masz już **Google Apps Script** (login, limity, feedback). Trzeba **dodać tam** obsługę:
- `analyze_image` (OpenAI Vision),
- `analyze_description_ai` (OpenAI tekst),
- opcjonalnie `log_ai_costs` (zapis do arkusza zamiast MySQL).

Wtedy:
- Nie potrzebujesz dostępu do dajstrone.pl.
- Nie stawiasz nowego serwera.
- Klucz OpenAI trzymasz w **Właściwościach projektu** (Script Properties), nie w PHP.

**Kroki:**
1. Otwórz istniejący projekt Google Apps Script (ten z logowaniem).
2. Skopiuj cały kod z pliku **`AppsScript-AI-Handlers.gs`** do tego projektu (jeden nowy plik .gs lub wklej na końcu istniejącego).
3. W **doGet(e)** na początku (przed innymi `action`) dodaj:
   ```javascript
   if (e.parameter.action === 'analyze_image') {
     return handleAnalyzeImage(e.parameter);
   }
   ```
4. W **doPost(e)** po odczytaniu body dodaj (log_ai_costs ma action w URL, analyze_description_ai w body):
   ```javascript
   var params = e.parameter || {};
   var body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
   if (params.action === 'log_ai_costs') return handleLogAICosts(body);
   if (body.action === 'analyze_description_ai') return handleAnalyzeDescriptionAI(body);
   ```
5. **Projekt → Właściwości projektu** (ikona zębatki) → **Skrypt** → dodaj właściwość: **OPENAI_API_KEY** = Twój klucz z platform.openai.com.
6. **Wdroż → Nowe wdrożenie** → typ: Aplikacja sieciowa, „Wykonaj jako: Ja”, „Kto ma dostęp: Wszyscy” → Wdróż. (Jeśli już masz wdrożenie, możesz je zaktualizować.)

Po wdrożeniu wtyczka będzie wysyłać analizę obrazu i opisu do tego samego URL co logowanie – bez PHP.

---

## Opcja 2: Nowy serwer (gdybyś kiedyś chciał)

Gdybyś chciał jednak mieć z powrotem „własny” backend zamiast Apps Script:

- **Darmowy hosting PHP + MySQL** (np. InfinityFree, 000webhost): wgrywasz `api.php`, zakładasz bazę, wklejasz dane dostępowe i klucz OpenAI do skryptu/bazy – wymaga dostępu do panelu i bazy.
- **Vercel / Netlify / Railway** – możliwe, ale wtedy backend trzeba by przepisać z PHP na Node.js (lub inny obsługiwany język), co to już większa zmiana.

Bez dostępu do żadnego serwera **nie da się** „wgrywać wersji” na dajstrone.pl – ktoś z dostępem (właściciel hostingu / admin) musiałby wgrać plik lub dać Ci dostęp.

---

## Podsumowanie

- **Na serwerze (dajstrone.pl)** jest tylko: analiza obrazu AI, analiza opisu AI i logowanie kosztów do bazy. Reszta (logowanie użytkowników, limity, feedback) jest w Google Apps Script.
- **Bez dostępu do serwera** sensowną opcją jest **Opcja 1**: przenieść obsługę AI do Google Apps Script i w wtyczce kierować wszystko na ten sam URL (API_URL). Wtedy możesz mieć aktualną logikę (cudze logotypy, ostrość, tło) bez potrzeby wgrywania czegokolwiek na dajstrone.pl.
