import {readFile} from 'node:fs/promises';
import {featureDatabase} from '../feature-database';
import {flowFixture} from './campaign-flow';
export const ownerRoot='docs/specs/pipeline-os/campaign-flow-20261117/revisions/owner-creator/';
export async function flowOwnerFixture(factory:typeof featureDatabase=featureDatabase){
 const f=await flowFixture(factory);await f.db.exec('reset role');await f.db.exec(await readFile(ownerRoot+'up.sql','utf8'));await f.asUser(f.users.admin);return f;
}
