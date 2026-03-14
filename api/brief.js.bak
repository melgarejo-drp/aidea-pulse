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
      model: 'claude-haiku-4-5',
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function saveToNotion(brief) {
  if (!NOTION_KEY) return;
  try {
    const truncate = (str, n) => str && str.length > n ? str.slice(0, n) : (str || '');
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
  } catch(e) {
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

    const prompt = `Eres el estratega de contenido de AIdea, una marca personal de comunicación audiovisual e inteligencia artificial dirigida por Simón Melgarejo (Colombia). La marca habla a creativos, profesionales y entusiastas de IA en español.

Basándote en estas noticias y tendencias de hoy (${today}):
${newsContext}

Genera un brief de contenido. Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, sin bloques de código, sin comentarios, sin explicaciones. Solo el JSON puro.

Formato exacto:
{
  "fecha": "${today}",
  "tendencias": [
    { "titulo": "...", "por_que_importa": "1 oración directa", "angulo_aidea": "cómo conecta con la audiencia de Simón" },
    { "titulo": "...", "por_que_importa": "...", "angulo_aidea": "..." },
    { "titulo": "...", "por_que_importa": "...", "angulo_aidea": "..." }
  ],
  "ideas_instagram": [
    { "hook": "frase de apertura máx 10 palabras", "concepto": "de qué va el reel en 2 líneas", "formato": "tipo de video", "cta": "llamado a la acción" },
    { "hook": "...", "concepto": "...", "formato": "...", "cta": "..." },
    { "hook": "...", "concepto": "...", "formato": "...", "cta": "..." }
  ],
  "ideas_linkedin": [
    { "titular": "título del post", "angulo": "perspectiva o tesis", "estructura": "intro / desarrollo / cierre en 1 línea cada uno" },
    { "titular": "...", "angulo": "...", "estructura": "..." }
  ],
  "stat_del_dia": { "dato": "estadística relevante", "fuente": "origen", "uso": "cómo usarlo en contenido" },
  "frase_del_dia": "frase corta inspiradora sobre IA o creatividad en español"
}

Reglas: todo en español, tono profesional pero cercano, enfocado en IA aplicada a creatividad y producción audiovisual.`;

    const raw = await generateWithClaude(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON');
    const brief = JSON.parse(jsonMatch[0]);

    brief.sources = allResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      source: (() => { try { return new URL(r.url).hostname.replace('www.',''); } catch { return r.url; }})()
    }));
    brief.generado_en = new Date().toISOString();

    // Save to Notion async (non-blocking)
    saveToNotion(brief).catch(console.error);

    res.status(200).json(brief);

  } catch (err) {
    console.error('Brief error:', err);
    res.status(500).json({ error: err.message });
  }
}
