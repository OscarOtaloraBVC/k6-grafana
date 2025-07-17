import { check, sleep } from 'k6';
import exec from 'k6/x/exec';
//import { Cmd } from 'k6/x/cmd';
 
const HARBOR_URL = 'test-nuam-registry.coffeesoft.org';
const PROJECT_NAME = 'library';
const IMAGE_NAME = 'ubuntu';
const image_tag_prefix = 'latest';
 
const HARBOR_USER = 'admin';
const HARBOR_PASSWORD = 'r7Y5mQBwsM2lIj0';
 
//export const options = {
//    vus: 1,
//    duration: '15s',
//};

export const options = {
  stages: [
    { duration: '10m', target: 10 }
    //{ duration: '1m15s', target: 50 },
    //{ duration: '1m15s', target: 25 },
    //{ duration: '1m15s', target: 15 },
    //{ duration: '1m15s', target: 10 }
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.1']
  },
  teardownTimeout: '60s' // Default "60s"
};


function dockerLogin() {
    try {
        console.log(`Authenticating with Harbor registry...`);
        const cmd = `docker login ${HARBOR_URL} -u ${HARBOR_USER} -p ${HARBOR_PASSWORD}`;
        exec.command('sh', ['-c', cmd]);
        return true;
    } catch (error) {
        console.error(`Error during Docker login: ${error}`);
        return false;
    }
}

export default function () {

    // Autenticación por cada usuario virtual (VU)
    if (!dockerLogin()) {
        check(false, { 'docker login failed': false });
        return;
    }
        
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
    const fullImageName =  HARBOR_URL+'/' +PROJECT_NAME +'/ubuntu/'+new Date().getTime() + '/' + IMAGE_NAME + ':' + uniqueTag;
    const sourceImage = IMAGE_NAME + ':latest';
 
    console.log(`Pushing image: ${fullImageName} from source: ${sourceImage}`);
 
    try {
        console.log(`Tagging image: ${fullImageName} from source: ${sourceImage}`);
        exec.command('docker', ['tag', sourceImage, fullImageName]);
    } catch (error) {
        console.error(`Error tagging image: ${error}`);
        check(false,{ 'exception during docker push': false });
    }
 
    try {
        console.log(`Pushing image: ${fullImageName} to Harbor`);
        exec.command('docker', ['push', fullImageName]);
    } catch (error) {
        console.error(`Error pushing image: ${error}`);
        check(false,{ 'exception during docker push': false });
    }
 
    sleep(5); // Simulate some processing time
}