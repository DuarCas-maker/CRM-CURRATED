import test from 'node:test';
import {flowOwnerFixture} from './fixtures/campaign-flow-owner';
import {readFile} from 'node:fs/promises';
import {exerciseCampaignRead} from './fixtures/campaign-read-performance';
test('campaign overview shares its facts and account budgets without changing responses, permissions or rollback',async()=>{
 const f=await flowOwnerFixture();try{await f.db.exec('reset role');await f.db.exec(await readFile('docs/specs/pipeline-os/campaign-read-recovery-20261123/dependency-fixture.sql','utf8'));await exerciseCampaignRead(f);}finally{await f.db.close();}
});
