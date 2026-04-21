import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false }));

const RELAYER_API_URL = (process.env.VITE_RELAYER_API_URL || process.env.RELAYER_API_URL || "https://sequencerp-sol.replit.app/api").replace(/\/$/, "");


export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });

  next();
});

// Function to kill processes using the port
async function killPortProcess(port: number) {
  try {
    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pids = stdout.trim().split('\n').filter(Boolean);

    if (pids.length > 0) {
      log(`Found ${pids.length} process(es) using port ${port}, killing them...`);
      for (const pid of pids) {
        try {
          await execAsync(`kill -9 ${pid}`);
          log(`Killed process ${pid}`);
        } catch (err) {
          // Process might already be dead
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    // No process found on port, which is fine
  }
}

// Graceful shutdown handler
function setupGracefulShutdown() {
  const shutdown = () => {
    log("Shutting down gracefully...");
    httpServer.close(() => {
      log("Server closed");
      process.exit(0);
    });

    setTimeout(() => {
      log("Forcing shutdown...");
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

(async () => {
  try {
    await registerRoutes(httpServer, app);

    // Proxy remaining /api/* requests to the relayer
    // This must come AFTER registerRoutes so local routes take precedence
    app.all("/api/*", async (req, res) => {
      try {
        const upstreamPath = req.originalUrl.replace(/^\/api/, "");
        const url = RELAYER_API_URL + upstreamPath;

        const headers = { ...req.headers };
        delete headers.host;

        const method = String(req.method || "GET").toUpperCase();
        const body =
          method === "GET" || method === "HEAD" ? undefined : JSON.stringify(req.body ?? {});

        const upstream = await fetch(url, {
          method,
          headers: {
            ...headers,
            "content-type": "application/json",
            "accept": "application/json",
          },
          body,
        });

        const buf = Buffer.from(await upstream.arrayBuffer());
        res.status(upstream.status);

        upstream.headers.forEach((v, k) => {
          if (k.toLowerCase() === "transfer-encoding") return;
          res.setHeader(k, v);
        });

        return res.send(buf);
      } catch (e) {
        return res.status(502).json({
          success: false,
          error: String(e && e.message ? e.message : e),
        });
      }
    });

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      throw err;
    });

    if (process.env.NODE_ENV === "production") {
      serveStatic(app);
    } else {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    }

    const port = parseInt(process.env.PORT || "5000", 10);

    log(`Checking port ${port}...`);
    await killPortProcess(port);

    setupGracefulShutdown();

    httpServer.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`serving on port ${port}`);
      },
    );

    httpServer.on('error', (error: any) => {
      if (error.code === 'EADDRINUSE') {
        log(`Port ${port} is still in use. Retrying in 2 seconds...`);
        setTimeout(async () => {
          await killPortProcess(port);
          httpServer.listen(port, '0.0.0.0');
        }, 2000);
      } else {
        log(`Server error: ${error.message}`);
        process.exit(1);
      }
    });

  } catch (error: any) {
    log(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
})();