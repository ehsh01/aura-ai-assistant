import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 5008;
const sessionCookie = "pwa-session";

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/api/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const hasSession = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .includes(`recall_session=${sessionCookie}`);
    if (!hasSession) {
      sendJson(response, 401, { error: "UNAUTHORIZED" });
      return;
    }
    sendJson(response, 200, {
      user: {
        id: "pwa-user",
        email: "pwa@example.com",
        name: "PWA User",
        isAdmin: false,
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login-form") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      if (
        form.get("email") !== "pwa@example.com" ||
        form.get("password") !== "correct-password"
      ) {
        sendJson(response, 401, { error: "INVALID_CREDENTIALS" });
        return;
      }
      response.writeHead(303, {
        location: "http://127.0.0.1:4173/today",
        "set-cookie": `recall_session=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax`,
      });
      response.end();
    });
    return;
  }

  sendJson(response, 404, { error: "NOT_FOUND" });
});

server.listen(port, host);

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
