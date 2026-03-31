import fetch from 'node-fetch';

export class FetchUrlTool {
  get description() {
    return {
      name: 'fetch_url',
      description: 'Fetch a web page or API endpoint and return its content. Use this after web_search to read specific pages, documentation, CVE details, exploit databases, or API responses',
      arguments: {
        url: 'string - the URL to fetch',
        format: 'string (optional) - "text" (default) or "json"',
      },
    };
  }

  async execute({ url, format }) {
    if (!url) return JSON.stringify({ error: 'No URL provided' });

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SecurityResearchBot/1.0)',
          'Accept': format === 'json' ? 'application/json' : 'text/html,text/plain,application/json',
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!response.ok) {
        return JSON.stringify({
          url,
          status: response.status,
          error: `HTTP ${response.status} ${response.statusText}`,
        });
      }

      const contentType = response.headers.get('content-type') || '';

      if (format === 'json' || contentType.includes('application/json')) {
        const data = await response.json();
        const text = JSON.stringify(data, null, 2);
        return JSON.stringify({
          url,
          format: 'json',
          content: text.substring(0, 15000),
          truncated: text.length > 15000,
        }, null, 2);
      }

      let text = await response.text();

      // Strip HTML tags for cleaner output
      if (contentType.includes('text/html')) {
        // Remove script/style blocks
        text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
        // Remove HTML tags
        text = text.replace(/<[^>]+>/g, ' ');
        // Clean whitespace
        text = text.replace(/\s+/g, ' ').trim();
        // Decode common entities
        text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
      }

      return JSON.stringify({
        url,
        format: contentType.includes('html') ? 'html-to-text' : 'text',
        content: text.substring(0, 15000),
        truncated: text.length > 15000,
        length: text.length,
      }, null, 2);
    } catch (error) {
      return JSON.stringify({ url, error: error.message });
    }
  }
}
