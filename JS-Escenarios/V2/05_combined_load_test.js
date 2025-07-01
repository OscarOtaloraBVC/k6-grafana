//Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados

// Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, fail } from 'k6';

// Configuración de escenarios con tasas específicas por servicio
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
    'http_req_duration{type:harbor}': ['p(95)<500'],
    'http_req_duration{type:artifactory}': ['p(95)<500'],
    'http_req_duration{type:vault}': ['p(95)<500'],
    'http_req_duration{type:keycloak}': ['p(95)<500'],
    'http_req_failed{type:harbor}': ['rate<0.5'], // Falla si >50% de errores
    'http_req_failed{type:artifactory}': ['rate<0.5'],
    'http_req_failed{type:vault}': ['rate<0.5'],
    'http_req_failed{type:keycloak}': ['rate<0.5'],
  },
  discardResponseBodies: false,
};

// Variables de entorno
const HARBOR_URL = __ENV.HARBOR_URL || 'https://harbor.example.com';
const ARTIFACTORY_URL = __ENV.ARTIFACTORY_URL || 'https://artifactory.example.com';
const VAULT_URL = __ENV.VAULT_URL || 'https://vault.example.com';
const KEYCLOAK_URL = __ENV.KEYCLOAK_URL || 'https://keycloak.example.com';

// Credenciales
const CREDENTIALS = {
  harbor: {
    user: __ENV.HARBOR_USER || 'admin',
    pass: __ENV.HARBOR_PASS || 'password',
    project: __ENV.HARBOR_PROJECT || 'library',
    image: __ENV.HARBOR_IMAGE || 'nginx',
    tag: __ENV.HARBOR_TAG || 'latest',
  },
  artifactory: {
    user: __ENV.ARTIFACTORY_USER || 'admin',
    pass: __ENV.ARTIFACTORY_PASS || 'password',
    repo: __ENV.ARTIFACTORY_REPO || 'generic-local',
  },
  vault: {
    token: __ENV.VAULT_TOKEN || 's.1234567890abcdef',
    secret: __ENV.VAULT_SECRET_PATH || 'secret/data/test',
  },
  keycloak: {
    realm: __ENV.KEYCLOAK_REALM || 'master',
    client: __ENV.KEYCLOAK_CLIENT_ID || 'admin-cli',
    user: __ENV.KEYCLOAK_USER || 'admin',
    pass: __ENV.KEYCLOAK_PASS || 'password',
  },
};

// Generador de tamaños de archivo aleatorios
function getRandomFileSize(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Función para Harbor - Pull de imágenes
function harborPull() {
  const manifestUrl = `${HARBOR_URL}/v2/${CREDENTIALS.harbor.project}/${CREDENTIALS.harbor.image}/manifests/${CREDENTIALS.harbor.tag}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${getHarborToken()}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
    timeout: '60s' // Tiempo aumentado para imágenes grandes
  };
  
  const res = http.get(manifestUrl, params);
  
  if (!check(res, {
    'harbor pull success': (r) => r.status === 200,
  })) {
    fail('Harbor pull failed with status: ' + res.status);
  }
}

// Función para Artifactory - Descarga de artefactos
function artifactoryPull() {
  // Generar tamaño aleatorio entre 15-30MB
  const fileSize = getRandomFileSize(15, 30);
  const testFile = `testfile-${fileSize}mb.bin`;
  const url = `${ARTIFACTORY_URL}/${CREDENTIALS.artifactory.repo}/${testFile}`;
  
  const params = {
    auth: 'basic',
    username: CREDENTIALS.artifactory.user,
    password: CREDENTIALS.artifactory.pass,
    tags: { type: 'artifactory' },
    timeout: '60s' // Tiempo aumentado para archivos grandes
  };
  
  const res = http.get(url, params);
  
  if (!check(res, {
    'artifactory download success': (r) => r.status === 200,
  })) {
    fail('Artifactory download failed with status: ' + res.status);
  }
}

// Función para Vault - Consulta de secretos
function vaultSecret() {
  const url = `${VAULT_URL}/v1/${CREDENTIALS.vault.secret}`;
  
  const params = {
    headers: {
      'X-Vault-Token': CREDENTIALS.vault.token,
    },
    tags: { type: 'vault' },
  };
  
  const res = http.get(url, params);
  
  if (!check(res, {
    'vault secret read success': (r) => r.status === 200,
  })) {
    fail('Vault secret read failed with status: ' + res.status);
  }
}

// Función para Keycloak - Autenticación
function keycloakAuth() {
  const url = `${KEYCLOAK_URL}/realms/${CREDENTIALS.keycloak.realm}/protocol/openid-connect/token`;
  
  const payload = `client_id=${CREDENTIALS.keycloak.client}&username=${CREDENTIALS.keycloak.user}&password=${CREDENTIALS.keycloak.pass}&grant_type=password`;
  
  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    tags: { type: 'keycloak' },
  };
  
  const res = http.post(url, payload, params);
  
  if (!check(res, {
    'keycloak auth success': (r) => r.status === 200,
  })) {
    fail('Keycloak auth failed with status: ' + res.status);
  }
}

// Función auxiliar para obtener token de Harbor
function getHarborToken() {
  const url = `${HARBOR_URL}/api/v2.0/users/login`;
  const payload = JSON.stringify({
    principal: CREDENTIALS.harbor.user,
    password: CREDENTIALS.harbor.pass
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