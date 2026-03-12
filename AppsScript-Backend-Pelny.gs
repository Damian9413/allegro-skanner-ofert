// Apps Script Backend dla wtyczki Allegro Scanner
// Wersja z dynamicznym mapowaniem kolumn + reset hasła (API + menu admina)

// Konfiguracja
const SHEET_NAME = 'Baza';

// Klucz API OpenAI – opcjonalnie w kodzie (fallback). LEPSZE: ustaw w Script Properties (patrz niżej).
const OPENAI_API_KEY = '';

/**
 * Zwraca klucz OpenAI: najpierw Script Properties (Project settings → Script properties → OPENAI_API_KEY),
 * potem stała OPENAI_API_KEY w kodzie. Ustaw klucz w tym projekcie Apps Script, który ma URL wtyczki.
 */
function getOpenAIKey() {
  try {
    const fromProps = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (fromProps && fromProps.trim().length > 20) return fromProps.trim();
  } catch (e) {}
  return (OPENAI_API_KEY || '').trim();
}

// Cache dla mapowania kolumn
let columnMapping = null;

function doGet(e) {
  const action = e.parameter.action;
  const email = e.parameter.email;
  const password = e.parameter.password;
  const amount = e.parameter.amount;
  const imageUrl = e.parameter.imageUrl;
  const newPassword = e.parameter.new_password;

  Logger.log('GET request - action: ' + action + ', email: ' + email);

  try {
    switch(action) {
      case 'login':
        return handleLogin({email: email, password: password});
      case 'register':
        return handleRegister({email: email, password: password});
      case 'check_limit':
        return handleCheckLimit({email: email});
      case 'use_report':
        return handleUseReport({email: email});
      case 'add_reports':
        return handleAddReports({email: email, amount: parseInt(amount)});
      case 'analyze_image':
        return handleAnalyzeImage({email: email, imageUrl: imageUrl});
      case 'reset_password':
        return handleResetPassword({email: email, new_password: newPassword});
      default:
        return createResponse(false, 'Unknown action');
    }
  } catch(error) {
    Logger.log('Error: ' + error);
    return createResponse(false, 'Server error: ' + error.toString());
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      Logger.log('❌ doPost: brak body (postData.contents)');
      return createResponse(false, 'Brak danych POST');
    }
    const data = JSON.parse(e.postData.contents) || {};
    const action = e.parameter.action || data.action;

    Logger.log('POST request - action: ' + action);
    Logger.log('Data keys: ' + (data && typeof data === 'object' ? Object.keys(data).join(', ') : '—'));

    switch(action) {
      case 'login':
        return handleLogin(data);
      case 'register':
        return handleRegister(data);
      case 'check_limit':
        return handleCheckLimit(data);
      case 'use_report':
        return handleUseReport(data);
      case 'add_reports':
        return handleAddReports(data);
      case 'analyze_description_ai':
        return handleAnalyzeDescriptionAI(data);
      case 'analyze_image':
        return handleAnalyzeImage(data);
      case 'log_ai_costs':
        return handleLogAICosts(data);
      case 'submit_feedback':
        return handleSubmitFeedback(data);
      default:
        Logger.log('⚠️ Unknown action received: ' + action);
        return createResponse(false, 'Unknown action: ' + action);
    }
  } catch(error) {
    Logger.log('❌ Error in doPost: ' + error);
    return createResponse(false, 'Server error: ' + error.toString());
  }
}

// ============= RESET HASŁA (API + menu admina) =============

/**
 * Wewnętrzna logika resetu hasła. Zwraca obiekt { success, message }.
 * Używane przez handleResetPassword (API) i menuResetHasla (menu w arkuszu).
 */
function doResetPassword(email, newPassword) {
  email = (email || '').trim().toLowerCase();
  newPassword = newPassword || '';

  if (!email) {
    return { success: false, message: 'Podaj adres email.' };
  }
  if (!newPassword || newPassword.length < 6) {
    return { success: false, message: 'Nowe hasło musi mieć co najmniej 6 znaków.' };
  }

  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const users = sheet.getDataRange().getValues();

    for (let i = 1; i < users.length; i++) {
      const row = users[i];
      const rowEmail = String(getValueByColumn(row, 'email') || '').trim().toLowerCase();
      if (rowEmail === email) {
        const newHash = hashPassword(newPassword);
        setValueByColumn(sheet, i + 1, 'password_hash', newHash);
        Logger.log('✅ Hasło zresetowane dla: ' + email);
        return { success: true, message: 'Hasło zostało zmienione. Zaloguj się nowym hasłem.' };
      }
    }

    return { success: false, message: 'Nie znaleziono konta o podanym adresie email.' };
  } catch (err) {
    Logger.log('❌ doResetPassword: ' + err);
    return { success: false, message: err.message || 'Błąd podczas resetowania hasła.' };
  }
}

/**
 * GET ?action=reset_password&email=...&new_password=...
 * Używane przez wtyczkę (link "Zapomniałem hasła").
 */
function handleResetPassword(data) {
  const body = doResetPassword(data.email, data.new_password);
  return createResponse(body.success, body.message);
}

/**
 * Menu w arkuszu – tylko admin (osoba z dostępem do arkusza) może zresetować hasło.
 * Jeśli masz już własną funkcję onOpen(), dodaj w niej na końcu: addResetPasswordMenu();
 */
function onOpen() {
  addResetPasswordMenu();
}

function addResetPasswordMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Skan ofert')
    .addItem('Reset hasła użytkownika', 'menuResetHasla')
    .addToUi();
}

function menuResetHasla() {
  const ui = SpreadsheetApp.getUi();

  const emailPrompt = ui.prompt('Reset hasła', 'Podaj adres email użytkownika:', ui.ButtonSet.OK_CANCEL);
  if (emailPrompt.getSelectedButton() !== ui.Button.OK) return;
  let email = (emailPrompt.getResponseText() || '').trim();
  if (!email) {
    ui.alert('Błąd', 'Nie podano adresu email.', ui.ButtonSet.OK);
    return;
  }

  const passPrompt = ui.prompt('Reset hasła', 'Podaj nowe hasło (min. 6 znaków):', ui.ButtonSet.OK_CANCEL);
  if (passPrompt.getSelectedButton() !== ui.Button.OK) return;
  const newPassword = passPrompt.getResponseText() || '';
  if (newPassword.length < 6) {
    ui.alert('Błąd', 'Hasło musi mieć co najmniej 6 znaków.', ui.ButtonSet.OK);
    return;
  }

  const body = doResetPassword(email, newPassword);
  if (body.success) {
    ui.alert('Sukces', 'Hasło dla ' + email + ' zostało zmienione. Użytkownik może się zalogować nowym hasłem.', ui.ButtonSet.OK);
  } else {
    ui.alert('Błąd', body.message || 'Nie udało się zresetować hasła.', ui.ButtonSet.OK);
  }
}

