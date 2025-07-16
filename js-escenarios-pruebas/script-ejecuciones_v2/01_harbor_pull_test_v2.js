import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Harbor } from 'https://jslib.k6.io/harbor/1.0.0/index.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// Variables de entorno
const PROMETHEUS_URL = __ENV.PROMETHEUS_URL || 'http://localhost:9090';  
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';
const DOCKER_HOST = __ENV.DOCKER_HOST || 'unix:///var/run/docker.sock';

// Consultas Prometheus específicas
const CPU_QUERY = 'sum(rate(container_cpu_usage_seconds_total{namespace="registry", container=~"core|registry"}[1m])) by (container) * 100';
const MEMORY_QUERY = 'sum(container_memory_working_set_bytes{namespace="registry", container=~"core|registry"}) by (container) / (1024*1024)';

// Configuración de Harbor
const harbor = new Harbor({
    registryUrl: HARBOR_URL,
    username: USERNAME,
    password: PASSWORD,
});

// Generador de imágenes aleatorias
function generateRandomImage() {
    const minSize = 28 * 1024 * 1024; // 28MB
    const maxSize = 50 * 1024 * 1024; // 50MB
    const size = Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize;
    return new Uint8Array(size).map(() => Math.floor(Math.random() * 256));
}

// Función para obtener métricas de Prometheus
async function getPrometheusMetrics(query) {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
    const res = http.get(url);
    
    if (res.status !== 200) {
        console.error(`Error querying Prometheus: ${res.body}`);
        return null;
    }
    
    return JSON.parse(res.body).data.result;
}

// Función para eliminar imágenes Docker
function dockerRm(imageRef) {
    try {
        const cmd = `docker -H ${DOCKER_HOST} rmi ${imageRef}`;
        const result = exec(cmd, { output: 'inherit' });
        return result.status === 0;
    } catch (error) {
        console.error(`Error deleting image ${imageRef}: ${error}`);
        return false;
    }
}

export const options = {
    stages: [
        { duration: '1m25s', target: 50 },  // 50 imágenes/segundo
        { duration: '1m25s', target: 25 },  // 25 imágenes/segundo
        { duration: '1m25s', target: 15 },  // 15 imágenes/segundo
        { duration: '1m25s', target: 10 }   // 10 imágenes/segundo
    ],
    thresholds: {
        http_req_duration: ['p(95)<1000'], // 95% < 1s
        http_req_failed: ['rate<0.01'],    // Error rate < 1%
    },
    duration: '5m',
};

export default function () {
    // Generar imagen aleatoria
    const imageData = generateRandomImage();
    const randomTag = `test-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const imageRef = `${HARBOR_URL}/${PROJECT}/${IMAGE}:${randomTag}`;
    
    // Subir imagen a Harbor
    const uploadStart = Date.now();
    const uploadRes = harbor.uploadImage({
        projectName: PROJECT,
        repository: IMAGE,
        tag: randomTag,
        imageData: imageData,
    });
    
    // Verificar respuesta
    check(uploadRes, {
        'Image upload successful': (r) => r.status === 201,
    });
    
    // Medir tiempo de respuesta
    const uploadDuration = Date.now() - uploadStart;
    
    // Eliminar imagen después de un breve retraso
    sleep(0.5);
    const deleteSuccess = dockerRm(imageRef);
    check({ deleteSuccess }, {
        'Image delete successful': (s) => s.deleteSuccess === true,
    });
    
    // Registrar métricas
    const metrics = {
        upload_duration: uploadDuration,
        upload_success: uploadRes.status === 201,
        delete_success: deleteSuccess,
    };
    
    return metrics;
}

export function handleSummary(data) {
    // Obtener métricas de Prometheus al finalizar
    const cpuMetrics = getPrometheusMetrics(CPU_QUERY);
    const memoryMetrics = getPrometheusMetrics(MEMORY_QUERY);
    
    // Procesar métricas de Prometheus
    let prometheusData = {};
    if (cpuMetrics) {
        cpuMetrics.forEach((m) => {
            prometheusData[`cpu_usage_${m.metric.container}`] = m.value[1];
        });
    }
    
    if (memoryMetrics) {
        memoryMetrics.forEach((m) => {
            prometheusData[`memory_usage_${m.metric.container}`] = m.value[1];
        });
    }
    
    // Combinar métricas
    const combinedData = {
        ...data,
        prometheus: prometheusData,
    };
    
    // Generar resumen
    return {
        stdout: textSummary(combinedData, { indent: ' ', enableColors: true }),
        'summary.json': JSON.stringify(combinedData),
    };
}