// Escenario EC K8S DevOps 01 - Carga masiva con métricas de sistema
// ejecucion: k6 run --out influxdb=http://localhost:8086/k6 01_harbor_pull_test.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { exec } from 'k6/execution';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';

// Métricas Servidor
const cpuUsage = new Gauge('CPU_Usage');
const memoryUsage = new Gauge('Memory_Usage');
const reqRate = new Rate('Requests_per_second');
const avgResponseTime = new Trend('Average_Response_Time');
const throughput = new Counter('Total_Throughput');
const dockerPullTime = new Trend('Docker_Pull_Time');
const dockerRmTime = new Trend('Docker_Rm_Time');

// Configuración
export let options = {
  stages: [
    { duration: '1m', target: 50 },  // 50 imágenes/segundo
    { duration: '1m', target: 25 },  // 25 imágenes/segundo
    { duration: '1m', target: 15 },  // 15 imágenes/segundo
    { duration: '2m', target: 10 },  // 10 imágenes/segundo
  ],
  noConnectionReuse: true,
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1'],
    'CPU_Usage': ['value<80'],         // Alerta si >80%
    'Memory_Usage': ['value<90'],      // Alerta si >90%
    'Docker_Pull_Time': ['p(95)<10000'], // 10 segundos máximo
  },
};

// Variables de entorno
const HARBOR_URL = (__ENV.HARBOR_URL || 'https://test-nuam-registry.coffeesoft.org').replace(/\/$/, '');
const USERNAME = __ENV.HARBOR_USER || 'admin';
const PASSWORD = __ENV.HARBOR_PASS || 'r7Y5mQBwsM2lIj0';
const PROJECT = __ENV.HARBOR_PROJECT || 'test-devops';
const IMAGE = __ENV.HARBOR_IMAGE || 'ubuntu';
const TAG = __ENV.HARBOR_TAG || 'xk6-1749486052417';
const MONITORING_URL = __ENV.MONITORING_URL || 'http://localhost:9090/api/v1/query'; // Prometheus

// Obtener métricas del servidor desde Prometheus
function getServerMetrics() {
  try {
    const cpuQuery = 'sum(rate(container_cpu_usage_seconds_total{container="harbor-core"}[1m])) * 100';
    const memQuery = 'container_memory_usage_bytes{container="harbor-core"} / (1024 * 1024)';
    
    const cpuRes = http.get(`${MONITORING_URL}?query=${encodeURIComponent(cpuQuery)}`);
    const memRes = http.get(`${MONITORING_URL}?query=${encodeURIComponent(memQuery)}`);

    if (cpuRes.status === 200 && memRes.status === 200) {
      const cpuData = cpuRes.json();
      const memData = memRes.json();
      
      return {
        cpu: cpuData.data.result[0]?.value[1] || 0,
        memory: memData.data.result[0]?.value[1] || 0
      };
    }
  } catch (e) {
    console.error('Error fetching metrics:', e.message);
  }
  return { cpu: 0, memory: 0 };
}

// Función principal
export default function () {
  // Obtener métricas del servidor
  const metrics = getServerMetrics();
  cpuUsage.add(metrics.cpu);
  memoryUsage.add(metrics.memory);

  const startTime = new Date().getTime();
  const imageName = `${HARBOR_URL.replace('https://', '')}/${PROJECT}/${IMAGE}:${TAG}`;
  
  try {
    // 1. Docker Pull
    const pullStart = new Date().getTime();
    const pullCmd = `docker pull ${imageName}`;
    const pullResult = exec(pullCmd, { timeout: '30s' });
    const pullDuration = (new Date().getTime() - pullStart) / 1000;
    dockerPullTime.add(pullDuration);

    check(pullResult, {
      'docker pull success': (r) => r.exit_status === 0,
    });

    // 2. Docker RM
    const rmStart = new Date().getTime();
    const rmCmd = `docker rmi -f ${imageName}`;
    const rmResult = exec(rmCmd, { timeout: '30s' });
    const rmDuration = (new Date().getTime() - rmStart) / 1000;
    dockerRmTime.add(rmDuration);

    check(rmResult, {
      'docker rm success': (r) => r.exit_status === 0,
    });

    // Calcular métricas de rendimiento
    const totalTime = (new Date().getTime() - startTime) / 1000;
    reqRate.add(1);
    avgResponseTime.add(totalTime);
    throughput.add(1);

  } catch (e) {
    console.error(`Error en iteración: ${e.message}`);
  }
  
  sleep(1);
}

// Reporte final
export function handleSummary(data) {
  const summary = {
    duration: data.state.testDuration,
    metrics: {
      cpu_usage: data.metrics['CPU_Usage'].values,
      memory_usage: data.metrics['Memory_Usage'].values,
      request_rate: data.metrics['Requests_per_second'].values,
      avg_response_time: data.metrics['Average_Response_Time'].values,
      throughput: data.metrics['Total_Throughput'].values,
      docker_pull_time: data.metrics['Docker_Pull_Time'].values,
      docker_rm_time: data.metrics['Docker_Rm_Time'].values,
    },
    checks: data.metrics.checks,
    thresholds: data.metrics.thresholds,
  };

  // Reporte para InfluxDB+Grafana
  const influxData = Object.entries(summary.metrics).map(([name, values]) => ({
    measurement: name,
    fields: values,
    tags: { test: 'harbor_stress_test' }
  }));

  return {
    stdout: `Resumen de prueba:\n${JSON.stringify(summary, null, 2)}`,
    'summary.json': JSON.stringify(summary),
    'influx_data.json': JSON.stringify(influxData),
  };
}