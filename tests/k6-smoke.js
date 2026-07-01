import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.01'],   // Error rate must be less than 1%
  },
};

export default function () {
  // Pull staging API target from environment variable passed by CI
  const baseUrl = __ENV.STAGING_API_URL || 'http://localhost:3001';

  // 1. Test NestJS health endpoint
  const healthRes = http.get(`${baseUrl}/health`);
  check(healthRes, {
    'health status is 200': (r) => r.status === 200,
  });

  // 2. Test chat message pipeline
  const chatPayload = JSON.stringify({
    message: 'Smoke test probe message',
  });
  const chatParams = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  const chatRes = http.post(`${baseUrl}/api/v1/chat`, chatPayload, chatParams);
  check(chatRes, {
    'chat status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  sleep(0.5);
}
