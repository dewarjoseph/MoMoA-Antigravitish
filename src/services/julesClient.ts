export class JulesHttpError extends Error {
  public url: string;
  public status: number;
  public statusText: string;
  public responseBody: any;

  constructor(url: string, status: number, statusText: string, responseBody: any) {
    let msg = `[Jules REST] HTTP ${status} ${statusText} at ${url}`;
    if (responseBody && responseBody.error) {
      msg += `\\n  -> Details: ${JSON.stringify(responseBody.error)}`;
    } else if (responseBody) {
      msg += `\\n  -> Body: ${JSON.stringify(responseBody)}`;
    }
    super(msg);
    this.name = 'JulesHttpError';
    this.url = url;
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
  }
}

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

  private async executeFetch(url: string, options: RequestInit): Promise<any> {
    const res = await fetch(url, options);
    
    if (!res.ok) {
      let errorBody: any;
      try {
        // Specifically trap JSON schema errors generated natively by Google REST engines 
        // to avoid "hallucinating" basic success or generic failure.
        errorBody = await res.json();
      } catch (e) {
         try {
             errorBody = await res.text();
         } catch {
             errorBody = "[Unparseable Payload]";
         }
      }
      throw new JulesHttpError(url, res.status, res.statusText, errorBody);
    }
    
    // Some successful posts might return empty bodies; gracefully handle `json()` fails
    try {
        return await res.json();
    } catch {
        return {};
    }
  }

  async listSources(pageSize: number = 30, filter?: string) {
    let url = `${this.baseUrl}/sources?pageSize=${pageSize}`;
    if (filter) url += `&filter=${encodeURIComponent(filter)}`;
    return this.executeFetch(url, { headers: this.headers });
  }

  async createSession(prompt: string, sourceContext: any, title?: string, requirePlanApproval?: boolean) {
    const body: any = { prompt, sourceContext };
    if (title) body.title = title;
    if (requirePlanApproval !== undefined) body.requirePlanApproval = requirePlanApproval;

    return this.executeFetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
  }

  async getSession(sessionId: string) {
    const id = sessionId.replace(/^sessions\//, '');
    return this.executeFetch(`${this.baseUrl}/sessions/${id}`, { headers: this.headers });
  }

  async listActivities(sessionId: string, pageSize: number = 50) {
    const id = sessionId.replace(/^sessions\//, '');
    return this.executeFetch(`${this.baseUrl}/sessions/${id}/activities?pageSize=${pageSize}`, { headers: this.headers });
  }

  async approvePlan(sessionId: string) {
    const id = sessionId.replace(/^sessions\//, '');
    return this.executeFetch(`${this.baseUrl}/sessions/${id}:approvePlan`, {
      method: 'POST',
      headers: this.headers,
      body: '{}',
    });
  }

  async sendMessage(sessionId: string, prompt: string) {
    const id = sessionId.replace(/^sessions\//, '');
    return this.executeFetch(`${this.baseUrl}/sessions/${id}:sendMessage`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ prompt }),
    });
  }
}
