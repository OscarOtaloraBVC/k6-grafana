// Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Métricas personalizadas
const harborResponseTime = new Trend('harbor_response_time');
const artifactoryResponseTime = new Trend('artifactory_response_time');
const vaultResponseTime = new Trend('vault_response_time');
const keycloakResponseTime = new Trend('keycloak_response_time');

const harborErrorRate = new Rate('harbor_error_rate');
const artifactoryErrorRate = new Rate('artifactory_error_rate');
const vaultErrorRate = new Rate('vault_error_rate');
const keycloakErrorRate = new Rate('keycloak_error_rate');

// Configuración de escenarios
export const options = {
  scenarios: {
    harbor_stage1: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'harbor',
      startTime: '0s',
    },
    artifactory_stage1: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'artifactory',
      startTime: '0s',
    },
    vault_stage1: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'vault',
      startTime: '0s',
    },
    keycloak_stage1: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'keycloak',
      startTime: '0s',
    },
    harbor_stage2: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'harbor',
      startTime: '3m',
    },
    artifactory_stage2: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'artifactory',
      startTime: '3m',
    },
    vault_stage2: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'vault',
      startTime: '3m',
    },
    keycloak_stage2: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'keycloak',
      startTime: '3m',
    },
    harbor_stage3: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'harbor',
      startTime: '5m',
    },
    artifactory_stage3: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'artifactory',
      startTime: '5m',
    },
    vault_stage3: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'vault',
      startTime: '5m',
    },
    keycloak_stage3: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'keycloak',
      startTime: '5m',
    },
  },
  thresholds: {
    'http_req_duration{type:harbor}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:artifactory}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:vault}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:keycloak}': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed{type:harbor}': ['rate<0.1'], // Más estricto (10% de error)
    'http_req_failed{type:artifactory}': ['rate<0.1'],
    'http_req_failed{type:vault}': ['rate<0.1'],
    'http_req_failed{type:keycloak}': ['rate<0.1'],
  },
  discardResponseBodies: true,
};

// Variables de entorno
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const ARTIFACTORY_URL = (__ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/artifactory').replace(/\/$/, '');
const VAULT_URL = (__ENV.VAULT_URL || 'http://localhost:8200').replace(/\/$/, '');
const KEYCLOAK_URL = (__ENV.KEYCLOAK_URL || 'https://test-nuam-kc.coffeesoft.org').replace(/\/$/, '');

// Credenciales
const HARBOR_USER = __ENV.HARBOR_USER || 'admin';
const HARBOR_PASS = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const ARTIFACTORY_USER = __ENV.ARTIFACTORY_USER || 'admin';
const ARTIFACTORY_PASS = __ENV.ARTIFACTORY_PASS || 'Nuam123.*';
const VAULT_TOKEN = __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo';
const KEYCLOAK_USER = __ENV.KEYCLOAK_USER || 'admin';
const KEYCLOAK_PASS = __ENV.KEYCLOAK_PASS || 'c659036218da417b9798c8ff97a0708d';

// Configuración de rutas
const HARBOR_PROJECT = __ENV.HARBOR_PROJECT || 'library';
const HARBOR_IMAGE = __ENV.HARBOR_IMAGE || 'test-image';
const HARBOR_TAG = __ENV.HARBOR_TAG || '30mb';
const ARTIFACTORY_REPO = __ENV.ARTIFACTORY_REPO || 'k6-prueba';
const ARTIFACTORY_FILES = ['testfile-15mb.bin', 'testfile-20mb.bin', 'testfile-25mb.bin', 'testfile-30mb.bin'];
const VAULT_SECRET_PATH = __ENV.VAULT_SECRET_PATH || 'kv_Production/data/data/testingk6';
const KEYCLOAK_REALM = __ENV.KEYCLOAK_REALM || 'master';
const KEYCLOAK_CLIENT = __ENV.KEYCLOAK_CLIENT || 'admin-cli';

// Función para seleccionar elemento aleatorio
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Función para obtener token de Harbor
function getHarborToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: HARBOR_USER,
    password: HARBOR_PASS
  });
  
  const params = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s'
  };
  
  const res = http.post(url, payload, params);
  
  if (!check(res, {
    'harbor login success': (r) => r.status === 200,
    'harbor token received': (r) => r.json().token
  })) {
    console.error(`Harbor login failed: ${res.status} ${res.body}`);
    return null;
  }
  
  return res.json().token;
}

