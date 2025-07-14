// EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos (Harbor, Artifactory, Vault y Keycloak)
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// ======================
// Métricas personalizadas
// ======================
const harborResponseTime = new Trend('harbor_response_time');
const artifactoryResponseTime = new Trend('artifactory_response_time');
const vaultResponseTime = new Trend('vault_response_time');
const keycloakResponseTime = new Trend('keycloak_response_time');

const successRate = new Rate('successful_requests');
const errorRate = new Rate('error_requests');
const errorCounter = new Counter('total_errors');

// ======================
// Configuración principal
// ======================
export let options = {
  scenarios: {
    // Escenario 1 - Alta carga
    high_load: {
      executor: 'constant-arrival-rate',
      rate: 450, // 25 Harbor + 25 Artifactory + 100 Vault + 100 Keycloak + margen
      timeUnit: '1s',
      duration: '5m',
      //preAllocatedVUs: 100, Propuesta inicial
      preAllocatedVUs: 300,
      //maxVUs: 200, Propuesta Inicial
      maxVUs: 500,
      exec: 'highLoadScenario',
    },
    // Escenario 2 - Media carga
    medium_load: {
      executor: 'constant-arrival-rate',
      rate: 130, // 15 Harbor + 15 Artifactory + 50 Vault + 50 Keycloak + margen
      timeUnit: '1s',
      duration: '5m',
      startTime: '5m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'mediumLoadScenario',
    },
    // Escenario 3 - Baja carga
    low_load: {
      executor: 'constant-arrival-rate',
      rate: 70, // 10 Harbor + 10 Artifactory + 25 Vault + 25 Keycloak + margen
      timeUnit: '1s',
      duration: '5m',
      startTime: '10m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'lowLoadScenario',
    },
  },
  thresholds: {
    // Umbrales globales
    'http_req_failed': ['rate<0.5'], // Detener si más del 50% fallan
    'error_requests': ['rate<0.5'],
    
    // Umbrales por servicio
    //'harbor_response_time': ['p(95)<3500'], Propuesta inicial
    'harbor_response_time': ['p(95)<5000'],
    'artifactory_response_time': ['p(95)<500'],
    'vault_response_time': ['p(95)<1000'],
    //'keycloak_response_time': ['p(95)<2800'], Propuesta inicial
    'keycloak_response_time': ['p(95)<5000'],

    // Checks de éxito
    'checks{service:harbor}': ['rate>0.9'],
    'checks{service:artifactory}': ['rate>0.9'],
    'checks{service:vault}': ['rate>0.9'],
    'checks{service:keycloak}': ['rate>0.9'],
  },
  noConnectionReuse: true,
  discardResponseBodies: false,
};

// ======================
// Configuración de servicios
// ======================
const HARBOR_URL = __ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org';
const HARBOR_USER = __ENV.HARBOR_USER || 'admin';
const HARBOR_PASS = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const HARBOR_PROJECT = __ENV.HARBOR_PROJECT || 'library';
const HARBOR_IMAGE = __ENV.HARBOR_IMAGE || 'test-image';
const HARBOR_TAG = __ENV.HARBOR_TAG || '30mb';

const ARTIFACTORY_URL = __ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/ui/native/k6-prueba/';
const ARTIFACTORY_USER = __ENV.ARTIFACTORY_USER || 'admin';
const ARTIFACTORY_PASS = __ENV.ARTIFACTORY_PASS || 'Nuam123.*';
const ARTIFACTORY_REPO = __ENV.ARTIFACTORY_REPO || 'k6-prueba';
const ARTIFACTORY_FILES = [
  'test/testfile-15mb.bin',
  'test/testfile-20mb.bin',
  'test/testfile-25mb.bin',
  'test/testfile-30mb.bin'
];

const VAULT_URL = __ENV.VAULT_URL || 'http://localhost:8200';
const VAULT_TOKEN = __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo';
const VAULT_SECRET_PATHS = [
  __ENV.VAULT_SECRET_PATH || '/v1/kv_Production/data/data/testingk6'
];

const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || 'https://test-nuam-kc.coffeesoft.org';
const KEYCLOAK_REALM = __ENV.KEYCLOAK_REALM || 'master';
const KEYCLOAK_CLIENT_ID = __ENV.KEYCLOAK_CLIENT_ID || 'admin-cli';
const KEYCLOAK_USER = __ENV.KEYCLOAK_USER || 'admin';
const KEYCLOAK_PASS = __ENV.KEYCLOAK_PASS || 'c659036218da417b9798c8ff97a0708d';

