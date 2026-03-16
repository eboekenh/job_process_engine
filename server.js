import 'dotenv/config';
import express from 'express';

const app = express();
const port = Number(process.env.PORT || 8787);
const host = '127.0.0.1';
const model = 'gemini-2.5-flash-preview-09-2025';

const ALLOWED_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isAllowedLocalUrl = (value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return ALLOWED_LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

app.use(express.json({ limit: '25mb' }));

app.post('/api/gemini', async (req, res) => {
  const origin = req.get('origin');
  const referer = req.get('referer');
  if (!isAllowedLocalUrl(origin) || !isAllowedLocalUrl(referer)) {
    return res.status(403).json({ error: 'Localhost-only API access.' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY on server.' });
  }

  const { prompt, systemInstruction = '', fileData = null } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing prompt.' });
  }

  const parts = [{ text: prompt }];
  if (fileData?.mimeType && fileData?.base64) {
    parts.push({
      inlineData: { mimeType: fileData.mimeType, data: fileData.base64 }
    });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || `Gemini API error (HTTP ${response.status})`;
      return res.status(response.status).json({ error: message });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ text });
  } catch (error) {
    return res.status(502).json({ error: 'Failed to connect to Gemini API.' });
  }
});

app.listen(port, host, () => {
  console.log(`Gemini proxy listening on http://${host}:${port}`);
});
