// AIdea Pulse — API: fetch today's brief from Notion (if exists)
// Returns { found: true, brief: {...} } or { found: false }

const NOTION_KEY = process.env.NOTION_API_KEY;
const HISTORY_DB = '323c8f76-5510-8125-b1a2-f39cdb57d1c1';

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function todayBogota() {
  // Returns "YYYY-MM-DD" in America/Bogota timezone
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!NOTION_KEY) return res.status(200).json({ found: false });

  try {
    const today = todayBogota(); // e.g. "2026-03-14"
    const startOfDay = today + 'T00:00:00.000-05:00';
    const endOfDay   = today + 'T23:59:59.999-05:00';

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${HISTORY_DB}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filter: {
          property: 'Generado en',
          date: { on_or_after: startOfDay, on_or_before: endOfDay }
        },
        sorts: [{ property: 'Generado en', direction: 'descending' }],
        page_size: 1
      })
    });

    const data = await notionRes.json();
    const results = data.results || [];

    if (!results.length) {
      return res.status(200).json({ found: false });
    }

    const page  = results[0];
    const props = page.properties;
    const getText  = key => props[key]?.rich_text?.[0]?.plain_text || '';
    const getTitle = key => props[key]?.title?.[0]?.plain_text || '';
    const getDate  = key => props[key]?.date?.start || null;

    const brief = {
      fecha:           getTitle('Fecha'),
      frase_del_dia:   getText('Frase'),
      tendencias:      safeJSON(getText('Tendencias')) || [],
      ideas_instagram: safeJSON(getText('Instagram'))  || [],
      ideas_linkedin:  safeJSON(getText('LinkedIn'))   || [],
      stat_del_dia:    safeJSON(getText('Stat'))        || {},
      sources:         safeJSON(getText('Fuentes'))     || [],
      generado_en:     getDate('Generado en'),
      from_cache:      true
    };

    res.status(200).json({ found: true, brief });

  } catch(err) {
    console.error('today.js error:', err.message);
    res.status(200).json({ found: false }); // fallback: generate fresh
  }
}
