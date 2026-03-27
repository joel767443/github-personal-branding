const ApiClient = {
  async getJson(url, opts) {
    const resp = await fetch(url, {
      credentials: "include",
      ...(opts ?? {}),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(json?.error || json?.details || `Request failed (${resp.status})`);
    return json;
  },

  async getJsonOptional(url, opts) {
    try {
      return await this.getJson(url, opts);
    } catch {
      return null;
    }
  },

  async postJson(url, body) {
    return this.getJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  },

  async patchJson(url, body) {
    return this.getJson(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
};

window.ApiClient = ApiClient;
