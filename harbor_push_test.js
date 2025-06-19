import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Definimos las métricas personalizadas que se exportarán a Prometheus
const successfulPushes = new Counter('harbor_successful_pushes_total');
const failedPushes = new Counter('harbor_failed_pushes_total');
const pushDuration = new Trend('harbor_push_duration_ms');

// Opciones de configuración
export const options = {
    scenarios: {
        constant_load: {
            executor: 'constant-arrival-rate',
            rate: 10, // 10 iteraciones por segundo
            timeUnit: '1s',
            duration: '5m', // Duración total de la prueba
            preAllocatedVUs: 10, // VUs iniciales
            maxVUs: 50, // Máximo de VUs si es necesario
        },
    },
    // Configuración para exportar métricas a Prometheus
    ext: {
        loadimpact: {
            name: 'Harbor Push Performance Test',
        },
    },
};

// Función para simular un push a Harbor
function simulateHarborPush() {
    const start = Date.now();
    const testid = `test-${__VU}`; // Identificador único por VU
    
    // Simulamos una solicitud HTTP a la API de Harbor
    // (en una prueba real, reemplazar con el endpoint real)
    const url = 'http://harbor-api.example.com/api/v2.0/projects';
    const payload = JSON.stringify({
        project_name: `test-project-${__VU}-${__ITER}`,
        metadata: {
            public: 'false',
        },
    });
    
    const params = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + btoa('username:password'),
        },
        tags: { testid: testid }, // Etiqueta para agrupar por test
    };
    
    const res = http.post(url, payload, params);
    const duration = Date.now() - start;
    
    // Registramos la duración
    pushDuration.add(duration, { testid: testid });
    
    // Verificamos si fue exitoso (simulamos un 85% de éxito)
    const isSuccessful = Math.random() < 0.85;
    
    if (isSuccessful && res.status === 201) {
        successfulPushes.add(1, { testid: testid });
    } else {
        failedPushes.add(1, { testid: testid });
    }
    
    // Verificación básica
    check(res, {
        'status is 201': (r) => r.status === 201,
    });
    
    return duration;
}

export default function () {
    const duration = simulateHarborPush();
    sleep(0.1); // Pequeña pausa entre iteraciones
}

// Función para manejar el resumen (opcional)
export function handleSummary(data) {
    console.log('Test completed');
    return {};
}