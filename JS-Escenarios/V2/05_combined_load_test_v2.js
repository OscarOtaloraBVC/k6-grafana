// Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, fail } from 'k6';
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
export let options = {
  scenarios: {
    // Escenario 1 (Primeros 3 minutos)
    harbor_stage1: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'harborPull',
      startTime: '0s',
    },
    artifactory_stage1: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'artifactoryPull',
      startTime: '0s',
    },
    vault_stage1: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'vaultSecret',
      startTime: '0s',
    },
    keycloak_stage1: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '3m',
      preAllocatedVUs: 50,
      maxVUs: 100,
      exec: 'keycloakAuth',
      startTime: '0s',
    },
    
    // Escenario 2 (Minutos 3-5)
    harbor_stage2: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'harborPull',
      startTime: '3m',
    },
    artifactory_stage2: {
      executor: 'constant-arrival-rate',
      rate: 15,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'artifactoryPull',
      startTime: '3m',
    },
    vault_stage2: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'vaultSecret',
      startTime: '3m',
    },
    keycloak_stage2: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 25,
      maxVUs: 50,
      exec: 'keycloakAuth',
      startTime: '3m',
    },
    
    // Escenario 3 (Minutos 5-7)
    harbor_stage3: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'harborPull',
      startTime: '5m',
    },
    artifactory_stage3: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'artifactoryPull',
      startTime: '5m',
    },
    vault_stage3: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'vaultSecret',
      startTime: '5m',
    },
    keycloak_stage3: {
      executor: 'constant-arrival-rate',
      rate: 25,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 15,
      maxVUs: 30,
      exec: 'keycloakAuth',
      startTime: '5m',
    },
  },
  thresholds: {
    'http_req_duration{type:harbor}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:artifactory}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:vault}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{type:keycloak}': ['p(95)<500', 'p(99)<1000'],
    'http_req_failed{type:harbor}': ['rate<0.5'],
    'http_req_failed{type:artifactory}': ['rate<0.5'],
    'http_req_failed{type:vault}': ['rate<0.5'],
    'http_req_failed{type:keycloak}': ['rate<0.5'],
    'harbor_error_rate': ['rate<0.5'],
    'artifactory_error_rate': ['rate<0.5'],
    'vault_error_rate': ['rate<0.5'],
    'keycloak_error_rate': ['rate<0.5'],
  },
  discardResponseBodies: false,
};

// Función auxiliar para obtener variables de entorno requeridas
function getRequiredEnv(name, defaultValue = null) {
  const value = __ENV[name] || defaultValue;
  if (!value) {
    fail(`Variable de entorno requerida no definida: ${name}`);
  }
  return value;
}

// Variables de entorno HARBOR
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const HARBOR_USER = __ENV.HARBOR_USER || 'admin';
const HARBOR_PASS = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const HARBOR_PROJECT = __ENV.HARBOR_PROJECT || 'library';
const HARBOR_IMAGE = __ENV.HARBOR_IMAGE || 'test-image';
const HARBOR_TAG = __ENV.HARBOR_TAG || '30mb';

// Variables de entorno ARTIFACTORY
const ARTIFACTORY_URL = (__ENV.ARTIFACTORY_URL || 'https://test-nuam-artifactory.coffeesoft.org/ui/native/k6-prueba/').replace(/\/$/, '');
const ARTIFACTORY_USER = __ENV.ARTIFACTORY_USER || 'admin';
const ARTIFACTORY_PASS = __ENV.ARTIFACTORY_PASS || 'Nuam123.*';
const ARTIFACTORY_REPO = __ENV.ARTIFACTORY_REPO || 'k6-prueba';
const ARTIFACTORY_FILE_PATHS = [
  'test/testfile-15mb.bin',
  'test/testfile-20mb.bin',
  'test/testfile-25mb.bin',
  'test/testfile-30mb.bin'
];

// Variables de entorno VAULT
const VAULT_URL = (__ENV.VAULT_URL || 'http://localhost:8200').replace(/\/$/, '');
const VAULT_TOKEN = __ENV.VAULT_TOKEN || 'hvs.wy9yDkSXpszNTDWfNxNMswQo';
const VAULT_SECRET_PATHS = [
  __ENV.VAULT_SECRET_PATH || '/v1/kv_Production/data/data/testingk6'
];

// Variables de entorno KEYCLOAK
const KEYCLOAK_URL = (getRequiredEnv('KEYCLOAK_URL', 'https://test-nuam-kc.coffeesoft.org')).replace(/\/$/, '');
const KEYCLOAK_REALM = getRequiredEnv('KEYCLOAK_REALM', 'master');
const KEYCLOAK_CLIENT_ID = getRequiredEnv('KEYCLOAK_CLIENT_ID', 'admin-cli');
const KEYCLOAK_USER = getRequiredEnv('KEYCLOAK_USER', 'admin');
const KEYCLOAK_PASS = getRequiredEnv('KEYCLOAK_PASS', 'c659036218da417b9798c8ff97a0708d');

