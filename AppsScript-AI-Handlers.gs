/**
 * Obsługa AI (analiza obrazu + opisu) w Google Apps Script
 * DODAJ TEN KOD do istniejącego projektu Apps Script (tego z logowaniem).
 *
 * 1. W edytorze: Projekt → Właściwości projektu → Skrypt
 *    Dodaj właściwość: OPENAI_API_KEY = twój_klucz_openai
 *
 * 2. W doGet(e) dodaj na początku (przed innymi action):
 *    if (e.parameter.action === 'analyze_image') {
 *      return handleAnalyzeImage(e.parameter);
 *    }
 *
 * 3. W doPost(e) dodaj obsługę (action bywa w URL albo w body):
 *    var params = e.parameter || {};
 *    var body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
 *    if (params.action === 'log_ai_costs') return handleLogAICosts(body);
 *    if (body.action === 'analyze_description_ai') return handleAnalyzeDescriptionAI(body);
 *
 * 4. Wdróż ponownie jako aplikację sieciową (Wdroż → Nowe wdrożenie).
 */

var OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

function getOpenAIKey() {
  return PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
}

/**
 * GET ?action=analyze_image&email=...&imageUrl=...
 * Zwraca JSON: { success, data } – ten sam format co PHP api.php
 */
function handleAnalyzeImage(params) {
  var imageUrl = params.imageUrl;
  if (!imageUrl) {
    return jsonOutput({ success: false, message: 'Brak URL obrazu' });
  }
  var apiKey = getOpenAIKey();
  if (!apiKey) {
    return jsonOutput({ success: false, message: 'Błąd konfiguracji (brak klucza OpenAI w Właściwościach projektu)' });
  }

  var systemPrompt = "Jesteś ekspertem od fotografii produktowej i standardów Allegro. Oceń miniatury produktu (główne zdjęcie). WAŻNE ZASADY:\n" +
    "- CUDZE LOGOTYPY (logos): tylko loga INNYCH firm niż marka produktu. Logo MARKI PRODUKTU na produkcie (np. CUBOT na smartfonie CUBOT, Samsung na telefonie Samsung) = DOZWOLONE – ustaw logos.detected = false i details = \"Logo marki produktu – dozwolone\".\n" +
    "- Nazwa modelu/parametry produktu na grafice (np. \"Pancerny 4,7\", \"16GB+128GB\", \"Android 15\") = DOZWOLONE (promotionalText.detected = false).\n" +
    "- NIEDOZWOLONE teksty promocyjne: \"-10%\", \"-50%\", \"PROMOCJA\", \"NOWOŚĆ\", \"BESTSELLER\", \"GRATIS\", \"TANIEJ\" (promotionalText.detected = true).\n" +
    "- Akcesoria w zestawie (słuchawki, ładowarka) = DOZWOLONE (extraElements.detected = false jeśli to część zestawu).\n" +
    "- Ręka trzymająca produkt = DOZWOLONE.";

  var userPrompt = "Oceń to zdjęcie pod kątem standardów miniatury Allegro.\n" +
    "1. Czy tło jest w większości białe?\n" +
    "2. Czy produkt zajmuje odpowiednią część kadru?\n" +
    "3. DOZWOLONE: logo marki produktu, nazwa modelu, parametry techniczne, akcesoria w zestawie.\n" +
    "4. NIEDOZWOLONE: znaki wodne, teksty promocyjne (-50%, PROMOCJA, TANIEJ), cudze loga (nie producenta).\n" +
    "5. WYMAGANE: Oceń ostrość (visualQuality.sharpness: score 0-100 i assessment) i profesjonalność tła (visualQuality.background: score 0-100 i assessment).\n\n" +
    "Zwróć odpowiedź TYLKO w formacie JSON (wszystkie pola obowiązkowe):\n" +
    "{\n" +
    "  \"overallAIScore\": 90,\n" +
    "  \"summary\": \"Krótkie podsumowanie...\",\n" +
    "  \"regulaminCompliance\": {\n" +
    "    \"watermarks\": { \"detected\": false, \"details\": \"...\" },\n" +
    "    \"promotionalText\": { \"detected\": false, \"details\": \"...\" },\n" +
    "    \"logos\": { \"detected\": false, \"details\": \"...\" },\n" +
    "    \"extraElements\": { \"detected\": false, \"details\": \"...\" },\n" +
    "    \"colorVariants\": { \"detected\": false, \"details\": \"...\" },\n" +
    "    \"inappropriateContent\": { \"detected\": false, \"details\": \"...\" }\n" +
    "  },\n" +
    "  \"visualQuality\": {\n" +
    "    \"sharpness\": { \"score\": 85, \"assessment\": \"Zdjęcie jest ostre...\" },\n" +
    "    \"background\": { \"score\": 80, \"assessment\": \"Tło białe...\" }\n" +
    "  }\n" +
    "}";

  var payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ],
    response_format: { type: 'json_object' }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(OPENAI_API_URL, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText();

  if (code !== 200) {
    return jsonOutput({ success: false, message: 'Błąd OpenAI API: ' + code });
  }

  var data = JSON.parse(text);
  var content = data.choices[0].message.content;
  var jsonContent = JSON.parse(content);
  var usage = data.usage || {};

  var result = {
    success: true,
    data: {
      overallAIScore: jsonContent.overallAIScore,
      summary: jsonContent.summary,
      regulaminCompliance: jsonContent.regulaminCompliance,
      visualQuality: jsonContent.visualQuality,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0
    }
  };
  return jsonOutput(result);
}

