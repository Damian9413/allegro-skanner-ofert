(function () {
	'use strict';

	// ============= KALKULATOR KOSZTÓW OPENAI - POCZĄTEK =============

	/**
	 * Kalkulator kosztów dla API OpenAI
	 * Obsługuje GPT-4o-mini z przeliczaniem USD -> PLN
	 */
	class OpenAICostCalculator {
		constructor(
			usdToPln = 4.0,
			inputCostPerToken = 0.00015 / 1000,  // $0.150 za 1M tokenów
			outputCostPerToken = 0.0006 / 1000    // $0.600 za 1M tokenów
		) {
			this.usdToPln = usdToPln;
			this.inputCost = inputCostPerToken;
			this.outputCost = outputCostPerToken;
		}

		/**
		 * Oblicza koszty na podstawie liczby tokenów
		 */
		calculateCost(inputTokens, outputTokens) {
			const totalTokens = inputTokens + outputTokens;
			const costUsd = (inputTokens * this.inputCost) + (outputTokens * this.outputCost);
			const costPln = costUsd * this.usdToPln;

			return {
				inputTokens,
				outputTokens,
				totalTokens,
				costUsd,
				costPln,
				toString: function () {
					return `Tokens: ${this.totalTokens.toLocaleString()} (in: ${this.inputTokens.toLocaleString()}, out: ${this.outputTokens.toLocaleString()}) | Cost: $${this.costUsd.toFixed(6)} USD (${this.costPln.toFixed(4)} PLN)`;
				}
			};
		}

		/**
		 * Tworzy obiekt logu kosztów gotowy do wysłania do arkusza
		 */
		createCostLog(userEmail, inputTokens, outputTokens, functionName, additionalData = {}) {
			const usage = this.calculateCost(inputTokens, outputTokens);
			const now = new Date();

			return {
				userEmail: userEmail,
				dateTime: now.toISOString().slice(0, 19).replace('T', ' '), // Format: YYYY-MM-DD HH:MM:SS
				tokensUsed: usage.totalTokens,
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				costUSD: usage.costUsd,
				costPLN: usage.costPln,
				functionName: functionName,
				model: 'gpt-4o-mini',
				...additionalData
			};
		}
	}

	// Globalna instancja kalkulatora
	const costCalculator = new OpenAICostCalculator();

	// ============= KALKULATOR KOSZTÓW OPENAI - KONIEC =============

	// ============= SYSTEM AUTORYZACJI - POCZĄTEK =============
	// Pełny URL do Apps Script (w działającej wersji był pełny URL; sam ID powodował "Błąd połączenia z serwerem")
	const API_URL = 'https://script.google.com/macros/s/AKfycbxFNv3LjfXFCtV4Wdc9xLZO1a4KX8zSdoWP4NxJkFZQR4zdePaw3l03gLSnAag39QW5Bg/exec';
	// AI (obraz + opis) – po przeniesieniu do Apps Script używamy tego samego API_URL (zob. SERWER_I_OPCJE.md)
	const AI_API_URL = API_URL;

	/**
	 * Wywołanie API przez background (service worker) – omija CORS przy żądaniach z allegro.pl do script.google.com.
	 * Zwraca obiekt Response-like: { ok, status, statusText, json(), text() }.
	 */
	async function extensionFetch(url, options = {}) {
		const fallback = { success: false, message: 'Błąd połączenia z serwerem' };
		try {
			const res = await chrome.runtime.sendMessage({ type: 'apiFetch', url, options });
			if (!res) throw new Error('Brak odpowiedzi z background');
			return {
				ok: res.ok,
				status: res.status,
				statusText: res.statusText,
				text: () => Promise.resolve(res.body || ''),
				json: () => {
					if (!res.body || !res.body.trim()) return Promise.resolve(fallback);
					try {
						return Promise.resolve(JSON.parse(res.body));
					} catch (_) {
						return Promise.resolve(fallback);
					}
				}
			};
		} catch (e) {
			return {
				ok: false,
				status: 0,
				statusText: e.message || 'Failed to fetch',
				text: () => Promise.resolve(''),
				json: () => Promise.resolve(fallback)
			};
		}
	}

	class AuthManager {
		constructor() {
			this.user = null;
			this.API_URL = API_URL; // Udostępnij API_URL jako właściwość instancji
			this.checkLoginStatus();
		}

		checkLoginStatus() {
			const userData = localStorage.getItem('allegro_scan_user');
			if (userData) {
				try {
					this.user = JSON.parse(userData);
					console.log('✅ Użytkownik zalogowany:', this.user.email);
				} catch (e) {
					console.error('❌ Błąd parsowania danych użytkownika');
					this.logout();
				}
			}
		}

		isLoggedIn() {
			return this.user !== null;
		}

		getUserEmail() {
			return this.user ? this.user.email : null;
		}

		getRemainingReports() {
			return this.user ? this.user.reportsRemaining : 0;
		}

		logout() {
			this.user = null;
			localStorage.removeItem('allegro_scan_user');
			console.log('🔓 Użytkownik wylogowany');
		}

		async login(email, password) {
			try {
				const url = `${API_URL}?action=login&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
				const response = await extensionFetch(url, { method: 'GET' });

				const result = await response.json();

				if (result.success) {
					this.user = result.data;
					localStorage.setItem('allegro_scan_user', JSON.stringify(result.data));
					console.log('✅ Login successful:', result.data);
					return { success: true, data: result.data };
				} else {
					console.error('❌ Login failed:', result.message);
					return { success: false, message: result.message };
				}
			} catch (error) {
				console.error('❌ Login error:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		async register(email, password) {
			try {
				const url = `${API_URL}?action=register&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
				const response = await extensionFetch(url, { method: 'GET' });

				const result = await response.json();

				if (result.success) {
					// Po pomyślnej rejestracji, zaloguj automatycznie
					this.user = result.data;
					localStorage.setItem('allegro_scan_user', JSON.stringify(result.data));
					console.log('✅ Registration successful:', result.data);
					return { success: true, data: result.data, message: result.message };
				} else {
					console.error('❌ Registration failed:', result.message);
					return { success: false, message: result.message };
				}
			} catch (error) {
				console.error('❌ Registration error:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		/**
		 * Reset hasła – ustawia nowe hasło dla konta o podanym emailu (wymaga obsługi action=reset_password w Apps Script).
		 */
		async resetPassword(email, newPassword) {
			try {
				const url = `${API_URL}?action=reset_password&email=${encodeURIComponent(email)}&new_password=${encodeURIComponent(newPassword)}`;
				const response = await extensionFetch(url, { method: 'GET' });
				const result = await response.json();
				if (result.success) {
					return { success: true, message: result.message || 'Hasło zostało zmienione. Zaloguj się nowym hasłem.' };
				}
				return { success: false, message: result.message || 'Nie udało się zresetować hasła.' };
			} catch (error) {
				console.error('❌ Reset password error:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		async checkLimit() {
			if (!this.isLoggedIn()) {
				return { success: false, message: 'Nie jesteś zalogowany' };
			}

			try {
				const url = `${API_URL}?action=check_limit&email=${encodeURIComponent(this.user.email)}`;
				const response = await extensionFetch(url, { method: 'GET' });
				const result = await response.json();
				if (!result || typeof result.success === 'undefined') {
					return { success: false, message: 'Błąd połączenia z serwerem (sprawdź URL wdrożenia Apps Script)' };
				}
				if (result.success) {
					this.user.reportsRemaining = result.data.reportsRemaining;
					this.user.reportsUsed = result.data.reportsUsed;
					localStorage.setItem('allegro_scan_user', JSON.stringify(this.user));
				}
				return result;
			} catch (error) {
				console.error('❌ Check limit error:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		async useReport() {
			if (!this.isLoggedIn()) {
				return { success: false, message: 'Nie jesteś zalogowany' };
			}

			if (this.getRemainingReports() <= 0) {
				return { success: false, message: 'Brak dostępnych raportów' };
			}

			try {
				const url = `${API_URL}?action=use_report&email=${encodeURIComponent(this.user.email)}`;
				const response = await extensionFetch(url, { method: 'GET' });
				const result = await response.json();
				if (!result || typeof result.success === 'undefined') {
					return { success: false, message: 'Błąd połączenia z serwerem (sprawdź URL wdrożenia Apps Script)' };
				}
				if (result.success) {
					this.user.reportsUsed = result.data.reportsUsed;
					this.user.reportsRemaining = result.data.reportsRemaining;
					localStorage.setItem('allegro_scan_user', JSON.stringify(this.user));
					console.log('✅ Report used. Remaining:', result.data.reportsRemaining);
				}
				return result;
			} catch (error) {
				console.error('❌ Use report error:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		/**
		 * Loguje koszty wykorzystania OpenAI do arkusza Google Sheets
		 */
		async logAICosts(costLog) {
			if (!this.isLoggedIn()) {
				console.warn('⚠️ Nie można zalogować kosztów - użytkownik niezalogowany');
				return { success: false, message: 'Nie jesteś zalogowany' };
			}

			try {
				const url = `${AI_API_URL}?action=log_ai_costs`;
				const response = await extensionFetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify(costLog)
				});

				if (!response.ok) {
					const errorText = await response.text().catch(() => 'Brak szczegółów błędu');
					console.error(`❌ Błąd HTTP ${response.status} przy logowaniu kosztów:`, errorText);
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const result = await response.json();

				if (result.success) {
					console.log(`💰 Koszty AI zalogowane: $${costLog.costUSD.toFixed(6)} (${costLog.costPLN.toFixed(4)} PLN) | ${costLog.tokensUsed} tokenów`);
				} else {
					console.error('❌ Błąd logowania kosztów:', result.message);
				}

				return result;
			} catch (error) {
				console.error('❌ Błąd przy logowaniu kosztów AI:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}

		/**
		 * Wysyła feedback użytkownika do arkusza Google Sheets
		 * @param {string} feedbackText - Tekst feedbacku (opcjonalny jeśli są oceny)
		 * @param {object} ratings - Obiekt z ocenami gwiazdkowymi {kategoria: ocena}
		 * @param {string} offerUrl - URL oferty
		 * @param {string} offerName - Nazwa oferty
		 */
		async sendFeedback(feedbackText, ratings = {}, offerUrl = '', offerName = '') {
			if (!this.isLoggedIn()) {
				console.warn('⚠️ Nie można wysłać feedbacku - użytkownik niezalogowany');
				return { success: false, message: 'Musisz być zalogowany, aby wysłać feedback' };
			}

			const hasFeedback = feedbackText && feedbackText.trim().length > 0;
			const hasRatings = ratings && Object.keys(ratings).length > 0;

			if (!hasFeedback && !hasRatings) {
				return { success: false, message: 'Musisz dodać feedback tekstowy lub oceny gwiazdkowe' };
			}

			try {
				const url = `${API_URL}?action=submit_feedback`;
				const feedbackData = {
					userEmail: this.getUserEmail(),
					feedback: hasFeedback ? feedbackText.trim() : '',
					ratings: ratings,
					offerUrl: offerUrl,
					offerName: offerName
				};

				console.log('📝 Wysyłam feedback...', {
					hasText: hasFeedback,
					ratingsCount: Object.keys(ratings).length
				});

				const response = await extensionFetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'text/plain;charset=utf-8'
					},
					body: JSON.stringify(feedbackData)
				});

				if (!response.ok) {
					const errorText = await response.text().catch(() => 'Brak szczegółów błędu');
					console.error(`❌ Błąd HTTP ${response.status} przy wysyłaniu feedbacku:`, errorText);
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const result = await response.json();

				if (result.success) {
					console.log('✅ Feedback wysłany pomyślnie!');
				} else {
					console.error('❌ Błąd wysyłania feedbacku:', result.message);
				}

				return result;
			} catch (error) {
				console.error('❌ Błąd przy wysyłaniu feedbacku:', error);
				return { success: false, message: 'Błąd połączenia z serwerem' };
			}
		}
	}

	const authManager = new AuthManager();

	// ============= ANALIZA JAKOŚCI OBRAZÓW - POCZĄTEK =============
	class ImageQualityAnalyzer {
		constructor() {
			this.canvas = document.createElement('canvas');
			this.ctx = this.canvas.getContext('2d');
			this.tesseractWorker = null;
		}

		/**
		 * Konwertuje URL miniatury Allegro na wersję w pełnej rozdzielczości
		 * @param {string} imageUrl - URL obrazu
		 * @returns {string} URL do oryginalnego obrazu w pełnej rozdzielczości
		 */
		getOriginalImageUrl(imageUrl) {
			if (!imageUrl) return imageUrl;

			// Zamień /s128/, /s256/, /s512/, /s1024/, /s800/ itp. na /original/
			const originalUrl = imageUrl.replace(/\/s\d+\//g, '/original/');

			if (originalUrl !== imageUrl) {
				console.log('🔄 Konwersja URL na oryginalny rozmiar:');
				console.log('   Przed:', imageUrl);
				console.log('   Po:', originalUrl);
			}

			return originalUrl;
		}

		/**
		 * Ładuje obraz z URL i zwraca jako Promise
		 * @param {string} imageUrl - URL obrazu do załadowania
		 * @returns {Promise<HTMLImageElement>}
		 */
		loadImage(imageUrl) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				img.crossOrigin = 'anonymous';

				img.onload = () => {
					resolve(img);
				};

				img.onerror = () => {
					reject(new Error(`Nie udało się załadować obrazu: ${imageUrl}`));
				};

				img.src = imageUrl;
			});
		}

		/**
		 * Główna metoda analizująca jakość obrazu
		 * @param {string} imageUrl - URL obrazu do analizy
		 * @param {HTMLImageElement} imageElement - Element obrazu
		 * @param {boolean} isThumbnail - Czy to miniatura produktu
		 * @returns {Promise<Object>} Wyniki analizy
		 */
		async analyzeImage(imageUrl, imageElement, isThumbnail = true) {
			console.log('🔍 Rozpoczynam analizę obrazu:', imageUrl);

			if (!imageUrl || !imageElement) {
				console.warn('⚠️ Brak URL lub elementu obrazu – pomijam analizę');
				return {
					resolution: { status: 'unknown', score: 0, width: 0, height: 0, message: 'Brak danych' },
					whiteBorders: { detected: false, topPercent: 0, bottomPercent: 0, leftPercent: 0, rightPercent: 0, totalPercent: 0, status: 'unknown' },
					dpi: { estimated: 0, quality: 'unknown', message: 'Brak danych' },
					backgroundWhiteness: 0,
					complexity: { score: 0, uniqueColors: 0, status: 'unknown', message: 'Brak danych' },
					textDetected: { hasText: false, confidence: 0, text: '', status: 'unknown', message: 'Brak danych' },
					excessiveSize: { isExcessive: false, megapixels: 0, message: '' },
					overallScore: 0,
					errors: ['Brak elementu lub URL obrazu']
				};
			}

			// Konwertuj URL na oryginalny rozmiar dla lepszej analizy
			const originalImageUrl = this.getOriginalImageUrl(imageUrl);

			// Załaduj oryginalny obraz aby uzyskać prawdziwe wymiary
			let originalImage = imageElement;
			if (originalImageUrl !== imageUrl) {
				try {
					originalImage = await this.loadImage(originalImageUrl);
					console.log('✅ Załadowano oryginalny obraz:', originalImage.naturalWidth, 'x', originalImage.naturalHeight);
				} catch (error) {
					console.warn('⚠️ Nie udało się załadować oryginalnego obrazu, używam elementu z DOM:', error.message);
					originalImage = imageElement;
				}
			}

			const results = {
				resolution: this.checkResolution(originalImage),
				whiteBorders: { detected: false, topPercent: 0, bottomPercent: 0, leftPercent: 0, rightPercent: 0, status: 'pending' },
				dpi: this.measureDPI(originalImage),
				backgroundWhiteness: 0,
				complexity: { score: 0, status: 'pending' },
				textDetected: { hasText: false, confidence: 0, text: '', status: 'pending' },
				excessiveSize: this.checkExcessiveSize(originalImage),
				overallScore: 0,
				errors: []
			};

			try {
				// Analiza białych ramek - używamy oryginalnego URL
				results.whiteBorders = await this.detectWhiteBorders(originalImageUrl, isThumbnail);
			} catch (error) {
				console.error('❌ Błąd podczas detekcji białych ramek:', error);
				results.errors.push('Nie udało się wykryć białych ramek');
				results.whiteBorders.status = 'error';
			}

			try {
				// Analiza białego tła - używamy oryginalnego URL
				results.backgroundWhiteness = await this.analyzeBackground(originalImageUrl);
			} catch (error) {
				console.error('❌ Błąd podczas analizy tła:', error);
				results.errors.push('Nie udało się przeanalizować białego tła');
			}

			try {
				// Ocena złożoności (tylko dla miniatur) - używamy oryginalnego URL
				if (isThumbnail) {
					results.complexity = await this.assessComplexity(originalImageUrl);
				}
			} catch (error) {
				console.error('❌ Błąd podczas oceny złożoności:', error);
				results.errors.push('Nie udało się ocenić złożoności');
				results.complexity.status = 'error';
			}

			try {
				// Detekcja tekstu (opcjonalnie - może być wolna) - używamy oryginalnego URL
				results.textDetected = await this.detectText(originalImageUrl);
			} catch (error) {
				console.error('❌ Błąd podczas detekcji tekstu:', error);
				results.errors.push('Nie udało się wykryć tekstu');
				results.textDetected.status = 'error';
			}

			// Oblicz ogólny wynik
			results.overallScore = this.calculateOverallScore(results, isThumbnail);

			console.log('✅ Analiza obrazu zakończona:', results);
			return results;
		}

		/**
		 * Sprawdza rozdzielczość obrazu
		 * @param {HTMLImageElement} imageElement
		 * @returns {Object} Status rozdzielczości
		 */
		checkResolution(imageElement) {
			if (!imageElement || typeof imageElement.naturalWidth === 'undefined') {
				return { status: 'unknown', score: 0, width: 0, height: 0, message: 'Brak danych obrazu' };
			}
			const width = imageElement.naturalWidth || 0;
			const height = imageElement.naturalHeight || 0;

			let status, score;

			if (width >= 2560 && height >= 2560) {
				status = 'optimal';
				score = 100;
			} else if (width >= 1200 && height >= 1200) {
				status = 'good';
				score = 85;
			} else if (width >= 800 && height >= 800) {
				status = 'acceptable';
				score = 65;
			} else {
				status = 'poor';
				score = 35;
			}

			const statusText = status === 'optimal' ? 'Optymalna' : status === 'good' ? 'Dobra' : status === 'acceptable' ? 'Akceptowalna' : 'Za niska';
			return {
				status,
				score,
				width,
				height,
				message: `${width}x${height}px - ${statusText}`
			};
		}

		/**
		 * Wykrywa białe ramki wokół obrazu
		 * @param {string} imageUrl
		 * @param {boolean} isThumbnail
		 * @returns {Promise<Object>}
		 */
		async detectWhiteBorders(imageUrl, isThumbnail) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				img.crossOrigin = 'anonymous';

				img.onload = () => {
					try {
						this.canvas.width = img.width;
						this.canvas.height = img.height;
						this.ctx.drawImage(img, 0, 0);

						const imageData = this.ctx.getImageData(0, 0, img.width, img.height);
						const pixels = imageData.data;

						// Skanuj wszystkie krawędzie
						const topBorderHeight = this.scanHorizontalBorder(pixels, img.width, img.height, true);
						const bottomBorderHeight = this.scanHorizontalBorder(pixels, img.width, img.height, false);
						const leftBorderWidth = this.scanVerticalBorder(pixels, img.width, img.height, true);
						const rightBorderWidth = this.scanVerticalBorder(pixels, img.width, img.height, false);

						const topPercent = (topBorderHeight / img.height) * 100;
						const bottomPercent = (bottomBorderHeight / img.height) * 100;
						const leftPercent = (leftBorderWidth / img.width) * 100;
						const rightPercent = (rightBorderWidth / img.width) * 100;
						const totalBorderPercent = (topPercent + bottomPercent + leftPercent + rightPercent) / 4;

					// Ramka = tylko gdy Z KAŻDEJ strony jest ponad 2% (wymóg użytkownika)
					const minSidePercent = 2;
					const hasBorder = topPercent > minSidePercent && bottomPercent > minSidePercent &&
						leftPercent > minSidePercent && rightPercent > minSidePercent;

						let status;
						// Dla miniatury: ramka WYMAGANA – każda strona > 2%
						if (isThumbnail) {
							if (hasBorder && totalBorderPercent >= 1.5 && totalBorderPercent <= 5) {
								status = 'optimal';   // Prawidłowa ramka
							} else if (hasBorder) {
								status = 'acceptable'; // Ramka jest, ale poza idealnym zakresem
							} else {
								status = 'missing';   // Brak ramki (przynajmniej jedna strona ≤ 2%)
							}
						} else {
							if (!hasBorder || totalBorderPercent < 0.8) {
								status = 'optimal';   // Pozostałe obrazy: brak ramki OK
							} else {
								status = 'unwanted';
							}
						}

						resolve({
							detected: hasBorder,
							topPercent: Math.round(topPercent * 10) / 10,
							bottomPercent: Math.round(bottomPercent * 10) / 10,
							leftPercent: Math.round(leftPercent * 10) / 10,
							rightPercent: Math.round(rightPercent * 10) / 10,
							totalPercent: Math.round(totalBorderPercent * 10) / 10,
							status
						});
					} catch (error) {
						reject(error);
					}
				};

				img.onerror = () => reject(new Error('Nie udało się załadować obrazu'));

				// Próba załadowania obrazu
				img.src = imageUrl;
			});
		}

		/**
		 * Skanuje poziomą krawędź (góra/dół) w poszukiwaniu białych pikseli
		 * @param {Uint8ClampedArray} pixels
		 * @param {number} width
		 * @param {number} height
		 * @param {boolean} fromTop
		 * @returns {number} Wysokość białej ramki w pikselach
		 */
	scanHorizontalBorder(pixels, width, height, fromTop) {
		// Próg wykrywania białych pikseli - balans między czułością a precyzją
		const threshold = 250;
		// Wiersz liczy się jako ramka gdy 92% pikseli jest białych
		const minWhiteRatio = 0.92;

			const startRow = fromTop ? 0 : height - 1;
			const endRow = fromTop ? height : -1;
			const step = fromTop ? 1 : -1;

			let borderHeight = 0;

			for (let y = startRow; y !== endRow; y += step) {
				let whitePixels = 0;

				for (let x = 0; x < width; x++) {
					const i = (y * width + x) * 4;
					const r = pixels[i];
					const g = pixels[i + 1];
					const b = pixels[i + 2];

					if (r >= threshold && g >= threshold && b >= threshold) {
						whitePixels++;
					}
				}

				if (whitePixels / width >= minWhiteRatio) {
					borderHeight++;
				} else {
					break;
				}
			}

			return borderHeight;
		}

		/**
		 * Skanuje pionową krawędź (lewa/prawa) w poszukiwaniu białych pikseli
		 * @param {Uint8ClampedArray} pixels
		 * @param {number} width
		 * @param {number} height
		 * @param {boolean} fromLeft
		 * @returns {number} Szerokość białej ramki w pikselach
		 */
	scanVerticalBorder(pixels, width, height, fromLeft) {
		const threshold = 250;
		const minWhiteRatio = 0.92;

			const startCol = fromLeft ? 0 : width - 1;
			const endCol = fromLeft ? width : -1;
			const step = fromLeft ? 1 : -1;

			let borderWidth = 0;

			for (let x = startCol; x !== endCol; x += step) {
				let whitePixels = 0;

				for (let y = 0; y < height; y++) {
					const i = (y * width + x) * 4;
					const r = pixels[i];
					const g = pixels[i + 1];
					const b = pixels[i + 2];

					if (r >= threshold && g >= threshold && b >= threshold) {
						whitePixels++;
					}
				}

				if (whitePixels / height >= minWhiteRatio) {
					borderWidth++;
				} else {
					break;
				}
			}

			return borderWidth;
		}

		/**
		 * Mierzy DPI obrazu
		 * @param {HTMLImageElement} imageElement
		 * @returns {Object}
		 */
		measureDPI(imageElement) {
			if (!imageElement || typeof imageElement.naturalWidth === 'undefined') {
				return { estimated: 0, quality: 'unknown', message: 'Brak danych' };
			}
			const naturalWidth = imageElement.naturalWidth || 0;
			const naturalHeight = imageElement.naturalHeight || 0;
			const displayWidth = imageElement.offsetWidth || imageElement.clientWidth || 0;

			let estimatedDpi = 0;
			let quality = 'unknown';

			if (displayWidth > 0) {
				const screenDpi = 96;
				const scaleFactor = naturalWidth / displayWidth;
				estimatedDpi = Math.round(screenDpi * scaleFactor);
			} else if (naturalWidth > 0) {
				// Fallback: zakładany rozmiar wyświetlania ~8 cali (standard e‑commerce)
				const assumedInches = 8;
				estimatedDpi = Math.round(Math.max(naturalWidth, naturalHeight) / assumedInches);
			}

			if (estimatedDpi >= 150) {
				quality = 'high';
			} else if (estimatedDpi >= 72) {
				quality = 'medium';
			} else if (estimatedDpi > 0) {
				quality = 'low';
			}

			const qualityText = quality === 'high' ? 'Wysoka jakość' : quality === 'medium' ? 'Średnia jakość' : quality === 'low' ? 'Niska jakość' : 'Nie obliczono';
			return {
				estimated: estimatedDpi,
				quality,
				message: estimatedDpi > 0 ? `~${estimatedDpi} DPI - ${qualityText}` : 'Brak danych (obraz nie załadowany w DOM)'
			};
		}

		/**
		 * Analizuje procent białego tła
		 * @param {string} imageUrl
		 * @returns {Promise<number>} Procent białego tła (0-100)
		 */
		/**
		 * Analizuje procent białego tła TYLKO W RAMCE (5% z każdej strony).
		 * Ramka powinna być biała. Środek (produkt) pomijamy.
		 */
		async analyzeBackground(imageUrl) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				img.crossOrigin = 'anonymous';

				img.onload = () => {
					try {
						this.canvas.width = img.width;
						this.canvas.height = img.height;
						this.ctx.drawImage(img, 0, 0);

						const imageData = this.ctx.getImageData(0, 0, img.width, img.height);
						const pixels = imageData.data;
						const w = img.width;
						const h = img.height;

						// Ramka = 5% z każdej strony
						const marginX = Math.floor(w * 0.05);
						const marginY = Math.floor(h * 0.05);

						let whitePixels = 0;
						let totalPixels = 0;
						const threshold = 240;

						// Funkcja sprawdzająca czy piksel jest w ramce (NIE w środku)
						const isInBorder = (x, y) => {
							return x < marginX || x >= (w - marginX) || y < marginY || y >= (h - marginY);
						};

						// Liczymy białe piksele TYLKO w ramce
						for (let y = 0; y < h; y++) {
							for (let x = 0; x < w; x++) {
								if (isInBorder(x, y)) {
									totalPixels++;
									const i = (y * w + x) * 4;
									const r = pixels[i];
									const g = pixels[i + 1];
									const b = pixels[i + 2];
									if (r > threshold && g > threshold && b > threshold) {
										whitePixels++;
									}
								}
							}
						}

						if (totalPixels <= 0) {
							resolve(0);
							return;
						}

						const whitePercent = (whitePixels / totalPixels) * 100;
						resolve(Math.round(whitePercent * 10) / 10);
					} catch (error) {
						reject(error);
					}
				};

				img.onerror = () => reject(new Error('Nie udało się załadować obrazu'));
				img.src = imageUrl;
			});
		}

		/**
		 * Wykrywa tekst na obrazie używając Tesseract.js
		 * @param {string} imageUrl
		 * @returns {Promise<Object>}
		 */
		async detectText(imageUrl) {
			try {
				// Sprawdź czy Tesseract jest dostępny
				if (typeof Tesseract === 'undefined') {
					console.warn('⚠️ Tesseract.js nie jest załadowany');
					return {
						hasText: false,
						confidence: 0,
						text: '',
						status: 'unavailable',
						message: 'OCR niedostępny'
					};
				}

				console.log('🔤 Rozpoczynam detekcję tekstu...');

				const result = await Tesseract.recognize(
					imageUrl,
					'pol+eng',
					{
						logger: m => {
							if (m.status === 'recognizing text') {
								const pct = Math.round(m.progress * 100);
								if (pct === 0 || pct === 50 || pct === 100) {
									console.log(`OCR Progress: ${pct}%`);
								}
							}
						}
					}
				);

				const detectedText = result.data.text.trim();
				const confidence = result.data.confidence;
				const hasText = detectedText.length > 10 && confidence > 60;

				return {
					hasText,
					confidence: Math.round(confidence),
					text: detectedText.substring(0, 200), // Ogranicz długość
					status: 'completed',
					message: hasText ? `Wykryto tekst (${Math.round(confidence)}% pewności)` : 'Brak tekstu'
				};
			} catch (error) {
				console.error('❌ Błąd Tesseract:', error);
				return {
					hasText: false,
					confidence: 0,
					text: '',
					status: 'error',
					message: 'Błąd OCR'
				};
			}
		}

		/**
		 * Ocenia złożoność obrazu (dla miniatur)
		 * @param {string} imageUrl
		 * @returns {Promise<Object>}
		 */
		async assessComplexity(imageUrl) {
			return new Promise((resolve, reject) => {
				const img = new Image();
				img.crossOrigin = 'anonymous';

				img.onload = () => {
					try {
						this.canvas.width = img.width;
						this.canvas.height = img.height;
						this.ctx.drawImage(img, 0, 0);

						const imageData = this.ctx.getImageData(0, 0, img.width, img.height);
						const pixels = imageData.data;

						// Analiza różnorodności kolorów
						const colorMap = new Map();
						let totalPixels = 0;

						// Próbkuj co 10. piksel dla wydajności
						for (let i = 0; i < pixels.length; i += 40) {
							const r = Math.floor(pixels[i] / 32);
							const g = Math.floor(pixels[i + 1] / 32);
							const b = Math.floor(pixels[i + 2] / 32);
							const colorKey = `${r},${g},${b}`;

							colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
							totalPixels++;
						}

						const uniqueColors = colorMap.size;
						const colorDiversity = Math.min(uniqueColors / 100, 1); // Normalizuj do 0-1

						// Oblicz wynik złożoności (0-100)
						const complexityScore = Math.round(colorDiversity * 100);

						let status;
						if (complexityScore >= 60) {
							status = 'high'; // Dobrze rozbudowana miniatura
						} else if (complexityScore >= 30) {
							status = 'medium';
						} else {
							status = 'low'; // Za mało rozbudowana
						}

						resolve({
							score: complexityScore,
							uniqueColors,
							status,
							message: `${complexityScore}/100 - ${status === 'high' ? 'Dobrze rozbudowana' : status === 'medium' ? 'Średnio rozbudowana' : 'Za mało rozbudowana'}`
						});
					} catch (error) {
						reject(error);
					}
				};

				img.onerror = () => reject(new Error('Nie udało się załadować obrazu'));
				img.src = imageUrl;
			});
		}

		/**
		 * Sprawdza czy rozmiar obrazu jest nadmierny
		 * @param {HTMLImageElement} imageElement
		 * @returns {Object}
		 */
		checkExcessiveSize(imageElement) {
			if (!imageElement || typeof imageElement.naturalWidth === 'undefined') {
				return { isExcessive: false, megapixels: 0, message: '' };
			}
			const width = imageElement.naturalWidth || 0;
			const height = imageElement.naturalHeight || 0;
			const megapixels = (width * height) / 1000000;

			// Nadmierny rozmiar > 10 megapikseli
			const isExcessive = megapixels > 10;

			return {
				isExcessive,
				megapixels: Math.round(megapixels * 10) / 10,
				message: isExcessive ? `⚠️ Nadmierny rozmiar (${Math.round(megapixels)} MP)` : `✓ Rozmiar OK (${Math.round(megapixels * 10) / 10} MP)`
			};
		}

		/**
		 * Oblicza ogólny wynik jakości obrazu
		 * @param {Object} results
		 * @param {boolean} isThumbnail
		 * @returns {number} Wynik 0-100
		 */
		calculateOverallScore(results, isThumbnail) {
			let score = 0;
			let maxScore = 0;

			// Rozdzielczość (waga: 30%)
			score += results.resolution.score * 0.3;
			maxScore += 100 * 0.3;

			// Białe ramki (waga: 25%)
			if (results.whiteBorders.status !== 'error') {
				if (isThumbnail) {
					// Dla miniatury: powinny być ramki
					if (results.whiteBorders.status === 'optimal') {
						score += 100 * 0.25;
					} else if (results.whiteBorders.status === 'acceptable') {
						score += 70 * 0.25;
					} else {
						score += 30 * 0.25;
					}
				} else {
					// Dla pozostałych: nie powinno być ramek
					if (results.whiteBorders.status === 'optimal') {
						score += 100 * 0.25;
					} else {
						score += 50 * 0.25;
					}
				}
				maxScore += 100 * 0.25;
			}

			// DPI (waga: 15%)
			if (results.dpi.quality === 'high') {
				score += 100 * 0.15;
			} else if (results.dpi.quality === 'medium') {
				score += 70 * 0.15;
			} else {
				score += 40 * 0.15;
			}
			maxScore += 100 * 0.15;

			// Białe tło (waga: 10%)
			if (results.backgroundWhiteness >= 60) {
				score += 100 * 0.1;
			} else if (results.backgroundWhiteness >= 40) {
				score += 70 * 0.1;
			} else {
				score += 40 * 0.1;
			}
			maxScore += 100 * 0.1;

			// Złożoność (tylko dla miniatur, waga: 10%)
			if (isThumbnail && results.complexity.status !== 'error') {
				score += results.complexity.score * 0.1;
				maxScore += 100 * 0.1;
			}

			// Brak tekstu (waga: 10%)
			if (results.textDetected.status === 'completed') {
				if (!results.textDetected.hasText) {
					score += 100 * 0.1;
				} else {
					score += 30 * 0.1;
				}
				maxScore += 100 * 0.1;
			}

			return maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
		}

		/**
		 * Czyści zasoby
		 */
		cleanup() {
			if (this.tesseractWorker) {
				this.tesseractWorker.terminate();
				this.tesseractWorker = null;
			}
		}
	}
	// ============= ANALIZA JAKOŚCI OBRAZÓW - KONIEC =============

	// ============= HELPER: GENERATOR HASHY HASEŁ =============
	// Funkcja pomocnicza do generowania hash'y haseł (SHA-256)
	// UŻYCIE: Otwórz konsolę przeglądarki (F12) i wpisz:
	// generatePasswordHash('TwojeHasło123')
	window.generatePasswordHash = async function (password) {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('📝 HASH HASŁA WYGENEROWANY:');
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('Hasło:', password);
		console.log('Hash:', hashHex);
		console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
		console.log('💡 Skopiuj powyższy hash i wklej do kolumny "password_hash" w arkuszu Google Sheets');

		// Automatycznie skopiuj do schowka jeśli możliwe
		try {
			await navigator.clipboard.writeText(hashHex);
			console.log('✅ Hash został automatycznie skopiowany do schowka!');
		} catch (e) {
			console.log('ℹ️ Skopiuj hash ręcznie z powyższego logu');
		}

		return hashHex;
	}
	// ============= KONIEC HELPERA =============
	// ============= SYSTEM AUTORYZACJI - KONIEC =============

class AllegroOfferScanner {
		constructor() {
			this.uiRootId = 'wt-skan-ui';
			this.lastScanLabelId = 'wt-skan-last-scan';
			this.isInitialized = false;
			this.offerQuality = 0; // Procent jakości oferty
			this.productName = '';
			this.offerName = '';
			this.nameMatchStatus = 'unknown'; // 'match', 'mismatch', 'unknown'
			this.nameAnalysis = {
				wordsMatch: 0, // Procent zgodności słów (0-100)
				lengthMatch: 0, // Procent zgodności długości (0-100)
				matchingWords: 0, // Liczba pasujących słów
				totalWords: 0, // Całkowita liczba unikalnych słów
				lengthDifference: 0 // Różnica w długości znaków
			};
			this.productRating = 0; // Ocena produktu (np. 4.85)
			this.ratingCount = 0; // Liczba ocen
			this.reviewCount = 0; // Liczba recenzji
			this.hasThumbnail = false; // Czy istnieje miniatura obrazu
			this.thumbnailData = {
				src: '',
				alt: '',
				naturalWidth: 0,
				naturalHeight: 0,
				displayWidth: 0,
				displayHeight: 0,
				fileSize: 0,
				format: '',
				aspectRatio: '',
				estimatedDpi: 0
			};
			this.allImages = []; // Lista wszystkich obrazów znalezionych na stronie

			// Analiza jakości obrazu
			this.imageQualityAnalyzer = new ImageQualityAnalyzer();
			this.imageQuality = {
				resolution: { status: 'unknown', score: 0, width: 0, height: 0, message: '' },
				whiteBorders: { detected: false, topPercent: 0, bottomPercent: 0, leftPercent: 0, rightPercent: 0, totalPercent: 0, status: 'unknown' },
				dpi: { estimated: 0, quality: 'unknown', message: '' },
				backgroundWhiteness: 0,
				complexity: { score: 0, uniqueColors: 0, status: 'unknown', message: '' },
				textDetected: { hasText: false, confidence: 0, text: '', status: 'unknown', message: '' },
				excessiveSize: { isExcessive: false, megapixels: 0, message: '' },
				overallScore: 0,
				errors: []
			};

			// Analiza AI miniaturki (wyniki z backendu)
			this.aiImageAnalysis = {
				regulaminCompliance: {
					watermarks: { detected: false, details: 'Nie przeanalizowano' },
					promotionalText: { detected: false, details: 'Nie przeanalizowano' },
					logos: { detected: false, details: 'Nie przeanalizowano' },
					extraElements: { detected: false, details: 'Nie przeanalizowano' },
					colorVariants: { detected: false, details: 'Nie przeanalizowano' },
					inappropriateContent: { detected: false, details: 'Nie przeanalizowano' }
				},
				visualQuality: {
					sharpness: { score: 0, assessment: 'Nie przeanalizowano' },
					background: { score: 0, assessment: 'Nie przeanalizowano' }
				},
				overallAIScore: 0,
				summary: 'Analiza AI nie została jeszcze wykonana',
				aiErrors: []
			};
			this.hasAllegroSmart = false; // Czy produkt ma etykietę Allegro Smart!
			this.hasBestPriceGuarantee = false; // Czy produkt ma Gwarancję najniższej ceny
			this.hasAllegroPay = false; // Czy produkt ma opcję Allegro Pay
			this.allegroPayType = ''; // Typ Allegro Pay: 'standard' lub 'installments'
			this.allegroPayDetails = ''; // Szczegóły (np. "15 rat x 113,27 zł")
			this.productParameters = []; // Lista parametrów produktu
			this.parametersCount = 0; // Liczba parametrów
			this.hasBrand = false; // Czy produkt ma markę
			this.brandName = ''; // Nazwa marki lub 'bez marki'
			this.brandLink = ''; // Link do marki
			this.brandType = ''; // Typ: 'marka' lub 'producent'

			// Monety i Kupony
			this.hasCoins = false; // Czy produkt ma Smart! Monety
			this.coinsAmount = 0; // Liczba monet
			this.coinsDescription = ''; // Opis monet
			this.hasCoupons = false; // Czy produkt ma kupony
			this.coupons = []; // Lista kuponów
			this.couponsCount = 0; // Liczba kuponów

			// Reklamacja, Gwarancja, Allegro Ochrona Kupujących
			this.hasReturnPolicy = false; // Czy ma politykę zwrotów
			this.returnDays = 0; // Liczba dni na zwrot (standardowo 14)
			this.hasComplaintPolicy = false; // Czy ma politykę reklamacji
			this.complaintPeriod = ''; // Okres reklamacji (np. "2 lata")
			this.hasWarranty = false; // Czy ma gwarancję
			this.warrantyPeriod = ''; // Okres gwarancji (np. "24 miesiące")
			this.hasAllegroProtect = false; // Czy ma Allegro Ochronę Kupujących
			this.allegroProtectPeriod = ''; // Okres ochrony (np. "24 miesiące")
			this.protectionQuality = 0; // Jakość ochrony (0-100%)

			// Flagi otwartych sekcji (resetowane przy każdym skanowaniu)
			this.trustInfoOpened = false; // Czy sekcja Allegro Ochrona została otwarta
			this.parametersOpened = false; // Czy sekcja Parametry została otwarta

			// Sekcje promocyjne (Pod miniaturami)
			this.promotionalSections = []; // Lista sekcji promocyjnych z ich danymi
			this.promotionalQualityScore = 0; // Ocena jakości sekcji promocyjnych (0-100)

			// Sekcja zestawów produktowych (Zamów zestaw w jednej przesyłce)
			this.bundleSection = null; // Dane sekcji zestawów produktowych
			this.bundleQualityScore = 0; // Ocena jakości sekcji zestawów (0-100)

			// Sekcja Propozycje dla Ciebie
			this.suggestionsSection = null; // Dane sekcji propozycji
			this.suggestionsQualityScore = 0; // Ocena jakości sekcji propozycji (0-100)

			// Analiza opisu aukcji
			this.descriptionHtml = ''; // Pełny HTML opisu
			this.descriptionText = ''; // Tekst opisu (bez HTML)
			this.descriptionLength = 0; // Liczba znaków w opisie
			this.descriptionHasImages = false; // Czy opis zawiera obrazy
			this.descriptionImagesCount = 0; // Liczba obrazów w opisie
			this.descriptionBoldPercent = 0; // Procent tekstu pogrubionego (bold/strong)
			this.parametersInDescription = []; // Lista parametrów ze sprawdzeniem w opisie
			this.parametersInDescriptionScore = 0; // Procent parametrów znalezionych w opisie
			this.descriptionAiAnalysis = ''; // Analiza opisu przez AI (OpenAI)
			this.descriptionAiTokensUsed = 0; // Liczba tokenów użytych w analizie AI

			// Informacje o sprzedawcy
			this.sellerName = ''; // Nazwa sprzedawcy
			this.sellerRecommendationPercent = 0; // Procent kupujących polecających
			this.sellerCompanyName = ''; // Nazwa firmy sprzedawcy
			this.sellerCompanyNameMatch = true; // Czy nazwa firmy zgadza się z nazwą sprzedawcy
			this.sellerCategoryLink = ''; // Link do innych przedmiotów z kategorii
			this.sellerCategoryName = ''; // Nazwa kategorii
			this.sellerAllItemsLink = ''; // Link do wszystkich przedmiotów sprzedającego
			this.sellerAboutLink = ''; // Link do "O sprzedającym"
			this.sellerAskQuestionLink = ''; // Link do "Zadaj pytanie"

			// Analiza kontrofert (inne oferty produktu)
			this.competitorOffers = []; // Lista kontrofert (max 5)
			this.competitorOffersCount = 0; // Całkowita liczba dostępnych kontrofert
			this.lowestCompetitorPrice = null; // Najniższa cena konkurencji
			this.averageCompetitorPrice = null; // Średnia cena konkurencji

			// Ocena jakości ocen produktu
			this.ratingValueEvaluation = null; // Ocena wartości oceny (rating)
			this.ratingCountEvaluation = null; // Ocena liczby ocen (rating count)
			this.reviewCountEvaluation = null; // Ocena liczby recenzji (review count)

			// UI state
			this.isCollapsed = false; // Czy panel jest zwinięty

			this.lastScanDate = null;
			this.mutationObserver = null;
			this.debounceTimer = null;
			try { this.ensureUIInjected(); } catch (_) {}
			try {
				const p = this.init();
				if (p && typeof p.then === 'function') {
					p.catch(() => {
						try { this.ensureUIInjected(); } catch (_) {}
					});
				}
			} catch (_) {
				try { this.ensureUIInjected(); } catch (_) {}
			}
		}

		async init() {
			try {
				this.ensureUIInjected();
			} catch (e) {
				console.warn('⚠️ ensureUIInjected:', e && e.message);
			}
			if (!this.uiKeepAliveTimer) {
				this.uiKeepAliveTimer = setInterval(() => {
					try {
						if (!document.getElementById(this.uiRootId)) {
							this.createUI();
						}
					} catch (_) {}
				}, 2000);
				window.addEventListener('beforeunload', () => { try { clearInterval(this.uiKeepAliveTimer); } catch (_) {} }, { once: true });
			}

			try {
				// Jeśli użytkownik zalogowany, odśwież licznik raportów z serwera
				if (authManager.isLoggedIn()) {
					await this.refreshReportsCount();
				}
			} catch (e) {
				console.warn('⚠️ refreshReportsCount:', e && e.message);
			}

			try {
				// Pierwsze skanowanie - bez otwierania dialogów (szybkie)
				await this.scanBasicData();
			} catch (e) {
				console.error('❌ Błąd podczas podstawowego skanowania (strona może mieć inny układ, np. /produkt/):', e);
				try {
					const timeEl = document.getElementById(this.lastScanLabelId);
					if (timeEl) timeEl.textContent = 'Błąd skanowania – sprawdź konsolę (F12)';
				} catch (_) {}
			}
			// Wyłączone automatyczne skanowanie przy zmianach DOM - eliminuje zapętlenie
			// this.observeDomChanges();
		}

	normalizeAiImageAnalysis(data) {
		const d = data || {};
		const defaults = {
			regulaminCompliance: {
				watermarks: { detected: false, details: 'Nie przeanalizowano' },
				promotionalText: { detected: false, details: 'Nie przeanalizowano' },
				logos: { detected: false, details: 'Nie przeanalizowano' },
				extraElements: { detected: false, details: 'Nie przeanalizowano' },
				colorVariants: { detected: false, details: 'Nie przeanalizowano' },
				inappropriateContent: { detected: false, details: 'Nie przeanalizowano' }
			},
			visualQuality: {
				sharpness: { score: 0, assessment: 'Nie przeanalizowano' },
				background: { score: 0, assessment: 'Nie przeanalizowano' }
			},
			overallAIScore: 0,
			summary: typeof d.summary === 'string' ? d.summary : 'Analiza AI nie została jeszcze wykonana',
			aiErrors: Array.isArray(d.aiErrors) ? d.aiErrors : []
		};
		const rc = d.regulaminCompliance || {};
		const vq = d.visualQuality || {};

		// Konwersja starych formatów visualQuality (liczby) na nowe (obiekty)
		let sharpnessObj = defaults.visualQuality.sharpness;
		let backgroundObj = defaults.visualQuality.background;

		if (vq.sharpness) {
			if (typeof vq.sharpness === 'number') {
				// Stary format: liczba → konwertuj na obiekt
				sharpnessObj = {
					score: vq.sharpness,
					assessment: vq.sharpness >= 80 ? 'Zdjęcie jest ostre i wyraźne' :
						vq.sharpness >= 60 ? 'Ostrość akceptowalna' :
						'Zdjęcie wymaga poprawy ostrości'
				};
			} else if (typeof vq.sharpness === 'object') {
				// Nowy format: obiekt → użyj bezpośrednio
				sharpnessObj = { ...defaults.visualQuality.sharpness, ...vq.sharpness };
			}
		}

		if (vq.background) {
			if (typeof vq.background === 'number') {
				// Stary format: liczba
				backgroundObj = {
					score: vq.background,
					assessment: vq.background >= 80 ? 'Tło profesjonalne i zgodne z wytycznymi' :
						vq.background >= 60 ? 'Tło akceptowalne' :
						'Tło wymaga poprawy'
				};
			} else if (typeof vq.background === 'object') {
				// Nowy format: obiekt
				backgroundObj = { ...defaults.visualQuality.background, ...vq.background };
			}
		} else if (vq.backgroundProfessionalism !== undefined) {
			// Fallback: stara nazwa 'backgroundProfessionalism'
			const bgScore = typeof vq.backgroundProfessionalism === 'number' ? vq.backgroundProfessionalism : 0;
			backgroundObj = {
				score: bgScore,
				assessment: bgScore >= 80 ? 'Tło profesjonalne i zgodne z wytycznymi' :
					bgScore >= 60 ? 'Tło akceptowalne' :
					'Tło wymaga poprawy'
			};
		}

		return {
			regulaminCompliance: {
				...defaults.regulaminCompliance,
				...rc,
				watermarks: { ...defaults.regulaminCompliance.watermarks, ...(rc.watermarks || {}) },
				promotionalText: { ...defaults.regulaminCompliance.promotionalText, ...(rc.promotionalText || {}) },
				logos: { ...defaults.regulaminCompliance.logos, ...(rc.logos || {}) },
				extraElements: { ...defaults.regulaminCompliance.extraElements, ...(rc.extraElements || {}) },
				colorVariants: { ...defaults.regulaminCompliance.colorVariants, ...(rc.colorVariants || {}) },
				inappropriateContent: { ...defaults.regulaminCompliance.inappropriateContent, ...(rc.inappropriateContent || {}) }
			},
			visualQuality: {
				sharpness: sharpnessObj,
				background: backgroundObj
			},
			overallAIScore: typeof d.overallAIScore === 'number' ? d.overallAIScore : defaults.overallAIScore,
			summary: defaults.summary,
			aiErrors: defaults.aiErrors
		};
	}

		ensureUIInjected() {
			try {
				if (document.getElementById(this.uiRootId)) return;
				if (document.body) {
					this.createUI();
					return;
				}
				const onReady = () => {
					try { this.createUI(); } catch (_) {}
				};
				if (document.readyState === 'loading') {
					document.addEventListener('DOMContentLoaded', onReady, { once: true });
				} else {
					window.addEventListener('load', onReady, { once: true });
				}
			} catch (_) {}
		}

		async refreshReportsCount() {
			console.log('🔄 Odświeżam licznik raportów z serwera...');
			const result = await authManager.checkLimit();

			if (result.success) {
				const reportsCountEl = document.getElementById('reports-count');
				if (reportsCountEl) {
					reportsCountEl.textContent = authManager.getRemainingReports();
					console.log(`✅ Licznik zaktualizowany: ${authManager.getRemainingReports()} raportów`);
				}
			} else {
				console.warn('⚠️ Nie udało się odświeżyć licznika raportów');
			}
		}

		createUI() {
			if (document.getElementById(this.uiRootId)) return;

			// Załaduj nowoczesną czcionkę Inter (jeśli jeszcze nie załadowana)
			if (!document.getElementById('wt-skan-font-inter')) {
				const link = document.createElement('link');
				link.id = 'wt-skan-font-inter';
				link.rel = 'stylesheet';
				link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
				document.head.appendChild(link);
			}

			const root = document.createElement('div');
			root.id = this.uiRootId;
			root.style.cssText = [
				'position: fixed',
				'top: 72px',
				'right: 20px',
				'width: 340px',
				'background: #ffffff',
				'border: 1px solid rgba(255, 90, 0, 0.25)',
				'border-radius: 16px',
				'box-shadow: 0 10px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
				'z-index: 2147483647',
				'font-family: \'Inter\', system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
				'font-size: 14px',
				'color: #1f2937',
				'letter-spacing: -0.01em',
				'line-height: 1.5',
				'max-height: 80vh',
				'overflow-y: auto'
			].join(';');

			const header = document.createElement('div');
			header.style.cssText = [
				'background: linear-gradient(135deg, #ff5a00, #e04e00)',
				'color: #fff',
				'padding: 14px 18px',
				'border-radius: 16px 16px 0 0',
				'font-weight: 600',
				'font-size: 15px',
				'letter-spacing: -0.02em',
				'position: sticky',
				'top: 0',
				'z-index: 1',
				'display: flex',
				'justify-content: space-between',
				'align-items: center',
				'cursor: pointer',
				'user-select: none'
			].join(';');

			// Tytuł w lewej części
			const headerLeft = document.createElement('div');
			headerLeft.style.cssText = 'display: flex; align-items: center; gap: 8px;';

			const headerTitle = document.createElement('span');
			headerTitle.textContent = '🧮 Skan ofert';

			headerLeft.appendChild(headerTitle);

			const collapseIcon = document.createElement('span');
			collapseIcon.id = this.uiRootId + '-collapse-icon';
			collapseIcon.style.cssText = 'font-size: 18px; cursor: pointer;';
			collapseIcon.innerHTML = '▼';

			header.appendChild(headerLeft);
			header.appendChild(collapseIcon);
			header.addEventListener('click', () => this.togglePanel());

			const content = document.createElement('div');
			content.id = this.uiRootId + '-content';
			content.style.cssText = 'padding: 16px; -webkit-user-select: text; user-select: text;';
			// Zatrzymaj propagację klawiszy do strony Allegro, żeby w polach input dało się pisać
			content.addEventListener('keydown', e => e.stopPropagation(), true);
			content.addEventListener('keypress', e => e.stopPropagation(), true);
			content.addEventListener('input', e => e.stopPropagation(), true);

			// SEKCJA AUTORYZACJI
			const authSection = document.createElement('div');
			authSection.id = 'auth-section';
			authSection.style.cssText = [
				'background: #f9fafb',
				'border: 1px solid #e5e7eb',
				'border-radius: 8px',
				'padding: 12px',
				'margin-bottom: 12px'
			].join(';');

			// Sprawdź czy użytkownik jest zalogowany
			if (authManager.isLoggedIn()) {
				// Wyświetl status zalogowanego użytkownika
				authSection.innerHTML = `
				<div style="margin-bottom: 8px;">
					<div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Zalogowany jako:</div>
					<div style="font-weight: 600; color: #374151;">${authManager.getUserEmail()}</div>
				</div>
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
					<div style="color: #6b7280;">Dostępne raporty:</div>
					<div style="display: flex; align-items: center; gap: 8px;">
						<div id="reports-count" style="font-weight: 700; color: #059669; font-size: 16px; transition: all 0.3s;">
							${authManager.getRemainingReports()}
						</div>
						<button id="refresh-count-btn" title="Odśwież licznik raportów" style="padding: 2px 4px; background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db; border-radius: 2px; cursor: pointer; font-size: 14px; font-weight: 600;">
							🔄
						</button>
					</div>
				</div>
				<button id="logout-btn" style="width: 100%; padding: 8px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
					Wyloguj się
				</button>
			`;

				// Event listenery
				setTimeout(() => {
					// Przycisk wylogowania
					const logoutBtn = document.getElementById('logout-btn');
					if (logoutBtn) {
						logoutBtn.addEventListener('click', () => {
							authManager.logout();
							location.reload();
						});
					}

					// Przycisk odświeżania licznika raportów
					const refreshCountBtn = document.getElementById('refresh-count-btn');
					if (refreshCountBtn) {
						refreshCountBtn.addEventListener('click', async () => {
							const originalText = refreshCountBtn.textContent;
							refreshCountBtn.textContent = '⏳';
							refreshCountBtn.disabled = true;
							refreshCountBtn.style.opacity = '0.6';

							await this.refreshReportsCount();

							// Animacja potwierdzenia
							const reportsCountEl = document.getElementById('reports-count');
							if (reportsCountEl) {
								reportsCountEl.style.transform = 'scale(1.2)';
								reportsCountEl.style.color = '#2563eb';
								setTimeout(() => {
									reportsCountEl.style.transform = 'scale(1)';
									reportsCountEl.style.color = '#059669';
								}, 300);
							}

							refreshCountBtn.textContent = '✓';
							setTimeout(() => {
								refreshCountBtn.textContent = originalText;
								refreshCountBtn.disabled = false;
								refreshCountBtn.style.opacity = '1';
							}, 1000);
						});
					}
				}, 100);
			} else {
				// Formularz logowania/rejestracji
				authSection.innerHTML = `
				<div style="display: flex; gap: 8px; margin-bottom: 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">
					<button id="tab-login" style="flex: 1; padding: 8px; background: #059669; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
						🔐 Logowanie
					</button>
					<button id="tab-register" style="flex: 1; padding: 8px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
						📝 Rejestracja
					</button>
				</div>
				
				<!-- FORMULARZ LOGOWANIA -->
				<div id="login-form" style="display: block;">
					<div style="font-weight: 600; color: #374151; margin-bottom: 12px;">🔐 Zaloguj się</div>
					<input type="email" id="login-email" placeholder="Email" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<input type="password" id="login-password" placeholder="Hasło" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<button id="login-btn" style="width: 100%; padding: 8px; background: #059669; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
						Zaloguj się
					</button>
					<div style="margin-top: 8px; text-align: center;">
						<a id="link-forgot-password" href="#" style="font-size: 12px; color: #059669;">Zapomniałem hasła</a>
					</div>
					<div id="login-error" style="color: #dc2626; font-size: 12px; margin-top: 8px; display: none;"></div>
				</div>

				<!-- FORMULARZ RESET HASŁA -->
				<div id="reset-form" style="display: none;">
					<div style="font-weight: 600; color: #374151; margin-bottom: 12px;">🔑 Ustaw nowe hasło</div>
					<input type="email" id="reset-email" placeholder="Email" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<input type="password" id="reset-new-password" placeholder="Nowe hasło (min. 6 znaków)" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<input type="password" id="reset-confirm-password" placeholder="Powtórz hasło" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<button id="reset-btn" style="width: 100%; padding: 8px; background: #059669; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
						Ustaw nowe hasło
					</button>
					<div style="margin-top: 8px; text-align: center;">
						<a id="link-back-to-login" href="#" style="font-size: 12px; color: #059669;">← Wróć do logowania</a>
					</div>
					<div id="reset-error" style="color: #dc2626; font-size: 12px; margin-top: 8px; display: none;"></div>
					<div id="reset-success" style="color: #059669; font-size: 12px; margin-top: 8px; display: none;"></div>
				</div>
				
				<!-- FORMULARZ REJESTRACJI -->
				<div id="register-form" style="display: none;">
					<div style="font-weight: 600; color: #374151; margin-bottom: 12px;">📝 Załóż konto</div>
					<input type="email" id="register-email" placeholder="Email" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<input type="password" id="register-password" placeholder="Hasło (min. 6 znaków)" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<input type="password" id="register-password-confirm" placeholder="Powtórz hasło" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box;" />
					<div style="font-size: 11px; color: #6b7280; margin-bottom: 8px; padding: 8px; background: #f0fdf4; border-left: 3px solid #059669; border-radius: 4px;">
						ℹ️ Nowe konto otrzyma <strong>10 darmowych raportów</strong>
					</div>
					<button id="register-btn" style="width: 100%; padding: 8px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px;">
						Załóż konto
					</button>
					<div id="register-error" style="color: #dc2626; font-size: 12px; margin-top: 8px; display: none;"></div>
					<div id="register-success" style="color: #059669; font-size: 12px; margin-top: 8px; display: none;"></div>
				</div>
			`;

				// Event listeners po załadowaniu DOM
				setTimeout(() => {
					// Przełączniki zakładek
					const tabLogin = document.getElementById('tab-login');
					const tabRegister = document.getElementById('tab-register');
					const loginForm = document.getElementById('login-form');
					const registerForm = document.getElementById('register-form');

					if (tabLogin && tabRegister) {
						tabLogin.addEventListener('click', () => {
							loginForm.style.display = 'block';
							registerForm.style.display = 'none';
							tabLogin.style.background = '#059669';
							tabRegister.style.background = '#6b7280';
						});

						tabRegister.addEventListener('click', () => {
							loginForm.style.display = 'none';
							registerForm.style.display = 'block';
							tabLogin.style.background = '#6b7280';
							tabRegister.style.background = '#2563eb';
						});
					}

					// LOGOWANIE
					const loginBtn = document.getElementById('login-btn');
					const emailInput = document.getElementById('login-email');
					const passwordInput = document.getElementById('login-password');
					const errorDiv = document.getElementById('login-error');

					if (loginBtn && emailInput && passwordInput) {
						loginBtn.addEventListener('click', async () => {
							const email = emailInput.value.trim();
							const password = passwordInput.value;

							if (!email || !password) {
								errorDiv.textContent = 'Wprowadź email i hasło';
								errorDiv.style.display = 'block';
								return;
							}

							loginBtn.textContent = 'Logowanie...';
							loginBtn.disabled = true;
							errorDiv.style.display = 'none';

							const result = await authManager.login(email, password);

							if (result.success) {
								location.reload();
							} else {
								errorDiv.textContent = result.message || 'Błąd logowania';
								errorDiv.style.display = 'block';
								loginBtn.textContent = 'Zaloguj się';
								loginBtn.disabled = false;
							}
						});

						// Logowanie po naciśnięciu Enter
						passwordInput.addEventListener('keypress', (e) => {
							if (e.key === 'Enter') {
								loginBtn.click();
							}
						});
					}

					// Zapomniałem hasła – pokaż formularz resetu
					const linkForgot = document.getElementById('link-forgot-password');
					const linkBackToLogin = document.getElementById('link-back-to-login');
					const resetForm = document.getElementById('reset-form');
					if (linkForgot && linkBackToLogin && resetForm) {
						linkForgot.addEventListener('click', (e) => {
							e.preventDefault();
							loginForm.style.display = 'none';
							registerForm.style.display = 'none';
							resetForm.style.display = 'block';
						});
						linkBackToLogin.addEventListener('click', (e) => {
							e.preventDefault();
							resetForm.style.display = 'none';
							loginForm.style.display = 'block';
							document.getElementById('reset-error').style.display = 'none';
							document.getElementById('reset-success').style.display = 'none';
						});
					}

					// Reset hasła – wyślij do API
					const resetBtn = document.getElementById('reset-btn');
					const resetEmail = document.getElementById('reset-email');
					const resetNewPass = document.getElementById('reset-new-password');
					const resetConfirm = document.getElementById('reset-confirm-password');
					const resetError = document.getElementById('reset-error');
					const resetSuccess = document.getElementById('reset-success');
					if (resetBtn && resetEmail && resetNewPass && resetConfirm) {
						resetBtn.addEventListener('click', async () => {
							const email = resetEmail.value.trim();
							const newPass = resetNewPass.value;
							const confirmPass = resetConfirm.value;
							resetError.style.display = 'none';
							resetSuccess.style.display = 'none';
							if (!email) {
								resetError.textContent = 'Wprowadź email';
								resetError.style.display = 'block';
								return;
							}
							if (newPass.length < 6) {
								resetError.textContent = 'Hasło musi mieć min. 6 znaków';
								resetError.style.display = 'block';
								return;
							}
							if (newPass !== confirmPass) {
								resetError.textContent = 'Hasła nie są identyczne';
								resetError.style.display = 'block';
								return;
							}
							resetBtn.textContent = 'Zapisywanie...';
							resetBtn.disabled = true;
							const result = await authManager.resetPassword(email, newPass);
							resetBtn.textContent = 'Ustaw nowe hasło';
							resetBtn.disabled = false;
							if (result.success) {
								resetSuccess.textContent = result.message || 'Hasło zmienione. Zaloguj się.';
								resetSuccess.style.display = 'block';
								resetEmail.value = '';
								resetNewPass.value = '';
								resetConfirm.value = '';
							} else {
								resetError.textContent = result.message || 'Błąd resetu hasła';
								resetError.style.display = 'block';
							}
						});
					}

					// REJESTRACJA
					const registerBtn = document.getElementById('register-btn');
					const regEmailInput = document.getElementById('register-email');
					const regPasswordInput = document.getElementById('register-password');
					const regPasswordConfirm = document.getElementById('register-password-confirm');
					const regErrorDiv = document.getElementById('register-error');
					const regSuccessDiv = document.getElementById('register-success');

					if (registerBtn && regEmailInput && regPasswordInput && regPasswordConfirm) {
						registerBtn.addEventListener('click', async () => {
							const email = regEmailInput.value.trim();
							const password = regPasswordInput.value;
							const passwordConfirm = regPasswordConfirm.value;

							regErrorDiv.style.display = 'none';
							regSuccessDiv.style.display = 'none';

							// Walidacja
							if (!email || !password || !passwordConfirm) {
								regErrorDiv.textContent = 'Wypełnij wszystkie pola';
								regErrorDiv.style.display = 'block';
								return;
							}

							// Sprawdź czy hasła się zgadzają
							if (password !== passwordConfirm) {
								regErrorDiv.textContent = 'Hasła nie są identyczne';
								regErrorDiv.style.display = 'block';
								return;
							}

							// Sprawdź długość hasła
							if (password.length < 6) {
								regErrorDiv.textContent = 'Hasło musi mieć minimum 6 znaków';
								regErrorDiv.style.display = 'block';
								return;
							}

							registerBtn.textContent = 'Tworzenie konta...';
							registerBtn.disabled = true;

							const result = await authManager.register(email, password);

							if (result.success) {
								regSuccessDiv.textContent = '✅ Konto utworzone! Przekierowuję...';
								regSuccessDiv.style.display = 'block';
								setTimeout(() => {
									location.reload();
								}, 1500);
							} else {
								regErrorDiv.textContent = result.message || 'Błąd rejestracji';
								regErrorDiv.style.display = 'block';
								registerBtn.textContent = 'Załóż konto';
								registerBtn.disabled = false;
							}
						});

						// Rejestracja po naciśnięciu Enter w ostatnim polu
						regPasswordConfirm.addEventListener('keypress', (e) => {
							if (e.key === 'Enter') {
								registerBtn.click();
							}
						});
					}
				}, 100);
			}

			content.appendChild(authSection);

			// Reszta UI (statystyki, przyciski) - tylko dla zalogowanych
			if (authManager.isLoggedIn()) {
				const offersSection = document.createElement('div');
				offersSection.style.cssText = [
					'background: #f9fafb',
					'border: 1px solid #e5e7eb',
					'border-radius: 8px',
					'padding: 12px',
					'margin-bottom: 12px'
				].join(';');

				const sectionTitle1 = document.createElement('div');
				sectionTitle1.style.cssText = 'font-weight: 600; color: #374151; margin-bottom: 8px;';
				sectionTitle1.textContent = '📊 Statystyki';

				const rowQuality = document.createElement('div');
				rowQuality.style.cssText = 'display:flex; justify-content: space-between; align-items:center; margin-bottom: 8px;';
				const qualityLabel = document.createElement('div');
				qualityLabel.textContent = 'Jakość oferty:';
				const qualityValue = document.createElement('div');
				qualityValue.id = 'wt-skan-quality';
				qualityValue.style.cssText = 'color:#374151; font-size: 12px; font-weight: 600;';
				qualityValue.textContent = '—';
				rowQuality.appendChild(qualityLabel);
				rowQuality.appendChild(qualityValue);

				const rowImageQuality = document.createElement('div');
				rowImageQuality.style.cssText = 'display:flex; justify-content: space-between; align-items:center; margin-bottom: 8px;';
				const imageQualityLabel = document.createElement('div');
				imageQualityLabel.textContent = 'Jakość obrazu:';
				const imageQualityValue = document.createElement('div');
				imageQualityValue.id = 'wt-skan-image-quality';
				imageQualityValue.style.cssText = 'color:#374151; font-size: 12px; font-weight: 600;';
				imageQualityValue.textContent = '—';
				rowImageQuality.appendChild(imageQualityLabel);
				rowImageQuality.appendChild(imageQualityValue);

				const rowTime = document.createElement('div');
				rowTime.style.cssText = 'display:flex; justify-content: space-between; align-items:center;';
				const timeLabel = document.createElement('div');
				timeLabel.textContent = 'Ostatnie skanowanie:';
				const timeValue = document.createElement('div');
				timeValue.id = this.lastScanLabelId;
				timeValue.style.cssText = 'color:#374151; font-size: 12px;';
				timeValue.textContent = '—';
				rowTime.appendChild(timeLabel);
				rowTime.appendChild(timeValue);

				offersSection.appendChild(sectionTitle1);
				offersSection.appendChild(rowQuality);
				offersSection.appendChild(rowImageQuality);
				offersSection.appendChild(rowTime);
				content.appendChild(offersSection);

				// Przyciski akcji
				const buttonsSection = document.createElement('div');
				buttonsSection.style.cssText = 'display:flex; flex-direction:column; gap:8px;';

				// ========== PRZYCISK "ODŚWIEŻ DANE" - TYMCZASOWO WYŁĄCZONY ==========
				// Przycisk został ukryty, ponieważ większość danych zbieramy podczas generowania raportu,
				// a odświeżenie strony jest skuteczniejsze niż ponowne skanowanie.
				// ABY WŁĄCZYĆ: Odkomentuj poniższy blok kodu oraz linię "buttonsSection.appendChild(scanBtn);"

				/*
				const scanBtn = this.createButton('🔄 Odśwież dane', '#10b981');
				scanBtn.style.fontSize = '13px';
				scanBtn.addEventListener('click', async () => {
					scanBtn.disabled = true;
					scanBtn.textContent = '⏳ Skanowanie...';
					await this.scanAndRender();
					// Odśwież także licznik raportów
					await this.refreshReportsCount();
					scanBtn.disabled = false;
					scanBtn.textContent = '🔄 Odśwież dane';
					this.showNotification('✅ Dane zaktualizowane!');
				});
				*/
				// ====================================================================

				const reportBtn = this.createButton('📄 Generuj raport PDF', '#2563eb');
				reportBtn.style.fontSize = '13px';
				reportBtn.addEventListener('click', async () => {
					await this.generateReport();
				});

				const feedbackBtn = this.createButton('💬 Daj feedback', '#10b981');
				feedbackBtn.style.fontSize = '13px';
				feedbackBtn.addEventListener('click', () => {
					this.showFeedbackDialog();
				});

				// buttonsSection.appendChild(scanBtn); // ← ZAKOMENTOWANE - przycisk "Odśwież dane" ukryty
				buttonsSection.appendChild(reportBtn);
				buttonsSection.appendChild(feedbackBtn);

				// Sekcja z logami pod przyciskami
				const logosSection = document.createElement('div');
				logosSection.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding: 8px 0;';

				const logo1 = document.createElement('img');
				logo1.src = 'https://i.ibb.co/Q7dHHJ20/Zas-b-4-2x.png';
				logo1.alt = 'Logo';
				logo1.style.cssText = 'width: 35%; height: auto; object-fit: contain; margin-left: 10%;';

				const logo2 = document.createElement('img');
				logo2.src = 'https://vsprint.pl/wp-content/uploads/2024/07/vsprint-logo-kolor-internet.svg';
				logo2.alt = 'vSprint Logo';
				logo2.style.cssText = 'width: 35%; height: auto; object-fit: contain; margin-right: 10%;';

				logosSection.appendChild(logo1);
				logosSection.appendChild(logo2);

				buttonsSection.appendChild(logosSection);
				content.appendChild(buttonsSection);
			} else {
				// Komunikat dla niezalogowanych
				const loginMessage = document.createElement('div');
				loginMessage.style.cssText = [
					'text-align: center',
					'padding: 20px',
					'color: #6b7280',
					'font-style: italic'
				].join(';');
				loginMessage.textContent = 'Zaloguj się, aby korzystać ze skanera';
				content.appendChild(loginMessage);
			}

			root.appendChild(header);
			root.appendChild(content);
			document.body.appendChild(root);
		}

		togglePanel() {
			const content = document.getElementById(this.uiRootId + '-content');
			const icon = document.getElementById(this.uiRootId + '-collapse-icon');
			const root = document.getElementById(this.uiRootId);

			if (!content || !icon || !root) return;

			this.isCollapsed = !this.isCollapsed;

			if (this.isCollapsed) {
				// Zwijanie panelu
				content.style.display = 'none';
				icon.innerHTML = '▲'; // Strzałka w górę (zwinięty)
				icon.title = 'Rozwiń panel';
				root.style.width = 'auto';
				root.style.minWidth = '240px';
				root.style.maxWidth = '300px';

				// Dodaj animację hover dla header gdy zwinięty
				const header = root.firstChild;
				header.style.transition = 'background-color 0.2s ease';
			} else {
				// Rozwijanie panelu
				content.style.display = 'block';
				icon.innerHTML = '▼'; // Strzałka w dół (rozwinięty)
				icon.title = 'Zwiń panel';
				root.style.width = '340px';
				root.style.minWidth = 'auto';
				root.style.maxWidth = 'auto';
			}

			console.log('🔄 Panel', this.isCollapsed ? 'zwinięty' : 'rozwinięty');
		}

		updateImagesUI() {
			const imagesList = document.getElementById('images-list');
			if (!imagesList) return;

			if (this.allImages.length === 0) {
				imagesList.innerHTML = '<div style="color: #6b7280; font-style: italic;">Nie znaleziono obrazów na stronie</div>';
				return;
			}

			let html = `<div style="margin-bottom: 8px; font-weight: 600; color: #374151;">Znaleziono ${this.allImages.length} obrazów:</div>`;

			this.allImages.forEach((img, index) => {
				// Bezpieczne sanityzowanie URL-ów
				const safeSrc = this.sanitizeUrl(img.src);
				const safeAlt = this.escapeHtml(img.alt);
				const shortSrc = safeSrc.length > 60 ? safeSrc.substring(0, 57) + '...' : safeSrc;
				const sizeInfo = img.width > 0 && img.height > 0 ? ` (${img.width}×${img.height})` : '';
				const typeInfo = img.isAllegro ? ' 🎯' : img.isIcon ? ' 🔸' : ' 📷';

				html += `
				<div style="margin-bottom: 6px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 4px; background: ${img.isAllegro ? '#f0f9ff' : '#ffffff'}; display: flex; gap: 8px;">
					<div style="flex-shrink: 0; width: 60px; height: 60px; border: 1px solid #d1d5db; border-radius: 4px; overflow: hidden; background: #f9fafb; display: flex; align-items: center; justify-content: center;">
						<img src="${safeSrc}" 
							 alt="${safeAlt}" 
							 style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: pointer;"
							 onclick="window.open('${safeSrc}', '_blank')"
							 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
						/>
						<div style="display: none; font-size: 10px; color: #6b7280; text-align: center; padding: 4px;">❌<br>Błąd</div>
					</div>
					<div style="flex: 1; min-width: 0;">
						<div style="font-weight: 500; margin-bottom: 2px; color: #374151;">
							${img.index}.${typeInfo} ${safeAlt}${sizeInfo}
						</div>
						<div style="font-size: 9px; color: #9ca3af; margin-bottom: 2px;">
							Pozycja na stronie: ${img.domIndex}
						</div>
						<div style="font-size: 10px; color: #6b7280; margin-bottom: 4px;">
							Domena: ${img.domain} ${img.isVisible ? '✅' : '❌'}
						</div>
						<a href="${safeSrc}" target="_blank" style="color: #2563eb; text-decoration: underline; word-break: break-all; font-size: 10px;">
							${shortSrc}
						</a>
					</div>
				</div>
			`;
			});

			imagesList.innerHTML = html;
		}

		sanitizeUrl(url) {
			if (!url || typeof url !== 'string') return '';

			// Usuń potencjalnie niebezpieczne protokoły
			if (url.toLowerCase().includes('javascript:') ||
				url.toLowerCase().includes('data:text/html') ||
				url.toLowerCase().includes('vbscript:')) {
				return '';
			}

			// Ogranicz długość URL-a
			if (url.length > 2000) {
				return url.substring(0, 2000) + '...';
			}

			return url;
		}

		escapeHtml(text) {
			if (!text || typeof text !== 'string') return '';
			return text
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		}

		createButton(text, bgColor) {
			const btn = document.createElement('button');
			btn.textContent = text;
			btn.style.cssText = [
				'width:100%',  // Zmienione z flex:1 na width:100%
				'background:' + bgColor,
				'color:#fff',
				'border:none',
				'padding:10px 12px',
				'border-radius:8px',
				'cursor:pointer',
				'font-weight:600',
				'transition: opacity 0.2s'
			].join(';');
			btn.onmouseenter = () => { btn.style.opacity = '0.85'; };
			btn.onmouseleave = () => { btn.style.opacity = '1'; };
			return btn;
		}

		// Szybkie skanowanie podstawowych danych (bez otwierania dialogów)
		async scanBasicData() {
			console.log('🚀 Rozpoczynam podstawowe skanowanie...');
			console.log('📄 URL strony:', window.location.href);

			try {
				this.productName = this.getProductName();
				this.offerName = this.getOfferName();
				this.nameMatchStatus = this.compareNames();
				this.getProductRating();
				this.evaluateProductRating();
			} catch (e) {
				console.warn('⚠️ Błąd przy nazwach/ocenach:', e && e.message);
			}

			try {
				await this.checkThumbnail();
			} catch (e) {
				console.warn('⚠️ Błąd przy miniaturach:', e && e.message);
				this.hasThumbnail = false;
			}

			try {
				this.scanAllImages();
			} catch (e) {
				console.warn('⚠️ Błąd przy skanowaniu obrazów:', e && e.message);
				this.allImages = [];
			}

			// RESETUJ FLAGI
			this.hasAllegroSmart = false;
			this.hasBestPriceGuarantee = false;
			this.hasAllegroPay = false;
			this.allegroPayType = '';
			this.allegroPayDetails = '';
			this.trustInfoOpened = false;
			this.parametersOpened = false;

			try {
				this.checkAllegroFeatures();
			} catch (e) {
				console.warn('⚠️ Błąd przy funkcjach Allegro:', e && e.message);
			}

			try {
				this.scanCoinsAndCoupons();
			} catch (e) {
				console.warn('⚠️ Błąd przy monetach/kuponach:', e && e.message);
			}

			try {
				// BEZ otwierania dialogów - to zrobimy przed generowaniem PDF
				this.offerQuality = this.calculateOfferQuality();
				this.lastScanDate = new Date();
			} catch (e) {
				console.warn('⚠️ Błąd przy jakości oferty:', e && e.message);
				this.offerQuality = 0;
				this.lastScanDate = new Date();
			}

			try {
				const timeEl = document.getElementById(this.lastScanLabelId);
				const qualityEl = document.getElementById('wt-skan-quality');
				const imageQualityEl = document.getElementById('wt-skan-image-quality');

				if (timeEl) timeEl.textContent = this.formatDateTime(this.lastScanDate);
				if (qualityEl) qualityEl.textContent = this.offerQuality + '%';
				if (imageQualityEl) {
					const score = this.imageQuality.overallScore || 0;
					imageQualityEl.textContent = score + '%';
					imageQualityEl.style.color = score >= 80 ? '#059669' : score >= 60 ? '#f59e0b' : '#dc2626';
				}

				this.updateImagesUI();
			} catch (e) {
				console.warn('⚠️ Błąd przy aktualizacji UI:', e && e.message);
			}

			console.log('✅ Podstawowe skanowanie zakończone');
		}

		// Pełne skanowanie ze wszystkimi danymi (z otwieraniem dialogów)
		async scanAndRender() {
			console.log('🚀 Rozpoczynam PEŁNE skanowanie...');
			console.log('📄 URL strony:', window.location.href);

			this.productName = this.getProductName();
			this.offerName = this.getOfferName();
			this.nameMatchStatus = this.compareNames();
			this.getProductRating(); // PRZENIESIONE PRZED calculateOfferQuality
			this.evaluateProductRating(); // Ocena jakości ocen produktu
			await this.checkThumbnail(); // Sprawdzenie czy istnieje miniatura
			this.scanAllImages(); // Skanowanie wszystkich obrazów na stronie

			// RESETUJ FLAGI PRZED SPRAWDZENIEM
			this.hasAllegroSmart = false;
			this.hasBestPriceGuarantee = false;
			this.hasAllegroPay = false;
			this.allegroPayType = '';
			this.allegroPayDetails = '';
			this.trustInfoOpened = false; // Resetuj flagę otwartych sekcji
			this.parametersOpened = false; // Resetuj flagę otwartych sekcji
			console.log('🔄 Zresetowano flagi funkcji Allegro i flag otwartych sekcji');

			// Sprawdzenie funkcji Allegro - z opóźnieniem jeśli potrzeba
			this.checkAllegroFeatures();

			this.scanCoinsAndCoupons(); // Skanowanie monet i kuponów
			await this.scanProtectionPolicies(); // Skanowanie polityk ochrony - otwórz, zbierz dane, zamknij okno
			await this.scanProductParameters(); // Skanowanie parametrów - otwórz, zbierz dane, zamknij okno
			this.offerQuality = this.calculateOfferQuality();
			this.lastScanDate = new Date();

			const timeEl = document.getElementById(this.lastScanLabelId);
			const qualityEl = document.getElementById('wt-skan-quality');
			const imageQualityEl = document.getElementById('wt-skan-image-quality');

			if (timeEl) timeEl.textContent = this.formatDateTime(this.lastScanDate);
			if (qualityEl) qualityEl.textContent = this.offerQuality + '%';
			if (imageQualityEl) {
				const score = this.imageQuality.overallScore || 0;
				imageQualityEl.textContent = score + '%';
				imageQualityEl.style.color = score >= 80 ? '#059669' : score >= 60 ? '#f59e0b' : '#dc2626';
			}

			// LOGUJ KOŃCOWE WYNIKI
			console.log('🎯 KOŃCOWE WYNIKI PEŁNEGO SKANOWANIA:');
			console.log('  Allegro Smart:', this.hasAllegroSmart ? '✅ TAK' : '❌ NIE');
			console.log('  Gwarancja najniższej ceny:', this.hasBestPriceGuarantee ? '✅ TAK' : '❌ NIE');
			if (this.hasAllegroPay) {
				const payDetails = this.allegroPayType === 'installments'
					? `✅ TAK (${this.allegroPayDetails})`
					: '✅ TAK (zapłać później)';
				console.log('  Allegro Pay:', payDetails);
			} else {
				console.log('  Allegro Pay: ❌ NIE');
			}
			console.log('  Smart! Monety:', this.hasCoins ? `✅ ${this.coinsAmount} monet` : '❌ BRAK');
			console.log('  Kupony rabatowe:', this.hasCoupons ? `✅ ${this.couponsCount} kuponów` : '❌ BRAK');
			console.log('  Jakość oferty:', this.offerQuality + '%');

			// Zaktualizuj UI z listą obrazów
			this.updateImagesUI();
			console.log('✅ PEŁNE skanowanie zakończone - wszystkie dane zebrane');
		}

		checkAllegroFeatures() {
			console.log('🎯 Sprawdzam funkcje Allegro...');

			// Znajdź WŁAŚCIWĄ sekcję cenową
			const mainPriceSection = this.findMainPriceSection();
			if (!mainPriceSection) {
				console.log('❌ Nie znaleziono odpowiedniej sekcji cenowej - próbuję ponownie za 3s...');
				setTimeout(() => this.retryAllegroFeatures(), 3000);
				return;
			}

			const allMryxSections = document.querySelectorAll('div.mryx_16');
			const selectedIdx = Array.from(allMryxSections).indexOf(mainPriceSection);
			if (selectedIdx >= 0) {
				const s = mainPriceSection;
				const hasInner = !!s.querySelector('div._7030e_qVLm-');
				const hasImages = s.querySelectorAll('img').length > 0;
				console.log(`🔍 Sekcja cenowa: ${allMryxSections.length} sekcji mryx_16, wybrano #${selectedIdx + 1} (wewnętrzna=${hasInner}, obrazy=${hasImages})`);
			}

			// Pierwsza próba - natychmiast
			console.log('🔍 === ROZPOCZYNAM SPRAWDZENIE FUNKCJI ===');
			this.checkAllegroSmart();
			console.log('🎯 Po sprawdzeniu Smart:', this.hasAllegroSmart);

			this.checkBestPriceGuarantee();
			console.log('💰 Po sprawdzeniu Gwarancji:', this.hasBestPriceGuarantee);

			this.checkAllegroPay();
			console.log('💳 Po sprawdzeniu Pay:', this.hasAllegroPay);

			// Podsumowanie pierwszej próby
			const hasAnyFeature = this.hasAllegroSmart || this.hasBestPriceGuarantee || this.hasAllegroPay;
			console.log('📊 PIERWSZA PRÓBA - znaleziono funkcje:', hasAnyFeature);
			console.log('  Smart:', this.hasAllegroSmart, '| Gwarancja:', this.hasBestPriceGuarantee, '| Pay:', this.hasAllegroPay);

			if (!hasAnyFeature) {
				console.log('⏳ Nie znaleziono funkcji Allegro, próbuję ponownie za 2s...');
				setTimeout(() => this.retryAllegroFeatures(), 2000);
			} else {
				console.log('✅ Znaleziono funkcje Allegro w pierwszej próbie');
			}
		}

		debugDumpPriceSection() {
			console.log('🔍 === DEBUG: SEKCJA CENOWA ===');
			console.log('📄 URL:', window.location.href.substring(0, 80) + '...');

			const mainPriceSection = this.findMainPriceSection();
			if (!mainPriceSection) {
				console.log('❌ BRAK WŁAŚCIWEJ SEKCJI CENOWEJ');

				// Sprawdź alternatywne selektory
				const alternatives = [
					'[data-box-name*="summary"]',
					'.opbox-sheet',
					'[data-prototype-id*="showoffer"]'
				];

				console.log('🔍 Sprawdzam alternatywne selektory:');
				alternatives.forEach(selector => {
					const found = document.querySelector(selector);
					console.log(`  ${selector}: ${!!found}`);
				});
				return;
			}

			console.log('✅ Znaleziono właściwą sekcję cenową');
			console.log('📏 Rozmiar HTML:', mainPriceSection.innerHTML.length, 'znaków');
			console.log('🖼️ Obrazy w sekcji:', mainPriceSection.querySelectorAll('img').length);
			console.log('🔗 Linki w sekcji:', mainPriceSection.querySelectorAll('a').length);
			console.log('📊 Elementy z data-analytics:', mainPriceSection.querySelectorAll('[data-analytics-view-value], [data-analytics-view-label]').length);

			// Sprawdź wewnętrzną sekcję
			const innerSection = mainPriceSection.querySelector('div._7030e_qVLm-');
			console.log('🎯 Wewnętrzna sekcja _7030e_qVLm-:', !!innerSection);

			// Sprawdź czy to nie bundle
			const hasBundle = mainPriceSection.innerHTML.includes('bundle_id');
			console.log('📦 Czy to sekcja bundle:', hasBundle);

			console.log('🔍 === KONIEC DEBUG ===');
		}

		retryAllegroFeatures() {
			console.log('🔄 Ponowne sprawdzenie funkcji Allegro...');

			// Sprawdź ponownie czy sekcja istnieje
			const mainPriceSection = this.findMainPriceSection();
			if (!mainPriceSection) {
				console.log('❌ Nadal brak sekcji cenowej - próbuję jeszcze raz za 3s...');
				setTimeout(() => this.finalRetryAllegroFeatures(), 3000);
				return;
			}

			console.log('✅ Sekcja cenowa znaleziona, sprawdzam funkcje...');

			this.checkAllegroSmart();
			this.checkBestPriceGuarantee();
			this.checkAllegroPay();

			// Jeśli nadal nic nie znaleziono, spróbuj ostatni raz
			const hasAnyFeature = this.hasAllegroSmart || this.hasBestPriceGuarantee || this.hasAllegroPay;
			if (!hasAnyFeature) {
				console.log('⏳ Nadal brak funkcji Allegro, ostatnia próba za 5s...');
				setTimeout(() => this.finalRetryAllegroFeatures(), 5000);
			} else {
				console.log(`🔄 Zakończono ponowne sprawdzenie - znaleziono funkcje Allegro`);
			}

			// Aktualizuj jakość po ponownym sprawdzeniu
			this.offerQuality = this.calculateOfferQuality();
			const qualityEl = document.getElementById('wt-skan-quality');
			if (qualityEl) {
				qualityEl.textContent = this.offerQuality + '%';
			}
		}

		findMainPriceSection() {
			// Znajdź WŁAŚCIWĄ sekcję cenową - nie bundle/pakiety
			let mainPriceSection = null;

			const allMryxSections = document.querySelectorAll('div.mryx_16');

			// METODA 1: Szukaj sekcji z wewnętrzną strukturą i obrazami, ale bez bundle
			for (let i = 0; i < allMryxSections.length; i++) {
				const section = allMryxSections[i];
				const hasInnerSection = section.querySelector('div._7030e_qVLm-');
				const hasImages = section.querySelectorAll('img').length > 0;
				const hasBundle = section.innerHTML.includes('bundle_id');

				if (hasInnerSection && hasImages && !hasBundle) {
					mainPriceSection = section;
					break;
				}
			}

			// METODA 2: Sekcja z obrazami, ale bez bundle
			if (!mainPriceSection) {
				for (let i = 0; i < allMryxSections.length; i++) {
					const section = allMryxSections[i];
					const hasImages = section.querySelectorAll('img').length > 0;
					const hasBundle = section.innerHTML.includes('bundle_id');

					if (hasImages && !hasBundle) {
						mainPriceSection = section;
						break;
					}
				}
			}

			// METODA 3: Pierwsza sekcja bez bundle
			if (!mainPriceSection) {
				for (let i = 0; i < allMryxSections.length; i++) {
					const section = allMryxSections[i];
					const hasBundle = section.innerHTML.includes('bundle_id');

					if (!hasBundle) {
						mainPriceSection = section;
						break;
					}
				}
			}

			return mainPriceSection;
		}

		finalRetryAllegroFeatures() {
			console.log('🔄 OSTATNIA próba sprawdzenia funkcji Allegro...');

			// Sprawdź ponownie czy sekcja istnieje
			const mainPriceSection = this.findMainPriceSection();
			if (!mainPriceSection) {
				console.log('❌ Brak sekcji cenowej - kończę próby sprawdzenia funkcji Allegro');
				return;
			}

			console.log('✅ Sekcja cenowa znaleziona, ostatnia próba sprawdzenia funkcji...');

			this.checkAllegroSmart();
			this.checkBestPriceGuarantee();
			this.checkAllegroPay();

			// Aktualizuj jakość po ostatecznym sprawdzeniu
			this.offerQuality = this.calculateOfferQuality();
			const qualityEl = document.getElementById('wt-skan-quality');
			if (qualityEl) {
				qualityEl.textContent = this.offerQuality + '%';
			}

			const hasAnyFeature = this.hasAllegroSmart || this.hasBestPriceGuarantee || this.hasAllegroPay;
			console.log(`🔄 KOŃCOWY wynik sprawdzenia funkcji Allegro: ${hasAnyFeature ? 'ZNALEZIONO' : 'BRAK'}`);
			if (hasAnyFeature) {
				console.log(`   ✅ Allegro Smart: ${this.hasAllegroSmart ? 'TAK' : 'NIE'}`);
				console.log(`   ✅ Gwarancja najniższej ceny: ${this.hasBestPriceGuarantee ? 'TAK' : 'NIE'}`);
				if (this.hasAllegroPay) {
					const payInfo = this.allegroPayType === 'installments'
						? `TAK (${this.allegroPayDetails})`
						: 'TAK (zapłać później)';
					console.log(`   ✅ Allegro Pay: ${payInfo}`);
				} else {
					console.log(`   ✅ Allegro Pay: NIE`);
				}
			}
		}

		// Metoda updateNamesSectionColor usunięta - nie potrzebna w minimalnym panelu

		getProductName() {
			// Szukamy nazwy produktu w różnych możliwych selektorach
			const selectors = [
				// Selektor z przykładu użytkownika
				'a[href*="/oferty-produktu/"] span[itemprop="name"]',
				// Alternatywne selektory
				// Alternatywne selektory z konkretną klasą (bardziej specyficzne)
				'a[href*="/oferty-produktu/"] span.meqh_en.m6ax_n4.msa3_z4',
				'a[href*="/oferty-produktu/"] span.meqh_en',
				'a[href*="/oferty-produktu/"] span',
				// Breadcrumbs - często zawierają nazwę produktu
				'nav[aria-label="breadcrumb"] li:last-child span',
				'ol[itemtype="http://schema.org/BreadcrumbList"] li:last-child span'
			];

			for (const selector of selectors) {
				const element = document.querySelector(selector);
				if (element && element.textContent) {
					return element.textContent.trim();
				}
			}

			// Jeśli nie znaleziono, spróbuj znaleźć link do oferty produktu
			const productLink = document.querySelector('a[href*="/oferty-produktu/"]');
			if (productLink) {
				const span = productLink.querySelector('span');
				if (span && span.textContent) {
					return span.textContent.trim();
				}
				// Jeśli nie ma span, weź tekst z samego linku
				if (productLink.textContent) {
					return productLink.textContent.trim();
				}
			}

			return '';
		}

		getOfferName() {
			// Szukamy nazwy oferty (nagłówek h1 na stronie oferty)
			const selectors = [
				// Główny selektor - nagłówek h1 (najbardziej specyficzny z przykładu)
				'h1.mp4t_0.mryx_0.mj7a_4.mvrt_8.mp0t_ji.m9qz_yo.munh_0.mqu1_1j.mgmw_wo.mgn2_21.mgn2_25_s',
				// Alternatywne selektory dla różnych wersji strony
				'h1.mp4t_0',
				'h1[itemprop="name"]',
				'h1',
				// Meta tag z nazwą
				'meta[property="og:title"]',
				'meta[name="twitter:title"]'
			];

			for (const selector of selectors) {
				const element = document.querySelector(selector);
				if (element) {
					if (element.tagName === 'META') {
						const content = element.getAttribute('content');
						if (content) return content.trim();
					} else if (element.textContent) {
						return element.textContent.trim();
					}
				}
			}

			// Jeśli to strona listingu, może nie być konkretnej nazwy oferty
			// Spróbuj pobrać tytuł strony
			if (document.title && !document.title.includes('Allegro.pl')) {
				return document.title.replace(' - Allegro.pl', '').trim();
			}

			return '';
		}

		compareNames() {
			// Szczegółowa analiza zgodności nazw produktu i oferty
			if (!this.productName || !this.offerName) {
				this.nameAnalysis = {
					wordsMatch: 0,
					lengthMatch: 0,
					matchingWords: 0,
					totalWords: 0,
					lengthDifference: 0
				};
				return 'unknown';
			}

			// Wykrywanie konfliktów numerycznych (np. 6/128 vs 16/128, 6 GB vs 16 GB)
			const productNumbers = this._extractSpecNumbers(this.productName);
			const offerNumbers = this._extractSpecNumbers(this.offerName);
			for (const key of Object.keys(productNumbers)) {
				const pVal = productNumbers[key];
				const oVal = offerNumbers[key];
				if (pVal != null && oVal != null && pVal !== oVal) {
					this.nameAnalysis = {
						wordsMatch: 0,
						lengthMatch: 0,
						matchingWords: 0,
						totalWords: 0,
						lengthDifference: 0
					};
					return 'mismatch';
				}
			}

			// Normalizacja tekstów do porównania
			const normalizeText = (text) => {
				return text.toLowerCase()
					.replace(/[^\w\sąćęłńóśźż]/g, ' ') // Zachowaj polskie znaki
					.replace(/\s+/g, ' ')
					.trim();
			};

			const productNormalized = normalizeText(this.productName);
			const offerNormalized = normalizeText(this.offerName);

			// 1. ANALIZA ZGODNOŚCI DŁUGOŚCI
			const productLength = productNormalized.length;
			const offerLength = offerNormalized.length;
			const lengthDifference = Math.abs(productLength - offerLength);
			const maxLength = Math.max(productLength, offerLength);
			const lengthMatch = maxLength > 0 ? Math.round((1 - lengthDifference / maxLength) * 100) : 0;

			// 2. ANALIZA ZGODNOŚCI SŁÓW
			const productWords = productNormalized.split(' ').filter(word => word.length > 2);
			const offerWords = offerNormalized.split(' ').filter(word => word.length > 2);
			const allWords = [...new Set([...productWords, ...offerWords])]; // Unikalne słowa

			let matchingWords = 0;

			// Sprawdź każde słowo z nazwy produktu
			for (const word of productWords) {
				if (offerWords.some(offerWord =>
					offerWord.includes(word) ||
					word.includes(offerWord) ||
					this.calculateWordSimilarity(word, offerWord) > 0.8
				)) {
					matchingWords++;
				}
			}

			// Oblicz procent zgodności słów
			const wordsMatch = productWords.length > 0 ?
				Math.round((matchingWords / productWords.length) * 100) : 0;

			// Zapisz szczegółowe dane analizy
			this.nameAnalysis = {
				wordsMatch: wordsMatch,
				lengthMatch: lengthMatch,
				matchingWords: matchingWords,
				totalWords: productWords.length,
				lengthDifference: lengthDifference
			};

			// 3. OGÓLNA OCENA NA PODSTAWIE SZCZEGÓŁOWYCH DANYCH
			// Identyczne nazwy
			if (productNormalized === offerNormalized) {
				return 'match';
			}

			// Jedna nazwa zawarta w drugiej
			if (productNormalized.includes(offerNormalized) ||
				offerNormalized.includes(productNormalized)) {
				return 'match';
			}

			// Ocena na podstawie procentów zgodności
			const avgMatch = (wordsMatch + lengthMatch) / 2;
			if (avgMatch >= 70) {
				return 'match';
			} else if (avgMatch >= 40) {
				return 'partial'; // Nowy status dla częściowej zgodności
			} else {
				return 'mismatch';
			}
		}

		_extractSpecNumbers(text) {
			if (!text) return {};
			const out = {};
			const str = String(text);
			
			// Ignoruj przekątną ekranu (np. 6.5", 6,5 cala, 6.56") - może być mylona z RAM
			const diagonalPattern = /\d+[.,]\d+\s*(""|cala|inch)/i;
			if (diagonalPattern.test(str)) {
				// Jeśli tekst zawiera przekątną, usuń ją przed dalszą analizą
				const textWithoutDiagonal = str.replace(/\d+[.,]\d+\s*(""|cala|inch)/gi, '');
				return this._extractSpecNumbers(textWithoutDiagonal);
			}
			
			// RAM / pamięć: "6 GB / 128 GB", "16/128", "6/128 GB"
			const ramStoragePattern = /(\d+)\s*(?:gb|g)?\s*[\/\-]\s*(\d+)\s*(?:gb|g)?/i;
			const ramMatch = str.match(ramStoragePattern);
			if (ramMatch) {
				out.ram = parseInt(ramMatch[1], 10);
				out.storage = parseInt(ramMatch[2], 10);
			}
			
			// Pojedyncze RAM: "6 GB RAM", "6GB RAM"
			const singleRamPattern = /(\d+)\s*gb\s+ram/i;
			const singleRam = str.match(singleRamPattern);
			if (singleRam && !out.ram) out.ram = parseInt(singleRam[1], 10);
			
			// Pojedyncza pamięć: "128 GB" (ale nie jeśli to RAM)
			const singleStoragePattern = /(\d+)\s*gb(?!\s*ram)/i;
			const singleStorage = str.match(singleStoragePattern);
			if (singleStorage && !out.storage && !out.ram) {
				out.storage = parseInt(singleStorage[1], 10);
			}
			
			return out;
		}

		calculateWordSimilarity(word1, word2) {
			// Prosta analiza podobieństwa słów (Levenshtein distance)
			if (word1.length === 0) return word2.length === 0 ? 1 : 0;
			if (word2.length === 0) return 0;

			const matrix = [];
			for (let i = 0; i <= word2.length; i++) {
				matrix[i] = [i];
			}
			for (let j = 0; j <= word1.length; j++) {
				matrix[0][j] = j;
			}

			for (let i = 1; i <= word2.length; i++) {
				for (let j = 1; j <= word1.length; j++) {
					if (word2.charAt(i - 1) === word1.charAt(j - 1)) {
						matrix[i][j] = matrix[i - 1][j - 1];
					} else {
						matrix[i][j] = Math.min(
							matrix[i - 1][j - 1] + 1,
							matrix[i][j - 1] + 1,
							matrix[i - 1][j] + 1
						);
					}
				}
			}

			const maxLength = Math.max(word1.length, word2.length);
			return (maxLength - matrix[word2.length][word1.length]) / maxLength;
		}

		calculateOfferQuality() {
			let quality = 0;
			let factors = 0;

			// Zgodność nazw (waga: 40%)
			if (this.nameMatchStatus === 'match') {
				quality += 40;
				factors++;
			} else if (this.nameMatchStatus === 'unknown') {
				quality += 20;
				factors++;
			}

			// Ocena produktu (waga: 60%)
			if (this.productRating > 0) {
				if (this.productRating < 4.00) {
					quality += 0; // Ocena poniżej 4.00 = 0%
				} else if (this.productRating >= 4.00 && this.productRating <= 4.60) {
					quality += 30; // Ocena 4.00-4.60 = 50% z 60%
				} else if (this.productRating >= 4.61 && this.productRating <= 4.99) {
					quality += 57; // Ocena 4.61-4.99 = 95% z 60%
				} else if (this.productRating >= 5.00) {
					quality += 60; // Ocena 5.00 = 100% z 60%
				}
				factors++;
			}

			// Jeśli brak danych, zwróć 50%
			return factors > 0 ? Math.round(quality) : 50;
		}

		getProductRating() {
			console.log('🔍 Rozpoczynam pobieranie ocen produktu...');

			// METODA 1: Próba pobrania z atrybutów data- (najbardziej stabilne)
			const ratingLink = document.querySelector('a[data-analytics-view-label="productRating"]');
			if (ratingLink) {
				console.log('✅ Znaleziono link z oceną');

				// Pobieranie oceny z data-analytics-view-custom-rating-value
				const ratingValue = ratingLink.getAttribute('data-analytics-view-custom-rating-value');
				if (ratingValue) {
					this.productRating = parseFloat(ratingValue) || 0;
					console.log('✅ Pobrano ocenę z data-:', this.productRating);
				}

				// Pobieranie liczby ocen z data-analytics-view-custom-rating-count
				const ratingCountValue = ratingLink.getAttribute('data-analytics-view-custom-rating-count');
				if (ratingCountValue) {
					this.ratingCount = parseInt(ratingCountValue) || 0;
					console.log('✅ Pobrano liczbę ocen z data-:', this.ratingCount);
				}
			}

			// METODA 2: Jeśli data- nie zadziałały, spróbuj itemprop
			if (this.productRating === 0 || this.ratingCount === 0) {
				console.log('🔄 Próba pobrania z itemprop...');

				const aggregateRating = document.querySelector('[itemprop="aggregateRating"]');
				if (aggregateRating) {
					// Pobieranie oceny z meta itemprop="ratingValue"
					const ratingMeta = aggregateRating.querySelector('meta[itemprop="ratingValue"]');
					if (ratingMeta && !this.productRating) {
						this.productRating = parseFloat(ratingMeta.getAttribute('content')) || 0;
						console.log('✅ Pobrano ocenę z itemprop:', this.productRating);
					}

					// Pobieranie liczby ocen z meta itemprop="ratingCount"
					const countMeta = aggregateRating.querySelector('meta[itemprop="ratingCount"]');
					if (countMeta && !this.ratingCount) {
						this.ratingCount = parseInt(countMeta.getAttribute('content')) || 0;
						console.log('✅ Pobrano liczbę ocen z itemprop:', this.ratingCount);
					}
				}
			}

			// METODA 3: Pobieranie liczby recenzji z tekstu (jeśli nie ma w data-)
			if (this.reviewCount === 0) {
				console.log('🔄 Próba pobrania liczby recenzji z tekstu...');

				// Szukamy tekstu zawierającego "recenzj"
				const allSpans = document.querySelectorAll('span');
				for (const span of allSpans) {
					if (span.textContent && span.textContent.includes('recenzj')) {
						const text = span.textContent.trim();
						console.log('📝 Znaleziono tekst z recenzjami:', text);

						// Wyodrębnianie liczby recenzji
						const reviewsMatch = text.match(/(\d+)\s*recenzj(?:i|a)/);
						if (reviewsMatch) {
							this.reviewCount = parseInt(reviewsMatch[1]);
							console.log('✅ Pobrano liczbę recenzji z tekstu:', this.reviewCount);
							break;
						}
					}
				}
			}

			// Jeśli nadal brak danych, spróbuj klasyczne selektory CSS
			if (this.productRating === 0 || this.ratingCount === 0) {
				console.log('🔄 Próba klasycznych selektorów CSS...');

				// Pobieranie oceny z span.mgmw_wo.m3h2_4
				const ratingElement = document.querySelector('span.mgmw_wo.m3h2_4');
				if (ratingElement && ratingElement.textContent && !this.productRating) {
					this.productRating = parseFloat(ratingElement.textContent.trim().replace(',', '.')) || 0;
					console.log('✅ Pobrano ocenę z CSS:', this.productRating);
				}
			}

			console.log('📊 Końcowe dane:', {
				ocena: this.productRating,
				liczbaOcen: this.ratingCount,
				liczbaRecenzji: this.reviewCount
			});
		}

		evaluateProductRating() {
			console.log('📊 Oceniam jakość ocen produktu...');

		// OCENA WARTOŚCI OCENY (RATING VALUE)
		if (this.productRating > 0) {
			if (this.productRating < 4.0) {
				this.ratingValueEvaluation = {
					rating: '❌ Do poprawy',
					color: '#dc2626', // czerwony
					backgroundColor: '#fee2e2',
					score: 0,
					recommendation: 'Pilnie rozpocznij kontakt z kupującymi, przeanalizuj co mówią o twoim produkcie, sprawdź czy możesz poprawić jego jakość lub nadrobić to jakością obsługi'
				};
				console.log(`   Wartość oceny: ${this.productRating.toFixed(2)} - ❌ Do poprawy`);
			} else if (this.productRating >= 4.0 && this.productRating < 4.6) {
				this.ratingValueEvaluation = {
					rating: '👍 Dobrze',
					color: '#eab308', // żółty
					backgroundColor: '#fef9c3',
					score: 60,
					recommendation: 'Przeanalizuj co kupujący mówią o twoim produkcie, sprawdź czy możesz poprawić jego jakość lub nadrobić to jakością obsługi'
				};
				console.log(`   Wartość oceny: ${this.productRating.toFixed(2)} - 👍 Dobrze`);
			} else if (this.productRating >= 4.6 && this.productRating < 4.8) {
				this.ratingValueEvaluation = {
					rating: '✅ Bardzo dobrze',
					color: '#10b981', // jasny zielony
					backgroundColor: '#d1fae5',
					score: 80,
					recommendation: 'Super! Masz dobre opinie, tak trzymaj!'
				};
				console.log(`   Wartość oceny: ${this.productRating.toFixed(2)} - ✅ Bardzo dobrze`);
			} else { // >= 4.8
				this.ratingValueEvaluation = {
					rating: '🌟 Wzorowo',
					color: '#059669', // ciemny zielony
					backgroundColor: '#d1fae5',
					score: 100,
					recommendation: 'PERFEKCYJNIE! Masz idealne opinie, tak trzymaj!'
				};
				console.log(`   Wartość oceny: ${this.productRating.toFixed(2)} - 🌟 Wzorowo`);
			}
		} else {
			this.ratingValueEvaluation = {
				rating: '⚠️ Brak oceny',
				color: '#dc2626',
				backgroundColor: '#fee2e2',
				score: 0,
				recommendation: 'Produkt nie ma jeszcze ocen. Zacznij sprzedawać i zbieraj opinie od kupujących.'
			};
			console.log('   Wartość oceny: Brak');
		}

		// OCENA LICZBY OCEN (RATING COUNT)
		if (this.ratingCount > 0) {
			if (this.ratingCount >= 1 && this.ratingCount < 10) {
				this.ratingCountEvaluation = {
					rating: '👍 Dobrze',
					color: '#eab308', // żółty
					backgroundColor: '#fef9c3',
					score: 40,
					recommendation: 'Tak trzymaj, ale postaraj się zdobyć więcej opinii'
				};
				console.log(`   Liczba ocen: ${this.ratingCount} - 👍 Dobrze`);
			} else if (this.ratingCount >= 10 && this.ratingCount < 100) {
				this.ratingCountEvaluation = {
					rating: '✅ Bardzo dobrze',
					color: '#10b981', // jasny zielony
					backgroundColor: '#d1fae5',
					score: 70,
					recommendation: 'Świetnie! Tak trzymaj, ale zawsze możesz zdobyć więcej opinii'
				};
				console.log(`   Liczba ocen: ${this.ratingCount} - ✅ Bardzo dobrze`);
			} else { // >= 100
				this.ratingCountEvaluation = {
					rating: '🌟 Wzorowo',
					color: '#059669', // ciemny zielony
					backgroundColor: '#d1fae5',
					score: 100,
					recommendation: 'Super! Masz dużo opinii, tak trzymaj!'
				};
				console.log(`   Liczba ocen: ${this.ratingCount} - 🌟 Wzorowo`);
			}
		} else {
			this.ratingCountEvaluation = {
				rating: '❌ Zadbaj o pierwszą ocenę',
				color: '#dc2626',
				backgroundColor: '#fee2e2',
				score: 0,
				recommendation: 'Produkt nie ma jeszcze ocen. Zacznij sprzedawać i zbieraj opinie od kupujących.'
			};
			console.log('   Liczba ocen: Brak');
		}

		// OCENA LICZBY RECENZJI (REVIEW COUNT)
		if (this.reviewCount > 0) {
			if (this.reviewCount >= 1 && this.reviewCount < 10) {
				this.reviewCountEvaluation = {
					rating: '✅ Bardzo dobrze',
					color: '#10b981', // jasny zielony
					backgroundColor: '#d1fae5',
					score: 70,
					recommendation: 'Świetnie! Masz recenzje, tak trzymaj!'
				};
				console.log(`   Liczba recenzji: ${this.reviewCount} - ✅ Bardzo dobrze`);
			} else { // >= 10
				this.reviewCountEvaluation = {
					rating: '🌟 Wzorowo',
					color: '#059669', // ciemny zielony
					backgroundColor: '#d1fae5',
					score: 100,
					recommendation: 'Super! Masz dużo recenzji, tak trzymaj!'
				};
				console.log(`   Liczba recenzji: ${this.reviewCount} - 🌟 Wzorowo`);
			}
		} else {
			this.reviewCountEvaluation = {
				rating: '❌ Zadbaj o pierwszą recenzję',
				color: '#dc2626',
				backgroundColor: '#fee2e2',
				score: 0,
				recommendation: 'Produkt nie ma jeszcze recenzji. Zachęcaj kupujących do wystawiania recenzji z opinią.'
			};
			console.log('   Liczba recenzji: Brak');
		}

		console.log('✅ Ocena jakości ocen produktu zakończona');
		}

	async checkThumbnail() {
		console.log('🖼️ Sprawdzam czy istnieje miniatura obrazu...');

		let foundImage = null;

		// METODA 1: Kontener produktu Allegro (najbardziej precyzyjne – miniatura oferty)
		console.log('🔍 Szukam głównego obrazu produktu (kontener produktu)...');
		const productContainerSelector = '.mp7g_f6.mq1m_0.mj7u_0.mpof_ki.m7er_k4.mr0s_7s.mdwt_en._07951_LNfmY';
		const productContainer = document.querySelector(productContainerSelector);
		if (productContainer) {
			console.log('✅ Znaleziono kontener produktu');
			foundImage = productContainer.querySelector('img');
			if (!foundImage) foundImage = productContainer.querySelector('div img');
			if (!foundImage) foundImage = productContainer.querySelector('img[src*="/s512/"]');
			if (foundImage) console.log('✅ Znaleziono główny obraz produktu w kontenerze:', foundImage.src);
		}

		// METODA 2: Szukanie po typowych rozmiarach Allegro (/s512/, /s1024/, /s800/)
		if (!foundImage) {
			console.log('🔄 Próba znalezienia obrazu po rozmiarach Allegro...');

			const allegroImages = document.querySelectorAll('img[src*="/s512/"], img[src*="/s1024/"], img[src*="/s800/"]');

			for (const img of allegroImages) {
				if (img.src && img.src.includes('a.allegroimg.com') &&
					!img.src.includes('logo') && !img.src.includes('icon') &&
					!img.src.includes('banner') && !img.src.includes('ad') &&
					!img.src.includes('thank-you-page') && !img.src.includes('placeholder') &&
					!img.src.includes('metrum-placeholder') && !img.src.includes('wosp') &&
					!img.src.includes('charity') && !img.src.includes('badge')) {

					// Sprawdź czy to nie jest zbyt mały obraz (pominięcie ikon)
					if (img.naturalWidth > 100 && img.naturalHeight > 100) {
						foundImage = img;
						console.log('✅ Znaleziono główny obraz produktu po rozmiarach:', img.src);
						break;
					}
				}
			}
		}

		// METODA 3: Szukanie po domenie allegroimg.com (ogólne)
		if (!foundImage) {
			console.log('🔄 Próba znalezienia obrazu po domenie allegroimg.com...');
			const allImages = document.querySelectorAll('img');
			for (const img of allImages) {
				if (img.src && img.src.includes('a.allegroimg.com') &&
					!img.src.includes('logo') && !img.src.includes('icon') &&
					!img.src.includes('banner') && !img.src.includes('ad') &&
					!img.src.includes('thank-you-page') && !img.src.includes('placeholder') &&
					!img.src.includes('metrum-placeholder') && !img.src.includes('wosp') &&
					!img.src.includes('charity') && !img.src.includes('badge')) {
					if (img.naturalWidth > 100 && img.naturalHeight > 100) {
						foundImage = img;
						console.log('✅ Znaleziono główny obraz produktu po domenie:', img.src);
						break;
					}
				}
			}
		}

		// METODA 4: Szukanie elementu z aria-current="true" (zapasowa) – z walidacją URL
		if (!foundImage) {
			console.log('🔄 Próba znalezienia elementu z aria-current="true"...');
			const mainThumbnail = document.querySelector('[aria-current="true"]');
			if (mainThumbnail) {
				let candidate = mainThumbnail.tagName === 'IMG' ? mainThumbnail : mainThumbnail.querySelector('img');
				if (candidate && candidate.src && candidate.src.includes('a.allegroimg.com') &&
					(candidate.src.includes('/s512/') || candidate.src.includes('/s1024/') || candidate.src.includes('/s800/')) &&
					!candidate.src.includes('logo') && !candidate.src.includes('icon') &&
					!candidate.src.includes('badge') && !candidate.src.includes('smart')) {
					foundImage = candidate;
					console.log('✅ Znaleziono główny obraz miniatury w elemencie z aria-current="true"');
				} else if (candidate) {
					console.log('⚠️ Odrzucono obraz z aria-current (nie miniatura oferty)');
				}
			}
		}

		// METODA 5: Szukanie elementu z klasami aktywności
		if (!foundImage) {
			console.log('🔄 Próba znalezienia elementu z klasą aktywności...');
			let mainThumbnailContainer = document.querySelector('.carousel-item.active') ||
				document.querySelector('.carousel-item.is-active') ||
				document.querySelector('.carousel-item.selected');
			if (mainThumbnailContainer) {
				const mainImage = mainThumbnailContainer.querySelector('img');
				if (mainImage) {
					foundImage = mainImage;
					console.log('✅ Znaleziono główny obraz miniatury w kontenerze z klasą aktywności');
				}
			}
		}

		// METODA 6: Szukanie pierwszego elementu .carousel-item z obrazkiem
		if (!foundImage) {
			console.log('🔄 Próba znalezienia pierwszego elementu karuzeli...');
			const firstCarouselItem = document.querySelector('.carousel-item:first-child');
			if (firstCarouselItem) {
				const mainImage = firstCarouselItem.querySelector('img');
				if (mainImage) {
					foundImage = mainImage;
					console.log('✅ Znaleziono obraz miniatury w pierwszym elemencie karuzeli');
				}
			}
		}

		// METODA 7: Szukanie pierwszego obrazka na stronie (ostatnia szansa)
		if (!foundImage) {
			console.log('🔄 Próba znalezienia pierwszego obrazka na stronie...');
			const firstImage = document.querySelector('img');
			if (firstImage && firstImage.src && !firstImage.src.includes('logo') && !firstImage.src.includes('icon')) {
				foundImage = firstImage;
				console.log('✅ Znaleziono pierwszy obrazek (prawdopodobnie miniatura)');
			}
		}

		// Jeśli znaleziono obrazek, pobierz jego dane
		if (foundImage) {
			this.hasThumbnail = true;
			await this.analyzeThumbnail(foundImage);
		} else {
			this.hasThumbnail = false;
			console.log('❌ Nie znaleziono żadnego obrazka miniatury');
		}

		console.log('🖼️ Wynik sprawdzenia miniatury:', this.hasThumbnail ? 'TAK' : 'NIE');
	}

		scanAllImages() {
			console.log('🔍 Szukam wszystkich obrazów na stronie...');

			this.allImages = [];
			const allImageElements = document.querySelectorAll('img');
			const seenUrls = new Set(); // Zbiór do śledzenia już widzianych URL-i
			let filteredBySize = 0;
			let filteredByDuplicate = 0;
			let displayIndex = 1; // Licznik dla wyświetlanej pozycji na liście

			console.log(`📊 Znaleziono ${allImageElements.length} elementów <img>`);

			allImageElements.forEach((img, domIndex) => {
				if (img.src && img.src.trim() !== '') {
					// Filtruj nieprawidłowe URL-e (data:, blob:, javascript:, itp.)
					if (img.src.startsWith('data:') ||
						img.src.startsWith('blob:') ||
						img.src.startsWith('javascript:') ||
						img.src.includes('javascript') ||
						img.src.length > 2000) { // Bardzo długie URL-e mogą być problematyczne
						return;
					}

					const width = img.naturalWidth || img.width || 0;
					const height = img.naturalHeight || img.height || 0;

					// Filtruj obrazy poniżej 100x100px (ikony i małe grafiki)
					if (width < 100 || height < 100) {
						filteredBySize++;
						return;
					}

					// Filtruj duplikujące się URL-e
					if (seenUrls.has(img.src)) {
						filteredByDuplicate++;
						return;
					}

					// Dodaj URL do zbioru widzianych
					seenUrls.add(img.src);

					const imageData = {
						index: displayIndex++, // Inkrementuj licznik wyświetlanej pozycji
						domIndex: domIndex + 1, // Zachowaj oryginalną pozycję w DOM
						src: img.src,
						alt: img.alt || 'Brak opisu',
						width: width,
						height: height,
						displayWidth: img.width || 0,
						displayHeight: img.height || 0,
						isVisible: img.offsetWidth > 0 && img.offsetHeight > 0,
						domain: this.extractDomain(img.src),
						isAllegro: img.src.includes('allegroimg.com'),
						isIcon: this.isIconImage(img),
						isMainProduct: img === this.thumbnailData.src ? true : false
					};

					this.allImages.push(imageData);
				}
			});

			// Obrazy pozostają w naturalnej kolejności występowania na stronie
			// (nie sortujemy - zachowujemy kolejność od góry do dołu strony)

			console.log(`✅ Przetworzono ${this.allImages.length} unikalnych obrazów`);
			console.log(`🔧 Odfiltrowano: ${filteredBySize} małych obrazów (< 100×100px), ${filteredByDuplicate} duplikatów`);
			console.log('📋 Lista obrazów:', this.allImages.map(img => ({
				displayIndex: img.index,
				domIndex: img.domIndex,
				src: img.src.substring(0, 50) + '...',
				size: `${img.width}x${img.height}`,
				domain: img.domain,
				isAllegro: img.isAllegro
			})));
		}

		checkAllegroSmart() {
			console.log('🎯 Sprawdzam obecność Allegro Smart!...');

			this.hasAllegroSmart = false;

			// Znajdź WŁAŚCIWĄ sekcję cenową (używając tej samej logiki co checkAllegroFeatures)
			const mainPriceSection = this.findMainPriceSection();

			if (!mainPriceSection) {
				console.log('❌ Nie znaleziono głównej sekcji z ceną produktu');
				return;
			}

			console.log('✅ Znaleziono główną sekcję z ceną produktu');

			// METODA 1: Szukanie przez dokładny alt text
			let smartImg = mainPriceSection.querySelector('img[alt="Allegro Smart!"]');
			console.log('🔍 METODA 1 - img[alt="Allegro Smart!"]:', !!smartImg);

			// METODA 2: Szukanie przez src URL zawierający "brand-subbrand-smart"
			if (!smartImg) {
				smartImg = mainPriceSection.querySelector('img[src*="brand-subbrand-smart"]');
				console.log('🔍 METODA 2 - img[src*="brand-subbrand-smart"]:', !!smartImg);
			}

			// METODA 3: Szukanie przez src URL zawierający "smart"
			if (!smartImg) {
				smartImg = mainPriceSection.querySelector('img[src*="smart"]');
				if (smartImg && smartImg.src.includes('allegroimg.com')) {
					console.log('🔍 METODA 3 - img[src*="smart"] z allegroimg.com:', !!smartImg);
				} else {
					smartImg = null;
				}
			}

			// METODA 4: Szukanie przez alt zawierający "smart" (case insensitive)
			if (!smartImg) {
				const allImgs = mainPriceSection.querySelectorAll('img');
				for (const img of allImgs) {
					if (img.alt && img.alt.toLowerCase().includes('smart')) {
						smartImg = img;
						console.log('🔍 METODA 4 - znaleziono przez alt zawierające "smart":', img.alt);
						break;
					}
				}
			}

			// METODA 5: Szukanie przez klasę obrazu Allegro Smart
			if (!smartImg) {
				smartImg = mainPriceSection.querySelector('img._7030e_bpnv0');
				if (smartImg && (smartImg.alt.includes('Smart') || smartImg.src.includes('smart'))) {
					console.log('🔍 METODA 5 - znaleziono przez klasę _7030e_bpnv0 z Smart:', !!smartImg);
				} else {
					smartImg = null;
				}
			}

			if (smartImg) {
				console.log('🖼️ Smart img src:', smartImg.src);
				console.log('🖼️ Smart img alt:', smartImg.alt);
				console.log('🖼️ Smart img class:', smartImg.className);

				// Sprawdź czy obraz jest widoczny - BARDZIEJ SZCZEGÓŁOWE SPRAWDZENIE
				const style = window.getComputedStyle(smartImg);
				const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
				console.log('👁️ Obraz Allegro Smart! - szczegóły widoczności:');
				console.log('  display:', style.display);
				console.log('  visibility:', style.visibility);
				console.log('  opacity:', style.opacity);
				console.log('  offsetWidth:', smartImg.offsetWidth);
				console.log('  offsetHeight:', smartImg.offsetHeight);
				console.log('  clientWidth:', smartImg.clientWidth);
				console.log('  clientHeight:', smartImg.clientHeight);
				console.log('👁️ Końcowa ocena widoczności:', isVisible);

				// BARDZO LIBERALNA LOGIKA: Jeśli znaleziono obraz Allegro Smart!, to prawdopodobnie jest
				if (smartImg.alt === 'Allegro Smart!' || smartImg.src.includes('brand-subbrand-smart')) {
					this.hasAllegroSmart = true;
					console.log('✅ Znaleziono Allegro Smart! - wykryto przez alt lub src');

					// Dodatkowe sprawdzenie widoczności tylko dla logowania
					if (!isVisible || smartImg.offsetWidth === 0) {
						console.log('⚠️ UWAGA: Obraz może być ukryty, ale uznajemy za znaleziony');
					}
				} else {
					console.log('❌ Obraz nie spełnia kryteriów Allegro Smart!');
				}
			} else {
				console.log('❌ Nie znaleziono obrazu Allegro Smart! w sekcji mryx_16');

				// DEBUG: Pokaż wszystkie obrazy w sekcji
				const allImages = mainPriceSection.querySelectorAll('img');
				console.log('🖼️ DEBUG: Wszystkie obrazy w sekcji (' + allImages.length + '):');
				allImages.forEach((img, i) => {
					const shortSrc = img.src.length > 50 ? img.src.substring(0, 50) + '...' : img.src;
					console.log(`  ${i + 1}. alt="${img.alt}" src="${shortSrc}"`);
				});
			}

			console.log('🎯 Wynik sprawdzenia Allegro Smart!:', this.hasAllegroSmart ? 'TAK' : 'NIE');
		}

		checkBestPriceGuarantee() {
			console.log('💰 Sprawdzam obecność Gwarancji najniższej ceny...');

			this.hasBestPriceGuarantee = false;

			// Znajdź WŁAŚCIWĄ sekcję cenową
			const mainPriceSection = this.findMainPriceSection();

			if (!mainPriceSection) {
				console.log('❌ Nie znaleziono głównej sekcji z ceną produktu');
				return;
			}

			console.log('✅ Znaleziono główną sekcję z ceną produktu');

			// METODA 1: Po data-analytics-view-label="BestPriceGuaranteeBadge" (najniezawodniejsza)
			const guaranteeBadge = mainPriceSection.querySelector('[data-analytics-view-label="BestPriceGuaranteeBadge"]');
			console.log('🔍 METODA 1 - data-analytics-view-label="BestPriceGuaranteeBadge":', !!guaranteeBadge);
			if (guaranteeBadge) {
				// Sprawdź czy element jest widoczny
				const style = window.getComputedStyle(guaranteeBadge);
				const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
				console.log('👁️ Element gwarancji jest widoczny:', isVisible);

				if (isVisible) {
					this.hasBestPriceGuarantee = true;
					console.log('✅ Znaleziono Gwarancję najniższej ceny w głównej sekcji (data-analytics)');
					return;
				}
			}

			// METODA 2: Po alt tekście obrazu "Logo Gwarancji Najniższej Ceny"
			const guaranteeImage = mainPriceSection.querySelector('img[alt="Logo Gwarancji Najniższej Ceny"]');
			console.log('🔍 METODA 2 - img[alt="Logo Gwarancji Najniższej Ceny"]:', !!guaranteeImage);
			if (guaranteeImage) {
				this.hasBestPriceGuarantee = true;
				console.log('✅ Znaleziono Gwarancję najniższej ceny w głównej sekcji (obraz logo)');
				return;
			}

			// METODA 3: Po tekście "Gwarancja najniższej ceny"
			console.log('🔍 METODA 3 - szukanie tekstu "Gwarancja najniższej ceny"');
			const spans = mainPriceSection.querySelectorAll('span');
			for (const span of spans) {
				if (span.textContent && span.textContent.includes('Gwarancja najniższej ceny')) {
					console.log('✅ Znaleziono tekst "Gwarancja najniższej ceny"');
					this.hasBestPriceGuarantee = true;
					return;
				}
			}

			// METODA 4: Po obrazku z URL zawierającym "information-benefits-badge-check"
			console.log('🔍 METODA 4 - szukanie obrazka z "information-benefits-badge-check"');
			const guaranteeImages = mainPriceSection.querySelectorAll('img');
			for (const img of guaranteeImages) {
				if (img.src.includes('information-benefits-badge-check') ||
					img.src.includes('badge-check')) {
					console.log('✅ Znaleziono obraz gwarancji:', img.src);
					this.hasBestPriceGuarantee = true;
					return;
				}
			}

			// METODA 5: Po klasie CSS obrazka gwarancji
			console.log('🔍 METODA 5 - szukanie obrazka z klasą "_7030e_ObOva"');
			const guaranteeImgByClass = mainPriceSection.querySelector('img._7030e_ObOva');
			if (guaranteeImgByClass) {
				console.log('✅ Znaleziono obraz gwarancji przez klasę CSS');
				this.hasBestPriceGuarantee = true;
				return;
			}

			// METODA 6: Po linku zawierającym "#bpg-info"
			console.log('🔍 METODA 6 - szukanie linku z "#bpg-info"');
			const bpgLink = mainPriceSection.querySelector('a[href*="#bpg-info"]');
			if (bpgLink) {
				console.log('✅ Znaleziono link do informacji o gwarancji');
				this.hasBestPriceGuarantee = true;
				return;
			}

			// METODA 7: Po tekście "sprawdź" w kontekście gwarancji
			console.log('🔍 METODA 7 - szukanie tekstu "sprawdź" w kontekście gwarancji');
			const checkLinks = mainPriceSection.querySelectorAll('a');
			for (const link of checkLinks) {
				if (link.textContent && link.textContent.trim() === 'sprawdź' &&
					link.href && link.href.includes('bpg')) {
					console.log('✅ Znaleziono link "sprawdź" z bpg w URL');
					this.hasBestPriceGuarantee = true;
					return;
				}
			}

			console.log('💰 Wynik sprawdzenia Gwarancji najniższej ceny:', this.hasBestPriceGuarantee ? 'TAK' : 'NIE');

			// DEBUG: Jeśli nie znaleziono, pokaż wszystkie obrazy i linki
			if (!this.hasBestPriceGuarantee) {
				console.log('🔍 DEBUG: Wszystkie obrazy w sekcji:');
				const allImages = mainPriceSection.querySelectorAll('img');
				allImages.forEach((img, i) => {
					const shortSrc = img.src.length > 50 ? img.src.substring(0, 50) + '...' : img.src;
					console.log(`  ${i + 1}. alt="${img.alt}" src="${shortSrc}"`);
				});

				console.log('🔍 DEBUG: Wszystkie linki w sekcji:');
				const allLinks = mainPriceSection.querySelectorAll('a');
				allLinks.forEach((link, i) => {
					const shortHref = link.href.length > 50 ? link.href.substring(0, 50) + '...' : link.href;
					console.log(`  ${i + 1}. text="${link.textContent}" href="${shortHref}"`);
				});
			}
		}

		checkAllegroPay() {
			console.log('💳 Sprawdzam obecność Allegro Pay...');

			this.hasAllegroPay = false;
			this.allegroPayType = '';
			this.allegroPayDetails = '';

			// Znajdź WŁAŚCIWĄ sekcję cenową
			const mainPriceSection = this.findMainPriceSection();

			if (!mainPriceSection) {
				console.log('❌ Nie znaleziono głównej sekcji z ceną produktu');
				return;
			}

			console.log('✅ Znaleziono główną sekcję z ceną produktu');

			// METODA 0: Sprawdź czy są RATY (installmentZero)
			const installmentBadge = mainPriceSection.querySelector('[data-analytics-view-value="installmentZero"]');
			console.log('🔍 METODA 0 - data-analytics-view-value="installmentZero":', !!installmentBadge);

			if (installmentBadge) {
				console.log('💰 Znaleziono raty - Allegro Pay z ratami');
				console.log('  textContent:', installmentBadge.textContent.substring(0, 200));

				// Wyodrębnij szczegóły rat (np. "113,27 zł x 15 rat")
				const text = installmentBadge.textContent;
				const rateMatch = text.match(/(\d+[,\.]?\d*\s*zł)\s*x\s*(\d+)\s*rat/);

				if (rateMatch) {
					const rateAmount = rateMatch[1].trim();
					const rateCount = rateMatch[2];
					this.allegroPayDetails = `${rateCount} rat x ${rateAmount}`;
					console.log('  📊 Szczegóły rat:', this.allegroPayDetails);
				} else {
					// Jeśli nie udało się sparsować, zapisz surowy tekst
					this.allegroPayDetails = text.trim().substring(0, 100);
				}

				this.hasAllegroPay = true;
				this.allegroPayType = 'installments';
				console.log('✅ Znaleziono Allegro Pay w głównej sekcji (RATY)');
				return;
			}

			// METODA 1: Po data-analytics-view-value="allegroPay" (standardowe Allegro Pay)
			let allegroPayBadge = mainPriceSection.querySelector('[data-analytics-view-value="allegroPay"]');
			console.log('🔍 METODA 1 - data-analytics-view-value="allegroPay":', !!allegroPayBadge);

			if (allegroPayBadge) {
				// Sprawdź szczegóły elementu
				const style = window.getComputedStyle(allegroPayBadge);
				const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
				console.log('👁️ Element Allegro Pay - szczegóły:');
				console.log('  display:', style.display);
				console.log('  visibility:', style.visibility);
				console.log('  opacity:', style.opacity);
				console.log('  offsetWidth:', allegroPayBadge.offsetWidth);
				console.log('  offsetHeight:', allegroPayBadge.offsetHeight);
				console.log('  textContent:', allegroPayBadge.textContent.substring(0, 100));

				// LIBERALNA LOGIKA: Jeśli element istnieje, to uznajemy za znaleziony
				this.hasAllegroPay = true;
				this.allegroPayType = 'standard';
				this.allegroPayDetails = 'zapłać później';
				console.log('✅ Znaleziono Allegro Pay w głównej sekcji (data-analytics)');

				if (!isVisible) {
					console.log('⚠️ UWAGA: Element może być ukryty, ale uznajemy za znaleziony');
				}
				return;
			}

			// METODA 2: Po data-analytics-view-label="paymentMethodBadge"
			const paymentBadge = mainPriceSection.querySelector('[data-analytics-view-label="paymentMethodBadge"]');
			console.log('🔍 METODA 2 - data-analytics-view-label="paymentMethodBadge":', !!paymentBadge);
			if (paymentBadge) {
				console.log('📝 Payment badge text:', paymentBadge.textContent.substring(0, 100));
				// Sprawdź czy zawiera tekst o płatności później
				if (paymentBadge.textContent && paymentBadge.textContent.includes('zapłać później')) {
					this.hasAllegroPay = true;
					this.allegroPayType = 'standard';
					this.allegroPayDetails = 'zapłać później';
					console.log('✅ Znaleziono Allegro Pay w głównej sekcji (payment badge)');
					return;
				}
			}

			// METODA 3: Po tekście "zapłać później z" + link do allegro pay
			console.log('🔍 METODA 3 - szukanie tekstu "zapłać później z"');
			const spans = mainPriceSection.querySelectorAll('span');

			for (const span of spans) {
				if (span.textContent && span.textContent.includes('zapłać później z')) {
					console.log('✅ Znaleziono tekst "zapłać później z"');
					// Sprawdź czy w pobliżu jest link do allegro pay
					const parent = span.closest('div');
					const payLink = parent ? parent.querySelector('a[href*="payment-methods-allegro-pay"]') : null;
					console.log('🔗 Znaleziono link do allegro pay:', !!payLink);
					if (payLink) {
						this.hasAllegroPay = true;
						this.allegroPayType = 'standard';
						this.allegroPayDetails = 'zapłać później';
						console.log('✅ Znaleziono Allegro Pay w głównej sekcji (tekst + link)');
						return;
					}
				}
			}

			// METODA 4: Po samym tekście "zapłać później" (mniej specyficzna)
			console.log('🔍 METODA 4 - szukanie samego tekstu "zapłać później"');
			for (const span of spans) {
				if (span.textContent && span.textContent.trim() === 'zapłać później z') {
					console.log('✅ Znaleziono dokładny tekst "zapłać później z"');
					this.hasAllegroPay = true;
					this.allegroPayType = 'standard';
					this.allegroPayDetails = 'zapłać później';
					return;
				}
			}

			// METODA 5: Po obrazku z logo Allegro Pay
			console.log('🔍 METODA 5 - szukanie obrazka z logo Allegro Pay');
			const allegroPayImages = mainPriceSection.querySelectorAll('img');
			for (const img of allegroPayImages) {
				if (img.src.includes('allegroimg.com') &&
					(img.src.includes('1289e0') || img.alt.toLowerCase().includes('pay'))) {
					console.log('✅ Znaleziono obraz Allegro Pay:', img.src);
					this.hasAllegroPay = true;
					this.allegroPayType = 'standard';
					this.allegroPayDetails = 'zapłać później';
					return;
				}
			}

			// METODA 6: Po linku zawierającym "allegro-pay"
			console.log('🔍 METODA 6 - szukanie linku z "allegro-pay"');
			const allegroPayLinks = mainPriceSection.querySelectorAll('a[href*="allegro-pay"]');
			if (allegroPayLinks.length > 0) {
				console.log('✅ Znaleziono', allegroPayLinks.length, 'linków do Allegro Pay');
				this.hasAllegroPay = true;
				this.allegroPayType = 'standard';
				this.allegroPayDetails = 'zapłać później';
				return;
			}

			if (this.hasAllegroPay) {
				const payInfo = this.allegroPayType === 'installments'
					? `TAK (${this.allegroPayDetails})`
					: 'TAK (zapłać później)';
				console.log('💳 Wynik sprawdzenia Allegro Pay:', payInfo);
			} else {
				console.log('💳 Wynik sprawdzenia Allegro Pay: NIE');
			}

			// DEBUG: Jeśli nie znaleziono, pokaż wszystkie elementy z data-analytics
			if (!this.hasAllegroPay) {
				const allDataElements = mainPriceSection.querySelectorAll('[data-analytics-view-value], [data-analytics-view-label]');
				console.log('🔍 DEBUG: Wszystkie elementy z data-analytics w sekcji (' + allDataElements.length + '):');
				allDataElements.forEach((el, i) => {
					const value = el.getAttribute('data-analytics-view-value');
					const label = el.getAttribute('data-analytics-view-label');
					console.log(`  ${i + 1}. value="${value}" label="${label}"`);
				});
			}
		}

		scanCoinsAndCoupons() {
			console.log('🪙 Skanowanie monet i kuponów...');

			// Resetuj dane
			this.hasCoins = false;
			this.coinsAmount = 0;
			this.coinsDescription = '';
			this.hasCoupons = false;
			this.coupons = [];
			this.couponsCount = 0;

			// Znajdź główną sekcję cenową
			const mainPriceSection = this.findMainPriceSection();
			if (!mainPriceSection) {
				console.log('❌ Brak sekcji cenowej dla skanowania monet i kuponów');
				return;
			}

			// ROZSZERZONE SKANOWANIE: Szukaj monet i kuponów - OPTYMALNA KOLEJNOŚĆ z logów
			// 1. PRIORYTET: Sekcje myre_zn (z logów: znaleziono w sekcji #49)
			console.log('🔍 PRIORYTET: Skanowanie w sekcjach myre_zn (najczęściej działa)...');
			const additionalSections = document.querySelectorAll('div.myre_zn');
			console.log(`📊 Znaleziono ${additionalSections.length} sekcji myre_zn`);

			for (let i = 0; i < additionalSections.length; i++) {
				const section = additionalSections[i];

				if (!this.hasCoins) {
					this.scanSmartCoins(section);
				}
				if (this.coupons.length === 0) {
					this.scanCoupons(section);
				}

				// Przerwij jeśli znaleziono wszystko
				if (this.hasCoins && this.coupons.length > 0) {
					console.log('✅ Znaleziono monety i kupony w sekcji #' + (i + 1));
					break;
				}
				// Optymalizacja: po 50 sekcjach bez kupony/monet – przerwij (zazwyczaj są w pierwszych)
				if (i >= 50 && !this.hasCoins && this.coupons.length === 0) {
					break;
				}
			}

			// 2. FALLBACK: Główna sekcja cenowa (mryx_16)
			if (!this.hasCoins || this.coupons.length === 0) {
				console.log('🔍 FALLBACK: Skanowanie w głównej sekcji cenowej...');
				this.scanSmartCoins(mainPriceSection);
				this.scanCoupons(mainPriceSection);
			}

			// 3. OSTATNI FALLBACK: Cała sekcja "Warunki oferty"
			if (!this.hasCoins || this.coupons.length === 0) {
				console.log('🔍 OSTATNI FALLBACK: Rozszerzam poszukiwania na całą sekcję "Warunki oferty"...');
				const offerTermsSection = document.querySelector('section[aria-labelledby="offer-terms-heading"]');
				if (offerTermsSection) {
					console.log('✅ Znaleziono sekcję "Warunki oferty"');
					if (!this.hasCoins) {
						this.scanSmartCoins(offerTermsSection);
					}
					if (this.coupons.length === 0) {
						this.scanCoupons(offerTermsSection);
					}
				}
			}

			// Podsumowanie
			console.log('🪙 Wyniki skanowania monet i kuponów:');
			console.log(`  Monety: ${this.hasCoins ? `${this.coinsAmount} monet` : 'brak'}`);
			console.log(`  Kupony: ${this.hasCoupons ? `${this.couponsCount} kuponów` : 'brak'}`);

			if (this.coupons.length > 0) {
				this.coupons.forEach((coupon, i) => {
					console.log(`    ${i + 1}. ${coupon.description} (${coupon.type})`);
				});
			}
		}

		scanSmartCoins(section) {
			// METODA 1: Szukanie obrazu z alt="Monety"
			const coinsImage = section.querySelector('img[alt="Monety"]');
			if (coinsImage) {
				const immediateParent = coinsImage.closest('div');
				const grandParent = coinsImage.closest('div.myre_zn') || coinsImage.closest('div.mpof_ki');
				const sectionParent = coinsImage.closest('section');
				const searchAreas = [
					...(immediateParent ? [{ area: immediateParent }] : []),
					...(grandParent && grandParent !== immediateParent ? [{ area: grandParent }] : []),
					...(sectionParent && sectionParent !== grandParent ? [{ area: sectionParent }] : [])
				];

				for (const { area } of searchAreas) {
					const spans = area.querySelectorAll('span');
					for (const span of spans) {
						const text = span.textContent ? span.textContent.trim() : '';
						if (text && (text.includes('Smart! Monet') || text.includes('Smart! Monety'))) {
							const coinsMatch = text.match(/(\d+)\s*Smart!\s*Monet[ey]?/i);
							if (coinsMatch) {
								this.coinsAmount = parseInt(coinsMatch[1]);
								this.coinsDescription = text;
								this.hasCoins = true;
								return;
							}
						}
					}
				}
			}

			// METODA 2: Szukanie przez src obrazu zawierający "smart-coins"
			const coinsImageBySrc = section.querySelector('img[src*="smart-coins"]');
			if (coinsImageBySrc && !this.hasCoins) {
				const parent = coinsImageBySrc.closest('div');
				if (parent) {
					const spans = parent.querySelectorAll('span');
					for (const span of spans) {
						if (span.textContent && (span.textContent.includes('Monet') || span.textContent.includes('monety'))) {
							const text = span.textContent.trim();
							const coinsMatch = text.match(/(\d+)/);
							if (coinsMatch) {
								this.coinsAmount = parseInt(coinsMatch[1]);
								this.coinsDescription = text;
								this.hasCoins = true;
								return;
							}
						}
					}
				}
			}

			// METODA 3: Szukanie przez tekst "Smart! Monet/Monety" bez obrazu
			const allSpans = section.querySelectorAll('span');
			for (const span of allSpans) {
				if (span.textContent && (span.textContent.includes('Smart! Monet') || span.textContent.includes('Smart! Monety')) && !this.hasCoins) {
					const text = span.textContent.trim();
					const coinsMatch = text.match(/(\d+)\s*Smart!\s*Monet[ey]?/i);
					if (coinsMatch) {
						this.coinsAmount = parseInt(coinsMatch[1]);
						this.coinsDescription = text;
						this.hasCoins = true;
						return;
					}
				}
			}

			// METODA 4: Szukanie w divach z klasą _7030e_Ftsct (specyficzna struktura z przykładu)
			const coinsContainers = section.querySelectorAll('div._7030e_Ftsct, div[class*="Ftsct"]');
			for (const container of coinsContainers) {
				if (!this.hasCoins) {
					const spans = container.querySelectorAll('span');
					for (const span of spans) {
						const text = span.textContent ? span.textContent.trim() : '';
						if (text && (text.includes('Smart! Monet') || text.includes('Smart! Monety'))) {
							const coinsMatch = text.match(/(\d+)\s*Smart!\s*Monet[ey]?/i);
							if (coinsMatch) {
								this.coinsAmount = parseInt(coinsMatch[1]);
								this.coinsDescription = text;
								this.hasCoins = true;
								return;
							}
						}
					}
				}
			}
		}

		scanCoupons(section) {
			// METODA 1: Szukanie obrazu kuponu
			const couponImages = section.querySelectorAll('img[alt="kupon"], img[src*="COUPON"], img[src*="coupon"]');

			couponImages.forEach((img) => {
				const parent = img.closest('div');
				if (parent) {
					const spans = parent.querySelectorAll('span');
					for (const span of spans) {
						if (span.textContent && (span.textContent.includes('taniej') || span.textContent.includes('zł') || span.textContent.includes('%'))) {
							const text = span.textContent.trim();
							const coupon = this.parseCouponText(text);
							if (coupon) {
								this.coupons.push(coupon);
								this.hasCoupons = true;
							}
						}
					}
				}
			});

			// METODA 2: Szukanie linków z href="#available-coupons"
			const couponLinks = section.querySelectorAll('a[href*="available-coupons"], a[href*="coupon"]');

			couponLinks.forEach((link) => {
				const text = link.textContent ? link.textContent.trim() : '';
				if (text && (text.includes('taniej') || text.includes('zł') || text.includes('%'))) {
					const coupon = this.parseCouponText(text);
					if (coupon && !this.coupons.some(c => c.description === coupon.description)) {
						this.coupons.push(coupon);
						this.hasCoupons = true;
					}
				}
			});

			// METODA 3: Szukanie przez tekst zawierający "taniej", "kupon", "zł", "%"
			const allElements = section.querySelectorAll('span, div, a');

			allElements.forEach(element => {
				const text = element.textContent ? element.textContent.trim() : '';
				if (text && text.length < 100 && (text.includes('taniej') || (text.includes('kupon') && (text.includes('zł') || text.includes('%'))))) {
					const coupon = this.parseCouponText(text);
					if (coupon && !this.coupons.some(c => c.description === coupon.description)) {
						this.coupons.push(coupon);
						this.hasCoupons = true;
					}
				}
			});

			this.couponsCount = this.coupons.length;
		}

		parseCouponText(text) {
			// Analiza tekstu kuponu i wyodrębnienie informacji

			// Wzorce dla kuponów w złotych
			const zlotowkaMatch = text.match(/(\d+)\s*zł\s*taniej/i);
			if (zlotowkaMatch) {
				const amount = parseInt(zlotowkaMatch[1]);
				return {
					description: text,
					type: 'złotówka',
					amount: amount,
					currency: 'PLN',
					isPercentage: false,
					recommendation: 'Idealny - kupon w PLN jest najlepszym rozwiązaniem'
				};
			}

			// Wzorce dla kuponów procentowych
			const percentMatch = text.match(/(\d+)%\s*taniej/i);
			if (percentMatch) {
				const amount = parseInt(percentMatch[1]);
				return {
					description: text,
					type: 'procentowy',
					amount: amount,
					currency: '%',
					isPercentage: true,
					recommendation: 'Rekomendacja: Zmień na kupon w PLN dla lepszej przejrzystości'
				};
			}

			// Wzorce ogólne - jeśli zawiera "taniej" ale nie pasuje do powyższych
			if (text.includes('taniej') || text.includes('kupon')) {
				return {
					description: text,
					type: 'ogólny',
					amount: 0,
					currency: '',
					isPercentage: false,
					recommendation: 'Sprawdź szczegóły kuponu'
				};
			}

			return null;
		}

		generateAllegroFeaturesRecommendations() {
			// Generuj rekomendację dla kuponów (używa istniejącej logiki)
			const couponRec = this.generateCouponRecommendation();

			return {
				smart: {
					hasFeature: this.hasAllegroSmart,
					recommendation: this.hasAllegroSmart
						? 'Świetnie! Allegro SMART zwiększa atrakcyjność oferty i szanse na sprzedaż.'
						: 'Rozważ dołączenie do programu Allegro SMART - klienci chętniej kupują produkty z darmową dostawą.'
				},
				bestPrice: {
					hasFeature: this.hasBestPriceGuarantee,
					recommendation: this.hasBestPriceGuarantee
						? 'Świetnie! Gwarancja najniższej ceny buduje zaufanie klientów.'
						: 'Rozważ wejście na inne platformy lub/i zaproponowanie najniższej ceny na Allegro. Jest to istotna cecha dla algorytmu Allegro jak i konwersji ofert.'
				},
				allegroPay: {
					hasFeature: this.hasAllegroPay,
					type: this.allegroPayType,
					details: this.allegroPayDetails,
					recommendation: this.hasAllegroPay
						? (this.allegroPayType === 'installments'
							? `Świetnie! Allegro Pay z opcją rat (${this.allegroPayDetails}) ułatwia klientom zakup droższych produktów.`
							: 'Świetnie! Allegro Pay ułatwia klientom szybkie płatności.')
						: 'Rozważ aktywację Allegro Pay - klienci lubią wygodne i szybkie metody płatności.'
				},
				coins: {
					hasFeature: this.coinsAmount > 0,
					recommendation: this.coinsAmount > 0
						? 'Świetnie! Monety idealnie nadają się do kampanii promujących konkretne produkty w określonym czasie.'
						: 'Wykorzystuj monety do remarketingu. Dodaj przynajmniej 4 aby obserwujący ofertę lub osoby, ktre dodały ją do koszyka, otrzymały powiadomienie mailowe - teraz dostępne z monetami.'
				},
				coupons: {
					hasFeature: this.coupons.length > 0,
					recommendation: couponRec.suggestion.replace('Rekomendacja: ', '')
				}
			};
		}

		generateCouponRecommendation() {
			if (!this.hasCoupons || this.coupons.length === 0) {
				return {
					hasRecommendation: true,
					message: 'Brak kuponów rabatowych',
					suggestion: 'Rekomendacja: Dodaj kupony rabatowe na określoną kwotę w PLN (np. "10 zł taniej przy zakupach za minimum 100 zł") aby zwiększyć finalną wartość koszyka i zachęcić do większych zakupów.'
				};
			}

			// Jeśli są kupony, zwróć standardową analizę
			const hasFixedValue = this.coupons.some(c => c.type === 'złotówka');
			const hasPercentage = this.coupons.some(c => c.type === 'procentowy');

			let suggestion = '';
			if (hasPercentage && !hasFixedValue) {
				suggestion = 'Rekomendacja: Rozważ dodanie kuponów o stałej wartości w PLN obok procentowych - są bardziej atrakcyjne dla klientów.';
			} else if (hasFixedValue) {
				suggestion = 'Świetnie! Kupony o stałej wartości w PLN są idealne do zwiększania wartości koszyka.';
			}

			return {
				hasRecommendation: true,
				message: `Znaleziono ${this.couponsCount} kuponów`,
				suggestion: suggestion
			};
		}

		scanPromotionalSections() {
			console.log('🎁 Skanowanie sekcji promocyjnych (Pod miniaturami)...');

			// Resetuj dane promocyjnych sekcji
			this.promotionalSections = [];
			this.promotionalQualityScore = 0;

			// KROK 1: Znajdź GŁÓWNY KONTENER sekcji "Pod miniaturami"
			// Na podstawie rzeczywistych danych: <div data-box-name="caro">
			const mainPromotionalContainer = document.querySelector('div[data-box-name="caro"]');

			if (!mainPromotionalContainer) {
				console.log('❌ Nie znaleziono głównego kontenera sekcji promocyjnych (data-box-name="caro")');
				return;
			}

			console.log('✅ Znaleziono główny kontener sekcji "Pod miniaturami" (data-box-name="caro")');

			// KROK 2: Sprawdź czy to sekcja SPONSOROWANA czy WŁASNA sprzedawcy
			let isSponsored = false;
			let sponsoredDetectionMethod = '';

			// Metoda 1: Sprawdź analytics label w ofertach (najpewniejsza)
			const firstCarouselItem = mainPromotionalContainer.querySelector('[data-analytics-view-label], [data-analytics-click-label]');
			if (firstCarouselItem) {
				const viewLabel = firstCarouselItem.getAttribute('data-analytics-view-label');
				const clickLabel = firstCarouselItem.getAttribute('data-analytics-click-label');

				if (viewLabel === 'sp0nsored' || clickLabel === 'sp0nsored') {
					isSponsored = true;
					sponsoredDetectionMethod = 'analytics label (sp0nsored)';
					console.log('🔶 WYKRYTO SPONSOROWANIE - Metoda: analytics label = "sp0nsored"');
				} else if (viewLabel === 'regular' || clickLabel === 'regular') {
					isSponsored = false;
					sponsoredDetectionMethod = 'analytics label (regular)';
					console.log('✅ WYKRYTO SEKCJĘ WŁASNĄ - Metoda: analytics label = "regular"');
				}
			}

			// Metoda 2: Sprawdź czy jest tekst "Sponsorowane" (backup)
			if (!sponsoredDetectionMethod) {
				const allSpans = mainPromotionalContainer.querySelectorAll('span');
				for (const span of allSpans) {
					if (span.textContent.trim() === 'Sponsorowane') {
						isSponsored = true;
						sponsoredDetectionMethod = 'tekst Sponsorowane';
						console.log('🔶 WYKRYTO SPONSOROWANIE - Metoda: tekst "Sponsorowane"');
						break;
					}
				}
			}

			// Metoda 3: Sprawdź czy jest przycisk "Sprawdź szczegóły dotyczące reklam" (backup)
			if (!sponsoredDetectionMethod) {
				const adInfoButton = mainPromotionalContainer.querySelector('button[aria-label*="szczegóły dotyczące reklam"]');
				if (adInfoButton) {
					isSponsored = true;
					sponsoredDetectionMethod = 'przycisk info o reklamach';
					console.log('🔶 WYKRYTO SPONSOROWANIE - Metoda: przycisk info o reklamach');
				}
			}

			// Metoda 4: Sprawdź strukturę - sekcje własne mają "Container carousel crossmultipack"
			if (!sponsoredDetectionMethod) {
				const crossmultipackContainer = mainPromotionalContainer.querySelector('[data-box-name="Container carousel crossmultipack"]');
				if (crossmultipackContainer) {
					isSponsored = false;
					sponsoredDetectionMethod = 'struktura crossmultipack';
					console.log('✅ WYKRYTO SEKCJĘ WŁASNĄ - Metoda: struktura crossmultipack');
				} else {
					isSponsored = true;
					sponsoredDetectionMethod = 'brak struktury crossmultipack (domyślnie sponsorowane)';
					console.log('🔶 WYKRYTO SPONSOROWANIE - Metoda: brak struktury crossmultipack');
				}
			}

			// KROK 3: Znajdź tytuł sekcji
			let sectionTitle = '';
			const titleElement = mainPromotionalContainer.querySelector('h2, h3');
			if (titleElement) {
				sectionTitle = titleElement.textContent.trim();
				// Usuń tekst "Sponsorowane" z tytułu jeśli jest
				sectionTitle = sectionTitle.replace(/Sponsorowane/gi, '').trim();
				console.log(`📝 Tytuł sekcji: "${sectionTitle}"`);
			}

			if (!sectionTitle) {
				console.log('⚠️ Brak tytułu sekcji');
				sectionTitle = 'Bez tytułu';
			}

			// KROK 4: Znajdź podtytuł/opis (tylko dla sekcji własnych - crossmultipack subtitle)
			let subtitle = '';
			let subtitleDescription = '';
			const subtitleElement = mainPromotionalContainer.querySelector('[data-box-name="crossmultipack subtitle"]');
			if (subtitleElement) {
				// Weź cały tekst z elementu small lub p
				const smallText = subtitleElement.querySelector('small, p');
				if (smallText) {
					subtitleDescription = smallText.textContent.trim();
					subtitle = 'Info';
					console.log(`📝 Opis promocji: "${subtitleDescription}"`);
				}
			}

			// KROK 5: Zbierz wszystkie oferty z karuzeli
			const offers = [];
			const carouselItems = mainPromotionalContainer.querySelectorAll('.carousel-item[data-analytics-view-custom-item-id], [data-role="offer-tile"]');

			console.log(`📊 Znaleziono ${carouselItems.length} elementów oferty w karuzeli`);

			// Zbierz maksymalnie 5 pierwszych ofert do wyświetlenia
			let hasStrikethroughPrice = false;
			for (let i = 0; i < Math.min(5, carouselItems.length); i++) {
				const item = carouselItems[i];

				// Szukaj linku z nazwą oferty (struktura: a.mp0t_0a.mgmw_wo...)
				const offerLink = item.querySelector('a[data-analytics-clickable], a[href*="/oferta/"]');
				let offerName = '';
				let linkUrl = '';

				if (offerLink) {
					offerName = offerLink.textContent.trim();
					linkUrl = offerLink.href;
				}

				if (!offerName) {
					console.log(`⚠️ Nie znaleziono nazwy oferty dla elementu ${i + 1}`);
					continue;
				}

				// Szukaj ceny - struktura: span z liczbami i "zł"
				let price = '';
				const priceSpans = item.querySelectorAll('span');
				for (const span of priceSpans) {
					const text = span.textContent.trim();
					// Szukaj wzorca: liczba, przecinek/kropka, liczba, "zł"
					if (text.match(/^\d+[,\.]\d+\s*zł$/i)) {
						price = text;
						break;
					}
				}

				if (!price) {
					// Fallback - szukaj w całym elemencie li z ceną
					const priceContainer = item.querySelector('li.mg9e_8');
					if (priceContainer) {
						price = priceContainer.textContent.replace(/\s+/g, ' ').trim();
					}
				}

				// Detekcja przekreślonej ceny (stara cena) w elemencie
				const strikeEl = item.querySelector('del, s, [style*="line-through"], .line-through');
				const offerHasStrikethrough = !!strikeEl;
				if (offerHasStrikethrough) {
					hasStrikethroughPrice = true;
				}

				const offer = {
					name: offerName,
					price: price || 'Brak ceny',
					link: linkUrl,
					hasStrikethrough: offerHasStrikethrough
				};

				offers.push(offer);
				console.log(`✅ Oferta ${i + 1}: ${offerName} - ${price}`);
			}

			// KROK 6: Ocena jakości dla sekcji WŁASNYCH sprzedawcy
			let productCount = carouselItems.length;
			let qualityRating = '';
			let qualityColor = '';
			let qualityMessage = '';

			if (!isSponsored) {
				// Dla sekcji własnych - pozytywna ocena z zaleceniami
				if (productCount < 3) {
					qualityRating = '👍 DOBRZE (warto dodać więcej)';
					qualityColor = '#fb923c'; // jasny pomarańczowy
					qualityMessage = 'Świetnie że są promocje własne! Warto dodać więcej produktów do promocji.';
					console.log(`📊 Ocena: DOBRZE (${productCount} produkty, ale warto dodać więcej do 5)`);
				} else if (productCount >= 3 && productCount <= 4) {
					qualityRating = '✅ DOBRZE (można jeszcze poprawić)';
					qualityColor = '#eab308'; // żółty
					qualityMessage = 'Dobrze! Już jest ok, ale warto dodać jeszcze kilka produktów do promocji.';
					console.log(`📊 Ocena: DOBRZE (${productCount} produkty, idealnie byłoby 5+)`);
				} else if (productCount >= 5) {
					qualityRating = '🌟 ŚWIETNIE! Tak trzymaj!';
					qualityColor = '#10b981'; // zielony
					qualityMessage = 'Super! Masz wystarczająco produktów w promocji. Tak trzymaj!';
					console.log(`📈 Ocena: ŚWIETNIE (${productCount} produktów - idealnie!)`);
				}
			} else {
				// Dla sekcji sponsorowanych - nie oceniamy
				qualityRating = 'N/A (sponsorowane)';
				qualityColor = '#6b7280'; // szary
				qualityMessage = '';
				console.log(`📊 Sekcja sponsorowana - brak oceny jakości`);
			}

			// KROK 7: Dodaj sekcję do listy
			if (carouselItems.length > 0) {
				const section = {
					title: sectionTitle,
					subtitle: subtitle,
					description: subtitleDescription,
					isSponsored: isSponsored,
					detectionMethod: sponsoredDetectionMethod,
					sectionType: isSponsored ? 'Allegro (Sponsorowane)' : 'Sprzedawca (Promocje własne)',
					productCount: productCount, // Całkowita liczba produktów w sekcji
					qualityRating: qualityRating, // Ocena tekstowa
					qualityColor: qualityColor, // Kolor do wyświetlania
					qualityMessage: qualityMessage, // Komunikat dla użytkownika
				offers: offers, // Pierwsze 5 ofert do prezentacji
				hasStrikethroughPrice: hasStrikethroughPrice
				};

				this.promotionalSections.push(section);
				const sponsorBadge = isSponsored ? '🔶 SPONSOROWANE' : '✅ WŁASNE';
				console.log(`${sponsorBadge} Dodana sekcja: "${sectionTitle}" (${productCount} produktów, pokazano ${offers.length})`);
				console.log(`   Metoda wykrycia: ${sponsoredDetectionMethod}`);
				console.log(`   Ocena: ${qualityRating}`);
			}

			// KROK 8: Oblicz ogólną ocenę jakości sekcji promocyjnych
			if (this.promotionalSections.length > 0) {
				const ownSections = this.promotionalSections.filter(s => !s.isSponsored);
				if (ownSections.length > 0) {
					// Ocena bazuje na liczbie produktów w sekcjach własnych
					const avgProductCount = ownSections.reduce((sum, s) => sum + s.productCount, 0) / ownSections.length;

					if (avgProductCount < 3) {
						this.promotionalQualityScore = 60; // Dobrze, ale można lepiej
					} else if (avgProductCount >= 3 && avgProductCount < 5) {
						this.promotionalQualityScore = 80; // Dobrze
					} else {
						this.promotionalQualityScore = 100; // Świetnie
					}

					console.log(`📊 Średnia liczba produktów w sekcjach własnych: ${avgProductCount.toFixed(1)}`);
					console.log(`📊 Ocena jakości sekcji promocyjnych: ${this.promotionalQualityScore}%`);
				} else {
					console.log('⚠️ Brak sekcji własnych sprzedawcy - tylko sponsorowane');
					this.promotionalQualityScore = 0;
				}
			}

			console.log(`🎁 Skanowanie zakończone. Znaleziono ${this.promotionalSections.length} sekcji`);

			if (this.promotionalSections.length > 0) {
				this.promotionalSections.forEach((section, index) => {
					const typeLabel = section.isSponsored ? '[SPONSOROWANE]' : '[WŁASNE]';
					console.log(`  ${index + 1}. ${typeLabel} ${section.title} - ${section.productCount} produktów (${section.qualityRating})`);
				});
			}
		}

		async waitForBundleElements(maxWaitMs = 5000) {
			console.log('⏳ Czekam na załadowanie elementów zestawu...');
			const startTime = Date.now();
			const checkInterval = 100; // Sprawdzaj co 100ms

			while (Date.now() - startTime < maxWaitMs) {
				const bundleContainer = document.querySelector('div[data-box-name="Container Bundle"]');
				if (bundleContainer) {
					const bundleElements = bundleContainer.querySelectorAll('[data-testid^="bundle-offer-"]');
					if (bundleElements.length > 0) {
						const elapsed = Date.now() - startTime;
						console.log(`✅ Znaleziono ${bundleElements.length} elementów zestawu po ${elapsed}ms`);
						return true;
					}
				}
				// Czekaj przed kolejną próbą
				await new Promise(resolve => setTimeout(resolve, checkInterval));
			}

			console.log(`⚠️ Upłynął limit czasu ${maxWaitMs}ms - elementy zestawu mogą nie być załadowane`);
			return false;
		}

		async scanBundleSection() {
			console.log('📦 Skanowanie sekcji zestawów (Zamów zestaw w jednej przesyłce)...');

			// Resetuj dane sekcji zestawów
			this.bundleSection = null;
			this.bundleQualityScore = 0;

		// KROK 1: Znajdź kontener sekcji zestawów - różne metody
		let bundleContainer = document.querySelector('div[data-box-name="Container Bundle"]');
		
		// Fallback 1: szukaj po tekście "Zamów zestaw" (NIE "przedmiot" ani "%")
		if (!bundleContainer) {
			console.log('🔄 Próba znalezienia przez tekst "Zamów zestaw"...');
			const allDivs = document.querySelectorAll('div');
			for (const div of allDivs) {
				const h2 = div.querySelector('h2');
				if (h2) {
					const text = h2.textContent || '';
					// Sprawdź czy to ZESTAW, a nie promocja
					const isBundle = (text.includes('Zamów zestaw') || text.includes('Kup razem')) && 
									 !text.includes('%') && 
									 !text.toLowerCase().includes('przedmiot');
					
					if (isBundle && div.querySelector('[data-testid^="bundle-offer-"]')) {
						bundleContainer = div;
						console.log('✅ Znaleziono kontener zestawów przez tekst:', text.trim());
						break;
					}
				}
			}
		}
		
		// Fallback 2: szukaj przez h2 z tekstem "Zamów zestaw" lub "Kup razem"
		if (!bundleContainer) {
			const heading = Array.from(document.querySelectorAll('h2')).find(h => {
				const text = h.textContent;
				return (text.includes('Zamów zestaw') || text.includes('Kup razem')) && 
					   !text.includes('%') && 
					   !text.toLowerCase().includes('przedmiot');
			});
			if (heading) {
				bundleContainer = heading.closest('div[data-box-name]') || heading.parentElement.closest('section, div');
				if (bundleContainer) console.log('✅ Znaleziono kontener zestawów przez nagłówek h2');
			}
		}

			if (!bundleContainer) {
				console.log('❌ Nie znaleziono sekcji zestawów');
				console.log('📊 Ocena: BRAK - Warto tworzyć zestawy produktowe aby zwiększyć sprzedaż');

				// Brak sekcji = czerwony, rekomendacja
				this.bundleSection = {
					exists: false,
					title: 'Brak sekcji zestawów',
					productCount: 0,
					qualityRating: '⚠️ BRAK',
					qualityColor: '#dc2626', // czerwony
					qualityMessage: 'Warto tworzyć zestawy produktowe aby zwiększyć sprzedaż i średnią wartość zamówienia.',
					products: []
				};
				this.bundleQualityScore = 0;
				return;
			}

			console.log('✅ Znaleziono kontener sekcji zestawów');

			// KROK 1.5: Przewiń do sekcji zestawów (trigger dla lazy loading)
			try {
				bundleContainer.scrollIntoView({ behavior: 'instant', block: 'center' });
				console.log('📜 Przewinięto do sekcji zestawów (trigger lazy loading)');
				// Daj chwilę na rozpoczęcie ładowania
				await new Promise(resolve => setTimeout(resolve, 300));
			} catch (e) {
				console.log('⚠️ Nie udało się przewinąć do sekcji:', e.message);
			}

			// KROK 1.6: Czekaj na załadowanie elementów zestawu (dynamiczne ładowanie przez Allegro)
			await this.waitForBundleElements(5000); // Czekaj maksymalnie 5 sekund (zwiększone z 3s)

			// KROK 2: Znajdź tytuł sekcji
			let sectionTitle = 'Zamów zestaw w jednej przesyłce';
			const titleElement = bundleContainer.querySelector('h2[data-role="replaceable-title"]');
			if (titleElement) {
				sectionTitle = titleElement.textContent.trim();
				console.log(`📝 Tytuł sekcji: "${sectionTitle}"`);
			}

			// KROK 3: Znajdź wszystkie produkty w zestawie
			// Na podstawie HTML: div[data-testid="bundle-offer-{id}"]
			// UWAGA: Allegro tworzy duplikaty dla responsive design, więc musimy liczyć tylko unikalne ID

			let bundleProductElements = bundleContainer.querySelectorAll('div[data-testid^="bundle-offer-"]');

			// Jeśli nie znaleziono, spróbuj bez ograniczenia do div
			if (bundleProductElements.length === 0) {
				bundleProductElements = bundleContainer.querySelectorAll('[data-testid^="bundle-offer-"]');
			}

			// Jeśli nadal nic, spróbuj w całym dokumencie (może kontener jest za wąski)
			if (bundleProductElements.length === 0) {
				bundleProductElements = document.querySelectorAll('[data-testid^="bundle-offer-"]');
			}

		// Zbierz unikalne ID produktów
		const uniqueProductIds = new Set();
		const productDataMap = new Map(); // Mapa ID -> dane produktu (nazwa, link)

		console.log(`📊 DEBUG: Znaleziono ${bundleProductElements.length} elementów bundle-offer- (z duplikatami)`);

		bundleProductElements.forEach((productDiv, index) => {
			// Ekstraktuj ID z data-testid (np. "bundle-offer-13152325849" -> "13152325849")
			const testId = productDiv.getAttribute('data-testid');

			if (!testId) {
				console.log(`⚠️ Element ${index}: brak data-testid`);
				return;
			}

			const productId = testId.replace('bundle-offer-', '');
			
			// Loguj wszystkie wykryte ID (z duplikatami)
			console.log(`📦 Element ${index}: ID="${productId}" (${uniqueProductIds.has(productId) ? 'DUPLIKAT' : 'NOWY'})`);
			
			uniqueProductIds.add(productId);

			// Jeśli jeszcze nie mamy danych dla tego produktu, zbierz je
			if (!productDataMap.has(productId)) {
				const productLink = productDiv.querySelector('a[title]');
				if (productLink) {
					const productName = productLink.getAttribute('title') || productLink.textContent.trim();
					const productUrl = productLink.href;

					if (productName) {
						productDataMap.set(productId, {
							id: productId,
							name: productName,
							link: productUrl
						});
						console.log(`   ✅ Zapisano dane: "${productName.substring(0, 50)}..."`);
					} else {
						console.log(`   ⚠️ Brak nazwy produktu`);
					}
				} else {
					console.log(`   ⚠️ Nie znaleziono linku produktu`);
				}
			}
		});

		// Liczba produktów = unikalne ID (Allegro duplikuje elementy dla responsive, więc liczymy tylko unikalne)
		const productCount = uniqueProductIds.size;
		console.log(`📊 Liczba unikalnych produktów: ${productCount} (elementy DOM: ${bundleProductElements.length}, w tym duplikaty)`);

			// KROK 4: Zbierz informacje o produktach (pierwsze 5)
			const products = Array.from(productDataMap.values()).slice(0, 5);

			// KROK 5: Ocena jakości sekcji zestawów
			let qualityRating = '';
			let qualityColor = '';
			let qualityMessage = '';

			if (productCount === 2) {
				// 2 produkty = żółty
				qualityRating = '👍 DOBRZE (warto dodać więcej)';
				qualityColor = '#eab308'; // żółty
				qualityMessage = 'Świetnie że są zestawy! Warto dodać więcej produktów do zestawu, aby zwiększyć wartość zamówienia.';
				this.bundleQualityScore = 60;
				console.log(`📊 Ocena: DOBRZE (${productCount} produkty, ale warto dodać więcej)`);
			} else if (productCount > 2) {
				// >2 produkty = zielony
				qualityRating = '🌟 ŚWIETNIE! Tak trzymaj!';
				qualityColor = '#10b981'; // zielony
				qualityMessage = 'Super! Zestawy z wieloma produktami zwiększają średnią wartość zamówienia. Tak trzymaj!';
				this.bundleQualityScore = 100;
				console.log(`📈 Ocena: ŚWIETNIE (${productCount} produktów - idealnie!)`);
			}

			// KROK 6: Zapisz dane sekcji
			this.bundleSection = {
				exists: true,
				title: sectionTitle,
				productCount: productCount,
				qualityRating: qualityRating,
				qualityColor: qualityColor,
				qualityMessage: qualityMessage,
				products: products
			};

			console.log(`📦 Skanowanie sekcji zestawów zakończone`);
			console.log(`   Tytuł: "${sectionTitle}"`);
			console.log(`   Produktów: ${productCount}`);
			console.log(`   Ocena: ${qualityRating} (${this.bundleQualityScore}%)`);
		}

		scanSuggestionsSection() {
			console.log('💡 Skanowanie sekcji "Propozycje dla Ciebie"...');

			// Resetuj dane sekcji propozycji
			this.suggestionsSection = null;
			this.suggestionsQualityScore = 0;

			// KROK 1: Znajdź sekcję "Propozycje dla Ciebie" po tytule
			const suggestionsTitles = [...document.querySelectorAll('h2[data-role="replaceable-title"]')]
				.filter(h2 => h2.textContent.trim().includes('Propozycje dla Ciebie'));

			if (suggestionsTitles.length === 0) {
				console.log('❌ Nie znaleziono sekcji "Propozycje dla Ciebie"');

				this.suggestionsSection = {
					exists: false,
					hasBrandTab: false,
					hasRelatedTab: false,
					brandName: null,
					qualityRating: '⚠️ BRAK',
					qualityColor: '#dc2626',
					qualityMessage: 'Sekcja "Propozycje dla Ciebie" nie została znaleziona.',
					recommendation: 'Sprawdź czy sekcja jest dostępna na stronie produktu.'
				};
				this.suggestionsQualityScore = 0;
				return;
			}

			console.log('✅ Znaleziono sekcję "Propozycje dla Ciebie"');

			// KROK 2: Znajdź system zakładek (tabs) - różne metody
			let tabsContainer = null;

			// Metoda 1: W kontenerze nadrzędnym tytułu
			const titleParent = suggestionsTitles[0].parentElement;
			tabsContainer = titleParent?.querySelector('[data-role="tabs-container"]');
			console.log(`   Metoda 1 (parent title): ${tabsContainer ? 'Znaleziono' : 'Nie znaleziono'}`);

			// Metoda 2: Szukaj w rodzeństwie tytułu
			if (!tabsContainer && titleParent) {
				const nextSibling = suggestionsTitles[0].nextElementSibling;
				if (nextSibling && nextSibling.getAttribute('data-role') === 'tabs-container') {
					tabsContainer = nextSibling;
					console.log('   Metoda 2 (nextSibling): Znaleziono');
				} else if (nextSibling) {
					tabsContainer = nextSibling.querySelector('[data-role="tabs-container"]');
					console.log(`   Metoda 2 (nextSibling query): ${tabsContainer ? 'Znaleziono' : 'Nie znaleziono'}`);
				}
			}

			// Metoda 3: Szukaj we wszystkich kontenerach z data-role="tabs-container"
			if (!tabsContainer) {
				const allTabsContainers = document.querySelectorAll('[data-role="tabs-container"]');
				console.log(`   Metoda 3 (wszystkie tabs-container): Znaleziono ${allTabsContainers.length} kontenerów`);
				// Użyj pierwszego który ma zakładki
				for (const container of allTabsContainers) {
					const tabs = container.querySelectorAll('li[role="presentation"]');
					if (tabs.length > 0) {
						tabsContainer = container;
						console.log(`   -> Użyto kontenera z ${tabs.length} zakładkami`);
						break;
					}
				}
			}

			if (!tabsContainer) {
				console.log('⚠️ Nie znaleziono systemu zakładek w sekcji');

				this.suggestionsSection = {
					exists: true,
					hasBrandTab: false,
					hasRelatedTab: false,
					brandName: null,
					qualityRating: '⚠️ Średnio',
					qualityColor: '#fb923c',
					qualityMessage: 'Sekcja istnieje, ale nie znaleziono zakładek.',
					recommendation: 'Sekcja powinna zawierać zakładki z produktami marki.'
				};
				this.suggestionsQualityScore = 50;
				return;
			}

			console.log('✅ Znaleziono system zakładek');

			// KROK 3: Znajdź zakładki i sprawdź ich nazwy
			const tabItems = tabsContainer.querySelectorAll('li[role="presentation"][data-role="navigation-item"]');
			console.log(`📊 Znaleziono ${tabItems.length} zakładek`);

			let hasBrandTab = false;
			let hasRelatedTab = false;
			let brandTabName = null;

			tabItems.forEach((tab, index) => {
				const tabValue = tab.getAttribute('data-analytics-view-value')?.trim();
				console.log(`   Zakładka ${index + 1}: "${tabValue}"`);

				if (tabValue) {
					// Sprawdź czy to zakładka "Pokrewne"
					if (tabValue.toLowerCase() === 'pokrewne') {
						hasRelatedTab = true;
						console.log('   ✅ Znaleziono zakładkę "Pokrewne"');
					} else if (tabValue.toLowerCase() !== 'wszystkie' && tabValue !== '') {
						// To prawdopodobnie zakładka z marką
						hasBrandTab = true;
						brandTabName = tabValue;
						console.log(`   ✅ Znaleziono zakładkę z marką: "${brandTabName}"`);
					}
				}
			});

			// KROK 4: Sprawdź czy marka z zakładki zgadza się z marką produktu z parametrów
			let brandMatches = false;
			if (hasBrandTab && this.hasBrand && this.brandName) {
				// Porównaj nazwę marki z zakładki z marką z parametrów (case-insensitive)
				brandMatches = brandTabName?.toLowerCase() === this.brandName.toLowerCase();
				console.log(`📊 Porównanie marki: "${brandTabName}" vs "${this.brandName}" - ${brandMatches ? 'ZGODNE' : 'RÓŻNE'}`);
			}

			// KROK 5: Ocena jakości sekcji
			let qualityRating = '';
			let qualityColor = '';
			let qualityMessage = '';
			let recommendation = '';

			if (hasBrandTab && (brandMatches || !this.hasBrand)) {
				// Jest zakładka z marką = bardzo dobrze
				qualityRating = '🌟 Bardzo dobrze';
				qualityColor = '#10b981'; // zielony
				qualityMessage = 'Sekcja zawiera dedykowaną zakładkę z produktami marki.';
				recommendation = 'Świetnie! Allegro promuje produkty marki w dedykowanej zakładce.';
				this.suggestionsQualityScore = 100;
				console.log('📈 Ocena: BARDZO DOBRZE - Jest zakładka z marką');
			} else {
			// Tylko "Pokrewne" — zachęcamy do popularyzacji marki
			qualityRating = '❌ Słabo';
			qualityColor = '#f59e0b'; // pomarańczowy
			qualityMessage = 'Zamiast zakładki Pokrewne lepiej mieć zakładkę z produktami marki.';
			recommendation = 'Popularyzuj markę w Allegro i poza nim, aby zamiast zakładki Pokrewne wyświetlały się tylko produkty marki.';
			this.suggestionsQualityScore = 20;
				console.log('📊 Ocena: SŁABO - tylko zakładka Pokrewne, zalecane usunięcie');
			}

			// KROK 6: Zapisz wyniki
			this.suggestionsSection = {
				exists: true,
				hasBrandTab: hasBrandTab,
				hasRelatedTab: hasRelatedTab,
				brandName: brandTabName,
				brandMatches: brandMatches,
				qualityRating: qualityRating,
				qualityColor: qualityColor,
				qualityMessage: qualityMessage,
				recommendation: recommendation
			};

			console.log(`💡 Skanowanie sekcji "Propozycje dla Ciebie" zakończone`);
			console.log(`   Ma zakładkę z marką: ${hasBrandTab ? 'TAK' : 'NIE'} ${brandTabName ? `(${brandTabName})` : ''}`);
			console.log(`   Ma zakładkę Pokrewne: ${hasRelatedTab ? 'TAK' : 'NIE'}`);
			console.log(`   Ocena: ${qualityRating} (${this.suggestionsQualityScore}%)`);
		}

		// === METODY ANALIZY KONTROFERT ===

		async ensureCompetitorOffersLoaded() {
			console.log('🔍 Otwieram okno z kontrofertami...');

			// Znajdź przycisk "Wszystkie oferty (X)"
			const allOffersLink = document.querySelector('a.other-offers-link-all[data-analytics-click-label="showMore"]') ||
				[...document.querySelectorAll('a')].find(link =>
					link.textContent && link.textContent.includes('Wszystkie oferty')
				);

			if (!allOffersLink) {
				console.log('⚠️ Nie znaleziono przycisku "Wszystkie oferty" - kontynuuję bez analizy kontrofert');
				return false;
			}

			console.log('🖱️ Znaleziono przycisk do kontrofert - automatyczne kliknięcie...');
			console.log('🔍 DEBUG: Tekst przycisku:', allOffersLink.textContent?.substring(0, 50));

			try {
				allOffersLink.click();
				console.log('✅ Kliknięto przycisk kontrofert');

				// Poczekaj na pojawienie się dialogu
				console.log('⏳ Czekam na załadowanie dialogu z kontrofertami...');

				for (let i = 0; i < 30; i++) {
					await new Promise(resolve => setTimeout(resolve, 100));

					const dialog = document.querySelector('div[role="dialog"][aria-labelledby="Inne oferty produktu"]');
					if (dialog) {
						console.log('✅ Dialog z kontrofertami załadowany');
						return true;
					}
				}

				console.log('⚠️ Timeout: Dialog z kontrofertami nie pojawił się w ciągu 3 sekund');
				return false;
			} catch (error) {
				console.log('❌ Błąd podczas otwierania kontrofert:', error);
				return false;
			}
		}

		async closeCompetitorOffersDialog() {
			console.log('🔄 Zamykam okno kontrofert...');

			const dialog = document.querySelector('div[role="dialog"][aria-labelledby="Inne oferty produktu"]');
			if (!dialog) {
				console.log('⚠️ Dialog z kontrofertami nie jest otwarty');
				return;
			}

			// Znajdź przycisk zamykania (X)
			const closeButton = dialog.querySelector('button[aria-label="Zamknij"]');
			if (closeButton) {
				closeButton.click();
				console.log('✅ Kliknięto przycisk zamykania');

				// Poczekaj aż dialog zniknie
				await new Promise(resolve => setTimeout(resolve, 300));
				console.log('✅ Dialog zamknięty');
			} else {
				console.log('⚠️ Nie znaleziono przycisku zamykania dialogu');
			}
		}

		async scanCompetitorOffers() {
			console.log('🏪 Skanowanie kontrofert...');

			// Reset danych
			this.competitorOffers = [];
			this.competitorOffersCount = 0;
			this.lowestCompetitorPrice = null;
			this.averageCompetitorPrice = null;

			const dialog = document.querySelector('div[role="dialog"][aria-labelledby="Inne oferty produktu"]');
			if (!dialog) {
				console.log('⚠️ Dialog z kontrofertami nie jest otwarty');
				return;
			}

			// LAZY LOADING: Przewiń dialog w dół aby załadować wszystkie oferty
			console.log('📜 Przewijam dialog w dół dla załadowania ofert...');
			const scrollableContainer = dialog.querySelector('div.mdwt_56') || dialog;
			if (scrollableContainer) {
				scrollableContainer.scrollTo({ top: scrollableContainer.scrollHeight, behavior: 'instant' });
				await new Promise(resolve => setTimeout(resolve, 1000)); // Czekaj 1 sekundę na załadowanie
				scrollableContainer.scrollTo({ top: 0, behavior: 'instant' });
				await new Promise(resolve => setTimeout(resolve, 300));
				console.log('✅ Oferty załadowane');
			}

			// Znajdź wszystkie oferty (article elementy)
			const offerArticles = dialog.querySelectorAll('article._1e32a_kdIMd');
			console.log(`📊 Znaleziono ${offerArticles.length} ofert w dialogu`);

			if (offerArticles.length === 0) {
				console.log('⚠️ Brak ofert do analizy - może nie załadowały się?');
				// Spróbuj alternatywnego selektora
				const alternativeArticles = dialog.querySelectorAll('article');
				console.log(`🔍 Alternatywny selektor znalazł ${alternativeArticles.length} article elementów`);
			}

			// Ogranicz do pierwszych 5 ofert
			const offersToAnalyze = Array.from(offerArticles).slice(0, 5);
			const prices = [];

			console.log(`🎯 Analizuję ${offersToAnalyze.length} ofert...`);

			offersToAnalyze.forEach((article, index) => {
				console.log(`\n📦 Analizuję ofertę ${index + 1}/${offersToAnalyze.length}...`);

				const offerData = {
					position: index + 1,
					title: '',
					seller: '',
					sellerRecommendation: 0,
					sellerRatingsCount: 0,
					isSuperSeller: false,
					price: null,
					priceText: '',
					priceWithDelivery: null,
					priceWithDeliveryText: '',
					deliveryTime: '',
					condition: '',
					warranty: '',
					hasSmart: false,
					hasPay: false,
					offerUrl: ''
				};

				// Tytuł oferty i URL
				const titleLink = article.querySelector('h2 a._1e32a_zIS-q');
				if (titleLink) {
					offerData.title = titleLink.textContent.trim();
					offerData.offerUrl = titleLink.href;
					console.log(`   📝 Tytuł: "${offerData.title}"`);
				}

				// Sprzedawca
				const sellerNameSpan = article.querySelector('p.mgn2_12 span.mgmw_wo');
				if (sellerNameSpan) {
					offerData.seller = sellerNameSpan.textContent.trim();
					console.log(`   👤 Sprzedawca: "${offerData.seller}"`);
				}

				// Procent rekomendacji - szukamy tekstu "Poleca sprzedającego: X%"
				const recommendationText = article.textContent;
				const recommendationMatch = recommendationText.match(/Poleca sprzedającego:\s*(\d+[,.]?\d*)%/);
				if (recommendationMatch) {
					offerData.sellerRecommendation = parseFloat(recommendationMatch[1].replace(',', '.'));
					console.log(`   ⭐ Rekomendacja: ${offerData.sellerRecommendation}%`);
				}

				// Liczba ocen - szukamy liczby przed "ocen" lub "oceny"
				const ratingsMatch = recommendationText.match(/([\d\s,\.]+)\s*ocen/);
				if (ratingsMatch) {
					const ratingsStr = ratingsMatch[1].replace(/\s/g, '').replace(',', '');
					offerData.sellerRatingsCount = parseInt(ratingsStr, 10);
					console.log(`   📊 Liczba ocen: ${offerData.sellerRatingsCount}`);
				}

				// Super Sprzedawca
				const superSellerImg = article.querySelector('img[alt*="Super Sprzedaw"]');
				offerData.isSuperSeller = !!superSellerImg;
				if (offerData.isSuperSeller) {
					console.log(`   🌟 Super Sprzedawca: TAK`);
				}

				// Cena
				const priceElement = article.querySelector('p[aria-label*="aktualna cena"]');
				if (priceElement) {
					offerData.priceText = priceElement.getAttribute('aria-label') || '';
					const priceMatch = offerData.priceText.match(/([\d,]+)\s*zł/);
					if (priceMatch) {
						offerData.price = parseFloat(priceMatch[1].replace(',', '.'));
						console.log(`   💰 Cena: ${offerData.price} zł`);
						prices.push(offerData.price);
					}
				}

				// Cena z dostawą
				const deliveryPriceP = Array.from(article.querySelectorAll('p.mqu1_g3')).find(p =>
					p.textContent.includes('z dostawą')
				);
				if (deliveryPriceP) {
					offerData.priceWithDeliveryText = deliveryPriceP.textContent.trim();
					const priceMatch = offerData.priceWithDeliveryText.match(/([\d,]+)\s*zł/);
					if (priceMatch) {
						offerData.priceWithDelivery = parseFloat(priceMatch[1].replace(',', '.'));
						console.log(`   📦 Cena z dostawą: ${offerData.priceWithDelivery} zł`);
					}
				}

				// Czas dostawy - szukamy "dostawa pojutrze", "dostawa czw. X" itp.
				const deliverySpans = article.querySelectorAll('span._1e32a_sjD6n span');
				for (const span of deliverySpans) {
					const text = span.textContent.trim();
					if (text.startsWith('dostawa ')) {
						offerData.deliveryTime = text;
						console.log(`   🚚 Dostawa: "${offerData.deliveryTime}"`);
						break;
					}
				}

				// Stan i Gwarancja - z listy definicji
				const dlElements = article.querySelectorAll('dl._1e32a_BBBTh dt, dl._1e32a_BBBTh dd');
				let currentLabel = '';
				for (const el of dlElements) {
					if (el.tagName === 'DT') {
						currentLabel = el.textContent.trim();
					} else if (el.tagName === 'DD') {
						const value = el.textContent.trim();
						if (currentLabel === 'Stan') {
							offerData.condition = value;
							console.log(`   📋 Stan: "${offerData.condition}"`);
						} else if (currentLabel === 'Gwarancja') {
							offerData.warranty = value;
							console.log(`   🛡️ Gwarancja: "${offerData.warranty}"`);
						}
					}
				}

				// Allegro Smart
				const smartImg = article.querySelector('img[alt="Smart!"]');
				offerData.hasSmart = !!smartImg;
				if (offerData.hasSmart) {
					console.log(`   ✅ Allegro Smart: TAK`);
				}

				// Allegro Pay
				const payImg = article.querySelector('img[alt="Allegro Pay"]');
				offerData.hasPay = !!payImg;
				if (offerData.hasPay) {
					console.log(`   ✅ Allegro Pay: TAK`);
				}

				this.competitorOffers.push(offerData);
			});

			// Oblicz statystyki cenowe
			if (prices.length > 0) {
				this.lowestCompetitorPrice = Math.min(...prices);
				this.averageCompetitorPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
				console.log(`\n💰 Statystyki cen konkurencji:`);
				console.log(`   Najniższa cena: ${this.lowestCompetitorPrice.toFixed(2)} zł`);
				console.log(`   Średnia cena: ${this.averageCompetitorPrice.toFixed(2)} zł`);
			}

			// Sprawdź całkowitą liczbę ofert (z tekstu przycisku lub nagłówka)
			const offerCountText = dialog.textContent;
			const countMatch = offerCountText.match(/\((\d+)\s*ofert?\)/);
			if (countMatch) {
				this.competitorOffersCount = parseInt(countMatch[1], 10);
				console.log(`📊 Całkowita liczba kontrofert: ${this.competitorOffersCount}`);
			}

			console.log(`✅ Zebrano ${this.competitorOffers.length} kontrofert do analizy`);
			console.log(`📊 PODSUMOWANIE KONTROFERT:`);
			console.log(`   - Liczba przeanalizowanych ofert: ${this.competitorOffers.length}`);
			console.log(`   - Całkowita liczba kontrofert: ${this.competitorOffersCount}`);
			console.log(`   - Najniższa cena: ${this.lowestCompetitorPrice ? this.lowestCompetitorPrice.toFixed(2) + ' zł' : 'brak'}`);
			console.log(`   - Średnia cena: ${this.averageCompetitorPrice ? this.averageCompetitorPrice.toFixed(2) + ' zł' : 'brak'}`);
		}

		scanSellerInfo() {
			console.log('👤 Skanowanie informacji o sprzedawcy...');

			// CZĘŚĆ 1: Podstawowe informacje z nagłówka
			const sellerHeaderContainer = document.querySelector('div[data-box-name="showoffer.sellerInfoHeader"]');

			if (!sellerHeaderContainer) {
				console.log('⚠️ Nie znaleziono kontenera nagłówka sprzedawcy');
				this.sellerName = 'Nieznany';
				this.sellerRecommendationPercent = 0;
			} else {
				// Znajdź nazwę sprzedawcy - szukamy w divie który zawiera "od NAZWA"
				const sellerNameDiv = sellerHeaderContainer.querySelector('div.mp0t_ji.m9qz_yq');
				if (sellerNameDiv) {
					const fullText = sellerNameDiv.textContent.trim();
					// Wyciągnij nazwę po "od " (może być też "od<!-- --> <!-- -->NAZWA")
					const match = fullText.match(/od\s+(.+)$/);
					if (match) {
						this.sellerName = match[1].trim();
						console.log(`✅ Nazwa sprzedawcy: "${this.sellerName}"`);
					}
				}

				// Znajdź procent rekomendacji - szukamy w linku z "poleca X%" lub w aria-label
				const recommendationLink = sellerHeaderContainer.querySelector('a[data-analytics-click-label="sellerRating"]');
				if (recommendationLink) {
					// Metoda 1: Z aria-label (najbardziej niezawodne)
					const ariaLabel = recommendationLink.getAttribute('aria-label');
					if (ariaLabel) {
						const match = ariaLabel.match(/poleca\s+([\d,]+)%/);
						if (match) {
							// Zamień przecinek na kropkę i parsuj jako float
							const percentStr = match[1].replace(',', '.');
							this.sellerRecommendationPercent = parseFloat(percentStr);
							console.log(`✅ Procent rekomendacji (z aria-label): ${this.sellerRecommendationPercent}%`);
						}
					}

					// Metoda 2 (fallback): Z textContent
					if (!this.sellerRecommendationPercent || this.sellerRecommendationPercent === 0) {
						const recommendationText = recommendationLink.textContent.trim();
						const match = recommendationText.match(/poleca\s+([\d,]+)%/);
						if (match) {
							const percentStr = match[1].replace(',', '.');
							this.sellerRecommendationPercent = parseFloat(percentStr);
							console.log(`✅ Procent rekomendacji (z textContent): ${this.sellerRecommendationPercent}%`);
						}
					}
				}

				// Metoda 3 (dodatkowa): Szukaj w sekcji podsumowania - duży nagłówek z procentem
				if (!this.sellerRecommendationPercent || this.sellerRecommendationPercent === 0) {
					const summaryRatingLink = document.querySelector('a[data-analytics-interaction-label="ratingsLink"]');
					if (summaryRatingLink) {
						const ariaLabel = summaryRatingLink.getAttribute('aria-label');
						if (ariaLabel) {
							const match = ariaLabel.match(/([\d,]+)%\s+kupujących polec/);
							if (match) {
								const percentStr = match[1].replace(',', '.');
								this.sellerRecommendationPercent = parseFloat(percentStr);
								console.log(`✅ Procent rekomendacji (z sekcji podsumowania): ${this.sellerRecommendationPercent}%`);
							}
						}
					}
				}
			}

			if (!this.sellerName) {
				this.sellerName = 'Nieznany';
				console.log('⚠️ Nie udało się wyciągnąć nazwy sprzedawcy z nagłówka');
			}

			// CZĘŚĆ 2: Szczegółowe informacje z sekcji podsumowania
			const sellerSummaryContainer = document.querySelector('div[data-box-name="allegro.showoffer.seller.summary"]');

			if (!sellerSummaryContainer) {
				console.log('⚠️ Nie znaleziono kontenera podsumowania sprzedawcy (data-box-name="allegro.showoffer.seller.summary")');
				console.log('🔍 Próbuję alternatywnych metod...');

				// DEBUG: Sprawdź wszystkie kontenery z data-box-name
				const allBoxes = document.querySelectorAll('[data-box-name*="seller"]');
				console.log(`📊 Znaleziono ${allBoxes.length} kontenerów zawierających "seller" w data-box-name:`);
				allBoxes.forEach((box, i) => {
					console.log(`   ${i + 1}. data-box-name="${box.getAttribute('data-box-name')}"`);
				});

				return;
			}

			console.log('✅ Znaleziono kontener podsumowania sprzedawcy');

			// Znajdź nazwę firmy - w divie "Sprzedaż i wysyłka: FIRMA"
			const companyNameDiv = sellerSummaryContainer.querySelector('div.m3h2_16.mp0t_ji.m9qz_yo');
			if (companyNameDiv) {
				this.sellerCompanyName = companyNameDiv.textContent.trim();
				console.log(`✅ Nazwa firmy: "${this.sellerCompanyName}"`);

				// Sprawdź zgodność nazw
				if (this.sellerName && this.sellerCompanyName) {
					this.sellerCompanyNameMatch = this.sellerName.toLowerCase() === this.sellerCompanyName.toLowerCase();
					if (!this.sellerCompanyNameMatch) {
						console.log(`⚠️ NIEZGODNOŚĆ: Nazwa sprzedawcy "${this.sellerName}" różni się od nazwy firmy "${this.sellerCompanyName}"`);
					} else {
						console.log(`✅ Nazwy są zgodne`);
					}
				}
			}

			// Znajdź link do innych przedmiotów z kategorii
			const categoryLink = sellerSummaryContainer.querySelector('a[data-analytics-interaction-label="allSellersItemsFromCategoryLink"]');
			if (categoryLink) {
				this.sellerCategoryLink = categoryLink.href;
				// Wyciągnij nazwę kategorii z tekstu linku (po <strong>)
				const categoryStrong = categoryLink.querySelector('strong');
				if (categoryStrong) {
					this.sellerCategoryName = categoryStrong.textContent.trim();
				}
				console.log(`✅ Link do kategorii: "${this.sellerCategoryName}" (${this.sellerCategoryLink})`);
			}

			// Znajdź link do wszystkich przedmiotów sprzedającego
			const allItemsLink = sellerSummaryContainer.querySelector('a[data-analytics-interaction-label="allSellersItemsLink"]');
			if (allItemsLink) {
				this.sellerAllItemsLink = allItemsLink.href;
				console.log(`✅ Link do wszystkich przedmiotów: ${this.sellerAllItemsLink}`);
			}

			// Znajdź link "O sprzedającym"
			let aboutLink = sellerSummaryContainer.querySelector('a[data-analytics-interaction-label="aboutSellerBottomLink"]');
			if (!aboutLink) {
				// Fallback: Szukaj po href="#about-seller"
				aboutLink = sellerSummaryContainer.querySelector('a[href="#about-seller"]');
			}
			if (!aboutLink) {
				// Fallback 2: Szukaj po tekście "O sprzedającym"
				const allLinks = sellerSummaryContainer.querySelectorAll('a');
				for (const link of allLinks) {
					if (link.textContent.trim() === 'O sprzedającym') {
						aboutLink = link;
						break;
					}
				}
			}
			if (aboutLink) {
				this.sellerAboutLink = aboutLink.href;
				console.log(`✅ Link "O sprzedającym": ${this.sellerAboutLink}`);
			} else {
				console.log('⚠️ Nie znaleziono linku "O sprzedającym"');
				// DEBUG: Pokaż wszystkie linki w kontenerze
				const allLinks = sellerSummaryContainer.querySelectorAll('a');
				console.log(`🔍 DEBUG: Wszystkie linki w kontenerze (${allLinks.length}):`);
				allLinks.forEach((link, i) => {
					const href = link.href || 'brak';
					const text = link.textContent.trim().substring(0, 50);
					const label = link.getAttribute('data-analytics-interaction-label') || 'brak';
					console.log(`   ${i + 1}. text="${text}" href="${href}" label="${label}"`);
				});
			}

			// Znajdź link "Zadaj pytanie"
			let askQuestionLink = sellerSummaryContainer.querySelector('a[data-analytics-interaction-label="askQuestionBottomLink"]');
			if (!askQuestionLink) {
				// Fallback: Szukaj po href="#ask-question"
				askQuestionLink = sellerSummaryContainer.querySelector('a[href="#ask-question"]');
			}
			if (!askQuestionLink) {
				// Fallback 2: Szukaj po tekście "Zadaj pytanie"
				const allLinks = sellerSummaryContainer.querySelectorAll('a');
				for (const link of allLinks) {
					if (link.textContent.trim() === 'Zadaj pytanie') {
						askQuestionLink = link;
						break;
					}
				}
			}
			if (!askQuestionLink) {
				// Fallback 3: Szukaj po aria-label
				const allLinks = sellerSummaryContainer.querySelectorAll('a');
				for (const link of allLinks) {
					const ariaLabel = link.getAttribute('aria-label');
					if (ariaLabel && ariaLabel.includes('Zadaj pytanie')) {
						askQuestionLink = link;
						break;
					}
				}
			}
			if (askQuestionLink) {
				this.sellerAskQuestionLink = askQuestionLink.href;
				console.log(`✅ Link "Zadaj pytanie": ${this.sellerAskQuestionLink}`);
			} else {
				console.log('⚠️ Nie znaleziono linku "Zadaj pytanie"');
				// Jeśli nie było już debugowania (bo wcześniej znaleziono link "O sprzedającym")
				if (this.sellerAboutLink) {
					const allLinks = sellerSummaryContainer.querySelectorAll('a');
					console.log(`🔍 DEBUG: Wszystkie linki w kontenerze (${allLinks.length}):`);
					allLinks.forEach((link, i) => {
						const href = link.href || 'brak';
						const text = link.textContent.trim().substring(0, 50);
						const label = link.getAttribute('data-analytics-interaction-label') || 'brak';
						console.log(`   ${i + 1}. text="${text}" href="${href}" label="${label}"`);
					});
				}
			}

			console.log(`📊 Zebrano szczegółowe informacje o sprzedawcy: "${this.sellerName}" (${this.sellerRecommendationPercent}% rekomendacji)`);
		}

		scanDescription() {
			console.log('📝 Skanowanie opisu aukcji...');

			// Resetuj dane opisu
			this.descriptionHtml = '';
			this.descriptionText = '';
			this.descriptionLength = 0;
			this.descriptionHasImages = false;
			this.descriptionImagesCount = 0;

			// KROK 1: Znajdź kontener opisu
			let descriptionContainer = document.querySelector('div[data-box-name="Description"]');

			if (!descriptionContainer) {
				// Fallback - szukaj po itemprop
				descriptionContainer = document.querySelector('div[itemprop="description"]');
			}

			if (!descriptionContainer) {
				console.log('❌ Nie znaleziono kontenera opisu');
				return;
			}

			console.log('✅ Znaleziono kontener opisu');

			// KROK 2: Wyodrębnij HTML opisu
			// Szukamy głównego kontenera z treścią opisu (itemprop="description")
			const descriptionContent = descriptionContainer.querySelector('div[itemprop="description"]');

			if (descriptionContent) {
				this.descriptionHtml = descriptionContent.innerHTML;
				console.log(`📦 Wyodrębniono HTML opisu (${this.descriptionHtml.length} znaków HTML)`);
			} else {
				// Fallback - użyj całego kontenera
				this.descriptionHtml = descriptionContainer.innerHTML;
				console.log(`📦 Wyodrębniono HTML opisu z całego kontenera (${this.descriptionHtml.length} znaków HTML)`);
			}

			// KROK 3: Wyodrębnij tekst (bez tagów HTML)
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = this.descriptionHtml;
			this.descriptionText = tempDiv.textContent || tempDiv.innerText || '';
			this.descriptionText = this.descriptionText.trim();
			this.descriptionLength = this.descriptionText.length;

			console.log(`📊 Liczba znaków opisu (tekst): ${this.descriptionLength}`);

			// KROK 4: Policz obrazy w opisie
			const images = descriptionContent ? descriptionContent.querySelectorAll('img') : descriptionContainer.querySelectorAll('img');
			this.descriptionImagesCount = images.length;
			this.descriptionHasImages = this.descriptionImagesCount > 0;

			console.log(`🖼️ Obrazów w opisie: ${this.descriptionImagesCount}`);

			// Pokaż przykładowe obrazy (pierwsze 3)
			if (this.descriptionImagesCount > 0) {
				const imagesToShow = Math.min(3, this.descriptionImagesCount);
				console.log(`   Przykładowe obrazy (${imagesToShow} z ${this.descriptionImagesCount}):`);
				for (let i = 0; i < imagesToShow; i++) {
					const img = images[i];
					const src = img.src || img.getAttribute('data-src');
					const alt = img.alt || 'Brak opisu';
					console.log(`   ${i + 1}. ${alt.substring(0, 50)}${alt.length > 50 ? '...' : ''}`);
					console.log(`      URL: ${src?.substring(0, 80)}${src && src.length > 80 ? '...' : ''}`);
				}
			}

			// KROK 5: Oblicz procent pogrubionego tekstu (bold/strong)
			this.descriptionBoldPercent = 0;

			if (descriptionContent || descriptionContainer) {
				const container = descriptionContent || descriptionContainer;

				// Znajdź wszystkie elementy bold i strong
				const boldElements = container.querySelectorAll('b, strong');

				if (boldElements.length > 0 && this.descriptionLength > 0) {
					// Policz łączną długość pogrubionego tekstu
					let boldTextLength = 0;
					boldElements.forEach(el => {
						const text = el.textContent || '';
						boldTextLength += text.length;
					});

					// Oblicz procent
					this.descriptionBoldPercent = Math.round((boldTextLength / this.descriptionLength) * 100);

					console.log(`📊 Analiza pogrubień:`);
					console.log(`   - Elementów <b>/<strong>: ${boldElements.length}`);
					console.log(`   - Znaków pogrubionych: ${boldTextLength}`);
					console.log(`   - Procent pogrubionego tekstu: ${this.descriptionBoldPercent}%`);
				} else {
					console.log(`📊 Brak pogrubień w opisie`);
				}
			}

			console.log('✅ Skanowanie opisu zakończone');
			console.log(`   Znaków: ${this.descriptionLength}`);
			console.log(`   Obrazów: ${this.descriptionImagesCount}`);
			console.log(`   Pogrubień: ${this.descriptionBoldPercent}%`);
		}

		normalizeText(text) {
			if (!text) return '';

			// Konwertuj na lowercase i usuń nadmiarowe białe znaki
			let normalized = text.toLowerCase().trim();

			// Zamień polskie znaki na ich odpowiedniki ASCII
			const polishChars = {
				'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
				'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z'
			};

			normalized = normalized.replace(/[ąćęłńóśźż]/g, char => polishChars[char] || char);

			// Usuń znaki interpunkcyjne (zachowaj spacje i cyfry)
			normalized = normalized.replace(/[^\w\s]/g, ' ');

			// Zamień wielokrotne spacje na pojedyncze
			normalized = normalized.replace(/\s+/g, ' ').trim();

			return normalized;
		}

		extractContext(text, searchPhrase, wordsBefore = 2, wordsAfter = 2) {
			// Funkcja wyciąga fragment tekstu: 2 słowa przed + fraza + 2 słowa po
			const words = text.split(' ');
			const phraseWords = searchPhrase.split(' ');

			// Znajdź indeks pierwszego słowa frazy
			for (let i = 0; i < words.length - phraseWords.length + 1; i++) {
				let match = true;
				for (let j = 0; j < phraseWords.length; j++) {
					if (words[i + j] !== phraseWords[j]) {
						match = false;
						break;
					}
				}

				if (match) {
					// Znaleziono frazę - wyciągnij kontekst
					const startIdx = Math.max(0, i - wordsBefore);
					const endIdx = Math.min(words.length, i + phraseWords.length + wordsAfter);

					let context = '';
					if (startIdx > 0) context += '...';
					context += words.slice(startIdx, endIdx).join(' ');
					if (endIdx < words.length) context += '...';

					return context;
				}
			}

			return null;
		}

		analyzeParametersInDescription() {
			console.log('🔍 Analizuję obecność parametrów w opisie...');

			if (!this.descriptionText || this.descriptionText.length === 0) {
				console.log('⚠️ Brak opisu - pomijam analizę parametrów');
				this.parametersInDescription = [];
				this.parametersInDescriptionScore = 0;
				return;
			}

			if (!this.productParameters || this.productParameters.length === 0) {
				console.log('⚠️ Brak parametrów produktu - pomijam analizę');
				this.parametersInDescription = [];
				this.parametersInDescriptionScore = 0;
				return;
			}

			// Normalizuj opis do przeszukiwania
			const normalizedDescription = this.normalizeText(this.descriptionText);
			console.log(`📝 Znormalizowany opis (pierwsze 200 znaków): "${normalizedDescription.substring(0, 200)}..."`);

			const results = [];
			let foundCount = 0;
			let totalAnalyzedParams = 0; // Licznik parametrów które faktycznie analizujemy

			// Lista parametrów do pominięcia (nie można ich umieszczać w opisie według regulaminu Allegro)
			const excludedParams = ['stan', 'faktura'];

			// Przeanalizuj każdy parametr
			this.productParameters.forEach((param, index) => {
				const paramName = param.name || '';
				const paramValue = param.value || '';

				// Pomiń parametry "Stan" i "Faktura" - sprzedawcy nie mogą ich umieszczać w opisie
				if (excludedParams.includes(paramName.toLowerCase())) {
					console.log(`   ⏭️ ${index + 1}. "${paramName}" - POMINIĘTO (nie może być w opisie według regulaminu)`);
					return;
				}

				if (!paramValue) {
					console.log(`   ${index + 1}. "${paramName}" - POMINIĘTO (brak wartości)`);
					return;
				}

				totalAnalyzedParams++; // Licznik parametrów które sprawdzamy

				// Normalizuj wartość parametru
				const normalizedValue = this.normalizeText(paramValue);

				// Sprawdź czy wartość występuje w opisie
				let found = false;
				let context = '';

				// Metoda 1: Sprawdź całą frazę
				if (normalizedDescription.includes(normalizedValue)) {
					found = true;
					context = this.extractContext(normalizedDescription, normalizedValue, 2, 2);
					console.log(`   ✅ ${index + 1}. "${paramName}": "${paramValue}" - ZNALEZIONO (całą frazę)`);
					console.log(`      Kontekst: "${context}"`);
				} else {
					// Metoda 2: Sprawdź poszczególne słowa (dla wartości wielowyrazowych)
					const words = normalizedValue.split(' ').filter(w => w.length > 2); // Słowa dłuższe niż 2 znaki
					if (words.length > 0) {
						const foundWords = words.filter(word => normalizedDescription.includes(word));
						if (foundWords.length === words.length) {
							found = true;
							// Znajdź kontekst dla pierwszego znalezionego słowa
							context = this.extractContext(normalizedDescription, foundWords[0], 2, 2);
							console.log(`   ✅ ${index + 1}. "${paramName}": "${paramValue}" - ZNALEZIONO (wszystkie słowa)`);
							console.log(`      Kontekst: "${context}"`);
						} else if (foundWords.length > 0) {
							found = true; // Częściowe dopasowanie
							context = this.extractContext(normalizedDescription, foundWords[0], 2, 2);
							console.log(`   🟡 ${index + 1}. "${paramName}": "${paramValue}" - CZĘŚCIOWO (${foundWords.length}/${words.length} słów)`);
							console.log(`      Kontekst: "${context}"`);
						} else {
							console.log(`   ❌ ${index + 1}. "${paramName}": "${paramValue}" - NIE ZNALEZIONO`);
						}
					} else {
						console.log(`   ❌ ${index + 1}. "${paramName}": "${paramValue}" - NIE ZNALEZIONO`);
					}
				}

				if (found) foundCount++;

				results.push({
					name: paramName,
					value: paramValue,
					link: param.link || null,
					found: found,
					context: context || '-'
				});
			});

			this.parametersInDescription = results;
			// Oblicz score na podstawie TYLKO przeanalizowanych parametrów (pomijając Stan i Faktura)
			this.parametersInDescriptionScore = totalAnalyzedParams > 0
				? Math.round((foundCount / totalAnalyzedParams) * 100)
				: 0;

			console.log(`📊 Wynik analizy: ${foundCount}/${totalAnalyzedParams} parametrów znalezionych w opisie (${this.parametersInDescriptionScore}%)`);
			console.log(`   (Pominięto ${this.productParameters.length - totalAnalyzedParams} parametrów: Stan, Faktura)`);
		}

		async analyzeImageWithAI() {
			console.log('🤖 Rozpoczynam analizę AI miniaturki...');

			// Sprawdź czy mamy miniaturę do analizy
			if (!this.hasThumbnail || !this.thumbnailData.src) {
				console.log('⚠️ Brak miniatury - pomijam analizę AI obrazu');
				return;
			}

			try {
				// Pobierz oryginalny URL obrazu (nie miniaturkę)
				const originalImageUrl = this.imageQualityAnalyzer.getOriginalImageUrl(this.thumbnailData.src);
				console.log('📸 URL obrazu do analizy AI:', originalImageUrl);

				// Wywołaj backend API
				const userEmail = authManager.getUserEmail();
				if (!userEmail) {
					throw new Error('Użytkownik nie jest zalogowany');
				}

				const apiUrl = `${AI_API_URL}?action=analyze_image&email=${encodeURIComponent(userEmail)}&imageUrl=${encodeURIComponent(originalImageUrl)}`;
				console.log('📤 Wysyłam żądanie do Apps Script (analiza obrazu)...');
				console.log(`   - Email: ${userEmail}`);
				console.log(`   - Oryginalny URL: ${originalImageUrl.substring(0, 80)}...`);

				const response = await extensionFetch(apiUrl);
				console.log(`📥 Odpowiedź HTTP (obraz): status ${response.status}`);

				if (!response.ok) {
					const errorText = await response.text().catch(() => 'Brak szczegółów błędu');
					console.error(`❌ Błąd HTTP ${response.status}:`, errorText);
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const result = await response.json();

				if (result.success && result.data) {
					this.aiImageAnalysis = result.data;
					console.log('✅ Otrzymano analizę AI obrazu');
					console.log(`📊 Ocena AI: ${this.aiImageAnalysis.overallAIScore}%`);

					// Loguj koszty do arkusza (jeśli backend zwrócił informacje o tokenach)
					if (result.data.inputTokens && result.data.outputTokens) {
						const costLog = costCalculator.createCostLog(
							authManager.getUserEmail(),
							result.data.inputTokens,
							result.data.outputTokens,
							'analyze_image',
							{
								offerUrl: window.location.href,
								offerName: this.offerName || this.productName || '',
								imageUrl: originalImageUrl.substring(0, 100),
								imageResolution: `${this.imageQuality.resolution.width}x${this.imageQuality.resolution.height}`
							}
						);

						// Logowanie asynchroniczne - nie blokuj procesu
						authManager.logAICosts(costLog).catch(err => {
							console.warn('⚠️ Nie udało się zalogować kosztów analizy obrazu:', err.message);
						});
					}
				} else {
					console.log('⚠️ Brak analizy w odpowiedzi:', result.message);
					this.aiImageAnalysis.summary = `⚠️ ${result.message || 'Nie udało się uzyskać analizy'}`;
				}
			} catch (error) {
				console.error('❌ Błąd podczas analizy AI obrazu:', error);
				// Nie przerywaj całego procesu - zachowaj domyślną strukturę z informacją o błędzie
				if (!this.aiImageAnalysis.aiErrors) {
					this.aiImageAnalysis.aiErrors = [];
				}
				this.aiImageAnalysis.aiErrors.push(`Błąd analizy AI: ${error.message}`);
				this.aiImageAnalysis.summary = `⚠️ Wystąpił błąd podczas analizy AI.\n\nW razie problemów skontaktuj się z nami: damian@vautomate.pl\n\n---\n\n❌ Szczegóły błędu:\n${error.message}`;
			}
		}

		async analyzeDescriptionWithAI() {
			console.log('🤖 Wysyłam opis do analizy AI...');

			if (!this.descriptionText || this.descriptionText.length < 10) {
				console.log('⚠️ Opis zbyt krótki - pomijam analizę AI');
				this.descriptionAiAnalysis = '';
				return;
			}

			if (!authManager || !authManager.isLoggedIn()) {
				console.log('⚠️ Użytkownik niezalogowany - pomijam analizę AI');
				this.descriptionAiAnalysis = '';
				return;
			}

			try {
				// Przygotuj dane do wysłania
				const requestData = {
					action: 'analyze_description_ai',
					title: this.offerName || this.productName || '',
					parameters: this.productParameters.map(p => ({
						name: p.name,
						value: p.value
					})),
					description: this.descriptionText
				};

				console.log('📤 Wysyłam dane do Apps Script (analiza opisu)...');
				console.log(`   - Tytuł: "${requestData.title}"`);
				console.log(`   - Parametry: ${requestData.parameters.length}`);
				console.log(`   - Opis: ${requestData.description.length} znaków`);
				console.log(`   - API URL: ${authManager.API_URL}`);

				const response = await extensionFetch(AI_API_URL, {
					method: 'POST',
					headers: {
						'Content-Type': 'text/plain;charset=utf-8',
					},
					body: JSON.stringify(requestData)
				});

				console.log(`📥 Odpowiedź HTTP (opis): status ${response.status}`);

				if (!response.ok) {
					const errorText = await response.text().catch(() => 'Brak szczegółów błędu');
					console.error(`❌ Błąd HTTP ${response.status}:`, errorText);
					throw new Error(`HTTP error! status: ${response.status}`);
				}

				const result = await response.json();

				if (result.success && result.data && result.data.analysis) {
					this.descriptionAiAnalysis = result.data.analysis;
					this.descriptionAiTokensUsed = result.data.tokensUsed || 0;
					console.log('✅ Otrzymano analizę AI opisu');
					console.log(`📊 Tokeny użyte: ${this.descriptionAiTokensUsed}`);
					console.log(`📝 Długość analizy: ${this.descriptionAiAnalysis.length} znaków`);

					// Loguj koszty do arkusza (jeśli backend zwrócił informacje o tokenach)
					if (result.data.inputTokens && result.data.outputTokens) {
						const costLog = costCalculator.createCostLog(
							authManager.getUserEmail(),
							result.data.inputTokens,
							result.data.outputTokens,
							'analyze_description',
							{
								offerUrl: window.location.href,
								offerName: this.offerName || this.productName || '',
								descriptionLength: this.descriptionText.length,
								parametersCount: this.productParameters.length
							}
						);

						// Logowanie asynchroniczne - nie blokuj procesu
						authManager.logAICosts(costLog).catch(err => {
							console.warn('⚠️ Nie udało się zalogować kosztów analizy opisu:', err.message);
						});
					}
				} else {
					console.log('⚠️ Brak analizy w odpowiedzi:', result.message);
					this.descriptionAiAnalysis = `⚠️ ${result.message || 'Nie udało się uzyskać analizy'}`;
				}

			} catch (error) {
				console.error('❌ Błąd podczas analizy AI opisu:', error);
				this.descriptionAiAnalysis = `⚠️ Wystąpił błąd podczas analizy AI.\n\nW razie problemów skontaktuj się z nami: damian@vautomate.pl\n\n---\n\n❌ Szczegóły błędu:\n${error.message}`;
			}
		}

		async closeTrustInfoDialog() {
			console.log('🔄 Zamykam okno Allegro Ochrona...');

			// Znajdź przycisk zamykania w dialogu Allegro Ochrona
			const closeButton = [...document.querySelectorAll('button[aria-label="Zamknij"]')].find(btn => {
				// Sprawdź czy przycisk jest w dialogu z Allegro Ochrona
				const dialog = btn.closest('[role="dialog"]');
				if (!dialog) return false;

				// Sprawdź czy to właściwy dialog (zawiera TrustShow)
				return dialog.querySelector('[data-box-name="TrustShow"]') !== null;
			});

			if (closeButton) {
				closeButton.click();
				console.log('✅ Kliknięto przycisk zamykania okna Allegro Ochrona');
				await new Promise(resolve => setTimeout(resolve, 300)); // Poczekaj na animację zamknięcia
				// Resetuj flagę po zamknięciu żeby móc otworzyć ponownie w następnym skanowaniu
				this.trustInfoOpened = false;
			} else {
				console.log('⚠️ Nie znaleziono przycisku zamykania dla okna Allegro Ochrona');
			}
		}

		async closeParametersDialog() {
			console.log('🔄 Zamykam okno parametrów...');

			// Znajdź przycisk zamykania w dialogu parametrów
			const closeButtons = document.querySelectorAll('button[aria-label="Zamknij"]');
			console.log(`🔍 Znaleziono ${closeButtons.length} przycisków "Zamknij"`);

			const closeButton = [...closeButtons].find(btn => {
				// Sprawdź czy przycisk jest w dialogu z parametrami
				const dialog = btn.closest('[role="dialog"]');
				if (!dialog) return false;

				// Sprawdź czy to właściwy dialog (zawiera parametry)
				const hasAriaLabel = dialog.getAttribute('aria-labelledby') === 'Parametry';
				const hasSidebarParams = dialog.querySelector('[data-box-name="Sidebar Parameters"]') !== null;

				if (hasAriaLabel || hasSidebarParams) {
					console.log(`✅ Znaleziono przycisk zamykania w dialogu parametrów (aria-label: ${hasAriaLabel}, Sidebar: ${hasSidebarParams})`);
					return true;
				}
				return false;
			});

			if (closeButton) {
				closeButton.click();
				console.log('✅ Kliknięto przycisk zamykania okna parametrów');
				await new Promise(resolve => setTimeout(resolve, 300)); // Poczekaj na animację zamknięcia
				// Resetuj flagę po zamknięciu żeby móc otworzyć ponownie w następnym skanowaniu
				this.parametersOpened = false;
				console.log('🔄 Flaga parametersOpened zresetowana na false');
			} else {
				console.log('⚠️ Nie znaleziono przycisku zamykania dla okna parametrów');
				console.log('🔍 DEBUG: Dialogi na stronie:');
				const allDialogs = document.querySelectorAll('[role="dialog"]');
				allDialogs.forEach((dialog, i) => {
					const ariaLabel = dialog.getAttribute('aria-labelledby') || 'brak';
					const hasSidebar = !!dialog.querySelector('[data-box-name="Sidebar Parameters"]');
					console.log(`   ${i + 1}. aria-labelledby="${ariaLabel}" hasSidebar=${hasSidebar}`);
				});
			}
		}

		async ensureTrustInfoLoaded() {
			console.log('🔄 Sprawdzam czy dane TrustInfo są załadowane...');

			// Sprawdź flagę - jeśli już otwieraliśmy podczas tego skanowania, nie otwieraj ponownie
			if (this.trustInfoOpened) {
				console.log('✅ Sekcja TrustInfo została już otwarta podczas tego skanowania - pomijam');
				return;
			}

			// Sprawdź czy OKNO DIALOGOWE z TrustShow jest OTWARTE (nie tylko czy sekcja istnieje w DOM)
			const trustDialog = [...document.querySelectorAll('[role="dialog"]')].find(dialog =>
				dialog.querySelector('[data-box-name="TrustShow"]') !== null
			);

			if (trustDialog) {
				// Sprawdź czy dialog jest widoczny
				const style = window.getComputedStyle(trustDialog);
				const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

				if (isVisible) {
					console.log('✅ Okno dialogowe z TrustShow jest już otwarte');
					this.trustInfoOpened = true; // Oznacz jako otwarte
					return;
				}
			}

			// Znajdź przycisk TrustInfo - różne możliwe selektory na podstawie HTML
			const trustButton = document.querySelector('button[data-analytics-interaction-label="TrustInfo"]') ||
				document.querySelector('button[data-analytics-view-label="TrustInfo"]') ||
				document.querySelector('button[data-analytics-interaction-custom-url="#trust-info"]') ||
				document.querySelector('button[data-analytics-interaction-custom-url*="trust-info"]') ||
				// Na podstawie podanego HTML - szukaj po tekście w przycisku
				[...document.querySelectorAll('button')].find(btn =>
					btn.textContent && (
						btn.textContent.includes('Zwrot za darmo - 14 dni') ||
						btn.textContent.includes('Reklamacja | Gwarancja | Allegro Ochrona Kupujących') ||
						btn.textContent.includes('Reklamacja') && btn.textContent.includes('Gwarancja')
					)
				);

			if (!trustButton) {
				console.log('⚠️ Nie znaleziono przycisku TrustInfo - kontynuuję bez kliknięcia');
				// DEBUG: Pokaż dostępne przyciski
				const allButtons = document.querySelectorAll('button');
				console.log(`🔍 DEBUG: Znaleziono ${allButtons.length} przycisków na stronie`);
				return;
			}

			console.log('🖱️ Znaleziono przycisk TrustInfo - automatyczne kliknięcie...');
			console.log('🔍 DEBUG: Tekst przycisku:', trustButton.textContent?.substring(0, 100));

			// Symuluj kliknięcie
			try {
				trustButton.click();
				console.log('✅ Kliknięto przycisk TrustInfo');

				// Poczekaj na załadowanie danych
				console.log('⏳ Czekam na załadowanie danych TrustShow...');

				// Sprawdzaj przez maksymalnie 3 sekundy czy sekcja się pojawiła
				for (let i = 0; i < 30; i++) {
					await new Promise(resolve => setTimeout(resolve, 100)); // czekaj 100ms

					const trustShowSection = document.querySelector('[data-box-name="TrustShow"]');
					if (trustShowSection) {
						console.log(`✅ Sekcja TrustShow załadowana po ${(i + 1) * 100}ms`);
						this.trustInfoOpened = true; // Oznacz jako pomyślnie otwarte
						return;
					}
				}

				console.log('⚠️ Timeout: Sekcja TrustShow nie załadowała się w ciągu 3 sekund');

			} catch (error) {
				console.log('❌ Błąd podczas kliknięcia przycisku TrustInfo:', error);
			}
		}

		async ensureParametersLoaded() {
			console.log('🔄 Sprawdzam czy parametry produktu są załadowane...');

			// Sprawdź flagę - jeśli już otwieraliśmy podczas tego skanowania, nie otwieraj ponownie
			if (this.parametersOpened) {
				console.log('✅ Sekcja parametrów została już otwarta podczas tego skanowania - pomijam');
				return;
			}

			// Sprawdź czy OKNO DIALOGOWE z parametrami jest OTWARTE (nie tylko czy tabela istnieje w DOM)
			const parametersDialog = document.querySelector('[role="dialog"][aria-labelledby="Parametry"]');

			if (parametersDialog) {
				// Sprawdź czy dialog jest widoczny
				const style = window.getComputedStyle(parametersDialog);
				const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

				if (isVisible) {
					console.log('✅ Okno dialogowe z parametrami jest już otwarte');
					this.parametersOpened = true; // Oznacz jako otwarte
					return;
				}
			}

			// Znajdź link do parametrów - różne możliwe selektory
			const parametersLink = document.querySelector('a[href="#parametry"]') ||
				document.querySelector('a[data-analytics-interaction-value="parametersOpenSidebar"]') ||
				[...document.querySelectorAll('a')].find(link =>
					link.textContent && link.textContent.includes('wszystkie parametry')
				);

			if (!parametersLink) {
				console.log('⚠️ Nie znaleziono linku do parametrów - kontynuuję bez kliknięcia');
				// DEBUG: Pokaż dostępne linki
				const allLinks = document.querySelectorAll('a[href*="parametr"]');
				console.log(`🔍 DEBUG: Znaleziono ${allLinks.length} linków zawierających "parametr"`);
				return;
			}

			console.log('🖱️ Znaleziono link do parametrów - automatyczne kliknięcie...');
			console.log('🔍 DEBUG: Tekst linku:', parametersLink.textContent?.substring(0, 100));
			console.log('🔍 DEBUG: href:', parametersLink.href);

			// Symuluj kliknięcie
			try {
				parametersLink.click();
				console.log('✅ Kliknięto link do parametrów');

				// Poczekaj na załadowanie danych
				console.log('⏳ Czekam na załadowanie tabeli parametrów...');

				// Sprawdzaj przez maksymalnie 3 sekundy czy tabela się pojawiła
				for (let i = 0; i < 30; i++) {
					await new Promise(resolve => setTimeout(resolve, 100)); // czekaj 100ms

					// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody (parametry mogą być w wielu tbody)
					let parametersTable = document.querySelector('[data-box-name="Sidebar Parameters"] table') ||
						document.querySelector('[role="dialog"][aria-labelledby="Parametry"] table');

					// Dla table.myre_zn musimy sprawdzić czy to faktycznie tabela parametrów
					if (!parametersTable) {
						const tempTable = document.querySelector('table.myre_zn');
						if (tempTable && (tempTable.querySelector('tr td._3c6dd_ipdVK') || tempTable.querySelector('tr td._3c6dd_SpQem'))) {
							parametersTable = tempTable;
						}
					}

					if (parametersTable) {
						console.log(`✅ Tabela parametrów załadowana po ${(i + 1) * 100}ms`);
						console.log(`🔍 Tabela ma ${parametersTable.querySelectorAll('tbody').length} sekcji <tbody>`);
						this.parametersOpened = true; // Oznacz jako pomyślnie otwarte
						return;
					}
				}

				console.log('⚠️ Timeout: Tabela parametrów nie załadowała się w ciągu 3 sekund');

			} catch (error) {
				console.log('❌ Błąd podczas kliknięcia linku parametrów:', error);
			}
		}

		async performSequentialScan() {
			console.log('🔄 ROZPOCZYNAM SEKWENCYJNE SKANOWANIE DO RAPORTU PDF');

			// KROK 0A: Zbierz informacje o sprzedawcy (na samym początku, nie wymaga lazy loading)
			console.log('👤 KROK 0A: Zbieranie informacji o sprzedawcy...');
			this.scanSellerInfo();

			// KROK 0B: Przewiń stronę w dół i w górę aby załadować wszystkie dynamiczne elementy (lazy loading)
			try {
				console.log('📜 Przewijam stronę w dół dla załadowania dynamicznych elementów...');
				window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
				await new Promise(resolve => setTimeout(resolve, 500));
				console.log('📜 Przewijam stronę do góry...');
				window.scrollTo({ top: 0, behavior: 'instant' });
				await new Promise(resolve => setTimeout(resolve, 200));
			} catch (e) {
				console.log('⚠️ Błąd podczas przewijania strony:', e.message);
			}

			// Resetuj wszystkie flagi na początek
			console.log('🔄 Resetuję flagi...');
			this.hasAllegroSmart = false;
			this.hasBestPriceGuarantee = false;
			this.hasAllegroPay = false;
			this.allegroPayType = '';
			this.allegroPayDetails = '';
			this.trustInfoOpened = false;
			this.parametersOpened = false;
			this.hasReturnPolicy = false;
			this.returnDays = 0;
			this.hasComplaintPolicy = false;
			this.complaintPeriod = '';
			this.hasWarranty = false;
			this.warrantyPeriod = '';
			this.hasAllegroProtect = false;
			this.allegroProtectPeriod = '';
			this.protectionQuality = 0;

			// KROK 1: Zbierz dane dostępne od razu
			console.log('📊 KROK 1: Zbieranie danych dostępnych od razu...');
			this.productName = this.getProductName();
			this.offerName = this.getOfferName();
			this.nameMatchStatus = this.compareNames();
			this.getProductRating();
			this.evaluateProductRating();
			await this.checkThumbnail();
			this.scanAllImages();
			this.checkAllegroFeatures();
			this.scanCoinsAndCoupons();
			this.scanPromotionalSections();
			await this.scanBundleSection(); // await bo teraz czeka na załadowanie elementów

			console.log('✅ KROK 1 gotów - dane podstawowe zebrane');

			// KROK 1.9: Skanuj "Propozycje dla Ciebie" (po zestawach, po scrollu - elementy już załadowane)
			console.log('📊 KROK 1.9: Skanowanie sekcji "Propozycje dla Ciebie"...');
			this.scanSuggestionsSection();

			// KROK 1.10: Skanuj opis aukcji
			console.log('📊 KROK 1.10: Skanowanie opisu aukcji...');
			this.scanDescription();

			// KROK 2: Otwórz sekcję Allegro Ochrona, zbierz dane, zamknij
			console.log('📊 KROK 2: Otwieram sekcję Allegro Ochrona...');
			await this.ensureTrustInfoLoaded();

			// Czekaj 0,7 sekundy żeby dane się załadowały
			console.log('⏳ Czekam 0,7 sekundy na załadowanie danych Allegro Ochrony...');
			await new Promise(resolve => setTimeout(resolve, 700));

			// Zbierz dane z sekcji Allegro Ochrona
			console.log('📝 [SEQ] Zbieranie danych z sekcji Allegro Ochrona...');

			// DEBUG: Sprawdź czy dialog jest otwarty
			const allDialogs = document.querySelectorAll('[role="dialog"]');
			console.log(`🔍 [SEQ] DEBUG: Znaleziono ${allDialogs.length} dialogów na stronie`);

			// Szukaj dialogu z Allegro Ochrona
			let trustDialog = null;
			for (const dialog of allDialogs) {
				const dialogTitle = dialog.getAttribute('aria-labelledby');
				const hasTrustShow = dialog.querySelector('[data-box-name="TrustShow"]');
				const hasTrustProtect = dialog.querySelector('[data-box-name="TrustAllegroProtect"]');

				console.log(`  Dialog: aria-labelledby="${dialogTitle}", TrustShow=${!!hasTrustShow}, TrustProtect=${!!hasTrustProtect}`);

				if (hasTrustShow || hasTrustProtect) {
					trustDialog = dialog;
					console.log('✅ [SEQ] Znaleziono dialog z sekcją Allegro Ochrony');
					break;
				}
			}

			// Jeśli znaleziono dialog, szukaj sekcji wewnątrz niego
			let trustShowSection = null;
			if (trustDialog) {
				trustShowSection = trustDialog.querySelector('[data-box-name="TrustShow"]');
				if (!trustShowSection) {
					trustShowSection = trustDialog.querySelector('[data-box-name="TrustAllegroProtect"]');
				}
			}

			// Fallback: Szukaj globalnie (na wypadek gdyby dialog nie był wykryty)
			if (!trustShowSection) {
				console.log('⚠️ [SEQ] Nie znaleziono w dialogu, szukam globalnie...');
				trustShowSection = document.querySelector('[data-box-name="TrustShow"]');
				if (!trustShowSection) {
					trustShowSection = document.querySelector('[data-box-name="TrustAllegroProtect"]');
				}
			}

			if (trustShowSection) {
				console.log('✅ [SEQ] Znaleziono sekcję Allegro Ochrony');
				console.log(`🔍 [SEQ] DEBUG: Rozmiar HTML sekcji: ${trustShowSection.innerHTML.length} znaków`);
				console.log(`🔍 [SEQ] DEBUG: Czy zawiera "14 dni": ${trustShowSection.innerHTML.includes('14 dni')}`);
				console.log(`🔍 [SEQ] DEBUG: Czy zawiera "2 lata": ${trustShowSection.innerHTML.includes('2 lata')}`);
				console.log(`🔍 [SEQ] DEBUG: Czy zawiera "24 miesiące": ${trustShowSection.innerHTML.includes('24 miesiące')}`);

				this.scanReturnPolicy(trustShowSection);
				this.scanComplaintPolicy(trustShowSection);
				this.scanWarranty(trustShowSection);
				this.scanAllegroProtect(trustShowSection);
				this.calculateProtectionQuality();
				console.log('✅ Dane Allegro Ochrony zebrane');
				console.log(`  📊 Wynik: Zwrot=${this.hasReturnPolicy} (${this.returnDays}d), Reklamacja=${this.hasComplaintPolicy}, Gwarancja=${this.hasWarranty}, Protect=${this.hasAllegroProtect}`);
			} else {
				console.log('⚠️ [SEQ] Nie znaleziono sekcji Allegro Ochrony');
				// DEBUG: Pokaż wszystkie data-box-name
				const allBoxNames = document.querySelectorAll('[data-box-name]');
				console.log(`🔍 [SEQ] DEBUG: Znaleziono ${allBoxNames.length} elementów z data-box-name:`);
				for (let i = 0; i < Math.min(allBoxNames.length, 10); i++) {
					console.log(`  ${i + 1}. data-box-name="${allBoxNames[i].getAttribute('data-box-name')}"`);
				}
			}

			// Zamknij sekcję Allegro Ochrona
			console.log('🔄 Zamykam sekcję Allegro Ochrona...');
			await this.closeTrustInfoDialog();

			// KROK 3: Otwórz sekcję Parametry, zbierz dane, zamknij
			console.log('📊 KROK 3: Otwieram sekcję Parametry produktu...');
			await this.ensureParametersLoaded();

			// Czekaj 0,7 sekundy żeby dane się załadowały
			console.log('⏳ Czekam 0,7 sekundy na załadowanie danych Parametrów...');
			await new Promise(resolve => setTimeout(resolve, 700));

			// Zbierz dane z sekcji Parametry
			console.log('📝 [SEQ] Zbieranie danych z sekcji Parametry...');

			// Szukaj dialogu z różnymi wariantami
			let parametersDialog = document.querySelector('[role="dialog"][aria-labelledby="Parametry"]');

			if (!parametersDialog) {
				// Fallback: Szukaj dowolnego dialogu który ma "Sidebar Parameters"
				const allDialogs = document.querySelectorAll('[role="dialog"]');
				for (const dialog of allDialogs) {
					if (dialog.querySelector('[data-box-name="Sidebar Parameters"]')) {
						parametersDialog = dialog;
						console.log('✅ [SEQ] Znaleziono dialog przez Sidebar Parameters');
						break;
					}
				}
			}

			let parametersTable = null;

			if (parametersDialog) {
				// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody (parametry mogą być w wielu tbody)
				parametersTable = parametersDialog.querySelector('table');
				if (parametersTable) {
					console.log('✅ [SEQ] Znaleziono tabelę w dialogu Parametry');
				} else {
					console.log('⚠️ [SEQ] Dialog znaleziony, ale brak tabeli');
				}
			} else {
				console.log('⚠️ [SEQ] Nie znaleziono dialogu z parametrami');
				// DEBUG
				const allDialogs = document.querySelectorAll('[role="dialog"]');
				console.log(`🔍 DEBUG: Znaleziono ${allDialogs.length} dialogów na stronie`);
			}

			if (!parametersTable) {
				const parametersSection = document.querySelector('[data-box-name="Sidebar Parameters"]');
				if (parametersSection) {
					// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody
					parametersTable = parametersSection.querySelector('table');
					console.log('✅ [SEQ] Znaleziono sekcję parametrów po data-box-name');
				}
			}

			if (!parametersTable) {
				// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody
				const tempTable = document.querySelector('table.myre_zn');
				// Sprawdź czy to faktycznie tabela parametrów (ma kolumny z klasami _3c6dd)
				if (tempTable && (tempTable.querySelector('tr td._3c6dd_ipdVK') || tempTable.querySelector('tr td._3c6dd_SpQem'))) {
					parametersTable = tempTable;
					console.log('✅ [SEQ] Znaleziono tabelę parametrów po klasach CSS (table.myre_zn)');
				}
			}

			if (parametersTable) {
				console.log('✅ [SEQ] Znaleziono tabelę parametrów w performSequentialScan');
				console.log(`🔍 [SEQ] Liczba <tbody> w tabeli: ${parametersTable.querySelectorAll('tbody').length}`);
				// Wyciąganie parametrów z tabeli - querySelectorAll('tr') znajdzie WSZYSTKIE tr we WSZYSTKICH tbody
				const parameterRows = parametersTable.querySelectorAll('tr');
				console.log(`📊 Liczba wierszy w tabeli: ${parameterRows.length}`);
				this.productParameters = [];

				parameterRows.forEach((row, index) => {
					// Pomiń wiersze z nagłówkami sekcji (mają <th> zamiast <td>)
					if (row.querySelector('th[role="rowheader"]')) {
						console.log(`   ⏭️ [SEQ] Wiersz ${index + 1}: NAGŁÓWEK SEKCJI - pomijam`);
						return;
					}

					const nameCell = row.querySelector('td._3c6dd_ipdVK') || row.querySelector('td._3c6dd_SpQem');
					const valueCell = row.querySelector('td._3c6dd_AYKa3');

					if (nameCell && valueCell) {
						const paramName = nameCell.textContent.trim();
						let paramValue = '';
						let paramLink = '';

						console.log(`   📋 [SEQ] Wiersz ${index + 1}: "${paramName}"`);

						const valueLink = valueCell.querySelector('a');
						if (valueLink) {
							paramValue = valueLink.textContent.trim();
							paramLink = valueLink.href;
							console.log(`      → [SEQ] Wartość z linkiem: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
						} else {
							const valueDiv = valueCell.querySelector('div._3c6dd_KEYaD');
							if (valueDiv) {
								paramValue = valueDiv.textContent.trim();
								console.log(`      → [SEQ] Wartość z div: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
							} else {
								paramValue = valueCell.textContent.trim();
								console.log(`      → [SEQ] Wartość z td: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
							}
						}

						// CZYSZCZENIE: Dla parametru "Stan" = "Nowy" odetnij wyjaśnienie
						if (paramName.toLowerCase() === 'stan' && paramValue.startsWith('Nowy')) {
							// Jeśli po "Nowy" jest kolejne "Nowy" (bez spacji), to zostaw tylko jedno "Nowy"
							if (paramValue.match(/^Nowy[A-ZĄĆĘŁŃÓŚŹŻ]/)) {
								paramValue = 'Nowy';
								console.log('      🧹 [SEQ] Wyczyszczono parametr Stan: "Nowy" (usunięto wyjaśnienie)');
							}
						}

						const parameter = {
							name: paramName,
							value: paramValue,
							link: paramLink,
							hasLink: !!paramLink
						};

						const _pv = (paramValue || '').trim().toLowerCase();
						const _missing = _pv === '' || _pv === 'brak' || _pv === '-' || _pv === '—' || _pv === '.' || _pv === 'n/a' || _pv === 'nie dotyczy';
						if (!_missing) {
							this.productParameters.push(parameter);
						}

						const paramNameLower = paramName.toLowerCase();
						if (paramNameLower === 'marka' || paramNameLower === 'producent') {
							const v = (paramValue || '').trim().toLowerCase();
							const banned = ['bez marki','nieznany producent','nieznany','brak','inny'];
							this.hasBrand = !banned.includes(v);
							this.brandName = paramValue;
							this.brandLink = paramLink;
							this.brandType = paramNameLower;
							console.log(`      🏷️ [SEQ] Znaleziono ${paramNameLower}: "${paramValue}"`);
						}
					} else {
						// Debug: Jeśli nie znaleziono komórek
						if (!nameCell) {
							console.log(`   ⚠️ [SEQ] Wiersz ${index + 1}: Brak komórki nazwy`);
						}
						if (!valueCell) {
							console.log(`   ⚠️ [SEQ] Wiersz ${index + 1}: Brak komórki wartości`);
						}
					}
				});

				this.parametersCount = this.productParameters.length;
				console.log(`✅ [SEQ] Dane Parametrów zebrane: ${this.parametersCount} parametrów`);

				// KROK 3.5: Analizuj parametry w opisie (teraz gdy mamy już i opis i parametry)
				console.log('🔍 KROK 3.5: Analizuję obecność parametrów w opisie...');
				this.analyzeParametersInDescription();
			} else {
				console.log('⚠️ [SEQ] Nie znaleziono tabeli parametrów');
				console.log('🔍 DEBUG: Sprawdzam co jest dostępne...');
				console.log(`   - Dialog: ${!!parametersDialog}`);
				console.log(`   - Sidebar Parameters: ${!!document.querySelector('[data-box-name="Sidebar Parameters"]')}`);
				console.log(`   - table.myre_zn: ${!!document.querySelector('table.myre_zn')}`);
			}

			// Zamknij sekcję Parametry
			console.log('🔄 Zamykam sekcję Parametry...');
			await this.closeParametersDialog();

			// KROK 3.6: Otwórz okno kontrofert, zbierz dane, zamknij
			console.log('📊 KROK 3.6: Otwieram okno kontrofert...');
			const competitorOffersLoaded = await this.ensureCompetitorOffersLoaded();

			if (competitorOffersLoaded) {
				// Czekaj 0,5 sekundy żeby dialog się w pełni załadował
				console.log('⏳ Czekam 0,5 sekundy na załadowanie dialogu...');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Zbierz dane z kontrofert (wewnątrz jest już scroll i czekanie)
				console.log('📝 Zbieranie danych z kontrofert...');
				await this.scanCompetitorOffers();

				// Zamknij okno kontrofert
				console.log('🔄 Zamykam okno kontrofert...');
				await this.closeCompetitorOffersDialog();
			} else {
				console.log('⚠️ Pominięto analizę kontrofert - nie udało się otworzyć okna');
			}

			// KROK 3.7: Wyślij opis i obrazek do analizy AI (async - może trwać kilka sekund)
			// To jest OSTATNI KROK przed obliczeniem jakości - wszystkie okna już zamknięte
			console.log('📊 KROK 3.7: Wysyłam opis i miniaturę do analizy AI...');

			// Znajdź komunikat ładowania i uruchom animację kropek
			const loadingMsg = document.querySelector('div[style*="position: fixed"][style*="50%"]');
			if (loadingMsg) {
				loadingMsg.textContent = '🤖 Analizuję aukcję z modułem AI';

				// Animacja kropek: . .. ... .. . .. ...
				let dotCount = 0;
				const dotAnimation = setInterval(() => {
					const dots = '.'.repeat((dotCount % 4));
					loadingMsg.textContent = `🤖 Analizuję aukcję z modułem AI${dots}`;
					dotCount++;
				}, 400); // Co 400ms zmień liczbę kropek

				// Uruchom OBIE analizy AI równolegle (szybciej niż po kolei)
				console.log('🚀 Rozpoczynam równoległe analizy AI (opis + obraz)...');
				await Promise.all([
					this.analyzeDescriptionWithAI(),
					this.analyzeImageWithAI()
				]);

				// Zatrzymaj animację
				clearInterval(dotAnimation);

				if (loadingMsg) {
					loadingMsg.textContent = '✅ Analiza AI zakończona';
				}
			} else {
				// Jeśli nie ma komunikatu ładowania (nie powinno się zdarzyć)
				console.log('🚀 Rozpoczynam równoległe analizy AI (opis + obraz)...');
				await Promise.all([
					this.analyzeDescriptionWithAI(),
					this.analyzeImageWithAI()
				]);
			}

			// KROK 4: Oblicz jakość oferty i zaktualizuj UI
			console.log('📊 KROK 4: Obliczam jakość oferty...');
			this.offerQuality = this.calculateOfferQuality();
			this.lastScanDate = new Date();

			const timeEl = document.getElementById(this.lastScanLabelId);
			const qualityEl = document.getElementById('wt-skan-quality');
			const imageQualityEl = document.getElementById('wt-skan-image-quality');

			if (timeEl) timeEl.textContent = this.formatDateTime(this.lastScanDate);
			if (qualityEl) qualityEl.textContent = this.offerQuality + '%';
			if (imageQualityEl) {
				const score = this.imageQuality.overallScore || 0;
				imageQualityEl.textContent = score + '%';
				imageQualityEl.style.color = score >= 80 ? '#059669' : score >= 60 ? '#f59e0b' : '#dc2626';
			}

			this.updateImagesUI();

			// KROK 5: Przewiń do połowy strony
			console.log('📊 KROK 5: Przewijam do połowy strony...');
			window.scrollTo({
				top: document.documentElement.scrollHeight / 2,
				behavior: 'smooth'
			});

			// Czekaj aż scroll się skończy
			await new Promise(resolve => setTimeout(resolve, 1000));

			console.log('✅ SEKWENCYJNE SKANOWANIE ZAKOŃCZONE - Gotowe do generowania PDF');
		}

		async scanProtectionPolicies() {
			console.log('🛡️ Skanowanie polityk ochrony kupujących...');

			// Resetuj dane
			this.hasReturnPolicy = false;
			this.returnDays = 0;
			this.hasComplaintPolicy = false;
			this.complaintPeriod = '';
			this.hasWarranty = false;
			this.warrantyPeriod = '';
			this.hasAllegroProtect = false;
			this.allegroProtectPeriod = '';
			this.protectionQuality = 0;

			// KROK 1: Automatyczne kliknięcie przycisku TrustInfo żeby załadować dane
			await this.ensureTrustInfoLoaded();

			// Szukaj sekcji z politykami ochrony kupujących
			console.log('🔍 DEBUG: Rozpoczynam szukanie sekcji ochrony kupujących...');

			// METODA 1: PRIORYTET - Główna struktura [data-box-name="TrustShow"] (z logów: działa w 100% przypadków)
			let trustShowSection = document.querySelector('[data-box-name="TrustShow"]');
			console.log('🔍 METODA 1 - [data-box-name="TrustShow"]:', !!trustShowSection);

			if (!trustShowSection) {
				// METODA 2: Nowa struktura - szukaj głównego kontenera z politykami
				trustShowSection = document.querySelector('[data-box-name="TrustAllegroProtect"]');
				console.log('🔍 METODA 2 - [data-box-name="TrustAllegroProtect"]:', !!trustShowSection);
			}

			if (!trustShowSection) {
				// METODA 3: Szukaj po tekście głównym "Na Allegro kupujesz bezpiecznie"
				const textElements = document.querySelectorAll('p, div');
				for (const el of textElements) {
					if (el.textContent && el.textContent.includes('Na Allegro kupujesz bezpiecznie')) {
						trustShowSection = el.closest('div[class*="msts"]') || el.parentElement;
						console.log('🔍 METODA 3 - Znaleziono po tekście "Na Allegro kupujesz bezpiecznie"');
						break;
					}
				}
			}

			if (!trustShowSection) {
				// METODA 4: Szukaj po konkretnych sekcjach (zwrot/reklamacja/gwarancja)
				const specificSections = [
					'#after-sales-expander-return-policy',
					'#after-sales-expander-implied-warranty',
					'#after-sales-expander-warranty',
					'#after-sales-expander-allegro-protect'
				];

				for (const selector of specificSections) {
					const section = document.querySelector(selector);
					if (section) {
						trustShowSection = section.closest('div[class*="msts"]') || section.parentElement;
						console.log(`🔍 METODA 4 - Znaleziono przez sekcję ${selector}`);
						break;
					}
				}
			}

			if (trustShowSection) {
				console.log('✅ Znaleziono sekcję Allegro Ochrony Kupujących');
				console.log('🔍 DEBUG: Selektor sekcji:', trustShowSection.tagName, trustShowSection.className);
				console.log('🔍 DEBUG: Rozmiar HTML sekcji:', trustShowSection.innerHTML.length, 'znaków');
				this.scanReturnPolicy(trustShowSection);
				this.scanComplaintPolicy(trustShowSection);
				this.scanWarranty(trustShowSection);
				this.scanAllegroProtect(trustShowSection);
			} else {
				console.log('❌ Nie znaleziono sekcji Allegro Ochrony Kupujących');
				console.log('🔍 DEBUG: Dostępne sekcje z data-box-name:');
				const allBoxes = document.querySelectorAll('[data-box-name]');
				for (let i = 0; i < Math.min(allBoxes.length, 10); i++) {
					console.log(`  ${i + 1}. data-box-name="${allBoxes[i].getAttribute('data-box-name')}"`);
				}
			}

			// Oblicz jakość ochrony
			this.calculateProtectionQuality();

			// Podsumowanie
			console.log('🛡️ Wyniki skanowania polityk ochrony:');
			console.log(`  Zwroty: ${this.hasReturnPolicy ? `${this.returnDays} dni` : 'brak'}`);
			console.log(`  Reklamacje: ${this.hasComplaintPolicy ? this.complaintPeriod : 'brak'}`);
			console.log(`  Gwarancja: ${this.hasWarranty ? this.warrantyPeriod : 'brak'}`);
			console.log(`  Allegro Protect: ${this.hasAllegroProtect ? this.allegroProtectPeriod : 'brak'}`);

			// Zamknij okno Allegro Ochrona po zebraniu danych
			await this.closeTrustInfoDialog();
			console.log(`  Jakość ochrony: ${this.protectionQuality}%`);
		}

		scanReturnPolicy(section) {
			console.log('🔄 Szukam polityki zwrotów...');
			console.log(`🔍 DEBUG: Sekcja do przeszukania - rozmiar HTML: ${section ? section.innerHTML.length : 0} znaków`);

			// SKANUJ CAŁĄ SEKCJĘ - nie ograniczaj się do konkretnych kontenerów
			// Ukryte sekcje mają ważne informacje w button'ach
			const searchSection = section;

			// DEBUG: Wypisz wszystkie teksty w sekcji
			const allElements = searchSection.querySelectorAll('p, span, div, button, h1, h2, h3, h4, section, b, strong');
			console.log(`🔍 DEBUG: Znaleziono ${allElements.length} elementów do przeszukania`);
			console.log('🔍 DEBUG: Pierwsze 30 tekstów w sekcji zwrotów:');
			for (let i = 0; i < Math.min(allElements.length, 30); i++) {
				const text = allElements[i].textContent ? allElements[i].textContent.trim() : '';
				if (text && text.length > 5 && text.length < 300) {
					console.log(`  ${i + 1}. [${allElements[i].tagName}] "${text}"`);
				}
			}

			// Wzorce tekstowe na podstawie rzeczywistej struktury HTML
			const returnTexts = [
				'Masz 14 dni na odstąpienie od umowy',
				'14 dni',
				'Czas na odstąpienie od umowy',
				'dni na odstąpienie',
				'Zwrot',
				'odstąpienie od umowy'
			];

			for (const element of allElements) {
				const text = element.textContent ? element.textContent.trim() : '';

				// Sprawdź czy zawiera informacje o zwrocie
				for (const returnText of returnTexts) {
					if (text.includes(returnText)) {
						console.log('📝 Znaleziono tekst o zwrotach:', text);

						// Wyciągnij liczbę dni
						const daysMatch = text.match(/(\d+)\s*dni/i);
						if (daysMatch) {
							this.returnDays = parseInt(daysMatch[1]);
							this.hasReturnPolicy = true;
							console.log('✅ Wykryto politykę zwrotów:', this.returnDays, 'dni');
							return;
						} else if (text.includes('Zwrot') || text.includes('odstąpienie')) {
							this.returnDays = 14; // Standardowe 14 dni
							this.hasReturnPolicy = true;
							console.log('✅ Wykryto standardową politykę zwrotów: 14 dni');
							return;
						}
					}
				}
			}

			console.log('❌ Nie znaleziono polityki zwrotów');
		}

		scanComplaintPolicy(section) {
			console.log('📋 Szukam polityki reklamacji...');
			console.log(`🔍 DEBUG: Sekcja do przeszukania - rozmiar HTML: ${section ? section.innerHTML.length : 0} znaków`);

			// SKANUJ CAŁĄ SEKCJĘ - nie ograniczaj się do konkretnych kontenerów
			const searchSection = section;

			// Wzorce tekstowe na podstawie rzeczywistej struktury HTML
			const complaintTexts = [
				'Sprzedawca odpowiada za wadliwy towar przez 2 lata od jego wydania',
				'2 lata',
				'Czas na reklamację',
				'Reklamacja',
				'wadliwy towar',
				'lata od jego wydania'
			];

			const allElements = searchSection.querySelectorAll('p, span, div, button, section, b, strong, td');
			console.log(`🔍 DEBUG: Znaleziono ${allElements.length} elementów do przeszukania (reklamacja)`);

			for (const element of allElements) {
				const text = element.textContent ? element.textContent.trim() : '';

				for (const complaintText of complaintTexts) {
					if (text.includes(complaintText)) {
						console.log('📝 Znaleziono tekst o reklamacjach:', text);

						// Wyciągnij okres reklamacji
						const yearsMatch = text.match(/(\d+)\s*lata?/i);
						if (yearsMatch) {
							this.complaintPeriod = `${yearsMatch[1]} lata`;
							this.hasComplaintPolicy = true;
							console.log('✅ Wykryto politykę reklamacji:', this.complaintPeriod);
							return;
						} else if (text.includes('Reklamacja')) {
							this.complaintPeriod = '2 lata'; // Standardowe 2 lata
							this.hasComplaintPolicy = true;
							console.log('✅ Wykryto standardową politykę reklamacji: 2 lata');
							return;
						}
					}
				}
			}

			console.log('❌ Nie znaleziono polityki reklamacji');
		}

		scanWarranty(section) {
			console.log('🔧 Szukam informacji o gwarancji...');
			console.log(`🔍 DEBUG: Sekcja do przeszukania - rozmiar HTML: ${section ? section.innerHTML.length : 0} znaków`);

			// SKANUJ CAŁĄ SEKCJĘ - nie ograniczaj się do konkretnych kontenerów
			const searchSection = section;

			// Wzorce tekstowe na podstawie rzeczywistej struktury HTML
			const warrantyTexts = [
				'Produkt jest objęty gwarancją sprzedającego przez 24 miesiące od zakupu',
				'Produkt jest objęty gwarancją producenta/dystrybutora przez 24 miesiące od zakupu',
				'objęty gwarancją producenta/dystrybutora',
				'24 miesiące',
				'Okres gwarancji',
				'Rodzaj gwarancji',
				'Gwarancja',
				'objęty gwarancją',
				'miesiące od zakupu',
				'sprzedającego',
				'producenta/dystrybutora'
			];

			const allElements = searchSection.querySelectorAll('p, span, div, button, td, section, b, strong, th');
			console.log(`🔍 DEBUG: Znaleziono ${allElements.length} elementów do przeszukania (gwarancja)`);

			for (const element of allElements) {
				const text = element.textContent ? element.textContent.trim() : '';

				for (const warrantyText of warrantyTexts) {
					if (text.includes(warrantyText)) {
						console.log(`📝 Znaleziono tekst o gwarancji: "${text.substring(0, 150)}..."`);
						console.log(`   Dopasowany wzorzec: "${warrantyText}"`);

						// Wyciągnij okres gwarancji
						const monthsMatch = text.match(/(\d+)\s*miesiąc[ye]?/i);
						if (monthsMatch) {
							this.warrantyPeriod = `${monthsMatch[1]} miesiące`;
							this.hasWarranty = true;
							console.log('✅ Wykryto gwarancję:', this.warrantyPeriod);
							return;
						} else if (text.includes('Gwarancja') && !text.includes('Najniższej Ceny')) {
							this.warrantyPeriod = '24 miesiące'; // Standardowe 24 miesiące
							this.hasWarranty = true;
							console.log('✅ Wykryto standardową gwarancję: 24 miesiące');
							return;
						}
					}
				}
			}

			console.log('❌ Nie znaleziono informacji o gwarancji');
		}

		scanAllegroProtect(section) {
			console.log('🛡️ Szukam informacji o Allegro Ochronie Kupujących...');
			console.log(`🔍 DEBUG: Sekcja do przeszukania - rozmiar HTML: ${section ? section.innerHTML.length : 0} znaków`);

			// SKANUJ CAŁĄ SEKCJĘ - nie ograniczaj się do konkretnych kontenerów
			const searchSection = section;

			// Wzorce tekstowe na podstawie rzeczywistej struktury HTML
			const protectTexts = [
				'Przez 24 miesiące od zakupu zapewniamy Ci pomoc w rozwiązaniu problemów',
				'zaproponujemy zwrot pieniędzy',
				'Allegro Ochrona Kupujących',
				'Pomoc w odzyskaniu pieniędzy',
				'100% zakupów',
				'2 lata wsparcia',
				'Zwrot pieniędzy',
				'24 miesiące',
				'pomoc w rozwiązaniu problemów'
			];

			const allElements = searchSection.querySelectorAll('p, span, div, button, h3, h4, section, b, strong');
			console.log(`🔍 DEBUG: Znaleziono ${allElements.length} elementów do przeszukania (Allegro Protect)`);

			for (const element of allElements) {
				const text = element.textContent ? element.textContent.trim() : '';

				for (const protectText of protectTexts) {
					if (text.includes(protectText)) {
						console.log('📝 Znaleziono tekst o Allegro Protect:', text);

						// Wyciągnij okres ochrony
						const monthsMatch = text.match(/(\d+)\s*miesiąc[ye]?/i);
						if (monthsMatch) {
							this.allegroProtectPeriod = `${monthsMatch[1]} miesiące`;
							this.hasAllegroProtect = true;
							console.log('✅ Wykryto Allegro Ochronę Kupujących:', this.allegroProtectPeriod);
							return;
						} else if (text.includes('Allegro Ochrona') || text.includes('Zwrot pieniędzy')) {
							this.allegroProtectPeriod = '24 miesiące'; // Standardowe 24 miesiące
							this.hasAllegroProtect = true;
							console.log('✅ Wykryto standardową Allegro Ochronę Kupujących: 24 miesiące');
							return;
						}
					}
				}
			}

			console.log('❌ Nie znaleziono informacji o Allegro Ochronie Kupujących');
		}

		calculateProtectionQuality() {
			let quality = 0;

			// Zwroty (25 punktów)
			if (this.hasReturnPolicy) {
				if (this.returnDays >= 14) {
					quality += 25;
				} else {
					quality += 15; // Mniej niż standardowe 14 dni
				}
			}

			// Reklamacje (25 punktów)
			if (this.hasComplaintPolicy) {
				quality += 25;
			}

			// Gwarancja (25 punktów)
			if (this.hasWarranty) {
				quality += 25;
			}

			// Allegro Protect (25 punktów)
			if (this.hasAllegroProtect) {
				quality += 25;
			}

			this.protectionQuality = quality;
			console.log('📊 Obliczono jakość ochrony:', this.protectionQuality + '%');
		}

		async scanProductParameters() {
			console.log('📋 Skanowanie parametrów produktu...');

			this.productParameters = [];
			this.parametersCount = 0;
			this.hasBrand = false;
			this.brandName = '';
			this.brandLink = '';
			this.brandType = '';

			// KROK 1: Automatyczne kliknięcie linku do parametrów żeby załadować dane
			console.log('📊 KROK 1: Otwieram dialog parametrów...');
			await this.ensureParametersLoaded();

			// Dodatkowy delay po otwarciu
			console.log('⏳ Czekam 0,7 sekundy na załadowanie danych...');
			await new Promise(resolve => setTimeout(resolve, 700));

			// METODA 1: Szukanie tabeli parametrów w dialog box
			console.log('🔍 METODA 1: Szukam dialogu [role="dialog"][aria-labelledby="Parametry"]...');
			let parametersDialog = document.querySelector('[role="dialog"][aria-labelledby="Parametry"]');

			if (!parametersDialog) {
				// Fallback: Szukaj dowolnego dialogu który ma "Sidebar Parameters"
				console.log('🔍 Fallback: Szukam dialogu przez Sidebar Parameters...');
				const allDialogs = document.querySelectorAll('[role="dialog"]');
				for (const dialog of allDialogs) {
					if (dialog.querySelector('[data-box-name="Sidebar Parameters"]')) {
						parametersDialog = dialog;
						console.log('✅ Znaleziono dialog przez Sidebar Parameters');
						break;
					}
				}
			}

			let parametersTable = null;

			if (parametersDialog) {
				// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody (parametry mogą być w wielu tbody)
				parametersTable = parametersDialog.querySelector('table');
				if (parametersTable) {
					console.log('✅ Znaleziono tabelę w dialogu z parametrami');
				} else {
					console.log('⚠️ Dialog znaleziony, ale brak tabeli');
				}
			} else {
				console.log('⚠️ Nie znaleziono dialogu z parametrami');
			}

			// METODA 2: Szukanie tabeli parametrów po data-box-name
			if (!parametersTable) {
				console.log('🔍 METODA 2: Szukam sekcji [data-box-name="Sidebar Parameters"]...');
				const parametersSection = document.querySelector('[data-box-name="Sidebar Parameters"]');
				if (parametersSection) {
					// ZMIANA: Szukaj całej tabeli, nie tylko jednego tbody
					parametersTable = parametersSection.querySelector('table');
					if (parametersTable) {
						console.log('✅ Znaleziono tabelę w sekcji parametrów po data-box-name');
					} else {
						console.log('⚠️ Sekcja Sidebar Parameters znaleziona, ale brak tabeli');
					}
				} else {
					console.log('⚠️ Nie znaleziono sekcji [data-box-name="Sidebar Parameters"]');
				}
			}

			// METODA 3: Szukanie tabeli parametrów po klasach CSS
			if (!parametersTable) {
				console.log('🔍 METODA 3: Szukam table.myre_zn...');
				const tempTable = document.querySelector('table.myre_zn');
				// Sprawdź czy to faktycznie tabela parametrów (ma kolumny z klasami _3c6dd)
				if (tempTable && (tempTable.querySelector('tr td._3c6dd_ipdVK') || tempTable.querySelector('tr td._3c6dd_SpQem'))) {
					parametersTable = tempTable;
					console.log('✅ Znaleziono tabelę parametrów po klasach CSS (table.myre_zn)');
				} else if (tempTable) {
					console.log('⚠️ Znaleziono table.myre_zn, ale nie ma kolumn parametrów (_3c6dd_ipdVK lub _3c6dd_SpQem)');
				} else {
					console.log('⚠️ Nie znaleziono table.myre_zn');
				}
			}

			if (!parametersTable) {
				console.log('❌ Nie znaleziono tabeli parametrów');
				console.log('🔍 DEBUG: Sprawdzam co jest dostępne...');
				console.log(`   - Dialog: ${!!parametersDialog}`);
				console.log(`   - Sidebar Parameters: ${!!document.querySelector('[data-box-name="Sidebar Parameters"]')}`);
				console.log(`   - table.myre_zn: ${!!document.querySelector('table.myre_zn')}`);
				return;
			}

			console.log('✅ Znaleziono tabelę parametrów, wyciągam dane...');
			console.log(`🔍 Liczba <tbody> w tabeli: ${parametersTable.querySelectorAll('tbody').length}`);

			// Wyciąganie parametrów z tabeli - querySelectorAll('tr') znajdzie WSZYSTKIE tr we WSZYSTKICH tbody
			const parameterRows = parametersTable.querySelectorAll('tr');
			console.log(`📊 Liczba wierszy w tabeli: ${parameterRows.length}`);

			parameterRows.forEach((row, index) => {
				// Pomiń wiersze z nagłówkami sekcji (mają <th> zamiast <td>)
				if (row.querySelector('th[role="rowheader"]')) {
					console.log(`   ⏭️ Wiersz ${index + 1}: NAGŁÓWEK SEKCJI - pomijam`);
					return;
				}

				// Alternatywne selektory dla komórki nazwy (różne wersje Allegro)
				const nameCell = row.querySelector('td._3c6dd_ipdVK') || row.querySelector('td._3c6dd_SpQem');
				const valueCell = row.querySelector('td._3c6dd_AYKa3');

				if (nameCell && valueCell) {
					const paramName = nameCell.textContent.trim();
					let paramValue = '';
					let paramLink = '';

					console.log(`   📋 Wiersz ${index + 1}: "${paramName}"`);

					// Sprawdź czy wartość ma link
					const valueLink = valueCell.querySelector('a');
					if (valueLink) {
						paramValue = valueLink.textContent.trim();
						paramLink = valueLink.href;
						console.log(`      → Wartość z linkiem: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
					} else {
						// Sprawdź czy jest w div._3c6dd_KEYaD
						const valueDiv = valueCell.querySelector('div._3c6dd_KEYaD');
						if (valueDiv) {
							paramValue = valueDiv.textContent.trim();
							console.log(`      → Wartość z div: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
						} else {
							paramValue = valueCell.textContent.trim();
							console.log(`      → Wartość z td: "${paramValue.substring(0, 50)}${paramValue.length > 50 ? '...' : ''}"`);
						}
					}

					// CZYSZCZENIE: Dla parametru "Stan" = "Nowy" odetnij wyjaśnienie
					if (paramName.toLowerCase() === 'stan' && paramValue.startsWith('Nowy')) {
						// Jeśli po "Nowy" jest kolejne "Nowy" (bez spacji), to zostaw tylko jedno "Nowy"
						if (paramValue.match(/^Nowy[A-ZĄĆĘŁŃÓŚŹŻ]/)) {
							paramValue = 'Nowy';
							console.log('      🧹 Wyczyszczono parametr Stan: "Nowy" (usunięto wyjaśnienie)');
						}
					}

					const parameter = {
						name: paramName,
						value: paramValue,
						link: paramLink,
						hasLink: !!paramLink
					};

					const _pv2 = (paramValue || '').trim().toLowerCase();
					const _missing2 = _pv2 === '' || _pv2 === 'brak' || _pv2 === '-' || _pv2 === '—' || _pv2 === '.' || _pv2 === 'n/a' || _pv2 === 'nie dotyczy';
					if (!_missing2) {
						this.productParameters.push(parameter);
					}

					// Sprawdź czy to jest marka lub producent
					const paramNameLower = paramName.toLowerCase();
					if (paramNameLower === 'marka' || paramNameLower === 'producent') {
						const v = (paramValue || '').trim().toLowerCase();
						const banned = ['bez marki','nieznany producent','nieznany','brak','inny'];
						this.hasBrand = !banned.includes(v);
						this.brandName = paramValue;
						this.brandLink = paramLink;
						this.brandType = paramNameLower; // Zapisz typ: 'marka' lub 'producent'

						// Zapisz informację o typie dla logów (marka czy producent)
						const brandTypeDisplay = paramNameLower === 'marka' ? 'markę' : 'producenta';

						console.log(`🏷️ Znaleziono ${brandTypeDisplay}: "${paramValue}" ${this.hasBrand ? `(ma ${brandTypeDisplay})` : '(bez marki)'}`);
						if (paramLink) {
							console.log(`🔗 Link do ${paramNameLower}: ${paramLink}`);
						}
					}
				} else {
					// Debug: Jeśli nie znaleziono komórek
					if (!nameCell) {
						console.log(`   ⚠️ Wiersz ${index + 1}: Brak komórki nazwy (szukano: td._3c6dd_ipdVK lub td._3c6dd_SpQem)`);
					}
					if (!valueCell) {
						console.log(`   ⚠️ Wiersz ${index + 1}: Brak komórki wartości (szukano: td._3c6dd_AYKa3)`);
					}
				}
			});

			this.parametersCount = this.productParameters.length;

			console.log(`✅ Znaleziono ${this.parametersCount} parametrów produktu`);
			if (this.parametersCount > 0) {
				console.log('📋 Lista parametrów:', this.productParameters.map(param => ({
					name: param.name,
					value: param.value.substring(0, 50) + (param.value.length > 50 ? '...' : ''),
					hasLink: param.hasLink
				})));

				if (this.hasBrand) {
					console.log(`🏷️ Marka/Producent: "${this.brandName}" (typ: ${this.brandType})`);
				}
			} else {
				console.log('⚠️ UWAGA: Nie pobrano żadnych parametrów! Sprawdź logi powyżej.');
			}

			// Zamknij okno parametrów po zebraniu danych
			console.log('📊 Zamykam dialog parametrów...');
			await this.closeParametersDialog();

			console.log(`📊 KONIEC scanProductParameters - zebrano ${this.parametersCount} parametrów`);
		}

		extractDomain(url) {
			try {
				return new URL(url).hostname;
			} catch (e) {
				return 'Nieznana domena';
			}
		}

		isIconImage(img) {
			const src = img.src.toLowerCase();
			const alt = (img.alt || '').toLowerCase();

			// Sprawdź czy to prawdopodobnie ikona na podstawie URL lub alt
			if (src.includes('icon') || src.includes('logo') ||
				src.includes('favicon') || src.includes('sprite') ||
				alt.includes('icon') || alt.includes('logo')) {
				return true;
			}

			// Sprawdź rozmiar - obrazy mniejsze niż 50x50 to prawdopodobnie ikony
			const width = img.naturalWidth || img.width || 0;
			const height = img.naturalHeight || img.height || 0;

			return width < 50 || height < 50;
		}

		async analyzeThumbnail(imageElement) {
			console.log('🔍 Analizuję znalezioną miniaturę...');

			// Podstawowe dane obrazu
			this.thumbnailData.src = imageElement.src || '';
			this.thumbnailData.alt = imageElement.alt || '';
			this.thumbnailData.displayWidth = imageElement.width || 0;
			this.thumbnailData.displayHeight = imageElement.height || 0;

			// Naturalne wymiary (rzeczywista rozdzielczość)
			this.thumbnailData.naturalWidth = imageElement.naturalWidth || 0;
			this.thumbnailData.naturalHeight = imageElement.naturalHeight || 0;

			// Oblicz proporcje obrazu
			if (this.thumbnailData.naturalWidth > 0 && this.thumbnailData.naturalHeight > 0) {
				const gcd = this.gcd(this.thumbnailData.naturalWidth, this.thumbnailData.naturalHeight);
				const ratioW = this.thumbnailData.naturalWidth / gcd;
				const ratioH = this.thumbnailData.naturalHeight / gcd;
				this.thumbnailData.aspectRatio = `${ratioW}:${ratioH}`;
			}

			// Określ format pliku z URL
			const urlParts = this.thumbnailData.src.split('.');
			if (urlParts.length > 1) {
				this.thumbnailData.format = urlParts[urlParts.length - 1].toUpperCase();
			}

			// Szacuj DPI na podstawie wyświetlanych i naturalnych wymiarów
			if (this.thumbnailData.displayWidth > 0 && this.thumbnailData.naturalWidth > 0) {
				// Zakładamy standardowy DPI 96 dla ekranów
				const standardDpi = 96;
				const scaleFactor = this.thumbnailData.naturalWidth / this.thumbnailData.displayWidth;
				this.thumbnailData.estimatedDpi = Math.round(scaleFactor * standardDpi);
			}

			// Dodatkowe informacje o obrazie
			this.thumbnailData.isLoaded = imageElement.complete;
			this.thumbnailData.loadingState = imageElement.complete ? 'Załadowany' : 'Ładowanie...';

			// Próbuj pobrać rozmiar pliku
			this.getImageFileSize(this.thumbnailData.src);

			console.log('📊 Dane miniatury:', this.thumbnailData);

			// NOWA ANALIZA JAKOŚCI OBRAZU (analiza techniczna - bez AI)
			console.log('🎨 Rozpoczynam zaawansowaną analizę jakości obrazu...');
			try {
				this.imageQuality = await this.imageQualityAnalyzer.analyzeImage(
					this.thumbnailData.src,
					imageElement,
					true // isThumbnail = true
				);
				console.log('✅ Analiza jakości obrazu zakończona:', this.imageQuality);
			} catch (error) {
				console.error('❌ Błąd podczas analizy jakości obrazu:', error);
				this.imageQuality.errors.push(`Błąd analizy: ${error.message}`);
			}

			// ANALIZA AI MINIATURKI została przeniesiona do analyzeImageWithAI()
			// Będzie wywołana razem z analizą opisu podczas generowania raportu
		}

		gcd(a, b) {
			// Algorytm Euklidesa do obliczania największego wspólnego dzielnika
			return b === 0 ? a : this.gcd(b, a % b);
		}

		async getImageFileSize(imageUrl) {
			try {
				console.log('📏 Próbuję pobrać rozmiar pliku...');

				const response = await fetch(imageUrl, {
					method: 'HEAD',
					mode: 'no-cors' // Próba ominięcia CORS
				});

				if (response.ok) {
					const contentLength = response.headers.get('content-length');
					if (contentLength) {
						this.thumbnailData.fileSize = parseInt(contentLength);
						console.log('✅ Rozmiar pliku:', this.formatFileSize(this.thumbnailData.fileSize));
					} else {
						console.log('⚠️ Brak informacji o rozmiarze w nagłówkach');
						this.thumbnailData.fileSize = -1; // Oznacz jako nieznany
					}
				} else {
					console.log('⚠️ Błąd HTTP:', response.status, response.statusText);
					this.thumbnailData.fileSize = -1;
				}
			} catch (error) {
				console.log('⚠️ Błąd CORS lub sieci:', error.message);
				this.thumbnailData.fileSize = -1;

				// Alternatywna metoda - próba pobrania przez Image object
				this.tryAlternativeImageSize(imageUrl);
			}
		}

		tryAlternativeImageSize(imageUrl) {
			console.log('🔄 Próbuję alternatywną metodę pobierania rozmiaru...');

			const img = new Image();
			img.crossOrigin = 'anonymous'; // Próba ominięcia CORS

			img.onload = () => {
				console.log('✅ Obraz załadowany alternatywną metodą');
				// Niestety nie możemy pobrać rozmiaru pliku przez Image object
				// ale możemy potwierdzić, że obraz jest dostępny
			};

			img.onerror = () => {
				console.log('❌ Alternatywna metoda też nie zadziałała');
			};

			img.src = imageUrl;
		}

		formatFileSize(bytes) {
			if (bytes === 0) return '0 B';
			const k = 1024;
			const sizes = ['B', 'KB', 'MB', 'GB'];
			const i = Math.floor(Math.log(bytes) / Math.log(k));
			return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
		}

		generateFileName(offerName) {
			// Generuje nazwę pliku: "Raport jakości oferty" + 5 pierwszych słów z nazwy oferty
			let fileName = 'Raport jakości oferty';

			if (offerName && offerName.trim()) {
				// Usuń znaki specjalne i podziel na słowa
				const cleanName = offerName.replace(/[^\w\sąćęłńóśźż]/gi, '').trim();
				const words = cleanName.split(/\s+/).filter(word => word.length > 0);

				// Weź pierwsze 5 słów
				const firstWords = words.slice(0, 5).join(' ');

				if (firstWords) {
					fileName += ' - ' + firstWords;
				}
			}

			// Dodaj timestamp dla unikalności
			const now = new Date();
			const timestamp = now.getFullYear() + '-' +
				String(now.getMonth() + 1).padStart(2, '0') + '-' +
				String(now.getDate()).padStart(2, '0') + '_' +
				String(now.getHours()).padStart(2, '0') + '-' +
				String(now.getMinutes()).padStart(2, '0');

			// Usuń timestamp z nazwy pliku (będzie tylko w nazwie do kopiowania)
			return fileName;
		}

		copyReportFileName() {
			try {
				const fileName = this.generateFileName(this.offerName);

				// Użyj Clipboard API jeśli jest dostępne
				if (navigator.clipboard && window.isSecureContext) {
					navigator.clipboard.writeText(fileName).then(() => {
						this.showCopySuccess();
					}).catch(() => {
						// Fallback do starej metody
						this.fallbackCopyTextToClipboard(fileName);
					});
				} else {
					// Fallback dla starszych przeglądarek
					this.fallbackCopyTextToClipboard(fileName);
				}
			} catch (error) {
				console.error('❌ Błąd podczas kopiowania nazwy pliku:', error);
				this.showCopyError();
			}
		}

		fallbackCopyTextToClipboard(text) {
			const textArea = document.createElement('textarea');
			textArea.value = text;
			textArea.style.position = 'fixed';
			textArea.style.left = '-999999px';
			textArea.style.top = '-999999px';
			document.body.appendChild(textArea);
			textArea.focus();
			textArea.select();

			try {
				document.execCommand('copy');
				this.showCopySuccess();
			} catch (err) {
				console.error('❌ Fallback copy failed:', err);
				this.showCopyError();
			}

			document.body.removeChild(textArea);
		}

		showCopySuccess() {
			// Pokaż komunikat o sukcesie
			const notification = document.createElement('div');
			notification.style.cssText = [
				'position: fixed',
				'top: 20px',
				'right: 20px',
				'background: #10b981',
				'color: white',
				'padding: 12px 16px',
				'border-radius: 8px',
				'font-weight: 600',
				'z-index: 2147483648',
				'box-shadow: 0 4px 12px rgba(0,0,0,0.15)',
				'transition: opacity 0.3s ease'
			].join(';');
			notification.textContent = '✅ Nazwa raportu skopiowana do schowka!';

			document.body.appendChild(notification);

			// Usuń powiadomienie po 3 sekundach
			setTimeout(() => {
				notification.style.opacity = '0';
				setTimeout(() => notification.remove(), 300);
			}, 3000);
		}

		showCopyError() {
			// Pokaż komunikat o błędzie
			const notification = document.createElement('div');
			notification.style.cssText = [
				'position: fixed',
				'top: 20px',
				'right: 20px',
				'background: #ef4444',
				'color: white',
				'padding: 12px 16px',
				'border-radius: 8px',
				'font-weight: 600',
				'z-index: 2147483648',
				'box-shadow: 0 4px 12px rgba(0,0,0,0.15)',
				'transition: opacity 0.3s ease'
			].join(';');
			notification.textContent = '❌ Nie udało się skopiować nazwy raportu';

			document.body.appendChild(notification);

			// Usuń powiadomienie po 3 sekundach
			setTimeout(() => {
				notification.style.opacity = '0';
				setTimeout(() => notification.remove(), 300);
			}, 3000);
		}

		showNotification(message, type = 'success') {
			const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#f59e0b';

			const notification = document.createElement('div');
			notification.style.cssText = [
				'position: fixed',
				'top: 80px',
				'right: 20px',
				`background: ${bgColor}`,
				'color: white',
				'padding: 12px 16px',
				'border-radius: 8px',
				'font-weight: 600',
				'z-index: 2147483648',
				'box-shadow: 0 4px 12px rgba(0,0,0,0.15)',
				'transition: opacity 0.3s ease'
			].join(';');
			notification.textContent = message;

			document.body.appendChild(notification);

			// Usuń powiadomienie po 3 sekundach
			setTimeout(() => {
				notification.style.opacity = '0';
				setTimeout(() => notification.remove(), 300);
			}, 3000);
		}

		/**
		 * Wyświetla okno dialogowe do wpisania feedbacku
		 */
		showFeedbackDialog() {
			// Sprawdź czy użytkownik jest zalogowany
			if (!authManager.isLoggedIn()) {
				this.showNotification('⚠️ Musisz być zalogowany, aby wysłać feedback', 'error');
				return;
			}

			// Definicja kategorii (musi być zgodna z backendem)
			const feedbackCategories = [
				'Analiza obrazów',
				'Analiza opisu',
				'Dane sprzedawcy',
				'Parametry produktu',
				'Polityki zwrotów i reklamacji',
				'Allegro Pay i wysyłka',
				'Ogólna użyteczność'
			];

			// Obiekt do przechowywania ocen
			const ratings = {};

			// Utwórz overlay (tło)
			const overlay = document.createElement('div');
			overlay.style.cssText = [
				'position: fixed',
				'top: 0',
				'left: 0',
				'width: 100%',
				'height: 100%',
				'background: rgba(0, 0, 0, 0.45)',
				'z-index: 2147483647',
				'display: flex',
				'align-items: center',
				'justify-content: center',
				'backdrop-filter: blur(8px)',
				'-webkit-backdrop-filter: blur(8px)',
				'overflow-y: auto',
				'padding: 24px 0',
				'font-family: \'Inter\', system-ui, -apple-system, sans-serif'
			].join(';');

			// Utwórz dialog
			const dialog = document.createElement('div');
			dialog.style.cssText = [
				'background: #fafafa',
				'border-radius: 20px',
				'box-shadow: 0 24px 80px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.05)',
				'width: 90%',
				'max-width: 560px',
				'padding: 28px 32px',
				'position: relative',
				'animation: slideIn 0.3s ease',
				'max-height: 90vh',
				'overflow-y: auto',
				'border: 1px solid rgba(0, 0, 0, 0.06)'
			].join(';');

			// Tytuł
			const title = document.createElement('h2');
			title.textContent = 'Wyślij feedback';
			title.style.cssText = [
				'margin: 0 0 8px 0',
				'font-size: 22px',
				'font-weight: 700',
				'color: #111827',
				'letter-spacing: -0.03em',
				'line-height: 1.3'
			].join(';');

			// Opis
			const description = document.createElement('p');
			description.textContent = 'Oceń poszczególne funkcje wtyczki (opcjonalnie) i/lub napisz swoją opinię:';
			description.style.cssText = [
				'margin: 0 0 24px 0',
				'font-size: 14px',
				'color: #6b7280',
				'line-height: 1.55',
				'letter-spacing: -0.01em'
			].join(';');

			// Sekcja z ocenami gwiazdkowymi
			const ratingsSection = document.createElement('div');
			ratingsSection.style.cssText = [
				'background: #ffffff',
				'border-radius: 12px',
				'padding: 18px 20px',
				'margin-bottom: 20px',
				'border: 1px solid rgba(0, 0, 0, 0.06)',
				'box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04)'
			].join(';');

			const ratingsTitle = document.createElement('h3');
			ratingsTitle.textContent = 'Oceń funkcje (opcjonalnie)';
			ratingsTitle.style.cssText = [
				'margin: 0 0 14px 0',
				'font-size: 14px',
				'font-weight: 600',
				'color: #374151',
				'letter-spacing: -0.01em'
			].join(';');

			ratingsSection.appendChild(ratingsTitle);

			// Dodaj gwiazdki dla każdej kategorii
			feedbackCategories.forEach(category => {
				const categoryRow = document.createElement('div');
				categoryRow.style.cssText = [
					'display: flex',
					'justify-content: space-between',
					'align-items: center',
					'margin-bottom: 8px',
					'padding: 10px 12px',
					'background: #f9fafb',
					'border-radius: 10px'
				].join(';');

				const categoryLabel = document.createElement('span');
				categoryLabel.textContent = category;
				categoryLabel.style.cssText = [
					'font-size: 13px',
					'color: #4b5563',
					'flex: 1',
					'font-weight: 500',
					'letter-spacing: -0.01em'
				].join(';');

				const starsContainer = document.createElement('div');
				starsContainer.style.cssText = [
					'display: flex',
					'gap: 4px'
				].join(';');

				// Utwórz 5 gwiazdek
				for (let i = 1; i <= 5; i++) {
					const star = document.createElement('span');
					star.textContent = '⭐';
					star.dataset.rating = i;
					star.dataset.category = category;
					star.style.cssText = [
						'font-size: 20px',
						'cursor: pointer',
						'opacity: 0.3',
						'transition: all 0.2s',
						'user-select: none'
					].join(';');

					// Hover - podświetl gwiazdki do tej na którą najechano
					star.addEventListener('mouseenter', () => {
						const hoverRating = parseInt(star.dataset.rating);
						const allStars = starsContainer.querySelectorAll('span');

						allStars.forEach((s, index) => {
							if (index < hoverRating) {
								s.style.opacity = '1';
								s.style.transform = 'scale(1.1)';
							} else {
								s.style.opacity = '0.3';
								s.style.transform = 'scale(1)';
							}
						});
					});

					// Kliknięcie - zapisz ocenę
					star.addEventListener('click', () => {
						const rating = parseInt(star.dataset.rating);
						ratings[category] = rating;
					});

					starsContainer.appendChild(star);
				}

				// Mouseleave na kontenerze - przywróć stan zapisany
				starsContainer.addEventListener('mouseleave', () => {
					const allStars = starsContainer.querySelectorAll('span');
					const savedRating = ratings[category] || 0;

					allStars.forEach((s, index) => {
						if (index < savedRating) {
							s.style.opacity = '1';
						} else {
							s.style.opacity = '0.3';
						}
						s.style.transform = 'scale(1)';
					});
				});

				categoryRow.appendChild(categoryLabel);
				categoryRow.appendChild(starsContainer);
				ratingsSection.appendChild(categoryRow);
			});

			// Textarea
			const textarea = document.createElement('textarea');
			textarea.placeholder = 'Dodatkowe uwagi, sugestie lub zgłoszenia błędów... (opcjonalnie)';
			textarea.style.cssText = [
				'width: 100%',
				'min-height: 100px',
				'padding: 14px 16px',
				'border: 1px solid #e5e7eb',
				'border-radius: 12px',
				'font-size: 14px',
				'font-family: \'Inter\', system-ui, sans-serif',
				'resize: vertical',
				'margin-bottom: 20px',
				'box-sizing: border-box',
				'transition: border-color 0.2s, box-shadow 0.2s',
				'letter-spacing: -0.01em',
				'line-height: 1.5',
				'background: #fff'
			].join(';');

			textarea.addEventListener('focus', () => {
				textarea.style.borderColor = '#10b981';
				textarea.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.15)';
				textarea.style.outline = 'none';
			});

			textarea.addEventListener('blur', () => {
				textarea.style.borderColor = '#e5e7eb';
				textarea.style.boxShadow = 'none';
			});

			// Kontener na przyciski
			const buttonsContainer = document.createElement('div');
			buttonsContainer.style.cssText = [
				'display: flex',
				'gap: 12px',
				'justify-content: flex-end'
			].join(';');

			// Przycisk Anuluj
			const cancelBtn = document.createElement('button');
			cancelBtn.textContent = 'Anuluj';
			cancelBtn.style.cssText = [
				'padding: 10px 20px',
				'border: 1px solid #e5e7eb',
				'border-radius: 10px',
				'background: #fff',
				'color: #6b7280',
				'font-size: 14px',
				'font-weight: 600',
				'cursor: pointer',
				'transition: all 0.2s',
				'letter-spacing: -0.01em',
				'font-family: inherit'
			].join(';');

			cancelBtn.addEventListener('mouseenter', () => {
				cancelBtn.style.background = '#f3f4f6';
			});

			cancelBtn.addEventListener('mouseleave', () => {
				cancelBtn.style.background = 'white';
			});

			cancelBtn.addEventListener('click', () => {
				overlay.remove();
			});

			// Przycisk Wyślij
			const sendBtn = document.createElement('button');
			sendBtn.textContent = '📤 Wyślij';
			sendBtn.style.cssText = [
				'padding: 10px 22px',
				'border: none',
				'border-radius: 10px',
				'background: #059669',
				'color: white',
				'font-size: 14px',
				'font-weight: 600',
				'cursor: pointer',
				'transition: all 0.2s',
				'letter-spacing: -0.01em',
				'font-family: inherit',
				'box-shadow: 0 1px 3px rgba(5, 150, 105, 0.25)'
			].join(';');

			sendBtn.addEventListener('mouseenter', () => {
				sendBtn.style.background = '#047857';
				sendBtn.style.boxShadow = '0 2px 6px rgba(5, 150, 105, 0.35)';
			});

			sendBtn.addEventListener('mouseleave', () => {
				sendBtn.style.background = '#059669';
				sendBtn.style.boxShadow = '0 1px 3px rgba(5, 150, 105, 0.25)';
			});

			sendBtn.addEventListener('click', async () => {
				const feedbackText = textarea.value.trim();
				const hasRatings = Object.keys(ratings).length > 0;

				// Walidacja - wymagany feedback lub oceny
				if (feedbackText.length === 0 && !hasRatings) {
					this.showNotification('⚠️ Dodaj ocenę gwiazdkową lub feedback tekstowy', 'error');
					return;
				}

				// Jeśli jest feedback tekstowy, musi mieć minimum 10 znaków
				if (feedbackText.length > 0 && feedbackText.length < 10) {
					this.showNotification('⚠️ Feedback jest za krótki (min. 10 znaków)', 'error');
					textarea.focus();
					return;
				}

				// Zablokuj przycisk podczas wysyłania
				sendBtn.disabled = true;
				sendBtn.textContent = '⏳ Wysyłanie...';
				sendBtn.style.opacity = '0.7';
				sendBtn.style.cursor = 'wait';

				// Wyślij feedback z ocenami
				const result = await authManager.sendFeedback(
					feedbackText,
					ratings,
					window.location.href,
					this.offerName || this.productName || ''
				);

				if (result.success) {
					const message = hasRatings && feedbackText.length > 0
						? '✅ Dziękujemy za oceny i feedback!'
						: hasRatings
							? '✅ Dziękujemy za oceny!'
							: '✅ Dziękujemy za feedback!';
					this.showNotification(message, 'success');
					overlay.remove();
				} else {
					this.showNotification(`❌ ${result.message}`, 'error');
					sendBtn.disabled = false;
					sendBtn.textContent = '📤 Wyślij';
					sendBtn.style.opacity = '1';
					sendBtn.style.cursor = 'pointer';
				}
			});

			// Zamykanie na ESC
			const handleEsc = (e) => {
				if (e.key === 'Escape') {
					overlay.remove();
					document.removeEventListener('keydown', handleEsc);
				}
			};
			document.addEventListener('keydown', handleEsc);

			// Zamykanie po kliknięciu w overlay
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					overlay.remove();
				}
			});

			// Złóż wszystko razem
			buttonsContainer.appendChild(cancelBtn);
			buttonsContainer.appendChild(sendBtn);

			dialog.appendChild(title);
			dialog.appendChild(description);
			dialog.appendChild(ratingsSection);
			dialog.appendChild(textarea);
			dialog.appendChild(buttonsContainer);

			overlay.appendChild(dialog);
			document.body.appendChild(overlay);

			// Dodaj animację
			const style = document.createElement('style');
			style.textContent = `
		@keyframes slideIn {
			from {
				opacity: 0;
				transform: translateY(-20px);
			}
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}
	`;
			document.head.appendChild(style);

			// Nie ustawiamy automatycznie focusu - użytkownik może chcieć tylko ocenić gwiazdkami
		}

		observeDomChanges() {
			if (this.mutationObserver) return;
			this.mutationObserver = new MutationObserver(() => {
				this.debounce(() => this.scanAndRender(), 500);
			});
			this.mutationObserver.observe(document.body, {
				subtree: true,
				childList: true
			});
		}

		debounce(fn, waitMs) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(fn, waitMs);
		}

		formatDateTime(date) {
			try {
				return new Intl.DateTimeFormat('pl-PL', {
					year: 'numeric', month: '2-digit', day: '2-digit',
					hour: '2-digit', minute: '2-digit', second: '2-digit'
				}).format(date);
			} catch (e) {
				return date.toLocaleString();
			}
		}

		async generateReport() {
			// === WERYFIKACJA AUTORYZACJI ===
			if (!authManager.isLoggedIn()) {
				alert('Musisz być zalogowany, aby wygenerować raport!');
				return;
			}

			if (authManager.getRemainingReports() <= 0) {
				alert('Brak dostępnych raportów! Skontaktuj się z administratorem aby doładować konto.');
				return;
			}

			const loadingMsg = document.createElement('div');
			loadingMsg.style.cssText = [
				'position: fixed',
				'top: 50%',
				'left: 50%',
				'transform: translate(-50%, -50%)',
				'background: rgba(30, 30, 30, 0.95)',
				'color: #fff',
				'padding: 28px 44px',
				'border-radius: 16px',
				'z-index: 2147483648',
				'font-family: \'Inter\', system-ui, -apple-system, sans-serif',
				'font-size: 16px',
				'font-weight: 600',
				'letter-spacing: -0.02em',
				'line-height: 1.4',
				'box-shadow: 0 24px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)',
				'backdrop-filter: blur(12px)',
				'-webkit-backdrop-filter: blur(12px)'
			].join(';');
			loadingMsg.textContent = '⏳ Zbieram dane do raportu...';
			document.body.appendChild(loadingMsg);

			const result = await authManager.useReport();

			loadingMsg.remove();

			if (!result.success) {
				alert('Błąd: ' + result.message);
				return;
			}

			// Zaktualizuj licznik w UI
			const reportsCountEl = document.getElementById('reports-count');
			if (reportsCountEl) {
				reportsCountEl.textContent = authManager.getRemainingReports();
				reportsCountEl.style.transform = 'scale(1.3)';
				reportsCountEl.style.color = '#dc2626';
				setTimeout(() => {
					reportsCountEl.style.transform = 'scale(1)';
					reportsCountEl.style.color = '#059669';
				}, 300);
			}

			console.log(`✅ Raport użyty. Pozostało: ${authManager.getRemainingReports()}`);
			// === KONIEC WERYFIKACJI ===

			// Wykonaj pełne skanowanie
			loadingMsg.textContent = '⏳ Zbieram dane do raportu...';
			document.body.appendChild(loadingMsg);

			try {
				// Uruchom skanowanie - wszystkie okna zostaną otwarte i zamknięte
				// Na końcu uruchomi się analiza AI
				await this.performSequentialScan();

				// Skanowanie zakończone - analiza AI powinna być w toku lub już zakończona
				// Nie potrzebujemy dodatkowej pętli czekającej, bo await w performSequentialScan już czeka

				loadingMsg.textContent = '📄 Generowanie PDF...';

				// Poczekaj chwilę przed generowaniem PDF
				await new Promise(resolve => setTimeout(resolve, 500));

				// Generuj PDF
				this.generatePdfReport();

				this.showNotification('✅ Raport został wygenerowany!');
			} catch (error) {
				console.error('❌ Błąd podczas generowania raportu:', error);
				this.showNotification('❌ Błąd podczas generowania raportu', 'error');
			} finally {
				setTimeout(() => loadingMsg.remove(), 1000);
			}
		}

		generatePdfReport() {
			console.log('📄 === GENEROWANIE RAPORTU PDF ===');
			console.log(`📊 Zebrane dane do raportu:`);
			console.log(`   - Kontroferty: ${this.competitorOffers.length} ofert`);
			console.log(`   - Parametry w opisie: ${this.parametersInDescription.length} parametrów (${this.parametersInDescriptionScore}% zgodności)`);
			console.log(`   - Analiza AI: ${this.descriptionAiAnalysis ? 'TAK (' + this.descriptionAiTokensUsed + ' tokenów)' : 'NIE'}`);
			console.log(`   - Sekcje promocyjne: ${this.promotionalSections.length}`);
			console.log(`   - Sekcja zestawów: ${this.bundleSection ? 'TAK' : 'NIE'}`);
			console.log(`   - Sekcja propozycji: ${this.suggestionsSection ? 'TAK' : 'NIE'}`);
			console.log(`   - Opis - znaków: ${this.descriptionLength}, obrazów: ${this.descriptionImagesCount}, pogrubień: ${this.descriptionBoldPercent}%`);

			const now = this.lastScanDate || new Date();
			const title = 'Raport – Analiza strony Allegro';
			const url = window.location.href;
			const quality = this.offerQuality;
			const productName = this.productName || 'Nie znaleziono';
			const offerName = this.offerName || 'Nie znaleziono';
			const matchStatus = this.nameMatchStatus;
			const suggestion = matchStatus === 'mismatch' ? 'Napisz do Allegro o aktualizację nazwy produktu, aby była zgodna z tytułem oferty.' : '';
			const rating = this.productRating;
			const ratingCount = this.ratingCount;
			const reviewCount = this.reviewCount;
			const hasThumbnail = this.hasThumbnail;
			const thumbnailData = this.thumbnailData;
			const nameAnalysis = this.nameAnalysis;
			const allImages = this.allImages;
			const hasAllegroSmart = this.hasAllegroSmart;
			const hasBestPriceGuarantee = this.hasBestPriceGuarantee;
			const hasAllegroPay = this.hasAllegroPay;
			const productParameters = this.productParameters;
			const parametersCount = this.parametersCount;
			const hasBrand = this.hasBrand;
			const brandName = this.brandName;
			const brandLink = this.brandLink;
			const brandType = this.brandType;

			// Monety i Kupony
			const hasCoins = this.hasCoins;
			const hasCoupons = this.hasCoupons;

			// Generuj nazwę pliku
			const fileName = this.generateFileName(offerName);
			this.aiImageAnalysis = this.normalizeAiImageAnalysis(this.aiImageAnalysis);


			const html = `<!DOCTYPE html>
			<html lang="pl">
			<head>
			<meta charset="utf-8" />
			<title>${fileName}</title>
			<meta name="filename" content="${fileName}" />
			<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
			<style>
				body { 
					font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; 
					color: #111827; 
					margin: 32px;
					line-height: 1.6;
					letter-spacing: -0.01em;
					-webkit-print-color-adjust: exact;
					print-color-adjust: exact;
					-webkit-user-select: text;
					user-select: text;
				}
				h1 { 
					font-size: 24px; 
					margin: 0 0 8px;
					color: #1f2937;
					letter-spacing: -0.02em;
				}
				.header { 
					margin-bottom: 24px;
					border-bottom: 2px solid #ff5a00;
					padding-bottom: 16px;
				}
				.url {
					font-size: 12px;
					color: #6b7280;
					word-break: break-all;
					margin-top: 8px;
				}
				.section {
					margin-bottom: 24px;
				}
				.section-title {
					font-size: 17px;
					font-weight: 600;
					color: #111827;
					margin-bottom: 12px;
					padding: 10px 14px;
					background: #f9fafb;
					border-left: 4px solid #ff5a00;
					border-radius: 0 8px 8px 0;
					letter-spacing: -0.02em;
				}
				.card { 
					border: 1px solid #e5e7eb; 
					border-radius: 12px; 
					padding: 18px 20px;
					background: #ffffff;
					box-shadow: 0 1px 3px rgba(0,0,0,0.04);
				}
				.row { 
					display: flex; 
					justify-content: space-between; 
					align-items: center;
					margin-bottom: 12px;
					padding: 10px 0;
					border-bottom: 1px solid #f3f4f6;
				}
				.row:last-child {
					border-bottom: none;
				}
				.label { 
					color: #6b7280;
					font-weight: 500;
					font-size: 14px;
					letter-spacing: -0.01em;
				}
				.value { 
					font-weight: 600;
					color: #111827;
					font-size: 14px;
					letter-spacing: -0.01em;
				}
				.names-grid {
					display: grid;
					grid-template-columns: 1fr 1fr;
					gap: 20px;
					margin-top: 12px;
				}
				.name-box {
					border: 1px solid #e5e7eb;
					border-radius: 8px;
					padding: 12px;
					background: #f9fafb;
				}
				.name-label {
					font-size: 12px;
					color: #6b7280;
					margin-bottom: 8px;
					text-transform: uppercase;
					letter-spacing: 0.5px;
				}
				.name-value {
					font-weight: 600;
					color: #111827;
					word-wrap: break-word;
					line-height: 1.4;
				}
				.analysis-result {
					margin-top: 16px;
					padding: 12px;
					border-radius: 8px;
					border: 1px solid #e5e7eb;
				}
				.analysis-result.match {
					background: #f0fdf4;
					border-color: #86efac;
				}
				.analysis-result.partial {
					background: #fefce8;
					border-color: #fbbf24;
				}
				.analysis-result.mismatch {
					background: #fef2f2;
					border-color: #fca5a5;
				}
				.analysis-result.unknown {
					background: #f9fafb;
					border-color: #e5e7eb;
				}
				.analysis-label {
					font-size: 14px;
					color: #6b7280;
					margin-bottom: 8px;
				}
				.analysis-status {
					font-size: 16px;
					font-weight: 600;
					color: #111827;
					margin-bottom: 8px;
				}
				.suggestion {
					font-size: 14px;
					color: #dc2626;
					padding: 8px;
					background: #fef2f2;
					border-radius: 6px;
					border-left: 3px solid #dc2626;
					margin-top: 8px;
				}
				.footer { 
					margin-top: 32px; 
					padding-top: 16px;
					border-top: 1px solid #e5e7eb;
					font-size: 11px; 
					color:#9ca3af;
					text-align: center;
				}
				@media print { 
					.no-print { display: none; }
					body { margin: 20px; }
				}
			</style>
			</head>
			<body>
				<div class="header">
					<h1>${title}</h1>
					<div><strong>Strona:</strong> ${escapeHtml(document.title)}</div>
				</div>
				
				<div class="section">
					<div class="section-title">📊 Statystyki strony</div>
					<div class="card">
						<div class="row">
							<div class="label">Jakość oferty:</div>
							<div class="value">${quality}%</div>
						</div>
						<div class="row">
							<div class="label">Data skanowania:</div>
							<div class="value">${escapeHtml(this.formatDateTime(now))}</div>
						</div>
					</div>
				</div>

				<div class="section">
					<div class="section-title">👤 Informacje o sprzedawcy</div>
					<div class="card">
						<div class="row">
							<div class="label">Nazwa sprzedawcy:</div>
							<div class="value">${escapeHtml(this.sellerName)}</div>
						</div>
						<div class="row">
							<div class="label">Procent rekomendacji:</div>
							<div class="value" style="color:${this.sellerRecommendationPercent >= 95 ? '#059669' : this.sellerRecommendationPercent >= 80 ? '#ca8a04' : '#dc2626'}; font-weight:700;">
								${this.sellerRecommendationPercent > 0 ? (this.sellerRecommendationPercent % 1 === 0 ? this.sellerRecommendationPercent : this.sellerRecommendationPercent.toFixed(1)) + '%' : '0%'}
								${this.sellerRecommendationPercent >= 95 ? '🌟' : this.sellerRecommendationPercent >= 80 ? '⚠️' : '❌'}
							</div>
						</div>
					</div>
					
					${this.sellerCompanyName || this.sellerCategoryLink || this.sellerAllItemsLink || this.sellerAboutLink || this.sellerAskQuestionLink ? `
					<div style="margin-top:16px; padding:12px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb;">
						<div style="font-weight:600; color:#374151; margin-bottom:12px; font-size:14px;">📋 Szczegóły sprzedawcy</div>
						
						${this.sellerCompanyName ? `
						<div class="row" style="margin-bottom:8px;">
							<div class="label">Nazwa firmy:</div>
							<div class="value">
								${escapeHtml(this.sellerCompanyName)}
								${!this.sellerCompanyNameMatch ? '<span style="color:#dc2626; font-weight:700;"> ⚠️ NIEZGODNOŚĆ</span>' : '<span style="color:#059669;"> ✅</span>'}
							</div>
						</div>
						` : ''}
						
						${this.sellerCategoryLink ? `
						<div class="row" style="margin-bottom:8px;">
							<div class="label">Przedmioty sprzedawcy w kategorii:</div>
							<div class="value">
								<a href="${escapeHtml(this.sellerCategoryLink)}" target="_blank" style="color:#2563eb; text-decoration:none;">
									${escapeHtml(this.sellerCategoryName || 'Zobacz przedmioty z kategorii')} →
								</a>
							</div>
						</div>
						` : ''}
						
						${this.sellerAllItemsLink ? `
						<div class="row" style="margin-bottom:8px;">
							<div class="label">Wszystkie przedmioty:</div>
							<div class="value">
								<a href="${escapeHtml(this.sellerAllItemsLink)}" target="_blank" style="color:#2563eb; text-decoration:none;">
									Zobacz wszystkie przedmioty sprzedającego →
								</a>
							</div>
						</div>
						` : ''}
						
						<div style="margin-top:12px; padding-top:12px; border-top:1px dashed #e5e7eb; display:flex; gap:16px;">
							${this.sellerAboutLink ? `
							<div>
								<a href="${escapeHtml(this.sellerAboutLink)}" target="_blank" style="color:#2563eb; text-decoration:none; font-size:13px;">
									📄 O sprzedającym
								</a>
							</div>
							` : ''}
							${this.sellerAskQuestionLink ? `
							<div>
								<a href="${escapeHtml(this.sellerAskQuestionLink)}" target="_blank" style="color:#2563eb; text-decoration:none; font-size:13px;">
									💬 Zadaj pytanie
								</a>
							</div>
							` : ''}
						</div>
					</div>
					` : ''}
				</div>

				<div class="section">
					<div class="section-title">🔍 Zgodność nazw produktu i oferty</div>
					<div class="names-grid">
						<div class="name-box">
							<div class="name-label">Nazwa Produktu</div>
							<div class="name-value">${escapeHtml(productName)}</div>
						</div>
						<div class="name-box">
							<div class="name-label">Nazwa Oferty</div>
							<div class="name-value">${escapeHtml(offerName)}</div>
						</div>
					</div>
					
					<div class="analysis-result ${matchStatus}">
						<div class="analysis-label">Wynik ogólnej analizy zgodności:</div>
						<div class="analysis-status">
							${matchStatus === 'match' ? '✅ Nazwy są zgodne' :
					matchStatus === 'partial' ? '🟡 Nazwy są częściowo zgodne' :
						matchStatus === 'mismatch' ? '❌ Nazwy nie są zgodne' :
							'❓ Nie można określić zgodności'}
						</div>
						${suggestion ? `<div class="suggestion"><strong>💡 Sugestia:</strong> ${escapeHtml(suggestion)}</div>` : ''}
					</div>
				</div>

				${this.competitorOffers.length > 0 ? `
				<div class="section">
					<div class="section-title">🏪 Analiza kontrofert (${this.competitorOffersCount} ofert)</div>
					<div style="margin-bottom:16px; padding:12px; background:#fff7ed; border-radius:8px; border:1px solid #fb923c;">
						<div style="font-weight:600; color:#374151; margin-bottom:8px;">
							💡 Analiza pierwszych ${this.competitorOffers.length} kontrofert
						</div>
						${this.lowestCompetitorPrice !== null ? `
						<div style="color:#6b7280; font-size:13px;">
							<strong>Najniższa cena konkurencji:</strong> ${this.lowestCompetitorPrice.toFixed(2)} zł<br>
							<strong>Średnia cena konkurencji:</strong> ${this.averageCompetitorPrice.toFixed(2)} zł
						</div>
						` : ''}
					</div>
					
					<table style="width:100%; border-collapse:collapse; font-size:12px;">
						<thead>
							<tr style="background:#f9fafb;">
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:5%;">#</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:15%;">Sprzedawca</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:right; width:10%;">Cena</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:right; width:12%;">Z dostawą</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:12%;">Dostawa</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:center; width:8%;">Rekomendacja</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:center; width:8%;">Smart</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left;">Szczegóły</th>
							</tr>
						</thead>
						<tbody>
							${this.competitorOffers.map((offer, idx) => `
								<tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''}">
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${offer.position}</td>
									<td style="padding:8px; border:1px solid #e5e7eb;">
										<div style="font-weight:600; color:#374151;">${escapeHtml(offer.seller)}</div>
										${offer.isSuperSeller ? '<div style="color:#059669; font-size:11px;">⭐ Super Sprzedawca</div>' : ''}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:right; font-weight:700;">
										${offer.price ? offer.price.toFixed(2) + ' zł' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:right; font-weight:600;">
										${offer.priceWithDelivery ? offer.priceWithDelivery.toFixed(2) + ' zł' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; color:#6b7280;">
										${escapeHtml(offer.deliveryTime) || '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${offer.sellerRecommendation >= 95 ? '#059669' : offer.sellerRecommendation >= 80 ? '#ca8a04' : '#dc2626'};">
										${offer.sellerRecommendation > 0 ? offer.sellerRecommendation + '%' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-size:16px;">
										${offer.hasSmart ? '✅' : '❌'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; font-size:11px; color:#6b7280;">
										${offer.condition ? 'Stan: ' + escapeHtml(offer.condition) : ''}
										${offer.condition && offer.warranty ? '<br>' : ''}
										${offer.warranty ? 'Gwarancja: ' + escapeHtml(offer.warranty) : ''}
										${offer.hasPay ? '<br>💳 Allegro Pay' : ''}
									</td>
								</tr>
							`).join('')}
						</tbody>
					</table>
				</div>
				` : ''}

			<div class="section">
				<div class="section-title">⭐ Ocena produktu</div>
				<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
					<thead>
						<tr style="background:#f9fafb;">
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Metryka</th>
							<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:100px;">Wynik</th>
							<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:120px;">Status</th>
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Rekomendacja Systemu</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba ocen</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${ratingCount > 0 ? ratingCount : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.ratingCountEvaluation.color};">${this.ratingCountEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.ratingCountEvaluation.color};">${this.ratingCountEvaluation.recommendation}</td>
						</tr>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba recenzji</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${reviewCount > 0 ? reviewCount : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.reviewCountEvaluation.color};">${this.reviewCountEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.reviewCountEvaluation.color};">${this.reviewCountEvaluation.recommendation}</td>
						</tr>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Średnia ocen</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${rating > 0 ? rating.toFixed(2) : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.ratingValueEvaluation.color};">${this.ratingValueEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.ratingValueEvaluation.color};">${this.ratingValueEvaluation.recommendation}</td>
						</tr>
					</tbody>
				</table>

				<!-- WSKAZÓWKI EKSPERCKIE -->
				<div style="margin-top:16px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">

					<!-- Infoboks: Zmiana algorytmu Allegro -->
					<div style="background:#eff6ff; border-bottom:1px solid #bfdbfe; padding:12px 16px; display:flex; align-items:flex-start; gap:10px;">
						<span style="font-size:18px; flex-shrink:0;">ℹ️</span>
						<div>
							<div style="font-weight:700; color:#1d4ed8; margin-bottom:4px; font-size:13px;">Ważne: Zmiany w algorytmie Allegro</div>
							<div style="font-size:12px; color:#1e40af; line-height:1.5;">Obecnie przy sortowaniu listingu liczą się: <strong>średnia ocena</strong>, <strong>liczba ocen</strong> oraz <strong>wskaźnik świeżości</strong>. Produkt z oceną 4.79, ale z ogromną liczbą nowych opinii, będzie wyżej niż produkt z oceną 5.0, który ma tylko dwie stare oceny.</div>
						</div>
					</div>

					<!-- Nagłówek sekcji wskazówek -->
					<div style="background:#f9fafb; padding:10px 16px; border-bottom:1px solid #e5e7eb;">
						<div style="font-weight:700; color:#374151; font-size:13px;">💡 Wskazówki optymalizacyjne – Jak działać na listingu?</div>
					</div>

					<!-- Dwie kolumny: CO ROBIĆ / CZEGO NIE WOLNO -->
					<div style="display:flex; gap:0;">

						<!-- CO ROBIĆ -->
						<div style="flex:1; padding:14px 16px; border-right:1px solid #e5e7eb; background:#f0fdf4;">
							<div style="font-weight:700; color:#15803d; margin-bottom:10px; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">✅ Co robić (Dobre praktyki)</div>
							<ul style="margin:0; padding:0; list-style:none; font-size:12px; color:#166534; line-height:1.6;">
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Stawiaj na skalę:</strong> Duża liczba pozytywów "przykryje" pojedyncze błędy i utrzyma Cię wysoko.</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Dbaj o "świeżość":</strong> Algorytm kocha nowe opinie. Jeśli oferta spada, pobudzaj sprzedaż (np. czasowymi obniżkami).</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Miłe gesty w paczce:</strong> Dorzucaj próbki, cukierki lub liściki z podziękowaniem – buduje to wdzięczność i chęć wystawienia 5 gwiazdek.</span></li>
								<li style="display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Proś wprost:</strong> Zawsze proś o opinię w wiadomości lub ulotce (ale nic za nią nie oferuj!).</span></li>
							</ul>
						</div>

						<!-- CZEGO NIE WOLNO -->
						<div style="flex:1; padding:14px 16px; background:#fff7f7;">
							<div style="font-weight:700; color:#b91c1c; margin-bottom:10px; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">❌ Czego nie wolno (Ryzyko blokady)</div>
							<ul style="margin:0; padding:0; list-style:none; font-size:12px; color:#7f1d1d; line-height:1.6;">
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Handel opiniami:</strong> Surowy zakaz oferowania rabatów, gratisów czy gotówki w zamian za ocenę lub jej zmianę.</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Szantaż reklamacyjny:</strong> Nie uzależniaj zwrotu wpłaty od usunięcia negatywu. Najpierw pomóż, potem licz na dobrą wolę.</span></li>
								<li style="display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Sztuczny ruch:</strong> Kupowanie własnych produktów dla opinii jest łatwo wykrywalne i surowo karane przez Allegro.</span></li>
							</ul>
						</div>
					</div>
				</div>
			</div>

			<!-- TABELA: Funkcje Allegro -->
				<div class="section">
					<div class="section-title">🎯 Funkcje Allegro - Podsumowanie</div>
					<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
						<thead>
							<tr style="background:#f9fafb;">
								<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Funkcja</th>
								<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:80px;">Status</th>
								<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Rekomendacja</th>
							</tr>
						</thead>
						<tbody>
						${(() => {
					const features = this.generateAllegroFeaturesRecommendations();
					return `
									<tr>
										<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">🎯 Allegro SMART!</td>
										<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
											${features.smart.hasFeature ? '✅' : '❌'}
										</td>
										<td style="padding:12px; border:1px solid #e5e7eb; color:${features.smart.hasFeature ? '#059669' : '#dc2626'};">
											${features.smart.recommendation}
										</td>
									</tr>
									<tr>
										<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">💰 Gwarancja najniższej ceny</td>
										<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
											${features.bestPrice.hasFeature ? '✅' : '❌'}
										</td>
										<td style="padding:12px; border:1px solid #e5e7eb; color:${features.bestPrice.hasFeature ? '#059669' : '#dc2626'};">
											${features.bestPrice.recommendation}
										</td>
									</tr>
									<tr>
										<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">
											💳 Allegro Pay
											${features.allegroPay.type === 'installments' ? '<br><span style="font-size:11px; color:#6b7280; font-weight:normal;">(' + features.allegroPay.details + ')</span>' : ''}
										</td>
										<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
											${features.allegroPay.hasFeature ? '✅' : '❌'}
										</td>
										<td style="padding:12px; border:1px solid #e5e7eb; color:${features.allegroPay.hasFeature ? '#059669' : '#dc2626'};">
											${features.allegroPay.recommendation}
										</td>
									</tr>
									<tr>
										<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">🎫 Kupony rabatowe</td>
										<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
											${features.coupons.hasFeature ? '✅' : '❌'}
										</td>
										<td style="padding:12px; border:1px solid #e5e7eb; color:${features.coupons.hasFeature ? '#059669' : '#dc2626'};">
											${features.coupons.recommendation}
										</td>
									</tr>
								`;
				})()}
						</tbody>
					</table>
				</div>

				<div class="section">
					<div class="section-title">🛡️ Reklamacja, Gwarancja, Allegro Ochrona Kupujących</div>
					<div class="card">
						<div class="row">
							<div class="label">Jakość ochrony:</div>
							<div class="value" style="color: ${this.protectionQuality >= 75 ? '#059669' : this.protectionQuality >= 50 ? '#d97706' : '#dc2626'}; font-weight: 700;">${this.protectionQuality}%</div>
						</div>
						<div class="row">
							<div class="label">Zwroty:</div>
							<div class="value">${this.hasReturnPolicy ? `${this.returnDays} dni${this.returnDays > 14 ? ' (ponad standard)' : this.returnDays === 14 ? ' (standard)' : ' (poniżej standardu)'}` : 'Brak informacji'}</div>
						</div>
						<div class="row">
							<div class="label">Reklamacje:</div>
							<div class="value">${this.hasComplaintPolicy ? this.complaintPeriod : 'Brak informacji'}</div>
						</div>
						<div class="row">
							<div class="label">Gwarancja:</div>
							<div class="value">${this.hasWarranty ? this.warrantyPeriod : 'Brak informacji'}</div>
						</div>
						<div class="row">
							<div class="label">Allegro Protect:</div>
							<div class="value">${this.hasAllegroProtect ? this.allegroProtectPeriod : 'Brak informacji'}</div>
						</div>
						${this.protectionQuality < 100 ? `
						<div class="row">
							<div class="label">Rekomendacja:</div>
							<div class="value" style="color: #dc2626; font-weight: 600;">
								${this.protectionQuality < 25 ? 'Krytyczne braki w politykach ochrony - dodaj brakujące elementy' :
						this.protectionQuality < 50 ? 'Znaczące braki - uzupełnij polityki ochrony' :
							this.protectionQuality < 75 ? 'Drobne braki - rozważ uzupełnienie' :
								'Niemal kompletne - dodaj ostatnie elementy'}
							</div>
						</div>
						` : `
						<div class="row">
							<div class="label">Status:</div>
							<div class="value" style="color: #059669; font-weight: 600;">Kompletna ochrona kupujących ✅</div>
						</div>
						`}
					</div>
				</div>

				<div class="section">
					<div class="section-title">📋 Parametry produktu</div>
					<div class="card">
						<div class="row">
							<div class="label">Liczba parametrów:</div>
							<div class="value">${parametersCount}</div>
						</div>
						<div class="row">
							<div class="label">Status marki:</div>
							<div class="value analysis-result ${hasBrand ? 'match' : 'mismatch'}">
								${hasBrand ? (brandType === 'producent' ? '✅ Ma producenta' : '✅ Ma markę') : '❌ Bez marki'}
							</div>
						</div>
						${hasBrand && brandName ? `
						<div class="row">
							<div class="label">${brandType === 'producent' ? 'Producent:' : 'Marka:'}</div>
							<div class="value">
								${brandLink ?
							`<a href="${brandLink}" target="_blank" style="color: #2563eb; text-decoration: underline;">${escapeHtml(brandName)}</a>` :
							escapeHtml(brandName)
						}
							</div>
						</div>
						` : ''}
					</div>
					
					${parametersCount > 0 ? `
					<div style="margin-top: 16px;">
						<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📋 Pełna lista parametrów</div>
						<div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
							${productParameters.map((param, index) => `
								<div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #ffffff;">
									<div style="font-weight: 600; margin-bottom: 4px; color: #374151;">
										${index + 1}. ${escapeHtml(param.name)}
									</div>
									<div style="font-size: 14px; color: #6b7280; margin-bottom: 6px;">
										<strong>Wartość:</strong> 
										${param.hasLink ?
							`<a href="${param.link}" target="_blank" style="color: #2563eb; text-decoration: underline;">${escapeHtml(param.value)}</a>` :
							escapeHtml(param.value)
						}
									</div>
									${param.hasLink ? `
									<div style="font-size: 11px; color: #9ca3af;">
										<strong>Link:</strong> ${escapeHtml(param.link)}
									</div>
									` : ''}
								</div>
							`).join('')}
						</div>
					</div>
					` : '<div style="color: #6b7280; font-style: italic; text-align: center; padding: 16px;">Nie znaleziono parametrów produktu</div>'}
				</div>

				<div class="section">
					<div class="section-title">🎁 Pod miniaturami</div>
					${this.promotionalSections.length === 0 ? `
					<div class="card" style="background:#fee2e2; border:2px solid #dc2626;">
						<div class="row">
							<div class="label" style="color:#991b1b; font-weight:700;">Status:</div>
							<div class="value" style="color:#dc2626; font-weight:700;">❌ BRAK SEKCJI</div>
						</div>
						<div style="margin-top:12px; padding:12px; background:#fef2f2; border-radius:6px; color:#7f1d1d; font-size:13px; line-height:1.6;">
							<strong>⚠️ Nie znaleziono żadnej sekcji pod miniaturami.</strong><br>
							Allegro nie wyświetla ani promocji sprzedawcy, ani sekcji sponsorowanych.<br>
							Może to oznaczać problem z konfiguracją aukcji.
						</div>
					</div>
					` : `
					${this.promotionalSections.map((section) => `
					<div style="border:2px solid ${section.isSponsored ? '#dc2626' : section.qualityColor}; border-radius:8px; padding:16px; margin-bottom:16px; background:${section.isSponsored ? '#fee2e2' : '#f0fdf4'};">
						<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
							<div style="font-size:16px; font-weight:700; color:#374151; flex:1;">
								${escapeHtml(section.title)}
							</div>
							<div style="font-size:11px; font-weight:600; padding:4px 8px; border-radius:4px; ${section.isSponsored ? 'background:#ef4444; color:white;' : 'background:#10b981; color:white;'}">
								${section.isSponsored ? '🔶 SPONSOROWANE' : '✅ WŁASNE'}
							</div>
						</div>
						<div class="row">
							<div class="label">Typ sekcji:</div>
							<div class="value" style="color:${section.isSponsored ? '#dc2626' : '#10b981'};">${escapeHtml(section.sectionType)}</div>
						</div>
						<div class="row">
							<div class="label">Liczba produktów:</div>
							<div class="value" style="font-weight:700;">${section.productCount}</div>
						</div>
						${!section.isSponsored ? `
						<div class="row">
							<div class="label">Ocena jakości:</div>
							<div class="value" style="color:${section.qualityColor}; font-weight:700;">${section.qualityRating}</div>
						</div>
						${section.qualityMessage ? `
						<div style="font-size:13px; color:#374151; margin-top:8px; padding:10px; background:#fef3c7; border-left:3px solid ${section.qualityColor}; border-radius:4px;">
							<strong>💡</strong> ${escapeHtml(section.qualityMessage)}
						</div>
						` : ''}
						` : ''}
						${section.description ? `
						<div style="font-size:13px; color:#6b7280; margin-top:8px; padding:8px; background:#f9fafb; border-left:2px solid ${section.isSponsored ? '#dc2626' : section.qualityColor};">
							<strong>Opis:</strong> ${escapeHtml(section.description)}
						</div>
						` : ''}
						${section.offers.length > 0 ? `
						<div style="margin-top:12px;">
							<table style="width:100%; border-collapse:collapse; font-size:13px;">
								<thead>
									<tr style="background:#f3f4f6; border-bottom:1px solid #e5e7eb;">
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Nazwa oferty</th>
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Cena</th>
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Link do oferty</th>
									</tr>
								</thead>
								<tbody>
									${section.offers.map((offer) => `
									<tr style="border-bottom:1px solid #e5e7eb;">
										<td style="padding:8px; color:#374151;">${escapeHtml(offer.name)}</td>
										<td style="padding:8px; color:${section.isSponsored ? '#dc2626' : '#059669'}; font-weight:600;">${escapeHtml(offer.price)}</td>
										<td style="padding:8px;">
											${offer.link ? `<a href="${escapeHtml(offer.link)}" target="_blank" style="color:#2563eb; text-decoration:underline; font-size:11px; word-break:break-all;">${offer.link.substring(0, 50)}${offer.link.length > 50 ? '...' : ''}</a>` : 'Brak'}
										</td>
									</tr>
									`).join('')}
								</tbody>
							</table>
						</div>
						` : ''}
					</div>
					`).join('')}
					${(this.promotionalSections.filter(s => !s.isSponsored).length === 0 && this.promotionalSections.length > 0 && !this.promotionalSections.some(s => s.isSponsored && s.hasStrikethroughPrice)) ? `
					<div style="margin-top:16px; padding:12px; background:#fee2e2; border:2px solid #dc2626; border-radius:8px;">
					<div style="font-weight:700; color:#991b1b; margin-bottom:8px;">❌ KRYTYCZNE!</div>
					<div style="color:#7f1d1d; font-size:13px; line-height:1.6;">
						<strong>Twoje sekcje sponsorwane Allegro promują konkurencję.</strong><br>
						Skonfiguruj opcję rabatu na n-tą sztukę.
					</div>
				</div>
					` : ''}
					`}
				</div>

				<div class="section">
					<div class="section-title">📦 Zestawy produktowe</div>
					${!this.bundleSection || !this.bundleSection.exists ? `
					<div class="card" style="background:#fee2e2; border:2px solid #dc2626;">
						<div class="row">
							<div class="label" style="color:#991b1b; font-weight:700;">Status:</div>
							<div class="value" style="color:#dc2626; font-weight:700;">⚠️ BRAK</div>
						</div>
						<div style="margin-top:12px; padding:12px; background:#fef2f2; border-radius:6px; color:#7f1d1d; font-size:13px; line-height:1.6;">
							<strong>Brak sekcji zestawów!</strong><br>
							Warto tworzyć zestawy produktowe aby zwiększyć sprzedaż.
						</div>
					</div>
					` : `
					<div class="card" style="border:2px solid ${this.bundleSection.qualityColor}; background:${this.bundleSection.productCount === 2 ? '#fef3c7' : '#f0fdf4'};">
						<div class="row">
							<div class="label">Tytuł:</div>
							<div class="value">${escapeHtml(this.bundleSection.title)}</div>
						</div>
						<div class="row">
							<div class="label">Produktów w zestawie:</div>
							<div class="value" style="font-weight:700; color:${this.bundleSection.qualityColor};">${this.bundleSection.productCount}</div>
						</div>
						<div class="row">
							<div class="label">Ocena:</div>
							<div class="value" style="font-weight:700; color:${this.bundleSection.qualityColor};">${this.bundleSection.qualityRating}</div>
						</div>
						${this.bundleSection.qualityMessage ? `
						<div style="margin-top:12px; padding:12px; background:${this.bundleSection.productCount === 2 ? '#fffbeb' : '#ecfdf5'}; border-radius:6px; color:#374151; font-size:13px; line-height:1.6;">
							${escapeHtml(this.bundleSection.qualityMessage)}
						</div>
						` : ''}
					</div>
					`}
				</div>

				<div class="section">
					<div class="section-title">💡 Propozycje dla Ciebie</div>
					${!this.suggestionsSection || !this.suggestionsSection.exists ? `
					<div class="card" style="background:#fff7ed; border:1px solid #fdba74; border-radius:12px;">
						<div class="row">
							<div class="label" style="color:#9a3412; font-weight:600;">Status:</div>
							<div class="value" style="color:#ea580c; font-weight:600;">⚠️ BRAK</div>
						</div>
						<div style="margin-top:14px; padding:14px 16px; background:#ffedd5; border-radius:10px; color:#7c2d12; font-size:14px; line-height:1.55; letter-spacing:-0.01em;">
							<strong>Brak sekcji "Propozycje dla Ciebie"!</strong><br>
							${this.suggestionsSection?.recommendation || 'Sprawdź czy sekcja jest dostępna na stronie produktu.'}
						</div>
					</div>
					` : `
					<div class="card" style="border:1px solid ${this.suggestionsSection.qualityColor}; background:${this.suggestionsSection.hasBrandTab ? '#f0fdf4' : '#fff7ed'}; border-radius:12px;">
						<div class="row">
							<div class="label">Ma zakładkę z marką:</div>
							<div class="value" style="font-weight:600;">${this.suggestionsSection.hasBrandTab ? `✅ TAK${this.suggestionsSection.brandName ? ` (${escapeHtml(this.suggestionsSection.brandName)})` : ''}` : '❌ NIE'}</div>
						</div>

						<div class="row">
							<div class="label">Ocena:</div>
							<div class="value" style="font-weight:600; color:${this.suggestionsSection.qualityColor};">${this.suggestionsSection.qualityRating}</div>
						</div>
						${this.suggestionsSection.recommendation ? `
						<div style="margin-top:14px; padding:14px 16px; background:${this.suggestionsSection.hasBrandTab ? '#ecfdf5' : this.suggestionsQualityScore >= 50 ? '#ffedd5' : '#fee2e2'}; border-radius:10px; border-left:4px solid ${this.suggestionsSection.qualityColor}; color:#374151; font-size:14px; line-height:1.55; letter-spacing:-0.01em;">
							💡 <strong>Rekomendacja:</strong> ${escapeHtml(this.suggestionsSection.recommendation)}
						</div>
						` : ''}
					</div>
					`}
				</div>

				<div class="section">
					<div class="section-title">📝 Analiza opisu aukcji</div>
					<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
						<thead>
							<tr style="background:#f9fafb;">
								<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Parametr</th>
								<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:150px;">Wartość</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba znaków w opisie</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">
									${this.descriptionLength > 0 ? this.descriptionLength.toLocaleString('pl-PL') : 'Brak'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Czy zawiera obrazy</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
									${this.descriptionHasImages ? '✅ TAK' : '❌ NIE'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba obrazów w opisie</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">
									${this.descriptionImagesCount > 0 ? this.descriptionImagesCount : 'Brak'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Procent pogrubionego tekstu</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.descriptionBoldPercent >= 5 && this.descriptionBoldPercent <= 10 ? '#059669' :
					this.descriptionBoldPercent >= 3 && this.descriptionBoldPercent < 5 ? '#ca8a04' :
						this.descriptionBoldPercent > 10 && this.descriptionBoldPercent <= 15 ? '#ca8a04' :
							'#dc2626'
				};">
									${this.descriptionBoldPercent > 0 ? this.descriptionBoldPercent + '%' : 'Brak'}
									${this.descriptionBoldPercent >= 5 && this.descriptionBoldPercent <= 10 ? ' ✅' : this.descriptionBoldPercent >= 3 && this.descriptionBoldPercent <= 15 ? ' ⚠️' : ' ❌'}
								</td>
							</tr>
							<tr>
								<td colspan="2" style="padding:12px; border:1px solid #e5e7eb; background:#f9fafb; color:#6b7280; font-size:12px;">
									<strong>Rekomendacja:</strong> Optymalne: 5-10% pogrubionego tekstu. Wyróżnij najważniejsze informacje, ale nie przesadzaj.
								</td>
							</tr>
						</tbody>
					</table>
					
					${this.descriptionAiAnalysis ? `
					<div style="margin-top:24px; padding:16px; background:#f0f9ff; border-radius:8px; border:2px solid #3b82f6;">
						<div style="font-weight:700; font-size:16px; color:#1e40af; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
							🤖 Podsumowanie analizy opisu z AI
							<span style="font-size:11px; color:#6b7280; font-weight:400;">(tokeny: ${this.descriptionAiTokensUsed})</span>
						</div>
					${this.descriptionAiAnalysis && (this.descriptionAiAnalysis.includes('⚠️ Wystąpił błąd') || this.descriptionAiAnalysis.includes('❌ Błąd')) ? `
						<div style="background:#fee2e2; border:2px solid #dc2626; border-radius:6px; padding:16px;">
							<div style="font-weight:700; color:#991b1b; margin-bottom:8px; font-size:14px;">⚠️ Wystąpił błąd podczas analizy AI</div>
							<div style="color:#7f1d1d; font-size:13px; line-height:1.6; margin-bottom:12px;">
								W razie problemów skontaktuj się z nami:<br>
								<a href="mailto:damian@vautomate.pl" style="color:#dc2626; font-weight:600; text-decoration:underline;">damian@vautomate.pl</a>
							</div>
							<div style="border-top:1px solid #fca5a5; padding-top:12px; margin-top:12px;">
								<div style="font-weight:600; color:#991b1b; margin-bottom:6px; font-size:12px;">Szczegóły błędu:</div>
								<div style="color:#6b7280; font-size:12px; font-family:monospace; background:#fef2f2; padding:8px; border-radius:4px; white-space:pre-wrap;">
									${typeof this.descriptionAiAnalysis === 'string' ? escapeHtml(this.descriptionAiAnalysis.replace(/⚠️ Wystąpił błąd podczas analizy AI\.\n\nW razie problemów skontaktuj się z nami: damian@vautomate\.pl\n\n---\n\n❌ Szczegóły błędu:\n/, '').replace(/❌ Błąd połączenia: /, '')) : ''}
								</div>
							</div>
						</div>
					` : `
						<div style="color:#374151; line-height:1.8; white-space:pre-wrap; font-size:13px; padding-left:0; text-indent:0;">${escapeHtml(normalizeAiText(this.descriptionAiAnalysis))}</div>
					`}
					</div>
					` : ''}
					
					${this.parametersInDescription.length > 0 ? `
					<div style="margin-top:24px;">
						<div style="font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f8fafc; border-radius:6px;">
							📋 Parametry produktu w opisie (${this.parametersInDescriptionScore}% zgodności)
						</div>
						<div style="font-size:11px; color:#6b7280; margin-bottom:12px; padding:8px; background:#fef9c3; border-left:3px solid #ca8a04; border-radius:4px;">
							ℹ️ <strong>Uwaga:</strong> Parametry "Stan" i "Faktura" są pomijane w analizie, ponieważ według regulaminu Allegro sprzedawcy nie mogą umieszczać ich w opisie produktu.
						</div>
						<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
							<thead>
								<tr style="background:#f9fafb;">
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:20%;">Parametr</th>
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:20%;">Wartość</th>
									<th style="padding:10px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:80px;">W opisie</th>
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Fragment w opisie</th>
								</tr>
							</thead>
							<tbody>
								${this.parametersInDescription
						.filter(param => !['stan', 'faktura'].includes(param.name.toLowerCase()))
						.map((param, index) => `
									<tr style="${index % 2 === 0 ? 'background:#fafafa;' : ''}">
										<td style="padding:10px; border:1px solid #e5e7eb; font-weight:500; color:#374151;">
											${escapeHtml(param.name)}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; color:#6b7280;">
											${param.link ? `<a href="${escapeHtml(param.link)}" target="_blank" style="color:#2563eb; text-decoration:none;">${escapeHtml(param.value)}</a>` : escapeHtml(param.value)}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; text-align:center; font-size:16px; font-weight:700; color:${param.found ? '#059669' : '#dc2626'};">
											${param.found ? '✅' : '❌'}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; color:#6b7280; font-size:12px; font-style:italic;">
											${param.context !== '-' ? escapeHtml(param.context) : '<span style="color:#9ca3af;">-</span>'}
										</td>
									</tr>
								`).join('')}
							</tbody>
						</table>
						<div style="margin-top:12px; padding:14px; background:${this.parametersInDescriptionScore >= 76 ? '#ecfdf5' :
						this.parametersInDescriptionScore >= 60 ? '#fefce8' :
							this.parametersInDescriptionScore >= 50 ? '#fff7ed' :
								'#fee2e2'
					}; border-radius:8px; border:2px solid ${this.parametersInDescriptionScore >= 76 ? '#10b981' :
						this.parametersInDescriptionScore >= 60 ? '#eab308' :
							this.parametersInDescriptionScore >= 50 ? '#fb923c' :
								'#dc2626'
					}; font-size:14px;">
							<div style="font-weight:700; font-size:15px; color:${this.parametersInDescriptionScore >= 76 ? '#059669' :
						this.parametersInDescriptionScore >= 60 ? '#ca8a04' :
							this.parametersInDescriptionScore >= 50 ? '#ea580c' :
								'#dc2626'
					}; margin-bottom:8px;">
								💡 Zgodność: ${this.parametersInDescriptionScore}% parametrów znaleziono w opisie (z wyłączeniem Stan i Faktura)
							</div>
							<div style="color:#374151; line-height:1.5;">
								<strong>Rekomendacja:</strong> ${this.parametersInDescriptionScore >= 76
						? 'Świetnie! Opis zawiera większość parametrów produktu. Tak trzymaj!'
						: this.parametersInDescriptionScore >= 60
							? 'Dobrze, ale warto uzupełnić opis o brakujące parametry aby zwiększyć atrakcyjność oferty.'
							: this.parametersInDescriptionScore >= 50
								? 'Średnio - brakuje wielu parametrów w opisie. Uzupełnij opis o kluczowe informacje o produkcie.'
								: 'Pilnie uzupełnij opis! Większość parametrów nie jest wymieniona, co znacząco obniża jakość oferty i zaufanie klientów.'
					}
							</div>
						</div>
					</div>
					` : ''}
				</div>

				<div class="section">
					<div class="section-title">🖼️ Czy jest miniatura</div>
					<div class="card">
						<div class="row">
							<div class="label">Status:</div>
							<div class="value">${hasThumbnail ? '✅ TAK - Znaleziono miniatura' : '❌ NIE - Brak miniatury'}</div>
						</div>
						${hasThumbnail ? `
						<div style="margin-top: 16px; text-align: center;">
							<img src="${thumbnailData.src}" alt="${thumbnailData.alt || 'Miniatura produktu'}" style="max-width: 300px; max-height: 300px; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
						</div>
						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📊 Szczegóły obrazu</div>
							<div class="row">
								<div class="label">Format:</div>
								<div class="value">${thumbnailData.format || 'Nieznany'}</div>
							</div>
							<div class="row">
								<div class="label">Link do obrazu:</div>
								<div class="value">
									<a href="${thumbnailData.src}" target="_blank" style="color: #2563eb; text-decoration: underline; word-break: break-all; font-size: 11px;">
										${thumbnailData.src}
									</a>
								</div>
							</div>
							<div class="row">
								<div class="label">Rozdzielczość:</div>
								<div class="value">${thumbnailData.naturalWidth} × ${thumbnailData.naturalHeight} px</div>
							</div>
							<div class="row">
								<div class="label">Wyświetlane:</div>
								<div class="value">${thumbnailData.displayWidth} × ${thumbnailData.displayHeight} px</div>
							</div>
							<div class="row">
								<div class="label">Proporcje:</div>
								<div class="value">${thumbnailData.aspectRatio || 'Nieznane'}</div>
							</div>
							<div class="row">
								<div class="label">Szacowane DPI:</div>
								<div class="value">${thumbnailData.estimatedDpi || 'Nieznane'}</div>
							</div>
							<div class="row">
								<div class="label">Rozmiar pliku:</div>
								<div class="value">${thumbnailData.fileSize > 0 ? this.formatFileSize(thumbnailData.fileSize) : 'Nie można pobrać (CORS)'}</div>
							</div>
							<div class="row">
								<div class="label">Status ładowania:</div>
								<div class="value">${thumbnailData.loadingState || 'Nieznany'}</div>
							</div>
						</div>
						` : ''}
					</div>
				</div>

				${hasThumbnail && this.imageQuality && this.imageQuality.overallScore > 0 ? `
				<div class="section">
					<div class="section-title">🎨 Analiza jakości obrazu głównego</div>
					<div class="card">
						<div class="row">
							<div class="label">Ogólna ocena jakości:</div>
							<div class="value" style="color:${this.imageQuality.overallScore >= 80 ? '#059669' : this.imageQuality.overallScore >= 60 ? '#ca8a04' : '#dc2626'}; font-weight:700;">
								${this.imageQuality.overallScore}% ${this.imageQuality.overallScore >= 80 ? '🌟' : this.imageQuality.overallScore >= 60 ? '⚠️' : '❌'}
							</div>
						</div>

						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📐 Rozdzielczość</div>
							<div class="row">
								<div class="label">Status:</div>
								<div class="value" style="color:${this.imageQuality.resolution.status === 'optimal' ? '#059669' : this.imageQuality.resolution.status === 'good' || this.imageQuality.resolution.status === 'acceptable' ? '#ca8a04' : '#dc2626'};">
									${this.imageQuality.resolution.message}
								</div>
							</div>
							<div class="row">
								<div class="label">Ocena:</div>
								<div class="value">${this.imageQuality.resolution.score}/100</div>
							</div>
							<div style="color:#6b7280; font-size:12px; margin-top:8px; padding:8px; background:#f9fafb; border-radius:4px;">
								<strong>Wymagania:</strong> Optymalny: 2560×2560px | Dobry: 1200×1200px | Akceptowalny: 800×800px
							</div>
						</div>

						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">🖼️ Białe ramki</div>
							<div class="row">
								<div class="label">Status:</div>
								<div class="value" style="color:${this.imageQuality.whiteBorders.status === 'optimal' ? '#059669' : this.imageQuality.whiteBorders.status === 'acceptable' ? '#ca8a04' : '#dc2626'};">
									${this.imageQuality.whiteBorders.status === 'optimal' ? '✓ Prawidłowa ramka (~2–3%)' :
						this.imageQuality.whiteBorders.status === 'acceptable' ? '⚠️ Ramka poza idealnym zakresem' :
							this.imageQuality.whiteBorders.status === 'missing' ? '❌ Brak ramki (wymagana dla miniatury)' :
								'❌ Niechciana ramka'}
								</div>
							</div>
							<div class="row">
								<div class="label">Góra:</div>
								<div class="value">${this.imageQuality.whiteBorders.topPercent}%</div>
							</div>
							<div class="row">
								<div class="label">Dół:</div>
								<div class="value">${this.imageQuality.whiteBorders.bottomPercent}%</div>
							</div>
							<div class="row">
								<div class="label">Lewa:</div>
								<div class="value">${this.imageQuality.whiteBorders.leftPercent}%</div>
							</div>
							<div class="row">
								<div class="label">Prawa:</div>
								<div class="value">${this.imageQuality.whiteBorders.rightPercent}%</div>
							</div>
							<div class="row">
								<div class="label">Średnia:</div>
								<div class="value">${this.imageQuality.whiteBorders.totalPercent}%</div>
							</div>
							<div style="color:#6b7280; font-size:12px; margin-top:8px; padding:8px; background:#f9fafb; border-radius:4px;">
								<strong>Wymagania:</strong> Miniatura: ramka uznana za prawidłową tylko gdy <strong>z każdej strony</strong> (góra, dół, lewa, prawa) jest ponad 2%. Jeśli nawet jedna strona ma ≤2%, uznajemy brak ramki.
							</div>
						</div>

						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">🎯 DPI / Jakość</div>
							<div class="row">
								<div class="label">Szacowane DPI:</div>
								<div class="value">${this.imageQuality.dpi.estimated} DPI</div>
							</div>
							<div class="row">
								<div class="label">Jakość:</div>
								<div class="value" style="color:${this.imageQuality.dpi.quality === 'high' ? '#059669' : this.imageQuality.dpi.quality === 'medium' ? '#ca8a04' : '#dc2626'};">
									${this.imageQuality.dpi.message}
								</div>
							</div>
						</div>

						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">⚪ Białe tło</div>
							<div class="row">
								<div class="label">Procent białych pikseli:</div>
								<div class="value" style="color:${this.imageQuality.backgroundWhiteness >= 60 ? '#059669' : this.imageQuality.backgroundWhiteness >= 40 ? '#ca8a04' : '#dc2626'};">
									${this.imageQuality.backgroundWhiteness}%
								</div>
							</div>
							<div style="color:#6b7280; font-size:12px; margin-top:8px; padding:8px; background:#f9fafb; border-radius:4px;">
								<strong>Rekomendacja:</strong> Ramka wokół miniatury (5% z każdej strony) powinna być biała. Celuj w ≥60% białych pikseli w obszarze ramki.
							</div>
						</div>

						${this.imageQuality.complexity && this.imageQuality.complexity.status !== 'unknown' ? `
						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">🌈 Złożoność miniatury</div>
							<div class="row">
								<div class="label">Wynik:</div>
								<div class="value" style="color:${this.imageQuality.complexity.status === 'high' ? '#059669' : this.imageQuality.complexity.status === 'medium' ? '#ca8a04' : '#dc2626'};">
									${this.imageQuality.complexity.message}
								</div>
							</div>
							<div class="row">
								<div class="label">Unikalne kolory:</div>
								<div class="value">${this.imageQuality.complexity.uniqueColors}</div>
							</div>
							<div style="color:#6b7280; font-size:12px; margin-top:8px; padding:8px; background:#f9fafb; border-radius:4px;">
								<strong>Rekomendacja:</strong> Miniatura powinna być dobrze rozbudowana i pokazywać produkt w szczegółach.
							</div>
						</div>
						` : ''}

						${this.imageQuality.textDetected && this.imageQuality.textDetected.status !== 'unknown' ? `
						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">🔤 Detekcja tekstu (OCR)</div>
							<div class="row">
								<div class="label">Status:</div>
								<div class="value" style="color:${!this.imageQuality.textDetected.hasText ? '#059669' : '#dc2626'};">
									${this.imageQuality.textDetected.message}
								</div>
							</div>
							${this.aiImageAnalysis && this.aiImageAnalysis.regulaminCompliance && this.aiImageAnalysis.regulaminCompliance.promotionalText && this.aiImageAnalysis.regulaminCompliance.promotionalText.detected && !this.imageQuality.textDetected.hasText ? `
							<div style="margin-top:8px; padding:8px; background:#fff7ed; border-left:3px solid #f59e0b; border-radius:4px; font-size:12px; color:#92400e;">
								<strong>ℹ️ Analiza AI wykryła tekst na obrazie</strong> (patrz sekcja „Zgodność z regulaminem” → Tekst promocyjny). OCR (Tesseract) nie rozpoznał tekstu – możliwe że czcionka lub kontrast utrudniają odczyt.
							</div>
							` : ''}
							${this.imageQuality.textDetected.hasText ? `
								<div class="row">
									<div class="label">Pewność:</div>
									<div class="value">${this.imageQuality.textDetected.confidence}%</div>
								</div>
								<div style="margin-top:8px; padding:8px; background:#fef2f2; border-left:3px solid #dc2626; border-radius:4px;">
									<strong style="color:#dc2626;">⚠️ Wykryto tekst na obrazie!</strong><br>
									<div style="font-size:11px; color:#6b7280; margin-top:4px; max-height:100px; overflow:auto;">
										${escapeHtml(this.imageQuality.textDetected.text.substring(0, 300))}...
									</div>
								</div>
							` : ''}
							<div style="color:#6b7280; font-size:12px; margin-top:8px; padding:8px; background:#f9fafb; border-radius:4px;">
								<strong>Rekomendacja:</strong> Unikaj dodawania tekstu bezpośrednio na obrazach produktów.
							</div>
						</div>
						` : ''}

						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📊 Rozmiar obrazu</div>
							<div class="row">
								<div class="label">Megapiksele:</div>
								<div class="value">${this.imageQuality.excessiveSize.megapixels} MP</div>
							</div>
							<div class="row">
								<div class="label">Status:</div>
								<div class="value" style="color:${!this.imageQuality.excessiveSize.isExcessive ? '#059669' : '#ca8a04'};">
									${this.imageQuality.excessiveSize.message}
								</div>
							</div>
						</div>

						${this.imageQuality.errors && this.imageQuality.errors.length > 0 ? `
						<div style="margin-top: 16px; padding: 12px; background: #fef2f2; border-left: 3px solid #dc2626; border-radius: 6px;">
							<strong style="color: #dc2626;">⚠️ Błędy podczas analizy:</strong>
							<ul style="margin: 8px 0 0 20px; color: #6b7280; font-size: 12px;">
								${this.imageQuality.errors.map(err => `<li>${escapeHtml(err)}</li>`).join('')}
							</ul>
						</div>
						` : ''}

						${this.aiImageAnalysis && this.aiImageAnalysis.overallAIScore > 0 ? `
						<div style="margin-top: 24px; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">
							<div style="font-weight: 700; font-size: 16px; margin-bottom: 12px;">🤖 Analiza AI miniaturki (OpenAI Vision)</div>
							<div style="background: rgba(255,255,255,0.95); color: #1f2937; padding: 16px; border-radius: 8px;">
								<div class="row" style="margin-bottom: 12px;">
									<div class="label" style="font-weight: 600; color: #374151;">Ogólna ocena AI:</div>
									<div class="value" style="color:${this.aiImageAnalysis.overallAIScore >= 80 ? '#059669' : this.aiImageAnalysis.overallAIScore >= 60 ? '#ca8a04' : '#dc2626'}; font-weight:700; font-size: 18px;">
										${this.aiImageAnalysis.overallAIScore}% ${this.aiImageAnalysis.overallAIScore >= 80 ? '🌟' : this.aiImageAnalysis.overallAIScore >= 60 ? '⚠️' : '❌'}
									</div>
								</div>
							${this.aiImageAnalysis.summary ? `
								${this.aiImageAnalysis.summary.includes('⚠️ Wystąpił błąd') || this.aiImageAnalysis.summary.includes('❌ Błąd') ? `
									<div style="background:#fee2e2; border:2px solid #dc2626; border-radius:6px; padding:16px; margin-bottom:16px;">
										<div style="font-weight:700; color:#991b1b; margin-bottom:8px; font-size:14px;">⚠️ Wystąpił błąd podczas analizy AI</div>
										<div style="color:#7f1d1d; font-size:13px; line-height:1.6; margin-bottom:12px;">
											W razie problemów skontaktuj się z nami:<br>
											<a href="mailto:damian@vautomate.pl" style="color:#dc2626; font-weight:600; text-decoration:underline;">damian@vautomate.pl</a>
										</div>
										<div style="border-top:1px solid #fca5a5; padding-top:12px; margin-top:12px;">
											<div style="font-weight:600; color:#991b1b; margin-bottom:6px; font-size:12px;">Szczegóły błędu:</div>
											<div style="color:#6b7280; font-size:12px; font-family:monospace; background:#fef2f2; padding:8px; border-radius:4px; white-space:pre-wrap;">
												${typeof this.aiImageAnalysis.summary === 'string' ? escapeHtml(this.aiImageAnalysis.summary.replace(/⚠️ Wystąpił błąd podczas analizy AI\.\n\nW razie problemów skontaktuj się z nami: damian@vautomate\.pl\n\n---\n\n❌ Szczegóły błędu:\n/, '').replace(/❌ Błąd połączenia: /, '')) : ''}
											</div>
										</div>
									</div>
								` : `
									<div style="padding: 12px; background: #f8fafc; border-radius: 6px; margin-bottom: 16px; font-size: 14px; color: #475569; line-height: 1.6;">
										<strong>Podsumowanie:</strong> ${escapeHtml(normalizeAiText(this.aiImageAnalysis.summary))}
									</div>
								`}
							` : ''}

								<!-- Zgodność z regulaminem -->
								<div style="margin-top: 16px;">
									<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #dc2626;">📋 Zgodność z regulaminem</div>

									${Object.entries(this.aiImageAnalysis.regulaminCompliance).map(([key, value]) => {
									const labels = {
										watermarks: '💧 Znaki wodne / watermarki',
										promotionalText: '🏷️ Tekst promocyjny',
										logos: '🏢 Cudze logotypy',
										extraElements: '➕ Dodatkowe elementy',
										colorVariants: '🎨 Warianty kolorystyczne',
										inappropriateContent: '⚠️ Niestosowne treści'
									};
									return `
										<div style="padding: 10px; margin-bottom: 8px; background: ${value.detected ? '#fef2f2' : '#f0fdf4'}; border-left: 3px solid ${value.detected ? '#dc2626' : '#059669'}; border-radius: 4px;">
											<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
												<span style="font-weight: 600; font-size: 13px; color: #374151;">${labels[key] || key}</span>
												<span style="font-weight: 700; color: ${value.detected ? '#dc2626' : '#059669'}; font-size: 14px;">
													${value.detected ? '❌ WYKRYTO' : '✓ OK'}
												</span>
											</div>
											<div style="font-size: 12px; color: #6b7280;">
												${escapeHtml(value.details || 'Brak szczegółów')}
											</div>
										</div>
										`;
								}).join('')}
								</div>

								<!-- Jakość wizualna -->
								<div style="margin-top: 16px;">
									<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #059669;">✨ Jakość wizualna</div>
									${this.aiImageAnalysis.visualQuality.sharpness.score === 0 && this.aiImageAnalysis.visualQuality.background.score === 0 && this.aiImageAnalysis.overallAIScore > 0 ? `
									<div style="padding: 10px; margin-bottom: 8px; background: #fff7ed; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 12px; color: #92400e;">
										AI nie zwróciło ocen ostrości ani tła. Upewnij się, że na serwerze jest najnowsza wersja <strong>api.php</strong> (wymagany format: visualQuality.sharpness i visualQuality.background z polem score i assessment).
									</div>
									` : ''}
									<!-- Ostrość -->
									<div style="padding: 10px; margin-bottom: 8px; background: #f9fafb; border-left: 3px solid ${this.aiImageAnalysis.visualQuality.sharpness.score >= 80 ? '#059669' : this.aiImageAnalysis.visualQuality.sharpness.score >= 60 ? '#ca8a04' : '#dc2626'}; border-radius: 4px;">
										<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
											<span style="font-weight: 600; font-size: 13px; color: #374151;">🔍 Ostrość zdjęcia</span>
											<span style="font-weight: 700; color: ${this.aiImageAnalysis.visualQuality.sharpness.score >= 80 ? '#059669' : this.aiImageAnalysis.visualQuality.sharpness.score >= 60 ? '#ca8a04' : '#dc2626'}; font-size: 14px;">
												${this.aiImageAnalysis.visualQuality.sharpness.score}/100
											</span>
										</div>
										<div style="font-size: 12px; color: #6b7280;">
											${escapeHtml(this.aiImageAnalysis.visualQuality.sharpness.assessment || 'Brak oceny')}
										</div>
									</div>

									<!-- Tło -->
									<div style="padding: 10px; margin-bottom: 8px; background: #f9fafb; border-left: 3px solid ${this.aiImageAnalysis.visualQuality.background.score >= 80 ? '#059669' : this.aiImageAnalysis.visualQuality.background.score >= 60 ? '#ca8a04' : '#dc2626'}; border-radius: 4px;">
										<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
											<span style="font-weight: 600; font-size: 13px; color: #374151;">🖼️ Profesjonalność tła</span>
											<span style="font-weight: 700; color: ${this.aiImageAnalysis.visualQuality.background.score >= 80 ? '#059669' : this.aiImageAnalysis.visualQuality.background.score >= 60 ? '#ca8a04' : '#dc2626'}; font-size: 14px;">
												${this.aiImageAnalysis.visualQuality.background.score}/100
											</span>
										</div>
										<div style="font-size: 12px; color: #6b7280;">
											${escapeHtml(this.aiImageAnalysis.visualQuality.background.assessment || 'Brak oceny')}
										</div>
									</div>
								</div>
						</div>
					</div>
					` : `
					<div style="margin-top: 24px; padding: 16px; background: #fee2e2; border-radius: 12px; border: 2px solid #dc2626;">
						<div style="font-weight: 700; font-size: 16px; margin-bottom: 12px; color: #991b1b;">⚠️ Analiza AI miniaturki niedostępna</div>
						<div style="color: #7f1d1d; font-size: 14px; line-height: 1.6;">
							<p style="margin: 0 0 12px 0;">Wystąpił błąd podczas analizy obrazu przez OpenAI Vision API.</p>
							<p style="margin: 0 0 12px 0;">Raport został wygenerowany bez analizy AI miniaturki.</p>
							<div style="padding: 12px; background: #fef2f2; border-radius: 6px; margin-top: 12px;">
								<strong>💡 Co możesz zrobić:</strong>
								<ul style="margin: 8px 0 0 20px; padding: 0;">
									<li>Sprawdź czy miniatura produktu jest dostępna</li>
									<li>Spróbuj ponownie za chwilę</li>
									<li>Skontaktuj się z nami: <a href="mailto:damian@vautomate.pl" style="color: #dc2626; text-decoration: underline;">damian@vautomate.pl</a></li>
								</ul>
							</div>
						</div>
					</div>
					`}

					${this.aiImageAnalysis && this.aiImageAnalysis.aiErrors && this.aiImageAnalysis.aiErrors.length > 0 ? `
							<div style="margin-top: 8px; padding: 10px; background: #fee2e2; border-radius: 4px; border: 1px solid #fca5a5;">
								<div style="font-size: 12px; color: #991b1b; font-weight: 600; margin-bottom: 4px;">📧 Potrzebujesz pomocy?</div>
								<div style="font-size: 11px; color: #7f1d1d; line-height: 1.5; margin-bottom: 8px;">
									W razie problemów skontaktuj się z nami:<br>
									<a href="mailto:damian@vautomate.pl" style="color: #dc2626; font-weight: 600; text-decoration: underline;">damian@vautomate.pl</a><br>
									<span style="font-size: 10px; color: #991b1b; font-style: italic;">⚡ Prześlij nam kod błędu poniżej - to ważne aby szybko zareagować!</span>
								</div>
							</div>
							<div style="margin-top: 8px; padding: 8px; background: #fef2f2; border-radius: 4px; border: 1px solid #fecaca;">
								<div style="font-size: 11px; color: #991b1b; font-weight: 600; margin-bottom: 4px;">🔴 Kod błędu:</div>
							<ul style="margin: 8px 0 0 20px; color: #6b7280; font-size: 12px;">
								${this.aiImageAnalysis.aiErrors.map(err => `<li style="margin-bottom: 4px;">${escapeHtml(err)}</li>`).join('')}
							</ul>
						</div>
						` : ''}
					</div>
				</div>
			` : ''}

			<!-- SEKCJA TYMCZASOWO WYŁĄCZONA - UNIKALNE OBRAZY NA STRONIE
			<div class="section">
				<div class="section-title">📷 Unikalne obrazy na stronie (≥100×100px)</div>
				<div class="card">
					<div class="row">
						<div class="label">Liczba znalezionych obrazów:</div>
						<div class="value">${allImages.length}</div>
					</div>
					${allImages.length > 0 ? `
					<div class="row">
						<div class="label">Obrazy z Allegro:</div>
						<div class="value">${allImages.filter(img => img.isAllegro).length}</div>
					</div>
					<div class="row">
						<div class="label">Ikony/małe obrazy:</div>
						<div class="value">${allImages.filter(img => img.isIcon).length}</div>
					</div>
					<div class="row">
						<div class="label">Widoczne obrazy:</div>
						<div class="value">${allImages.filter(img => img.isVisible).length}</div>
					</div>
					` : ''}
				</div>
				
				${allImages.length > 0 ? `
				<div style="margin-top: 16px;">
					<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📋 Lista wszystkich obrazów</div>
					<div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
						${allImages.map((img, index) => `
							<div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: ${img.isAllegro ? '#f0f9ff' : '#ffffff'}; display: flex; gap: 12px;">
								<div style="flex-shrink: 0; width: 80px; height: 80px; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; background: #f9fafb; display: flex; align-items: center; justify-content: center;">
									<img src="${this.sanitizeUrl(img.src)}" 
										 alt="${escapeHtml(img.alt)}" 
										 style="max-width: 100%; max-height: 100%; object-fit: contain;"
										 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
									/>
									<div style="display: none; font-size: 10px; color: #6b7280; text-align: center; padding: 4px;">❌<br>Błąd ładowania</div>
								</div>
								<div style="flex: 1; min-width: 0;">
									<div style="font-weight: 600; margin-bottom: 4px; color: #374151;">
										${img.index}. ${img.isAllegro ? '🎯 Allegro' : img.isIcon ? '🔸 Ikona' : '📷 Obraz'} - ${escapeHtml(img.alt)}
									</div>
									<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">
										Pozycja na stronie: ${img.domIndex}
									</div>
									<div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">
										<strong>Rozmiar:</strong> ${img.width}×${img.height}px 
										${img.displayWidth !== img.width || img.displayHeight !== img.height ?
										`(wyświetlany: ${img.displayWidth}×${img.displayHeight}px)` : ''}
									</div>
									<div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">
										<strong>Domena:</strong> ${escapeHtml(img.domain)} | 
										<strong>Widoczny:</strong> ${img.isVisible ? '✅ TAK' : '❌ NIE'}
									</div>
									<div style="font-size: 11px; word-break: break-all;">
										<strong>URL:</strong> 
										<a href="${this.sanitizeUrl(img.src)}" target="_blank" style="color: #2563eb; text-decoration: underline;">
											${escapeHtml(this.sanitizeUrl(img.src))}
										</a>
									</div>
								</div>
							</div>
						`).join('')}
					</div>
				</div>
				` : '<div style="color: #6b7280; font-style: italic; text-align: center; padding: 16px;">Nie znaleziono żadnych obrazów na stronie</div>'}
			</div>
			KONIEC SEKCJI TYMCZASOWO WYŁĄCZONEJ -->

			<div class="footer">
					Wygenerowano przez Allegro Skan Ofert v${typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '3.6.0'}<br>
					Zapis PDF: użyj funkcji drukowania przeglądarki (Ctrl+P)
				</div>
				
				<div class="no-print" style="margin-top: 24px; text-align: center;">
					<button onclick="setFileNameAndPrint()" style="padding:12px 24px; background:#2563eb; color:white; border:none; border-radius:8px; font-weight:600; cursor:pointer;">
						🖨️ Drukuj / Zapisz jako PDF
					</button>
				</div>
				
				<!-- Bez inline script – CSP Allegro blokuje; tytuł i print() wywołuje rodzic po załadowaniu iframe -->
				<style>
					@media print {
						* {
							-webkit-print-color-adjust: exact !important;
							print-color-adjust: exact !important;
							-webkit-user-select: text !important;
							user-select: text !important;
						}
						body {
							font-family: Arial, Helvetica, sans-serif !important; /* Użyj podstawowych czcionek */
							-webkit-font-smoothing: none !important;
							text-rendering: optimizeLegibility !important;
						}
						/* Wymuś renderowanie jako tekst, nie jako obraz */
						* {
							image-rendering: auto !important;
							-webkit-print-color-adjust: economy !important;
						}
					}
				</style>
			</body>
			</html>`;

			const iframeId = 'wt-skan-print-iframe';
			const existing = document.getElementById(iframeId);
			if (existing) existing.remove();

			const iframe = document.createElement('iframe');
			iframe.id = iframeId;
			iframe.style.position = 'fixed';
			iframe.style.right = '0';
			iframe.style.bottom = '0';
			iframe.style.width = '0';
			iframe.style.height = '0';
			iframe.style.border = '0';
			iframe.setAttribute('sandbox', 'allow-same-origin allow-modals allow-scripts allow-popups');
			iframe.srcdoc = html;

			const cleanup = () => {
				try { iframe.remove(); } catch (e) { }
				window.removeEventListener('afterprint', cleanup);
			};

			iframe.addEventListener('load', () => {
				try {
					const w = iframe.contentWindow;
					if (!w) throw new Error('no contentWindow');

					// Dodaj listener dla wiadomości o nazwie pliku
					window.addEventListener('message', (event) => {
						if (event.data.type === 'setFileName') {
							console.log('📝 Otrzymano nazwę pliku:', event.data.fileName);
							// Możemy tu dodać dodatkową logikę jeśli potrzeba
						}
					});

					w.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
					window.addEventListener('afterprint', cleanup, { once: true });
					setTimeout(() => {
						try {
							try { w.document.title = fileName; } catch (_) {}
							w.focus();
							w.print();
						} catch (e) {
							try {
								const nw = window.open('', '_blank');
								nw.document.write(html);
								nw.document.close();
								setTimeout(() => {
									try { nw.focus(); nw.print(); nw.close(); } catch (e2) {}
								}, 50);
							} catch (e3) {
								this.generatePrintInPlace(title, url, quality, productName, offerName, matchStatus, suggestion, this.formatDateTime(now), rating, ratingCount, reviewCount, hasThumbnail, thumbnailData, nameAnalysis, allImages, hasAllegroSmart, hasBestPriceGuarantee, hasAllegroPay, productParameters, parametersCount, hasBrand, brandName, brandLink);
							}
							cleanup();
						}
					}, 50);
				} catch (err) {
					try {
						const nw = window.open('', '_blank');
						nw.document.write(html);
						nw.document.close();
						setTimeout(() => { try { nw.focus(); nw.print(); nw.close(); } catch (e2) {} }, 50);
					} catch (e3) {
						this.generatePrintInPlace(title, url, quality, productName, offerName, matchStatus, suggestion, this.formatDateTime(now), rating, ratingCount, reviewCount, hasThumbnail, thumbnailData, nameAnalysis, allImages, hasAllegroSmart, hasBestPriceGuarantee, hasAllegroPay, productParameters, parametersCount, hasBrand, brandName, brandLink);
					}
					cleanup();
				}
			});

			document.body.appendChild(iframe);
		}

		generatePrintInPlace(title, url, quality, productName, offerName, matchStatus, suggestion, whenStr, rating, ratingCount, reviewCount, hasThumbnail, thumbnailData, nameAnalysis, allImages, hasAllegroSmart, hasBestPriceGuarantee, hasAllegroPay, productParameters, parametersCount, hasBrand, brandName, brandLink) {
			console.log('📄 === GENEROWANIE RAPORTU PDF (FALLBACK) ===');
			console.log(`📊 Zebrane dane do raportu:`);
			console.log(`   - Kontroferty: ${this.competitorOffers.length} ofert`);
			console.log(`   - Parametry w opisie: ${this.parametersInDescription.length} parametrów (${this.parametersInDescriptionScore}% zgodności)`);
			console.log(`   - Analiza AI: ${this.descriptionAiAnalysis ? 'TAK (' + this.descriptionAiTokensUsed + ' tokenów)' : 'NIE'}`);
			console.log(`   - Opis - znaków: ${this.descriptionLength}, obrazów: ${this.descriptionImagesCount}, pogrubień: ${this.descriptionBoldPercent}%`);

			// Generuj nazwę pliku
			const fileName = this.generateFileName(offerName);
			// Fallback – obszar do druku w tej samej karcie
			const containerId = 'wt-skan-print-area';
			const styleId = 'wt-skan-print-style';
			const prevArea = document.getElementById(containerId);
			if (prevArea) prevArea.remove();
			const prevStyle = document.getElementById(styleId);
			if (prevStyle) prevStyle.remove();

			const style = document.createElement('style');
			style.id = styleId;
			style.textContent = [
				'@media print {',
				'  body * { visibility: hidden !important; }',
				`  #${containerId}, #${containerId} * { visibility: visible !important; }`,
				`  #${containerId} { position: absolute; left: 0; top: 0; width: 100%; }`,
				'  #${containerId} * {',
				'    -webkit-print-color-adjust: exact !important;',
				'    print-color-adjust: exact !important;',
				'    -webkit-user-select: text !important;',
				'    user-select: text !important;',
				'  }',
				'}'
			].join('\n');

			const area = document.createElement('div');
			area.id = containerId;
			area.style.background = '#fff';
			area.style.color = '#111827';
			area.style.padding = '32px';
			area.style.fontFamily = 'Segoe UI, Tahoma, Arial, sans-serif';
			area.innerHTML = `
				<head>
					<meta name="filename" content="${fileName}" />
				</head>
				<h1 style="font-size:24px; margin:0 0 8px;">${escapeHtml(title)}</h1>
				<div style="margin-bottom:24px; border-bottom: 2px solid #ff5a00; padding-bottom: 16px;">
					<div><strong>Strona:</strong> ${escapeHtml(document.title)}</div>
				</div>
				
				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						📊 Statystyki strony
					</div>
					<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Jakość oferty:</div>
							<div style="font-weight:700;">${quality}%</div>
						</div>
						<div style="display:flex; justify-content:space-between; padding:8px 0;">
							<div style="color:#6b7280;">Data skanowania:</div>
							<div style="font-weight:700;">${escapeHtml(whenStr)}</div>
						</div>
					</div>
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						👤 Informacje o sprzedawcy
					</div>
					<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Nazwa sprzedawcy:</div>
							<div style="font-weight:700;">${escapeHtml(this.sellerName)}</div>
						</div>
						<div style="display:flex; justify-content:space-between; padding:8px 0;">
							<div style="color:#6b7280;">Procent rekomendacji:</div>
							<div style="font-weight:700; color:${this.sellerRecommendationPercent >= 95 ? '#059669' : this.sellerRecommendationPercent >= 80 ? '#ca8a04' : '#dc2626'};">
								${this.sellerRecommendationPercent > 0 ? (this.sellerRecommendationPercent % 1 === 0 ? this.sellerRecommendationPercent : this.sellerRecommendationPercent.toFixed(1)) + '%' : '0%'}
								${this.sellerRecommendationPercent >= 95 ? '🌟' : this.sellerRecommendationPercent >= 80 ? '⚠️' : '❌'}
							</div>
						</div>
					</div>
					
					${this.sellerCompanyName || this.sellerCategoryLink || this.sellerAllItemsLink || this.sellerAboutLink || this.sellerAskQuestionLink ? `
					<div style="margin-top:16px; padding:16px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb;">
						<div style="font-weight:600; color:#374151; margin-bottom:16px; font-size:15px;">📋 Szczegóły sprzedawcy</div>
						
						${this.sellerCompanyName ? `
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Nazwa firmy:</div>
							<div style="font-weight:600;">
								${escapeHtml(this.sellerCompanyName)}
								${!this.sellerCompanyNameMatch ? '<span style="color:#dc2626; font-weight:700; margin-left:8px;">⚠️ NIEZGODNOŚĆ</span>' : '<span style="color:#059669; margin-left:8px;">✅</span>'}
							</div>
						</div>
						` : ''}
						
						${this.sellerCategoryLink ? `
						<div style="margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280; margin-bottom:4px;">Przedmioty sprzedawcy w kategorii:</div>
							<div style="font-weight:600;">
								<a href="${escapeHtml(this.sellerCategoryLink)}" target="_blank" style="color:#2563eb; text-decoration:none;">
									${escapeHtml(this.sellerCategoryName || 'Zobacz przedmioty z kategorii')} →
								</a>
							</div>
						</div>
						` : ''}
						
						${this.sellerAllItemsLink ? `
						<div style="margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280; margin-bottom:4px;">Wszystkie przedmioty:</div>
							<div style="font-weight:600;">
								<a href="${escapeHtml(this.sellerAllItemsLink)}" target="_blank" style="color:#2563eb; text-decoration:none;">
									Zobacz wszystkie przedmioty sprzedającego →
								</a>
							</div>
						</div>
						` : ''}
						
						<div style="margin-top:16px; padding-top:16px; border-top:2px solid #e5e7eb; display:flex; gap:24px; flex-wrap:wrap;">
							${this.sellerAboutLink ? `
							<div>
								<a href="${escapeHtml(this.sellerAboutLink)}" target="_blank" style="color:#2563eb; text-decoration:none; font-size:14px; font-weight:600;">
									📄 O sprzedającym
								</a>
							</div>
							` : ''}
							${this.sellerAskQuestionLink ? `
							<div>
								<a href="${escapeHtml(this.sellerAskQuestionLink)}" target="_blank" style="color:#2563eb; text-decoration:none; font-size:14px; font-weight:600;">
									💬 Zadaj pytanie
								</a>
							</div>
							` : ''}
						</div>
					</div>
					` : ''}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						🔍 Zgodność nazw produktu i oferty
					</div>
					<div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
						<div style="border:1px solid #e5e7eb; border-radius:8px; padding:12px; background:#f9fafb;">
							<div style="font-size:12px; color:#6b7280; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Nazwa Produktu</div>
							<div style="font-weight:600; color:#111827;">${escapeHtml(productName)}</div>
						</div>
						<div style="border:1px solid #e5e7eb; border-radius:8px; padding:12px; background:#f9fafb;">
							<div style="font-size:12px; color:#6b7280; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Nazwa Oferty</div>
							<div style="font-weight:600; color:#111827;">${escapeHtml(offerName)}</div>
						</div>
					</div>
					<div style="margin-top:16px; padding:12px; border-radius:8px; border:1px solid ${matchStatus === 'match' ? '#86efac' : matchStatus === 'mismatch' ? '#fca5a5' : '#e5e7eb'}; background:${matchStatus === 'match' ? '#f0fdf4' : matchStatus === 'mismatch' ? '#fef2f2' : '#f9fafb'};">
						<div style="font-size:14px; color:#6b7280; margin-bottom:8px;">Wynik analizy zgodności:</div>
						<div style="font-size:16px; font-weight:600; color:#111827; margin-bottom:8px;">
							${matchStatus === 'match' ? '✅ Nazwy są zgodne' :
					matchStatus === 'mismatch' ? '❌ Nazwy nie są zgodne' :
						'❓ Nie można określić zgodności'}
						</div>
						${suggestion ? `<div style="font-size:14px; color:#dc2626; padding:8px; background:#fef2f2; border-radius:6px; border-left:3px solid #dc2626; margin-top:8px;"><strong>💡 Sugestia:</strong> ${escapeHtml(suggestion)}</div>` : ''}
					</div>
				</div>

				${this.competitorOffers.length > 0 ? `
				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						🏪 Analiza kontrofert (${this.competitorOffersCount} ofert)
					</div>
					<div style="margin-bottom:16px; padding:12px; background:#fff7ed; border-radius:8px; border:1px solid #fb923c;">
						<div style="font-weight:600; color:#374151; margin-bottom:8px;">
							💡 Analiza pierwszych ${this.competitorOffers.length} kontrofert
						</div>
						${this.lowestCompetitorPrice !== null ? `
						<div style="color:#6b7280; font-size:13px;">
							<strong>Najniższa cena konkurencji:</strong> ${this.lowestCompetitorPrice.toFixed(2)} zł<br>
							<strong>Średnia cena konkurencji:</strong> ${this.averageCompetitorPrice.toFixed(2)} zł
						</div>
						` : ''}
					</div>
					
					<table style="width:100%; border-collapse:collapse; font-size:12px;">
						<thead>
							<tr style="background:#f9fafb;">
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:5%;">#</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:15%;">Sprzedawca</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:right; width:10%;">Cena</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:right; width:12%;">Z dostawą</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left; width:12%;">Dostawa</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:center; width:8%;">Rekomendacja</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:center; width:8%;">Smart</th>
								<th style="padding:8px; border:1px solid #e5e7eb; text-align:left;">Szczegóły</th>
							</tr>
						</thead>
						<tbody>
							${this.competitorOffers.map((offer, idx) => `
								<tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''}">
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${offer.position}</td>
									<td style="padding:8px; border:1px solid #e5e7eb;">
										<div style="font-weight:600; color:#374151;">${escapeHtml(offer.seller)}</div>
										${offer.isSuperSeller ? '<div style="color:#059669; font-size:11px;">⭐ Super Sprzedawca</div>' : ''}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:right; font-weight:700;">
										${offer.price ? offer.price.toFixed(2) + ' zł' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:right; font-weight:600;">
										${offer.priceWithDelivery ? offer.priceWithDelivery.toFixed(2) + ' zł' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; color:#6b7280;">
										${escapeHtml(offer.deliveryTime) || '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${offer.sellerRecommendation >= 95 ? '#059669' : offer.sellerRecommendation >= 80 ? '#ca8a04' : '#dc2626'};">
										${offer.sellerRecommendation > 0 ? offer.sellerRecommendation + '%' : '-'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; text-align:center; font-size:16px;">
										${offer.hasSmart ? '✅' : '❌'}
									</td>
									<td style="padding:8px; border:1px solid #e5e7eb; font-size:11px; color:#6b7280;">
										${offer.condition ? 'Stan: ' + escapeHtml(offer.condition) : ''}
										${offer.condition && offer.warranty ? '<br>' : ''}
										${offer.warranty ? 'Gwarancja: ' + escapeHtml(offer.warranty) : ''}
										${offer.hasPay ? '<br>💳 Allegro Pay' : ''}
									</td>
								</tr>
							`).join('')}
						</tbody>
					</table>
				</div>
				` : ''}

			<div style="margin-bottom:24px;">
				<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
					⭐ Ocena produktu
				</div>
				<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
					<thead>
						<tr style="background:#f9fafb;">
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Metryka</th>
							<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:100px;">Wynik</th>
							<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:120px;">Status</th>
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Rekomendacja Systemu</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba ocen</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${ratingCount > 0 ? ratingCount : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.ratingCountEvaluation.color};">${this.ratingCountEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.ratingCountEvaluation.color};">${this.ratingCountEvaluation.recommendation}</td>
						</tr>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba recenzji</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${reviewCount > 0 ? reviewCount : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.reviewCountEvaluation.color};">${this.reviewCountEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.reviewCountEvaluation.color};">${this.reviewCountEvaluation.recommendation}</td>
						</tr>
						<tr>
							<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Średnia ocen</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">${rating > 0 ? rating.toFixed(2) : 'Brak'}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.ratingValueEvaluation.color};">${this.ratingValueEvaluation.rating}</td>
							<td style="padding:12px; border:1px solid #e5e7eb; color:${this.ratingValueEvaluation.color};">${this.ratingValueEvaluation.recommendation}</td>
						</tr>
					</tbody>
				</table>

				<!-- WSKAZÓWKI EKSPERCKIE -->
				<div style="margin-top:16px; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;">

					<!-- Infoboks: Zmiana algorytmu Allegro -->
					<div style="background:#eff6ff; border-bottom:1px solid #bfdbfe; padding:12px 16px; display:flex; align-items:flex-start; gap:10px;">
						<span style="font-size:18px; flex-shrink:0;">ℹ️</span>
						<div>
							<div style="font-weight:700; color:#1d4ed8; margin-bottom:4px; font-size:13px;">Ważne: Zmiany w algorytmie Allegro</div>
							<div style="font-size:12px; color:#1e40af; line-height:1.5;">Obecnie przy sortowaniu listingu liczą się: <strong>średnia ocena</strong>, <strong>liczba ocen</strong> oraz <strong>wskaźnik świeżości</strong>. Produkt z oceną 4.79, ale z ogromną liczbą nowych opinii, będzie wyżej niż produkt z oceną 5.0, który ma tylko dwie stare oceny.</div>
						</div>
					</div>

					<!-- Nagłówek sekcji wskazówek -->
					<div style="background:#f9fafb; padding:10px 16px; border-bottom:1px solid #e5e7eb;">
						<div style="font-weight:700; color:#374151; font-size:13px;">💡 Wskazówki optymalizacyjne – Jak działać na listingu?</div>
					</div>

					<!-- Dwie kolumny: CO ROBIĆ / CZEGO NIE WOLNO -->
					<div style="display:flex; gap:0;">

						<!-- CO ROBIĆ -->
						<div style="flex:1; padding:14px 16px; border-right:1px solid #e5e7eb; background:#f0fdf4;">
							<div style="font-weight:700; color:#15803d; margin-bottom:10px; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">✅ Co robić (Dobre praktyki)</div>
							<ul style="margin:0; padding:0; list-style:none; font-size:12px; color:#166534; line-height:1.6;">
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Stawiaj na skalę:</strong> Duża liczba pozytywów "przykryje" pojedyncze błędy i utrzyma Cię wysoko.</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Dbaj o "świeżość":</strong> Algorytm kocha nowe opinie. Jeśli oferta spada, pobudzaj sprzedaż (np. czasowymi obniżkami).</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Miłe gesty w paczce:</strong> Dorzucaj próbki, cukierki lub liściki z podziękowaniem – buduje to wdzięczność i chęć wystawienia 5 gwiazdek.</span></li>
								<li style="display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Proś wprost:</strong> Zawsze proś o opinię w wiadomości lub ulotce (ale nic za nią nie oferuj!).</span></li>
							</ul>
						</div>

						<!-- CZEGO NIE WOLNO -->
						<div style="flex:1; padding:14px 16px; background:#fff7f7;">
							<div style="font-weight:700; color:#b91c1c; margin-bottom:10px; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">❌ Czego nie wolno (Ryzyko blokady)</div>
							<ul style="margin:0; padding:0; list-style:none; font-size:12px; color:#7f1d1d; line-height:1.6;">
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Handel opiniami:</strong> Surowy zakaz oferowania rabatów, gratisów czy gotówki w zamian za ocenę lub jej zmianę.</span></li>
								<li style="margin-bottom:8px; display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Szantaż reklamacyjny:</strong> Nie uzależniaj zwrotu wpłaty od usunięcia negatywu. Najpierw pomóż, potem licz na dobrą wolę.</span></li>
								<li style="display:flex; gap:6px;"><span style="flex-shrink:0;">•</span><span><strong>Sztuczny ruch:</strong> Kupowanie własnych produktów dla opinii jest łatwo wykrywalne i surowo karane przez Allegro.</span></li>
							</ul>
						</div>
					</div>
				</div>
			</div>

		<!-- TABELA: Funkcje Allegro -->
				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
					🎯 Funkcje Allegro - Podsumowanie
					</div>
				<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
					<thead>
						<tr style="background:#f9fafb;">
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Funkcja</th>
							<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:80px;">Status</th>
							<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Rekomendacja</th>
						</tr>
					</thead>
					<tbody>
						${(() => {
					const features = this.generateAllegroFeaturesRecommendations();
					return `
								<tr>
									<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">🎯 Allegro SMART!</td>
									<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
										${features.smart.hasFeature ? '✅' : '❌'}
									</td>
									<td style="padding:12px; border:1px solid #e5e7eb; color:${features.smart.hasFeature ? '#059669' : '#dc2626'};">
										${features.smart.recommendation}
									</td>
								</tr>
								<tr>
									<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">💰 Gwarancja najniższej ceny</td>
									<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
										${features.bestPrice.hasFeature ? '✅' : '❌'}
									</td>
									<td style="padding:12px; border:1px solid #e5e7eb; color:${features.bestPrice.hasFeature ? '#059669' : '#dc2626'};">
										${features.bestPrice.recommendation}
									</td>
								</tr>
								<tr>
									<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">💳 Allegro Pay</td>
									<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
										${features.allegroPay.hasFeature ? '✅' : '❌'}
									</td>
									<td style="padding:12px; border:1px solid #e5e7eb; color:${features.allegroPay.hasFeature ? '#059669' : '#dc2626'};">
										${features.allegroPay.recommendation}
									</td>
								</tr>
								<tr>
									<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">🎫 Kupony rabatowe</td>
									<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
										${features.coupons.hasFeature ? '✅' : '❌'}
									</td>
									<td style="padding:12px; border:1px solid #e5e7eb; color:${features.coupons.hasFeature ? '#059669' : '#dc2626'};">
										${features.coupons.recommendation}
									</td>
								</tr>
							`;
				})()}
					</tbody>
				</table>
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						🎁 Pod miniaturami
					</div>
					${this.promotionalSections.length === 0 ? `
					<div style="border:2px solid #dc2626; border-radius:8px; padding:16px; background:#fee2e2;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #ef4444;">
							<div style="color:#991b1b; font-weight:700;">Status:</div>
							<div style="font-weight:700; color:#dc2626;">❌ BRAK SEKCJI</div>
						</div>
						<div style="padding:12px; background:#fef2f2; border-radius:6px; color:#7f1d1d; font-size:13px; line-height:1.6;">
							<strong>⚠️ Nie znaleziono żadnej sekcji pod miniaturami.</strong><br>
							Allegro nie wyświetla ani promocji sprzedawcy, ani sekcji sponsorowanych.<br>
							Skontaktuj się z Allegro lub sprawdź konfigurację aukcji.
						</div>
					</div>
					` : `
					${this.promotionalSections.map((section) => `
					<div style="border:2px solid ${section.isSponsored ? '#dc2626' : section.qualityColor}; border-radius:8px; padding:16px; margin-bottom:16px; background:${section.isSponsored ? '#fee2e2' : '#f0fdf4'};">
						<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
							<div style="font-size:16px; font-weight:700; color:#374151;">
								${escapeHtml(section.title)}
							</div>
							<div style="font-size:12px; font-weight:700; padding:6px 12px; border-radius:6px; white-space:nowrap; ${section.isSponsored ? 'background:#ef4444; color:white; border:1px solid #dc2626;' : 'background:#10b981; color:white; border:1px solid #059669;'}">
								${section.isSponsored ? '🔶 SPONSOROWANE PRZEZ ALLEGRO' : '✅ PROMOCJA SPRZEDAWCY'}
							</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:8px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Typ sekcji:</div>
							<div style="font-weight:600; color:${section.isSponsored ? '#dc2626' : '#10b981'};">${escapeHtml(section.sectionType)}</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:8px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Liczba produktów w sekcji:</div>
							<div style="font-weight:700; color:#374151;">${section.productCount}</div>
						</div>
						${!section.isSponsored ? `
						<div style="display:flex; justify-content:space-between; margin-bottom:8px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Ocena jakości promocji:</div>
							<div style="font-weight:700; color:${section.qualityColor};">${section.qualityRating}</div>
						</div>
						${section.qualityMessage ? `
						<div style="margin-bottom:12px; padding:10px; background:#fef9e7; border:2px solid ${section.qualityColor}; border-radius:6px;">
							<div style="font-size:13px; color:#374151; line-height:1.6;">
								<strong>💡 </strong>${escapeHtml(section.qualityMessage)}
							</div>
						</div>
						` : ''}
						` : `
						<div style="display:flex; justify-content:space-between; margin-bottom:8px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Uwaga:</div>
							<div style="font-weight:600; color:#dc2626;">Sekcja promuje oferty innych sprzedawców</div>
						</div>
						`}
						${section.description ? `
						<div style="font-size:13px; color:#6b7280; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:3px solid ${section.isSponsored ? '#dc2626' : section.qualityColor}; border-radius:4px;">
							<strong>Opis promocji:</strong> ${escapeHtml(section.description)}
						</div>
						` : ''}
						${section.offers.length > 0 ? `
						<div style="margin-top:12px;">
							<table style="width:100%; border-collapse:collapse; font-size:13px;">
								<thead>
									<tr style="background:#f3f4f6; border-bottom:1px solid #e5e7eb;">
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Nazwa oferty</th>
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Cena</th>
										<th style="padding:8px; text-align:left; color:#374151; font-weight:600;">Link do oferty</th>
									</tr>
								</thead>
								<tbody>
									${section.offers.map((offer) => `
									<tr style="border-bottom:1px solid #e5e7eb;">
										<td style="padding:8px; color:#374151;">${escapeHtml(offer.name)}</td>
										<td style="padding:8px; color:${section.isSponsored ? '#dc2626' : '#059669'}; font-weight:600;">${escapeHtml(offer.price)}</td>
										<td style="padding:8px;">
											${offer.link ? `<a href="${escapeHtml(offer.link)}" target="_blank" style="color:#2563eb; text-decoration:underline; font-size:11px; word-break:break-all;">${offer.link.substring(0, 50)}${offer.link.length > 50 ? '...' : ''}</a>` : 'Brak'}
										</td>
									</tr>
									`).join('')}
								</tbody>
							</table>
						</div>
						` : ''}
					</div>
					`).join('')}
					${this.promotionalSections.filter(s => !s.isSponsored).length === 0 && this.promotionalSections.length > 0 ? `
					<div style="margin-top:16px; padding:12px; background:#fee2e2; border:2px solid #dc2626; border-radius:8px;">
					<div style="font-weight:700; color:#991b1b; margin-bottom:8px;">❌ KRYTYCZNE!</div>
					<div style="color:#7f1d1d; font-size:13px; line-height:1.6;">
						<strong>Twoje sekcje sponsorwane Allegro promują konkurencję.</strong><br>
						Skonfiguruj opcję rabatu na n-tą sztukę.
					</div>
					</div>
					` : ''}
					`}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						📦 Zestawy produktowe (Zamów zestaw w jednej przesyłce)
					</div>
					${!this.bundleSection || !this.bundleSection.exists ? `
					<div style="border:2px solid #dc2626; border-radius:8px; padding:16px; background:#fee2e2;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #ef4444;">
							<div style="color:#991b1b; font-weight:700;">Status:</div>
							<div style="font-weight:700; color:#dc2626;">⚠️ BRAK SEKCJI ZESTAWÓW</div>
						</div>
						<div style="padding:12px; background:#fef2f2; border-radius:6px; color:#7f1d1d; font-size:13px; line-height:1.6;">
							<strong>⚠️ Nie znaleziono sekcji zestawów produktowych.</strong><br>
							${escapeHtml(this.bundleSection ? this.bundleSection.qualityMessage : 'Warto tworzyć zestawy produktowe aby zwiększyć sprzedaż i średnią wartość zamówienia.')}<br><br>
							<strong>Zalecenie:</strong> Skonfiguruj zestawy produktowe (np. "Zamów zestaw w jednej przesyłce") dodając minimum 3 produkty, które często kupowane są razem. To zwiększy wartość koszyka i wygodę dla klienta.
						</div>
					</div>
					` : `
					<div style="border:2px solid ${this.bundleSection.qualityColor}; border-radius:8px; padding:16px; background:${this.bundleSection.productCount === 2 ? '#fef3c7' : '#f0fdf4'};">
						<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
							<div style="font-size:16px; font-weight:700; color:#374151;">
								${escapeHtml(this.bundleSection.title)}
							</div>
							<div style="font-size:12px; font-weight:700; padding:6px 12px; border-radius:6px; white-space:nowrap; ${this.bundleSection.productCount === 2 ? 'background:#eab308; color:white; border:1px solid #ca8a04;' : 'background:#10b981; color:white; border:1px solid #059669;'}">
								${this.bundleSection.qualityRating}
							</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Liczba produktów w zestawie:</div>
							<div style="font-weight:700; color:${this.bundleSection.qualityColor};">${this.bundleSection.productCount}</div>
						</div>
						${this.bundleSection.qualityMessage ? `
						<div style="padding:12px; background:${this.bundleSection.productCount === 2 ? '#fffbeb' : '#f0fdf4'}; border-radius:6px; color:#374151; font-size:13px; line-height:1.6; margin-bottom:12px;">
							${escapeHtml(this.bundleSection.qualityMessage)}
						</div>
						` : ''}
						${this.bundleSection.products && this.bundleSection.products.length > 0 ? `
						<div style="margin-top:8px;">
							<div style="font-weight:600; color:#374151; margin-bottom:8px;">Produkty w zestawie (${this.bundleSection.products.length} ${this.bundleSection.products.length === this.bundleSection.productCount ? '' : `z ${this.bundleSection.productCount}`}):</div>
							${this.bundleSection.products.map((product, index) => `
							<div style="padding:8px; margin-bottom:6px; background:white; border-radius:4px; border:1px solid #e5e7eb;">
								<div style="font-size:12px; color:#6b7280; margin-bottom:2px;">Produkt ${index + 1}:</div>
								<div style="font-size:13px; color:#374151; font-weight:500;">
									${escapeHtml(product.name)}
								</div>
								${product.link ? `
								<div style="font-size:11px; color:#9ca3af; margin-top:4px; word-break:break-all;">
									<a href="${escapeHtml(product.link)}" target="_blank" style="color:#2563eb; text-decoration:none;">🔗 Link do produktu</a>
								</div>
								` : ''}
							</div>
							`).join('')}
						</div>
						` : ''}
					</div>
					`}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:17px; font-weight:600; color:#111827; margin-bottom:12px; padding:10px 14px; background:#f9fafb; border-left:4px solid #ff5a00; border-radius:0 8px 8px 0; letter-spacing:-0.02em;">
						💡 Propozycje dla Ciebie
					</div>
					${!this.suggestionsSection || !this.suggestionsSection.exists ? `
					<div style="border:1px solid #fdba74; border-radius:12px; padding:18px 20px; background:#fff7ed;">
						<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 0; border-bottom:1px solid #fed7aa;">
							<div style="color:#9a3412; font-weight:600;">Status:</div>
							<div style="font-weight:600; color:#ea580c;">⚠️ BRAK SEKCJI</div>
						</div>
						<div style="padding:14px 16px; background:#ffedd5; border-radius:10px; color:#7c2d12; font-size:14px; line-height:1.55; letter-spacing:-0.01em;">
							<strong>Brak sekcji "Propozycje dla Ciebie"!</strong><br>
							${this.suggestionsSection?.recommendation || 'Sprawdź czy sekcja jest dostępna na stronie produktu.'}
						</div>
					</div>
					` : `
					<div style="border:1px solid ${this.suggestionsSection.qualityColor}; border-radius:12px; padding:18px 20px; background:${this.suggestionsSection.hasBrandTab ? '#f0fdf4' : '#fff7ed'};">
						<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
							<div style="font-size:15px; font-weight:600; color:#111827; letter-spacing:-0.01em;">
								Sekcja "Propozycje dla Ciebie"
							</div>
							<div style="font-size:12px; font-weight:600; padding:6px 12px; border-radius:8px; white-space:nowrap; ${this.suggestionsSection.hasBrandTab ? 'background:#059669; color:white;' : 'background:#ea580c; color:white;'}">
								${this.suggestionsSection.qualityRating}
							</div>
						</div>
						<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 0; border-bottom:1px solid #f3f4f6;">
							<div style="color:#6b7280; font-weight:500;">Ma zakładkę z marką:</div>
							<div style="font-weight:600;">${this.suggestionsSection.hasBrandTab ? `✅ TAK${this.suggestionsSection.brandName ? ` (${escapeHtml(this.suggestionsSection.brandName)})` : ''}` : '❌ NIE'}</div>
						</div>

						${this.suggestionsSection.recommendation ? `
						<div style="padding:14px 16px; background:${this.suggestionsSection.hasBrandTab ? '#ecfdf5' : '#ffedd5'}; border-radius:10px; border-left:4px solid ${this.suggestionsSection.qualityColor}; color:#374151; font-size:14px; line-height:1.55; letter-spacing:-0.01em;">
							💡 <strong>Rekomendacja:</strong> ${escapeHtml(this.suggestionsSection.recommendation)}
						</div>
						` : ''}
					</div>
					`}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						📝 Analiza opisu aukcji
					</div>
					<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
						<thead>
							<tr style="background:#f9fafb;">
								<th style="padding:12px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Parametr</th>
								<th style="padding:12px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:150px;">Wartość</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba znaków w opisie</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">
									${this.descriptionLength > 0 ? this.descriptionLength.toLocaleString('pl-PL') : 'Brak'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Czy zawiera obrazy</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-size:18px;">
									${this.descriptionHasImages ? '✅ TAK' : '❌ NIE'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Liczba obrazów w opisie</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700;">
									${this.descriptionImagesCount > 0 ? this.descriptionImagesCount : 'Brak'}
								</td>
							</tr>
							<tr>
								<td style="padding:12px; border:1px solid #e5e7eb; font-weight:500;">Procent pogrubionego tekstu</td>
								<td style="padding:12px; border:1px solid #e5e7eb; text-align:center; font-weight:700; color:${this.descriptionBoldPercent >= 5 && this.descriptionBoldPercent <= 10 ? '#059669' :
					this.descriptionBoldPercent >= 3 && this.descriptionBoldPercent < 5 ? '#ca8a04' :
						this.descriptionBoldPercent > 10 && this.descriptionBoldPercent <= 15 ? '#ca8a04' :
							'#dc2626'
				};">
									${this.descriptionBoldPercent > 0 ? this.descriptionBoldPercent + '%' : 'Brak'}
									${this.descriptionBoldPercent >= 5 && this.descriptionBoldPercent <= 10 ? ' ✅' : this.descriptionBoldPercent >= 3 && this.descriptionBoldPercent <= 15 ? ' ⚠️' : ' ❌'}
								</td>
							</tr>
							<tr>
								<td colspan="2" style="padding:12px; border:1px solid #e5e7eb; background:#f9fafb; color:#6b7280; font-size:12px;">
									<strong>Rekomendacja:</strong> Optymalne: 5-10% pogrubionego tekstu. Wyróżnij najważniejsze informacje, ale nie przesadzaj.
								</td>
							</tr>
						</tbody>
					</table>
					
					${this.parametersInDescription.length > 0 ? `
					<div style="margin-top:24px;">
						<div style="font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f8fafc; border-radius:6px;">
							📋 Parametry produktu w opisie (${this.parametersInDescriptionScore}% zgodności)
						</div>
						<div style="font-size:11px; color:#6b7280; margin-bottom:12px; padding:8px; background:#fef9c3; border-left:3px solid #ca8a04; border-radius:4px;">
							ℹ️ <strong>Uwaga:</strong> Parametry "Stan" i "Faktura" są pomijane w analizie, ponieważ według regulaminu Allegro sprzedawcy nie mogą umieszczać ich w opisie produktu.
						</div>
						<table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb;">
							<thead>
								<tr style="background:#f9fafb;">
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:20%;">Parametr</th>
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:20%;">Wartość</th>
									<th style="padding:10px; text-align:center; border:1px solid #e5e7eb; font-weight:600; color:#374151; width:80px;">W opisie</th>
									<th style="padding:10px; text-align:left; border:1px solid #e5e7eb; font-weight:600; color:#374151;">Fragment w opisie</th>
								</tr>
							</thead>
							<tbody>
								${this.parametersInDescription
						.filter(param => !['stan', 'faktura'].includes(param.name.toLowerCase()))
						.map((param, index) => `
									<tr style="${index % 2 === 0 ? 'background:#fafafa;' : ''}">
										<td style="padding:10px; border:1px solid #e5e7eb; font-weight:500; color:#374151;">
											${escapeHtml(param.name)}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; color:#6b7280;">
											${param.link ? `<a href="${escapeHtml(param.link)}" target="_blank" style="color:#2563eb; text-decoration:none;">${escapeHtml(param.value)}</a>` : escapeHtml(param.value)}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; text-align:center; font-size:16px; font-weight:700; color:${param.found ? '#059669' : '#dc2626'};">
											${param.found ? '✅' : '❌'}
										</td>
										<td style="padding:10px; border:1px solid #e5e7eb; color:#6b7280; font-size:12px; font-style:italic;">
											${param.context !== '-' ? escapeHtml(param.context) : '<span style="color:#9ca3af;">-</span>'}
										</td>
									</tr>
								`).join('')}
							</tbody>
						</table>
						<div style="margin-top:12px; padding:14px; background:${this.parametersInDescriptionScore >= 76 ? '#ecfdf5' :
						this.parametersInDescriptionScore >= 60 ? '#fefce8' :
							this.parametersInDescriptionScore >= 50 ? '#fff7ed' :
								'#fee2e2'
					}; border-radius:8px; border:2px solid ${this.parametersInDescriptionScore >= 76 ? '#10b981' :
						this.parametersInDescriptionScore >= 60 ? '#eab308' :
							this.parametersInDescriptionScore >= 50 ? '#fb923c' :
								'#dc2626'
					}; font-size:14px;">
							<div style="font-weight:700; font-size:15px; color:${this.parametersInDescriptionScore >= 76 ? '#059669' :
						this.parametersInDescriptionScore >= 60 ? '#ca8a04' :
							this.parametersInDescriptionScore >= 50 ? '#ea580c' :
								'#dc2626'
					}; margin-bottom:8px;">
								💡 Zgodność: ${this.parametersInDescriptionScore}% parametrów znaleziono w opisie (z wyłączeniem Stan i Faktura)
							</div>
							<div style="color:#374151; line-height:1.5;">
								<strong>Rekomendacja:</strong> ${this.parametersInDescriptionScore >= 76
						? 'Świetnie! Opis zawiera większość parametrów produktu. Tak trzymaj!'
						: this.parametersInDescriptionScore >= 60
							? 'Dobrze, ale warto uzupełnić opis o brakujące parametry aby zwiększyć atrakcyjność oferty.'
							: this.parametersInDescriptionScore >= 50
								? 'Średnio - brakuje wielu parametrów w opisie. Uzupełnij opis o kluczowe informacje o produkcie.'
								: 'Pilnie uzupełnij opis! Większość parametrów nie jest wymieniona, co znacząco obniża jakość oferty i zaufanie klientów.'
					}
							</div>
						</div>
					</div>
					` : ''}
					
					${this.descriptionAiAnalysis ? `
					<div style="margin-top:24px; padding:16px; background:#f0f9ff; border-radius:8px; border:2px solid #3b82f6;">
						<div style="font-weight:700; font-size:16px; color:#1e40af; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
							🤖 Podsumowanie analizy opisu z AI
							<span style="font-size:11px; color:#6b7280; font-weight:400;">(tokeny: ${this.descriptionAiTokensUsed})</span>
						</div>
					${this.descriptionAiAnalysis.includes('⚠️ Wystąpił błąd') || this.descriptionAiAnalysis.includes('❌ Błąd') ? `
						<div style="background:#fee2e2; border:2px solid #dc2626; border-radius:6px; padding:16px;">
							<div style="font-weight:700; color:#991b1b; margin-bottom:8px; font-size:14px;">⚠️ Wystąpił błąd podczas analizy AI</div>
							<div style="color:#7f1d1d; font-size:13px; line-height:1.6; margin-bottom:12px;">
								W razie problemów skontaktuj się z nami:<br>
								<a href="mailto:damian@vautomate.pl" style="color:#dc2626; font-weight:600; text-decoration:underline;">damian@vautomate.pl</a>
							</div>
							<div style="border-top:1px solid #fca5a5; padding-top:12px; margin-top:12px;">
								<div style="font-weight:600; color:#991b1b; margin-bottom:6px; font-size:12px;">Szczegóły błędu:</div>
								<div style="color:#6b7280; font-size:12px; font-family:monospace; background:#fef2f2; padding:8px; border-radius:4px; white-space:pre-wrap;">
									${escapeHtml(this.descriptionAiAnalysis.replace(/⚠️ Wystąpił błąd podczas analizy AI\.\n\nW razie problemów skontaktuj się z nami: damian@vautomate\.pl\n\n---\n\n❌ Szczegóły błędu:\n/, '').replace(/❌ Błąd połączenia: /, ''))}
								</div>
							</div>
						</div>
					` : `
						<div style="color:#374151; line-height:1.8; white-space:pre-wrap; font-size:13px; padding-left:0; text-indent:0;">${escapeHtml(normalizeAiText(this.descriptionAiAnalysis))}</div>
					`}
					</div>
					` : ''}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						🛡️ Reklamacja, Gwarancja, Allegro Ochrona Kupujących
					</div>
					<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Jakość ochrony:</div>
							<div style="font-weight:700; color:${this.protectionQuality >= 75 ? '#059669' : this.protectionQuality >= 50 ? '#d97706' : '#dc2626'};">${this.protectionQuality}%</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Zwroty:</div>
							<div style="font-weight:700;">${this.hasReturnPolicy ? `${this.returnDays} dni${this.returnDays > 14 ? ' (ponad standard)' : this.returnDays === 14 ? ' (standard)' : ' (poniżej standardu)'}` : 'Brak informacji'}</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Reklamacje:</div>
							<div style="font-weight:700;">${this.hasComplaintPolicy ? this.complaintPeriod : 'Brak informacji'}</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Gwarancja:</div>
							<div style="font-weight:700;">${this.hasWarranty ? this.warrantyPeriod : 'Brak informacji'}</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; ${this.protectionQuality === 100 ? '' : 'border-bottom:1px dashed #e5e7eb;'}">
							<div style="color:#6b7280;">Allegro Protect:</div>
							<div style="font-weight:700;">${this.hasAllegroProtect ? this.allegroProtectPeriod : 'Brak informacji'}</div>
						</div>
						${this.protectionQuality < 100 ? `
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0;">
							<div style="color:#6b7280;">Rekomendacja:</div>
							<div style="font-weight:700; color:#dc2626;">
								${this.protectionQuality < 25 ? 'Krytyczne braki - dodaj wszystko' :
						this.protectionQuality < 50 ? 'Znaczące braki - uzupełnij' :
							this.protectionQuality < 75 ? 'Drobne braki - rozważ uzupełnienie' :
								'Niemal kompletne'}
							</div>
						</div>
						` : `
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0;">
							<div style="color:#6b7280;">Status:</div>
							<div style="font-weight:700; color:#059669;">Kompletna ochrona ✅</div>
						</div>
						`}
					</div>
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						📋 Parametry produktu
					</div>
					<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Liczba parametrów:</div>
							<div style="font-weight:700;">${parametersCount}</div>
						</div>
						<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
							<div style="color:#6b7280;">Status marki:</div>
							<div style="font-weight:700; color:${hasBrand ? '#059669' : '#dc2626'};">
								${hasBrand ? (brandType === 'producent' ? '✅ Ma producenta' : '✅ Ma markę') : '❌ Bez marki'}
							</div>
						</div>
						${hasBrand && brandName ? `
						<div style="display:flex; justify-content:space-between; padding:8px 0;">
							<div style="color:#6b7280;">${brandType === 'producent' ? 'Producent:' : 'Marka:'}</div>
							<div style="font-weight:700;">
								${brandLink ?
							`<a href="${brandLink}" target="_blank" style="color: #2563eb; text-decoration: underline;">${this.escapeHtml(brandName)}</a>` :
							this.escapeHtml(brandName)
						}
							</div>
						</div>
						` : ''}
					</div>
					
					${parametersCount > 0 ? `
					<div style="margin-top: 16px;">
						<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📋 Pełna lista parametrów</div>
						<div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
							${productParameters.map((param, index) => `
								<div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #ffffff;">
									<div style="font-weight: 600; margin-bottom: 4px; color: #374151;">
										${index + 1}. ${this.escapeHtml(param.name)}
									</div>
									<div style="font-size: 14px; color: #6b7280; margin-bottom: 6px;">
										<strong>Wartość:</strong> 
										${param.hasLink ?
							`<a href="${param.link}" target="_blank" style="color: #2563eb; text-decoration: underline;">${this.escapeHtml(param.value)}</a>` :
							this.escapeHtml(param.value)
						}
									</div>
									${param.hasLink ? `
									<div style="font-size: 11px; color: #9ca3af;">
										<strong>Link:</strong> ${this.escapeHtml(param.link)}
									</div>
									` : ''}
								</div>
							`).join('')}
						</div>
					</div>
					` : '<div style="color: #6b7280; font-style: italic; text-align: center; padding: 16px;">Nie znaleziono parametrów produktu</div>'}
				</div>

				<div style="margin-bottom:24px;">
					<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
						🖼️ Czy jest miniatura
					</div>
					<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
						<div style="display:flex; justify-content:space-between; padding:8px 0;">
							<div style="color:#6b7280;">Status:</div>
							<div style="font-weight:700;">${hasThumbnail ? '✅ TAK - Znaleziono miniatura' : '❌ NIE - Brak miniatury'}</div>
						</div>
						${hasThumbnail ? `
						<div style="margin-top: 16px; text-align: center;">
							<img src="${thumbnailData.src}" alt="${thumbnailData.alt || 'Miniatura produktu'}" style="max-width: 300px; max-height: 300px; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
						</div>
						<div style="margin-top: 16px;">
							<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📊 Szczegóły obrazu</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Format:</div>
								<div style="font-weight:700;">${thumbnailData.format || 'Nieznany'}</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Link do obrazu:</div>
								<div style="font-weight:700;">
									<a href="${thumbnailData.src}" target="_blank" style="color: #2563eb; text-decoration: underline; word-break: break-all; font-size: 11px;">
										${thumbnailData.src}
									</a>
								</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Rozdzielczość:</div>
								<div style="font-weight:700;">${thumbnailData.naturalWidth} × ${thumbnailData.naturalHeight} px</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Wyświetlane:</div>
								<div style="font-weight:700;">${thumbnailData.displayWidth} × ${thumbnailData.displayHeight} px</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Proporcje:</div>
								<div style="font-weight:700;">${thumbnailData.aspectRatio || 'Nieznane'}</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Szacowane DPI:</div>
								<div style="font-weight:700;">${thumbnailData.estimatedDpi || 'Nieznane'}</div>
							</div>
							<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
								<div style="color:#6b7280;">Rozmiar pliku:</div>
								<div style="font-weight:700;">${thumbnailData.fileSize > 0 ? this.formatFileSize(thumbnailData.fileSize) : 'Nie można pobrać (CORS)'}</div>
							</div>
							<div style="display:flex; justify-content:space-between; padding:8px 0;">
								<div style="color:#6b7280;">Status ładowania:</div>
								<div style="font-weight:700;">${thumbnailData.loadingState || 'Nieznany'}</div>
							</div>
						</div>
						` : ''}
				</div>
			</div>

			<!-- SEKCJA TYMCZASOWO WYŁĄCZONA - UNIKALNE OBRAZY NA STRONIE
			<div style="margin-bottom:24px;">
				<div style="font-size:18px; font-weight:600; color:#374151; margin-bottom:12px; padding:8px; background:#f9fafb; border-left:4px solid #ff5a00;">
					📷 Unikalne obrazy na stronie (≥100×100px)
				</div>
				<div style="border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
					<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
						<div style="color:#6b7280;">Liczba znalezionych obrazów:</div>
						<div style="font-weight:700;">${allImages.length}</div>
					</div>
					${allImages.length > 0 ? `
					<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
						<div style="color:#6b7280;">Obrazy z Allegro:</div>
						<div style="font-weight:700;">${allImages.filter(img => img.isAllegro).length}</div>
					</div>
					<div style="display:flex; justify-content:space-between; margin-bottom:12px; padding:8px 0; border-bottom:1px dashed #e5e7eb;">
						<div style="color:#6b7280;">Ikony/małe obrazy:</div>
						<div style="font-weight:700;">${allImages.filter(img => img.isIcon).length}</div>
					</div>
					<div style="display:flex; justify-content:space-between; padding:8px 0;">
						<div style="color:#6b7280;">Widoczne obrazy:</div>
						<div style="font-weight:700;">${allImages.filter(img => img.isVisible).length}</div>
					</div>
					` : ''}
				</div>
				
				${allImages.length > 0 ? `
				<div style="margin-top: 16px;">
					<div style="font-weight: 600; color: #374151; margin-bottom: 12px; padding: 8px; background: #f8fafc; border-radius: 6px;">📋 Lista wszystkich obrazów</div>
					<div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
						${allImages.map((img, index) => `
							<div style="margin-bottom: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: ${img.isAllegro ? '#f0f9ff' : '#ffffff'}; display: flex; gap: 12px;">
								<div style="flex-shrink: 0; width: 80px; height: 80px; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; background: #f9fafb; display: flex; align-items: center; justify-content: center;">
									<img src="${this.sanitizeUrl(img.src)}" 
										 alt="${escapeHtml(img.alt)}" 
										 style="max-width: 100%; max-height: 100%; object-fit: contain;"
										 onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"
									/>
									<div style="display: none; font-size: 10px; color: #6b7280; text-align: center; padding: 4px;">❌<br>Błąd ładowania</div>
								</div>
								<div style="flex: 1; min-width: 0;">
									<div style="font-weight: 600; margin-bottom: 4px; color: #374151;">
										${img.index}. ${img.isAllegro ? '🎯 Allegro' : img.isIcon ? '🔸 Ikona' : '📷 Obraz'} - ${escapeHtml(img.alt)}
									</div>
									<div style="font-size: 10px; color: #9ca3af; margin-bottom: 4px;">
										Pozycja na stronie: ${img.domIndex}
									</div>
									<div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">
										<strong>Rozmiar:</strong> ${img.width}×${img.height}px 
										${img.displayWidth !== img.width || img.displayHeight !== img.height ?
								`(wyświetlany: ${img.displayWidth}×${img.displayHeight}px)` : ''}
									</div>
									<div style="font-size: 12px; color: #6b7280; margin-bottom: 6px;">
										<strong>Domena:</strong> ${escapeHtml(img.domain)} | 
										<strong>Widoczny:</strong> ${img.isVisible ? '✅ TAK' : '❌ NIE'}
									</div>
									<div style="font-size: 11px; word-break: break-all;">
										<strong>URL:</strong> 
										<a href="${this.sanitizeUrl(img.src)}" target="_blank" style="color: #2563eb; text-decoration: underline;">
											${escapeHtml(this.sanitizeUrl(img.src))}
										</a>
									</div>
								</div>
							</div>
						`).join('')}
					</div>
				</div>
				` : '<div style="color: #6b7280; font-style: italic; text-align: center; padding: 16px;">Nie znaleziono żadnych obrazów na stronie</div>'}
			</div>
			KONIEC SEKCJI TYMCZASOWO WYŁĄCZONEJ -->

			<div style="margin-top:32px; padding-top:16px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; text-align:center;">
					Wygenerowano przez Allegro Skan Ofert v${typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '3.6.0'}
				</div>
			`;

			document.body.appendChild(style);
			document.body.appendChild(area);
			const cleanup = () => {
				try { area.remove(); } catch (e) { }
				try { style.remove(); } catch (e) { }
			};
			window.addEventListener('afterprint', cleanup, { once: true });
			setTimeout(() => {
				try { window.print(); } catch (e) { cleanup(); }
			}, 50);
		}
	}

	function escapeHtml(input) {
		if (input == null) return '';
		return String(input)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	/** Usuwa wcięcia na początku każdej linii (spacje, taby, nbsp, em-space itd.) */
	function normalizeAiText(text) {
		if (!text || typeof text !== 'string') return '';
		return text.trim().split('\n').map(function (l) {
			return l.replace(/^[\s\u00A0\u2000-\u200B\u202F\u205F\u3000]+/, '');
		}).join('\n');
	}

	// Uruchom po załadowaniu
	(function(){
		try {
			new AllegroOfferScanner();
		} catch (err) {
			try { console.error('❌ Inicjalizacja panelu nie powiodła się:', err); } catch (_) {}
			try {
				var badge = document.createElement('div');
				badge.style.cssText = 'position:fixed;top:10px;right:10px;padding:8px 10px;background:#dc2626;color:#fff;font-weight:600;border-radius:8px;z-index:2147483647;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,0.15)';
				badge.textContent = 'Skaner: błąd inicjalizacji – kliknij';
				badge.onclick = function(){ try { new AllegroOfferScanner(); badge.remove(); } catch(_){} };
				document.body.appendChild(badge);
			} catch (_) {}
		}
	})();

})();
