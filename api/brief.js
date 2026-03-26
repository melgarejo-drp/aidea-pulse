// AIdea Pulse — API: generate brief + save to Notion history

const TAVILY_KEY    = process.env.TAVILY_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY    = process.env.NOTION_API_KEY;
const HISTORY_DB    = '323c8f76-5510-8125-b1a2-f39cdb57d1c1';

async function searchTavily(query, maxResults = 5) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query,
      max_results: maxResults,
      include_answer: true,
      search_depth: 'basic'
    })
  });
  return res.json();
}

async function generateWithClaude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (!data.content || !data.content[0]) {
    throw new Error(`Claude error: ${data.error?.message || 'empty response'}`);
  }
  return data.content[0].text;
}

async function getRecentTrendTopics() {
  if (!NOTION_KEY) return [];
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
        page_size: 3
      })
    });
    const data = await notionRes.json();
    const topics = [];
    for (const page of data.results || []) {
      const tendenciasText = page.properties?.Tendencias?.rich_text?.[0]?.plain_text || '{}';
      try {
        const parsed = JSON.parse(tendenciasText);
        if (Array.isArray(parsed)) {
          topics.push(...parsed.map(t => t.titulo || t.title).filter(Boolean));
        }
      } catch {}
    }
    return topics.slice(0, 10);
  } catch (e) {
    console.error('getRecentTrendTopics error:', e.message);
    return [];
  }
}

async function saveToNotion(brief) {
  if (!NOTION_KEY) return;
  try {
    const truncate = (str, n) => {
      if (!str) return '';
      const s = typeof str === 'string' ? str : JSON.stringify(str);
      return s.length > n ? s.slice(0, n) : s;
    };

    await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: HISTORY_DB },
        properties: {
          'Fecha':       { title:     [{ text: { content: brief.fecha || '' } }] },
          'Frase':       { rich_text: [{ text: { content: truncate(brief.frase_del_dia, 2000) } }] },
          'Tendencias':  { rich_text: [{ text: { content: truncate(JSON.stringify(brief.tendencias), 2000) } }] },
          'Instagram':   { rich_text: [{ text: { content: truncate(JSON.stringify(brief.ideas_instagram), 2000) } }] },
          'LinkedIn':    { rich_text: [{ text: { content: truncate(JSON.stringify(brief.ideas_linkedin), 2000) } }] },
          'Stat':        { rich_text: [{ text: { content: truncate(JSON.stringify(brief.stat_del_dia), 500) } }] },
          'Fuentes':     { rich_text: [{ text: { content: truncate(JSON.stringify(brief.sources), 1000) } }] },
          'Generado en': { date:      { start: new Date().toISOString() } }
        }
      })
    });
  } catch (e) {
    console.error('Notion save error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const today = new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      timeZone: 'America/Bogota'
    });

    const [aiNews, contentNews, audiovisualNews] = await Promise.all([
      searchTavily('inteligencia artificial noticias tendencias semana', 4),
      searchTavily('content creation AI tools creators 2026', 4),
      searchTavily('produccion audiovisual IA herramientas tendencias', 3)
    ]);

    const allResults = [
      ...(aiNews.results || []),
      ...(contentNews.results || []),
      ...(audiovisualNews.results || [])
    ].slice(0, 10);

    const newsContext = allResults
      .map(r => `- ${r.title}: ${r.snippet || r.content?.slice(0, 150)}`)
      .join('\n');

    const recentTopics = await getRecentTrendTopics();
    const avoidBlock = recentTopics.length > 0
      ? `\nTEMAS A EVITAR (ya cubiertos recientemente):\n${recentTopics.map(t => `- ${t}`).join('\n')}\n`
      : '';

    const prompt = `Eres el estratega de contenido de AIdea, marca de IA y comunicación audiovisual de Simón Melgarejo (Colombia). Hablas a creativos y profesionales en español.

Basándote en estas noticias y tendencias (${today}):
${newsContext}
${avoidBlock}

Genera un brief ÚNICO y FRESCO. Evita exactamente los temas listados arriba.

Responde SOLO con JSON válido, sin texto extra:
{
  "frase_del_dia": "frase corta inspiradora en español",
  "tendencias": [
    {"titulo": "...", "por_que_importa": "oración", "angulo_aidea": "ángulo único"},
    {"titulo": "...", "por_que_importa": "...", "angulo_aidea": "..."},
    {"titulo": "...", "por_que_importa": "...", "angulo_aidea": "..."}
  ],
  "ideas_instagram": [
    {"hook": "máx 10 palabras", "concepto": "2 líneas", "formato": "tipo video", "cta": "CTA"},
    {"hook": "...", "concepto": "...", "formato": "...", "cta": "..."},
    {"hook": "...", "concepto": "...", "formato": "...", "cta": "..."}
  ],
  "ideas_linkedin": [
    {"titular": "título", "angulo": "tesis", "estructura": "intro/desarrollo/cierre"},
    {"titular": "...", "angulo": "...", "estructura": "..."}
  ],
  "stat_del_dia": {"dato": "estadística", "fuente": "origen", "uso": "aplicación"}
}`;

    const raw = await generateWithClaude(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON found in Claude response');

    const brief = JSON.parse(match[0]);
    brief.fecha = today;
    brief.sources = allResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      source: (() => { try { return new URL(r.url).hostname.replace('www.',''); } catch { return r.url; }})()
    }));
    brief.generado_en = new Date().toISOString();

    saveToNotion(brief).catch(e => console.error('saveToNotion failed:', e.message));

    res.status(200).json(brief);

  } catch (err) {
    console.error('brief.js error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
