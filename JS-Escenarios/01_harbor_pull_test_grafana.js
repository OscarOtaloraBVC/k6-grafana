// 01_harbor_pull_test_grafana_fixed.js
// Escenario EC K8S DevOps 01 - Prueba masiva de pull de imágenes en Harbor con métricas para Grafana
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Métricas personalizadas con nombres compatibles con Prometheus
const authDuration = new Trend('auth_duration_ms');
const manifestPullDuration = new Trend('manifest_pull_duration_ms');
const authSuccessRate = new Rate('auth_success');
const manifestPullSuccessRate = new Rate('manifest_pull_success');
const totalRequests = new Counter('total_requests');

// Configuración optimizada para testing
export let options = {
  scenarios: {
    harbor_pull_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },  // Rampa gradual
        { duration: '2m', target: 10 },   // Mantener carga
        { duration: '30s', target: 5 },   // Reducir
        { duration: '1m', target: 5 },    // Mantener
        { duration: '30s', target: 0 },   // Enfriamiento
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
    'auth_duration_ms': ['p(95)<300'],
    'manifest_pull_duration_ms': ['p(95)<400'],
    'auth_success': ['rate>0.9'],
    'manifest_pull_success': ['rate>0.9']
  }
};

// Variables de entorno con valores por defecto para testing
const HARBOR_URL = __ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org/';
const USERNAME = __ENV.HARBOR_USER || 'robot$k6testing';
const PASSWORD = __ENV.HARBOR_PASS || 'xdPil4HhBmbvMPtFhpZHtOxNw9vDN0rG';
const PROJECT = __ENV.HARBOR_PROJECT || 'library';
const IMAGE = __ENV.HARBOR_IMAGE || 'hello-world';
const TAG = __ENV.HARBOR_TAG || 'latest';

// Función de autenticación mejorada
function authenticateUser() {
  totalRequests.add(1);
  
  // Harbor API v2.0 login endpoint
  const url = `${HARBOR_URL}/api/v2.0/users/current`;
  
  const params = {
    headers: {
      'Authorization': `Basic ${encoding.b64encode(`${USERNAME}:${PASSWORD}`)}`,
      'Content-Type': 'application/json',
    },
    timeout: '10s'
  };
  
  const start = Date.now();
  const res = http.get(url, params);
  const duration = Date.now() - start;
  
  authDuration.add(duration);
  
  const success = check(res, {
    'authentication successful': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
  });
  
  authSuccessRate.add(success);
  
  return success;
}

// Función para simular pull de imagen
function pullImageManifest() {
  totalRequests.add(1);
  
  // Endpoint para obtener el manifiesto de la imagen
  const manifestUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/manifests/${TAG}`;
  
  const params = {
    headers: {
      'Authorization': `Basic ${encoding.b64encode(`${USERNAME}:${PASSWORD}`)}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
    },
    timeout: '15s'
  };
  
  const start = Date.now();
  const res = http.get(manifestUrl, params);
  const duration = Date.now() - start;
  
  manifestPullDuration.add(duration);
  
  const success = check(res, {
    'manifest pull successful': (r) => r.status === 200,
    'correct content type': (r) => r.headers['Content-Type'] && 
      r.headers['Content-Type'].includes('application/vnd.docker.distribution.manifest'),
    'response time < 400ms': (r) => r.timings.duration < 400,
  });
  
  manifestPullSuccessRate.add(success);
  
  return success;
}

// Función principal
export default function () {
  group('Harbor Authentication', function () {
    const authSuccess = authenticateUser();
    
    if (!authSuccess) {
      console.log('Authentication failed, skipping manifest pull');
      return;
    }
  });
  
  group('Harbor Image Pull', function () {
    pullImageManifest();
  });
  
  // Pausa entre iteraciones
  sleep(1);
}

// Función de setup (opcional)
export function setup() {
  console.log(`Starting Harbor load test against: ${HARBOR_URL}`);
  console.log(`Project: ${PROJECT}, Image: ${IMAGE}:${TAG}`);
}

// Función de teardown (opcional)
export function teardown(data) {
  console.log('Harbor load test completed');
}