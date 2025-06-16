// test-harbor-with-metrics.js
import { check, sleep } from 'k6';
import exec from 'k6/x/exec';
import { Counter, Rate, Trend } from 'k6/metrics';
import { check } from 'k6';

// Métricas personalizadas
const successfulPushes = new Counter('harbor_successful_pushes');
const failedPushes = new Counter('harbor_failed_pushes');
const pushDuration = new Trend('harbor_push_duration');

const HARBOR_URL = 'test-nuam-registry.coffeesoft.org';
const PROJECT_NAME = 'test-devops';
const IMAGE_NAME = 'ubuntu';
const image_tag_prefix = 'xk6';

export const options = {
    vus: 20,
    duration: '15s',
    ext: {
        loadimpact: {
            name: 'Harbor Image Push Test',
            projectID: 12345
        }
    },
    // Configuración para exportar métricas a Prometheus
    teardownTimeout: '10s',
    thresholds: {
        'harbor_push_duration': ['p(95)<5000'], // 95% de los pushes deben tardar menos de 5s
        'harbor_successful_pushes': ['count>15'], // Debe haber al menos 15 pushes exitosos
        'checks': ['rate>0.9'] // 90% de los checks deben pasar
    }
};

export default function () {
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
    const fullImageName =  HARBOR_URL+'/' +PROJECT_NAME + '/' + IMAGE_NAME + ':' + uniqueTag;
    const sourceImage = IMAGE_NAME + ':latest';

    console.log(`Pushing image: ${fullImageName} from source: ${sourceImage}`);
    const startTime = new Date().getTime();

    try {
        console.log(`Tagging image: ${fullImageName} from source: ${sourceImage}`);
        exec.command('docker', ['tag', sourceImage, fullImageName]);
    } catch (error) {
        console.error(`Error tagging image: ${error}`);
        failedPushes.add(1);
        check(false, { 'docker tag success': false });
        return;
    }

    try {
        console.log(`Pushing image: ${fullImageName} to Harbor`);
        exec.command('docker', ['push', fullImageName]);
        const endTime = new Date().getTime();
        pushDuration.add(endTime - startTime);
        successfulPushes.add(1);
        check(true, { 'docker push success': true });
    } catch (error) {
        console.error(`Error pushing image: ${error}`);
        failedPushes.add(1);
        check(false, { 'docker push success': false });
    }

    sleep(5);
}