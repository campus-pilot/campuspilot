import { importerProvenance } from './provenance.ts';

console.log(JSON.stringify(await importerProvenance(), null, 2));
