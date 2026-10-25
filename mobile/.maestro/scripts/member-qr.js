// Fetches a member's live check-in QR token from the API, as the member's phone would show it.
// Runs in the Maestro process on this PC (so API_URL is the backend as seen from here).
// Env: API_URL, EMAIL, PASSWORD, GYM.
const base = API_URL + "/api/mobile/v1";
const headers = { "Content-Type": "application/json" };
const device = { name: "Maestro QR helper", platform: "android", appVersion: "e2e" };

const login = json(http.post(base + "/auth/login", { headers, body: JSON.stringify({ identifier: EMAIL, password: PASSWORD, device }) }).body);
const scoped = json(http.post(base + "/auth/select-gym", { headers: { ...headers, Authorization: "Bearer " + login.accessToken }, body: JSON.stringify({ gymSlug: GYM }) }).body);
const card = json(http.get(base + "/member/card", { headers: { Authorization: "Bearer " + scoped.accessToken } }).body);
output.qrToken = card.qr.token;
