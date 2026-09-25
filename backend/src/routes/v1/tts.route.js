import express from 'express';
import https from 'https';

const router = express.Router();

// Language code → BCP-47 map for Google TTS
const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN',
  kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN',
  ml: 'ml-IN', bn: 'bn-IN',
};

router.get('/', (req, res) => {
  const { lang = 'en', text = '' } = req.query;
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  // Truncate to 200 chars safely (Google TTS hard limit)
  const truncated = cleanText.slice(0, 200);
  const rawLang  = String(lang || 'en').slice(0, 10);
  const targetLang = LANG_MAP[rawLang] || rawLang;

  // Use client=tw-ob which is more reliably served by Google Translate's TTS endpoint
  const targetUrl = `https://translate.googleapis.com/translate_tts?client=tw-ob&ie=UTF-8&tl=${encodeURIComponent(targetLang)}&q=${encodeURIComponent(truncated)}&ttsspeed=0.9`;

  const options = {
    headers: {
      // Mimic a real browser navigating from Google Translate
      'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Referer': 'https://translate.google.com/',
      'Origin': 'https://translate.google.com',
      'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };

  const proxyReq = https.get(targetUrl, options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      // Consume the body to free the socket, then send error so frontend falls back to SpeechSynthesis
      apiRes.resume();
      return res.status(502).json({ error: 'TTS upstream error', status: apiRes.statusCode });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    apiRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'TTS proxy error', details: err.message });
    }
  });

  proxyReq.setTimeout(8000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'TTS request timed out' });
    }
  });
});

export default router;
