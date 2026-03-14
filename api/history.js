// AIdea Pulse — API: fetch history from Notion

const NOTION_KEY = process.env.NOTION_API_KEY;
const HISTORY_DB = '323c8f76-5510-8125-b1a2-f39cdb57d1c1';

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!NOTION_KEY) return res.status(500).json({ error: 'No Notion key configured' });

  try {
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${HISTORY_DB}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sorts: [{ property: 'Generado en', direction: 'descending' }],
        page_size: 30
      })
    });
    const data = await notionRes.json();

    const entries = (data.results || []).map(page => {
      const props = page.properties;
      const getText = key => props[key]?.rich_text?.[0]?.plain_text || '';
      const getTitle = key => props[key]?.title?.[0]?.plain_text || '';
      const getDate  = key => props[key]?.date?.start || null;

      return {
        id:          page.id,
        fecha:       getTitle('Fecha'),
        frase:       getText('Frase'),
        tendencias:  safeJSON(getText('Tendencias')) || [],
        ideas_instagram: safeJSON(getText('Instagram')) || [],
        ideas_linkedin:  safeJSON(getText('LinkedIn')) || [],
        stat_del_dia:    safeJSON(getText('Stat')) || {},
        sources:     safeJSON(getText('Fuentes')) || [],
        generado_en: getDate('Generado en')
      };
    });

    res.status(200).json({ entries, total: entries.length });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
