const SocketManager = {
  ws: null,
  handlers: new Set(),

  init(developerId) {
    if (this.ws) this.ws.close();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.ws.onopen = () => {
      console.log("Connected to live updates");
      this.ws.send(JSON.stringify({ type: "subscribe", developerId }));
    };

    this.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handlers.forEach(handler => handler(payload));
      } catch (err) {
        console.error("WS Parse Error:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("Live updates disconnected. Retrying in 5s...");
      setTimeout(() => this.init(developerId), 5000);
    };
  },

  addHandler(fn) {
    this.handlers.add(fn);
  },

  removeHandler(fn) {
    this.handlers.delete(fn);
  }
};

window.SocketManager = SocketManager;
