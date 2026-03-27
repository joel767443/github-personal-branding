const { WebSocketServer } = require("ws");

class SocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // developerId -> Set of ws clients
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      // Note: In a real app, we'd parse the session/cookie here to identify the developer.
      // For this implementation, we'll expect a 'subscribe' message with the developerId.
      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === "subscribe" && data.developerId) {
            this.subscribe(data.developerId, ws);
          }
        } catch (err) {
          console.error("WS Message Error:", err);
        }
      });

      ws.on("close", () => this.unsubscribe(ws));
    });
  }

  subscribe(developerId, ws) {
    const devId = String(developerId);
    if (!this.clients.has(devId)) {
      this.clients.set(devId, new Set());
    }
    this.clients.get(devId).add(ws);
    ws.developerId = devId;
  }

  unsubscribe(ws) {
    if (ws.developerId && this.clients.has(ws.developerId)) {
      this.clients.get(ws.developerId).delete(ws);
    }
  }

  broadcast(developerId, payload) {
    const devId = String(developerId);
    if (this.clients.has(devId)) {
      const message = JSON.stringify(payload);
      for (const client of this.clients.get(devId)) {
        if (client.readyState === 1) { // OPEN
          client.send(message);
        }
      }
    }
  }

  /**
   * Specifically for dashboard updates
   */
  notifyDashboardUpdate(developerId, type, data) {
    this.broadcast(developerId, {
      target: "dashboard",
      type, // 'stats', 'job_event', 'job_status'
      data,
      at: new Date().toISOString()
    });
  }
}

module.exports = new SocketService();
