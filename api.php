<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json; charset=UTF-8");
// Obsługa pre-flight request (CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}
// Konfiguracja bazy danych
$host = 'localhost';
$db_name = 'u70595_skaner_ofert';
$username = 'u70595_skaner_ofert';
$password = 'EEftywvZCk5BgHMU2bGC';
try {
    $conn = new PDO("mysql:host=$host;dbname=$db_name;charset=utf8mb4", $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    echo json_encode(["success" => false, "message" => "Błąd połączenia z bazą danych: " . $e->getMessage()]);
    exit();
}
// Pobranie danych wejściowych (obsługa JSON i POST)
$input = json_decode(file_get_contents("php://input"), true);
$action = $_GET['action'] ?? $input['action'] ?? '';
// Główny switch akcji
switch ($action) {
    case 'login':
        handleLogin($conn);
        break;
    case 'register':
        handleRegister($conn);
        break;
    case 'check_limit':
        handleCheckLimit($conn);
        break;
    case 'use_report':
        handleUseReport($conn);
        break;
    case 'analyze_description_ai':
        handleAnalyzeDescriptionAI($conn);
        break;
    case 'analyze_image':
        handleAnalyzeImage($conn);
        break;
    case 'log_ai_costs':
        handleLogAICosts($conn);
        break;
    case 'submit_feedback':
        handleSubmitFeedback($conn);
        break;
    default:
        echo json_encode(["success" => false, "message" => "Nieznana akcja: $action"]);
        break;
}
// ==========================================
// FUNKCJE OBSŁUGI AKCJI
// ==========================================
function handleLogin($conn)
{
    $email = $_GET['email'] ?? $_POST['email'] ?? '';
    $password = $_GET['password'] ?? $_POST['password'] ?? '';
    if (empty($email) || empty($password)) {
        echo json_encode(["success" => false, "message" => "Podaj email i hasło"]);
        return;
    }
    $stmt = $conn->prepare("SELECT id, password_hash, reports_limit, reports_used FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($user && password_verify($password, $user['password_hash'])) {
        // Aktualizacja ostatniego logowania
        $update = $conn->prepare("UPDATE users SET last_login = NOW() WHERE id = ?");
        $update->execute([$user['id']]);
        echo json_encode([
            "success" => true,
            "email" => $email,
            "reportsLimit" => $user['reports_limit'],
            "reportsUsed" => $user['reports_used']
        ]);
    } else {
        echo json_encode(["success" => false, "message" => "Błędny email lub hasło"]);
    }
}
function handleRegister($conn)
{
    $email = $_GET['email'] ?? $_POST['email'] ?? '';
    $password = $_GET['password'] ?? $_POST['password'] ?? '';
    if (empty($email) || empty($password)) {
        echo json_encode(["success" => false, "message" => "Podaj email i hasło"]);
        return;
    }
    // Sprawdź czy użytkownik istnieje
    $stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        echo json_encode(["success" => false, "message" => "Użytkownik o takim emailu już istnieje"]);
        return;
    }
    $passwordHash = password_hash($password, PASSWORD_BCRYPT);
    $defaultLimit = 10;
    $stmt = $conn->prepare("INSERT INTO users (email, password_hash, reports_limit) VALUES (?, ?, ?)");
    if ($stmt->execute([$email, $passwordHash, $defaultLimit])) {
        echo json_encode(["success" => true, "message" => "Rejestracja udana"]);
    } else {
        echo json_encode(["success" => false, "message" => "Błąd rejestracji"]);
    }
}
function handleCheckLimit($conn)
{
    $email = $_GET['email'] ?? '';

    if (empty($email)) {
        echo json_encode(["success" => false, "message" => "Brak emaila"]);
        return;
    }
    $stmt = $conn->prepare("SELECT reports_limit, reports_used FROM users WHERE email = ?");
    $stmt->execute([$email]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($user) {
        $remaining = $user['reports_limit'] - $user['reports_used'];
        echo json_encode([
            "success" => true,
            "limit" => $user['reports_limit'],
            "used" => $user['reports_used'],
            "remaining" => max(0, $remaining),
            "hasLimit" => $remaining > 0
        ]);
    } else {
        echo json_encode(["success" => false, "message" => "Użytkownik nie znaleziony"]);
    }
}
function handleUseReport($conn)
{
    $email = $_GET['email'] ?? '';
    if (empty($email)) {
        echo json_encode(["success" => false, "message" => "Brak emaila"]);
        return;
    }
    $stmt = $conn->prepare("UPDATE users SET reports_used = reports_used + 1 WHERE email = ? AND reports_used < reports_limit");
    $stmt->execute([$email]);
    if ($stmt->rowCount() > 0) {
        echo json_encode(["success" => true, "message" => "Wykorzystano raport"]);
    } else {
        echo json_encode(["success" => false, "message" => "Brak dostępnych raportów lub błąd użytkownika"]);
    }
}
function handleAnalyzeDescriptionAI($conn)
{
    $input = json_decode(file_get_contents("php://input"), true);
    $description = $input['description'] ?? '';
    $title = $input['title'] ?? '';
    $parameters = $input['parameters'] ?? [];
    if (empty($description)) {
        echo json_encode(["success" => false, "message" => "Brak opisu do analizy"]);
        return;
    }
    // Pobierz klucz API
    $apiKey = getOpenAIKey($conn);
    if (!$apiKey) {
        echo json_encode(["success" => false, "message" => "Błąd konfiguracji serwera (brak klucza API)"]);
        return;
    }
    // Przygotuj prompt
    $paramsText = "";
    foreach ($parameters as $p) {
        $paramsText .= "- " . $p['name'] . ": " . $p['value'] . "\n";
    }
    $systemPrompt = "Jesteś ekspertem e-commerce i copywriterem specjalizującym się w Allegro. Twoim zadaniem jest ocena jakości opisu produktu i wskazanie obszarów do poprawy. Bądź konkretny, zwięzły i pomocny.";
    $userPrompt = "Przeanalizuj poniższy opis oferty Allegro pod kątem jakości sprzedażowej, SEO i czytelności.\n\n" .
        "Tytuł oferty: $title\n" .
        "Parametry produktu:\n$paramsText\n" .
        "Opis oferty:\n$description\n\n" .
        "W odpowiedzi zawrzyj:\n" .
        "1. Krótkie podsumowanie jakości opisu (1-2 zdania).\n" .
        "2. 3-4 główne zalety opisu.\n" .
        "3. 3-4 konkretne rzeczy do poprawy (np. brakujące słowa kluczowe, formatowanie, język korzyści).\n" .
        "4. Sugestię jak ulepszyć początek opisu (pierwsze 2 zdania).\n" .
        "Nie używaj markdown w odpowiedzi, sformatuj to jako czysty tekst z punktorami.";
    // Wywołanie OpenAI API
    $response = callOpenAI($apiKey, $systemPrompt, $userPrompt, "gpt-4o-mini");
    if ($response['success']) {
        echo json_encode([
            "success" => true,
            "data" => [
                "analysis" => $response['content'],
                "tokensUsed" => $response['usage']['total_tokens'],
                "inputTokens" => $response['usage']['prompt_tokens'],
                "outputTokens" => $response['usage']['completion_tokens']
            ]
        ]);
    } else {
        echo json_encode(["success" => false, "message" => "Błąd OpenAI: " . $response['error']]);
    }
}
function handleAnalyzeImage($conn)
{
    $email = $_GET['email'] ?? '';
    $imageUrl = $_GET['imageUrl'] ?? '';
    if (empty($imageUrl)) {
        echo json_encode(["success" => false, "message" => "Brak URL obrazu"]);
        return;
    }
    $apiKey = getOpenAIKey($conn);
    if (!$apiKey) {
        echo json_encode(["success" => false, "message" => "Błąd konfiguracji serwera (brak klucza API)"]);
        return;
    }
    $systemPrompt = "Jesteś ekspertem od fotografii produktowej i standardów Allegro. Oceń miniatury produktu (główne zdjęcie). WAŻNE ZASADY:\n" .
        "- CUDZE LOGOTYPY (logos): tylko loga INNYCH firm niż marka produktu. Logo MARKI PRODUKTU na produkcie (np. CUBOT na smartfonie CUBOT, Samsung na telefonie Samsung) = DOZWOLONE – ustaw logos.detected = false i details = \"Logo marki produktu – dozwolone\".\n" .
        "- Nazwa modelu/parametry produktu na grafice (np. \"Pancerny 4,7\", \"16GB+128GB\", \"Android 15\") = DOZWOLONE (promotionalText.detected = false).\n" .
        "- NIEDOZWOLONE teksty promocyjne: \"-10%\", \"-50%\", \"PROMOCJA\", \"NOWOŚĆ\", \"BESTSELLER\", \"GRATIS\", \"TANIEJ\" (promotionalText.detected = true).\n" .
        "- Akcesoria w zestawie (słuchawki, ładowarka) = DOZWOLONE (extraElements.detected = false jeśli to część zestawu).\n" .
        "- Ręka trzymająca produkt = DOZWOLONE.";
    $userPrompt = "Oceń to zdjęcie pod kątem standardów miniatury Allegro:\n" .
        "1. Czy tło jest w większości białe?\n" .
        "2. Czy produkt zajmuje odpowiednią część kadru?\n" .
        "3. DOZWOLONE: logo marki produktu, nazwa modelu, parametry techniczne (RAM/ROM/przekątna), akcesoria w zestawie.\n" .
        "4. NIEDOZWOLONE: znaki wodne, teksty promocyjne (-50%, PROMOCJA, TANIEJ, NOWOŚĆ), cudze loga (nie producenta).\n" .
        "5. WYMAGANE: Oceń ostrość zdjęcia (visualQuality.sharpness: score 0-100 i assessment) oraz profesjonalność tła (visualQuality.background: score 0-100 i assessment). Zawsze wypełnij te pola.\n\n" .
        "Zwróć odpowiedź TYLKO w formacie JSON (wszystkie pola obowiązkowe, w tym visualQuality.sharpness i visualQuality.background):\n" .
        "{\n" .
        "  \"overallAIScore\": 90,\n" .
        "  \"summary\": \"Krótkie podsumowanie...\",\n" .
        "  \"regulaminCompliance\": {\n" .
        "    \"watermarks\": { \"detected\": false, \"details\": \"...\" },\n" .
        "    \"promotionalText\": { \"detected\": false, \"details\": \"...\" },\n" .
        "    \"logos\": { \"detected\": false, \"details\": \"...\" },\n" .
        "    \"extraElements\": { \"detected\": false, \"details\": \"...\" },\n" .
        "    \"colorVariants\": { \"detected\": false, \"details\": \"...\" },\n" .
        "    \"inappropriateContent\": { \"detected\": false, \"details\": \"...\" }\n" .
        "  },\n" .
        "  \"visualQuality\": {\n" .
        "    \"sharpness\": { \"score\": 85, \"assessment\": \"Zdjęcie jest ostre...\" },\n" .
        "    \"background\": { \"score\": 80, \"assessment\": \"Tło białe...\" }\n" .
        "  }\n" .
        "}";
    $payload = [
        "model" => "gpt-4o-mini",
        "messages" => [
            ["role" => "system", "content" => $systemPrompt],
            [
                "role" => "user",
                "content" => [
                    ["type" => "text", "text" => $userPrompt],
                    ["type" => "image_url", "image_url" => ["url" => $imageUrl]]
                ]
            ]
        ],
        "response_format" => ["type" => "json_object"]
    ];
    $ch = curl_init("https://api.openai.com/v1/chat/completions");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json",
        "Authorization: Bearer " . $apiKey
    ]);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode === 200) {
        $data = json_decode($result, true);
        $content = $data['choices'][0]['message']['content'];
        $jsonContent = json_decode($content, true);

        echo json_encode([
            "success" => true,
            "data" => array_merge($jsonContent, [
                "inputTokens" => $data['usage']['prompt_tokens'],
                "outputTokens" => $data['usage']['completion_tokens']
            ])
        ]);
    } else {
        echo json_encode(["success" => false, "message" => "Błąd OpenAI API: $httpCode"]);
    }
}
function handleLogAICosts($conn)
{
    $input = json_decode(file_get_contents("php://input"), true);

    $stmt = $conn->prepare("INSERT INTO ai_costs_log (user_email, tokens_used, input_tokens, output_tokens, cost_usd, cost_pln, function_name, model, offer_url, offer_name, additional_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $success = $stmt->execute([
        $input['userEmail'] ?? 'unknown',
        $input['tokensUsed'] ?? 0,
        $input['inputTokens'] ?? 0,
        $input['outputTokens'] ?? 0,
        $input['costUSD'] ?? 0,
        $input['costPLN'] ?? 0,
        $input['functionName'] ?? 'unknown',
        $input['model'] ?? 'gpt-4o-mini',
        $input['offerUrl'] ?? null,
        $input['offerName'] ?? null,
        json_encode($input['additionalData'] ?? [])
    ]);
    echo json_encode(["success" => $success]);
}
function handleSubmitFeedback($conn)
{
    $input = json_decode(file_get_contents("php://input"), true);

    $stmt = $conn->prepare("INSERT INTO feedback (user_email, rating, comment, offer_url) VALUES (?, ?, ?, ?)");
    $success = $stmt->execute([
        $input['userEmail'] ?? 'unknown',
        $input['rating'] ?? 0,
        $input['comment'] ?? '',
        $input['offerUrl'] ?? ''
    ]);
    echo json_encode(["success" => $success]);
}
// ==========================================
// FUNKCJE POMOCNICZE
// ==========================================
function getOpenAIKey($conn)
{
    $stmt = $conn->prepare("SELECT api_key FROM api_keys WHERE service_name = 'openai' AND is_active = 1 LIMIT 1");
    $stmt->execute();
    $result = $stmt->fetch(PDO::FETCH_ASSOC);
    return $result ? $result['api_key'] : null;
}
function callOpenAI($apiKey, $systemPrompt, $userPrompt, $model = "gpt-4o-mini")
{
    $url = "https://api.openai.com/v1/chat/completions";

    $data = [
        "model" => $model,
        "messages" => [
            ["role" => "system", "content" => $systemPrompt],
            ["role" => "user", "content" => $userPrompt]
        ]
    ];
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "Content-Type: application/json",
        "Authorization: Bearer " . $apiKey
    ]);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($httpCode === 200) {
        $response = json_decode($result, true);
        return [
            "success" => true,
            "content" => $response['choices'][0]['message']['content'],
            "usage" => $response['usage']
        ];
    } else {
        return [
            "success" => false,
            "error" => "HTTP $httpCode: $result"
        ];
    }
}
?>