// ============= MAPOWANIE KOLUMN I POMOCNICZE =============

function getColumnMapping() {
  if (columnMapping !== null) {
    return columnMapping;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  columnMapping = {};
  headers.forEach((header, index) => {
    if (header) {
      columnMapping[header.trim().toLowerCase()] = index;
    }
  });

  Logger.log('Column mapping: ' + JSON.stringify(columnMapping));
  return columnMapping;
}

function getColumnIndex(columnName) {
  const mapping = getColumnMapping();
  const index = mapping[columnName.toLowerCase()];
  if (index === undefined) {
    throw new Error('Column "' + columnName + '" not found');
  }
  return index;
}

function getValueByColumn(row, columnName) {
  return row[getColumnIndex(columnName)];
}

function setValueByColumn(sheet, rowIndex, columnName, value) {
  const colIndex = getColumnIndex(columnName);
  sheet.getRange(rowIndex, colIndex + 1).setValue(value);
}

// Obsługa rejestracji nowego użytkownika
function handleRegister(data) {
  const email = data.email;
  const password = data.password;

  if (!email || !password) {
    return createResponse(false, 'Email i hasło są wymagane');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return createResponse(false, 'Nieprawidłowy format email');
  }

  if (password.length < 6) {
    return createResponse(false, 'Hasło musi mieć minimum 6 znaków');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const users = sheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    const row = users[i];
    const existingEmail = getValueByColumn(row, 'email');

    if (existingEmail === email) {
      return createResponse(false, 'Użytkownik z tym adresem email już istnieje');
    }
  }

  const passwordHash = hashPassword(password);
  const newRow = sheet.getLastRow() + 1;
  const now = new Date();

  setValueByColumn(sheet, newRow, 'email', email);
  setValueByColumn(sheet, newRow, 'password_hash', passwordHash);
  setValueByColumn(sheet, newRow, 'reports_limit', 10);
  setValueByColumn(sheet, newRow, 'reports_used', 0);
  setValueByColumn(sheet, newRow, 'status', 'active');
  setValueByColumn(sheet, newRow, 'created_at', now);

  Logger.log('✅ Nowy użytkownik utworzony: ' + email);

  return createResponse(true, 'Konto utworzone pomyślnie', {
    email: email,
    reportsLimit: 10,
    reportsUsed: 0,
    reportsRemaining: 10
  });
}

// Obsługa logowania
function handleLogin(data) {
  const email = data.email;
  const password = data.password;

  if (!email || !password) {
    return createResponse(false, 'Email i hasło są wymagane');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const users = sheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    const row = users[i];
    const userEmail = getValueByColumn(row, 'email');
    const passwordHash = getValueByColumn(row, 'password_hash');
    const reportsLimit = getValueByColumn(row, 'reports_limit');
    const reportsUsed = getValueByColumn(row, 'reports_used');
    const status = getValueByColumn(row, 'status');

    if (userEmail === email) {
      const inputHash = hashPassword(password);

      if (inputHash === passwordHash) {
        if (status !== 'active') {
          return createResponse(false, 'Konto nieaktywne');
        }

        const now = new Date();
        setValueByColumn(sheet, i + 1, 'last_login', now);

        return createResponse(true, 'Login successful', {
          email: userEmail,
          reportsLimit: reportsLimit,
          reportsUsed: reportsUsed,
          reportsRemaining: reportsLimit - reportsUsed
        });
      } else {
        return createResponse(false, 'Nieprawidłowe hasło');
      }
    }
  }

  return createResponse(false, 'Użytkownik nie znaleziony');
}

// Sprawdź limit raportów
function handleCheckLimit(data) {
  const email = data.email;

  if (!email) {
    return createResponse(false, 'Email jest wymagany');
  }

  const userData = getUserData(email);

  if (!userData) {
    return createResponse(false, 'Użytkownik nie znaleziony');
  }

  return createResponse(true, 'Limit checked', {
    reportsLimit: userData.reportsLimit,
    reportsUsed: userData.reportsUsed,
    reportsRemaining: userData.reportsLimit - userData.reportsUsed
  });
}

// Użyj raportu (zmniejsz licznik)
function handleUseReport(data) {
  const email = data.email;

  if (!email) {
    return createResponse(false, 'Email jest wymagany');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const users = sheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    const row = users[i];
    const userEmail = getValueByColumn(row, 'email');
    const reportsLimit = getValueByColumn(row, 'reports_limit');
    const reportsUsed = getValueByColumn(row, 'reports_used');

    if (userEmail === email) {
      const remaining = reportsLimit - reportsUsed;

      if (remaining <= 0) {
        return createResponse(false, 'Brak dostępnych raportów');
      }

      const newReportsUsed = reportsUsed + 1;
      setValueByColumn(sheet, i + 1, 'reports_used', newReportsUsed);

      const now = new Date();
      try {
        setValueByColumn(sheet, i + 1, 'last_use', now);
      } catch(e) {
        Logger.log('Warning: last_use column not found');
      }

      return createResponse(true, 'Report used', {
        reportsUsed: newReportsUsed,
        reportsRemaining: remaining - 1
      });
    }
  }

  return createResponse(false, 'Użytkownik nie znaleziony');
}

// Dodaj raporty (np. po płatności)
function handleAddReports(data) {
  const email = data.email;
  const amount = data.amount || 0;

  if (!email || amount <= 0) {
    return createResponse(false, 'Email i liczba raportów są wymagane');
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const users = sheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    const row = users[i];
    const userEmail = getValueByColumn(row, 'email');
    const currentLimit = getValueByColumn(row, 'reports_limit');

    if (userEmail === email) {
      const newLimit = currentLimit + amount;
      setValueByColumn(sheet, i + 1, 'reports_limit', newLimit);

      return createResponse(true, 'Reports added', {
        reportsLimit: newLimit,
        reportsAdded: amount
      });
    }
  }

  return createResponse(false, 'Użytkownik nie znaleziony');
}

function getUserData(email) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const users = sheet.getDataRange().getValues();

  for (let i = 1; i < users.length; i++) {
    const row = users[i];
    if (getValueByColumn(row, 'email') === email) {
      return {
        email: getValueByColumn(row, 'email'),
        reportsLimit: getValueByColumn(row, 'reports_limit'),
        reportsUsed: getValueByColumn(row, 'reports_used'),
        status: getValueByColumn(row, 'status')
      };
    }
  }

  return null;
}

