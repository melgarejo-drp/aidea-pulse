// AIdea Pulse — API serverless
// Busca tendencias con Tavily + genera ideas con Claude

const TAVILY_KEY   = process.env.TAVILY_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

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
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
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

    // Búsquedas paralelas
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

    // Generar ideas con Claude
    const prompt = `Eres el estratega de contenido de AIdea, una marca personal de comunicación audiovisual e inteligencia artificial dirigida por Simón Melgarejo (Colombia). La marca habla a creativos, profesionales y entusiastas de IA en español.

Basándote en estas noticias y tendencias de hoy (${today}):
${newsContext}

Genera un brief de contenido con este formato JSON exacto (sin texto extra):
{
  "fecha": "${today}",
  "tendencias": [
    { "titulo": "...", "por_que_importa": "1 oración. Directo.", "angulo_aidea": "cómo conecta con la audiencia de Simón" }
  ],
  "ideas_instagram": [
    { "hook": "frase de apertura del reel (máx 10 palabras, que pare el scroll)", "concepto": "de qué va el reel en 2 líneas", "formato": "tipo de video", "cta": "llamado a la acción" }
  ],
  "ideas_linkedin": [
    { "titular": "título del post", "angulo": "perspectiva o tesis del post", "estructura": "intro / desarrollo / cierre en 1 línea cada uno" }
  ],
  "stat_del_dia": { "dato": "estadística o dato relevante", "fuente": "origen", "uso": "cómo usarlo en contenido" },
  "frase_del_dia": "frase corta e inspiradora sobre IA o creatividad, en español"
}

Reglas:
- 3 tendencias, 3 ideas Instagram, 2 ideas LinkedIn
- Tono: profesional pero cercano, nunca corporativo
- Todo en español
- Enfocado en IA aplicada a creatividad y producción audiovisual`;

    const raw = await generateWithClaude(prompt);
    
    // Limpiar JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in Claude response');
    const brief = JSON.parse(jsonMatch[0]);

    // Agregar metadata
    brief.sources = allResults.slice(0, 5).map(r => ({
      title: r.title,
      url: r.url,
      source: new URL(r.url).hostname.replace('www.', '')
    }));
    brief.generado_en = new Date().toISOString();

    res.status(200).json(brief);

  } catch (err) {
    console.error('Brief generation error:', err);
    res.status(500).json({ error: err.message, stack: err.stack?.split('\n')[0] });
  }
}
