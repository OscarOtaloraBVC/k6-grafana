//Escenario EC K8S DevOps 05 - Prueba masiva de consultas en aplicativos combinados
import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuración
export let options = {
  stages: [
    // Escenario 1
    { duration: '1m', target: 25 },  // Rampa a 25 peticiones/segundo para Harbor
    { duration: '2m', target: 25 },  // Mantener 25 peticiones/segundo para Harbor
    
    // Escenario 2
    { duration: '1m', target: 15 },  // Reducir a 15 peticiones/segundo para Harbor
    { duration: '2m', target: 15 },  // Mantener 15 peticiones/segundo para Harbor
    
    // Escenario 3
    { duration: '1m', target: 10 },  // Reducir a 10 peticiones/segundo para Harbor
    { duration: '2m', target: 10 },  // Mantener 10 peticiones/segundo para Harbor
    
    { duration: '1m', target: 0 },   // Enfriamiento
  ],
  thresholds: {
    'http_req_duration{type:harbor}': ['p(95)<500'],
    'http_req_duration{type:artifactory}': ['p(95)<500'],
    'http_req_duration{type:vault}': ['p(95)<500'],
    'http_req_duration{type:keycloak}': ['p(95)<500'],
    'http_req_failed': ['rate<0.1'],
  },
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
    file: __ENV.ARTIFACTORY_FILE || 'test/testfile-30mb.bin',
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

// Funciones auxiliares para cada servicio
function harborPull() {
  const manifestUrl = `${HARBOR_URL}/v2/${CREDENTIALS.harbor.project}/${CREDENTIALS.harbor.image}/manifests/${CREDENTIALS.harbor.tag}`;
  
  const params = {
    headers: {
      'Authorization': `Bearer ${getHarborToken()}`,
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json'
    },
    tags: { type: 'harbor' },
  };
  
  const res = http.get(manifestUrl, params);
  
  check(res, {
    'harbor pull success': (r) => r.status === 200,
  });
}

function artifactoryPull() {
  const url = `${ARTIFACTORY_URL}/${CREDENTIALS.artifactory.repo}/${CREDENTIALS.artifactory.file}`;
  
  const params = {
    auth: 'basic',
    username: CREDENTIALS.artifactory.user,
    password: CREDENTIALS.artifactory.pass,
    tags: { type: 'artifactory' },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'artifactory download success': (r) => r.status === 200,
  });
}

function vaultSecret() {
  const url = `${VAULT_URL}/v1/${CREDENTIALS.vault.secret}`;
  
  const params = {
    headers: {
      'X-Vault-Token': CREDENTIALS.vault.token,
    },
    tags: { type: 'vault' },
  };
  
  const res = http.get(url, params);
  
  check(res, {
    'vault secret read success': (r) => r.status === 200,
  });
}

function keycloakAuth() {
  const url = `${KEYCLOAK_URL}/realms/${CREDENTIALS.keycloak.realm}/protocol/openid-connect/token`;
  
  const payload = {
    client_id: CREDENTIALS.keycloak.client,
    username: CREDENTIALS.keycloak.user,
    password: CREDENTIALS.keycloak.pass,
    grant_type: 'password',
  };
  
  const params = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    tags: { type: 'keycloak' },
  };
  
  const res = http.post(url, payload, params);
  
  check(res, {
    'keycloak auth success': (r) => r.status === 200,
  });
}

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
  check(res, {
    'harbor login success': (r) => r.status === 200,
  });
  
  return res.json().token;
}

// Función principal
export default function () {
  // Ejecutar todas las pruebas en paralelo
  harborPull();
  artifactoryPull();
  vaultSecret();
  keycloakAuth();
  
  sleep(1);
}