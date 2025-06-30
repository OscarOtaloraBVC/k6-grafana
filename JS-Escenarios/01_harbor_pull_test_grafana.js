// Escenario EC K8S DevOps 01 - Prueba masiva de pull de imágenes en Harbor con métricas para Grafana
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Métricas personalizadas
const authDuration = new Trend('auth_duration');
const manifestPullDuration = new Trend('manifest_pull_duration');
const authSuccessRate = new Rate('auth_success');
const manifestPullSuccessRate = new Rate('manifest_pull_success');
const totalRequests = new Counter('total_requests');

// Configuración
export let options = {
  stages: [
    { duration: '1m', target: 50 },  // Rampa a 50 peticiones/segundo
    { duration: '2m', target: 50 },  // Mantener 50 peticiones/segundo
    { duration: '1m', target: 25 },  // Reducir a 25 peticiones/segundo
    { duration: '2m', target: 25 },  // Mantener 25 peticiones/segundo
    { duration: '1m', target: 15 },  // Reducir a 15 peticiones/segundo
    { duration: '2m', target: 15 },  // Mantener 15 peticiones/segundo
    { duration: '1m', target: 10 },  // Reducir a 10 peticiones/segundo
    { duration: '2m', target: 10 },  // Mantener 10 peticiones/segundo
    { duration: '1m', target: 0 },   // Enfriamiento
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% de las peticiones deben responder en menos de 500ms
    http_req_failed: ['rate<0.1'],    // Tasa de error menor al 10%
    'auth_duration': ['p(95)<300'],   // Duración de autenticación
    'manifest_pull_duration': ['p(95)<400'], // Duración de pull de manifiesto
    'auth_success': ['rate>0.9'],     // Tasa de éxito de autenticación
    'manifest_pull_success': ['rate>0.9'] // Tasa de éxito de pull
  },
  ext: {
    loadimpact: {
      projectID: 12345, // Configurar tu ID de proyecto si usas LoadImpact
      name: 'Harbor Image Pull Test'
    }
  }
};

// Variables de entorno
const HARBOR_URL = __ENV.HARBOR_URL || 'https://harbor.example.com';
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'password';
const PROJECT = __ENV.HARBOR_PROJECT || 'library';
const IMAGE = __ENV.HARBOR_IMAGE || 'nginx';
const TAG = __ENV.HARBOR_TAG || 'latest';

// Autenticación en Harbor
function getAuthToken() {
  totalRequests.add(1);
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: USERNAME,
    password: PASSWORD
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '30s'
  };
  
  const start = Date.now();
  const res = http.post(url, payload, params);
  const end = Date.now();
  
  const authSuccess = res.status === 200;
  authDuration.add(end - start);
  authSuccessRate.add(authSuccess);
  
  check(res, {
    'login successful': (r) => authSuccess,
  });
  
  if (authSuccess) {
    return res.json().token;
  }
  return null;
}

// Función principal
export default function () {
  group('Harbor Image Pull Test', function () {
    // Paso 1: Autenticación
    let token;
    group('Authentication', function() {
      token = getAuthToken();
      if (!token) {
        return;
      }
    });

    if (!token) {
      return;
    }

    // Paso 2: Pull de manifiesto
    group('Pull Image Manifest', function() {
      totalRequests.add(1);
      const manifestUrl = `${HARBOR_URL}/v2/${PROJECT}/${IMAGE}/manifests/${TAG}`;
      
      const params = {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
        },
        timeout: '30s'
      };
      
      const start = Date.now();
      const res = http.get(manifestUrl, params);
      const end = Date.now();
      
      const pullSuccess = res.status === 200;
      manifestPullDuration.add(end - start);
      manifestPullSuccessRate.add(pullSuccess);
      
      check(res, {
        'pull manifest success': (r) => pullSuccess,
        'correct content type': (r) => r.headers['Content-Type'] === 'application/vnd.docker.distribution.manifest.v2+json'
      });
    });
    
    sleep(1);
  });
}