/**
 * POST body: { action: 'analyze_description_ai', title, parameters, description }
 * Zwraca: { success, data: { analysis, tokensUsed, inputTokens, outputTokens } }
 */
function handleAnalyzeDescriptionAI(body) {
  var description = body.description || '';
  var title = body.title || '';
  var parameters = body.parameters || [];
  if (description.length < 10) {
    return jsonOutput({ success: false, message: 'Brak opisu do analizy' });
  }
  var apiKey = getOpenAIKey();
  if (!apiKey) {
    return jsonOutput({ success: false, message: 'Błąd konfiguracji (brak klucza OpenAI)' });
  }

  var paramsText = '';
  parameters.forEach(function(p) {
    paramsText += '- ' + (p.name || '') + ': ' + (p.value || '') + '\n';
  });

  var systemPrompt = "Jesteś ekspertem e-commerce i copywriterem specjalizującym się w Allegro. Oceń jakość opisu produktu i wskaż obszary do poprawy. Bądź konkretny i zwięzły.";
  var userPrompt = "Przeanalizuj opis oferty Allegro.\n\nTytuł: " + title + "\nParametry:\n" + paramsText + "\nOpis:\n" + description + "\n\nW odpowiedzi: 1) Krótkie podsumowanie. 2) 3-4 zalety. 3) 3-4 rzeczy do poprawy. 4) Sugestia na początek opisu. Czysty tekst, punktory.";

  var payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(OPENAI_API_URL, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText();

  if (code !== 200) {
    return jsonOutput({ success: false, message: 'Błąd OpenAI: ' + code });
  }

  var data = JSON.parse(text);
  var analysis = data.choices[0].message.content;
  var usage = data.usage || {};

  return jsonOutput({
    success: true,
    data: {
      analysis: analysis,
      tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0
    }
  });
}

/**
 * POST body: { action: 'log_ai_costs', userEmail, ... }
 * Opcjonalnie: zapis do arkusza. Jeśli nie masz arkusza, zwracamy success: true.
 */
function handleLogAICosts(body) {
  // Opcjonalnie: zapisz do Google Sheet (utwórz arkusz "AI costs" z nagłówkami)
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) {
      var sheet = ss.getSheetByName('AI costs');
      if (sheet) {
        sheet.appendRow([
          new Date(),
          body.userEmail || '',
          body.tokensUsed || 0,
          body.inputTokens || 0,
          body.outputTokens || 0,
          body.functionName || '',
          body.model || 'gpt-4o-mini'
        ]);
      }
    }
  } catch (e) {}
  return jsonOutput({ success: true });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
