import { check, sleep } from 'k6';
import { Cmd } from 'k6/x/cmd';

const HARBOR_URL = 'test-nuam-registry.coffeesoft.org';
const PROJECT_NAME = 'library';
const IMAGE_NAME = 'ubuntu';
const image_tag_prefix = 'k6-prueba';

export const options = {
    vus: 1,
    duration: '15s',
};

export default function () {
    const cmd = new Cmd(); // Crear una instancia de Cmd
    const uniqueTag = image_tag_prefix + '-' + new Date().getTime();
    const fullImageName = HARBOR_URL + '/' + PROJECT_NAME + '/ubuntu/' + new Date().getTime() + '/' + IMAGE_NAME + ':' + uniqueTag;
    const sourceImage = IMAGE_NAME + ':latest';

    console.log(`Pushing image: ${fullImageName} from source: ${sourceImage}`);

    try {
        console.log(`Tagging image: ${fullImageName} from source: ${sourceImage}`);
        const tagResult = cmd.run('docker', 'tag', sourceImage, fullImageName);
        if (tagResult.exit_code !== 0) {
            throw new Error(`Tagging failed: ${tagResult.stderr}`);
        }
        check(tagResult, {
            'docker tag succeeded': (r) => r.exit_code === 0,
        });
    } catch (error) {
        console.error(`Error tagging image: ${error}`);
        check(false, { 'exception during docker tag': false });
    }

    try {
        console.log(`Pushing image: ${fullImageName} to Harbor`);
        const pushResult = cmd.run('docker', 'push', fullImageName);
        if (pushResult.exit_code !== 0) {
            throw new Error(`Push failed: ${pushResult.stderr}`);
        }
        check(pushResult, {
            'docker push succeeded': (r) => r.exit_code === 0,
        });
    } catch (error) {
        console.error(`Error pushing image: ${error}`);
        check(false, { 'exception during docker push': false });
    }

    sleep(5); // Simulate some processing time
}