// Función para seleccionar un elemento aleatorio de un array
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Exportación de funciones de prueba
export function harborPull() {
  const manifestUrl = `${HARBOR_URL}/v2/${HARBOR_PROJECT}/${HARBOR_IMAGE}/manifests/${HARBOR_TAG}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${getHarborToken()}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
    timeout: '90s'
  };
  
  const start = Date.now();
  const res = http.get(manifestUrl, params);
  const duration = Date.now() - start;
  harborResponseTime.add(duration);
  
  const success = check(res, {
    'harbor pull success': (r) => r.status === 200,
  });
  
  if (!success) {
    harborErrorRate.add(1);
    fail(`Harbor pull failed with status: ${res.status}`);
  } else {
    harborErrorRate.add(0);
  }
}

export function artifactoryPull() {
  const filePath = getRandomElement(ARTIFACTORY_FILE_PATHS);
  const url = `${ARTIFACTORY_URL}/${ARTIFACTORY_REPO}/${filePath}`;
  
  const params = {
    auth: 'basic',
    username: ARTIFACTORY_USER,
    password: ARTIFACTORY_PASS,
    tags: { type: 'artifactory' },
    timeout: '90s'
  };
  
  const start = Date.now();
  const res = http.get(url, params);
  const duration = Date.now() - start;
  artifactoryResponseTime.add(duration);
  
  const success = check(res, {
    'artifactory download success': (r) => r.status === 200,
    'artifactory correct size': (r) => parseInt(r.headers['Content-Length']) > 0
  });
  
  if (!success) {
    artifactoryErrorRate.add(1);
    fail(`Artifactory download failed with status: ${res.status}`);
  } else {
    artifactoryErrorRate.add(0);
  }
}

export function vaultSecret() {
  const secretPath = getRandomElement(VAULT_SECRET_PATHS);
  const url = `${VAULT_URL}${secretPath}`;
  
  const params = {
    headers: {
      'X-Vault-Token': VAULT_TOKEN,
    },
    tags: { type: 'vault' },
  };
  
  const start = Date.now();
  const res = http.get(url, params);
  const duration = Date.now() - start;
  vaultResponseTime.add(duration);
  
  const success = check(res, {
    'vault secret read success': (r) => r.status === 200,
    'vault valid response': (r) => r.json().data !== null
  });
  
  if (!success) {
    vaultErrorRate.add(1);
    fail(`Vault secret read failed with status: ${res.status}`);
  } else {
    vaultErrorRate.add(0);
  }
}

export function keycloakAuth() {
  const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  
  const payload = `client_id=${KEYCLOAK_CLIENT_ID}&username=${KEYCLOAK_USER}&password=${KEYCLOAK_PASS}&grant_type=password`;
  
  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    tags: { type: 'keycloak' },
  };
  
  const start = Date.now();
  const res = http.post(url, payload, params);
  const duration = Date.now() - start;
  keycloakResponseTime.add(duration);
  
  const success = check(res, {
    'keycloak auth success': (r) => r.status === 200,
    'keycloak valid token': (r) => r.json().access_token !== undefined
  });
  
  if (!success) {
    keycloakErrorRate.add(1);
    fail(`Keycloak auth failed with status: ${res.status}`);
  } else {
    keycloakErrorRate.add(0);
  }
}

// Función auxiliar para obtener token de Harbor
function getHarborToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: HARBOR_USER,
    password: HARBOR_PASS
  });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const res = http.post(url, payload, params);
  
  if (!check(res, {
    'harbor login success': (r) => r.status === 200,
  })) {
    fail('Harbor login failed with status: ' + res.status);
  }
  
  return res.json().token;
}

// Función de inicialización para verificar conectividad
export function setup() {
  console.log('Validando conectividad con los servicios...');
  
  // Verificar que todos los servicios responden
  const services = [
    { name: 'Harbor', url: HARBOR_URL },
    { name: 'Artifactory', url: ARTIFACTORY_URL },
    { name: 'Vault', url: VAULT_URL },
    { name: 'Keycloak', url: KEYCLOAK_URL }
  ];
  
  services.forEach(service => {
    const res = http.get(service.url);
    if (!check(res, { [`${service.name} available`]: (r) => r.status === 200 || r.status === 401 })) {
      fail(`${service.name} no está disponible en ${service.url}`);
    }
  });
  
  console.log('Todos los servicios están disponibles. Iniciando prueba...');
}