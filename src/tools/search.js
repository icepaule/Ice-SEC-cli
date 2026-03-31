import fetch from 'node-fetch';

export class WebSearchTool {
  constructor(searxngUrl) {
    this.searxngUrl = (searxngUrl || 'http://localhost:8888').replace(/\/+$/, '');
  }

  get description() {
    return {
      name: 'web_search',
      description: 'Search the internet for security information, CVEs, exploits, documentation',
      arguments: { query: 'string - the search query' },
    };
  }

  async execute({ query }) {
    if (!query) return JSON.stringify({ error: 'No query provided' });

    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        categories: 'general,it,science',
        language: 'all',
      });

      const response = await fetch(`${this.searxngUrl}/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`SearXNG returned ${response.status}`);
      }

      const data = await response.json();
      const results = (data.results || []).slice(0, 8).map((r) => ({
        title: r.title,
        url: r.url,
        content: (r.content || '').substring(0, 300),
        engine: r.engine,
      }));

      return JSON.stringify({
        query,
        results_count: data.results?.length || 0,
        results,
        infoboxes: (data.infoboxes || []).slice(0, 2).map((i) => ({
          title: i.infobox,
          content: (i.content || '').substring(0, 500),
        })),
      }, null, 2);
    } catch (error) {
      // Fallback: try DuckDuckGo instant answer API
      try {
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const ddgResp = await fetch(ddgUrl, { signal: AbortSignal.timeout(10000) });
        const ddgData = await ddgResp.json();

        const results = [];
        if (ddgData.Abstract) {
          results.push({ title: ddgData.Heading, content: ddgData.Abstract, url: ddgData.AbstractURL });
        }
        for (const topic of (ddgData.RelatedTopics || []).slice(0, 5)) {
          if (topic.Text) {
            results.push({ title: topic.Text?.substring(0, 80), content: topic.Text, url: topic.FirstURL });
          }
        }

        return JSON.stringify({
          query,
          source: 'duckduckgo-fallback',
          note: `SearXNG unavailable (${error.message}), using DuckDuckGo instant answers`,
          results,
        }, null, 2);
      } catch (ddgError) {
        return JSON.stringify({
          error: `Search failed: ${error.message}. DDG fallback also failed: ${ddgError.message}`,
          suggestion: 'Ensure SearXNG is running: docker compose up -d searxng',
        });
      }
    }
  }
}