function hashPassword(password) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  ).map(function(byte) {
    const v = (byte < 0) ? 256 + byte : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function createResponse(success, message, data) {
  const response = {
    success: success,
    message: message
  };

  if (data) {
    response.data = data;
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// === ANALIZA OPISU PRZEZ AI (OPENAI) ===

function handleAnalyzeDescriptionAI(data) {
  Logger.log('🤖 Rozpoczynam analizę opisu przez AI...');

  const title = data.title || '';
  const parameters = data.parameters || [];
  const description = data.description || '';

  if (!description || description.length < 10) {
    Logger.log('⚠️ Opis zbyt krótki lub pusty');
    return createResponse(false, 'Opis jest zbyt krótki do analizy');
  }

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    Logger.log('❌ Brak klucza OpenAI API. Ustaw Script property OPENAI_API_KEY lub stałą OPENAI_API_KEY w kodzie.');
    return createResponse(false, 'Klucz OpenAI API nie został skonfigurowany');
  }

  try {
    const parametersText = parameters.map(p => `${p.name}: ${p.value}`).join('\n');

    // Format jak na zatwierdzonym wzorze: 1. Podsumowanie, 2. Zalety, 3. Elementy do poprawy, 4. Sugestia na początek (przykładowy akapit)
    const prompt = `Przeanalizuj poniższy opis oferty Allegro pod kątem jakości sprzedażowej, SEO i czytelności.

Tytuł oferty: ${title}

Parametry produktu:
${parametersText}

Opis oferty:
${description.substring(0, 8000)}${description.length > 8000 ? '...[opis skrócony]' : ''}

Odpowiedz w języku polskim, konkretnie i konstruktywnie. Zachowaj dokładnie tę strukturę (numeracja 1.–4.).
WAŻNE: Nie używaj wcięć ani spacji na początku linii – każda linia zaczyna się od lewej krawędzi (bez spacji/tabów przed tekstem).

1. Krótkie podsumowanie jakości opisu (1–2 zdania): czy opis jest szczegółowy, co jest dobre, co wymaga poprawy (spójność, SEO, język korzyści).

2. Zalety opisu:
• 3–4 główne zalety (punktory, np. szczegółowe dane techniczne, nacisk na wytrzymałość, informacje o funkcjach, jakość wykonania).

3. Elementy do poprawy:
• 3–4 konkretne rzeczy do poprawy (punktory, np. brak słów kluczowych SEO na początku, za długi akapit, słabszy język korzyści, brak zachęty na początku).

4. Sugestia do ulepszenia początku opisu:
Napisz gotowy, przykładowy akapit na początek opisu (2–3 zdania), który od razu przyciągnie uwagę i podkreśli główne zalety produktu. Nie pisz tylko wskazówek – podaj konkretny tekst do wklejenia.`;

    const requestBody = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Jesteś ekspertem e-commerce i copywriterem specjalizującym się w Allegro. Twoim zadaniem jest ocena jakości opisu produktu i wskazanie obszarów do poprawy. Bądź konkretny, zwięzły i pomocny.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 3000
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + apiKey
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    Logger.log('📤 Wysyłam żądanie do OpenAI API...');
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    const responseCode = response.getResponseCode();

    Logger.log('📥 Odpowiedź od OpenAI - kod: ' + responseCode);

    if (responseCode !== 200) {
      const errorText = response.getContentText();
      Logger.log('❌ Błąd API: ' + errorText);
      return createResponse(false, 'Błąd OpenAI API: ' + errorText);
    }

    const result = JSON.parse(response.getContentText());

    if (result.choices && result.choices.length > 0) {
      const aiAnalysis = result.choices[0].message.content;
      const usage = result.usage || {};

      Logger.log('✅ Otrzymano analizę AI');
      Logger.log('📝 Długość odpowiedzi: ' + aiAnalysis.length + ' znaków');
      Logger.log('📊 Tokeny: ' + (usage.total_tokens || 0) + ' (in: ' + (usage.prompt_tokens || 0) + ', out: ' + (usage.completion_tokens || 0) + ')');

      return createResponse(true, 'Analiza zakończona', {
        analysis: aiAnalysis,
        tokensUsed: usage.total_tokens || 0,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0
      });
    } else {
      Logger.log('⚠️ Brak odpowiedzi w wyniku');
      return createResponse(false, 'Brak odpowiedzi od AI');
    }

  } catch (error) {
    Logger.log('❌ Błąd podczas analizy AI: ' + error.toString());
    return createResponse(false, 'Błąd podczas analizy: ' + error.toString());
  }
}

// === ANALIZA MINIATUR PRZEZ AI (OPENAI VISION) ===

function handleAnalyzeImage(data) {
  const email = data.email;
  const imageUrl = data.imageUrl;

  Logger.log('📸 Analiza obrazu - email: ' + email + ', imageUrl: ' + imageUrl);

  if (!email) {
    return createResponse(false, 'Email jest wymagany');
  }

  if (!imageUrl) {
    return createResponse(false, 'URL obrazu jest wymagany');
  }

  const userData = getUserData(email);
  if (!userData) {
    return createResponse(false, 'Użytkownik nie znaleziony');
  }

  const apiKey = getOpenAIKey();
  if (!apiKey) {
    return createResponse(false, 'Klucz OpenAI API nie został skonfigurowany');
  }

  try {
    const analysisResult = callOpenAIVision(imageUrl, apiKey);

    Logger.log('✅ Analiza zakończona pomyślnie');

    return createResponse(true, 'Analiza zakończona', analysisResult);
  } catch (error) {
    Logger.log('❌ Błąd analizy: ' + error.toString());

    return createResponse(true, 'Analiza wykonana z błędem', {
      regulaminCompliance: {
        watermarks: { detected: false, details: 'Analiza niedostępna' },
        promotionalText: { detected: false, details: 'Analiza niedostępna' },
        logos: { detected: false, details: 'Analiza niedostępna' },
        extraElements: { detected: false, details: 'Analiza niedostępna' },
        colorVariants: { detected: false, details: 'Analiza niedostępna' },
        inappropriateContent: { detected: false, details: 'Analiza niedostępna' }
      },
      visualQuality: {
        sharpness: { score: 0, assessment: 'Analiza niedostępna' },
        background: { score: 0, assessment: 'Analiza niedostępna' }
      },
      overallAIScore: 0,
      summary: 'Analiza AI nie powiodła się',
      aiErrors: [error.toString()]
    });
  }
}

function callOpenAIVision(imageUrl, apiKey) {
  if (!apiKey) apiKey = getOpenAIKey();
  const apiUrl = 'https://api.openai.com/v1/chat/completions';

  const prompt = `Przeanalizuj to zdjęcie produktu z Allegro i oceń je według następujących kryteriów. Odpowiedz WYŁĄCZNIE w formacie JSON bez żadnych dodatkowych komentarzy.

KRYTERIA ANALIZY:

1. ZGODNOŚĆ Z REGULAMINEM (sprawdź czy występują):
   - Znaki wodne / watermarki
   - Tekst promocyjny (PROMOCJA, GRATIS, -50%, NAJNIŻSZA CENA, itp.)
   - Cudze logotypy (innych sklepów, platform, konkurencji)
   - Napisy, strzałki, ramki i inne elementy graficzne które nie są częścią produktu
   - Różne warianty kolorystyczne produktu widoczne na miniaturze (np. 5 kolorów butów)
   - Niestosowne treści (kontrowersyjne, nieodpowiednie elementy)

2. JAKOŚĆ WIZUALNA:
   - Ostrość zdjęcia (czy jest rozmazane czy ostre)
   - Profesjonalność tła (najlepiej białe/neutralne, jednolite)

Format odpowiedzi JSON:
{
  "regulaminCompliance": {
    "watermarks": {"detected": false, "details": "Opis lub 'Brak'"},
    "promotionalText": {"detected": false, "details": "Opis lub 'Brak'"},
    "logos": {"detected": false, "details": "Opis lub 'Brak'"},
    "extraElements": {"detected": false, "details": "Opis elementów graficznych (napisy, strzałki) lub 'Brak'"},
    "colorVariants": {"detected": false, "details": "Opis widocznych wariantów lub 'Brak'"},
    "inappropriateContent": {"detected": false, "details": "Opis lub 'Brak'"}
  },
  "visualQuality": {
    "sharpness": {"score": 85, "assessment": "Bardzo ostre zdjęcie" lub "Lekko rozmazane" itp.},
    "background": {"score": 90, "assessment": "Profesjonalne białe tło" lub "Niejednolite tło" itp.}
  },
  "overallAIScore": 88,
  "summary": "Krótkie podsumowanie analizy"
}

ODPOWIEDZ TYLKO KODEM JSON, BEZ DODATKOWYCH TEKSTU.`;

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
              detail: 'low'
            }
          }
        ]
      }
    ],
    max_tokens: 1000,
    temperature: 0.3
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  Logger.log('📤 Wysyłam żądanie do OpenAI Vision API...');

  const response = UrlFetchApp.fetch(apiUrl, options);
  const responseCode = response.getResponseCode();

  Logger.log('📥 Odpowiedź OpenAI - kod: ' + responseCode);

  if (responseCode !== 200) {
    throw new Error('OpenAI API error: ' + response.getContentText());
  }

  const jsonResponse = JSON.parse(response.getContentText());

  if (!jsonResponse.choices || jsonResponse.choices.length === 0) {
    throw new Error('Brak odpowiedzi od OpenAI');
  }

  const textResponse = jsonResponse.choices[0].message.content;
  const usage = jsonResponse.usage || {};

  Logger.log('📝 Surowa odpowiedź: ' + textResponse.substring(0, 200) + '...');
  Logger.log('📊 Tokeny: ' + (usage.total_tokens || 0) + ' (in: ' + (usage.prompt_tokens || 0) + ', out: ' + (usage.completion_tokens || 0) + ')');

  let jsonText = textResponse.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/```\n?/g, '');
  }

  const parsed = JSON.parse(jsonText);

  parsed.aiErrors = [];
  parsed.inputTokens = usage.prompt_tokens || 0;
  parsed.outputTokens = usage.completion_tokens || 0;
  parsed.tokensUsed = usage.total_tokens || 0;

  return parsed;
}

// ============= LOGOWANIE KOSZTÓW AI =============

function getTotalAICostsForUser(userEmail) {
  const costsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Koszty AI');

  if (!costsSheet) {
    Logger.log('📊 Arkusz "Koszty AI" nie istnieje - zwracam 0');
    return { totalPLN: 0, totalUSD: 0, count: 0 };
  }

  const lastRow = costsSheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log('📊 Brak danych w arkuszu "Koszty AI" - zwracam 0');
    return { totalPLN: 0, totalUSD: 0, count: 0 };
  }

  const mapping = getAICostsColumnMapping(costsSheet);

  if (!mapping['email użytkownika'] || !mapping['koszt pln'] || !mapping['koszt usd']) {
    Logger.log('⚠️ Brak wymaganych kolumn w arkuszu Koszty AI');
    return { totalPLN: 0, totalUSD: 0, count: 0 };
  }

  const emailColIndex = mapping['email użytkownika'] - 1;
  const costPLNColIndex = mapping['koszt pln'] - 1;
  const costUSDColIndex = mapping['koszt usd'] - 1;

  const numColumns = 15;
  const allData = costsSheet.getRange(2, 1, lastRow, numColumns).getValues();

  let totalPLN = 0;
  let totalUSD = 0;
  let count = 0;

  allData.forEach((row) => {
    if (row[emailColIndex] === userEmail) {
      const costPLN = parseFloat(row[costPLNColIndex]) || 0;
      const costUSD = parseFloat(row[costUSDColIndex]) || 0;
      totalPLN += costPLN;
      totalUSD += costUSD;
      count++;
    }
  });

  Logger.log(`💰 Suma kosztów dla ${userEmail}: ${totalPLN.toFixed(4)} PLN ($${totalUSD.toFixed(6)} USD) | ${count} wywołań`);

  return { totalPLN, totalUSD, count };
}

function updateUserTotalAICosts(userEmail) {
  try {
    const userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    const lastRow = userSheet.getLastRow();
    if (lastRow === 0) {
      Logger.log('⚠️ Arkusz główny jest pusty - nie można zaktualizować kosztów');
      return false;
    }

    let mapping = getColumnMapping();

    if (!mapping['koszty ai łącznie (pln)']) {
      Logger.log('➕ Kolumna "Koszty AI łącznie (PLN)" nie istnieje - dodaję ją');
      const lastCol = userSheet.getLastColumn();
      const newCol = lastCol + 1;

      userSheet.getRange(1, newCol).setValue('Koszty AI łącznie (PLN)');

      const headerCell = userSheet.getRange(1, newCol);
      headerCell.setFontWeight('bold');
      headerCell.setBackground('#f3f3f3');

      columnMapping = null;
      mapping = getColumnMapping();

      Logger.log('✅ Kolumna "Koszty AI łącznie (PLN)" dodana w pozycji: ' + newCol);
    } else {
      Logger.log('✅ Kolumna "Koszty AI łącznie (PLN)" już istnieje - używam istniejącej');
    }

    const costs = getTotalAICostsForUser(userEmail);

    const emailCol = getColumnIndex('email');
    const costsColIndex = getColumnIndex('koszty ai łącznie (pln)');
    const allData = userSheet.getDataRange().getValues();

    for (let i = 1; i < allData.length; i++) {
      if (allData[i][emailCol] === userEmail) {
        const userRow = i + 1;
        const costsCol = costsColIndex + 1;

        const costValue = parseFloat(costs.totalPLN.toFixed(4));
        userSheet.getRange(userRow, costsCol).setValue(costValue);

        Logger.log(`✅ Zaktualizowano koszty AI dla ${userEmail}: ${costs.totalPLN.toFixed(4)} PLN (${costs.count} wywołań) - wiersz ${userRow}, kolumna ${costsCol}`);
        return true;
      }
    }

    Logger.log('⚠️ Nie znaleziono użytkownika w arkuszu głównym');
    return false;

  } catch (error) {
    Logger.log('❌ Błąd podczas aktualizacji kosztów AI: ' + error.toString());
    return false;
  }
}

const AI_COSTS_HEADERS = [
  'Data i czas',
  'Email użytkownika',
  'Funkcja',
  'Model',
  'Tokeny łącznie',
  'Tokeny wejściowe',
  'Tokeny wyjściowe',
  'Koszt USD',
  'Koszt PLN',
  'URL oferty',
  'Nazwa oferty',
  'Długość opisu',
  'Liczba parametrów',
  'URL obrazu',
  'Rozdzielczość'
];

function ensureAICostsSheetExists() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Koszty AI');

  if (!sheet) {
    Logger.log('🆕 Tworzę nowy arkusz "Koszty AI"');
    sheet = spreadsheet.insertSheet('Koszty AI');
  }

  const currentLastColumn = sheet.getLastColumn();
  const currentLastRow = sheet.getLastRow();

  Logger.log('📊 Obecny stan arkusza "Koszty AI": ' + currentLastRow + ' wierszy, ' + currentLastColumn + ' kolumn');

  if (currentLastRow === 0 || currentLastColumn === 0) {
    Logger.log('📋 Arkusz "Koszty AI" jest pusty - dodaję nagłówki');

    sheet.getRange(1, 1, 1, AI_COSTS_HEADERS.length).setValues([AI_COSTS_HEADERS]);

    const headerRange = sheet.getRange(1, 1, 1, AI_COSTS_HEADERS.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');

    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 150);
    sheet.setColumnWidth(4, 100);
    sheet.setColumnWidth(5, 120);
    sheet.setColumnWidth(6, 120);
    sheet.setColumnWidth(7, 120);
    sheet.setColumnWidth(8, 100);
    sheet.setColumnWidth(9, 100);
    sheet.setColumnWidth(10, 300);
    sheet.setColumnWidth(11, 250);

    sheet.setFrozenRows(1);

    Logger.log('✅ Nagłówki dodane do arkusza Koszty AI');
  } else {
    const firstRowValues = sheet.getRange(1, 1, 1, Math.min(AI_COSTS_HEADERS.length, currentLastColumn)).getValues()[0];

    let hasHeaders = true;
    for (let i = 0; i < Math.min(3, firstRowValues.length); i++) {
      if (firstRowValues[i] !== AI_COSTS_HEADERS[i]) {
        hasHeaders = false;
        break;
      }
    }

    if (!hasHeaders) {
      Logger.log('⚠️ Arkusz "Koszty AI" nie ma prawidłowych nagłówków - naprawiam');

      sheet.insertRowBefore(1);

      sheet.getRange(1, 1, 1, AI_COSTS_HEADERS.length).setValues([AI_COSTS_HEADERS]);

      const headerRange = sheet.getRange(1, 1, 1, AI_COSTS_HEADERS.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('#ffffff');

      sheet.setFrozenRows(1);

      Logger.log('✅ Nagłówki naprawione w arkuszu "Koszty AI"');
    } else {
      Logger.log('✅ Arkusz "Koszty AI" ma prawidłowe nagłówki - używam istniejącego');
    }
  }

  return sheet;
}

function getAICostsColumnMapping(sheet) {
  const numColumns = 15;
  const headers = sheet.getRange(1, 1, 1, numColumns).getValues()[0];
  const mapping = {};

  Logger.log('📋 Nagłówki z arkusza (' + headers.length + '): ' + headers.join(', '));

  headers.forEach((header, index) => {
    if (header) {
      const normalizedHeader = header.trim().toLowerCase();
      mapping[normalizedHeader] = index + 1;
    }
  });

  Logger.log('🗺️ Utworzono mapowanie dla ' + Object.keys(mapping).length + ' kolumn');

  return mapping;
}

function handleLogAICosts(data) {
  try {
    Logger.log('💰 Logowanie kosztów AI...');
    Logger.log('📧 Email: ' + data.userEmail);
    Logger.log('🔧 Funkcja: ' + data.functionName);
    Logger.log('💵 Koszt: $' + data.costUSD + ' USD (' + data.costPLN + ' PLN)');
    Logger.log('🎯 Tokeny: ' + data.tokensUsed);

    const userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    if (!userSheet) {
      Logger.log('❌ Arkusz "' + SHEET_NAME + '" nie istnieje');
      return createResponse(false, 'Arkusz użytkowników nie znaleziony');
    }

    const emailCol = getColumnIndex('email');
    const allData = userSheet.getDataRange().getValues();

    const userExists = allData.some((row, index) => {
      if (index === 0) return false;
      return row[emailCol] === data.userEmail;
    });

    if (!userExists) {
      return createResponse(false, 'Użytkownik nie istnieje');
    }

    const costsSheet = ensureAICostsSheetExists();
    const mapping = getAICostsColumnMapping(costsSheet);

    Logger.log('📊 Mapowanie kolumn: ' + JSON.stringify(mapping));
    Logger.log('📊 Liczba kolumn w mapowaniu: ' + Object.keys(mapping).length);

    const requiredColumns = ['data i czas', 'email użytkownika', 'funkcja', 'model', 'tokeny łącznie', 'koszt usd', 'koszt pln'];
    const missingColumns = requiredColumns.filter(col => !mapping[col]);

    if (missingColumns.length > 0) {
      Logger.log('❌ Brakujące kolumny: ' + missingColumns.join(', '));
      return createResponse(false, 'Brakujące kolumny w arkuszu: ' + missingColumns.join(', '));
    }

    const lastRow = costsSheet.getLastRow();
    const newRow = lastRow + 1;

    Logger.log('📝 Zapisuję do wiersza: ' + newRow);

    const numColumns = AI_COSTS_HEADERS.length;
    const rowData = new Array(numColumns).fill('');

    Logger.log('📋 Przygotowano tablicę na ' + numColumns + ' kolumn');

    function setColumnValue(columnName, value) {
      const colIndex = mapping[columnName];
      if (colIndex !== undefined) {
        rowData[colIndex - 1] = value;
      } else {
        Logger.log('⚠️ Brak kolumny: ' + columnName);
      }
    }

    setColumnValue('data i czas', data.dateTime || '');
    setColumnValue('email użytkownika', data.userEmail || '');
    setColumnValue('funkcja', data.functionName || '');
    setColumnValue('model', data.model || 'gpt-4o-mini');
    setColumnValue('tokeny łącznie', data.tokensUsed || 0);
    setColumnValue('tokeny wejściowe', data.inputTokens || 0);
    setColumnValue('tokeny wyjściowe', data.outputTokens || 0);
    setColumnValue('koszt usd', data.costUSD || 0);
    setColumnValue('koszt pln', data.costPLN || 0);

    setColumnValue('url oferty', data.offerUrl || '');
    setColumnValue('nazwa oferty', data.offerName || '');
    setColumnValue('długość opisu', data.descriptionLength || '');
    setColumnValue('liczba parametrów', data.parametersCount || '');
    setColumnValue('url obrazu', data.imageUrl || '');
    setColumnValue('rozdzielczość', data.imageResolution || '');

    Logger.log('💾 Zapisuję wiersz: ' + newRow + ', kolumny: 1-' + rowData.length);
    Logger.log('📊 Długość tablicy rowData: ' + rowData.length);
    Logger.log('📝 Próbka danych: ' + JSON.stringify(rowData.slice(0, 5)));

    if (rowData.length === 0) {
      Logger.log('❌ BŁĄD: rowData jest puste!');
      return createResponse(false, 'Błąd: brak danych do zapisania');
    }

    // appendRow – zawsze dodaje 1 wiersz na końcu, unika błędu "Liczba wierszy danych nie jest zgodna"
    costsSheet.appendRow(rowData);
    const appendedRow = costsSheet.getLastRow();

    Logger.log('✅ Koszty AI zalogowane: wiersz ' + appendedRow);
    Logger.log(`💰 $${data.costUSD} USD (${data.costPLN} PLN) | ${data.tokensUsed} tokenów`);

    Logger.log('🔄 Aktualizuję łączne koszty użytkownika w arkuszu głównym...');
    updateUserTotalAICosts(data.userEmail);

    return createResponse(true, 'Koszty AI zalogowane', {
      row: appendedRow,
      tokensUsed: data.tokensUsed,
      costUSD: data.costUSD,
      costPLN: data.costPLN
    });

  } catch(error) {
    Logger.log('❌ Błąd logowania kosztów AI: ' + error.toString());
    return createResponse(false, 'Błąd logowania kosztów: ' + error.toString());
  }
}

// ============= FEEDBACK =============

const FEEDBACK_CATEGORIES = [
  'Analiza obrazów',
  'Analiza opisu',
  'Dane sprzedawcy',
  'Parametry produktu',
  'Polityki zwrotów i reklamacji',
  'Allegro Pay i wysyłka',
  'Ogólna użyteczność'
];

function handleSubmitFeedback(data) {
  try {
    Logger.log('📝 Otrzymano feedback od użytkownika');

    if (!data.userEmail) {
      Logger.log('❌ Brak email użytkownika');
      return createResponse(false, 'Brak email użytkownika');
    }

    const hasFeedbackText = data.feedback && data.feedback.trim().length > 0;
    const hasRatings = data.ratings && Object.keys(data.ratings).length > 0;

    if (!hasFeedbackText && !hasRatings) {
      Logger.log('❌ Brak feedbacku tekstowego i ocen');
      return createResponse(false, 'Musisz dodać feedback tekstowy lub oceny gwiazdkowe');
    }

    Logger.log('📧 Email: ' + data.userEmail);
    if (hasFeedbackText) {
      Logger.log('💬 Feedback: ' + data.feedback.substring(0, 100) + (data.feedback.length > 100 ? '...' : ''));
    }
    if (hasRatings) {
      Logger.log('⭐ Liczba ocen: ' + Object.keys(data.ratings).length);
    }

    const feedbackSheet = ensureFeedbackSheetExists();

    const timestamp = new Date();
    const baseData = [
      timestamp,
      data.userEmail,
      hasFeedbackText ? data.feedback.trim() : '',
      data.offerUrl || '',
      data.offerName || ''
    ];

    const ratingsData = FEEDBACK_CATEGORIES.map(category => {
      if (hasRatings && data.ratings[category]) {
        const rating = parseInt(data.ratings[category]);
        return rating >= 1 && rating <= 5 ? rating : '';
      }
      return '';
    });

    const fullData = baseData.concat(ratingsData);

    const newRow = feedbackSheet.getLastRow() + 1;
    feedbackSheet.getRange(newRow, 1, newRow, fullData.length).setValues([fullData]);

    feedbackSheet.getRange(newRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');

    if (hasRatings) {
      const ratingsStartCol = 6;
      const ratingsEndCol = 5 + FEEDBACK_CATEGORIES.length;
      feedbackSheet.getRange(newRow, ratingsStartCol, newRow, ratingsEndCol).setHorizontalAlignment('center');
    }

    Logger.log('✅ Feedback zapisany w wierszu: ' + newRow);

    return createResponse(true, 'Dziękujemy za feedback!', {
      row: newRow,
      timestamp: timestamp.toISOString(),
      hasText: hasFeedbackText,
      hasRatings: hasRatings
    });

  } catch(error) {
    Logger.log('❌ Błąd podczas zapisywania feedbacku: ' + error.toString());
    return createResponse(false, 'Błąd zapisu feedbacku: ' + error.toString());
  }
}

function ensureFeedbackSheetExists() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Feedback');

  if (!sheet) {
    Logger.log('➕ Tworzę nowy arkusz "Feedback"');
    sheet = spreadsheet.insertSheet('Feedback');
  }

  const baseHeaders = ['Data i czas', 'Email użytkownika', 'Feedback tekstowy', 'URL oferty', 'Nazwa oferty'];
  const ratingHeaders = FEEDBACK_CATEGORIES.map(cat => '⭐ ' + cat);
  const allHeaders = baseHeaders.concat(ratingHeaders);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    Logger.log('📋 Arkusz "Feedback" jest pusty - dodaję nagłówki');

    sheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);

    const headerRange = sheet.getRange(1, 1, 1, allHeaders.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');

    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 200);
    sheet.setColumnWidth(3, 400);
    sheet.setColumnWidth(4, 300);
    sheet.setColumnWidth(5, 200);

    for (let i = 0; i < FEEDBACK_CATEGORIES.length; i++) {
      sheet.setColumnWidth(6 + i, 120);
    }

    sheet.setFrozenRows(1);

    Logger.log('✅ Nagłówki dodane do arkusza "Feedback" (' + allHeaders.length + ' kolumn)');
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(lastCol, allHeaders.length)).getValues()[0];

    let hasHeaders = currentHeaders[0] === 'Data i czas' &&
                     currentHeaders[1] === 'Email użytkownika';

    if (!hasHeaders) {
      Logger.log('⚠️ Arkusz "Feedback" nie ma prawidłowych nagłówków - naprawiam');

      sheet.insertRowBefore(1);

      sheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);

      const headerRange = sheet.getRange(1, 1, 1, allHeaders.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('#ffffff');
      headerRange.setHorizontalAlignment('center');

      sheet.setFrozenRows(1);

      Logger.log('✅ Nagłówki naprawione w arkuszu "Feedback"');
    } else {
      const hasRatingColumns = currentHeaders.some(h => h && h.includes('⭐'));

      if (!hasRatingColumns && lastCol < allHeaders.length) {
        Logger.log('➕ Dodaję kolumny z ocenami gwiazdkowymi do istniejącego arkusza');

        sheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]);

        const headerRange = sheet.getRange(1, 1, 1, allHeaders.length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#4285f4');
        headerRange.setFontColor('#ffffff');
        headerRange.setHorizontalAlignment('center');

        for (let i = lastCol; i < allHeaders.length; i++) {
          sheet.setColumnWidth(i + 1, 120);
        }

        Logger.log('✅ Dodano ' + (allHeaders.length - lastCol) + ' nowych kolumn z ocenami');
      } else {
        Logger.log('✅ Arkusz "Feedback" ma prawidłowe nagłówki - używam istniejącego');
      }
    }
  }

  return sheet;
}

// ============= POMOCNICZE =============

function generateHash() {
  const password = 'password123';
  const hash = hashPassword(password);
  Logger.log('Hash for "' + password + '": ' + hash);
}

function resetCache() {
  columnMapping = null;
  Logger.log('Cache reset');
}

/**
 * Test API POST – symuluje żądanie logowania. Uruchom z menu Uruchom → testAPI, potem sprawdź logi.
 */
function testAPI() {
  const testData = {
    postData: {
      contents: JSON.stringify({
        action: 'login',
        email: 'test@example.com',
        password: 'password123'
      })
    }
  };
  const result = doPost(testData);
  Logger.log(result.getContent());
}

/**
 * DIAGNOSTYKA - uruchom tę funkcję NAJPIERW żeby sprawdzić stan projektu.
 * Pokaże: URL wdrożenia, skąd jest klucz, czy klucz działa.
 */
function diagnozaKlucza() {
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🔍 DIAGNOSTYKA PROJEKTU APPS SCRIPT');
  Logger.log('═══════════════════════════════════════════════════════════════');
  
  // 1. Sprawdź czy funkcja getOpenAIKey istnieje
  Logger.log('');
  Logger.log('1️⃣ SPRAWDZAM CZY KOD JEST AKTUALNY...');
  try {
    const testKey = getOpenAIKey();
    Logger.log('   ✅ Funkcja getOpenAIKey() istnieje - kod jest aktualny');
  } catch (e) {
    Logger.log('   ❌ PROBLEM: Funkcja getOpenAIKey() NIE ISTNIEJE!');
    Logger.log('   → Musisz skopiować CAŁY kod z pliku AppsScript-Backend-Pelny.gs');
    Logger.log('   → Wklej go tutaj w edytorze i zapisz (Ctrl+S)');
    Logger.log('   → Potem wdróż jako "Nowa wersja"');
    return;
  }
  
  // 2. Sprawdź Script Properties
  Logger.log('');
  Logger.log('2️⃣ SPRAWDZAM SCRIPT PROPERTIES...');
  try {
    const props = PropertiesService.getScriptProperties();
    const keyFromProps = props.getProperty('OPENAI_API_KEY');
    if (keyFromProps && keyFromProps.trim().length > 20) {
      Logger.log('   ✅ Klucz ZNALEZIONY w Script Properties');
      Logger.log('   📝 Pierwsze 20 znaków: ' + keyFromProps.substring(0, 20) + '...');
      Logger.log('   📏 Długość klucza: ' + keyFromProps.trim().length + ' znaków');
    } else if (keyFromProps) {
      Logger.log('   ⚠️ Klucz w Script Properties jest ZA KRÓTKI: ' + keyFromProps.length + ' znaków');
      Logger.log('   → Sprawdź czy wkleiłeś CAŁY klucz (powinien mieć ~100+ znaków)');
    } else {
      Logger.log('   ⚠️ Klucz NIE ZNALEZIONY w Script Properties');
      Logger.log('   → Idź do: Project settings (zębatka) → Script properties → Add');
      Logger.log('   → Property: OPENAI_API_KEY');
      Logger.log('   → Value: wklej swój klucz sk-proj-...');
    }
  } catch (e) {
    Logger.log('   ❌ Błąd odczytu Script Properties: ' + e.toString());
  }
  
  // 3. Sprawdź stałą w kodzie
  Logger.log('');
  Logger.log('3️⃣ SPRAWDZAM STAŁĄ OPENAI_API_KEY W KODZIE...');
  if (typeof OPENAI_API_KEY !== 'undefined') {
    if (OPENAI_API_KEY && OPENAI_API_KEY.length > 20) {
      Logger.log('   📝 Stała ma wartość: ' + OPENAI_API_KEY.substring(0, 20) + '...');
    } else {
      Logger.log('   📝 Stała jest pusta lub za krótka (OK jeśli używasz Script Properties)');
    }
  } else {
    Logger.log('   ❌ Stała OPENAI_API_KEY nie istnieje w kodzie!');
  }
  
  // 4. Sprawdź jaki klucz zostanie użyty
  Logger.log('');
  Logger.log('4️⃣ JAKI KLUCZ ZOSTANIE UŻYTY (getOpenAIKey())...');
  const finalKey = getOpenAIKey();
  if (!finalKey || finalKey.length < 20) {
    Logger.log('   ❌ BRAK KLUCZA DO UŻYCIA!');
    Logger.log('   → Ustaw klucz w Script Properties (zalecane) lub w stałej OPENAI_API_KEY');
    return;
  }
  
  const keyFromProps = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  const source = (keyFromProps && keyFromProps.trim().length > 20) ? 'Script Properties' : 'stała w kodzie';
  Logger.log('   📍 Źródło: ' + source);
  Logger.log('   📝 Klucz: ' + finalKey.substring(0, 20) + '...' + finalKey.substring(finalKey.length - 4));
  
  // 5. Testuj klucz
  Logger.log('');
  Logger.log('5️⃣ TESTUJĘ KLUCZ W OPENAI API...');
  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/models', {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + finalKey },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 200) {
      Logger.log('   ✅ KLUCZ DZIAŁA! (status 200)');
      Logger.log('');
      Logger.log('═══════════════════════════════════════════════════════════════');
      Logger.log('✅ WSZYSTKO OK - teraz wdróż jako "Nowa wersja":');
      Logger.log('   Wdroż → Zarządzaj wdrożeniami → Edytuj → Wersja: Nowa wersja → Wdróż');
      Logger.log('═══════════════════════════════════════════════════════════════');
    } else {
      Logger.log('   ❌ KLUCZ ODRZUCONY przez OpenAI! Status: ' + code);
      const errorBody = response.getContentText();
      Logger.log('   Błąd: ' + errorBody.substring(0, 200));
      Logger.log('');
      Logger.log('═══════════════════════════════════════════════════════════════');
      Logger.log('❌ KLUCZ JEST NIEPRAWIDŁOWY');
      Logger.log('   1. Idź na https://platform.openai.com/api-keys');
      Logger.log('   2. Usuń stary klucz i utwórz NOWY');
      Logger.log('   3. Skopiuj CAŁY klucz (sk-proj-...)');
      Logger.log('   4. Wklej w Script Properties → OPENAI_API_KEY');
      Logger.log('   5. Uruchom ponownie diagnozaKlucza()');
      Logger.log('═══════════════════════════════════════════════════════════════');
    }
  } catch (e) {
    Logger.log('   ❌ Błąd połączenia: ' + e.toString());
  }
}

/**
 * Test klucza OpenAI – uruchom (Uruchom → testOpenAIKey) i sprawdź logi (Wykonania).
 * Klucz bierze z Script Properties (OPENAI_API_KEY) lub ze stałej w kodzie.
 */
function testOpenAIKey() {
  const key = getOpenAIKey();
  if (!key || key.length < 20) {
    Logger.log('❌ Brak klucza. Ustaw: Project settings → Script properties → OPENAI_API_KEY = sk-proj-... (lub stałą OPENAI_API_KEY w kodzie).');
    return;
  }
  Logger.log('🔑 Testuję klucz OpenAI (źródło: ' + (PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') ? 'Script Properties' : 'stała w kodzie') + ', pierwsze 15 znaków: ' + key.substring(0, 15) + '...)');
  try {
    const response = UrlFetchApp.fetch('https://api.openai.com/v1/models', {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code === 200) {
      Logger.log('✅ Klucz OpenAI DZIAŁA (status 200). Analiza AI powinna działać.');
    } else {
      Logger.log('❌ Klucz OpenAI ODRZUCONY. Status: ' + code);
      Logger.log('   Odpowiedź: ' + response.getContentText().substring(0, 300));
      Logger.log('   → Wygeneruj nowy klucz na https://platform.openai.com/api-keys i ustaw w Script properties (OPENAI_API_KEY) w TYM projekcie.');
    }
  } catch (e) {
    Logger.log('❌ Błąd połączenia: ' + e.toString());
  }
}
