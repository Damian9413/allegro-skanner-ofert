/**
 * Reset hasła – obsługa action=reset_password w Google Apps Script
 *
 * DODAJ TEN KOD do istniejącego projektu Apps Script (tego z logowaniem).
 *
 * 1. W doGet(e) dodaj na początku (przed innymi action):
 *    if (e.parameter.action === 'reset_password') {
 *      return handleResetPassword(e.parameter);
 *    }
 *
 * 2. Dostosuj poniżej (jeśli potrzeba):
 *    - getBazaSheet() – zwraca arkusz z użytkownikami (zakładka "Baza")
 *    - indeks kolumny hasła (domyślnie 2, czyli kolumna B)
 *
 * 3. Hasło jest hashowane tak samo jak przy rejestracji (SHA-256, hex).
 *
 * 4. Wdróż ponownie (Wdroż → Zarządzaj wdrożeniami → Edytuj → Wdróż).
 */

/**
 * Zwraca arkusz "Baza" z głównego skoroszytu.
 * Jeśli Twój skrypt używa innego skoroszytu, zamień getActiveSpreadsheet() na:
 * SpreadsheetApp.openById('ID_SKOROSZYTU')
 */
function getBazaSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Baza');
  if (!sheet) {
    throw new Error('Nie znaleziono zakładki "Baza"');
  }
  return sheet;
}

/**
 * Haszuje hasło SHA-256 (hex) – tak samo jak w rejestracji i w wtyczce (generatePasswordHash).
 */
function hashPassword(password) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  var hashHex = digest.map(function(byte) {
    var b = byte < 0 ? byte + 256 : byte;
    return ('0' + b.toString(16)).slice(-2);
  }).join('');
  return hashHex;
}

/**
 * GET ?action=reset_password&email=...&new_password=...
 * Aktualizuje password_hash dla użytkownika o podanym emailu.
 * Zwraca JSON: { success: true, message: "..." } lub { success: false, message: "..." }
 */
function handleResetPassword(params) {
  var email = (params && params.email) ? String(params.email).trim().toLowerCase() : '';
  var newPassword = params && params.new_password ? String(params.new_password) : '';

  if (!email) {
    return jsonOutput({ success: false, message: 'Podaj adres email.' });
  }
  if (!newPassword || newPassword.length < 6) {
    return jsonOutput({ success: false, message: 'Nowe hasło musi mieć co najmniej 6 znaków.' });
  }

  try {
    var sheet = getBazaSheet();
    var data = sheet.getDataRange().getValues();
    // Nagłówek w pierwszym wierszu; zakładamy kolumnę email = 1 (A), password_hash = 2 (B)
    var colEmail = 0;   // A
    var colPassword = 1; // B
    var header = data[0] || [];
    // Opcjonalnie: wykryj indeksy kolumn po nazwach
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i]).toLowerCase();
      if (h === 'email') colEmail = i;
      if (h === 'password_hash' || h === 'password hash') colPassword = i;
    }

    var rowIndex = -1;
    for (var r = 1; r < data.length; r++) {
      var rowEmail = String((data[r][colEmail] || '')).trim().toLowerCase();
      if (rowEmail === email) {
        rowIndex = r;
        break;
      }
    }

    if (rowIndex === -1) {
      return jsonOutput({ success: false, message: 'Nie znaleziono konta o podanym adresie email.' });
    }

    var newHash = hashPassword(newPassword);
    sheet.getRange(rowIndex + 1, colPassword + 1).setValue(newHash);

    return jsonOutput({
      success: true,
      message: 'Hasło zostało zmienione. Zaloguj się nowym hasłem.'
    });
  } catch (err) {
    return jsonOutput({
      success: false,
      message: err.message || 'Błąd podczas resetowania hasła.'
    });
  }
}

/**
 * Zwraca ContentService z JSON (użyj tej samej funkcji co w reszcie projektu).
 * Jeśli masz już jsonOutput gdzie indziej, możesz usunąć tę i użyć swojej.
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============= OPCJA 4: Tylko admin (menu w arkuszu) =============
/**
 * Menu w Google Sheets – tylko osoba z dostępem do arkuszu (admin) może zresetować hasło.
 *
 * 1. Przy pierwszym otwarciu arkuszu pojawi się menu "Skan ofert" → "Reset hasła użytkownika".
 * 2. Jeśli masz już funkcję onOpen() w projekcie, dodaj w niej wywołanie: addResetPasswordMenu();
 *    (wtedy nie dodawaj poniższej funkcji onOpen, żeby się nie dublowała).
 */

function onOpen() {
  addResetPasswordMenu();
}

function addResetPasswordMenu() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Skan ofert')
    .addItem('Reset hasła użytkownika', 'menuResetHasla')
    .addToUi();
}

/**
 * Wywoływane z menu. Pyta o email i nowe hasło, aktualizuje password_hash w Baza.
 * Dostęp ma tylko ktoś, kto może edytować ten arkusz (admin).
 */
function menuResetHasla() {
  var ui = SpreadsheetApp.getUi();

  var email = ui.prompt('Reset hasła', 'Podaj adres email użytkownika:', ui.ButtonSet.OK_CANCEL);
  if (email.getSelectedButton() !== ui.Button.OK) return;
  email = (email.getResponseText() || '').trim();
  if (!email) {
    ui.alert('Błąd', 'Nie podano adresu email.', ui.ButtonSet.OK);
    return;
  }

  var newPassword = ui.prompt('Reset hasła', 'Podaj nowe hasło (min. 6 znaków):', ui.ButtonSet.OK_CANCEL);
  if (newPassword.getSelectedButton() !== ui.Button.OK) return;
  newPassword = newPassword.getResponseText() || '';
  if (newPassword.length < 6) {
    ui.alert('Błąd', 'Hasło musi mieć co najmniej 6 znaków.', ui.ButtonSet.OK);
    return;
  }

  try {
    var sheet = getBazaSheet();
    var data = sheet.getDataRange().getValues();
    var colEmail = 0;
    var colPassword = 1;
    var header = data[0] || [];
    for (var i = 0; i < header.length; i++) {
      var h = String(header[i]).toLowerCase();
      if (h === 'email') colEmail = i;
      if (h === 'password_hash' || h === 'password hash') colPassword = i;
    }

    var rowIndex = -1;
    for (var r = 1; r < data.length; r++) {
      var rowEmail = String((data[r][colEmail] || '')).trim().toLowerCase();
      if (rowEmail === email.toLowerCase()) {
        rowIndex = r;
        break;
      }
    }

    if (rowIndex === -1) {
      ui.alert('Błąd', 'Nie znaleziono konta o podanym adresie email.', ui.ButtonSet.OK);
      return;
    }

    var newHash = hashPassword(newPassword);
    sheet.getRange(rowIndex + 1, colPassword + 1).setValue(newHash);
    ui.alert('Sukces', 'Hasło dla ' + email + ' zostało zmienione. Użytkownik może się zalogować nowym hasłem.', ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Błąd', err.message || 'Nie udało się zresetować hasła.', ui.ButtonSet.OK);
  }
}
