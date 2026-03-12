// Service worker – proxy do Apps Script API (omija CORS przy żądaniach z content script na allegro.pl)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.type !== 'apiFetch') {
		return;
	}
	const { url, options = {} } = msg;
	fetch(url, options)
		.then(async (res) => {
			const text = await res.text();
			sendResponse({ ok: res.ok, status: res.status, statusText: res.statusText, body: text });
		})
		.catch((err) => {
			sendResponse({ ok: false, status: 0, statusText: err.message || 'Failed to fetch', body: '' });
		});
	return true; // keep channel open for async sendResponse
});
