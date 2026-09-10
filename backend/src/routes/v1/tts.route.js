import express from 'express';
import https from 'https';

const router = express.Router();

router.get('/', (req, res) => {
  const { lang = 'en', text = '' } = req.query;
  const cleanText = String(text || '').trim();

  if (!cleanText) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  // Google TTS limits single query to 200 chars; truncate safely
  const truncated = cleanText.slice(0, 200);
  const targetLang = String(lang || 'en').slice(0, 5);
  const targetUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(targetLang)}&q=${encodeURIComponent(truncated)}`;

  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'audio/mpeg, audio/*;q=0.9, */*;q=0.8',
    },
  };

  https.get(targetUrl, options, (apiRes) => {
    if (apiRes.statusCode !== 200) {
      return res.status(apiRes.statusCode).json({ error: 'Failed to fetch TTS stream' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    apiRes.pipe(res);
  }).on('error', (err) => {
    res.status(500).json({ error: 'TTS streaming error', details: err.message });
  });
});

export default router;
