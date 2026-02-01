# Allegro Skan Ofert - Rozszerzenie Chrome

Rozszerzenie Chrome do skanowania i analizy jakości ofert na Allegro.pl

## 🚀 Instalacja

### Krok 1: Pobierz rozszerzenie
Folder `chrome-extension` zawiera wszystkie potrzebne pliki.

### Krok 2: Załaduj rozszerzenie do Chrome

1. Otwórz przeglądarkę **Google Chrome**
2. Wpisz w pasku adresu: `chrome://extensions/`
3. Włącz **Tryb dewelopera** (przełącznik w prawym górnym rogu)
4. Kliknij przycisk **"Załaduj rozpakowane"** (Load unpacked)
5. Wybierz folder `chrome-extension` z tego projektu
6. Rozszerzenie zostanie zainstalowane! ✅

### Krok 3: Użycie

1. Przejdź na stronę oferty Allegro (np. https://allegro.pl/oferta/...)
2. W prawym górnym rogu strony pojawi się panel **"🧮 Skan ofert"**
3. Zaloguj się lub zarejestruj konto (otrzymasz 10 darmowych raportów)
4. Kliknij **"📄 Generuj raport PDF"** aby wygenerować szczegółową analizę oferty

## 📋 Funkcje

- ✅ **Autoryzacja użytkowników** przez Google Sheets API
- ✅ **Analiza jakości obrazów** (rozdzielczość, białe ramki, DPI, OCR)
- ✅ **Analiza AI** miniaturek produktów (OpenAI GPT-4o-mini)
- ✅ **Generowanie raportów PDF** z pełną analizą oferty
- ✅ **System limitów** - kontrola liczby raportów na użytkownika
- ✅ **Feedback użytkowników** z ocenami gwiazdkowymi

## 🔧 Wymagania

- Google Chrome (wersja 88 lub nowsza)
- Połączenie z internetem (do komunikacji z API)

## 📝 Uwagi

- Rozszerzenie działa tylko na stronach Allegro.pl
- Wymaga aktywnego połączenia z Google Sheets API
- Tesseract.js jest używany do OCR (detekcja tekstu na obrazach)

## 🆘 Rozwiązywanie problemów

### Rozszerzenie nie działa
1. Sprawdź czy tryb dewelopera jest włączony
2. Odśwież rozszerzenie w `chrome://extensions/`
3. Przeładuj stronę Allegro (F5)

### Panel nie pojawia się
1. Upewnij się, że jesteś na stronie oferty Allegro
2. Sprawdź konsolę przeglądarki (F12) pod kątem błędów
3. Spróbuj wyłączyć i włączyć rozszerzenie

### Błędy API
1. Sprawdź połączenie z internetem
2. Upewnij się, że Google Sheets API jest dostępne
3. Sprawdź czy masz dostępne raporty (licznik w panelu)

## 📄 Licencja

Wersja 3.5.0 - Rozszerzenie Chrome
