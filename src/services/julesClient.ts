export class JulesClient {
  private readonly baseUrl = 'https://jules.googleapis.com/v1alpha';

  private get headers() {
    const apiKey = process.env.JULES_API_KEY;
    if (!apiKey) {
      throw new Error('JULES_API_KEY is not defined in environment variables.');
    }
    return {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    };
  }

  async listSources(pageSize: number = 30, filter?: string) {
    let url = `${this.baseUrl}/sources?pageSize=${pageSize}`;
    if (filter) {
      url += `&filter=${encodeURIComponent(filter)}`;
    }
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new Error(`[JulesClient] listSources failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }

  async createSession(prompt: string, sourceContext: any, title?: string, requirePlanApproval?: boolean) {
    const body: any = { prompt, sourceContext };
    if (title) body.title = title;
    if (requirePlanApproval !== undefined) body.requirePlanApproval = requirePlanApproval;

    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`[JulesClient] createSession failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }

  async getSession(sessionId: string) {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}`, { headers: this.headers });
    if (!res.ok) throw new Error(`[JulesClient] getSession failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }

  async listActivities(sessionId: string, pageSize: number = 50) {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/activities?pageSize=${pageSize}`, { headers: this.headers });
    if (!res.ok) throw new Error(`[JulesClient] listActivities failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }

  async approvePlan(sessionId: string) {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}:approvePlan`, {
      method: 'POST',
      headers: this.headers,
      body: '{}',
    });
    if (!res.ok) throw new Error(`[JulesClient] approvePlan failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }

  async sendMessage(sessionId: string, prompt: string) {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}:sendMessage`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error(`[JulesClient] sendMessage failed: ${res.statusText} ${await res.text()}`);
    return res.json();
  }
}
