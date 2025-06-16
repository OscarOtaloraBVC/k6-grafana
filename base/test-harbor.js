import { check, sleep } from 'k6';
import exec from 'k6/x/exec';
//import { Cmd } from 'k6/x/cmd';

const HARBOR_URL = 'test-nuam-registry.coffeesoft.org';
const PROJECT_NAME = 'test-devops';
const IMAGE_NAME = 'ubuntu';
const image_tag_prefix = 'xk6';


export const options = {
    vus: 20,
    duration: '15s',

};

export default function () {
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
    const fullImageName =  HARBOR_URL+'/' +PROJECT_NAME + '/' + IMAGE_NAME + ':' + uniqueTag;
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