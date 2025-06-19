// test-harbor-with-metrics.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
const successfulPushes = new Counter('harbor_successful_pushes_total');
const failedPushes = new Counter('harbor_failed_pushes_total');
const pushDuration = new Trend('harbor_push_duration_ms');
const successRate = new Rate('harbor_success_rate');

// Configuration
const HARBOR_BASE_URL = __ENV.HARBOR_URL || 'http://harbor-service';
const PROJECT_API_URL = `${HARBOR_BASE_URL}/api/v2.0/projects`;
const TEST_ID = __ENV.TEST_ID || `test-${Date.now()}`;
const ADMIN_USER = __ENV.HARBOR_USER || 'admin';
const ADMIN_PASSWORD = __ENV.HARBOR_PASSWORD || 'Harbor12345';

export const options = {
  scenarios: {
    constant_load: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    'harbor_success_rate': ['rate>0.95'],
    'harbor_push_duration_ms{testid:"' + TEST_ID + '",p(95)}': ['p(95)<500'],
  },
  tags: {
    testid: TEST_ID,
  },
  ext: {
    loadimpact: {
      name: 'Harbor API Performance Test',
    },
  },
};

// Helper function to get authentication token
function getAuthToken() {
  const authUrl = `${HARBOR_BASE_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: ADMIN_USER,
    password: ADMIN_PASSWORD
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { testid: TEST_ID },
  };
  
  const res = http.post(authUrl, payload, params);
  
  if (res.status === 200) {
    return res.json().token;
  }
  return null;
}

// Main test function
function testProjectCreation(token) {
  const start = Date.now();
  const projectName = `test-project-${__VU}-${__ITER}-${TEST_ID}`;
  
  const payload = JSON.stringify({
    project_name: projectName,
    metadata: {
      public: 'false',
      auto_scan: 'true',
    }
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    tags: { testid: TEST_ID },
  };
  
  const res = http.post(PROJECT_API_URL, payload, params);
  const duration = Date.now() - start;
  
  // Record metrics
  pushDuration.add(duration, { testid: TEST_ID });
  
  if (res.status === 201) {
    successfulPushes.add(1, { testid: TEST_ID });
    successRate.add(1, { testid: TEST_ID });
  } else {
    failedPushes.add(1, { testid: TEST_ID });
    successRate.add(0, { testid: TEST_ID });
    console.error(`Failed to create project: ${res.status} ${res.body}`);
  }
  
  // Validate response
  check(res, {
    'project created successfully': (r) => r.status === 201,
    'response time within limit': (r) => r.timings.duration < 1000,
  });
  
  return duration;
}

export function setup() {
  // Get auth token before test starts
  const token = getAuthToken();
  if (!token) {
    throw new Error('Failed to authenticate with Harbor API');
  }
  return token;
}

export default function (token) {
  testProjectCreation(token);
  sleep(0.5);
}

export function teardown(token) {
  // Cleanup: Delete test projects (optional)
  if (__ENV.CLEANUP === 'true') {
    const listRes = http.get(PROJECT_API_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (listRes.status === 200) {
      const projects = listRes.json();
      projects.forEach(project => {
        if (project.name.includes(TEST_ID)) {
          const deleteRes = http.del(`${PROJECT_API_URL}/${project.project_id}`, null, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          check(deleteRes, {
            'project deleted successfully': (r) => r.status === 200,
          });
        }
      });
    }
  }
}