// Exportación de funciones de prueba
export function harbor() {
  const token = getHarborToken();
  if (!token) {
    harborErrorRate.add(1);
    return;
  }

  const url = `${HARBOR_URL}/v2/${HARBOR_PROJECT}/${HARBOR_IMAGE}/manifests/${HARBOR_TAG}`;
  const params = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
    timeout: '60s'
  };

  const res = http.get(url, params);
  harborResponseTime.add(res.timings.duration);

  if (!check(res, { 'harbor success': (r) => r.status === 200 })) {
    harborErrorRate.add(1);
    console.error(`Harbor error: ${res.status} ${res.body}`);
  } else {
    harborErrorRate.add(0);
  }
}

export function artifactory() {
  const file = getRandomElement(ARTIFACTORY_FILES);
  const url = `${ARTIFACTORY_URL}/${ARTIFACTORY_REPO}/${file}`;
  const params = {
    auth: 'basic',
    username: ARTIFACTORY_USER,
    password: ARTIFACTORY_PASS,
    tags: { type: 'artifactory' },
    timeout: '90s'
  };

  const res = http.get(url, params);
  artifactoryResponseTime.add(res.timings.duration);

  if (!check(res, { 
    'artifactory success': (r) => r.status === 200,
    'artifactory has content': (r) => r.body && r.body.length > 0
  })) {
    artifactoryErrorRate.add(1);
    console.error(`Artifactory error: ${res.status}`);
  } else {
    artifactoryErrorRate.add(0);
  }
}

export function vault() {
  const url = `${VAULT_URL}/v1/${VAULT_SECRET_PATH}`;
  const params = {
    headers: { 'X-Vault-Token': VAULT_TOKEN },
    tags: { type: 'vault' }
  };

  const res = http.get(url, params);
  vaultResponseTime.add(res.timings.duration);

  if (!check(res, { 
    'vault success': (r) => r.status === 200,
    'vault data valid': (r) => r.json().data
  })) {
    vaultErrorRate.add(1);
    console.error(`Vault error: ${res.status} ${res.body}`);
  } else {
    vaultErrorRate.add(0);
  }
}

export function keycloak() {
  const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  const payload = `client_id=${KEYCLOAK_CLIENT}&username=${KEYCLOAK_USER}&password=${KEYCLOAK_PASS}&grant_type=password`;
  const params = {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    tags: { type: 'keycloak' }
  };

  const res = http.post(url, payload, params);
  keycloakResponseTime.add(res.timings.duration);

  if (!check(res, { 
    'keycloak success': (r) => r.status === 200,
    'keycloak token valid': (r) => r.json().access_token
  })) {
    keycloakErrorRate.add(1);
    console.error(`Keycloak error: ${res.status} ${res.body}`);
  } else {
    keycloakErrorRate.add(0);
  }
}

// Función setup para verificar conectividad
export function setup() {
  console.log('Verificando conectividad con los servicios...');
  
  // Verificar Harbor
  const harborPing = http.get(`${HARBOR_URL}/api/v2.0/ping`);
  check(harborPing, { 'Harbor ping': (r) => r.status === 200 });
  
  // Verificar Artifactory
  const artifactoryPing = http.get(`${ARTIFACTORY_URL}/api/system/ping`);
  check(artifactoryPing, { 'Artifactory ping': (r) => r.status === 200 });
  
  // Verificar Vault
  const vaultPing = http.get(`${VAULT_URL}/v1/sys/health`);
  check(vaultPing, { 'Vault ping': (r) => r.status === 200 || r.status === 429 });
  
  // Verificar Keycloak
  const keycloakPing = http.get(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`);
  check(keycloakPing, { 'Keycloak ping': (r) => r.status === 200 });
  
  console.log('Verificación de conectividad completada');
}