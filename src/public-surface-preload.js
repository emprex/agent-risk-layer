import http from 'node:http';
import { config } from './config.js';

const originalCreateServer = http.createServer;

const redirects = new Map([
  ['/admin.html', '/'],
  ['/sales-agent.html', '/'],
  ['/dashboard.html', '/'],
  ['/auth.html', '/'],
  ['/reset.html', '/'],
  ['/verify.html', '/'],
  ['/workspaces.html', '/'],
  ['/control-plane.html', '/'],
  ['/control-intelligence.html', '/trust.html'],
  ['/control-intelligence-control.html', '/trust.html'],
  ['/control-intelligence-report.html', '/sample-report.html'],
  ['/inspection-detail.html', '/ai-agent-security-assessment.html'],
  ['/inspector.html', '/ai-agent-security-assessment.html'],
  ['/redteam.html', '/ai-agent-security-assessment.html'],
  ['/redteam-run.html', '/ai-agent-security-assessment.html'],
  ['/runtime.html', '/ai-agent-security-assessment.html'],
  ['/assessment.html', '/ai-agent-security-assessment.html'],
  ['/result.html', '/sample-report.html'],
  ['/risk-library.html', '/trust.html'],
  ['/risk-library-detail.html', '/trust.html'],
  ['/risk-profiler.html', '/trust.html'],
  ['/risk-readiness.html', '/trust.html'],
  ['/shared.html', '/'],
  ['/status.html', '/trust.html'],
  ['/demo.html', '/ai-agent-security-assessment.html'],
  ['/success.html', '/request-assessment.html'],
  ['/help.html', '/'],
  ['/arl17k.html', '/trust.html'],
  ['/methodology.html', '/trust.html'],
  ['/standards.html', '/trust.html'],
  ['/security-center.html', '/trust.html'],
  ['/quickstart.html', '/ai-agent-security-assessment.html'],
  ['/compare.html', '/ai-agent-security-assessment.html'],
  ['/start.html', '/request-assessment.html'],
  ['/privacy.html', '/legal/privacy.html'],
  ['/terms.html', '/legal/terms.html'],
]);

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = typeof args[0] === 'function' ? 0 : (typeof args[1] === 'function' ? 1 : -1);
  if (listenerIndex >= 0) {
    const originalListener = args[listenerIndex];
    args[listenerIndex] = function publicSurfaceRouter(req, res) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        try {
          const pathname = new URL(req.url || '/', config.baseUrl).pathname;
          const target = redirects.get(pathname);
          if (target) {
            res.writeHead(301, {
              Location: target,
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
            });
            return res.end();
          }
        } catch {
          // Fall through to the application server.
        }
      }
      return originalListener.call(this, req, res);
    };
  }
  return originalCreateServer.apply(this, args);
};