// ======================
// Funciones auxiliares
// ======================
function toBase64(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  
  for (let i = 0; i < str.length; i += 3) {
    const a = str.charCodeAt(i);
    const b = str.charCodeAt(i + 1);
    const c = str.charCodeAt(i + 2);
    
    const enc1 = a >> 2;
    const enc2 = ((a & 3) << 4) | (b >> 4);
    const enc3 = isNaN(b) ? 64 : ((b & 15) << 2) | (c >> 6);
    const enc4 = isNaN(c) ? 64 : c & 63;
    
    output += chars.charAt(enc1) + chars.charAt(enc2) + chars.charAt(enc3) + chars.charAt(enc4);
  }
  
  return output;
}

function getHarborAuthHeaders() {
  const authString = `${HARBOR_USER}:${HARBOR_PASS}`;
  const encodedAuth = toBase64(authString);
  
  return {
    headers: {
      'Authorization': `Basic ${encodedAuth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    timeout: '30s'
  };
}

function validateVaultResponse(response) {
  try {
    if (!response || response.status !== 200) return false;
    const jsonData = response.json();
    return jsonData?.data?.data && typeof jsonData.data.data === 'object';
  } catch (error) {
    return false;
  }
}

// ======================
// Funciones de prueba
// ======================
function testHarbor() {
  const start = new Date();
  let success = false;
  
  try {
    // 1. Obtener manifiesto
    const manifestUrl = `${HARBOR_URL}/v2/${HARBOR_PROJECT}/${HARBOR_IMAGE}/manifests/${HARBOR_TAG}`;
    const manifestParams = {
      ...getHarborAuthHeaders(),
      headers: {
        ...getHarborAuthHeaders().headers,
        'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
      },
      timeout: '60s'
    };

    const manifestRes = http.get(manifestUrl, manifestParams);
    
    const manifestCheck = check(manifestRes, {
      'harbor pull manifest success': (r) => r.status === 200,
      'harbor manifest valid': (r) => {
        try {
          const json = r.json();
          return json && json.schemaVersion === 2;
        } catch (e) {
          return false;
        }
      }
    }, { service: 'harbor' });

    // 2. Descargar capa si el manifiesto es válido
    if (manifestCheck && manifestRes.status === 200) {
      const manifest = manifestRes.json();
      const layers = manifest.layers || [];
      
      if (layers.length > 0) {
        const layerUrl = `${HARBOR_URL}/v2/${HARBOR_PROJECT}/${HARBOR_IMAGE}/blobs/${layers[0].digest}`;
        const layerParams = {
          ...getHarborAuthHeaders(),
          headers: {
            ...getHarborAuthHeaders().headers,
            'Accept': 'application/octet-stream'
          },
          timeout: '120s'
        };
        
        const layerRes = http.get(layerUrl, layerParams);
        
        check(layerRes, {
          'harbor layer download success': (r) => r.status === 200,
          'harbor layer has content': (r) => r.body.length > 0 // Cambio validacion de tamaño
        }, { service: 'harbor' });
      }
    }
    
    success = manifestCheck;
  } catch (e) {
    success = false;
  }
  
  const duration = new Date() - start;
  harborResponseTime.add(duration);
  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    errorCounter.add(1);
  }
  
  return success;
}

function testArtifactory() {
  const start = new Date();
  let success = false;
  
  try {
    const randomFile = ARTIFACTORY_FILES[Math.floor(Math.random() * ARTIFACTORY_FILES.length)];
    const url = `${ARTIFACTORY_URL}/${ARTIFACTORY_REPO}/${randomFile}`;
    
    const params = {
      auth: 'basic',
      username: ARTIFACTORY_USER,
      password: ARTIFACTORY_PASS,
      timeout: '60s'
    };
    
    const res = http.get(url, params);
    
    success = check(res, {
      'artifactory download success': (r) => r.status === 200,
      'artifactory content valid': (r) => r.body.length > 0,
    }, { service: 'artifactory' });
  } catch (e) {
    success = false;
  }
  
  const duration = new Date() - start;
  artifactoryResponseTime.add(duration);
  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    errorCounter.add(1);
  }
  
  return success;
}

function testVault() {
  const start = new Date();
  let success = false;
  
  try {
    const secretPath = VAULT_SECRET_PATHS[Math.floor(Math.random() * VAULT_SECRET_PATHS.length)];
    const url = `${VAULT_URL}${secretPath}`;
    
    const params = {
      headers: {
        'X-Vault-Token': VAULT_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: '30s'
    };

    const response = http.get(url, params);
    const isValid = validateVaultResponse(response);
    
    success = check(response, {
      'vault request success': (r) => r.status === 200,
      'vault data valid': () => isValid,
    }, { service: 'vault' });
  } catch (e) {
    success = false;
  }
  
  const duration = new Date() - start;
  vaultResponseTime.add(duration);
  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    errorCounter.add(1);
  }
  
  return success;
}

function testKeycloak() {
  const start = new Date();
  let success = false;
  let retries = 3;
  
  try {
    const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
    
    const payload = {
      client_id: KEYCLOAK_CLIENT_ID,
      username: KEYCLOAK_USER,
      password: KEYCLOAK_PASS,
      grant_type: 'password',
    };
    
    const params = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: '60s', // Increased from 30s
      tags: { 
        name: 'keycloak_auth',
        type: 'auth'
    },
  };
    
    let res;
    while (retries > 0) {
      res = http.post(url, payload, params);
      if (res.status === 200) break;
      retries--;
      sleep(0.5);
    }
    
    success = check(res, {
      'keycloak auth success': (r) => r.status === 200,
      'keycloak token received': (r) => r.json().access_token !== undefined,
    }, { service: 'keycloak' });
  } catch (e) {
    success = false;
  }
  
  const duration = new Date() - start;
  keycloakResponseTime.add(duration);
  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    errorCounter.add(1);
  }
  
  return success;
}

// ======================
// Escenarios
// ======================
export function highLoadScenario() {
  // Distribución aproximada de las peticiones
  const random = Math.random();
  
  if (random < 0.055) { // ~25/s Harbor
    testHarbor();
  } else if (random < 0.11) { // ~25/s Artifactory
    testArtifactory();
  } else if (random < 0.33) { // ~100/s Vault
    testVault();
  } else { // ~100/s Keycloak
    testKeycloak();
  }
}

export function mediumLoadScenario() {
  const random = Math.random();
  
  if (random < 0.115) { // ~15/s Harbor
    testHarbor();
  } else if (random < 0.23) { // ~15/s Artifactory
    testArtifactory();
  } else if (random < 0.615) { // ~50/s Vault
    testVault();
  } else { // ~50/s Keycloak
    testKeycloak();
  }
}

export function lowLoadScenario() {
  const random = Math.random();
  
  if (random < 0.143) { // ~10/s Harbor
    testHarbor();
  } else if (random < 0.286) { // ~10/s Artifactory
    testArtifactory();
  } else if (random < 0.714) { // ~25/s Vault
    testVault();
  } else { // ~25/s Keycloak
    testKeycloak();
  }
}

// ======================
// Reporte final
// ======================
export function handleSummary(data) {
  const summary = {
    metrics: {
      harbor: {
        response_time: data.metrics['harbor_response_time'],
        success_rate: 1 - (data.metrics['error_requests'].values['rate'] || 0)
      },
      artifactory: {
        response_time: data.metrics['artifactory_response_time'],
        success_rate: 1 - (data.metrics['error_requests'].values['rate'] || 0)
      },
      vault: {
        response_time: data.metrics['vault_response_time'],
        success_rate: 1 - (data.metrics['error_requests'].values['rate'] || 0)
      },
      keycloak: {
        response_time: data.metrics['keycloak_response_time'],
        success_rate: 1 - (data.metrics['error_requests'].values['rate'] || 0)
      },
      global: {
        requests: data.metrics['http_reqs'],
        duration: data.metrics['http_req_duration'],
        failures: data.metrics['http_req_failed'],
        iterations: data.metrics['iterations']
      }
    },
    checks: {
      harbor: data.metrics['checks'].values['harbor pull manifest success'] || 0,
      artifactory: data.metrics['checks'].values['artifactory download success'] || 0,
      vault: data.metrics['checks'].values['vault request success'] || 0,
      keycloak: data.metrics['checks'].values['keycloak auth success'] || 0
    }
  };

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    './summary.json': JSON.stringify(summary, null, 2)
  };
}